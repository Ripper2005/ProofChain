import { getAddress, isAddress, type Address, type Hex } from "viem";

export function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function asAddress(value: unknown): Address | null {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) return null;
  return getAddress(value.toLowerCase());
}

export function asBigint(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  return null;
}

export function formatUnix(seconds: bigint): string {
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return seconds.toString();
  return date.toISOString();
}

export function castGetBatch(address: Address, batchId: Hex): string {
  return `cast call ${address} "getBatch(bytes32)((string,address,address,bytes32,string,uint8,uint64))" ${batchId} --rpc-url <YOUR_NODE_URL>`;
}

export function parseChainId(value: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return null;
  return parsed;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
