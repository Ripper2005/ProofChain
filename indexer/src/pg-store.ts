import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { EventPayload, ProductEventName } from "./events.ts";
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

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number | null };

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

type ConnectedClient = QueryClient & { release(): void };

type Pool = QueryClient & {
  connect(): Promise<ConnectedClient>;
  end(): Promise<void>;
  on(event: "error", listener: (error: Error) => void): void;
};

export function createPool(databaseUrl: string): Pool {
  return new pg.Pool({ connectionString: databaseUrl }) as Pool;
}

export async function migrate(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const existing = await pool.query("SELECT id FROM schema_migrations WHERE id = $1", [file]);
    if (existing.rows.length > 0) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const statement of sqlStatements(sql)) {
        await client.query(statement);
      }
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PgStore implements IndexStore {
  private readonly pool: Pool;
  private readonly client: QueryClient | undefined;

  constructor(pool: Pool, client?: QueryClient) {
    this.pool = pool;
    this.client = client;
  }

  async transaction<T>(fn: (tx: IndexStore) => Promise<T>): Promise<T> {
    if (this.client) return fn(this);
    const client = await this.pool.connect();
    const tx = new PgStore(this.pool, client);
    try {
      await client.query("BEGIN");
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getMeta(): Promise<IndexerMeta | null> {
    const result = await this.query(
      `SELECT chain_id, contract_address, start_block, start_block_hash, last_processed_block, last_processed_hash
       FROM indexer_meta`,
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      chainId: num(row.chain_id),
      contractAddress: str(row.contract_address),
      startBlock: num(row.start_block),
      startBlockHash: str(row.start_block_hash),
      lastProcessedBlock: numOrNull(row.last_processed_block),
      lastProcessedHash: row.last_processed_hash == null ? null : str(row.last_processed_hash),
    };
  }

  async insertMeta(meta: IndexerMeta): Promise<void> {
    await this.query(
      `INSERT INTO indexer_meta (
         singleton, chain_id, contract_address, start_block, start_block_hash, last_processed_block, last_processed_hash
       ) VALUES (TRUE, $1, $2, $3, $4, $5, $6)`,
      [
        meta.chainId,
        meta.contractAddress,
        meta.startBlock,
        meta.startBlockHash,
        meta.lastProcessedBlock,
        meta.lastProcessedHash,
      ],
    );
  }

  async updateCursor(blockNumber: number, hash: string): Promise<void> {
    const result = await this.query(
      `UPDATE indexer_meta SET last_processed_block = $1, last_processed_hash = $2 WHERE singleton = TRUE`,
      [blockNumber, hash],
    );
    if ((result.rowCount ?? 0) !== 1) throw new Error("indexer_meta is missing");
  }

  async truncateAll(): Promise<void> {
    if (!this.client) {
      await this.transaction(async (tx) => {
        await tx.truncateAll();
      });
      return;
    }
    await this.query("DELETE FROM custody_transfers");
    await this.query("DELETE FROM pending_transfers");
    await this.query("DELETE FROM batches");
    await this.query("DELETE FROM logs");
    await this.query("DELETE FROM blocks");
    await this.query("DELETE FROM indexer_meta");
  }

  async insertBlock(block: BlockRow): Promise<void> {
    const inserted = await this.query(
      `INSERT INTO blocks (number, hash, parent_hash) VALUES ($1, $2, $3)
       ON CONFLICT (number) DO NOTHING
       RETURNING hash`,
      [block.number, block.hash, block.parentHash],
    );
    if (inserted.rows.length > 0) return;
    const stored = await this.getBlock(block.number);
    if (!stored || stored.hash !== block.hash) throw new Error(`Block ${block.number} hash changed`);
  }

  async getBlock(number: number): Promise<BlockRow | null> {
    const result = await this.query("SELECT number, hash, parent_hash FROM blocks WHERE number = $1", [number]);
    const row = result.rows[0];
    if (!row) return null;
    return { number: num(row.number), hash: str(row.hash), parentHash: str(row.parent_hash) };
  }

  async deleteBlocksAbove(number: number): Promise<void> {
    await this.query("DELETE FROM blocks WHERE number > $1", [number]);
  }

  async insertLog(log: Omit<StoredLog, "applied">): Promise<boolean> {
    const result = await this.query(
      `INSERT INTO logs (block_number, block_hash, tx_hash, log_index, event_name, payload, applied)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, FALSE)
       ON CONFLICT (tx_hash, log_index) DO NOTHING
       RETURNING tx_hash`,
      [log.blockNumber, log.blockHash, log.txHash, log.logIndex, log.eventName, JSON.stringify(log.payload)],
    );
    return result.rows.length > 0;
  }

  async listLogs(): Promise<StoredLog[]> {
    const result = await this.query(
      `SELECT block_number, block_hash, tx_hash, log_index, event_name, payload, applied
       FROM logs
       ORDER BY block_number, log_index`,
    );
    return result.rows.map((row) => ({
      blockNumber: num(row.block_number),
      blockHash: str(row.block_hash),
      txHash: str(row.tx_hash),
      logIndex: num(row.log_index),
      eventName: str(row.event_name) as ProductEventName,
      payload: payloadOf(row.payload),
      applied: row.applied === true,
    }));
  }

  async deleteLogsAbove(blockNumber: number): Promise<void> {
    await this.query("DELETE FROM logs WHERE block_number > $1", [blockNumber]);
  }

  async markAllLogsUnapplied(): Promise<void> {
    await this.query("UPDATE logs SET applied = FALSE");
  }

  async markLogApplied(txHash: string, logIndex: number): Promise<void> {
    const result = await this.query("UPDATE logs SET applied = TRUE WHERE tx_hash = $1 AND log_index = $2", [
      txHash,
      logIndex,
    ]);
    if ((result.rowCount ?? 0) !== 1) throw new Error("log not found");
  }

  async insertBatch(batch: BatchRow): Promise<boolean> {
    const result = await this.query(
      `INSERT INTO batches (
         batch_id, batch_code, manufacturer, current_custodian, metadata_hash, metadata_cid, status,
         created_at, created_block, created_tx, recalled_at, recalled_block, recalled_tx,
         recall_pending_cleared, recall_reason
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13,
         $14, $15
       )
       ON CONFLICT (batch_id) DO NOTHING
       RETURNING batch_id`,
      [
        batch.batchId,
        batch.batchCode,
        batch.manufacturer,
        batch.currentCustodian,
        batch.metadataHash,
        batch.metadataCid,
        batch.status,
        toTimestamp(batch.createdAt),
        batch.createdBlock,
        batch.createdTx,
        toTimestampOrNull(batch.recalledAt),
        batch.recalledBlock,
        batch.recalledTx,
        batch.recallPendingCleared,
        batch.recallReason,
      ],
    );
    return result.rows.length > 0;
  }

  async getBatchById(batchId: string): Promise<BatchRow | null> {
    const result = await this.query("SELECT * FROM batches WHERE batch_id = $1", [batchId]);
    const row = result.rows[0];
    return row ? batchFrom(row) : null;
  }

  async getBatchByCode(batchCode: string): Promise<BatchRow | null> {
    const result = await this.query("SELECT * FROM batches WHERE batch_code = $1", [batchCode]);
    const row = result.rows[0];
    return row ? batchFrom(row) : null;
  }

  async listBatches(): Promise<BatchRow[]> {
    const result = await this.query("SELECT * FROM batches ORDER BY created_block, batch_code, batch_id");
    return result.rows.map((row) => batchFrom(row));
  }

  async setCustodian(batchId: string, custodian: string): Promise<void> {
    const result = await this.query("UPDATE batches SET current_custodian = $2 WHERE batch_id = $1", [
      batchId,
      custodian,
    ]);
    if ((result.rowCount ?? 0) !== 1) throw new Error("Batch not found");
  }

  async recallBatch(batchId: string, update: RecallUpdate): Promise<void> {
    const result = await this.query(
      `UPDATE batches
       SET status = 'recalled',
           recalled_at = $2,
           recalled_block = $3,
           recalled_tx = $4,
           recall_pending_cleared = $5,
           recall_reason = $6
       WHERE batch_id = $1`,
      [
        batchId,
        toTimestamp(update.recalledAt),
        update.recalledBlock,
        update.recalledTx,
        update.recallPendingCleared,
        update.recallReason,
      ],
    );
    if ((result.rowCount ?? 0) !== 1) throw new Error("Batch not found");
  }

  async deleteProjection(): Promise<void> {
    await this.query("DELETE FROM custody_transfers");
    await this.query("DELETE FROM pending_transfers");
    await this.query("DELETE FROM batches");
  }

  async insertPending(row: PendingRow): Promise<boolean> {
    const result = await this.query(
      `INSERT INTO pending_transfers (batch_id, from_address, to_address, proposed_at, proposed_block, proposed_tx)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (batch_id) DO NOTHING
       RETURNING batch_id`,
      [row.batchId, row.fromAddress, row.toAddress, toTimestamp(row.proposedAt), row.proposedBlock, row.proposedTx],
    );
    return result.rows.length > 0;
  }

  async getPending(batchId: string): Promise<PendingRow | null> {
    const result = await this.query("SELECT * FROM pending_transfers WHERE batch_id = $1", [batchId]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      batchId: str(row.batch_id),
      fromAddress: str(row.from_address),
      toAddress: str(row.to_address),
      proposedAt: fromTimestamp(row.proposed_at),
      proposedBlock: num(row.proposed_block),
      proposedTx: str(row.proposed_tx),
    };
  }

  async deletePending(batchId: string): Promise<void> {
    await this.query("DELETE FROM pending_transfers WHERE batch_id = $1", [batchId]);
  }

  async insertCustody(row: CustodyRow): Promise<boolean> {
    const result = await this.query(
      `INSERT INTO custody_transfers (
         batch_id, from_address, to_address, accepted_at, block_number, tx_hash, log_index
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tx_hash, log_index) DO NOTHING
       RETURNING tx_hash`,
      [
        row.batchId,
        row.fromAddress,
        row.toAddress,
        toTimestamp(row.acceptedAt),
        row.blockNumber,
        row.txHash,
        row.logIndex,
      ],
    );
    return result.rows.length > 0;
  }

  async listCustody(batchId: string): Promise<CustodyRow[]> {
    const result = await this.query(
      `SELECT batch_id, from_address, to_address, accepted_at, block_number, tx_hash, log_index
       FROM custody_transfers
       WHERE batch_id = $1
       ORDER BY block_number, log_index`,
      [batchId],
    );
    return result.rows.map((row) => ({
      batchId: str(row.batch_id),
      fromAddress: str(row.from_address),
      toAddress: str(row.to_address),
      acceptedAt: fromTimestamp(row.accepted_at),
      blockNumber: num(row.block_number),
      txHash: str(row.tx_hash),
      logIndex: num(row.log_index),
    }));
  }

  private async query(text: string, values: unknown[] = []): Promise<QueryResult> {
    return (this.client ?? this.pool).query(text, values);
  }
}

function sqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function batchFrom(row: Record<string, unknown>): BatchRow {
  const status = str(row.status);
  if (status !== "active" && status !== "recalled") throw new Error("invalid batch status");
  return {
    batchId: str(row.batch_id),
    batchCode: str(row.batch_code),
    manufacturer: str(row.manufacturer),
    currentCustodian: str(row.current_custodian),
    metadataHash: str(row.metadata_hash),
    metadataCid: str(row.metadata_cid),
    status,
    createdAt: fromTimestamp(row.created_at),
    createdBlock: num(row.created_block),
    createdTx: str(row.created_tx),
    recalledAt: fromTimestampOrNull(row.recalled_at),
    recalledBlock: numOrNull(row.recalled_block),
    recalledTx: row.recalled_tx == null ? null : str(row.recalled_tx),
    recallPendingCleared: boolOrNull(row.recall_pending_cleared),
    recallReason: row.recall_reason == null ? null : str(row.recall_reason),
  };
}

function payloadOf(value: unknown): EventPayload {
  if (typeof value === "string") return JSON.parse(value) as EventPayload;
  if (value && typeof value === "object") return value as EventPayload;
  throw new Error("expected payload");
}

function toTimestamp(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function toTimestampOrNull(seconds: number | null): string | null {
  return seconds == null ? null : toTimestamp(seconds);
}

function fromTimestamp(value: unknown): number {
  const parsed = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error("expected timestamp");
  return Math.round(parsed / 1000);
}

function fromTimestampOrNull(value: unknown): number | null {
  if (value == null) return null;
  return fromTimestamp(value);
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed)) throw new Error("expected integer");
  return parsed;
}

function numOrNull(value: unknown): number | null {
  if (value == null) return null;
  return num(value);
}

function str(value: unknown): string {
  if (typeof value !== "string") throw new Error("expected string");
  return value;
}

function boolOrNull(value: unknown): boolean | null {
  if (value == null) return null;
  if (typeof value === "boolean") return value;
  throw new Error("expected boolean");
}
