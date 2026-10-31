import assert from "node:assert/strict";
import test from "node:test";
import { stepPosition, stepText, verifyBatch } from "../src/index.ts";
import {
  A,
  B,
  C,
  CONTRACT,
  D,
  DEPLOYMENTS,
  eventLog,
  fakeFetch,
  fakeReader,
  GATEWAY,
  gatewayUrl,
  recalledChain,
  txHash,
} from "./fakes.ts";

test("the timeline lists registration, handoffs, and the recall oldest first with block, time, and transaction", async () => {
  const { chain, code, document, cid } = recalledChain();
  const result = await verifyBatch({
    chainId: 31337,
    contract: CONTRACT,
    batchCode: code,
    deployments: DEPLOYMENTS,
    readers: [fakeReader("http://only", chain)],
    gateways: [GATEWAY],
    fetch: fakeFetch({ [gatewayUrl(GATEWAY, cid)]: new TextEncoder().encode(document) }),
  });
  assert.equal(result.outcome.kind, "registered");
  if (result.outcome.kind !== "registered") return;
  const outcome = result.outcome;
  assert.deepEqual(
    outcome.timeline.map((step) => [step.kind, step.blockNumber, step.time, step.txHash]),
    [
      ["registered", 3n, 100n, txHash("r01 register")],
      ["proposed", 4n, 101n, txHash("r01 propose b")],
      ["accepted", 5n, 102n, txHash("r01 accept b")],
      ["proposed", 6n, 103n, txHash("r01 propose c")],
      ["accepted", 7n, 104n, txHash("r01 accept c")],
      ["recalled", 9n, 106n, txHash("r01 recall")],
    ],
  );
  const recall = outcome.timeline.at(-1);
  assert.equal(recall?.kind === "recalled" && recall.reason, "Damaged seal");
  assert.equal(stepText(recall!), `Recalled by ${A}, reason "Damaged seal"`);
  assert.match(stepPosition(outcome.timeline[0]!), /^1970-01-01T00:01:40\.000Z, block 3, 0x[0-9a-f]{64}$/);
  assert.equal(outcome.batch.status, "recalled");
  assert.equal(outcome.batch.currentCustodian, C);
  assert.equal(outcome.recall?.reason, "Damaged seal");
  assert.deepEqual(
    outcome.history.map((row) => [row.from, row.to, row.txHash]),
    [
      [A, B, txHash("r01 accept b")],
      [B, C, txHash("r01 accept c")],
    ],
  );
  assert.equal(outcome.historyDisagrees, false);
  assert.ok(!outcome.timeline.some((step) => "from" in step && step.from === D), "a reverted call leaves no step");
});

test("a cancellation is a step and the pending handoff is an open step at the end", async () => {
  const { chain, batchId, code, document, cid } = recalledChain();
  const batch = chain.batches.get(batchId)!;
  chain.batches.set(batchId, { ...batch, status: 1, pending: { from: C, to: D, proposedAt: 110n } });
  chain.logs = chain.logs.filter((log) => log.transactionHash !== txHash("r01 recall"));
  chain.logs.push(
    eventLog("CustodyTransferProposed", { batchId, from: C, to: A, proposedAt: 107n }, 9n, "propose a"),
    eventLog("CustodyTransferCancelled", { batchId, from: C, to: A, cancelledAt: 108n }, 10n, "cancel a"),
    eventLog("CustodyTransferProposed", { batchId, from: C, to: D, proposedAt: 110n }, 11n, "propose d"),
  );
  chain.head = 11n;
  const result = await verifyBatch({
    chainId: 31337,
    contract: CONTRACT,
    batchCode: code,
    deployments: DEPLOYMENTS,
    readers: [fakeReader("http://only", chain)],
    gateways: [GATEWAY],
    fetch: fakeFetch({ [gatewayUrl(GATEWAY, cid)]: new TextEncoder().encode(document) }),
  });
  assert.equal(result.outcome.kind, "registered");
  if (result.outcome.kind !== "registered") return;
  const kinds = result.outcome.timeline.map((step) => step.kind);
  assert.deepEqual(kinds.slice(-4), ["proposed", "cancelled", "proposed", "pending"]);
  const open = result.outcome.timeline.at(-1);
  assert.equal(open?.kind === "pending" && open.to, D);
  assert.equal(open?.txHash, txHash("propose d"));
  assert.equal(open?.blockNumber, 11n);
  assert.equal(result.outcome.pending?.txHash, txHash("propose d"));
  assert.equal(stepText(open!), `Open: the handoff from ${C} waits for ${D} to accept`);
});
