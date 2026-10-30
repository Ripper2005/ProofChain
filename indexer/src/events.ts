import { decodeEventLog, parseAbiItem, toEventSelector, type AbiEvent, type Hex } from "viem";
import { address, hash32 } from "./hex.ts";

const eventText = [
  "event BatchRegistered(bytes32 indexed batchId, address indexed manufacturer, string batchCode, bytes32 metadataHash, string metadataCid, uint64 createdAt)",
  "event CustodyTransferProposed(bytes32 indexed batchId, address indexed from, address indexed to, uint64 proposedAt)",
  "event CustodyTransferCancelled(bytes32 indexed batchId, address indexed from, address indexed to, uint64 cancelledAt)",
  "event CustodyTransferred(bytes32 indexed batchId, address indexed from, address indexed to, uint64 timestamp)",
  "event BatchRecalled(bytes32 indexed batchId, address indexed recalledBy, bool pendingCleared, uint64 recalledAt, string reason)",
] as const;

export const productEvents: AbiEvent[] = eventText.map((signature) => parseAbiItem(signature));

export type ProductEventName =
  | "BatchRegistered"
  | "CustodyTransferProposed"
  | "CustodyTransferCancelled"
  | "CustodyTransferred"
  | "BatchRecalled";

export type BatchRegisteredPayload = {
  batchId: string;
  manufacturer: string;
  batchCode: string;
  metadataHash: string;
  metadataCid: string;
  createdAt: number;
};

export type ProposedPayload = {
  batchId: string;
  from: string;
  to: string;
  proposedAt: number;
};

export type CancelledPayload = {
  batchId: string;
  from: string;
  to: string;
  cancelledAt: number;
};

export type TransferredPayload = {
  batchId: string;
  from: string;
  to: string;
  timestamp: number;
};

export type RecalledPayload = {
  batchId: string;
  recalledBy: string;
  pendingCleared: boolean;
  recalledAt: number;
  reason: string;
};

export type EventPayload =
  | BatchRegisteredPayload
  | ProposedPayload
  | CancelledPayload
  | TransferredPayload
  | RecalledPayload;

export type RawLog = {
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  topics: string[];
  data: string;
  removed?: boolean;
};

export type DecodedLog = {
  blockNumber: number;
  blockHash: string;
  txHash: string;
  logIndex: number;
  eventName: ProductEventName;
  payload: EventPayload;
};

export function eventSignature(item: AbiEvent): string {
  return `${item.name}(${item.inputs.map((input) => input.type).join(",")})`;
}

export function productSignatures(): string[] {
  return productEvents.map((item) => eventSignature(item));
}

export function productTopics(): Hex[] {
  return productSignatures().map((signature) => toEventSelector(signature));
}

export function eventSignaturesFromSource(source: string): string[] {
  const signatures: string[] = [];
  const pattern = /event\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*;/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    if (!name) continue;
    const body = match[2] ?? "";
    const types = body
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => part.split(/\s+/)[0])
      .filter((type): type is string => Boolean(type));
    signatures.push(`${name}(${types.join(",")})`);
  }
  return signatures;
}

export function decodeProductLog(log: RawLog): DecodedLog | "ignore" | "invalid" {
  if (log.removed) return "ignore";
  const topic0 = log.topics[0]?.toLowerCase();
  if (!topic0 || !productTopics().some((topic) => topic.toLowerCase() === topic0)) return "ignore";
  try {
    const decoded = decodeEventLog({
      abi: productEvents,
      data: log.data as Hex,
      topics: log.topics as [Hex, ...Hex[]],
      strict: true,
    });
    const payload = payloadFrom(decoded.eventName, decoded.args as Readonly<Record<string, unknown>>);
    return {
      blockNumber: log.blockNumber,
      blockHash: hash32(log.blockHash),
      txHash: hash32(log.transactionHash),
      logIndex: log.logIndex,
      eventName: decoded.eventName as ProductEventName,
      payload,
    };
  } catch {
    return "invalid";
  }
}

function payloadFrom(eventName: string, args: Readonly<Record<string, unknown>>): EventPayload {
  if (eventName === "BatchRegistered") {
    return {
      batchId: hash32(text(args.batchId)),
      manufacturer: address(text(args.manufacturer)),
      batchCode: text(args.batchCode),
      metadataHash: hash32(text(args.metadataHash)),
      metadataCid: text(args.metadataCid),
      createdAt: unix(args.createdAt),
    };
  }
  if (eventName === "CustodyTransferProposed") {
    return {
      batchId: hash32(text(args.batchId)),
      from: address(text(args.from)),
      to: address(text(args.to)),
      proposedAt: unix(args.proposedAt),
    };
  }
  if (eventName === "CustodyTransferCancelled") {
    return {
      batchId: hash32(text(args.batchId)),
      from: address(text(args.from)),
      to: address(text(args.to)),
      cancelledAt: unix(args.cancelledAt),
    };
  }
  if (eventName === "CustodyTransferred") {
    return {
      batchId: hash32(text(args.batchId)),
      from: address(text(args.from)),
      to: address(text(args.to)),
      timestamp: unix(args.timestamp),
    };
  }
  if (eventName === "BatchRecalled") {
    if (typeof args.pendingCleared !== "boolean") throw new Error("pendingCleared must be boolean");
    return {
      batchId: hash32(text(args.batchId)),
      recalledBy: address(text(args.recalledBy)),
      pendingCleared: args.pendingCleared,
      recalledAt: unix(args.recalledAt),
      reason: text(args.reason),
    };
  }
  throw new Error(`Unknown event ${eventName}`);
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("expected string");
  return value;
}

function unix(value: unknown): number {
  const seconds = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error("expected unix seconds");
  return seconds;
}
