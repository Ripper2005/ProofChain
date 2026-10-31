import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyAgreement,
  parseDeployments,
  SEAL_RULE,
  sealFor,
  verifyBatch,
  type Outcome,
  type Trust,
} from "../src/index.ts";
import {
  CODE,
  CONTRACT,
  DEPLOYMENTS,
  fakeFetch,
  fakeReader,
  GATEWAY,
  gatewayUrl,
  GOLDEN_BYTES,
  GOLDEN_CID,
  goldenChain,
} from "./fakes.ts";

function registered(verdict: "match" | "mismatch" | "unavailable", copy: "match" | "mismatch" | "unavailable"): Outcome {
  return {
    kind: "registered",
    document: { verdict, ipfs: { status: copy } },
  } as unknown as Outcome;
}

test("the green seal needs a trusted deployment, a document match, a copy that is not a mismatch, and agreement", () => {
  const trusted: Trust = { kind: "current", label: "local anvil" };
  const earlier: Trust = { kind: "earlier", label: "old", current: null };
  const unrecognized: Trust = { kind: "unrecognized" };
  const agreed = { ...emptyAgreement(2), holds: true };
  const split = { ...emptyAgreement(2), holds: false };

  assert.equal(sealFor({ trust: trusted, agreement: agreed, outcome: registered("match", "match") }).green, true);
  assert.equal(sealFor({ trust: trusted, agreement: agreed, outcome: registered("match", "unavailable") }).green, true);
  assert.equal(sealFor({ trust: earlier, agreement: agreed, outcome: registered("match", "match") }).green, true);

  assert.equal(sealFor({ trust: unrecognized, agreement: agreed, outcome: registered("match", "match") }).green, false);
  assert.equal(sealFor({ trust: trusted, agreement: agreed, outcome: registered("mismatch", "match") }).green, false);
  assert.equal(sealFor({ trust: trusted, agreement: agreed, outcome: registered("unavailable", "unavailable") }).green, false);
  assert.equal(sealFor({ trust: trusted, agreement: agreed, outcome: registered("match", "mismatch") }).green, false);
  assert.equal(sealFor({ trust: trusted, agreement: split, outcome: registered("match", "match") }).green, false);
  assert.equal(sealFor({ trust: trusted, agreement: agreed, outcome: { kind: "not-registered", errorText: "x" } }).green, false);
  assert.equal(sealFor({ trust: trusted, agreement: agreed, outcome: { kind: "unreachable" } }).green, false);

  assert.match(SEAL_RULE, /covers the document and the agreement/);
  assert.match(SEAL_RULE, /Recall status is separate/);
});

test("a lookalike contract shows the raw reads but never the green seal", async () => {
  const lookalike = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
  const chain = goldenChain();
  for (const log of chain.logs) log.address = lookalike;
  const result = await verifyBatch({
    chainId: 31337,
    contract: lookalike,
    batchCode: CODE,
    deployments: DEPLOYMENTS,
    readers: [fakeReader("http://only", chain)],
    gateways: [GATEWAY],
    fetch: fakeFetch({ [gatewayUrl(GATEWAY, GOLDEN_CID)]: GOLDEN_BYTES }),
  });
  assert.equal(result.trust.kind, "unrecognized");
  assert.equal(result.outcome.kind === "registered" && result.outcome.document.verdict, "match");
  assert.equal(result.agreement.holds, true);
  assert.equal(result.seal.green, false);
});

test("the golden batch on the local deployment earns the green seal", async () => {
  const result = await verifyBatch({
    chainId: 31337,
    contract: CONTRACT.toLowerCase(),
    batchCode: CODE,
    deployments: DEPLOYMENTS,
    readers: [fakeReader("http://only", goldenChain())],
    gateways: [GATEWAY],
    fetch: fakeFetch({ [gatewayUrl(GATEWAY, GOLDEN_CID)]: GOLDEN_BYTES }),
  });
  assert.equal(result.contract, CONTRACT, "any hex case is accepted and checksummed");
  assert.deepEqual(result.seal, {
    trusted: true,
    documentMatch: true,
    copyNotMismatch: true,
    agreement: true,
    green: true,
  });

  const invalid = await verifyBatch({
    chainId: 31337,
    contract: CONTRACT,
    batchCode: "PCB 2026",
    deployments: parseDeployments({ deployments: [] }),
    readers: [fakeReader("http://only", goldenChain())],
    gateways: [],
    fetch: fakeFetch({}),
  });
  assert.equal(invalid.outcome.kind, "invalid-code");
  assert.equal(invalid.seal.green, false);
});
