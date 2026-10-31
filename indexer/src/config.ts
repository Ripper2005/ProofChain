import { address } from "./hex.ts";

export const LOCAL_DATABASE_URL = "postgres://proofchain:proofchain@127.0.0.1:5432/proofchain";
export const LOCAL_CHAIN_RPC_URL = "http://127.0.0.1:8545";
export const LOCAL_IPFS_API_URL = "http://127.0.0.1:5001";
export const LOCAL_WEB_ORIGIN = "http://localhost:5173";
export const LOCAL_PIN_URL = "http://127.0.0.1:8788";
export const SEPOLIA_CHAIN_ID = 11155111;
export const DEFAULT_REORG_WINDOW = 64;
export const DEFAULT_LOG_RANGE = 50_000;

export type IndexerConfig = {
  databaseUrl: string;
  chainRpcUrl: string;
  chainId: number;
  contractAddress: string;
  startBlock: number;
  confirmations: number;
  reorgWindow: number;
  logRange: number;
  ipfsApiUrl: string;
  port: number;
  host: string;
  webOrigin: string;
  pinUrl: string;
  pollIntervalMs: number;
};

export function loadConfig(env: Record<string, string | undefined>): IndexerConfig {
  if (env.CONTRACT_ADDRESS == null || env.CONTRACT_ADDRESS === "") {
    throw new Error("CONTRACT_ADDRESS is required");
  }
  if (env.START_BLOCK == null || env.START_BLOCK === "") {
    throw new Error("START_BLOCK is required");
  }

  const chainId = optionalInteger(env.CHAIN_ID, "CHAIN_ID") ?? 31337;
  const confirmations =
    optionalInteger(env.CONFIRMATIONS, "CONFIRMATIONS") ?? (chainId === SEPOLIA_CHAIN_ID ? 2 : 0);

  return {
    databaseUrl: env.DATABASE_URL || LOCAL_DATABASE_URL,
    chainRpcUrl: env.CHAIN_RPC_URL || LOCAL_CHAIN_RPC_URL,
    chainId,
    contractAddress: address(env.CONTRACT_ADDRESS),
    startBlock: integer("START_BLOCK", env.START_BLOCK),
    confirmations,
    reorgWindow: optionalPositive(env.REORG_WINDOW, "REORG_WINDOW") ?? DEFAULT_REORG_WINDOW,
    logRange: optionalPositive(env.LOG_RANGE, "LOG_RANGE") ?? DEFAULT_LOG_RANGE,
    ipfsApiUrl: env.IPFS_API_URL || LOCAL_IPFS_API_URL,
    port: optionalInteger(env.INDEXER_PORT, "INDEXER_PORT") ?? 8787,
    host: env.INDEXER_HOST || "127.0.0.1",
    webOrigin: env.WEB_ORIGIN || LOCAL_WEB_ORIGIN,
    pinUrl: env.PIN_URL || LOCAL_PIN_URL,
    pollIntervalMs: optionalInteger(env.POLL_INTERVAL_MS, "POLL_INTERVAL_MS") ?? 2000,
  };
}

export function syncConfigOf(config: IndexerConfig): SyncConfig {
  return {
    chainId: config.chainId,
    contractAddress: config.contractAddress,
    startBlock: config.startBlock,
    confirmations: config.confirmations,
    reorgWindow: config.reorgWindow,
    logRange: config.logRange,
  };
}

export type SyncConfig = {
  chainId: number;
  contractAddress: string;
  startBlock: number;
  confirmations: number;
  reorgWindow: number;
  logRange: number;
};

function optionalInteger(value: string | undefined, name: string): number | undefined {
  if (value == null || value === "") return undefined;
  return integer(name, value);
}

function optionalPositive(value: string | undefined, name: string): number | undefined {
  const parsed = optionalInteger(value, name);
  if (parsed === 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function integer(name: string, value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}
