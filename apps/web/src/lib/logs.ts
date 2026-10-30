import { decodeEventLog, type Hex, type Log } from "viem";
import { productRegistryAbi } from "../contracts/ProductRegistry.ts";
import { sameHex } from "./format.ts";

const PRODUCT_EVENTS = new Set([
  "BatchRegistered",
  "CustodyTransferProposed",
  "CustodyTransferCancelled",
  "CustodyTransferred",
  "BatchRecalled",
]);

export type ProductEventName =
  | "BatchRegistered"
  | "CustodyTransferProposed"
  | "CustodyTransferCancelled"
  | "CustodyTransferred"
  | "BatchRecalled";

export type ProductLog = {
  eventName: ProductEventName;
  args: Readonly<Record<string, unknown>>;
  transactionHash: Hex | null;
  logIndex: number | null;
};

export function decodeProductLogs(logs: readonly Log[]): ProductLog[] {
  const decoded: ProductLog[] = [];
  for (const log of logs) {
    try {
      const event = decodeEventLog({
        abi: productRegistryAbi,
        data: log.data,
        topics: log.topics,
      });
      if (!PRODUCT_EVENTS.has(event.eventName)) continue;
      decoded.push({
        eventName: event.eventName as ProductEventName,
        args: event.args as Readonly<Record<string, unknown>>,
        transactionHash: log.transactionHash ?? null,
        logIndex: log.logIndex ?? null,
      });
    } catch {
      continue;
    }
  }
  return decoded;
}

export function logsForBatch(logs: readonly ProductLog[], batchId: Hex): ProductLog[] {
  return logs.filter((log) => typeof log.args.batchId === "string" && sameHex(log.args.batchId, batchId));
}

export type Handoff = {
  from: string;
  to: string;
  timestamp: bigint;
};

function asTimestamp(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  return null;
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
    const timestamp = asTimestamp(log.args.timestamp);
    if (typeof from !== "string" || typeof to !== "string" || timestamp === null) return true;
    if (!sameHex(from, row.from) || !sameHex(to, row.to) || timestamp !== row.timestamp) return true;
  }
  return false;
}
