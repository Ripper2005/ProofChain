import { applyUnapplied } from "./apply.ts";
import type { SyncConfig } from "./config.ts";
import { decodeProductLog, type RawLog } from "./events.ts";
import type { ChainReader } from "./chain.ts";
import type { IndexerMeta, IndexStore } from "./store.ts";

export const LOG_RANGE = 2000;

export class DecodePauseError extends Error {
  constructor() {
    super("Product log failed to decode");
    this.name = "DecodePauseError";
  }
}

export type SyncState = {
  paused: boolean;
};

export type SyncSnapshot = {
  syncOk: boolean;
  headBlock: number | null;
  reason: string | null;
};

export function blockRanges(fromBlock: number, toBlock: number, size = LOG_RANGE): Array<[number, number]> {
  if (!Number.isInteger(size) || size < 1) throw new Error("range size must be a positive integer");
  const ranges: Array<[number, number]> = [];
  for (let start = fromBlock; start <= toBlock; start += size) {
    ranges.push([start, Math.min(toBlock, start + size - 1)]);
  }
  return ranges;
}

export async function resync(store: IndexStore, config: SyncConfig): Promise<"reset" | "mismatch"> {
  const meta = await store.getMeta();
  if (meta && (meta.chainId !== config.chainId || meta.contractAddress !== config.contractAddress)) {
    return "mismatch";
  }
  await store.truncateAll();
  return "reset";
}

export async function syncOnce(
  store: IndexStore,
  chain: ChainReader,
  config: SyncConfig,
  state: SyncState,
): Promise<SyncSnapshot> {
  if (state.paused) {
    return { syncOk: false, headBlock: await readHead(chain), reason: "sync paused" };
  }

  let rpcChainId: number;
  let head: number;
  try {
    rpcChainId = await chain.getChainId();
    head = await chain.getHeadBlock();
  } catch {
    return { syncOk: false, headBlock: null, reason: "rpc unavailable" };
  }
  if (!Number.isInteger(head) || head < 0) {
    return { syncOk: false, headBlock: null, reason: "rpc unavailable" };
  }

  try {
    let meta = await store.getMeta();
    if (
      meta &&
      (meta.chainId !== config.chainId ||
        meta.contractAddress !== config.contractAddress ||
        meta.startBlock !== config.startBlock ||
        rpcChainId !== meta.chainId)
    ) {
      return { syncOk: false, headBlock: head, reason: "chain or contract does not match indexer_meta" };
    }
    if (!meta && rpcChainId !== config.chainId) {
      return { syncOk: false, headBlock: head, reason: "rpc chain id does not match CHAIN_ID" };
    }

    if (meta) {
      meta = await reconcile(store, chain, meta);
    }

    if (head < config.confirmations) {
      return { syncOk: true, headBlock: head, reason: null };
    }
    const safeHead = head - config.confirmations;
    if (safeHead < config.startBlock) {
      return { syncOk: true, headBlock: head, reason: null };
    }

    const from = meta == null || meta.lastProcessedBlock == null ? config.startBlock : meta.lastProcessedBlock + 1;
    if (from <= safeHead) {
      await ingest(store, chain, config, from, safeHead, meta != null);
    } else {
      await store.transaction(async (tx) => {
        await applyUnapplied(tx);
      });
    }
    return { syncOk: true, headBlock: head, reason: null };
  } catch (error) {
    if (error instanceof DecodePauseError) {
      state.paused = true;
      return { syncOk: false, headBlock: head, reason: "product log failed to decode" };
    }
    const message = error instanceof Error ? error.message : "sync failed";
    return { syncOk: false, headBlock: head, reason: message };
  }
}

export function createSyncLoop(options: {
  store: IndexStore;
  chain: ChainReader;
  config: SyncConfig;
  intervalMs: number;
}): {
  tick: () => Promise<void>;
  start: () => void;
  stop: () => void;
  status: () => { syncOk: boolean; headBlock: number | null };
} {
  const state: SyncState & { syncOk: boolean; headBlock: number | null } = {
    paused: false,
    syncOk: false,
    headBlock: null,
  };
  let lastReason: string | null = null;
  let running = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const snapshot = await syncOnce(options.store, options.chain, options.config, state);
      state.syncOk = snapshot.syncOk;
      state.headBlock = snapshot.headBlock;
      if (!snapshot.syncOk && snapshot.reason !== lastReason) {
        console.error(`Indexer: ${snapshot.reason}`);
      }
      lastReason = snapshot.syncOk ? null : snapshot.reason;
    } finally {
      running = false;
    }
  };

  return {
    tick,
    start() {
      timer = setInterval(() => {
        void tick();
      }, options.intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
    },
    status() {
      return { syncOk: state.syncOk, headBlock: state.headBlock };
    },
  };
}

async function reconcile(store: IndexStore, chain: ChainReader, meta: IndexerMeta): Promise<IndexerMeta | null> {
  const start = await chain.getBlock(meta.startBlock);
  if (!start || start.hash !== meta.startBlockHash) {
    await store.truncateAll();
    return null;
  }
  if (meta.lastProcessedBlock == null) return meta;

  const tip = await chain.getBlock(meta.lastProcessedBlock);
  if (!tip) {
    await store.truncateAll();
    return null;
  }
  if (tip.hash === meta.lastProcessedHash) return meta;

  const ancestor = await findCommonAncestor(chain, store, meta.lastProcessedBlock, meta.startBlock);
  if (ancestor == null) {
    await store.truncateAll();
    return null;
  }
  await rewind(store, ancestor);
  return store.getMeta();
}

async function findCommonAncestor(
  chain: ChainReader,
  store: IndexStore,
  fromHeight: number,
  startBlock: number,
): Promise<number | null> {
  for (let height = fromHeight; height >= startBlock; height -= 1) {
    const stored = await store.getBlock(height);
    if (!stored) continue;
    const node = await chain.getBlock(height);
    if (!node) return null;
    if (node.hash === stored.hash) return height;
  }
  return null;
}

async function rewind(store: IndexStore, ancestor: number): Promise<void> {
  await store.transaction(async (tx) => {
    await tx.deleteBlocksAbove(ancestor);
    await tx.deleteLogsAbove(ancestor);
    await tx.deleteProjection();
    await tx.markAllLogsUnapplied();
    await applyUnapplied(tx);
    const block = await tx.getBlock(ancestor);
    if (!block) throw new Error("Common ancestor is missing");
    await tx.updateCursor(ancestor, block.hash);
  });
}

async function ingest(
  store: IndexStore,
  chain: ChainReader,
  config: SyncConfig,
  fromBlock: number,
  toBlock: number,
  metaExists: boolean,
): Promise<void> {
  await store.transaction(async (tx) => {
    let startHash: string | null = null;
    let tipHash: string | null = null;
    for (let number = fromBlock; number <= toBlock; number += 1) {
      const header = await chain.getBlock(number);
      if (!header) throw new Error(`Block ${number} was not found`);
      if (number === config.startBlock) startHash = header.hash;
      if (number === toBlock) tipHash = header.hash;
      await tx.insertBlock(header);
    }

    for (const [start, end] of blockRanges(fromBlock, toBlock)) {
      const rawLogs = [...(await chain.getLogs(start, end))].sort(compareRawLogs);
      for (const raw of rawLogs) {
        if (raw.blockNumber < start || raw.blockNumber > end) continue;
        const decoded = decodeProductLog(raw);
        if (decoded === "ignore") continue;
        if (decoded === "invalid") throw new DecodePauseError();
        const stored = await tx.getBlock(decoded.blockNumber);
        if (!stored || stored.hash !== decoded.blockHash) {
          throw new Error(`Log at block ${decoded.blockNumber} does not match the stored header`);
        }
        await tx.insertLog(decoded);
      }
    }

    if (!metaExists) {
      if (startHash == null) throw new Error("Start block was not stored");
      await tx.insertMeta({
        chainId: config.chainId,
        contractAddress: config.contractAddress,
        startBlock: config.startBlock,
        startBlockHash: startHash,
        lastProcessedBlock: null,
        lastProcessedHash: null,
      });
    }

    await applyUnapplied(tx);
    if (tipHash == null) throw new Error("Safe head was not stored");
    await tx.updateCursor(toBlock, tipHash);
  });
}

function compareRawLogs(left: RawLog, right: RawLog): number {
  return left.blockNumber - right.blockNumber || left.logIndex - right.logIndex;
}

async function readHead(chain: ChainReader): Promise<number | null> {
  try {
    return await chain.getHeadBlock();
  } catch {
    return null;
  }
}
