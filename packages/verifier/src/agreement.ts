import { decodeFunctionResult, encodeFunctionData, isHex, numberToHex, type Address, type Hex } from "viem";
import { productRegistryAbi } from "./abi.ts";
import { revertText } from "./errors.ts";
import { isRecord } from "./format.ts";
import { MANUFACTURER_ROLE } from "./roles.ts";
import { describeReaderError, revertData, rpcQuantity, type Reader } from "./rpc.ts";

export type Answer = { kind: "ok"; data: Hex } | { kind: "revert"; data: Hex };

export type Snapshot = {
  blockHash: Hex;
  getBatch: Answer;
  getPendingTransfer: Answer;
  getCustodyHistory: Answer;
  hasRole: Answer | null;
  stateRoot: Hex;
};

export type ReaderStatus = "agrees" | "disagrees" | "unreachable" | "misconfigured";

export type ReaderReport = {
  url: string;
  status: ReaderStatus;
  chainId: number | null;
  head: bigint | null;
  detail: string | null;
  answer: string[];
  differs: string[];
};

export type Agreement = {
  holds: boolean;
  anchor: bigint | null;
  anchorHash: Hex | null;
  configured: number;
  agreeing: number;
  disagreeing: number;
  unreachable: number;
  misconfigured: number;
};

export type AgreementRead = {
  reports: ReaderReport[];
  agreement: Agreement;
  record: Snapshot | null;
  recordReaders: Reader[];
};

type Target = { chainId: number; contract: Address; batchId: Hex };

type Probe = { ok: true; chainId: number; head: bigint } | { ok: false; detail: string };

const FIELDS = ["blockHash", "getBatch", "getPendingTransfer", "getCustodyHistory", "hasRole", "stateRoot"] as const;

const FIELD_LABELS: Record<(typeof FIELDS)[number], string> = {
  blockHash: "block hash",
  getBatch: "getBatch",
  getPendingTransfer: "getPendingTransfer",
  getCustodyHistory: "getCustodyHistory",
  hasRole: "hasRole(MANUFACTURER_ROLE, manufacturer)",
  stateRoot: "state root",
};

export function emptyAgreement(configured: number): Agreement {
  return {
    holds: false,
    anchor: null,
    anchorHash: null,
    configured,
    agreeing: 0,
    disagreeing: 0,
    unreachable: 0,
    misconfigured: 0,
  };
}

export async function readAgreement(readers: readonly Reader[], target: Target): Promise<AgreementRead> {
  const probes = await Promise.all(readers.map((reader) => probe(reader)));
  const reports: ReaderReport[] = readers.map((reader, index) => {
    const result = probes[index];
    const report: ReaderReport = {
      url: reader.url,
      status: "unreachable",
      chainId: null,
      head: null,
      detail: null,
      answer: [],
      differs: [],
    };
    if (!result || !result.ok) {
      report.detail = result && !result.ok ? result.detail : "no answer";
      return report;
    }
    report.chainId = result.chainId;
    report.head = result.head;
    if (result.chainId !== target.chainId) {
      report.status = "misconfigured";
      report.detail = `reports chain ${result.chainId}, not chain ${target.chainId}`;
    }
    return report;
  });

  const live = reports.flatMap((report, index) =>
    report.chainId === target.chainId && report.head !== null ? [index] : [],
  );
  if (live.length === 0) {
    return { reports, agreement: tally(reports, readers.length, null, null, false), record: null, recordReaders: [] };
  }

  const anchor = live.reduce((lowest, index) => {
    const head = reports[index]?.head ?? lowest;
    return head < lowest ? head : lowest;
  }, reports[live[0] ?? 0]?.head ?? 0n);

  const snapshots = new Map<number, Snapshot>();
  await Promise.all(
    live.map(async (index) => {
      const reader = readers[index];
      const report = reports[index];
      if (!reader || !report) return;
      try {
        snapshots.set(index, await snapshot(reader, anchor, target));
      } catch (error) {
        report.status = "unreachable";
        report.detail = `answered the chain head but not the reads at block ${anchor} (${describeReaderError(error)})`;
      }
    }),
  );

  const answered = live.filter((index) => snapshots.has(index));
  if (answered.length === 0) {
    return { reports, agreement: tally(reports, readers.length, anchor, null, false), record: null, recordReaders: [] };
  }

  const groups = new Map<string, number[]>();
  for (const index of answered) {
    const key = snapshotKey(snapshots.get(index)!);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  }
  const largest = Math.max(...[...groups.values()].map((members) => members.length));
  const leaders = [...groups.entries()].filter(([, members]) => members.length === largest);
  const majorityKey = leaders.length === 1 ? (leaders[0]?.[0] ?? null) : null;
  const recordKey = majorityKey ?? snapshotKey(snapshots.get(answered[0]!)!);
  const record = snapshots.get(groups.get(recordKey)![0]!)!;

  for (const index of answered) {
    const report = reports[index]!;
    const own = snapshots.get(index)!;
    report.answer = describeSnapshot(own);
    if (majorityKey !== null && snapshotKey(own) === majorityKey) {
      report.status = "agrees";
      continue;
    }
    report.status = "disagrees";
    report.differs = differingFields(own, record);
    report.detail =
      majorityKey === null
        ? "no answer has a majority among the readers that answered"
        : `differs from the majority in ${report.differs.join(", ")}`;
  }

  const recordReaders = (groups.get(recordKey) ?? []).map((index) => readers[index]!);
  const agreeing = majorityKey === null ? 0 : (groups.get(majorityKey)?.length ?? 0);
  const disagreeing = answered.length - agreeing;
  const holds = majorityKey !== null && disagreeing === 0 && (agreeing >= 2 || (readers.length === 1 && agreeing === 1));
  return {
    reports,
    agreement: tally(reports, readers.length, anchor, record.blockHash, holds),
    record,
    recordReaders,
  };
}

export function describeSnapshot(snapshot: Snapshot): string[] {
  return [
    `block hash ${snapshot.blockHash}`,
    `getBatch: ${describeBatch(snapshot.getBatch)}`,
    `getPendingTransfer: ${describePending(snapshot.getPendingTransfer)}`,
    `getCustodyHistory: ${describeHistory(snapshot.getCustodyHistory)}`,
    `hasRole(MANUFACTURER_ROLE, manufacturer): ${describeRole(snapshot.hasRole)}`,
    `state root ${snapshot.stateRoot}`,
  ];
}

async function probe(reader: Reader): Promise<Probe> {
  try {
    const [chainId, head] = await Promise.all([rpcQuantity(reader, "eth_chainId"), rpcQuantity(reader, "eth_blockNumber")]);
    if (chainId > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, detail: "returned a chain id that is too large" };
    return { ok: true, chainId: Number(chainId), head };
  } catch (error) {
    return { ok: false, detail: describeReaderError(error) };
  }
}

async function snapshot(reader: Reader, anchor: bigint, target: Target): Promise<Snapshot> {
  const block = numberToHex(anchor);
  const read = (data: Hex) => call(reader, target.contract, data, block);
  const [header, getBatch, getPendingTransfer, getCustodyHistory] = await Promise.all([
    reader.request("eth_getBlockByNumber", [block, false]),
    read(encodeFunctionData({ abi: productRegistryAbi, functionName: "getBatch", args: [target.batchId] })),
    read(encodeFunctionData({ abi: productRegistryAbi, functionName: "getPendingTransfer", args: [target.batchId] })),
    read(encodeFunctionData({ abi: productRegistryAbi, functionName: "getCustodyHistory", args: [target.batchId] })),
  ]);
  const blockHash = isRecord(header) && typeof header.hash === "string" && isHash(header.hash) ? header.hash : null;
  const stateRoot =
    isRecord(header) && typeof header.stateRoot === "string" && isHash(header.stateRoot) ? header.stateRoot : null;
  if (!blockHash || !stateRoot) throw new Error(`no block hash and state root for block ${anchor}`);
  const manufacturer = getBatch.kind === "ok" ? manufacturerOf(getBatch.data) : null;
  const hasRole = manufacturer
    ? await read(
        encodeFunctionData({ abi: productRegistryAbi, functionName: "hasRole", args: [MANUFACTURER_ROLE, manufacturer] }),
      )
    : null;
  return {
    blockHash: blockHash.toLowerCase() as Hex,
    getBatch,
    getPendingTransfer,
    getCustodyHistory,
    hasRole,
    stateRoot: stateRoot.toLowerCase() as Hex,
  };
}

function isHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

async function call(reader: Reader, contract: Address, data: Hex, block: Hex): Promise<Answer> {
  try {
    const result = await reader.request("eth_call", [{ to: contract, data }, block]);
    if (typeof result !== "string" || !isHex(result)) throw new Error("eth_call returned something that is not hex");
    return { kind: "ok", data: result.toLowerCase() as Hex };
  } catch (error) {
    const reverted = revertData(error);
    if (reverted !== null) return { kind: "revert", data: reverted.toLowerCase() as Hex };
    throw error;
  }
}

function manufacturerOf(data: Hex): Address | null {
  try {
    return decodeFunctionResult({ abi: productRegistryAbi, functionName: "getBatch", data }).manufacturer;
  } catch {
    return null;
  }
}

function snapshotKey(snapshot: Snapshot): string {
  return FIELDS.map((field) => fieldKey(snapshot, field)).join("|");
}

function fieldKey(snapshot: Snapshot, field: (typeof FIELDS)[number]): string {
  const value = snapshot[field];
  if (value === null) return "none";
  if (typeof value === "string") return value;
  return `${value.kind}:${value.data}`;
}

function differingFields(own: Snapshot, reference: Snapshot): string[] {
  return FIELDS.filter((field) => fieldKey(own, field) !== fieldKey(reference, field)).map((field) => FIELD_LABELS[field]);
}

function tally(
  reports: readonly ReaderReport[],
  configured: number,
  anchor: bigint | null,
  anchorHash: Hex | null,
  holds: boolean,
): Agreement {
  const count = (status: ReaderStatus) => reports.filter((report) => report.status === status).length;
  return {
    holds,
    anchor,
    anchorHash,
    configured,
    agreeing: count("agrees"),
    disagreeing: count("disagrees"),
    unreachable: count("unreachable"),
    misconfigured: count("misconfigured"),
  };
}

function describeBatch(answer: Answer): string {
  if (answer.kind === "revert") return `reverted ${revertText(answer.data)}`;
  try {
    const batch = decodeFunctionResult({ abi: productRegistryAbi, functionName: "getBatch", data: answer.data });
    const status = batch.status === 1 ? "active" : batch.status === 2 ? "recalled" : `status ${batch.status}`;
    return `${batch.batchCode}, ${status}, custodian ${batch.currentCustodian}, metadataHash ${batch.metadataHash}, CID ${batch.metadataCid}`;
  } catch {
    return `returned ${answer.data.slice(0, 18)}, which is not a getBatch result`;
  }
}

function describePending(answer: Answer): string {
  if (answer.kind === "revert") return `reverted ${revertText(answer.data)}`;
  try {
    const pending = decodeFunctionResult({ abi: productRegistryAbi, functionName: "getPendingTransfer", data: answer.data });
    return pending.active ? `handoff pending from ${pending.from} to ${pending.to}` : "no pending handoff";
  } catch {
    return `returned ${answer.data.slice(0, 18)}, which is not a getPendingTransfer result`;
  }
}

function describeHistory(answer: Answer): string {
  if (answer.kind === "revert") return `reverted ${revertText(answer.data)}`;
  try {
    const history = decodeFunctionResult({ abi: productRegistryAbi, functionName: "getCustodyHistory", data: answer.data });
    if (history.length === 0) return "no accepted handoff";
    return history.map((row) => `${row.from} to ${row.to}`).join("; ");
  } catch {
    return `returned ${answer.data.slice(0, 18)}, which is not a getCustodyHistory result`;
  }
}

function describeRole(answer: Answer | null): string {
  if (answer === null) return "not asked, because getBatch named no manufacturer";
  if (answer.kind === "revert") return `reverted ${revertText(answer.data)}`;
  try {
    return decodeFunctionResult({ abi: productRegistryAbi, functionName: "hasRole", data: answer.data }) ? "held" : "not held";
  } catch {
    return `returned ${answer.data.slice(0, 18)}, which is not a boolean`;
  }
}
