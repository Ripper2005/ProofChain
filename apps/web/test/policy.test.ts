import assert from "node:assert/strict";
import test from "node:test";
import { inspectRpcBody, isLocalhostHost, isLoopbackPeer, pinPostDecision, RPC_ALLOWLIST } from "../server/policy.ts";

test("allows a single read method and rejects writes", () => {
  assert.equal(inspectRpcBody({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }).ok, true);
  assert.equal(inspectRpcBody({ jsonrpc: "2.0", id: 2, method: "eth_getProof", params: [] }).ok, true);
  for (const method of RPC_ALLOWLIST) {
    assert.equal(inspectRpcBody({ method }).ok, true);
  }
  for (const method of ["eth_sendTransaction", "eth_sendRawTransaction", "eth_sign", "personal_sign", "anvil_impersonateAccount"]) {
    assert.equal(inspectRpcBody({ method }).ok, false);
  }
});

test("rejects a JSON-RPC batch when any method is missing or disallowed", () => {
  const mixed = inspectRpcBody([
    { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
    { jsonrpc: "2.0", id: 2, method: "eth_sendTransaction", params: [] },
  ]);
  assert.equal(mixed.ok, false);
  assert.equal(inspectRpcBody([{ method: "eth_chainId" }, { id: 2 }]).ok, false);
  assert.equal(inspectRpcBody([{ method: "eth_chainId" }, null]).ok, false);
  assert.equal(inspectRpcBody([]).ok, false);
  assert.equal(inspectRpcBody([{ method: "eth_chainId" }, { method: "eth_blockNumber" }]).ok, true);
});

test("accepts only loopback peers and a localhost Host", () => {
  assert.equal(isLoopbackPeer("127.0.0.1"), true);
  assert.equal(isLoopbackPeer("::1"), true);
  assert.equal(isLoopbackPeer("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackPeer("::ffff:192.168.1.20"), false);
  assert.equal(isLoopbackPeer("10.42.28.58"), false);
  assert.equal(isLocalhostHost("localhost"), true);
  assert.equal(isLocalhostHost("localhost:5173"), true);
  assert.equal(isLocalhostHost("127.0.0.1"), true);
  assert.equal(isLocalhostHost("127.0.0.1:5173"), true);
  assert.equal(isLocalhostHost("LOCALHOST:5173"), true);
  assert.equal(isLocalhostHost("192.168.1.20:5173"), false);
  assert.equal(isLocalhostHost("[::1]:5173"), false);
  assert.equal(isLocalhostHost("localhost.example"), false);
  assert.equal(pinPostDecision("127.0.0.1", "localhost:5173").ok, true);
  const forged = pinPostDecision("10.42.28.58", "localhost");
  assert.equal(forged.ok, false);
  if (!forged.ok) assert.match(forged.message, /loopback TCP peer/);
  const tunnel = pinPostDecision("127.0.0.1", "demo.example");
  assert.equal(tunnel.ok, false);
  if (!tunnel.ok) assert.match(tunnel.message, /Host header/);
});
