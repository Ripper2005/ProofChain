import type {
  BatchRow,
  BlockRow,
  CustodyRow,
  IndexerMeta,
  IndexStore,
  PendingRow,
  RecallUpdate,
  StoredLog,
} from "./store.ts";

type Snapshot = {
  meta: IndexerMeta | null;
  blocks: Map<number, BlockRow>;
  logs: StoredLog[];
  batches: Map<string, BatchRow>;
  pending: Map<string, PendingRow>;
  custody: CustodyRow[];
};

export class MemoryStore implements IndexStore {
  meta: IndexerMeta | null = null;
  blocks = new Map<number, BlockRow>();
  logs: StoredLog[] = [];
  batches = new Map<string, BatchRow>();
  pending = new Map<string, PendingRow>();
  custody: CustodyRow[] = [];
  private inTransaction = false;

  async transaction<T>(fn: (tx: IndexStore) => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn(this);
    const snapshot = this.snapshot();
    this.inTransaction = true;
    try {
      const result = await fn(this);
      return result;
    } catch (error) {
      this.restore(snapshot);
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  async getMeta(): Promise<IndexerMeta | null> {
    return this.meta ? { ...this.meta } : null;
  }

  async insertMeta(meta: IndexerMeta): Promise<void> {
    if (this.meta) throw new Error("indexer_meta already exists");
    this.meta = { ...meta };
  }

  async updateCursor(blockNumber: number, hash: string | null): Promise<void> {
    if (!this.meta) throw new Error("indexer_meta is missing");
    this.meta = { ...this.meta, lastProcessedBlock: blockNumber, lastProcessedHash: hash };
  }

  async truncateAll(): Promise<void> {
    this.meta = null;
    this.blocks.clear();
    this.logs = [];
    this.batches.clear();
    this.pending.clear();
    this.custody = [];
  }

  async insertBlock(block: BlockRow): Promise<void> {
    const existing = this.blocks.get(block.number);
    if (existing) {
      if (existing.hash !== block.hash) throw new Error(`Block ${block.number} hash changed`);
      return;
    }
    this.blocks.set(block.number, { ...block });
  }

  async getBlock(number: number): Promise<BlockRow | null> {
    const block = this.blocks.get(number);
    return block ? { ...block } : null;
  }

  async getBlockAtOrBelow(number: number): Promise<BlockRow | null> {
    let best: BlockRow | undefined;
    for (const block of this.blocks.values()) {
      if (block.number <= number && (!best || block.number > best.number)) best = block;
    }
    return best ? { ...best } : null;
  }

  async deleteBlocksAbove(number: number): Promise<void> {
    for (const height of [...this.blocks.keys()]) {
      if (height > number) this.blocks.delete(height);
    }
  }

  async pruneBlocks(below: number, keep: number): Promise<void> {
    const logBlocks = new Set(this.logs.map((log) => log.blockNumber));
    for (const height of [...this.blocks.keys()]) {
      if (height < below && height !== keep && !logBlocks.has(height)) this.blocks.delete(height);
    }
  }

  async insertLog(log: Omit<StoredLog, "applied">): Promise<boolean> {
    if (this.logs.some((row) => row.txHash === log.txHash && row.logIndex === log.logIndex)) return false;
    this.logs.push({ ...log, payload: { ...log.payload }, applied: false });
    return true;
  }

  async listLogs(): Promise<StoredLog[]> {
    return this.logs
      .map((log) => ({ ...log, payload: { ...log.payload } }))
      .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  }

  async deleteLogsAbove(blockNumber: number): Promise<void> {
    this.logs = this.logs.filter((log) => log.blockNumber <= blockNumber);
  }

  async markAllLogsUnapplied(): Promise<void> {
    this.logs = this.logs.map((log) => ({ ...log, applied: false }));
  }

  async markLogApplied(txHash: string, logIndex: number): Promise<void> {
    const log = this.logs.find((row) => row.txHash === txHash && row.logIndex === logIndex);
    if (!log) throw new Error("log not found");
    log.applied = true;
  }

  async insertBatch(batch: BatchRow): Promise<boolean> {
    if (this.batches.has(batch.batchId)) return false;
    if ([...this.batches.values()].some((row) => row.batchCode === batch.batchCode)) {
      throw new Error("batch code already exists");
    }
    this.batches.set(batch.batchId, { ...batch });
    return true;
  }

  async getBatchById(batchId: string): Promise<BatchRow | null> {
    const batch = this.batches.get(batchId);
    return batch ? { ...batch } : null;
  }

  async getBatchByCode(batchCode: string): Promise<BatchRow | null> {
    const batch = [...this.batches.values()].find((row) => row.batchCode === batchCode);
    return batch ? { ...batch } : null;
  }

  async listBatches(): Promise<BatchRow[]> {
    return [...this.batches.values()]
      .map((batch) => ({ ...batch }))
      .sort((a, b) => a.createdBlock - b.createdBlock || compareText(a.batchCode, b.batchCode) || compareText(a.batchId, b.batchId));
  }

  async setCustodian(batchId: string, custodian: string): Promise<void> {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error("Batch not found");
    batch.currentCustodian = custodian;
  }

  async recallBatch(batchId: string, update: RecallUpdate): Promise<void> {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error("Batch not found");
    batch.status = "recalled";
    batch.recalledAt = update.recalledAt;
    batch.recalledBlock = update.recalledBlock;
    batch.recalledTx = update.recalledTx;
    batch.recallPendingCleared = update.recallPendingCleared;
    batch.recallReason = update.recallReason;
  }

  async deleteProjection(): Promise<void> {
    this.custody = [];
    this.pending.clear();
    this.batches.clear();
  }

  async insertPending(row: PendingRow): Promise<boolean> {
    if (!this.batches.has(row.batchId)) throw new Error("Batch not found");
    if (this.pending.has(row.batchId)) return false;
    this.pending.set(row.batchId, { ...row });
    return true;
  }

  async getPending(batchId: string): Promise<PendingRow | null> {
    const row = this.pending.get(batchId);
    return row ? { ...row } : null;
  }

  async deletePending(batchId: string): Promise<void> {
    this.pending.delete(batchId);
  }

  async insertCustody(row: CustodyRow): Promise<boolean> {
    if (!this.batches.has(row.batchId)) throw new Error("Batch not found");
    if (this.custody.some((item) => item.txHash === row.txHash && item.logIndex === row.logIndex)) return false;
    this.custody.push({ ...row });
    return true;
  }

  async listCustody(batchId: string): Promise<CustodyRow[]> {
    return this.custody
      .filter((row) => row.batchId === batchId)
      .map((row) => ({ ...row }))
      .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  }

  private snapshot(): Snapshot {
    return {
      meta: this.meta ? { ...this.meta } : null,
      blocks: new Map([...this.blocks].map(([key, value]) => [key, { ...value }])),
      logs: this.logs.map((log) => ({ ...log, payload: { ...log.payload } })),
      batches: new Map([...this.batches].map(([key, value]) => [key, { ...value }])),
      pending: new Map([...this.pending].map(([key, value]) => [key, { ...value }])),
      custody: this.custody.map((row) => ({ ...row })),
    };
  }

  private restore(snapshot: Snapshot): void {
    this.meta = snapshot.meta;
    this.blocks = snapshot.blocks;
    this.logs = snapshot.logs;
    this.batches = snapshot.batches;
    this.pending = snapshot.pending;
    this.custody = snapshot.custody;
  }
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
