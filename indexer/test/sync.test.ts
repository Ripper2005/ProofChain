import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyLog } from "../src/apply.ts";
import type { BatchRegisteredPayload } from "../src/events.ts";
import { MemoryStore } from "../src/memory-store.ts";
import type { IndexStore } from "../src/store.ts";
import { resync, syncOnce, type SyncState } from "../src/sync.ts";
import { FakeChain, hexWord, rangeRejection, rateLimited, requestTimeout } from "./fake-chain.ts";
import {
  ACCEPTED,
  accountB,
  accountC,
  addProductLog,
  batchCode,
  batchId,
  CANCELLED,
  CREATED,
  document,
  GOLDEN_BATCH_ID,
  manufacturer,
  metadataCid,
  metadataHash,
  PROPOSED,
  PROPOSED_AGAIN,
  recaller,
  RECALLED,
  testConfig,
  unix,
} from "./fixture.ts";

class CountingStore extends MemoryStore {
  commits: Array<{ block: number | null; hash: string | null }> = [];

  async transaction<T>(fn: (tx: IndexStore) => Promise<T>): Promise<T> {
    const result = await super.transaction(fn);
    this.commits.push({ block: this.meta?.lastProcessedBlock ?? null, hash: this.meta?.lastProcessedHash ?? null });
    return result;
  }
}

const WINDOW = heights(99_937, 100_000);

describe("catch-up", () => {
  it("a catch-up across 100,000 blocks with three product logs fetches headers only for those blocks, the start block, and the window, and commits per range", async () => {
    const { chain, store, config } = longChain();
    await expectSync(store, chain, config, { paused: false });

    assert.deepEqual(chain.logRanges, [
      [1, 50_000],
      [50_001, 100_000],
    ]);
    assert.deepEqual(chain.blockReads, [1, 7, 50_001, ...WINDOW]);
    assert.deepEqual(store.commits, [
      { block: 50_000, hash: null },
      { block: 100_000, hash: chain.hashOf(100_000) },
    ]);
    assert.deepEqual(storedHeights(store), [1, 7, 50_001, ...WINDOW]);
    assert.equal((await store.getMeta())?.startBlockHash, chain.hashOf(1));
    assert.equal((await store.getBatchById(batchId))?.currentCustodian, accountB);
    assert.equal((await store.listCustody(batchId)).length, 1);

    chain.blockReads = [];
    chain.logRanges = [];
    chain.head = 100_070;
    await expectSync(store, chain, config, { paused: false });
    assert.deepEqual(chain.logRanges, [[100_001, 100_070]]);
    assert.deepEqual(chain.blockReads, [1, 100_000, ...heights(100_007, 100_070)]);
    assert.deepEqual(storedHeights(store), [1, 7, 50_001, 99_990, ...heights(100_007, 100_070)]);
    assert.equal((await store.getMeta())?.lastProcessedHash, chain.hashOf(100_070));
  });

  it("a failure in a later range keeps the earlier ranges and the next tick continues from them", async () => {
    const { chain, store, config } = longChain();
    const state: SyncState = { paused: false };
    chain.logFailure = (fromBlock) => (fromBlock > 50_000 ? new Error("rpc down") : undefined);
    const failed = await syncOnce(store, chain, config, state);
    assert.equal(failed.syncOk, false);
    assert.equal(failed.reason, "rpc down");
    assert.equal(state.paused, false);
    assert.equal((await store.getMeta())?.lastProcessedBlock, 50_000);
    assert.equal((await store.getMeta())?.lastProcessedHash, null);
    assert.equal(store.logs.length, 1);
    assert.equal((await store.getBatchById(batchId))?.currentCustodian, manufacturer);
    assert.deepEqual(storedHeights(store), [1, 7]);

    chain.logFailure = undefined;
    chain.blockReads = [];
    chain.logRanges = [];
    await expectSync(store, chain, config, state);
    assert.deepEqual(chain.logRanges, [[50_001, 100_000]]);
    assert.deepEqual(chain.blockReads, [1, 50_000, 7, 50_001, ...WINDOW]);
    assert.equal(store.logs.length, 3);
    assert.equal((await store.getBatchById(batchId))?.currentCustodian, accountB);
    assert.equal((await store.getMeta())?.lastProcessedHash, chain.hashOf(100_000));
  });

  it("a cursor left between ranges rewinds when the newest stored header below it was replaced", async () => {
    const { chain, store, config } = longChain();
    chain.logFailure = (fromBlock) => (fromBlock > 50_000 ? new Error("rpc down") : undefined);
    assert.equal((await syncOnce(store, chain, config, { paused: false })).syncOk, false);
    const oldTx = store.logs[0]?.txHash;

    chain.logFailure = undefined;
    chain.setBlockHash(7, hexWord(4242));
    chain.logs = chain.logs.filter((log) => log.blockNumber !== 7);
    const moved = registration(chain, 9, 8, 0);
    await expectSync(store, chain, config, { paused: false });

    assert.equal((await store.listLogs()).some((log) => log.txHash === oldTx), false);
    assert.equal((await store.getBatchById(batchId))?.createdTx, moved);
    assert.equal((await store.getBatchById(batchId))?.createdBlock, 8);
    assert.equal((await store.getBatchById(batchId))?.currentCustodian, accountB);
    assert.equal(await store.getBlock(7), null);
    assert.equal((await store.getBlock(8))?.hash, chain.hashOf(8));
  });

  it("a reorg below the window walks only the stored headers to the common ancestor", async () => {
    const { chain, store, config } = longChain();
    await expectSync(store, chain, config, { paused: false });

    for (const height of [50_001, ...WINDOW]) chain.setBlockHash(height, hexWord(900_000 + height));
    chain.logs = chain.logs.filter((log) => log.blockNumber === 7);
    chain.blockReads = [];
    chain.logRanges = [];
    await expectSync(store, chain, config, { paused: false });

    assert.deepEqual(chain.blockReads, [1, 100_000, ...[...WINDOW].reverse(), 50_001, 7, ...WINDOW]);
    assert.deepEqual(chain.logRanges, [
      [8, 50_007],
      [50_008, 100_000],
    ]);
    assert.deepEqual(storedHeights(store), [1, 7, ...WINDOW]);
    assert.equal((await store.getBlock(100_000))?.hash, chain.hashOf(100_000));
    assert.equal((await store.listCustody(batchId)).length, 0);
    assert.equal((await store.getBatchById(batchId))?.currentCustodian, manufacturer);
    assert.equal(await store.getPending(batchId), null);
  });

  it("a range rejection halves the range and continues", async () => {
    const { chain, store, config } = longChain();
    chain.logFailure = (fromBlock, toBlock) => (toBlock - fromBlock + 1 > 20_000 ? rangeRejection(20_000) : undefined);
    await expectSync(store, chain, config, { paused: false });

    const accepted = Array.from({ length: 8 }, (_, index): [number, number] => [index * 12_500 + 1, (index + 1) * 12_500]);
    assert.deepEqual(chain.logRanges, [[1, 50_000], [1, 25_000], ...accepted]);
    assert.equal(store.commits.length, 8);
    assert.equal(store.logs.length, 3);
    assert.equal((await store.getMeta())?.lastProcessedBlock, 100_000);
    assert.equal((await store.getBatchById(batchId))?.currentCustodian, accountB);
  });

  it("a timeout halves the range and continues", async () => {
    const { chain, store, config } = longChain();
    let timedOut = false;
    chain.logFailure = () => {
      if (timedOut) return undefined;
      timedOut = true;
      return requestTimeout();
    };
    await expectSync(store, chain, config, { paused: false });

    assert.deepEqual(chain.logRanges, [
      [1, 50_000],
      [1, 25_000],
      [25_001, 50_000],
      [50_001, 75_000],
      [75_001, 100_000],
    ]);
    assert.equal(store.commits.length, 4);
    assert.equal((await store.getBatchById(batchId))?.currentCustodian, accountB);
  });

  it("reports a one-block range that still times out and does not shrink on a rate limit", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore();
    registration(chain, 1, 0, 0);
    chain.logFailure = () => requestTimeout();
    const timedOut = await syncOnce(store, chain, testConfig(), { paused: false });
    assert.equal(timedOut.syncOk, false);
    assert.deepEqual(chain.logRanges, [[0, 0]]);
    assert.equal(store.meta, null);

    chain.head = 3;
    chain.logRanges = [];
    chain.logFailure = () => rateLimited();
    const limited = await syncOnce(store, chain, testConfig(), { paused: false });
    assert.equal(limited.syncOk, false);
    assert.deepEqual(chain.logRanges, [[0, 3]]);
    assert.equal(store.meta, null);
  });
});

describe("projection", () => {
  it("applying the five events in order produces the registration, one pending handoff, an accepted handoff, and a recall that clears a pending handoff", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore();
    const state: SyncState = { paused: false };
    const config = testConfig();
    assert.equal(batchId, GOLDEN_BATCH_ID);

    const registered = registration(chain, 1, 0, 0);
    chain.head = 0;
    await expectSync(store, chain, config, state);
    const created = await store.getBatchById(batchId);
    assert.ok(created);
    assert.equal(created.status, "active");
    assert.equal(created.manufacturer, manufacturer);
    assert.equal(created.currentCustodian, manufacturer);
    assert.equal(created.batchCode, batchCode);
    assert.equal(created.metadataHash, metadataHash);
    assert.equal(created.metadataCid, metadataCid);
    assert.equal(created.createdAt, unix(CREATED));
    assert.equal(created.createdTx, registered);
    assert.equal(await store.getPending(batchId), null);
    assert.equal((await store.listCustody(batchId)).length, 0);

    addProductLog(chain, 2, 1, 0, "CustodyTransferProposed", {
      batchId,
      from: manufacturer,
      to: accountB,
      proposedAt: unix(PROPOSED),
    });
    chain.head = 1;
    await expectSync(store, chain, config, state);
    const pending = await store.getPending(batchId);
    assert.ok(pending);
    assert.equal(pending.fromAddress, manufacturer);
    assert.equal(pending.toAddress, accountB);
    assert.equal(pending.proposedAt, unix(PROPOSED));

    addProductLog(chain, 3, 2, 0, "CustodyTransferCancelled", {
      batchId,
      from: manufacturer,
      to: accountB,
      cancelledAt: unix(CANCELLED),
    });
    chain.head = 2;
    await expectSync(store, chain, config, state);
    assert.equal(await store.getPending(batchId), null);

    addProductLog(chain, 4, 3, 0, "CustodyTransferProposed", {
      batchId,
      from: manufacturer,
      to: accountB,
      proposedAt: unix(PROPOSED),
    });
    const accepted = addProductLog(chain, 5, 4, 0, "CustodyTransferred", {
      batchId,
      from: manufacturer,
      to: accountB,
      timestamp: unix(ACCEPTED),
    });
    chain.head = 4;
    await expectSync(store, chain, config, state);
    assert.equal((await store.getBatchById(batchId))?.currentCustodian, accountB);
    assert.equal(await store.getPending(batchId), null);
    const history = await store.listCustody(batchId);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.fromAddress, manufacturer);
    assert.equal(history[0]?.toAddress, accountB);
    assert.equal(history[0]?.acceptedAt, unix(ACCEPTED));
    assert.equal(history[0]?.txHash, accepted);

    addProductLog(chain, 6, 5, 0, "CustodyTransferProposed", {
      batchId,
      from: accountB,
      to: accountC,
      proposedAt: unix(PROPOSED_AGAIN),
    });
    chain.head = 5;
    await expectSync(store, chain, config, state);
    assert.equal((await store.getPending(batchId))?.toAddress, accountC);

    addProductLog(chain, 7, 6, 0, "BatchRecalled", {
      batchId,
      recalledBy: recaller,
      pendingCleared: true,
      recalledAt: unix(RECALLED),
      reason: "contactor fault",
    });
    chain.head = 6;
    await expectSync(store, chain, config, state);

    const recalled = await store.getBatchById(batchId);
    assert.ok(recalled);
    assert.equal(recalled.status, "recalled");
    assert.equal(recalled.recallReason, "contactor fault");
    assert.equal(recalled.recallPendingCleared, true);
    assert.equal(recalled.recalledAt, unix(RECALLED));
    assert.equal(recalled.currentCustodian, accountB);
    assert.equal(recalled.manufacturer, manufacturer);
    assert.equal(await store.getPending(batchId), null);
    assert.equal((await store.listCustody(batchId)).length, 1);
    assert.deepEqual(
      [...new Set((await store.listLogs()).map((log) => log.eventName))].sort(),
      [
        "BatchRecalled",
        "BatchRegistered",
        "CustodyTransferCancelled",
        "CustodyTransferProposed",
        "CustodyTransferred",
      ],
    );
    assert.equal(chain.blockReads.includes(-1), false);
    assert.equal((await store.getBlock(2))?.hash, chain.hashOf(2));
  });

  it("applying the same log twice does not duplicate history", async () => {
    const { store, chain, config, state, accepted } = await projectAccepted();
    assert.equal((await store.listCustody(batchId)).length, 1);

    await expectSync(store, chain, config, state);
    assert.equal((await store.listCustody(batchId)).length, 1);
    assert.equal(store.batches.size, 1);

    const logs = await store.listLogs();
    const registered = logs.find((log) => log.eventName === "BatchRegistered");
    const transferred = logs.find((log) => log.txHash === accepted);
    assert.ok(registered && transferred);
    assert.equal((registered.payload as BatchRegisteredPayload).document, document);
    await applyLog(store, registered);
    await applyLog(store, transferred);
    await applyLog(store, transferred);
    assert.equal(store.batches.size, 1);
    assert.equal((await store.listCustody(batchId)).length, 1);

    await store.markAllLogsUnapplied();
    await expectSync(store, chain, config, state);
    assert.equal(store.batches.size, 1);
    assert.equal((await store.listCustody(batchId)).length, 1);
    assert.equal((await store.getBatchById(batchId))?.status, "active");
    assert.equal((await store.getBatchById(batchId))?.currentCustodian, accountB);
    assert.equal(await store.getPending(batchId), null);
  });

  it("a replaced tip is rewound and the surviving history is replayed", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore();
    const state: SyncState = { paused: false };
    const config = testConfig({ startBlock: 1 });
    registration(chain, 1, 1, 0);
    addProductLog(chain, 2, 2, 0, "CustodyTransferProposed", {
      batchId,
      from: manufacturer,
      to: accountB,
      proposedAt: unix(PROPOSED),
    });
    const kept = addProductLog(chain, 3, 2, 1, "CustodyTransferred", {
      batchId,
      from: manufacturer,
      to: accountB,
      timestamp: unix(ACCEPTED),
    });
    addProductLog(chain, 4, 3, 0, "CustodyTransferProposed", {
      batchId,
      from: accountB,
      to: accountC,
      proposedAt: unix(PROPOSED_AGAIN),
    });
    const dropped = addProductLog(chain, 5, 3, 1, "CustodyTransferred", {
      batchId,
      from: accountB,
      to: accountC,
      timestamp: unix(RECALLED),
    });
    chain.head = 3;
    await expectSync(store, chain, config, state);
    assert.equal((await store.listCustody(batchId)).length, 2);
    assert.equal((await store.getBatchById(batchId))?.currentCustodian, accountC);
    assert.equal(await store.getPending(batchId), null);
    assert.equal(await store.getBlock(0), null);

    const replacement = hexWord(4242);
    chain.setBlockHash(3, replacement);
    chain.logs = chain.logs.filter((log) => log.blockNumber !== 3);
    await expectSync(store, chain, config, state);

    const history = await store.listCustody(batchId);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.txHash, kept);
    assert.equal(history[0]?.toAddress, accountB);
    assert.equal((await store.listLogs()).some((log) => log.txHash === dropped), false);
    assert.equal((await store.listLogs()).some((log) => log.txHash === kept), true);
    assert.equal((await store.getBatchById(batchId))?.currentCustodian, accountB);
    assert.equal((await store.getBatchById(batchId))?.manufacturer, manufacturer);
    assert.equal(await store.getPending(batchId), null);
    assert.equal((await store.getBlock(3))?.hash, replacement);
    assert.equal((await store.getBlock(2))?.hash, chain.hashOf(2));
    assert.equal((await store.getMeta())?.lastProcessedBlock, 3);
  });

  it("a changed start block hash truncates the projection and starts again", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore();
    const state: SyncState = { paused: false };
    const config = testConfig({ startBlock: 1 });
    const oldTx = registration(chain, 1, 1, 0);
    chain.head = 2;
    await expectSync(store, chain, config, state);
    const previousHash = (await store.getMeta())?.startBlockHash;
    assert.equal(previousHash, chain.hashOf(1));
    assert.ok(await store.getBatchByCode(batchCode));

    chain.reset(9);
    chain.head = 2;
    const otherCode = "ALT-2026-002";
    addProductLog(chain, 8, 1, 0, "BatchRegistered", {
      batchId: "0x" + "44".repeat(32),
      manufacturer,
      batchCode: otherCode,
      metadataHash,
      metadataCid,
      createdAt: unix(CREATED),
      document,
    });
    await expectSync(store, chain, config, state);

    assert.equal(await store.getBatchByCode(batchCode), null);
    assert.ok(await store.getBatchByCode(otherCode));
    assert.equal(store.batches.size, 1);
    assert.notEqual((await store.getMeta())?.startBlockHash, previousHash);
    assert.equal((await store.getMeta())?.startBlockHash, chain.hashOf(1));
    assert.equal((await store.listLogs()).some((log) => log.txHash === oldTx), false);
    assert.equal((await store.listLogs()).length, 1);
    assert.equal((await store.getMeta())?.lastProcessedBlock, 2);
  });
});

describe("sync rules", () => {
  it("stores headers that contain no product logs and ignores other topics", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore();
    chain.logs.push({
      blockNumber: 0,
      blockHash: chain.hashOf(0),
      transactionHash: hexWord(99),
      logIndex: 0,
      topics: [hexWord(99)],
      data: "0x",
    });
    registration(chain, 1, 0, 1);
    addProductLog(chain, 2, 2, 0, "BatchRecalled", {
      batchId,
      recalledBy: recaller,
      pendingCleared: false,
      recalledAt: unix(RECALLED),
      reason: "contactor fault",
    });
    chain.head = 2;
    await expectSync(store, chain, testConfig(), { paused: false });
    assert.equal((await store.getBlock(1))?.hash, chain.hashOf(1));
    assert.equal((await store.listLogs()).length, 2);
    assert.equal((await store.listLogs()).some((log) => log.logIndex === 0 && log.blockNumber === 0), false);
  });

  it("does not read before the start block or past the safe head", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore();
    const config = testConfig({ startBlock: 4, confirmations: 2 });
    registration(chain, 1, 4, 0);
    addProductLog(chain, 2, 6, 0, "BatchRecalled", {
      batchId,
      recalledBy: recaller,
      pendingCleared: false,
      recalledAt: unix(RECALLED),
      reason: "later",
    });
    chain.head = 6;
    await expectSync(store, chain, config, { paused: false });
    assert.equal(chain.blockReads.includes(3), false);
    assert.equal(chain.blockReads.includes(5), false);
    assert.equal(chain.blockReads.includes(6), false);
    assert.deepEqual(chain.logRanges, [[4, 4]]);
    assert.ok(await store.getBlock(4));
    assert.equal(await store.getBlock(5), null);
    assert.equal((await store.getBatchById(batchId))?.status, "active");
    assert.equal((await store.getMeta())?.lastProcessedBlock, 4);
  });

  it("waits while the head is below the confirmation depth", async () => {
    const chain = new FakeChain();
    chain.head = 1;
    const snapshot = await syncOnce(new MemoryStore(), chain, testConfig({ confirmations: 2 }), { paused: false });
    assert.equal(snapshot.syncOk, true);
    assert.equal(snapshot.headBlock, 1);
    assert.equal(chain.logRanges.length, 0);
  });

  it("truncates when the processed tip disappears and indexes the new chain", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore();
    const config = testConfig();
    registration(chain, 1, 0, 0);
    addProductLog(chain, 2, 2, 0, "CustodyTransferred", {
      batchId,
      from: manufacturer,
      to: accountB,
      timestamp: unix(ACCEPTED),
    });
    chain.head = 2;
    await expectSync(store, chain, config, { paused: false });
    assert.equal((await store.listCustody(batchId)).length, 1);

    chain.head = 1;
    await expectSync(store, chain, config, { paused: false });
    assert.equal((await store.listCustody(batchId)).length, 0);
    assert.equal((await store.getBatchById(batchId))?.currentCustodian, manufacturer);
    assert.equal(await store.getBlock(2), null);
    assert.equal((await store.getMeta())?.lastProcessedBlock, 1);
  });

  it("truncates when no stored block hash still matches", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore();
    const config = testConfig();
    registration(chain, 1, 0, 0);
    chain.head = 1;
    await expectSync(store, chain, config, { paused: false });
    for (const block of store.blocks.values()) block.hash = hexWord(50 + block.number);
    assert.ok(store.meta);
    store.meta.lastProcessedHash = hexWord(8);

    await expectSync(store, chain, config, { paused: false });
    assert.equal((await store.getBlock(0))?.hash, chain.hashOf(0));
    assert.equal((await store.getBlock(1))?.hash, chain.hashOf(1));
    assert.ok(await store.getBatchById(batchId));
    assert.equal((await store.getMeta())?.startBlockHash, chain.hashOf(0));
  });

  it("refuses a chain or contract change without truncating", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore();
    const config = testConfig();
    registration(chain, 1, 0, 0);
    chain.head = 0;
    await expectSync(store, chain, config, { paused: false });
    addProductLog(chain, 2, 1, 0, "BatchRecalled", {
      batchId,
      recalledBy: recaller,
      pendingCleared: false,
      recalledAt: unix(RECALLED),
      reason: "contactor fault",
    });
    chain.head = 1;

    const switched = await syncOnce(store, chain, testConfig({ chainId: 1 }), { paused: false });
    assert.equal(switched.syncOk, false);
    assert.equal((await store.getBatchById(batchId))?.status, "active");
    assert.equal((await store.getMeta())?.chainId, 31337);
    assert.equal((await store.listLogs()).length, 1);

    chain.chainId = 1;
    const rpcSwitched = await syncOnce(store, chain, testConfig(), { paused: false });
    assert.equal(rpcSwitched.syncOk, false);
    assert.equal((await store.listLogs()).length, 1);
    chain.chainId = 31337;

    const otherContract = await syncOnce(
      store,
      chain,
      testConfig({ contractAddress: `0x${"cd".repeat(20)}` }),
      { paused: false },
    );
    assert.equal(otherContract.syncOk, false);
    assert.equal((await store.listLogs()).length, 1);
  });

  it("does not resync onto a different chain or contract", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore();
    registration(chain, 1, 0, 0);
    chain.head = 0;
    await expectSync(store, chain, testConfig(), { paused: false });

    assert.equal(await resync(store, testConfig({ chainId: 1 })), "mismatch");
    assert.ok(await store.getBatchById(batchId));
    assert.equal(await resync(store, testConfig()), "reset");
    assert.equal(store.batches.size, 0);
    assert.equal(store.meta, null);
    await expectSync(store, chain, testConfig(), { paused: false });
    assert.ok(await store.getBatchById(batchId));
  });

  it("pauses when a product topic fails to decode and does not keep a partial projection", async () => {
    const chain = new FakeChain();
    const store = new MemoryStore();
    const state: SyncState = { paused: false };
    registration(chain, 1, 0, 0);
    const sample = chain.logs[0];
    assert.ok(sample);
    chain.logs.push({ ...sample, logIndex: 1, transactionHash: hexWord(77), data: "0x" });
    chain.head = 0;

    const failed = await syncOnce(store, chain, testConfig(), state);
    assert.equal(failed.syncOk, false);
    assert.equal(failed.reason, "product log failed to decode");
    assert.equal(state.paused, true);
    assert.equal(store.batches.size, 0);
    assert.equal(store.logs.length, 0);

    chain.logs.pop();
    const stillPaused = await syncOnce(store, chain, testConfig(), state);
    assert.equal(stillPaused.syncOk, false);
    assert.equal(store.batches.size, 0);

    await expectSync(store, chain, testConfig(), { paused: false });
    assert.equal(store.batches.size, 1);
  });

  it("keeps running when the rpc is down", async () => {
    const chain = new FakeChain();
    chain.fail = true;
    const failed = await syncOnce(new MemoryStore(), chain, testConfig(), { paused: false });
    assert.equal(failed.syncOk, false);
    assert.equal(failed.headBlock, null);
    assert.equal(failed.reason, "rpc unavailable");
  });
});

function longChain(): { chain: FakeChain; store: CountingStore; config: ReturnType<typeof testConfig> } {
  const chain = new FakeChain();
  registration(chain, 1, 7, 0);
  addProductLog(chain, 2, 50_001, 0, "CustodyTransferProposed", {
    batchId,
    from: manufacturer,
    to: accountB,
    proposedAt: unix(PROPOSED),
  });
  addProductLog(chain, 3, 99_990, 0, "CustodyTransferred", {
    batchId,
    from: manufacturer,
    to: accountB,
    timestamp: unix(ACCEPTED),
  });
  chain.head = 100_000;
  return { chain, store: new CountingStore(), config: testConfig({ startBlock: 1 }) };
}

function heights(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function storedHeights(store: MemoryStore): number[] {
  return [...store.blocks.keys()].sort((left, right) => left - right);
}

function registration(chain: FakeChain, tx: number, blockNumber: number, logIndex: number): string {
  return addProductLog(chain, tx, blockNumber, logIndex, "BatchRegistered", {
    batchId,
    manufacturer,
    batchCode,
    metadataHash,
    metadataCid,
    createdAt: unix(CREATED),
    document,
  });
}

async function expectSync(
  store: MemoryStore,
  chain: FakeChain,
  config: ReturnType<typeof testConfig>,
  state: SyncState,
): Promise<void> {
  const snapshot = await syncOnce(store, chain, config, state);
  assert.equal(snapshot.syncOk, true, snapshot.reason ?? "sync failed");
}

async function projectAccepted(): Promise<{
  store: MemoryStore;
  chain: FakeChain;
  config: ReturnType<typeof testConfig>;
  state: SyncState;
  accepted: string;
}> {
  const chain = new FakeChain();
  const store = new MemoryStore();
  const state: SyncState = { paused: false };
  const config = testConfig();
  registration(chain, 1, 0, 0);
  addProductLog(chain, 2, 1, 0, "CustodyTransferProposed", {
    batchId,
    from: manufacturer,
    to: accountB,
    proposedAt: unix(PROPOSED),
  });
  const accepted = addProductLog(chain, 3, 2, 0, "CustodyTransferred", {
    batchId,
    from: manufacturer,
    to: accountB,
    timestamp: unix(ACCEPTED),
  });
  chain.head = 2;
  await expectSync(store, chain, config, state);
  return { store, chain, config, state, accepted };
}
