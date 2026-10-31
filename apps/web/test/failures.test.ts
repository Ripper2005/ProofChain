import { hashMetadata } from "@proofchain/metadata";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";
import { submitAction } from "../src/lib/actions.ts";
import type { Deployment } from "../src/lib/deployments.ts";
import { fetchIpfsBytes } from "../src/lib/document.ts";
import { contractErrorText } from "../src/lib/errors.ts";
import {
  DOCUMENT_UNAVAILABLE,
  READER_FAILURE,
  REVERTED_RECEIPT,
  receiptAccepted,
  registrationFailureText,
} from "../src/lib/failures.ts";
import { loadVerification } from "../src/lib/reader.ts";

const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const HASH = "0xd318be071fd3161c69b2f2eb4ff0a4d1ba56e1657a6ca854291454927994a752" as Hex;
const CANONICAL =
  '{"batchCode":"PCB-2026-001","description":"","imageCid":"","manufacturerName":"Demo Electronics Pvt. Ltd.","name":"STM32 Controller Development Board","productionDate":"2026-10-15","quantity":50,"schemaVersion":1,"sku":"CTRL-STM32-A"}';
const TX = `0x${"ab".repeat(32)}` as Hex;
const LOCAL: Deployment = {
  chainId: 31337,
  address: CONTRACT,
  startBlock: 1n,
  label: "local anvil",
  current: true,
  rpcUrls: [],
};

test("registerBatch sends the batch code, the canonical document, and the CID to the write deployment", async () => {
  assert.equal(hashMetadata(CANONICAL), HASH);
  const sent: unknown[] = [];
  const hash = await submitAction({
    action: { functionName: "registerBatch", args: ["PCB-2026-001", CANONICAL, "bafyrei-unpinned"] },
    deployment: LOCAL,
    account: ACCOUNT,
    walletChainId: 31337,
    switchChain: async () => {},
    write: (async (request: unknown) => {
      sent.push(request);
      return TX;
    }) as never,
    confirmReceipt: async () => ({ status: "success" }),
  });
  assert.equal(hash, TX);
  assert.equal(sent.length, 1);
  const request = sent[0] as { functionName: string; args: readonly unknown[]; address: Address; chainId: number };
  assert.equal(request.functionName, "registerBatch");
  assert.deepEqual(request.args, ["PCB-2026-001", CANONICAL, "bafyrei-unpinned"]);
  assert.equal(request.address, CONTRACT);
  assert.equal(request.chainId, 31337);

  const source = readFileSync(new URL("../src/pages/RegisterPage.tsx", import.meta.url), "utf8");
  assert.match(source, /args: \[batchCode, canonical, pinnedDocument\.cid\]/);
  const pinAt = source.indexOf("await pinMetadata(canonical, batchCode)");
  const hashCheckAt = source.indexOf("pinnedDocument.metadataHash.toLowerCase() !== localHash.toLowerCase()");
  const signAt = source.indexOf("await submitAction(");
  assert.ok(pinAt > 0 && pinAt < hashCheckAt && hashCheckAt < signAt);
});

test("a reverted receipt is a failure and is not a registration", async () => {
  assert.equal(receiptAccepted("reverted"), false);
  assert.equal(receiptAccepted("success"), true);

  let returned: Hex | null = TX;
  try {
    returned = await submitAction({
      action: { functionName: "registerBatch", args: ["PCB-2026-001", CANONICAL, "bafyrei-unpinned"] },
      deployment: LOCAL,
      account: ACCOUNT,
      walletChainId: 31337,
      switchChain: async () => {},
      write: async () => TX,
      confirmReceipt: async () => ({ status: "reverted" }),
    });
  } catch (error) {
    returned = null;
    assert.equal(error instanceof Error ? error.message : "", REVERTED_RECEIPT);
  }
  assert.equal(returned, null);

  const shown = registrationFailureText(new Error(REVERTED_RECEIPT), true);
  assert.match(shown, /The transaction reverted\. The contract did not apply this action\./);
  assert.match(shown, /will not offer a QR code until a receipt succeeds/);
  assert.equal(contractErrorText(new Error(REVERTED_RECEIPT)), REVERTED_RECEIPT);

  const succeeded = await submitAction({
    action: { functionName: "registerBatch", args: ["PCB-2026-001", CANONICAL, "bafyrei-unpinned"] },
    deployment: LOCAL,
    account: ACCOUNT,
    walletChainId: 31337,
    switchChain: async () => {},
    write: async () => TX,
    confirmReceipt: async () => ({ status: "success" }),
  });
  assert.equal(succeeded, TX);
});

test("a contract revert is shown as the contract error", () => {
  const reverted = {
    name: "ContractFunctionRevertedError",
    shortMessage: "The contract function reverted.",
    data: {
      errorName: "NotCurrentCustodian",
      args: [ZERO, ACCOUNT],
    },
  };
  const text = contractErrorText(reverted);
  assert.equal(text, `NotCurrentCustodian(${ZERO}, ${ACCOUNT})`);
  const shown = registrationFailureText(reverted, true);
  assert.match(shown, /NotCurrentCustodian/);
  assert.match(shown, /will not offer a QR code/);
  assert.doesNotMatch(shown, /Registration receipt/);
});

test("the registration page offers a QR only after a receipt", () => {
  const source = readFileSync(new URL("../src/pages/RegisterPage.tsx", import.meta.url), "utf8");
  const catchBlock = source.slice(source.indexOf("} catch (error)"));
  assert.match(source, /registrationFailureText/);
  assert.match(source, /receipt && qrUrl/);
  assert.match(source, /The QR appears only after a successful receipt/);
  assert.doesNotMatch(catchBlock, /setReceipt/);
});

test("an RPC error and an unreachable gateway are shown as failures", async () => {
  const rpc = await loadVerification(31337, CONTRACT, "PCB-2026-001", {
    endpoint: "http://127.0.0.1:9",
  });
  assert.equal(rpc.kind, "rpc-error");
  if (rpc.kind === "rpc-error") assert.equal(rpc.message, READER_FAILURE);

  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    throw new TypeError("fetch failed");
  };
  try {
    const bytes = await fetchIpfsBytes("bafyreiunreachablegateway");
    assert.equal(called, true);
    assert.equal(bytes, null);

    const result = await loadVerification(31337, CONTRACT, "PCB-2026-001", {
      endpoint: "http://127.0.0.1:9",
      client: {
        async getChainId() {
          return 31337;
        },
        async getBlockNumber() {
          return 1n;
        },
        async getLogs() {
          return [];
        },
        async readContract(parameters) {
          switch (parameters.functionName) {
            case "getBatch":
              return {
                batchCode: "PCB-2026-001",
                manufacturer: ACCOUNT,
                currentCustodian: ACCOUNT,
                metadataHash: HASH,
                metadataCid: "bafyreiunreachablegateway",
                status: 1,
                createdAt: 1n,
              };
            case "getPendingTransfer":
              return { from: ZERO, to: ZERO, proposedAt: 0n, active: false };
            case "getCustodyHistory":
              return [];
            case "hasRole":
              return true;
            default:
              throw new Error(parameters.functionName);
          }
        },
      },
    });
    assert.equal(result.kind, "present");
    if (result.kind !== "present") return;
    assert.equal(result.verdict, "unavailable");
    assert.equal(result.document, null);
    assert.equal(result.fetchedHash, null);
    assert.equal(result.currentCustodian, ACCOUNT);
    assert.equal(result.metadataHash, HASH);
    assert.notEqual(result.verdict, "match");
  } finally {
    globalThis.fetch = original;
  }

  const page = readFileSync(new URL("../src/pages/VerifyPage.tsx", import.meta.url), "utf8");
  assert.match(page, /result\.kind === "rpc-error"/);
  assert.match(page, /\{result\.message\}/);
  assert.match(page, /READER_FAILURE/);
  assert.match(page, /role="alert"/);
  assert.match(page, /result\.verdict === "unavailable"/);
  assert.match(page, /DOCUMENT_UNAVAILABLE/);
  assert.equal(
    DOCUMENT_UNAVAILABLE,
    "The product document is unavailable. Custody, status, hashes, and transactions above still come from the contract.",
  );
  assert.match(page, /result\.trust\.kind !== "unrecognized" && result\.verdict === "match"/);
});
