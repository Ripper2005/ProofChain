import { encodeAbiParameters, encodeEventTopics, keccak256, toBytes } from "viem";
import type { SyncConfig } from "../src/config.ts";
import { productEvents, type ProductEventName, type RawLog } from "../src/events.ts";
import { FakeChain, txWord } from "./fake-chain.ts";

export const manufacturer = `0x${"11".repeat(20)}`;
export const accountB = `0x${"22".repeat(20)}`;
export const accountC = `0x${"33".repeat(20)}`;
export const recaller = `0x${"44".repeat(20)}`;
export const contractAddress = `0x${"ab".repeat(20)}`;
export const metadataHash = "0xd318be071fd3161c69b2f2eb4ff0a4d1ba56e1657a6ca854291454927994a752";
export const metadataCid = "bafytestcid";
export const batchCode = "PCB-2026-001";
export const batchId = keccak256(toBytes(batchCode));
export const GOLDEN_BATCH_ID = "0x9d6be2557c721891700c118158cc27ec51fd21cd40d2b73a7670b7e1466936d2";

export const CREATED = "2026-10-29T12:00:00.000Z";
export const PROPOSED = "2026-10-29T12:05:00.000Z";
export const CANCELLED = "2026-10-29T12:06:00.000Z";
export const ACCEPTED = "2026-10-29T12:10:00.000Z";
export const PROPOSED_AGAIN = "2026-10-29T12:15:00.000Z";
export const RECALLED = "2026-10-29T12:20:00.000Z";

export function testConfig(overrides: Partial<SyncConfig> = {}): SyncConfig {
  return {
    chainId: 31337,
    contractAddress,
    startBlock: 0,
    confirmations: 0,
    ...overrides,
  };
}

export function unix(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

export function addProductLog(
  chain: FakeChain,
  tx: number,
  blockNumber: number,
  logIndex: number,
  eventName: ProductEventName,
  args: Record<string, unknown>,
): string {
  const txHash = txWord(tx);
  chain.logs.push(
    encodedLog({
      eventName,
      args,
      blockNumber,
      blockHash: chain.hashOf(blockNumber),
      txHash,
      logIndex,
    }),
  );
  return txHash;
}

export function encodedLog(input: {
  eventName: ProductEventName;
  args: Record<string, unknown>;
  blockNumber: number;
  blockHash: string;
  txHash: string;
  logIndex: number;
}): RawLog {
  const event = productEvents.find((item) => item.name === input.eventName);
  if (!event?.name) throw new Error(`Missing ${input.eventName}`);
  const topics = encodeEventTopics({
    abi: [event],
    eventName: event.name,
    args: input.args,
  }).map((topic) => {
    if (typeof topic !== "string") throw new Error("expected one indexed topic");
    return topic;
  });
  const nonIndexed = event.inputs.filter((item) => !item.indexed);
  const data =
    nonIndexed.length === 0
      ? "0x"
      : encodeAbiParameters(
          nonIndexed,
          nonIndexed.map((item) => abiValue(item.type, input.args[item.name ?? ""])),
        );
  return {
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    transactionHash: input.txHash,
    logIndex: input.logIndex,
    topics,
    data,
  };
}

function abiValue(type: string, value: unknown): unknown {
  if (type.startsWith("uint") || type.startsWith("int")) return BigInt(value as number | bigint);
  return value;
}
