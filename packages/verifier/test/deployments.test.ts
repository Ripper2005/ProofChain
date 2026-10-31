import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyTrust,
  currentOn,
  describeTrust,
  listedReaders,
  parseDeployments,
  parseGatewayList,
  readersFor,
  resolveWriteChain,
  writeTargetIn,
  writeTargetMessage,
} from "../src/index.ts";

const LOCAL = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const OLD_LOCAL = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const SEPOLIA = "0x01E560E6F16D86b7764284476a3E57D013bF5840";
const UNLISTED = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const DEV_RPC = "http://localhost:5173/rpc";
const SEPOLIA_READERS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://1rpc.io/sepolia",
  "https://sepolia.gateway.tenderly.co",
  "https://sepolia.rpc.thirdweb.com",
  "https://0xrpc.io/sep",
];

function entry(chainId: number, address: string, current: boolean, rpcUrls: string[] = []) {
  return { chainId, address, startBlock: 1, label: `chain ${chainId} ${address.slice(0, 6)}`, current, rpcUrls };
}

const sample = parseDeployments({
  deployments: [
    entry(31337, OLD_LOCAL, false),
    entry(31337, LOCAL, true),
    entry(11155111, SEPOLIA, true, SEPOLIA_READERS),
  ],
});

test("the committed trusted-deployments.json parses with one current deployment per chain", () => {
  const file = JSON.parse(readFileSync(new URL("../../../apps/web/trusted-deployments.json", import.meta.url), "utf8"));
  const list = parseDeployments(file);
  assert.deepEqual(list.errors, []);
  assert.equal(currentOn(list, 31337)?.address, LOCAL);
  assert.deepEqual(currentOn(list, 31337)?.rpcUrls, []);
  assert.equal(currentOn(list, 11155111)?.address, SEPOLIA);
  assert.deepEqual(listedReaders(list, 11155111), SEPOLIA_READERS);
});

test("two current deployments on one chain are a configuration error", () => {
  const list = parseDeployments({
    deployments: [entry(31337, OLD_LOCAL, true), entry(31337, LOCAL, true), entry(11155111, SEPOLIA, true)],
  });
  assert.equal(list.errors.length, 1);
  assert.match(list.errors[0] ?? "", /marks 2 deployments current on chain 31337/);
  assert.equal(currentOn(list, 31337), null);
  assert.equal(currentOn(list, 11155111)?.address, SEPOLIA);
  assert.deepEqual(writeTargetIn(list, 31337), { kind: "no-deployment", chainId: 31337 });
  const trust = classifyTrust(list, 31337, LOCAL);
  assert.equal(trust.kind, "earlier");
  assert.equal(trust.kind === "earlier" ? trust.current : undefined, null);
});

test("an entry that is not a valid deployment is reported and ignored", () => {
  const list = parseDeployments({
    deployments: [
      { chainId: 11155111, address: SEPOLIA, startBlock: 0, label: "sepolia", current: true, rpcUrl: SEPOLIA_READERS[0] },
      { ...entry(31337, LOCAL, true), rpcUrls: ["ftp://example.org"] },
      { ...entry(31337, LOCAL, true), address: "0x1234" },
    ],
  });
  assert.equal(list.deployments.length, 0);
  assert.equal(list.errors.length, 3);
});

test("trust is classified per chain and the address case does not matter", () => {
  assert.deepEqual(sample.errors, []);
  assert.deepEqual(classifyTrust(sample, 31337, LOCAL), { kind: "current", label: "chain 31337 0x5FbD" });
  assert.deepEqual(classifyTrust(sample, 31337, LOCAL.toLowerCase()), { kind: "current", label: "chain 31337 0x5FbD" });
  assert.deepEqual(classifyTrust(sample, 31337, `0x${LOCAL.slice(2).toUpperCase()}`), {
    kind: "current",
    label: "chain 31337 0x5FbD",
  });
  assert.deepEqual(classifyTrust(sample, 11155111, SEPOLIA), { kind: "current", label: "chain 11155111 0x01E5" });

  const earlier = classifyTrust(sample, 31337, OLD_LOCAL);
  assert.equal(earlier.kind, "earlier");
  assert.equal(earlier.kind === "earlier" ? earlier.current?.address : undefined, LOCAL);
  assert.match(describeTrust(earlier, 31337), new RegExp(`earlier contract.*${LOCAL}`));

  assert.deepEqual(classifyTrust(sample, 11155111, LOCAL), { kind: "unrecognized" });
  assert.deepEqual(classifyTrust(sample, 31337, UNLISTED), { kind: "unrecognized" });
  assert.deepEqual(classifyTrust(sample, 1, SEPOLIA), { kind: "unrecognized" });
  assert.deepEqual(classifyTrust(sample, 31337, "not an address"), { kind: "unrecognized" });
});

test("the readers are every listed reader on that chain, else same-origin /rpc in dev, else none", () => {
  assert.deepEqual(readersFor(sample, 11155111, null), SEPOLIA_READERS);
  assert.deepEqual(readersFor(sample, 11155111, DEV_RPC), SEPOLIA_READERS);
  assert.deepEqual(readersFor(sample, 31337, DEV_RPC), [DEV_RPC]);
  assert.deepEqual(readersFor(sample, 31337, null), []);
  assert.deepEqual(readersFor(sample, 1, null), []);

  const earlierWithReaders = parseDeployments({
    deployments: [entry(11155111, OLD_LOCAL, false, ["https://old.example"]), entry(11155111, SEPOLIA, true)],
  });
  assert.deepEqual(readersFor(earlierWithReaders, 11155111, null), ["https://old.example"]);
});

test("the gateway list is comma-separated origins, and empty means none configured", () => {
  assert.deepEqual(parseGatewayList(undefined), { gateways: [], errors: [] });
  assert.deepEqual(parseGatewayList(" "), { gateways: [], errors: [] });
  assert.deepEqual(parseGatewayList("https://demo.mypinata.cloud/, https://gateway.pinata.cloud"), {
    gateways: ["https://demo.mypinata.cloud", "https://gateway.pinata.cloud"],
    errors: [],
  });
  const bad = parseGatewayList("ipfs://nope,https://gateway.pinata.cloud");
  assert.deepEqual(bad.gateways, ["https://gateway.pinata.cloud"]);
  assert.match(bad.errors[0] ?? "", /VITE_IPFS_GATEWAYS lists "ipfs:\/\/nope"/);
});

test("the write chain defaults to Anvil in dev and to none in a production build", () => {
  assert.deepEqual(resolveWriteChain(undefined, true), { chainId: 31337, error: null });
  assert.deepEqual(resolveWriteChain("", true), { chainId: 31337, error: null });
  assert.deepEqual(resolveWriteChain(undefined, false), { chainId: null, error: null });
  assert.deepEqual(resolveWriteChain(" 11155111 ", false), { chainId: 11155111, error: null });
  const invalid = resolveWriteChain("sepolia", true);
  assert.equal(invalid.chainId, null);
  assert.match(invalid.error ?? "", /VITE_WRITE_CHAIN_ID/);

  const notConfigured = writeTargetIn(sample, null);
  assert.deepEqual(notConfigured, { kind: "not-configured" });
  assert.match(writeTargetMessage(notConfigured) ?? "", /Writing is not configured on this site\. Verification still works\./);
  const sepolia = writeTargetIn(sample, 11155111);
  assert.equal(sepolia.kind === "ready" ? sepolia.deployment.address : null, SEPOLIA);
  assert.equal(writeTargetMessage(sepolia), null);
  assert.deepEqual(writeTargetIn(sample, 1), { kind: "no-deployment", chainId: 1 });
});
