export type IndexerBatch = {
  batchId: string;
  batchCode: string;
  manufacturer: string;
  currentCustodian: string;
  status: string;
  pending: {
    from: string;
    to: string;
    proposedAt: string;
    proposedTx: string;
    proposedBlock: string;
  } | null;
};

export type IndexerHealth = {
  lastProcessedBlock: string;
  headBlock: string | null;
};

export function indexerUrl(path: string): string {
  const configured = import.meta.env.VITE_INDEXER_URL?.trim() ?? "";
  if (!configured) return `/api${path}`;
  return `${configured.replace(/\/$/, "")}${path}`;
}

export async function fetchIndexer(path: string): Promise<unknown> {
  const response = await fetch(indexerUrl(path), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Indexer returned ${response.status}`);
  return response.json();
}

export function readHealth(value: unknown): IndexerHealth | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.lastProcessedBlock !== "string") return null;
  return {
    lastProcessedBlock: record.lastProcessedBlock,
    headBlock: typeof record.headBlock === "string" ? record.headBlock : null,
  };
}

export function readBatchList(value: unknown): IndexerBatch[] | null {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { batches?: unknown }).batches)
      ? (value as { batches: unknown[] }).batches
      : null;
  if (!list) return null;
  const batches: IndexerBatch[] = [];
  for (const item of list) {
    const batch = readBatch(item);
    if (batch) batches.push(batch);
  }
  return batches;
}

function readBatch(value: unknown): IndexerBatch | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.batchCode !== "string" || typeof record.batchId !== "string") return null;
  if (typeof record.manufacturer !== "string" || typeof record.currentCustodian !== "string") return null;
  if (typeof record.status !== "string") return null;
  return {
    batchId: record.batchId,
    batchCode: record.batchCode,
    manufacturer: record.manufacturer,
    currentCustodian: record.currentCustodian,
    status: record.status,
    pending: readPending(record.pending),
  };
}

function readPending(value: unknown): IndexerBatch["pending"] {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.from !== "string" || typeof record.to !== "string") return null;
  return {
    from: record.from,
    to: record.to,
    proposedAt: typeof record.proposedAt === "string" ? record.proposedAt : "",
    proposedTx: typeof record.proposedTx === "string" ? record.proposedTx : "",
    proposedBlock: typeof record.proposedBlock === "string" ? record.proposedBlock : "",
  };
}
