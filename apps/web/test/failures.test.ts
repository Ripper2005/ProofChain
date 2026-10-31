import { hashMetadata } from "@proofchain/metadata";
import { verifyBatch } from "@proofchain/verifier";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { createPublicClient, custom, encodeErrorResult, type Address, type Hex } from "viem";
import { productRegistryAbi } from "../src/contracts/ProductRegistry.ts";
import { simulateAction, SimulationStopped, submitAction, type Simulate } from "../src/lib/actions.ts";
import { trustedDeployments, type Deployment } from "../src/lib/deployments.ts";
import { contractErrorText } from "../src/lib/errors.ts";
import {
  DOCUMENT_UNAVAILABLE,
  READER_FAILURE,
  REVERTED_RECEIPT,
  receiptAccepted,
  registrationFailureText,
} from "../src/lib/failures.ts";

const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const OTHER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;
const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const HASH = "0xd318be071fd3161c69b2f2eb4ff0a4d1ba56e1657a6ca854291454927994a752" as Hex;
const BATCH_ID = "0x9d6be2557c721891700c118158cc27ec51fd21cd40d2b73a7670b7e1466936d2" as Hex;
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
const passes: Simulate = async () => ({ kind: "passed" });

test("registerBatch is simulated, then sends the batch code, the canonical document, and the CID", async () => {
  assert.equal(hashMetadata(CANONICAL), HASH);
  const order: string[] = [];
  const sent: unknown[] = [];
  const hash = await submitAction({
    action: { functionName: "registerBatch", args: ["PCB-2026-001", CANONICAL, "bafyrei-unpinned"] },
    deployment: LOCAL,
    account: ACCOUNT,
    walletChainId: 31337,
    switchChain: async () => {},
    simulate: async (input) => {
      order.push(`simulate ${input.action.functionName} as ${input.account}`);
      return { kind: "passed" };
    },
    write: (async (request: unknown) => {
      order.push("write");
      sent.push(request);
      return TX;
    }) as never,
    confirmReceipt: async () => ({ status: "success" }),
  });
  assert.equal(hash, TX);
  assert.deepEqual(order, [`simulate registerBatch as ${ACCOUNT}`, "write"]);
  const request = sent[0] as { functionName: string; args: readonly unknown[]; address: Address; chainId: number };
  assert.equal(request.functionName, "registerBatch");
  assert.deepEqual(request.args, ["PCB-2026-001", CANONICAL, "bafyrei-unpinned"]);
  assert.equal(request.address, CONTRACT);
  assert.equal(request.chainId, 31337);
});

test("registration simulates with the real document and a placeholder CID before anything is pinned", () => {
  const source = readFileSync(new URL("../src/pages/RegisterPage.tsx", import.meta.url), "utf8");
  assert.match(source, /args: \[batchCode, draft, PLACEHOLDER_CID\]/);
  assert.match(source, /buildDocument\(file \? PLACEHOLDER_CID : ""\)/);
  assert.match(source, /args: \[batchCode, canonical, pinnedDocument\.cid\]/);
  assert.match(source, /const PLACEHOLDER_CID = `bafkrei\$\{"a"\.repeat\(52\)\}`/);
  const simulateAt = source.indexOf("await simulateAction(");
  const stopAt = source.indexOf('if (simulation.kind !== "passed")');
  const blobAt = source.indexOf("await pinBlob(");
  const pinAt = source.indexOf("await pinMetadata(canonical, batchCode)");
  const hashCheckAt = source.indexOf("pinnedDocument.metadataHash.toLowerCase() !== localHash.toLowerCase()");
  const signAt = source.indexOf("await submitAction(");
  assert.ok(simulateAt > 0 && simulateAt < stopAt && stopAt < blobAt && blobAt < pinAt);
  assert.ok(pinAt < hashCheckAt && hashCheckAt < signAt);
  assert.equal(`bafkrei${"a".repeat(52)}`.length, 59);
});

test("a simulated rejection shows the contract error and the wallet never opens", async () => {
  let writes = 0;
  const input = {
    action: { functionName: "proposeCustodyTransfer", args: [BATCH_ID, OTHER] } as const,
    deployment: LOCAL,
    account: OTHER,
    walletChainId: 31337,
    switchChain: async () => {},
    simulate: (async () => ({ kind: "rejected", text: `NotCurrentCustodian(${OTHER}, ${ACCOUNT})` })) as Simulate,
    write: (async () => {
      writes += 1;
      return TX;
    }) as never,
    confirmReceipt: async () => ({ status: "reverted" as const }),
  };
  await assert.rejects(submitAction(input), (error: unknown) => {
    assert.ok(error instanceof SimulationStopped);
    assert.deepEqual(error.simulation, { kind: "rejected", text: `NotCurrentCustodian(${OTHER}, ${ACCOUNT})` });
    return true;
  });
  assert.equal(writes, 0);

  await assert.rejects(submitAction({ ...input, skipSimulation: true }), new Error(REVERTED_RECEIPT));
  assert.equal(writes, 1);

  const notRun: Simulate = async () => ({ kind: "not-run", text: "This site cannot read chain 31337." });
  await assert.rejects(submitAction({ ...input, simulate: notRun }), SimulationStopped);
  assert.equal(writes, 1);
});

test("the simulation decodes the contract's own revert through viem's simulateContract", async () => {
  const data = encodeErrorResult({ abi: productRegistryAbi, errorName: "NotCurrentCustodian", args: [OTHER, ACCOUNT] });
  const calls: Array<{ method: string; params: unknown }> = [];
  const client = createPublicClient({
    transport: custom({
      async request({ method, params }) {
        calls.push({ method, params });
        if (method === "eth_call") throw Object.assign(new Error("execution reverted"), { code: 3, data });
        throw new Error(`unexpected ${method}`);
      },
    }, { retryCount: 0 }),
  });
  const rejected = await simulateAction(
    { action: { functionName: "proposeCustodyTransfer", args: [BATCH_ID, OTHER] }, deployment: LOCAL, account: OTHER },
    async () => client,
  );
  assert.deepEqual(rejected, { kind: "rejected", text: `NotCurrentCustodian(${OTHER}, ${ACCOUNT})` });
  const call = calls.find((item) => item.method === "eth_call");
  const [request] = call?.params as [{ from?: string; to?: string }];
  assert.equal(request.from?.toLowerCase(), OTHER.toLowerCase());
  assert.equal(request.to?.toLowerCase(), CONTRACT.toLowerCase());

  const silent = await simulateAction(
    { action: { functionName: "recallBatch", args: [BATCH_ID, ""] }, deployment: LOCAL, account: ACCOUNT },
    async () => {
      throw new Error("This site cannot read chain 31337.");
    },
  );
  assert.deepEqual(silent, { kind: "not-run", text: "This site cannot read chain 31337." });
});

test("the custody, recall, and registration pages offer Send anyway after a stopped simulation", () => {
  for (const page of ["CustodyPage.tsx", "RecallPage.tsx"]) {
    const source = readFileSync(new URL(`../src/pages/${page}`, import.meta.url), "utf8");
    assert.match(source, /<SimulationNotice simulation=\{action\.stopped\}/, page);
    assert.match(source, /action\.sendAnyway\(\)/, page);
  }
  const register = readFileSync(new URL("../src/pages/RegisterPage.tsx", import.meta.url), "utf8");
  assert.match(register, /onSendAnyway=\{\(\) => void register\(true\)\}/);
  const notice = readFileSync(new URL("../src/components/SimulationNotice.tsx", import.meta.url), "utf8");
  assert.match(notice, /Send anyway/);
  assert.match(notice, /role="alert"/);
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
      simulate: passes,
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
    simulate: passes,
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

test("an RPC error and unreachable readers are shown as a reader failure, never as a missing batch", async () => {
  const rpcError = await verifyBatch({
    chainId: 31337,
    contract: CONTRACT,
    batchCode: "PCB-2026-001",
    deployments: trustedDeployments(),
    readers: ["http://127.0.0.1:9/rpc"],
    gateways: [],
    fetch: async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "internal error" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  assert.equal(rpcError.outcome.kind, "unreachable");
  assert.equal(rpcError.seal.green, false);

  const silent = await verifyBatch({
    chainId: 31337,
    contract: CONTRACT,
    batchCode: "PCB-2026-001",
    deployments: trustedDeployments(),
    readers: ["http://127.0.0.1:9/rpc", "http://127.0.0.1:10/rpc"],
    gateways: [],
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });
  assert.equal(silent.outcome.kind, "unreachable");
  assert.equal(silent.agreement.unreachable, 2);

  const page = readFileSync(new URL("../src/pages/VerifyPage.tsx", import.meta.url), "utf8");
  const unreachable = page.slice(page.indexOf('case "unreachable":'), page.indexOf('case "not-registered":'));
  assert.match(unreachable, /role="alert"/);
  assert.match(unreachable, /\{READER_FAILURE\}/);
  assert.doesNotMatch(unreachable, /is registered/);
  assert.match(READER_FAILURE, /did not respond/);
  assert.match(page, /No batch with code \{result\.batchCode\} is registered on this contract\./);
});

test("an unavailable document is shown as unavailable, and the seal follows the verifier's rule", () => {
  const page = readFileSync(new URL("../src/pages/VerifyPage.tsx", import.meta.url), "utf8");
  assert.match(page, /document\.verdict === "unavailable" \? <p data-testid="document-unavailable">\{DOCUMENT_UNAVAILABLE\}<\/p>/);
  assert.equal(
    DOCUMENT_UNAVAILABLE,
    "The product document is unavailable. Custody, status, hashes, and transactions above still come from the contract.",
  );
  assert.match(page, /result\.seal\.green \?/);
  assert.match(page, /\{SEAL_RULE\}/);
  assert.match(page, /data-testid="single-reader-note"/);
});
