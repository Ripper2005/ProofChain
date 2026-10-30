import type {
  BatchRegisteredPayload,
  CancelledPayload,
  ProposedPayload,
  RecalledPayload,
  TransferredPayload,
} from "./events.ts";
import type { IndexStore, StoredLog } from "./store.ts";

export async function applyLog(store: IndexStore, log: StoredLog): Promise<void> {
  switch (log.eventName) {
    case "BatchRegistered":
      await applyRegistered(store, log, log.payload as BatchRegisteredPayload);
      return;
    case "CustodyTransferProposed":
      await applyProposed(store, log, log.payload as ProposedPayload);
      return;
    case "CustodyTransferCancelled":
      await applyCancelled(store, log.payload as CancelledPayload);
      return;
    case "CustodyTransferred":
      await applyTransferred(store, log, log.payload as TransferredPayload);
      return;
    case "BatchRecalled":
      await applyRecalled(store, log, log.payload as RecalledPayload);
      return;
    default:
      throw new Error(`Unknown event ${log.eventName}`);
  }
}

export async function applyUnapplied(store: IndexStore): Promise<void> {
  const logs = await store.listLogs();
  for (const log of logs) {
    if (log.applied) continue;
    await applyLog(store, log);
    await store.markLogApplied(log.txHash, log.logIndex);
  }
}

async function applyRegistered(store: IndexStore, log: StoredLog, payload: BatchRegisteredPayload): Promise<void> {
  await store.insertBatch({
    batchId: payload.batchId,
    batchCode: payload.batchCode,
    manufacturer: payload.manufacturer,
    currentCustodian: payload.manufacturer,
    metadataHash: payload.metadataHash,
    metadataCid: payload.metadataCid,
    status: "active",
    createdAt: payload.createdAt,
    createdBlock: log.blockNumber,
    createdTx: log.txHash,
    recalledAt: null,
    recalledBlock: null,
    recalledTx: null,
    recallPendingCleared: null,
    recallReason: null,
  });
}

async function applyProposed(store: IndexStore, log: StoredLog, payload: ProposedPayload): Promise<void> {
  await store.insertPending({
    batchId: payload.batchId,
    fromAddress: payload.from,
    toAddress: payload.to,
    proposedAt: payload.proposedAt,
    proposedBlock: log.blockNumber,
    proposedTx: log.txHash,
  });
}

async function applyCancelled(store: IndexStore, payload: CancelledPayload): Promise<void> {
  await store.deletePending(payload.batchId);
}

async function applyTransferred(store: IndexStore, log: StoredLog, payload: TransferredPayload): Promise<void> {
  await store.insertCustody({
    batchId: payload.batchId,
    fromAddress: payload.from,
    toAddress: payload.to,
    acceptedAt: payload.timestamp,
    blockNumber: log.blockNumber,
    txHash: log.txHash,
    logIndex: log.logIndex,
  });
  await store.setCustodian(payload.batchId, payload.to);
  await store.deletePending(payload.batchId);
}

async function applyRecalled(store: IndexStore, log: StoredLog, payload: RecalledPayload): Promise<void> {
  await store.recallBatch(payload.batchId, {
    recalledAt: payload.recalledAt,
    recalledBlock: log.blockNumber,
    recalledTx: log.txHash,
    recallPendingCleared: payload.pendingCleared,
    recallReason: payload.reason,
  });
  await store.deletePending(payload.batchId);
}
