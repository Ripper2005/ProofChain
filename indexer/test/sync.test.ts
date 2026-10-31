import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyLog } from "../src/apply.ts";
import type { BatchRegisteredPayload } from "../src/events.ts";
import { MemoryStore } from "../src/memory-store.ts";
import { blockRanges, resync, syncOnce, type SyncState } from "../src/sync.ts";
import { FakeChain, hexWord } from "./fake-chain.ts";
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

describe("block ranges", () => {
  it("keeps each eth_getLogs span to 2000 blocks", () => {
    assert.deepEqual(blockRanges(0, 1999), [[0, 1999]]);
    assert.deepEqual(blockRanges(0, 2000), [
      [0, 1999],
      [2000, 2000],
    ]);
    assert.deepEqual(blockRanges(5, 5), [[5, 5]]);
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
