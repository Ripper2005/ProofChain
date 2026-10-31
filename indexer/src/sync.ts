import { applyUnapplied } from "./apply.ts";
import type { SyncConfig } from "./config.ts";
import { decodeProductLog, type DecodedLog, type RawLog } from "./events.ts";
import { shrinksLogRange, type BlockHeader, type ChainReader } from "./chain.ts";
import type { IndexerMeta, IndexStore } from "./store.ts";

const HEADER_BATCH = 8;

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
  if (!start || start.hash !== meta.startBlockHash) return truncate(store);
  if (meta.lastProcessedBlock == null) return meta;

  const tip = await chain.getBlock(meta.lastProcessedBlock);
  if (!tip) return truncate(store);
  if (tip.hash === meta.lastProcessedHash) return meta;

  const ancestor = await findCommonAncestor(chain, store, meta.lastProcessedBlock);
  if (ancestor == null) return truncate(store);
  // A cursor left between ranges of a catch-up has no header of its own. It stands while the newest stored header below it still matches.
  if (meta.lastProcessedHash == null && ancestor.newest) return meta;
  await rewind(store, ancestor.number);
  return store.getMeta();
}

async function truncate(store: IndexStore): Promise<null> {
  await store.truncateAll();
  return null;
}

async function findCommonAncestor(
  chain: ChainReader,
  store: IndexStore,
  fromHeight: number,
): Promise<{ number: number; newest: boolean } | null> {
  let newest = true;
  for (let stored = await store.getBlockAtOrBelow(fromHeight); stored; stored = await store.getBlockAtOrBelow(stored.number - 1)) {
    const node = await chain.getBlock(stored.number);
    if (!node) return null;
    if (node.hash === stored.hash) return { number: stored.number, newest };
    newest = false;
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
  safeHead: number,
  metaExists: boolean,
): Promise<void> {
  const windowStart = Math.max(config.startBlock, safeHead - config.reorgWindow + 1);
  let size = config.logRange;
  let hasMeta = metaExists;
  let start = fromBlock;
  while (start <= safeHead) {
    const end = Math.min(safeHead, start + size - 1);
    let rawLogs: RawLog[];
    try {
      rawLogs = await chain.getLogs(start, end);
    } catch (error) {
      if (end > start && shrinksLogRange(error)) {
        size = Math.floor((end - start + 1) / 2);
        continue;
      }
      throw error;
    }
    const logs = productLogs(rawLogs, start, end);

    const needed = new Set<number>(logs.map((log) => log.blockNumber));
    if (!hasMeta) needed.add(config.startBlock);
    for (let number = Math.max(start, windowStart); number <= end; number += 1) needed.add(number);
    const headers = await fetchHeaders(chain, [...needed].sort((left, right) => left - right));
    for (const log of logs) {
      if (headers.get(log.blockNumber)?.hash !== log.blockHash) {
        throw new Error(`Log at block ${log.blockNumber} does not match its header`);
      }
    }

    await store.transaction(async (tx) => {
      for (const header of headers.values()) await tx.insertBlock(header);
      for (const log of logs) await tx.insertLog(log);
      if (!hasMeta) {
        const startHeader = headers.get(config.startBlock);
        if (!startHeader) throw new Error("Start block was not stored");
        await tx.insertMeta({
          chainId: config.chainId,
          contractAddress: config.contractAddress,
          startBlock: config.startBlock,
          startBlockHash: startHeader.hash,
          lastProcessedBlock: null,
          lastProcessedHash: null,
        });
      }
      await applyUnapplied(tx);
      await tx.pruneBlocks(windowStart, config.startBlock);
      await tx.updateCursor(end, headers.get(end)?.hash ?? null);
    });
    hasMeta = true;
    start = end + 1;
  }
}

function productLogs(rawLogs: RawLog[], start: number, end: number): DecodedLog[] {
  const logs: DecodedLog[] = [];
  for (const raw of [...rawLogs].sort(compareRawLogs)) {
    if (raw.blockNumber < start || raw.blockNumber > end) continue;
    const decoded = decodeProductLog(raw);
    if (decoded === "ignore") continue;
    if (decoded === "invalid") throw new DecodePauseError();
    logs.push(decoded);
  }
  return logs;
}

async function fetchHeaders(chain: ChainReader, numbers: number[]): Promise<Map<number, BlockHeader>> {
  const headers = new Map<number, BlockHeader>();
  for (let index = 0; index < numbers.length; index += HEADER_BATCH) {
    const batch = await Promise.all(numbers.slice(index, index + HEADER_BATCH).map((number) => chain.getBlock(number)));
    for (const [offset, header] of batch.entries()) {
      const number = numbers[index + offset];
      if (number == null) continue;
      if (!header) throw new Error(`Block ${number} was not found`);
      headers.set(number, header);
    }
  }
  return headers;
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
