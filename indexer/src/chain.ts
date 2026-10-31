import { createPublicClient, defineChain, http, numberToHex, type Hex } from "viem";
import type { IndexerConfig } from "./config.ts";
import { productTopics, type RawLog } from "./events.ts";

export type BlockHeader = {
  number: number;
  hash: string;
  parentHash: string;
};

export interface ChainReader {
  getChainId(): Promise<number>;
  getHeadBlock(): Promise<number>;
  getBlock(number: number): Promise<BlockHeader | null>;
  getLogs(fromBlock: number, toBlock: number): Promise<RawLog[]>;
}

type RpcLog = {
  blockNumber: Hex | null;
  blockHash: Hex | null;
  transactionHash: Hex | null;
  logIndex: Hex | null;
  topics: Hex[];
  data: Hex;
  removed?: boolean;
};

const RATE_LIMIT_MESSAGE = /rate.?limit|too many requests/i;
const SHRINK_MESSAGE =
  /\branges?\b|more than \d+ (results|logs)|too many (results|logs|blocks)|response size|limit exceeded|time(d)? ?out/i;
const TIMEOUT_STATUSES = new Set([408, 504, 524]);

export function shrinksLogRange(error: unknown): boolean {
  const causes: Array<Record<string, unknown>> = [];
  for (let current = error; current && typeof current === "object" && causes.length < 8; ) {
    const item = current as Record<string, unknown>;
    causes.push(item);
    current = item.cause;
  }
  if (causes.some((item) => item.status === 429 || messagesOf(item).some((text) => RATE_LIMIT_MESSAGE.test(text)))) {
    return false;
  }
  return causes.some(
    (item) =>
      item.name === "TimeoutError" ||
      item.code === -32005 ||
      (typeof item.status === "number" && TIMEOUT_STATUSES.has(item.status)) ||
      messagesOf(item).some((text) => SHRINK_MESSAGE.test(text)),
  );
}

export function createChainReader(config: IndexerConfig, options: { timeoutMs?: number } = {}): ChainReader {
  const chain = defineChain({
    id: config.chainId,
    name: "proofchain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.chainRpcUrl] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(config.chainRpcUrl, { retryCount: 0, timeout: options.timeoutMs ?? 10_000 }),
  });
  const topics = productTopics();

  return {
    async getChainId() {
      return client.getChainId();
    },
    async getHeadBlock() {
      return Number(await client.getBlockNumber());
    },
    async getBlock(number) {
      try {
        const block = await client.getBlock({ blockNumber: BigInt(number) });
        return {
          number,
          hash: block.hash.toLowerCase(),
          parentHash: block.parentHash.toLowerCase(),
        };
      } catch (error) {
        if (isMissingBlock(error)) return null;
        throw error;
      }
    },
    async getLogs(fromBlock, toBlock) {
      const logs = (await client.request({
        method: "eth_getLogs",
        params: [
          {
            address: config.contractAddress as Hex,
            fromBlock: numberToHex(fromBlock),
            toBlock: numberToHex(toBlock),
            topics: [topics],
          },
        ],
      })) as RpcLog[];
      return logs.map((log) => {
        if (log.blockNumber == null || log.blockHash == null || log.transactionHash == null || log.logIndex == null) {
          throw new Error("Log is missing block fields");
        }
        return {
          blockNumber: Number(BigInt(log.blockNumber)),
          blockHash: log.blockHash.toLowerCase(),
          transactionHash: log.transactionHash.toLowerCase(),
          logIndex: Number(BigInt(log.logIndex)),
          topics: log.topics.map((topic) => topic.toLowerCase()),
          data: log.data,
          removed: log.removed,
        };
      });
    },
  };
}

// viem's full message also carries the URL and request body, so prefer its short message and details.
function messagesOf(item: Record<string, unknown>): string[] {
  const parts = [item.shortMessage, item.details].filter((part): part is string => typeof part === "string");
  if (parts.length > 0) return parts;
  return typeof item.message === "string" ? [item.message] : [];
}

function isMissingBlock(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "BlockNotFoundError");
}
