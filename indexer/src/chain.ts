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

export function createChainReader(config: IndexerConfig): ChainReader {
  const chain = defineChain({
    id: config.chainId,
    name: "proofchain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.chainRpcUrl] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(config.chainRpcUrl, { retryCount: 0, timeout: 10_000 }),
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

function isMissingBlock(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "BlockNotFoundError");
}
