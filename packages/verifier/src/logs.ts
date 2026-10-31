import {
  decodeAbiParameters,
  decodeEventLog,
  getAbiItem,
  hexToBytes,
  isHex,
  numberToHex,
  toEventSelector,
  type Address,
  type Hex,
} from "viem";
import { productRegistryAbi } from "./abi.ts";
import { asBigint, isRecord, sameHex } from "./format.ts";
import { describeReaderError, ReaderTimeout, ReaderUnreachable, type Reader } from "./rpc.ts";

export type ProductEventName =
  | "BatchRegistered"
  | "CustodyTransferProposed"
  | "CustodyTransferCancelled"
  | "CustodyTransferred"
  | "BatchRecalled";

export const PRODUCT_EVENTS: readonly ProductEventName[] = [
  "BatchRegistered",
  "CustodyTransferProposed",
  "CustodyTransferCancelled",
  "CustodyTransferred",
  "BatchRecalled",
];

export const PRODUCT_TOPICS: readonly Hex[] = PRODUCT_EVENTS.map((name) =>
  toEventSelector(getAbiItem({ abi: productRegistryAbi, name })),
);

export const DEFAULT_LOG_SPAN = 50_000n;
const MAX_CONSECUTIVE_TIMEOUTS = 3;

export type ProductLog = {
  eventName: ProductEventName;
  args: Readonly<Record<string, unknown>>;
  blockNumber: bigint | null;
  logIndex: number | null;
  transactionHash: Hex | null;
  document: Uint8Array | null;
};

export type LogLoad =
  | { ok: true; reader: string; logs: ProductLog[]; failures: string[] }
  | { ok: false; failures: string[] };

export type Handoff = {
  from: string;
  to: string;
  timestamp: bigint;
};

const registeredData = getAbiItem({ abi: productRegistryAbi, name: "BatchRegistered" })
  .inputs.filter((input) => !input.indexed)
  .map((input) => (input.name === "document" ? { ...input, type: "bytes" } : input));

export class LogsUnavailable extends Error {
  constructor(reason: string) {
    super(`Contract logs could not be loaded: ${reason}`);
    this.name = "LogsUnavailable";
  }
}

export function isRangeRejection(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/rate.?limit|too many requests/i.test(message)) return false;
  return /range|too many|exceed|more than|response size|query returned|log size|block limit/i.test(message);
}

export async function readLogsInChunks<T>(
  read: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  fromBlock: bigint,
  toBlock: bigint,
  initialSpan: bigint = DEFAULT_LOG_SPAN,
): Promise<T[]> {
  if (fromBlock > toBlock) return [];
  const logs: T[] = [];
  let span = initialSpan > 0n ? initialSpan : 1n;
  let timeouts = 0;
  let from = fromBlock;
  while (from <= toBlock) {
    const to = from + span - 1n > toBlock ? toBlock : from + span - 1n;
    try {
      logs.push(...(await read(from, to)));
      from = to + 1n;
      timeouts = 0;
    } catch (error) {
      const timedOut = error instanceof ReaderTimeout;
      if (!timedOut && !isRangeRejection(error)) throw new LogsUnavailable(describeReaderError(error));
      if (timedOut) {
        timeouts += 1;
        if (timeouts >= MAX_CONSECUTIVE_TIMEOUTS) throw new LogsUnavailable(`${timeouts} timeouts in a row`);
      }
      const actual = to - from + 1n;
      if (actual <= 1n) throw new LogsUnavailable(describeReaderError(error));
      span = actual / 2n;
    }
  }
  return logs;
}

export async function loadBatchLogs(
  readers: readonly Reader[],
  filter: { contract: Address; batchId: Hex; fromBlock: bigint; toBlock: bigint },
  initialSpan: bigint = DEFAULT_LOG_SPAN,
): Promise<LogLoad> {
  const failures: string[] = [];
  for (const reader of readers) {
    try {
      const raw = await readLogsInChunks(
        async (fromBlock, toBlock) => {
          const result = await reader.request("eth_getLogs", [
            {
              address: filter.contract,
              topics: [PRODUCT_TOPICS, filter.batchId],
              fromBlock: numberToHex(fromBlock),
              toBlock: numberToHex(toBlock),
            },
          ]);
          if (!Array.isArray(result)) throw new ReaderUnreachable("eth_getLogs did not return a list");
          return result as unknown[];
        },
        filter.fromBlock,
        filter.toBlock,
        initialSpan,
      );
      return { ok: true, reader: reader.url, logs: decodeProductLogs(raw, filter.contract, filter.batchId), failures };
    } catch (error) {
      failures.push(`${reader.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ok: false, failures };
}

export function decodeProductLogs(raw: readonly unknown[], contract: Address, batchId: Hex): ProductLog[] {
  const decoded: ProductLog[] = [];
  for (const item of raw) {
    const log = decodeOne(item, contract, batchId);
    if (log) decoded.push(log);
  }
  return decoded.sort(byPosition);
}

export function historyDisagrees(history: readonly Handoff[], logs: readonly ProductLog[]): boolean {
  const transferred = logs.filter((log) => log.eventName === "CustodyTransferred");
  if (transferred.length !== history.length) return true;
  for (let index = 0; index < history.length; index += 1) {
    const row = history[index];
    const log = transferred[index];
    if (!row || !log) return true;
    const from = log.args.from;
    const to = log.args.to;
    const timestamp = asBigint(log.args.timestamp);
    if (typeof from !== "string" || typeof to !== "string" || timestamp === null) return true;
    if (!sameHex(from, row.from) || !sameHex(to, row.to) || timestamp !== row.timestamp) return true;
  }
  return false;
}

function decodeOne(item: unknown, contract: Address, batchId: Hex): ProductLog | null {
  if (!isRecord(item) || item.removed === true) return null;
  if (typeof item.address !== "string" || !sameHex(item.address, contract)) return null;
  if (!Array.isArray(item.topics) || !item.topics.every((topic) => typeof topic === "string" && isHex(topic))) return null;
  if (typeof item.data !== "string" || !isHex(item.data)) return null;
  const topics = item.topics as Hex[];
  if (!topics[1] || !sameHex(topics[1], batchId)) return null;
  try {
    const event = decodeEventLog({
      abi: productRegistryAbi,
      data: item.data,
      topics: topics as [Hex, ...Hex[]],
    });
    if (!PRODUCT_EVENTS.includes(event.eventName as ProductEventName)) return null;
    return {
      eventName: event.eventName as ProductEventName,
      args: event.args as Readonly<Record<string, unknown>>,
      blockNumber: quantity(item.blockNumber),
      logIndex: quantity(item.logIndex) === null ? null : Number(quantity(item.logIndex)),
      transactionHash: typeof item.transactionHash === "string" && isHex(item.transactionHash) ? item.transactionHash : null,
      document: event.eventName === "BatchRegistered" ? documentBytes(item.data) : null,
    };
  } catch {
    return null;
  }
}

function documentBytes(data: Hex): Uint8Array | null {
  try {
    const values = decodeAbiParameters(registeredData, data);
    const document = values[values.length - 1];
    return typeof document === "string" && isHex(document) ? hexToBytes(document) : null;
  } catch {
    return null;
  }
}

function quantity(value: unknown): bigint | null {
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value);
  return asBigint(value);
}

function byPosition(left: ProductLog, right: ProductLog): number {
  const leftBlock = left.blockNumber ?? 0n;
  const rightBlock = right.blockNumber ?? 0n;
  if (leftBlock !== rightBlock) return leftBlock < rightBlock ? -1 : 1;
  return (left.logIndex ?? 0) - (right.logIndex ?? 0);
}
