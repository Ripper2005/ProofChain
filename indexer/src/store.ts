import type { EventPayload, ProductEventName } from "./events.ts";

export type IndexerMeta = {
  chainId: number;
  contractAddress: string;
  startBlock: number;
  startBlockHash: string;
  lastProcessedBlock: number | null;
  lastProcessedHash: string | null;
};

export type BlockRow = {
  number: number;
  hash: string;
  parentHash: string;
};

export type StoredLog = {
  blockNumber: number;
  blockHash: string;
  txHash: string;
  logIndex: number;
  eventName: ProductEventName;
  payload: EventPayload;
  applied: boolean;
};

export type BatchRow = {
  batchId: string;
  batchCode: string;
  manufacturer: string;
  currentCustodian: string;
  metadataHash: string;
  metadataCid: string;
  status: "active" | "recalled";
  createdAt: number;
  createdBlock: number;
  createdTx: string;
  recalledAt: number | null;
  recalledBlock: number | null;
  recalledTx: string | null;
  recallPendingCleared: boolean | null;
  recallReason: string | null;
};

export type PendingRow = {
  batchId: string;
  fromAddress: string;
  toAddress: string;
  proposedAt: number;
  proposedBlock: number;
  proposedTx: string;
};

export type CustodyRow = {
  batchId: string;
  fromAddress: string;
  toAddress: string;
  acceptedAt: number;
  blockNumber: number;
  txHash: string;
  logIndex: number;
};

export type RecallUpdate = {
  recalledAt: number;
  recalledBlock: number;
  recalledTx: string;
  recallPendingCleared: boolean;
  recallReason: string;
};

export interface IndexStore {
  transaction<T>(fn: (tx: IndexStore) => Promise<T>): Promise<T>;
  getMeta(): Promise<IndexerMeta | null>;
  insertMeta(meta: IndexerMeta): Promise<void>;
  updateCursor(blockNumber: number, hash: string | null): Promise<void>;
  truncateAll(): Promise<void>;
  insertBlock(block: BlockRow): Promise<void>;
  getBlock(number: number): Promise<BlockRow | null>;
  getBlockAtOrBelow(number: number): Promise<BlockRow | null>;
  deleteBlocksAbove(number: number): Promise<void>;
  pruneBlocks(below: number, keep: number): Promise<void>;
  insertLog(log: Omit<StoredLog, "applied">): Promise<boolean>;
  listLogs(): Promise<StoredLog[]>;
  deleteLogsAbove(blockNumber: number): Promise<void>;
  markAllLogsUnapplied(): Promise<void>;
  markLogApplied(txHash: string, logIndex: number): Promise<void>;
  insertBatch(batch: BatchRow): Promise<boolean>;
  getBatchById(batchId: string): Promise<BatchRow | null>;
  getBatchByCode(batchCode: string): Promise<BatchRow | null>;
  listBatches(): Promise<BatchRow[]>;
  setCustodian(batchId: string, custodian: string): Promise<void>;
  recallBatch(batchId: string, update: RecallUpdate): Promise<void>;
  deleteProjection(): Promise<void>;
  insertPending(row: PendingRow): Promise<boolean>;
  getPending(batchId: string): Promise<PendingRow | null>;
  deletePending(batchId: string): Promise<void>;
  insertCustody(row: CustodyRow): Promise<boolean>;
  listCustody(batchId: string): Promise<CustodyRow[]>;
}
