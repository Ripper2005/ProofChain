import assert from "node:assert/strict";
import test from "node:test";
import {
  cliGateways,
  cliReaders,
  LOCAL_GATEWAY,
  LOCAL_NODE,
  parseCliArgs,
  parseDeployments,
  parseVerificationUrl,
  PUBLIC_GATEWAY,
  renderReport,
  verifyBatch,
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
  recalledChain,
  unreachableReader,
} from "./fakes.ts";

const SEPOLIA = "0x01E560E6F16D86b7764284476a3E57D013bF5840";
const LIST = parseDeployments({
  deployments: [
    { chainId: 31337, address: CONTRACT, startBlock: 1, label: "local anvil", current: true, rpcUrls: [] },
    { chainId: 11155111, address: SEPOLIA, startBlock: 5, label: "sepolia", current: true, rpcUrls: ["https://a", "https://b"] },
  ],
});

test("the CLI takes one verification URL and repeated --rpc and --gateway options", () => {
  const parsed = parseCliArgs([
    "http://localhost:5173/verify/31337/0x5FbDB2315678afecb367f032d93F642f64180aa3/PCB-2026-001",
    "--rpc",
    "http://127.0.0.1:8545",
    "--rpc=https://node.example",
    "--gateway",
    "http://127.0.0.1:8080",
  ]);
  assert.deepEqual(parsed, {
    ok: true,
    options: {
      url: "http://localhost:5173/verify/31337/0x5FbDB2315678afecb367f032d93F642f64180aa3/PCB-2026-001",
      rpc: ["http://127.0.0.1:8545", "https://node.example"],
      gateways: ["http://127.0.0.1:8080"],
    },
  });
  assert.equal(parseCliArgs([]).ok, false);
  assert.equal(parseCliArgs(["http://x/verify/1/0x/a", "--rpc"]).ok, false);
  assert.equal(parseCliArgs(["http://x/verify/1/0x/a", "--verbose"]).ok, false);
  assert.equal(parseCliArgs(["--", "http://x/verify/1/0x/a"]).ok, true);
});

test("the verification URL names the chain, the contract, and the case-sensitive batch code", () => {
  assert.deepEqual(parseVerificationUrl(`https://proofchain.example/verify/11155111/${SEPOLIA}/PCB-2026-001`), {
    chainId: 11155111,
    contract: SEPOLIA,
    batchCode: "PCB-2026-001",
  });
  assert.equal(parseVerificationUrl(`http://localhost:5173/verify/31337/${CONTRACT}/pcb-2026-001/`)?.batchCode, "pcb-2026-001");
  assert.equal(parseVerificationUrl("http://localhost:5173/register"), null);
  assert.equal(parseVerificationUrl(`http://localhost:5173/verify/sepolia/${SEPOLIA}/PCB-2026-001`), null);
  assert.equal(parseVerificationUrl("not a url"), null);
});

test("without options the CLI uses the listed readers, Anvil for chain 31337, and the default gateways", () => {
  assert.deepEqual(cliReaders(LIST, 11155111, []), ["https://a", "https://b"]);
  assert.deepEqual(cliReaders(LIST, 31337, []), [LOCAL_NODE]);
  assert.deepEqual(cliReaders(LIST, 1, []), []);
  assert.deepEqual(cliReaders(LIST, 11155111, ["https://mine"]), ["https://mine"]);
  assert.deepEqual(cliGateways(31337, []), [LOCAL_GATEWAY]);
  assert.deepEqual(cliGateways(11155111, []), [PUBLIC_GATEWAY]);
  assert.deepEqual(cliGateways(11155111, ["https://g"]), ["https://g"]);
  assert.equal(LOCAL_NODE, "http://127.0.0.1:8545");
  assert.equal(LOCAL_GATEWAY, "http://127.0.0.1:8080");
  assert.equal(PUBLIC_GATEWAY, "https://gateway.pinata.cloud");
});

test("the report prints trust, each reader, the custody sequence, each document check, and the verdict", async () => {
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
  const text = renderReport(result);
  assert.match(text, /Recognized deployment: local anvil/);
  assert.match(text, /http:\/\/only\n    agrees; chain 31337, head 9/);
  assert.match(text, /Agreement holds with the only configured reader/);
  assert.match(text, /6\. Recalled by 0x[0-9a-fA-F]{40}, reason "Damaged seal"/);
  assert.equal((text.match(/^    pass /gm) ?? []).length, 4);
  assert.match(text, /http:\/\/gateway\.test: passed/);
  assert.match(text, /Document verdict: MATCH \(on-chain document\)/);
  assert.match(text, /Green seal\n  YES/);
  assert.match(text, /Batch status: RECALLED\. Reason: "Damaged seal"\./);
  assert.equal(result.seal.green, true);
});

test("the report for an unregistered batch and for silent readers never claims a green seal", async () => {
  const absent = await verifyBatch({
    chainId: 31337,
    contract: CONTRACT,
    batchCode: "PCB-2026-404",
    deployments: DEPLOYMENTS,
    readers: [fakeReader("http://one", goldenChain()), fakeReader("http://two", goldenChain())],
    gateways: [GATEWAY],
    fetch: fakeFetch({}),
  });
  const absentText = renderReport(absent);
  assert.match(absentText, /No batch with code PCB-2026-404 is registered on this contract\./);
  assert.match(absentText, /Contract error: BatchNotFound\(0x/);
  assert.match(absentText, /Green seal\n  NO/);

  const silent = await verifyBatch({
    chainId: 31337,
    contract: CONTRACT,
    batchCode: CODE,
    deployments: DEPLOYMENTS,
    readers: [unreachableReader("http://down")],
    gateways: [GATEWAY],
    fetch: fakeFetch({ [gatewayUrl(GATEWAY, GOLDEN_CID)]: GOLDEN_BYTES }),
  });
  const silentText = renderReport(silent);
  assert.match(silentText, /http:\/\/down\n    did not answer; the request failed/);
  assert.match(silentText, /The readers did not respond\. The batch is not reported as found or as missing\./);
  assert.doesNotMatch(silentText, /No batch with code/);
  assert.equal(silent.seal.green, false);
});
