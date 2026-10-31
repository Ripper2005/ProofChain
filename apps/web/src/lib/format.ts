import { getAddress, isAddress, type Address } from "viem";

export { formatUnix, parseChainId } from "@proofchain/verifier";

export function checksum(value: string): string {
  if (!isAddress(value)) return value;
  return getAddress(value);
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
