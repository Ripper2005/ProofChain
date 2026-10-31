import {
  classifyTrust,
  findIn,
  parseDeployments,
  parseGatewayList,
  readersFor,
  resolveWriteChain,
  writeTargetIn,
  type Deployment,
  type DeploymentList,
  type Trust,
  type WriteTarget,
} from "@proofchain/verifier";
import rawFile from "../../trusted-deployments.json" with { type: "json" };

export { LOCAL_CHAIN_ID, writeTargetMessage } from "@proofchain/verifier";
export type { Deployment, DeploymentList, Trust, WriteTarget } from "@proofchain/verifier";

type WebEnv = { DEV?: boolean; VITE_WRITE_CHAIN_ID?: string; VITE_IPFS_GATEWAYS?: string };

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

export function readerUrls(chainId: number): string[] {
  return readersFor(trustedDeployments(), chainId, devRpcUrl());
}

export function isSameOriginRpc(url: string): boolean {
  return typeof window !== "undefined" && url === new URL("/rpc", window.location.origin).href;
}

export function ipfsGateways(): string[] {
  const { gateways } = parseGatewayList(viteEnv().VITE_IPFS_GATEWAYS);
  if (gateways.length > 0) return gateways;
  // Only the dev server proxies /ipfs; a static host would answer with index.html and fake a copy mismatch.
  return viteEnv().DEV && typeof window !== "undefined" ? [window.location.origin] : [];
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
  const gateways = parseGatewayList(env.VITE_IPFS_GATEWAYS);
  return [...TRUSTED.errors, ...(write.error ? [write.error] : []), ...gateways.errors];
}

function viteEnv(): WebEnv {
  return (import.meta.env as WebEnv | undefined) ?? {};
}

function devRpcUrl(): string | null {
  return viteEnv().DEV ? new URL("/rpc", window.location.origin).href : null;
}
