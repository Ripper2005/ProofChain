import { Hono } from "hono";
import { cors } from "hono/cors";
import { isAddress, isBatchId } from "./hex.ts";
import type { BatchRow, CustodyRow, IndexStore, PendingRow } from "./store.ts";

export type IndexerStatus = {
  syncOk: boolean;
  headBlock: number | null;
};

type BatchView = {
  batchId: string;
  batchCode: string;
  manufacturer: string;
  currentCustodian: string;
  metadataHash: string;
  metadataCid: string;
  status: "active" | "recalled";
  createdAt: string;
  createdBlock: string;
  createdTx: string;
  recalledAt: string | null;
  recallReason: string | null;
  recallPendingCleared: boolean | null;
  pending: {
    from: string;
    to: string;
    proposedAt: string;
    proposedTx: string;
    proposedBlock: string;
  } | null;
  history: HistoryItem[];
};

type HistoryItem = {
  from: string;
  to: string;
  timestamp: string;
  blockNumber: string;
  txHash: string;
};

export function createApp(options: {
  store: IndexStore;
  status: () => IndexerStatus;
  pinOk: () => Promise<boolean>;
  webOrigin: string;
}) {
  const app = new Hono();
  app.use("*", cors({ origin: options.webOrigin, allowMethods: ["GET", "OPTIONS"] }));

  app.get("/health", async (c) => {
    const [metaResult, pinOk] = await Promise.all([
      options.store
        .getMeta()
        .then((meta) => ({ meta, dbOk: true as const }))
        .catch(() => ({ meta: null, dbOk: false as const })),
      options.pinOk(),
    ]);
    const current = options.status();
    const syncOk = metaResult.dbOk && current.syncOk;
    return c.json({
      ok: syncOk,
      syncOk,
      pinOk,
      lastProcessedBlock:
        metaResult.meta?.lastProcessedBlock == null ? null : String(metaResult.meta.lastProcessedBlock),
      headBlock: current.headBlock == null ? null : String(current.headBlock),
    });
  });

  app.get("/batches", async (c) => {
    const status = blank(c.req.query("status"));
    if (status !== undefined && status !== "active" && status !== "recalled") {
      return c.json({ error: "InvalidStatus", message: "status must be active or recalled" }, 400);
    }
    const participant = blank(c.req.query("participant"));
    if (participant !== undefined && !isAddress(participant)) {
      return c.json({ error: "InvalidParticipant", message: "participant must be an address" }, 400);
    }
    const q = blank(c.req.query("q"));
    const batches = await options.store.listBatches();
    const views: BatchView[] = [];
    for (const batch of batches) {
      const pending = await options.store.getPending(batch.batchId);
      if (!matches(batch, pending, { participant, status, q })) continue;
      const history = await options.store.listCustody(batch.batchId);
      views.push(toView(batch, pending, history));
    }
    return c.json(views);
  });

  app.get("/batches/:batchKey/history", async (c) => {
    const batch = await findBatch(options.store, c.req.param("batchKey"));
    if (!batch) return c.json({ error: "NotFound", message: "Batch not found" }, 404);
    const history = await options.store.listCustody(batch.batchId);
    return c.json(historyItems(history));
  });

  app.get("/batches/:batchKey", async (c) => {
    const batch = await findBatch(options.store, c.req.param("batchKey"));
    if (!batch) return c.json({ error: "NotFound", message: "Batch not found" }, 404);
    const pending = await options.store.getPending(batch.batchId);
    const history = await options.store.listCustody(batch.batchId);
    return c.json(toView(batch, pending, history));
  });

  app.notFound((c) => c.json({ error: "NotFound", message: "Not found" }, 404));
  app.onError((_error, c) => c.json({ error: "Internal", message: "Indexer failed" }, 500));

  return app;
}

async function findBatch(store: IndexStore, key: string): Promise<BatchRow | null> {
  if (isBatchId(key)) return store.getBatchById(key.toLowerCase());
  return store.getBatchByCode(key);
}

function matches(
  batch: BatchRow,
  pending: PendingRow | null,
  filters: { participant?: string; status?: "active" | "recalled"; q?: string },
): boolean {
  if (filters.status && batch.status !== filters.status) return false;
  if (filters.participant && !sameParty(batch, pending, filters.participant)) return false;
  if (!filters.q) return true;
  if (isAddress(filters.q)) return sameParty(batch, pending, filters.q);
  return batch.batchCode.startsWith(filters.q);
}

function sameParty(batch: BatchRow, pending: PendingRow | null, party: string): boolean {
  const address = party.toLowerCase();
  return batch.manufacturer === address || batch.currentCustodian === address || pending?.toAddress === address;
}

function toView(batch: BatchRow, pending: PendingRow | null, history: CustodyRow[]): BatchView {
  return {
    batchId: batch.batchId,
    batchCode: batch.batchCode,
    manufacturer: batch.manufacturer,
    currentCustodian: batch.currentCustodian,
    metadataHash: batch.metadataHash,
    metadataCid: batch.metadataCid,
    status: batch.status,
    createdAt: iso(batch.createdAt),
    createdBlock: String(batch.createdBlock),
    createdTx: batch.createdTx,
    recalledAt: batch.recalledAt == null ? null : iso(batch.recalledAt),
    recallReason: batch.recallReason,
    recallPendingCleared: batch.recallPendingCleared,
    pending: pending
      ? {
          from: pending.fromAddress,
          to: pending.toAddress,
          proposedAt: iso(pending.proposedAt),
          proposedTx: pending.proposedTx,
          proposedBlock: String(pending.proposedBlock),
        }
      : null,
    history: historyItems(history),
  };
}

function historyItems(history: CustodyRow[]): HistoryItem[] {
  return history.map((row) => ({
    from: row.fromAddress,
    to: row.toAddress,
    timestamp: iso(row.acceptedAt),
    blockNumber: String(row.blockNumber),
    txHash: row.txHash,
  }));
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function blank(value: string | undefined): string | undefined {
  if (value == null || value === "") return undefined;
  return value;
}
