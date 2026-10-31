import { getAddress, isAddress, type Address } from "viem";
import rawFile from "../../trusted-deployments.json" with { type: "json" };
import { parseChainId } from "./format.ts";

export const LOCAL_CHAIN_ID = 31337;

export type Deployment = {
  chainId: number;
  address: Address;
  startBlock: bigint;
  label: string;
  current: boolean;
  rpcUrls: string[];
};

export type DeploymentList = {
  deployments: Deployment[];
  errors: string[];
};

export type Trust =
  | { kind: "current"; label: string }
  | { kind: "earlier"; label: string; current: Deployment | null }
  | { kind: "unrecognized" };

export type WriteTarget =
  | { kind: "ready"; deployment: Deployment }
  | { kind: "not-configured" }
  | { kind: "no-deployment"; chainId: number };

type WebEnv = { DEV?: boolean; VITE_WRITE_CHAIN_ID?: string };

export function parseDeployments(file: unknown): DeploymentList {
  const items = isRecord(file) && Array.isArray(file.deployments) ? file.deployments : [];
  const deployments: Deployment[] = [];
  const errors: string[] = [];
  items.forEach((item, index) => {
    const parsed = parseEntry(item);
    if (parsed) deployments.push(parsed);
    else errors.push(`Entry ${index + 1} in trusted-deployments.json is not a valid deployment and is ignored.`);
  });
  for (const chainId of new Set(deployments.map((item) => item.chainId))) {
    const marked = deployments.filter((item) => item.chainId === chainId && item.current).length;
    if (marked > 1) {
      errors.push(
        `trusted-deployments.json marks ${marked} deployments current on chain ${chainId}. At most one deployment per chain may be current.`,
      );
    }
  }
  return { deployments, errors };
}

export function currentOn(list: DeploymentList, chainId: number): Deployment | null {
  const marked = list.deployments.filter((item) => item.chainId === chainId && item.current);
  return marked.length === 1 ? (marked[0] ?? null) : null;
}

export function findIn(list: DeploymentList, chainId: number, address: string): Deployment | null {
  if (!isAddress(address, { strict: false })) return null;
  const wanted = address.toLowerCase();
  return list.deployments.find((item) => item.chainId === chainId && item.address.toLowerCase() === wanted) ?? null;
}

export function classifyTrust(list: DeploymentList, chainId: number, address: string): Trust {
  const matched = findIn(list, chainId, address);
  if (!matched) return { kind: "unrecognized" };
  const current = currentOn(list, chainId);
  if (current?.address === matched.address) return { kind: "current", label: matched.label };
  return { kind: "earlier", label: matched.label, current };
}

export function listedReaders(list: DeploymentList, chainId: number): string[] {
  const current = currentOn(list, chainId);
  const onChain = list.deployments.filter((item) => item.chainId === chainId);
  const ordered = current ? [current, ...onChain.filter((item) => item !== current)] : onChain;
  return ordered.find((item) => item.rpcUrls.length > 0)?.rpcUrls ?? [];
}

export function selectReader(list: DeploymentList, chainId: number, sameOriginRpc: string | null): string | null {
  return listedReaders(list, chainId)[0] ?? sameOriginRpc;
}

export function resolveWriteChain(
  raw: string | undefined,
  dev: boolean,
): { chainId: number | null; error: string | null } {
  const value = raw?.trim() ?? "";
  if (!value) return { chainId: dev ? LOCAL_CHAIN_ID : null, error: null };
  const chainId = parseChainId(value);
  if (chainId === null) {
    return { chainId: null, error: `VITE_WRITE_CHAIN_ID is "${value}", which is not a decimal chain id. Writing is off.` };
  }
  return { chainId, error: null };
}

export function writeTargetIn(list: DeploymentList, chainId: number | null): WriteTarget {
  if (chainId === null) return { kind: "not-configured" };
  const deployment = currentOn(list, chainId);
  return deployment ? { kind: "ready", deployment } : { kind: "no-deployment", chainId };
}

export function writeTargetMessage(target: WriteTarget): string | null {
  if (target.kind === "not-configured") return "Writing is not configured on this site. Verification still works.";
  if (target.kind === "no-deployment") {
    return `trusted-deployments.json has no single current deployment on chain ${target.chainId}, so this site cannot write. Verification still works.`;
  }
  return null;
}

const TRUSTED = parseDeployments(rawFile);

export function trustedDeployments(): DeploymentList {
  return TRUSTED;
}

export function findDeployment(chainId: number, address: string): Deployment | null {
  return findIn(trustedDeployments(), chainId, address);
}

export function describeTrust(chainId: number, address: string): Trust {
  return classifyTrust(trustedDeployments(), chainId, address);
}

export function readerUrl(chainId: number): string | null {
  return selectReader(trustedDeployments(), chainId, devRpcUrl());
}

export function writeTarget(): WriteTarget {
  const env = viteEnv();
  return writeTargetIn(trustedDeployments(), resolveWriteChain(env.VITE_WRITE_CHAIN_ID, env.DEV === true).chainId);
}

export function writeDeployment(): Deployment | null {
  const target = writeTarget();
  return target.kind === "ready" ? target.deployment : null;
}

export function configurationErrors(): string[] {
  const env = viteEnv();
  const write = resolveWriteChain(env.VITE_WRITE_CHAIN_ID, env.DEV === true);
  return write.error ? [...TRUSTED.errors, write.error] : TRUSTED.errors;
}

function viteEnv(): WebEnv {
  return (import.meta.env as WebEnv | undefined) ?? {};
}

function devRpcUrl(): string | null {
  return viteEnv().DEV ? new URL("/rpc", window.location.origin).href : null;
}

function parseEntry(item: unknown): Deployment | null {
  if (!isRecord(item)) return null;
  const { chainId, address, startBlock, label, current, rpcUrls } = item;
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId < 0) return null;
  if (typeof address !== "string" || !isAddress(address, { strict: false })) return null;
  if (typeof startBlock !== "number" || !Number.isSafeInteger(startBlock) || startBlock < 0) return null;
  if (!Array.isArray(rpcUrls) || !rpcUrls.every(isHttpUrl)) return null;
  return {
    chainId,
    address: getAddress(address.toLowerCase()),
    startBlock: BigInt(startBlock),
    label: typeof label === "string" && label.length > 0 ? label : "deployment",
    current: current === true,
    rpcUrls: rpcUrls.map((url: string) => url.trim()),
  };
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
