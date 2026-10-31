import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOCAL_DATABASE_URL,
  LOCAL_IPFS_API_URL,
  LOCAL_PIN_URL,
  LOCAL_WEB_ORIGIN,
  loadConfig,
} from "../src/config.ts";
import { createPool } from "../src/pg-store.ts";
import { probePin } from "../src/pin.ts";

const required = {
  CONTRACT_ADDRESS: "0xAbAbAbAbAbAbAbAbAbAbAbAbAbAbAbAbAbAbAbAb",
  START_BLOCK: "4",
};

describe("loadConfig", () => {
  it("uses the local defaults and requires the deployment", () => {
    const config = loadConfig(required);
    assert.equal(config.databaseUrl, LOCAL_DATABASE_URL);
    assert.equal(config.chainRpcUrl, "http://127.0.0.1:8545");
    assert.equal(config.chainId, 31337);
    assert.equal(config.contractAddress, "0xabababababababababababababababababababab");
    assert.equal(config.startBlock, 4);
    assert.equal(config.confirmations, 0);
    assert.equal(config.reorgWindow, 64);
    assert.equal(config.logRange, 50_000);
    assert.equal(config.ipfsApiUrl, LOCAL_IPFS_API_URL);
    assert.equal(config.port, 8787);
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.webOrigin, LOCAL_WEB_ORIGIN);
    assert.equal(config.pinUrl, LOCAL_PIN_URL);
    assert.equal(config.pollIntervalMs, 2000);
  });

  it("uses two confirmations for Sepolia unless the environment sets them", () => {
    assert.equal(loadConfig({ ...required, CHAIN_ID: "11155111" }).confirmations, 2);
    assert.equal(loadConfig({ ...required, CHAIN_ID: "11155111", CONFIRMATIONS: "0" }).confirmations, 0);
  });

  it("reads the reorg window and the log range and refuses zero for either", () => {
    const config = loadConfig({ ...required, REORG_WINDOW: "128", LOG_RANGE: "10000" });
    assert.equal(config.reorgWindow, 128);
    assert.equal(config.logRange, 10_000);
    assert.throws(() => loadConfig({ ...required, LOG_RANGE: "0" }), /LOG_RANGE/);
    assert.throws(() => loadConfig({ ...required, REORG_WINDOW: "0" }), /REORG_WINDOW/);
  });

  it("refuses to start without a contract or a start block", () => {
    assert.throws(() => loadConfig({ START_BLOCK: "0" }), /CONTRACT_ADDRESS/);
    assert.throws(() => loadConfig({ CONTRACT_ADDRESS: required.CONTRACT_ADDRESS }), /START_BLOCK/);
  });
});

describe("pin probe", () => {
  it("treats any HTTP response as reachable", async () => {
    assert.equal(await probePin("http://pin.local", async () => new Response("missing", { status: 404 })), true);
    assert.equal(
      await probePin("http://pin.local", async () => {
        throw new Error("down");
      }),
      false,
    );
  });
});

describe("postgres driver", () => {
  it("loads a pool without opening a connection", async () => {
    const pool = createPool(LOCAL_DATABASE_URL);
    assert.equal(typeof pool.end, "function");
    await pool.end();
  });
});
