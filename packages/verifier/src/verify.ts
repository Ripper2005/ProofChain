import { computeBatchId, validateBatchCode } from "@proofchain/metadata";
import { decodeFunctionResult, getAddress, isAddress, type Address, type Hex } from "viem";
import { productRegistryAbi } from "./abi.ts";
import { emptyAgreement, readAgreement, type Agreement, type ReaderReport, type Snapshot } from "./agreement.ts";
import { classifyTrust, findIn, type DeploymentList, type Trust } from "./deployments.ts";
import {
  documentReport,
  fetchIpfsCopy,
  judgeDocument,
  type DocumentReport,
  type OnChainDocument,
} from "./document.ts";
import { revertText } from "./errors.ts";
import { asAddress, castGetBatch, sameHex } from "./format.ts";
import { DEFAULT_LOG_SPAN, historyDisagrees, loadBatchLogs, type ProductLog } from "./logs.ts";
import { httpReader, type FetchLike, type Reader } from "./rpc.ts";
import {
  timelineFromContract,
  timelineFromLogs,
  type AcceptedHandoff,
  type PendingHandoff,
  type TimelineStep,
} from "./timeline.ts";

export type VerifyInput = {
  chainId: number;
  contract: string;
  batchCode: string;
  deployments: DeploymentList;
  readers: ReadonlyArray<string | Reader>;
  gateways: readonly string[];
  fetch: FetchLike;
  readerTimeoutMs?: number;
  gatewayTimeoutMs?: number;
  initialLogSpan?: bigint;
};

export type BatchStatus = "active" | "recalled" | "none";

export type BatchRecord = {
  batchCode: string;
  manufacturer: Address;
  currentCustodian: Address;
  metadataHash: Hex;
  metadataCid: string;
  status: BatchStatus;
  createdAt: bigint;
};

export type RecallRecord = {
  recalledBy: Address | null;
  reason: string;
  pendingCleared: boolean;
  time: bigint | null;
  txHash: Hex | null;
  blockNumber: bigint | null;
};

export type RegisteredOutcome = {
  kind: "registered";
  batch: BatchRecord;
  manufacturerRole: boolean | null;
  pending: PendingHandoff | null;
  history: AcceptedHandoff[];
  historyReadable: boolean;
  historyDisagrees: boolean;
  logs: { status: "loaded"; reader: string; count: number } | { status: "unavailable"; failures: string[] };
  registration: { txHash: Hex | null; blockNumber: bigint | null } | null;
  recall: RecallRecord | null;
  timeline: TimelineStep[];
  document: DocumentReport;
};

export type Outcome =
  | { kind: "invalid-address" }
  | { kind: "invalid-code" }
  | { kind: "no-reader" }
  | { kind: "cannot-read" }
  | { kind: "unreachable" }
  | { kind: "not-registered"; errorText: string }
  | RegisteredOutcome;

export type SealConditions = {
  trusted: boolean;
  documentMatch: boolean;
  copyNotMismatch: boolean;
  agreement: boolean;
  green: boolean;
};

export type VerificationResult = {
  chainId: number;
  contract: string;
  batchCode: string;
  batchId: Hex | null;
  trust: Trust;
  cast: string | null;
  readers: ReaderReport[];
  agreement: Agreement;
  outcome: Outcome;
  seal: SealConditions;
};

export const SEAL_RULE =
  "The green seal requires a recognized deployment, a document match, an IPFS copy that is not a mismatch, and reader agreement. It covers the document and the agreement. Recall status is separate.";

export function sealFor(input: {
  trust: Trust;
  agreement: Agreement;
  outcome: Outcome;
}): SealConditions {
  const registered = input.outcome.kind === "registered" ? input.outcome : null;
  const trusted = input.trust.kind !== "unrecognized";
  const documentMatch = registered?.document.verdict === "match";
  const copyNotMismatch = registered ? registered.document.ipfs.status !== "mismatch" : false;
  const agreement = input.agreement.holds;
  return {
    trusted,
    documentMatch,
    copyNotMismatch,
    agreement,
    green: trusted && documentMatch && copyNotMismatch && agreement,
  };
}

export async function verifyBatch(input: VerifyInput): Promise<VerificationResult> {
  const trust = classifyTrust(input.deployments, input.chainId, input.contract);
  const base = {
    chainId: input.chainId,
    contract: input.contract,
    batchCode: input.batchCode,
    batchId: null as Hex | null,
    trust,
    cast: null as string | null,
    readers: [] as ReaderReport[],
    agreement: emptyAgreement(input.readers.length),
  };
  const finish = (fields: typeof base, outcome: Outcome): VerificationResult => ({
    ...fields,
    outcome,
    seal: sealFor({ trust: fields.trust, agreement: fields.agreement, outcome }),
  });

  if (!isAddress(input.contract, { strict: false })) return finish(base, { kind: "invalid-address" });
  const contract = getAddress(input.contract.toLowerCase());
  if (!validateBatchCode(input.batchCode)) return finish({ ...base, contract }, { kind: "invalid-code" });
  const batchId = computeBatchId(input.batchCode);
  const known = { ...base, contract, batchId, cast: castGetBatch(contract, batchId) };

  const send = input.fetch;
  const readers = input.readers.map((reader) =>
    typeof reader === "string" ? httpReader(reader, { fetch: send, timeoutMs: input.readerTimeoutMs }) : reader,
  );
  if (readers.length === 0) return finish(known, { kind: "no-reader" });

  const read = await readAgreement(readers, { chainId: input.chainId, contract, batchId });
  const withReaders = { ...known, readers: read.reports, agreement: read.agreement };
  if (!read.record || read.agreement.anchor === null) {
    const unreachable = read.reports.some((report) => report.status === "unreachable");
    return finish(withReaders, { kind: unreachable ? "unreachable" : "cannot-read" });
  }

  const decoded = decodeRecord(read.record);
  if (decoded.kind === "not-registered") return finish(withReaders, decoded);

  const { batch } = decoded;
  const fromBlock = findIn(input.deployments, input.chainId, contract)?.startBlock ?? 0n;
  const [logLoad, ipfs] = await Promise.all([
    loadBatchLogs(
      read.recordReaders,
      { contract, batchId, fromBlock, toBlock: read.agreement.anchor },
      input.initialLogSpan ?? DEFAULT_LOG_SPAN,
    ),
    fetchIpfsCopy({
      cid: batch.metadataCid,
      metadataHash: batch.metadataHash,
      gateways: input.gateways,
      fetch: send,
      timeoutMs: input.gatewayTimeoutMs,
    }),
  ]);

  const logs = logLoad.ok ? logLoad.logs : null;
  const historyRows = decoded.history ?? [];
  const disagrees = logs !== null && decoded.history !== null ? historyDisagrees(historyRows, logs) : false;
  const transferred = logs?.filter((log) => log.eventName === "CustodyTransferred") ?? [];
  const history: AcceptedHandoff[] = historyRows.map((row, index) => {
    const log = logs && !disagrees ? transferred[index] : undefined;
    return { ...row, txHash: log?.transactionHash ?? null, blockNumber: log?.blockNumber ?? null };
  });
  const pending = decoded.pending ? pendingView(decoded.pending, logs) : null;
  const registered = logs?.find((log) => log.eventName === "BatchRegistered") ?? null;
  const recalledLog = logs ? ([...logs].reverse().find((log) => log.eventName === "BatchRecalled") ?? null) : null;

  const onChain: OnChainDocument = !logs
    ? { status: "unavailable", reason: "the logs could not be loaded from any agreeing reader" }
    : !registered?.document
      ? { status: "unavailable", reason: "the logs hold no BatchRegistered event for this batch" }
      : {
          status: "read",
          judgement: judgeDocument(registered.document, batch.metadataHash, input.batchCode, batchId),
          txHash: registered.transactionHash,
          blockNumber: registered.blockNumber,
        };

  const outcome: RegisteredOutcome = {
    kind: "registered",
    batch,
    manufacturerRole: decoded.manufacturerRole,
    pending,
    history,
    historyReadable: decoded.history !== null,
    historyDisagrees: disagrees,
    logs: logLoad.ok
      ? { status: "loaded", reader: logLoad.reader, count: logLoad.logs.length }
      : { status: "unavailable", failures: logLoad.failures },
    registration: registered ? { txHash: registered.transactionHash, blockNumber: registered.blockNumber } : null,
    recall: recallView(recalledLog),
    timeline: logs
      ? timelineFromLogs(logs, pending)
      : timelineFromContract({
          manufacturer: batch.manufacturer,
          createdAt: batch.createdAt,
          history,
          recalled: batch.status === "recalled",
          pending,
        }),
    document: documentReport({ onChain, ipfs, metadataHash: batch.metadataHash, batchCode: input.batchCode, batchId }),
  };
  return finish(withReaders, outcome);
}

type DecodedRecord =
  | { kind: "not-registered"; errorText: string }
  | {
      kind: "registered";
      batch: BatchRecord;
      pending: { from: Address; to: Address; proposedAt: bigint } | null;
      history: Array<{ from: Address; to: Address; timestamp: bigint }> | null;
      manufacturerRole: boolean | null;
    };

function decodeRecord(snapshot: Snapshot): DecodedRecord {
  if (snapshot.getBatch.kind === "revert") {
    return { kind: "not-registered", errorText: revertText(snapshot.getBatch.data) };
  }
  let raw;
  try {
    raw = decodeFunctionResult({ abi: productRegistryAbi, functionName: "getBatch", data: snapshot.getBatch.data });
  } catch {
    return {
      kind: "not-registered",
      errorText: `getBatch returned ${snapshot.getBatch.data === "0x" ? "no data" : "data that is not a batch"}. There may be no ProductRegistry at this address on this chain.`,
    };
  }
  const batch: BatchRecord = {
    batchCode: raw.batchCode,
    manufacturer: raw.manufacturer,
    currentCustodian: raw.currentCustodian,
    metadataHash: raw.metadataHash,
    metadataCid: raw.metadataCid,
    status: raw.status === 1 ? "active" : raw.status === 2 ? "recalled" : "none",
    createdAt: raw.createdAt,
  };
  return {
    kind: "registered",
    batch,
    pending: decodePending(snapshot),
    history: decodeHistory(snapshot),
    manufacturerRole: decodeRole(snapshot),
  };
}

function decodePending(snapshot: Snapshot): { from: Address; to: Address; proposedAt: bigint } | null {
  if (snapshot.getPendingTransfer.kind !== "ok") return null;
  try {
    const pending = decodeFunctionResult({
      abi: productRegistryAbi,
      functionName: "getPendingTransfer",
      data: snapshot.getPendingTransfer.data,
    });
    return pending.active ? { from: pending.from, to: pending.to, proposedAt: pending.proposedAt } : null;
  } catch {
    return null;
  }
}

function decodeHistory(snapshot: Snapshot): Array<{ from: Address; to: Address; timestamp: bigint }> | null {
  if (snapshot.getCustodyHistory.kind !== "ok") return null;
  try {
    return decodeFunctionResult({
      abi: productRegistryAbi,
      functionName: "getCustodyHistory",
      data: snapshot.getCustodyHistory.data,
    }).map((row) => ({ from: row.from, to: row.to, timestamp: row.timestamp }));
  } catch {
    return null;
  }
}

function decodeRole(snapshot: Snapshot): boolean | null {
  if (!snapshot.hasRole || snapshot.hasRole.kind !== "ok") return null;
  try {
    return decodeFunctionResult({ abi: productRegistryAbi, functionName: "hasRole", data: snapshot.hasRole.data });
  } catch {
    return null;
  }
}

function pendingView(
  pending: { from: Address; to: Address; proposedAt: bigint },
  logs: readonly ProductLog[] | null,
): PendingHandoff {
  const proposed = logs
    ? [...logs]
        .reverse()
        .find(
          (log) =>
            log.eventName === "CustodyTransferProposed" &&
            typeof log.args.from === "string" &&
            typeof log.args.to === "string" &&
            sameHex(log.args.from, pending.from) &&
            sameHex(log.args.to, pending.to),
        )
    : undefined;
  return {
    ...pending,
    txHash: proposed?.transactionHash ?? null,
    blockNumber: proposed?.blockNumber ?? null,
  };
}

function recallView(log: ProductLog | null): RecallRecord | null {
  if (!log) return null;
  return {
    recalledBy: asAddress(log.args.recalledBy),
    reason: typeof log.args.reason === "string" ? log.args.reason : "",
    pendingCleared: log.args.pendingCleared === true,
    time: typeof log.args.recalledAt === "bigint" ? log.args.recalledAt : null,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
  };
}
