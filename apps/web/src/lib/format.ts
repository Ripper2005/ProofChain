import { getAddress, isAddress, type Address, type Hex } from "viem";

export function checksum(value: string): string {
  if (!isAddress(value)) return value;
  return getAddress(value);
}

export function formatUnix(seconds: bigint): string {
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return seconds.toString();
  return date.toISOString();
}

export function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function asAddress(value: unknown): Address | null {
  if (typeof value !== "string" || !isAddress(value)) return null;
  return getAddress(value);
}

export function asHex(value: unknown): Hex | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) return null;
  return value as Hex;
}

export function asBigint(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  return null;
}

export function originIsLoopback(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function parseOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  return url.origin;
}

export function verificationUrl(origin: string, chainId: number, address: Address, batchCode: string): string {
  return `${origin}/verify/${chainId}/${address}/${encodeURIComponent(batchCode)}`;
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
