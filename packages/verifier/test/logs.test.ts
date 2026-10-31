import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LOG_SPAN,
  isRangeRejection,
  LogsUnavailable,
  PRODUCT_TOPICS,
  readLogsInChunks,
  ReaderTimeout,
  ReaderUnreachable,
  RpcError,
  verifyBatch,
} from "../src/index.ts";
import {
  CONTRACT,
  DEPLOYMENTS,
  fakeFetch,
  fakeReader,
  GATEWAY,
  gatewayUrl,
  recalledChain,
  txHash,
  type ReaderOptions,
} from "./fakes.ts";

function spans(calls: Array<[bigint, bigint]>): bigint[] {
  return calls.map(([from, to]) => to - from + 1n);
}

function contiguous(calls: Array<[bigint, bigint]>, from: bigint, to: bigint) {
  assert.equal(calls[0]?.[0], from);
  assert.equal(calls.at(-1)?.[1], to);
  for (let index = 1; index < calls.length; index += 1) {
    assert.equal(calls[index]?.[0], (calls[index - 1]?.[1] ?? 0n) + 1n);
  }
}

test("ranges start at 50,000 blocks and halve on a range rejection", async () => {
  assert.equal(DEFAULT_LOG_SPAN, 50_000n);
  const attempted: Array<[bigint, bigint]> = [];
  const accepted: Array<[bigint, bigint]> = [];
  await readLogsInChunks(
    async (from, to) => {
      attempted.push([from, to]);
      if (to - from + 1n > 20_000n) throw new RpcError(-32600, "exceed maximum block range: 20000", undefined);
      accepted.push([from, to]);
      return [];
    },
    1n,
    100_000n,
  );
  assert.deepEqual(spans(attempted).slice(0, 3), [50_000n, 25_000n, 12_500n]);
  assert.ok(spans(accepted).every((span) => span <= 12_500n));
  contiguous(accepted, 1n, 100_000n);
});

test("ranges also halve on a timeout, and three timeouts in a row give up on that reader", async () => {
  const attempted: Array<[bigint, bigint]> = [];
  const accepted: Array<[bigint, bigint]> = [];
  await readLogsInChunks(
    async (from, to) => {
      attempted.push([from, to]);
      if (to - from + 1n > 30_000n) throw new ReaderTimeout(8000);
      accepted.push([from, to]);
      return [];
    },
    0n,
    59_999n,
  );
  assert.deepEqual(spans(attempted).slice(0, 2), [50_000n, 25_000n]);
  contiguous(accepted, 0n, 59_999n);

  let calls = 0;
  await assert.rejects(
    readLogsInChunks(async () => {
      calls += 1;
      throw new ReaderTimeout(8000);
    }, 0n, 1_000_000n),
    LogsUnavailable,
  );
  assert.equal(calls, 3);
});

test("a transport failure does not keep splitting the range, and rate limits are not range rejections", async () => {
  let calls = 0;
  await assert.rejects(
    readLogsInChunks(async () => {
      calls += 1;
      throw new ReaderUnreachable("the request failed (connect ECONNREFUSED 127.0.0.1:8545)");
    }, 0n, 10n),
    LogsUnavailable,
  );
  assert.equal(calls, 1);
  assert.equal(isRangeRejection(new RpcError(-32005, "rate limit exceeded", undefined)), false);
  assert.equal(isRangeRejection(new RpcError(-32005, "query returned more than 10000 results", undefined)), true);
});

test("logs are filtered by contract, the five product topics, and the batch id, from startBlock to the anchor", async () => {
  const { chain, batchId, code, document, cid } = recalledChain();
  const calls: NonNullable<ReaderOptions["calls"]> = [];
  const result = await verifyBatch({
    chainId: 31337,
    contract: CONTRACT,
    batchCode: code,
    deployments: DEPLOYMENTS,
    readers: [fakeReader("http://only", chain, { calls })],
    gateways: [GATEWAY],
    fetch: fakeFetch({ [gatewayUrl(GATEWAY, cid)]: new TextEncoder().encode(document) }),
  });
  const getLogs = calls.filter((call) => call.method === "eth_getLogs");
  assert.equal(getLogs.length, 1);
  assert.deepEqual(getLogs[0]?.params[0], {
    address: CONTRACT,
    topics: [PRODUCT_TOPICS, batchId],
    fromBlock: "0x1",
    toBlock: "0x9",
  });
  assert.equal(PRODUCT_TOPICS.length, 5);
  assert.equal(result.outcome.kind, "registered");
  if (result.outcome.kind !== "registered") return;
  assert.deepEqual(result.outcome.logs, { status: "loaded", reader: "http://only", count: 6 });
});

test("the logs come from the next agreeing reader when the first one fails", async () => {
  const { chain, code, document, cid } = recalledChain();
  const result = await verifyBatch({
    chainId: 31337,
    contract: CONTRACT,
    batchCode: code,
    deployments: DEPLOYMENTS,
    readers: [
      fakeReader("http://no-logs", chain, {
        fail: (method) => (method === "eth_getLogs" ? new ReaderUnreachable("HTTP 503") : null),
      }),
      fakeReader("http://with-logs", chain),
    ],
    gateways: [GATEWAY],
    fetch: fakeFetch({ [gatewayUrl(GATEWAY, cid)]: new TextEncoder().encode(document) }),
  });
  assert.equal(result.outcome.kind, "registered");
  if (result.outcome.kind !== "registered") return;
  assert.equal(result.outcome.logs.status, "loaded");
  if (result.outcome.logs.status === "loaded") assert.equal(result.outcome.logs.reader, "http://with-logs");
  assert.equal(result.outcome.document.source, "on-chain");
  assert.equal(result.seal.green, true);
});

test("without logs, custody comes from getCustodyHistory, transactions are unavailable, and the IPFS copy stands in", async () => {
  const { chain, code, document, cid } = recalledChain();
  const noLogs = { fail: (method: string) => (method === "eth_getLogs" ? new ReaderUnreachable("HTTP 503") : null) };
  const run = (bytes: Uint8Array | number) =>
    verifyBatch({
      chainId: 31337,
      contract: CONTRACT,
      batchCode: code,
      deployments: DEPLOYMENTS,
      readers: [fakeReader("http://one", chain, noLogs), fakeReader("http://two", chain, noLogs)],
      gateways: [GATEWAY],
      fetch: fakeFetch({ [gatewayUrl(GATEWAY, cid)]: bytes }),
    });

  const result = await run(new TextEncoder().encode(document));
  assert.equal(result.outcome.kind, "registered");
  if (result.outcome.kind !== "registered") return;
  const outcome = result.outcome;
  assert.equal(outcome.logs.status, "unavailable");
  if (outcome.logs.status === "unavailable") assert.equal(outcome.logs.failures.length, 2);
  assert.deepEqual(
    outcome.history.map((row) => [row.timestamp, row.txHash]),
    [
      [102n, null],
      [104n, null],
    ],
  );
  assert.deepEqual(
    outcome.timeline.map((step) => [step.kind, step.txHash]),
    [
      ["registered", null],
      ["accepted", null],
      ["accepted", null],
      ["recalled", null],
    ],
  );
  assert.equal(outcome.recall, null);
  assert.equal(outcome.document.onChain.status, "unavailable");
  assert.equal(outcome.document.source, "ipfs");
  assert.equal(outcome.document.verdict, "match");
  assert.deepEqual(
    outcome.document.standIn?.checks.map((check) => check.result),
    ["pass", "pass", "pass", "pass"],
  );
  assert.equal(result.seal.green, true);

  const missing = await run(404);
  assert.equal(missing.outcome.kind === "registered" && missing.outcome.document.verdict, "unavailable");
  assert.equal(missing.seal.green, false);
  assert.equal(missing.outcome.kind === "registered" && missing.outcome.batch.status, "recalled");
});

test("a CustodyTransferred log that disagrees with getCustodyHistory is flagged and hashes are not paired", async () => {
  const { chain, code, document, cid } = recalledChain();
  chain.logs = chain.logs.filter((log) => log.transactionHash !== txHash("r01 accept c"));
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
  assert.equal(result.outcome.historyDisagrees, true);
  assert.deepEqual(
    result.outcome.history.map((row) => row.txHash),
    [null, null],
  );
});
