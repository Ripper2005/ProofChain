import { computeBatchId, validateBatchCode, type ProductMetadata } from "@proofchain/metadata";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  http,
  keccak256,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { productRegistryAbi } from "../contracts/ProductRegistry.ts";
import { currentListedDeployment, findDeployment, readerUrl, type Deployment } from "./deployments.ts";
import { fetchIpfsBytes, judgeDocument } from "./document.ts";
import { contractErrorText } from "./errors.ts";
import { READER_FAILURE } from "./failures.ts";
import { asAddress, asBigint, castGetBatch } from "./format.ts";
import { LogsUnavailable, readLogsInChunks } from "./logRange.ts";
import { decodeProductLogs, historyDisagrees, logsForBatch, type ProductLog } from "./logs.ts";
import { DEFAULT_ADMIN_ROLE, MANUFACTURER_ROLE, RECALL_ROLE } from "./roles.ts";

export type Trust =
  | { kind: "current"; label: string }
  | { kind: "earlier"; label: string; current: Deployment | null }
  | { kind: "unrecognized" };

export type HandoffView = {
  from: Address;
  to: Address;
  timestamp: bigint;
  txHash: Hex | null;
};

export type VerifyResult =
  | { kind: "cannot-read"; chainId: number }
  | { kind: "rpc-error"; message: string }
  | { kind: "invalid-code"; batchCode: string }
  | {
      kind: "absent";
      trust: Trust;
      errorText: string;
      cast: string;
      batchId: Hex;
      chainId: number;
      contract: Address;
    }
  | {
      kind: "present";
      trust: Trust;
      chainId: number;
      contract: Address;
      batchId: Hex;
      batchCode: string;
      manufacturer: Address;
      currentCustodian: Address;
      metadataHash: Hex;
      metadataCid: string;
      status: "active" | "recalled" | "none";
      createdAt: bigint;
      pending: { from: Address; to: Address; proposedAt: bigint; txHash: Hex | null } | null;
      history: HandoffView[];
      logsUnavailable: boolean;
      historyDisagrees: boolean;
      manufacturerRole: boolean | null;
      registrationTx: Hex | null;
      recall: { reason: string; txHash: Hex | null; pendingCleared: boolean; recalledBy: Address } | null;
      verdict: "match" | "mismatch" | "unavailable";
      mismatchReason: string | null;
      document: ProductMetadata | null;
      fetchedHash: Hex | null;
      cast: string;
    };

export function describeTrust(chainId: number, contract: Address): Trust {
  const matched = findDeployment(chainId, contract);
  if (!matched) return { kind: "unrecognized" };
  if (matched.current) return { kind: "current", label: matched.label };
  return { kind: "earlier", label: matched.label, current: currentListedDeployment() };
}

type ReaderClient = {
  getChainId(): Promise<number>;
  readContract(parameters: {
    address: Address;
    abi: typeof productRegistryAbi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
  getBlockNumber(): Promise<bigint>;
  getLogs(parameters: { address: Address; fromBlock: bigint; toBlock: bigint }): Promise<Log[]>;
};

export async function loadVerification(
  chainId: number,
  contract: Address,
  batchCode: string,
  io?: {
    endpoint?: string | null;
    client?: ReaderClient;
    fetchBytes?: (cid: string) => Promise<Uint8Array | null>;
  },
): Promise<VerifyResult> {
  const trust = describeTrust(chainId, contract);
  if (!validateBatchCode(batchCode)) return { kind: "invalid-code", batchCode };
  const batchId = computeBatchId(batchCode);
  const endpoint = io && "endpoint" in io ? (io.endpoint ?? null) : readerUrl(chainId, contract);
  if (!endpoint) return { kind: "cannot-read", chainId };

  const client: ReaderClient =
    io?.client ??
    (createPublicClient({
      transport: http(endpoint, { batch: false, timeout: 20_000 }),
    }) as unknown as ReaderClient);
  let reported: number;
  try {
    reported = await client.getChainId();
  } catch {
    return { kind: "rpc-error", message: READER_FAILURE };
  }
  if (reported !== chainId) return { kind: "cannot-read", chainId };

  const cast = castGetBatch(contract, batchId);
  let rawBatch: BatchStruct;
  try {
    rawBatch = (await client.readContract({
      address: contract,
      abi: productRegistryAbi,
      functionName: "getBatch",
      args: [batchId],
    })) as BatchStruct;
  } catch (error) {
    if (isTransportFailure(error)) {
      return { kind: "rpc-error", message: READER_FAILURE };
    }
    return { kind: "absent", trust, errorText: contractErrorText(error), cast, batchId, chainId, contract };
  }

  const deployment = findDeployment(chainId, contract);
  const startBlock = deployment?.startBlock ?? 0n;
  const [pendingResult, historyResult, roleResult, logResult, bytes] = await Promise.all([
    readOptional(
      () =>
        client.readContract({
          address: contract,
          abi: productRegistryAbi,
          functionName: "getPendingTransfer",
          args: [batchId],
        }) as Promise<PendingStruct>,
    ),
    readOptional(
      () =>
        client.readContract({
          address: contract,
          abi: productRegistryAbi,
          functionName: "getCustodyHistory",
          args: [batchId],
        }) as Promise<HistoryStruct[]>,
    ),
    readOptional(
      () =>
        client.readContract({
          address: contract,
          abi: productRegistryAbi,
          functionName: "hasRole",
          args: [MANUFACTURER_ROLE, rawBatch.manufacturer],
        }) as Promise<boolean>,
    ),
    loadDecodedLogs(client, contract, startBlock),
    (io?.fetchBytes ?? fetchIpfsBytes)(rawBatch.metadataCid),
  ]);

  const historyRows = historyResult.ok ? historyResult.value.map(toHandoff) : [];
  const batchLogs = logResult.ok ? logsForBatch(logResult.value, batchId) : [];
  const logsUnavailable = !logResult.ok;
  const disagrees = logResult.ok && historyResult.ok ? historyDisagrees(historyRows, batchLogs) : false;
  const transferred = batchLogs.filter((log) => log.eventName === "CustodyTransferred");
  const history: HandoffView[] = historyRows.map((row, index) => ({
    from: asAddress(row.from) ?? (row.from as Address),
    to: asAddress(row.to) ?? (row.to as Address),
    timestamp: row.timestamp,
    txHash: !logsUnavailable && !disagrees ? (transferred[index]?.transactionHash ?? null) : null,
  }));

  const pending = pendingResult.ok && pendingResult.value.active ? pendingView(pendingResult.value, batchLogs) : null;
  const registered = batchLogs.find((log) => log.eventName === "BatchRegistered");
  const recalled = [...batchLogs].reverse().find((log) => log.eventName === "BatchRecalled");
  const judgement = bytes ? judgeDocument(bytes, rawBatch.metadataHash, batchCode, batchId) : null;

  return {
    kind: "present",
    trust,
    chainId,
    contract,
    batchId,
    batchCode: rawBatch.batchCode,
    manufacturer: rawBatch.manufacturer,
    currentCustodian: rawBatch.currentCustodian,
    metadataHash: rawBatch.metadataHash,
    metadataCid: rawBatch.metadataCid,
    status: statusName(Number(rawBatch.status)),
    createdAt: asBigint(rawBatch.createdAt) ?? 0n,
    pending,
    history,
    logsUnavailable,
    historyDisagrees: disagrees,
    manufacturerRole: roleResult.ok ? roleResult.value : null,
    registrationTx: logsUnavailable ? null : (registered?.transactionHash ?? null),
    recall: recallView(recalled, logsUnavailable),
    verdict: bytes ? (judgement?.verdict ?? "mismatch") : "unavailable",
    mismatchReason: judgement?.verdict === "mismatch" ? judgement.reason : null,
    document: judgement?.document ?? null,
      fetchedHash: bytes ? keccak256(bytes) : null,
    cast,
  };
}

export type LoadedBatch = {
  batchCode: string;
  manufacturer: Address;
  currentCustodian: Address;
  status: "active" | "recalled" | "none";
  pending: { from: Address; to: Address; proposedAt: bigint } | null;
};

export async function loadBatch(chainId: number, contract: Address, batchCode: string): Promise<LoadedBatch> {
  if (!validateBatchCode(batchCode)) throw new Error("InvalidBatchCode");
  const endpoint = readerUrl(chainId, contract);
  if (!endpoint) throw new Error(`This site cannot read chain ${chainId}.`);
  const client = createPublicClient({ transport: http(endpoint, { batch: false, timeout: 20_000 }) });
  const reported = await client.getChainId();
  if (reported !== chainId) throw new Error(`This site cannot read chain ${chainId}.`);
  const batchId = computeBatchId(batchCode);
  const batch = await client.readContract({
    address: contract,
    abi: productRegistryAbi,
    functionName: "getBatch",
    args: [batchId],
  });
  const pending = await client.readContract({
    address: contract,
    abi: productRegistryAbi,
    functionName: "getPendingTransfer",
    args: [batchId],
  });
  return {
    batchCode: batch.batchCode,
    manufacturer: batch.manufacturer,
    currentCustodian: batch.currentCustodian,
    status: statusName(Number(batch.status)),
    pending: pending.active
      ? {
          from: pending.from,
          to: pending.to,
          proposedAt: asBigint(pending.proposedAt) ?? 0n,
        }
      : null,
  };
}

export async function readChainHead(chainId: number, contract: Address): Promise<bigint> {
  const endpoint = readerUrl(chainId, contract);
  if (!endpoint) throw new Error(`This site cannot read chain ${chainId}.`);
  const client = createPublicClient({ transport: http(endpoint, { batch: false, timeout: 20_000 }) });
  const reported = await client.getChainId();
  if (reported !== chainId) throw new Error(`This site cannot read chain ${chainId}.`);
  return client.getBlockNumber();
}

export async function readRoles(chainId: number, contract: Address, account: Address): Promise<{
  admin: boolean;
  manufacturer: boolean;
  recall: boolean;
}> {
  const endpoint = readerUrl(chainId, contract);
  if (!endpoint) throw new Error(`This site cannot read chain ${chainId}.`);
  const client = createPublicClient({ transport: http(endpoint, { batch: false, timeout: 20_000 }) });
  const [admin, manufacturer, recall] = await Promise.all([
    client.readContract({
      address: contract,
      abi: productRegistryAbi,
      functionName: "hasRole",
      args: [DEFAULT_ADMIN_ROLE, account],
    }),
    client.readContract({
      address: contract,
      abi: productRegistryAbi,
      functionName: "hasRole",
      args: [MANUFACTURER_ROLE, account],
    }),
    client.readContract({
      address: contract,
      abi: productRegistryAbi,
      functionName: "hasRole",
      args: [RECALL_ROLE, account],
    }),
  ]);
  return { admin, manufacturer, recall };
}

type BatchStruct = {
  batchCode: string;
  manufacturer: Address;
  currentCustodian: Address;
  metadataHash: Hex;
  metadataCid: string;
  status: number;
  createdAt: bigint;
};

type PendingStruct = {
  from: Address;
  to: Address;
  proposedAt: bigint;
  active: boolean;
};

type HistoryStruct = {
  from: Address;
  to: Address;
  timestamp: bigint;
};

async function loadDecodedLogs(client: ReaderClient, contract: Address, startBlock: bigint) {
  try {
    const head = await client.getBlockNumber();
    const logs = await readLogsInChunks(
      (fromBlock, toBlock) => client.getLogs({ address: contract, fromBlock, toBlock }),
      startBlock,
      head,
    );
    return { ok: true as const, value: decodeProductLogs(logs) };
  } catch (error) {
    if (error instanceof LogsUnavailable || isTransportFailure(error)) return { ok: false as const };
    return { ok: false as const };
  }
}

function pendingView(pending: PendingStruct, logs: ProductLog[]) {
  const proposed = [...logs].reverse().find((log) => log.eventName === "CustodyTransferProposed");
  return {
    from: pending.from,
    to: pending.to,
    proposedAt: asBigint(pending.proposedAt) ?? 0n,
    txHash: proposed?.transactionHash ?? null,
  };
}

function recallView(log: ProductLog | undefined, logsUnavailable: boolean) {
  if (logsUnavailable || !log) return null;
  const recalledBy = asAddress(log.args.recalledBy);
  if (!recalledBy) return null;
  return {
    reason: typeof log.args.reason === "string" ? log.args.reason : "",
    txHash: log.transactionHash,
    pendingCleared: log.args.pendingCleared === true,
    recalledBy,
  };
}

function toHandoff(row: HistoryStruct): { from: string; to: string; timestamp: bigint } {
  return { from: row.from, to: row.to, timestamp: asBigint(row.timestamp) ?? 0n };
}

function statusName(status: number): "active" | "recalled" | "none" {
  if (status === 1) return "active";
  if (status === 2) return "recalled";
  return "none";
}

async function readOptional<T>(read: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await read() };
  } catch {
    return { ok: false };
  }
}

function isTransportFailure(error: unknown): boolean {
  if (error instanceof BaseError) {
    const reverted = error.walk((item) => item instanceof ContractFunctionRevertedError);
    if (reverted) return false;
  }
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/reverted|returned no data|execution reverted/i.test(text)) return false;
  return /fetch|HTTP request|network|timeout|ECONNREFUSED|Failed to fetch|headers/i.test(text);
}
