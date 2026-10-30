import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp } from "../src/api.ts";
import { MemoryStore } from "../src/memory-store.ts";
import { syncOnce, type SyncState } from "../src/sync.ts";
import { FakeChain } from "./fake-chain.ts";
import {
  ACCEPTED,
  accountB,
  accountC,
  addProductLog,
  batchCode,
  batchId,
  CANCELLED,
  CREATED,
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

describe("HTTP API", () => {
  it("returns the batch, its history, and dashboard filters", async () => {
    const store = new MemoryStore();
    const chain = new FakeChain();
    const registered = addProductLog(chain, 1, 0, 0, "BatchRegistered", {
      batchId,
      manufacturer,
      batchCode,
      metadataHash,
      metadataCid,
      createdAt: unix(CREATED),
    });
    addProductLog(chain, 2, 1, 0, "CustodyTransferProposed", {
      batchId,
      from: manufacturer,
      to: accountB,
      proposedAt: unix(PROPOSED),
    });
    addProductLog(chain, 3, 2, 0, "CustodyTransferCancelled", {
      batchId,
      from: manufacturer,
      to: accountB,
      cancelledAt: unix(CANCELLED),
    });
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
    addProductLog(chain, 6, 5, 0, "CustodyTransferProposed", {
      batchId,
      from: accountB,
      to: accountC,
      proposedAt: unix(PROPOSED_AGAIN),
    });
    addProductLog(chain, 7, 6, 0, "BatchRecalled", {
      batchId,
      recalledBy: recaller,
      pendingCleared: true,
      recalledAt: unix(RECALLED),
      reason: "contactor fault",
    });
    chain.head = 6;
    await syncOk(store, chain);

    const app = createApp({
      store,
      status: () => ({ syncOk: true, headBlock: 6 }),
      pinOk: async () => true,
      webOrigin: "http://localhost:5173",
    });
    const expected = {
      batchId,
      batchCode,
      manufacturer,
      currentCustodian: accountB,
      metadataHash,
      metadataCid,
      status: "recalled",
      createdAt: CREATED,
      createdBlock: "0",
      createdTx: registered,
      recalledAt: RECALLED,
      recallReason: "contactor fault",
      recallPendingCleared: true,
      pending: null,
      history: [
        {
          from: manufacturer,
          to: accountB,
          timestamp: ACCEPTED,
          blockNumber: "4",
          txHash: accepted,
        },
      ],
    };

    const byCode = await app.request(`/batches/${batchCode}`);
    assert.equal(byCode.status, 200);
    assert.deepEqual(await byCode.json(), expected);

    const byId = await app.request(`/batches/${batchId.toUpperCase()}`);
    assert.equal(byId.status, 200);
    assert.deepEqual(await byId.json(), expected);

    const history = await app.request(`/batches/${batchCode}/history`);
    assert.deepEqual(await history.json(), expected.history);

    const missedCase = await app.request("/batches/pcb-2026-001");
    assert.equal(missedCase.status, 404);

    const listed = await app.request(`/batches?participant=${manufacturer.toUpperCase()}&status=recalled&q=PCB`);
    assert.equal(listed.status, 200);
    assert.deepEqual(await listed.json(), [expected]);

    const active = await app.request("/batches?status=active");
    assert.deepEqual(await active.json(), []);
    const prefixMiss = await app.request("/batches?q=pcb");
    assert.deepEqual(await prefixMiss.json(), []);
    const stranger = await app.request(`/batches?participant=${accountC}`);
    assert.deepEqual(await stranger.json(), []);
    const stillVisible = await app.request(`/batches?participant=${manufacturer}&q=${accountB}`);
    assert.equal((await stillVisible.json() as unknown[]).length, 1);

    const health = await app.request("/health", { headers: { origin: "http://localhost:5173" } });
    assert.equal(health.headers.get("access-control-allow-origin"), "http://localhost:5173");
    assert.deepEqual(await health.json(), {
      ok: true,
      syncOk: true,
      pinOk: true,
      lastProcessedBlock: "6",
      headBlock: "6",
    });

    const otherOrigin = await app.request("/health", { headers: { origin: "http://evil.test" } });
    assert.notEqual(otherOrigin.headers.get("access-control-allow-origin"), "http://evil.test");
  });

  it("shows a pending recipient to that account and reports a paused sync", async () => {
    const store = new MemoryStore();
    const chain = new FakeChain();
    addProductLog(chain, 1, 0, 0, "BatchRegistered", {
      batchId,
      manufacturer,
      batchCode,
      metadataHash,
      metadataCid,
      createdAt: unix(CREATED),
    });
    const proposed = addProductLog(chain, 2, 1, 0, "CustodyTransferProposed", {
      batchId,
      from: manufacturer,
      to: accountB,
      proposedAt: unix(PROPOSED),
    });
    chain.head = 1;
    await syncOk(store, chain);

    const app = createApp({
      store,
      status: () => ({ syncOk: false, headBlock: null }),
      pinOk: async () => false,
      webOrigin: "http://localhost:5173",
    });
    const matches = await app.request(`/batches?participant=${accountB}`);
    const body = (await matches.json()) as Array<{ pending: { to: string; proposedTx: string; proposedAt: string } }>;
    assert.equal(body.length, 1);
    assert.equal(body[0]?.pending.to, accountB);
    assert.equal(body[0]?.pending.proposedTx, proposed);
    assert.equal(body[0]?.pending.proposedAt, PROPOSED);

    const badStatus = await app.request("/batches?status=shipped");
    assert.equal(badStatus.status, 400);
    const missing = await app.request("/batches/0x" + "12".repeat(32) + "/history");
    assert.equal(missing.status, 404);
    const unknown = await app.request("/other");
    assert.equal(unknown.status, 404);
    assert.equal(((await unknown.json()) as { error: string }).error, "NotFound");

    const health = await app.request("/health");
    assert.deepEqual(await health.json(), {
      ok: false,
      syncOk: false,
      pinOk: false,
      lastProcessedBlock: "1",
      headBlock: null,
    });
  });
});

async function syncOk(store: MemoryStore, chain: FakeChain): Promise<void> {
  const state: SyncState = { paused: false };
  const snapshot = await syncOnce(store, chain, testConfig(), state);
  assert.equal(snapshot.syncOk, true, snapshot.reason ?? "sync failed");
}
