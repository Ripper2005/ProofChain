import { computeBatchId, hashMetadata } from "@proofchain/metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";
import {
  checkRawCid,
  documentReport,
  fetchIpfsCopy,
  judgeDocument,
  verifyBatch,
  type IpfsCopy,
  type OnChainDocument,
} from "../src/index.ts";
import {
  CODE,
  CONTRACT,
  DEPLOYMENTS,
  fakeFetch,
  fakeReader,
  GATEWAY,
  gatewayUrl,
  GOLDEN,
  GOLDEN_BYTES,
  GOLDEN_CID,
  GOLDEN_HASH,
  GOLDEN_ID,
  goldenChain,
  rawCid,
  SECOND_GATEWAY,
} from "./fakes.ts";

function tampered(): Uint8Array {
  return new TextEncoder().encode(GOLDEN.replace('"quantity":50', '"quantity":500'));
}

test("the golden document reproduces the golden hash, id, and CID", () => {
  assert.equal(GOLDEN_BYTES.byteLength, 234);
  assert.equal(hashMetadata(GOLDEN), GOLDEN_HASH);
  assert.equal(computeBatchId(CODE), GOLDEN_ID);
  assert.equal(rawCid(GOLDEN_BYTES), GOLDEN_CID);
});

test("the raw-CID self-check accepts the golden CID for the golden bytes and rejects tampered bytes", () => {
  assert.deepEqual(checkRawCid(GOLDEN_CID, GOLDEN_BYTES), { kind: "passed" });
  assert.deepEqual(checkRawCid(GOLDEN_CID, tampered()), { kind: "failed" });
  const flipped = GOLDEN_BYTES.slice();
  flipped[10] = flipped[10]! ^ 1;
  assert.deepEqual(checkRawCid(GOLDEN_CID, flipped), { kind: "failed" });

  assert.equal(checkRawCid("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", GOLDEN_BYTES).kind, "not-checked");
  assert.equal(
    checkRawCid("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi", GOLDEN_BYTES).kind,
    "not-checked",
    "a dag-pb CID is not checked",
  );
  assert.equal(checkRawCid("not a cid", GOLDEN_BYTES).kind, "not-checked");
});

test("the on-chain document passes four checks, and each failure is named", () => {
  const match = judgeDocument(GOLDEN_BYTES, GOLDEN_HASH, CODE, GOLDEN_ID);
  assert.equal(match.verdict, "match");
  assert.deepEqual(
    match.checks.map((check) => [check.id, check.result]),
    [
      ["hash", "pass"],
      ["canonical", "pass"],
      ["batch-code", "pass"],
      ["batch-id", "pass"],
    ],
  );
  assert.equal(match.document?.quantity, 50);

  const wrongCase = judgeDocument(GOLDEN_BYTES, GOLDEN_HASH, "pcb-2026-001", computeBatchId("pcb-2026-001"));
  assert.equal(wrongCase.verdict, "mismatch");
  assert.deepEqual(
    wrongCase.checks.map((check) => check.result),
    ["pass", "pass", "fail", "fail"],
  );

  const edited = judgeDocument(tampered(), GOLDEN_HASH, CODE, GOLDEN_ID);
  assert.equal(edited.verdict, "mismatch");
  assert.equal(edited.checks[0]?.result, "fail");

  const spaced = new TextEncoder().encode(GOLDEN.replace(",", ", "));
  const nonCanonical = judgeDocument(spaced, keccak256(spaced), CODE, GOLDEN_ID);
  assert.deepEqual(
    nonCanonical.checks.map((check) => check.result),
    ["pass", "fail", "not-run", "not-run"],
  );
  assert.match(nonCanonical.reason ?? "", /re-canonicalizing/);
});

test("an unreachable gateway is skipped, and the first gateway whose bytes pass ends the search", async () => {
  const seen: string[] = [];
  const third = "http://third.test";
  const copy = await fetchIpfsCopy({
    cid: GOLDEN_CID,
    metadataHash: GOLDEN_HASH,
    gateways: [GATEWAY, SECOND_GATEWAY, third],
    fetch: fakeFetch(
      {
        [gatewayUrl(GATEWAY, GOLDEN_CID)]: new TypeError("fetch failed"),
        [gatewayUrl(SECOND_GATEWAY, GOLDEN_CID)]: GOLDEN_BYTES,
        [gatewayUrl(third, GOLDEN_CID)]: GOLDEN_BYTES,
      },
      seen,
    ),
  });
  assert.equal(copy.status, "match");
  assert.deepEqual(
    copy.attempts.map((attempt) => [attempt.gateway, attempt.outcome]),
    [
      [GATEWAY, "no-bytes"],
      [SECOND_GATEWAY, "passed"],
    ],
  );
  assert.deepEqual(copy.cidCheck, { kind: "passed" });
  assert.equal(seen.length, 2);
});

test("a gateway that returns wrong bytes is followed by one that returns the right bytes", async () => {
  const copy = await fetchIpfsCopy({
    cid: GOLDEN_CID,
    metadataHash: GOLDEN_HASH,
    gateways: [GATEWAY, SECOND_GATEWAY],
    fetch: fakeFetch({
      [gatewayUrl(GATEWAY, GOLDEN_CID)]: tampered(),
      [gatewayUrl(SECOND_GATEWAY, GOLDEN_CID)]: GOLDEN_BYTES,
    }),
  });
  assert.equal(copy.status, "match");
  assert.equal(copy.attempts[0]?.outcome, "wrong-bytes");
  assert.match(copy.attempts[0]?.detail ?? "", /keccak256 does not equal the metadataHash/);
  assert.equal(copy.attempts[1]?.outcome, "passed");
});

test("wrong bytes from every gateway that answered is a mismatch; no bytes at all is unavailable", async () => {
  const mismatch = await fetchIpfsCopy({
    cid: GOLDEN_CID,
    metadataHash: GOLDEN_HASH,
    gateways: [GATEWAY, SECOND_GATEWAY],
    fetch: fakeFetch({ [gatewayUrl(GATEWAY, GOLDEN_CID)]: tampered(), [gatewayUrl(SECOND_GATEWAY, GOLDEN_CID)]: 504 }),
  });
  assert.equal(mismatch.status, "mismatch");

  const unavailable = await fetchIpfsCopy({
    cid: GOLDEN_CID,
    metadataHash: GOLDEN_HASH,
    gateways: [GATEWAY, SECOND_GATEWAY],
    fetch: fakeFetch({ [gatewayUrl(GATEWAY, GOLDEN_CID)]: 404, [gatewayUrl(SECOND_GATEWAY, GOLDEN_CID)]: new Error("timeout") }),
  });
  assert.equal(unavailable.status, "unavailable");
  assert.deepEqual(
    unavailable.attempts.map((attempt) => attempt.detail),
    ["HTTP 404", "timeout"],
  );

  const silent = await fetchIpfsCopy({
    cid: GOLDEN_CID,
    metadataHash: GOLDEN_HASH,
    gateways: [GATEWAY],
    fetch: () => new Promise(() => {}),
    timeoutMs: 20,
  });
  assert.equal(silent.status, "unavailable");
  assert.match(silent.attempts[0]?.detail ?? "", /no answer within 20 ms/);

  const none = await fetchIpfsCopy({ cid: GOLDEN_CID, metadataHash: GOLDEN_HASH, gateways: [], fetch: fakeFetch({}) });
  assert.equal(none.status, "unavailable");
});

test("a registered CID that names other bytes is a copy mismatch even when the bytes hash to the commitment", async () => {
  const otherCid = rawCid(tampered());
  const copy = await fetchIpfsCopy({
    cid: otherCid,
    metadataHash: GOLDEN_HASH,
    gateways: [GATEWAY],
    fetch: fakeFetch({ [gatewayUrl(GATEWAY, otherCid)]: GOLDEN_BYTES }),
  });
  assert.equal(copy.status, "mismatch");
  assert.match(copy.attempts[0]?.detail ?? "", /sha256 of the bytes does not equal the digest inside the CID/);
});

test("the document verdict combines the on-chain document and the IPFS copy as section 10 says", () => {
  const read = (bytes: Uint8Array): OnChainDocument => ({
    status: "read",
    judgement: judgeDocument(bytes, GOLDEN_HASH, CODE, GOLDEN_ID),
    txHash: null,
    blockNumber: 2n,
  });
  const notRead: OnChainDocument = { status: "unavailable", reason: "the logs could not be loaded" };
  const copy = (status: IpfsCopy["status"], bytes: Uint8Array | null): IpfsCopy => ({
    status,
    cid: GOLDEN_CID,
    attempts: [],
    cidCheck: null,
    bytes,
  });
  const verdict = (onChain: OnChainDocument, ipfs: IpfsCopy) =>
    documentReport({ onChain, ipfs, metadataHash: GOLDEN_HASH, batchCode: CODE, batchId: GOLDEN_ID });

  const cases: Array<[string, OnChainDocument, IpfsCopy, string, string | null]> = [
    ["on-chain match, copy match", read(GOLDEN_BYTES), copy("match", GOLDEN_BYTES), "match", "on-chain"],
    ["on-chain match, copy unavailable", read(GOLDEN_BYTES), copy("unavailable", null), "match", "on-chain"],
    ["on-chain match, copy mismatch", read(GOLDEN_BYTES), copy("mismatch", tampered()), "match", "on-chain"],
    ["on-chain mismatch, copy match", read(tampered()), copy("match", GOLDEN_BYTES), "mismatch", "on-chain"],
    ["no logs, copy match", notRead, copy("match", GOLDEN_BYTES), "match", "ipfs"],
    ["no logs, copy mismatch", notRead, copy("mismatch", tampered()), "mismatch", "ipfs"],
    ["no logs, copy unavailable", notRead, copy("unavailable", null), "unavailable", null],
  ];
  for (const [name, onChain, ipfs, expected, source] of cases) {
    const report = verdict(onChain, ipfs);
    assert.equal(report.verdict, expected, name);
    assert.equal(report.source, source, name);
  }

  const standInWrongCode = documentReport({
    onChain: notRead,
    ipfs: copy("match", GOLDEN_BYTES),
    metadataHash: GOLDEN_HASH,
    batchCode: "pcb-2026-001",
    batchId: computeBatchId("pcb-2026-001"),
  });
  assert.equal(standInWrongCode.verdict, "mismatch", "a stand-in copy must pass checks 1 through 4 on its own bytes");
});

test("an IPFS copy mismatch keeps the document match but withholds the green seal", async () => {
  const result = await verifyBatch({
    chainId: 31337,
    contract: CONTRACT,
    batchCode: CODE,
    deployments: DEPLOYMENTS,
    readers: [fakeReader("http://only", goldenChain())],
    gateways: [GATEWAY],
    fetch: fakeFetch({ [gatewayUrl(GATEWAY, GOLDEN_CID)]: tampered() }),
  });
  assert.equal(result.outcome.kind === "registered" && result.outcome.document.verdict, "match");
  assert.equal(result.outcome.kind === "registered" && result.outcome.document.ipfs.status, "mismatch");
  assert.equal(result.seal.copyNotMismatch, false);
  assert.equal(result.seal.green, false);
});
