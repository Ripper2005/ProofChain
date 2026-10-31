import assert from "node:assert/strict";
import test from "node:test";
import { numberToHex } from "viem";
import {
  agreementSummary,
  httpReader,
  ReaderTimeout,
  ReaderUnreachable,
  readAgreement,
  RpcError,
  verifyBatch,
  type FetchLike,
} from "../src/index.ts";
import {
  B,
  CODE,
  CONTRACT,
  DEPLOYMENTS,
  fakeFetch,
  fakeReader,
  GATEWAY,
  GOLDEN_BYTES,
  GOLDEN_CID,
  GOLDEN_ID,
  goldenChain,
  gatewayUrl,
  unreachableReader,
} from "./fakes.ts";

const TARGET = { chainId: 31337, contract: CONTRACT, batchId: GOLDEN_ID };
const GOLDEN_FETCH = fakeFetch({ [gatewayUrl(GATEWAY, GOLDEN_CID)]: GOLDEN_BYTES });

function verify(readers: Parameters<typeof verifyBatch>[0]["readers"], batchCode = CODE) {
  return verifyBatch({
    chainId: 31337,
    contract: CONTRACT,
    batchCode,
    deployments: DEPLOYMENTS,
    readers,
    gateways: [GATEWAY],
    fetch: GOLDEN_FETCH,
  });
}

test("the anchor is the lowest head, every reader is read at it, and matching readers agree", async () => {
  const chain = goldenChain(12n);
  const calls: Array<Array<{ method: string; params: readonly unknown[] }>> = [[], [], []];
  const read = await readAgreement(
    [
      fakeReader("http://one", chain, { head: 12n, calls: calls[0] }),
      fakeReader("http://two", chain, { head: 10n, calls: calls[1] }),
      fakeReader("http://three", chain, { head: 11n, calls: calls[2] }),
    ],
    TARGET,
  );
  assert.equal(read.agreement.anchor, 10n);
  assert.equal(read.agreement.holds, true);
  assert.equal(read.agreement.agreeing, 3);
  assert.deepEqual(
    read.reports.map((report) => [report.status, report.head]),
    [
      ["agrees", 12n],
      ["agrees", 10n],
      ["agrees", 11n],
    ],
  );
  for (const list of calls) {
    const reads = list.filter((call) => call.method === "eth_call" || call.method === "eth_getBlockByNumber");
    assert.equal(reads.length, 5, "block hash, getBatch, getPendingTransfer, getCustodyHistory, hasRole");
    for (const call of reads) assert.equal(call.params.at(-1) === false ? call.params[0] : call.params.at(-1), numberToHex(10n));
  }
  assert.deepEqual(
    read.recordReaders.map((reader) => reader.url),
    ["http://one", "http://two", "http://three"],
  );
  assert.match(agreementSummary(read.agreement), /3 of 3 readers return the same record at block 10/);
});

test("a disagreeing reader is named with its answer and withholds agreement", async () => {
  const chain = goldenChain(10n);
  const result = await verify([
    fakeReader("http://honest-1", chain),
    fakeReader("http://liar", chain, { edit: (batch) => ({ ...batch, currentCustodian: B }) }),
    fakeReader("http://honest-2", chain),
  ]);
  assert.equal(result.agreement.holds, false);
  assert.equal(result.agreement.agreeing, 2);
  assert.equal(result.agreement.disagreeing, 1);
  const liar = result.readers.find((report) => report.url === "http://liar");
  assert.equal(liar?.status, "disagrees");
  assert.deepEqual(liar?.differs, ["getBatch"]);
  assert.ok(liar?.answer.some((line) => line.includes(`custodian ${B}`)));
  assert.equal(result.outcome.kind, "registered");
  if (result.outcome.kind === "registered") assert.notEqual(result.outcome.batch.currentCustodian, B);
  assert.equal(result.seal.agreement, false);
  assert.equal(result.seal.green, false);
});

test("a reader on another fork disagrees on the block hash", async () => {
  const chain = goldenChain(10n);
  const read = await readAgreement(
    [fakeReader("http://one", chain), fakeReader("http://two", chain), fakeReader("http://fork", chain, { fork: "other" })],
    TARGET,
  );
  assert.equal(read.agreement.holds, false);
  assert.deepEqual(read.reports[2]?.differs, ["block hash"]);
});

test("two readers that split evenly have no majority, and neither agrees", async () => {
  const chain = goldenChain(10n);
  const read = await readAgreement(
    [fakeReader("http://one", chain), fakeReader("http://two", chain, { edit: (batch) => ({ ...batch, status: 2 }) })],
    TARGET,
  );
  assert.equal(read.agreement.holds, false);
  assert.equal(read.agreement.agreeing, 0);
  assert.deepEqual(
    read.reports.map((report) => report.status),
    ["disagrees", "disagrees"],
  );
  assert.equal(read.recordReaders[0]?.url, "http://one");
});

test("readers agree that a batch is not registered when they return the same revert", async () => {
  const chain = goldenChain(10n);
  const result = await verify([fakeReader("http://one", chain), fakeReader("http://two", chain)], "PCB-2026-404");
  assert.equal(result.agreement.holds, true);
  assert.equal(result.agreement.agreeing, 2);
  assert.equal(result.outcome.kind, "not-registered");
  if (result.outcome.kind === "not-registered") assert.match(result.outcome.errorText, /^BatchNotFound\(0x[0-9a-f]{64}\)$/);
  assert.equal(result.seal.green, false);
  assert.match(result.readers[0]?.answer[1] ?? "", /getBatch: reverted BatchNotFound/);
});

test("a reader on the wrong chain is excluded and listed as misconfigured", async () => {
  const chain = goldenChain(10n);
  const result = await verify([
    fakeReader("http://mainnet", chain, { chainId: 1, head: 3n }),
    fakeReader("http://one", chain),
    fakeReader("http://two", chain),
  ]);
  const wrong = result.readers[0];
  assert.equal(wrong?.status, "misconfigured");
  assert.equal(wrong?.chainId, 1);
  assert.match(wrong?.detail ?? "", /reports chain 1, not chain 31337/);
  assert.equal(result.agreement.anchor, 10n, "the wrong chain's lower head is not the anchor");
  assert.equal(result.agreement.misconfigured, 1);
  assert.equal(result.agreement.holds, true);
  assert.equal(result.seal.green, true);

  const only = await verify([fakeReader("http://mainnet", chain, { chainId: 1 })]);
  assert.equal(only.outcome.kind, "cannot-read");
});

test("when every reader is unreachable the result says so and never reports the batch as missing", async () => {
  const result = await verify([unreachableReader("http://down-1"), unreachableReader("http://down-2")]);
  assert.equal(result.outcome.kind, "unreachable");
  assert.notEqual(result.outcome.kind, "not-registered");
  assert.equal(result.agreement.anchor, null);
  assert.equal(result.agreement.unreachable, 2);
  assert.deepEqual(
    result.readers.map((report) => report.status),
    ["unreachable", "unreachable"],
  );
  assert.equal(result.seal.green, false);

  const none = await verify([]);
  assert.equal(none.outcome.kind, "no-reader");
});

test("one configured reader can agree alone, but one answering reader out of several cannot", async () => {
  const chain = goldenChain(10n);
  const alone = await verify([fakeReader("http://only", chain)]);
  assert.equal(alone.agreement.holds, true);
  assert.equal(alone.seal.green, true);
  assert.match(agreementSummary(alone.agreement), /only configured reader/);

  const lonely = await verify([fakeReader("http://one", chain), unreachableReader("http://down")]);
  assert.equal(lonely.agreement.agreeing, 1);
  assert.equal(lonely.agreement.holds, false);
  assert.equal(lonely.outcome.kind, "registered");
  assert.equal(lonely.seal.green, false);
});

test("a reader that answers the head but fails the reads at the anchor is unreachable, not a disagreement", async () => {
  const chain = goldenChain(10n);
  const result = await verify([
    fakeReader("http://one", chain),
    fakeReader("http://two", chain),
    fakeReader("http://pruned", chain, {
      fail: (method) => (method === "eth_call" ? new RpcError(-32000, "missing trie node", undefined) : null),
    }),
  ]);
  assert.equal(result.readers[2]?.status, "unreachable");
  assert.match(result.readers[2]?.detail ?? "", /missing trie node/);
  assert.equal(result.agreement.disagreeing, 0);
  assert.equal(result.agreement.holds, true);
});

test("the HTTP reader turns JSON-RPC errors, HTTP errors, and silence into reader errors", async () => {
  const replies: Record<string, () => Promise<unknown>> = {
    "http://rpc-error": async () => ({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "internal error" } }),
    "http://revert": async () => ({
      jsonrpc: "2.0",
      id: 1,
      error: { code: 3, message: "execution reverted", data: "0xdeadbeef" },
    }),
    "http://ok": async () => ({ jsonrpc: "2.0", id: 1, result: "0x7a69" }),
  };
  const fetchImpl: FetchLike = async (url, init) => {
    if (url === "http://http-500") return { ok: false, status: 500, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0) };
    if (url === "http://refused") throw new TypeError("fetch failed");
    if (url === "http://silent") {
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    const body = await replies[url]!();
    return { ok: true, status: 200, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const reader = (url: string) => httpReader(url, { fetch: fetchImpl, timeoutMs: 30 });

  assert.equal(await reader("http://ok").request("eth_chainId", []), "0x7a69");
  await assert.rejects(reader("http://rpc-error").request("eth_chainId", []), (error: unknown) => {
    return error instanceof RpcError && error.code === -32603;
  });
  await assert.rejects(reader("http://revert").request("eth_call", []), (error: unknown) => {
    return error instanceof RpcError && error.code === 3 && error.data === "0xdeadbeef";
  });
  await assert.rejects(reader("http://http-500").request("eth_chainId", []), ReaderUnreachable);
  await assert.rejects(reader("http://refused").request("eth_chainId", []), ReaderUnreachable);
  await assert.rejects(reader("http://silent").request("eth_chainId", []), ReaderTimeout);

  const result = await verifyBatch({
    chainId: 31337,
    contract: CONTRACT,
    batchCode: CODE,
    deployments: DEPLOYMENTS,
    readers: ["http://rpc-error", "http://silent"],
    gateways: [GATEWAY],
    fetch: fetchImpl,
    readerTimeoutMs: 30,
  });
  assert.equal(result.outcome.kind, "unreachable");
  assert.match(result.readers[0]?.detail ?? "", /RPC error -32603: internal error/);
  assert.match(result.readers[1]?.detail ?? "", /no answer within 30 ms/);
});
