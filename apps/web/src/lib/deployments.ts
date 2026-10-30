import { getAddress, isAddress, type Address } from "viem";
import rawFile from "../../trusted-deployments.json" with { type: "json" };

export type Deployment = {
  chainId: number;
  address: Address;
  startBlock: bigint;
  label: string;
  current: boolean;
  rpcUrl: string;
};

type DeploymentFile = {
  deployments: Array<{
    chainId: number;
    address: string;
    startBlock: number;
    label: string;
    current: boolean;
    rpcUrl: string;
  }>;
};

export function deployments(): Deployment[] {
  const file = rawFile as DeploymentFile;
  const out: Deployment[] = [];
  for (const item of file.deployments) {
    if (!Number.isSafeInteger(item.chainId) || item.chainId < 0) continue;
    if (typeof item.address !== "string" || !isAddress(item.address)) continue;
    if (!Number.isSafeInteger(item.startBlock) || item.startBlock < 0) continue;
    out.push({
      chainId: item.chainId,
      address: getAddress(item.address),
      startBlock: BigInt(item.startBlock),
      label: typeof item.label === "string" && item.label.length > 0 ? item.label : "deployment",
      current: item.current === true,
      rpcUrl: typeof item.rpcUrl === "string" ? item.rpcUrl.trim() : "",
    });
  }
  return out;
}

export function currentListedDeployment(): Deployment | null {
  return deployments().find((item) => item.current) ?? null;
}

export function currentDeployment(): Deployment | null {
  return currentListedDeployment() ?? envFallback();
}

export function findDeployment(chainId: number, address: string): Deployment | null {
  if (!isAddress(address)) return null;
  const checksummed = getAddress(address);
  return deployments().find((item) => item.chainId === chainId && item.address === checksummed) ?? null;
}

export function readerUrl(chainId: number, contractAddress: string): string | null {
  if (!isAddress(contractAddress)) return null;
  const matched = findDeployment(chainId, contractAddress);
  if (matched?.rpcUrl) return matched.rpcUrl;
  if (import.meta.env.DEV) return new URL("/rpc", window.location.origin).href;
  if (!matched) {
    const donor = deployments().find((item) => item.chainId === chainId && item.rpcUrl.length > 0);
    if (donor) return donor.rpcUrl;
  }
  return null;
}

export function envContractAddress(): Address | null {
  const value = import.meta.env.VITE_CONTRACT_ADDRESS?.trim() ?? "";
  if (!value || !isAddress(value)) return null;
  return getAddress(value);
}

function envFallback(): Deployment | null {
  const address = envContractAddress();
  if (!address) return null;
  return {
    chainId: 31337,
    address,
    startBlock: 0n,
    label: "VITE_CONTRACT_ADDRESS",
    current: true,
    rpcUrl: "",
  };
}
