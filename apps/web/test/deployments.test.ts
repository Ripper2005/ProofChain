import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { productRegistryAbi as verifierAbi } from "@proofchain/verifier";
import trusted from "../trusted-deployments.json" with { type: "json" };
import { productRegistryAbi } from "../src/contracts/ProductRegistry.ts";
import {
  configurationErrors,
  describeTrust,
  ipfsGateways,
  readerUrls,
  trustedDeployments,
  writeTarget,
} from "../src/lib/deployments.ts";

const LOCAL = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const SEPOLIA = "0x085156D33591d8DCce11703017D9B078bdEb837b";

test("the web app reads the committed trusted-deployments.json through the verifier", () => {
  const list = trustedDeployments();
  assert.deepEqual(list.errors, []);
  assert.equal(list.deployments.length, trusted.deployments.length);
  for (const chainId of new Set(list.deployments.map((item) => item.chainId))) {
    const current = list.deployments.filter((item) => item.chainId === chainId && item.current);
    assert.ok(current.length <= 1, `chain ${chainId} has ${current.length} current deployments`);
  }
  assert.deepEqual(describeTrust(31337, LOCAL), { kind: "current", label: "local anvil" });
  assert.equal(describeTrust(11155111, SEPOLIA).kind, "current");
  assert.deepEqual(configurationErrors(), []);
});

test("outside the dev server the readers are the listed ones only, and no gateway is invented", () => {
  const sepolia = trusted.deployments.find((item) => item.chainId === 11155111 && item.current);
  assert.deepEqual(readerUrls(11155111), sepolia?.rpcUrls);
  assert.deepEqual(readerUrls(31337), []);
  assert.deepEqual(ipfsGateways(), []);
  assert.deepEqual(writeTarget(), { kind: "not-configured" });
});

test("the web app's generated ABI and the verifier's copy are the same ABI", () => {
  assert.deepEqual(verifierAbi, productRegistryAbi);
  const generator = readFileSync(new URL("../scripts/generate-abi.mjs", import.meta.url), "utf8");
  assert.match(generator, /packages\/verifier\/src\/abi\.ts/);
});

test("the verification logic lives in the verifier package, not in the web app", () => {
  for (const file of ["deployments.ts", "document.ts", "errors.ts", "format.ts"]) {
    const source = readFileSync(new URL(`../src/lib/${file}`, import.meta.url), "utf8");
    assert.match(source, /from "@proofchain\/verifier"/, file);
  }
  const page = readFileSync(new URL("../src/pages/VerifyPage.tsx", import.meta.url), "utf8");
  assert.match(page, /verifyBatch\(/);
  assert.doesNotMatch(page, /readContract|getLogs/);
});
