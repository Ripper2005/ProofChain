import assert from "node:assert/strict";
import test from "node:test";
import { verifyBatch, type StorageProofReport } from "../src/index.ts";
import {
  CODE,
  CONTRACT,
  DEPLOYMENTS,
  fakeFetch,
  fakeReader,
  GATEWAY,
  gatewayUrl,
  GOLDEN_CID,
  GOLDEN_BYTES,
  GOLDEN_ID,
  goldenChain,
} from "./fakes.ts";

function flipLastByte(value: string): string {
  const last = Number.parseInt(value.slice(-2), 16);
  return `${value.slice(0, -2)}${(last ^ 1).toString(16).padStart(2, "0")}`;
}

async function verify(options: Parameters<typeof fakeReader>[2] = {}) {
  return verifyBatch({
    chainId: 31337,
    contract: CONTRACT,
    batchCode: CODE,
    deployments: DEPLOYMENTS,
    readers: [fakeReader("http://proof-reader", goldenChain(), options)],
    gateways: [GATEWAY],
    fetch: fakeFetch({ [gatewayUrl(GATEWAY, GOLDEN_CID)]: GOLDEN_BYTES }),
  });
}

function storageProof(report: { kind: string; storageProof?: StorageProofReport }): StorageProofReport {
  assert.equal(report.kind, "registered");
  assert.ok(report.storageProof);
  return report.storageProof;
}

test("the account and custodian/status storage proofs verify at the agreed state root", async () => {
  const result = await verify();
  const proof = storageProof(result.outcome);
  assert.equal(proof.status, "verified", proof.detail ?? undefined);
  assert.equal(proof.reader, "http://proof-reader");
  assert.equal(proof.custodianMatches, true);
  assert.equal(proof.statusMatches, true);
  assert.equal(proof.provenStatus, 1);
  assert.equal(BigInt(proof.statusSlot), BigInt(proof.custodianSlot) + 3n, "the documented layout places status three slots after custodian");
  assert.equal(result.seal.green, true);
});

test("tampering with the account-trie proof is rejected", async () => {
  const result = await verify({
    proofEdit: (proof) => {
      const nodes = proof.accountProof as string[];
      return { ...proof, accountProof: [flipLastByte(nodes[0]!), ...nodes.slice(1)] };
    },
  });
  assert.equal(storageProof(result.outcome).status, "invalid");
});

test("tampering with a storage-trie proof or its claimed value is rejected", async () => {
  const badNode = await verify({
    proofEdit: (proof) => {
      const storageProofs = proof.storageProof as Array<{ proof: string[] }>;
      const first = storageProofs[0]!;
      return {
        ...proof,
        storageProof: [{ ...first, proof: [flipLastByte(first.proof[0]!), ...first.proof.slice(1)] }, ...storageProofs.slice(1)],
      };
    },
  });
  assert.equal(storageProof(badNode.outcome).status, "invalid");

  const badValue = await verify({
    proofEdit: (proof) => {
      const storageProofs = proof.storageProof as Array<{ value: string }>;
      return {
        ...proof,
        storageProof: [{ ...storageProofs[0]!, value: "0x2" }, storageProofs[1]],
      };
    },
  });
  assert.equal(storageProof(badValue.outcome).status, "invalid");
});

test("a valid proof that disagrees with getBatch is reported separately and does not change the green seal", async () => {
  const result = await verify({ edit: (batch) => ({ ...batch, currentCustodian: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" }) });
  const proof = storageProof(result.outcome);
  assert.equal(proof.status, "mismatch");
  assert.equal(proof.custodianMatches, false);
  assert.equal(proof.statusMatches, true);
  assert.equal(result.seal.green, true);
});

test("an unavailable eth_getProof is reported without affecting the seal", async () => {
  const result = await verify({
    fail: (method) => (method === "eth_getProof" ? new Error("method unavailable") : null),
  });
  const proof = storageProof(result.outcome);
  assert.equal(proof.status, "unavailable");
  assert.match(proof.detail ?? "", /method unavailable/);
  assert.equal(result.seal.green, true);
});

test("the storage proof is attached only to registered outcomes for the requested batch", async () => {
  const result = await verifyBatch({
    chainId: 31337,
    contract: CONTRACT,
    batchCode: "PCB-2026-404",
    deployments: DEPLOYMENTS,
    readers: [fakeReader("http://proof-reader", goldenChain())],
    gateways: [],
    fetch: fakeFetch({}),
  });
  assert.equal(result.batchId === GOLDEN_ID, false);
  assert.equal(result.outcome.kind, "not-registered");
});
