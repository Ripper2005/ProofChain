import { LOCAL_CHAIN_ID, listedReaders, type DeploymentList } from "./deployments.ts";
import { parseChainId } from "./format.ts";

export const LOCAL_NODE = "http://127.0.0.1:8545";
export const LOCAL_GATEWAY = "http://127.0.0.1:8080";
export const PUBLIC_GATEWAY = "https://gateway.pinata.cloud";

export const USAGE = "Usage: pnpm verify-batch <verification-url> [--rpc <url>]... [--gateway <url>]...";

export type CliOptions = { url: string; rpc: string[]; gateways: string[] };

export function parseCliArgs(argv: readonly string[]): { ok: true; options: CliOptions } | { ok: false; error: string } {
  const rpc: string[] = [];
  const gateways: string[] = [];
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--") continue;
    const flag = /^--(rpc|gateway)(?:=(.*))?$/.exec(arg);
    if (flag) {
      const value = flag[2] ?? argv[(index += 1)];
      if (!value || !isHttpUrl(value)) return { ok: false, error: `--${flag[1]} needs an http or https URL` };
      (flag[1] === "rpc" ? rpc : gateways).push(value);
      continue;
    }
    if (arg.startsWith("--")) return { ok: false, error: `Unknown option ${arg}` };
    positional.push(arg);
  }
  if (positional.length !== 1 || !positional[0]) return { ok: false, error: "Pass exactly one verification URL" };
  return { ok: true, options: { url: positional[0], rpc, gateways } };
}

export function parseVerificationUrl(value: string): { chainId: number; contract: string; batchCode: string } | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const match = /^\/verify\/([^/]+)\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return null;
  let parts: string[];
  try {
    parts = [match[1]!, match[2]!, match[3]!].map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  const chainId = parseChainId(parts[0]!);
  if (chainId === null) return null;
  return { chainId, contract: parts[1]!, batchCode: parts[2]! };
}

export function cliReaders(list: DeploymentList, chainId: number, rpc: readonly string[]): string[] {
  if (rpc.length > 0) return [...rpc];
  const listed = listedReaders(list, chainId);
  if (listed.length > 0) return listed;
  return chainId === LOCAL_CHAIN_ID ? [LOCAL_NODE] : [];
}

export function cliGateways(chainId: number, gateways: readonly string[]): string[] {
  if (gateways.length > 0) return [...gateways];
  return [chainId === LOCAL_CHAIN_ID ? LOCAL_GATEWAY : PUBLIC_GATEWAY];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
