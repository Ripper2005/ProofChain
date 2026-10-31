import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbiParameters, toBytes, toEventSelector } from "viem";
import {
  decodeProductLog,
  eventSignature,
  eventSignaturesFromSource,
  productEvents,
  productSignatures,
  type BatchRegisteredPayload,
} from "../src/events.ts";
import { batchCode, batchId, document, encodedLog, manufacturer, metadataCid, metadataHash } from "./fixture.ts";

describe("ProductRegistry events", () => {
  it("uses the event signatures from the contract source", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../contracts/src/ProductRegistry.sol", import.meta.url)),
      "utf8",
    );
    assert.deepEqual(eventSignaturesFromSource(source), productSignatures());
  });

  it("hashes those signatures as the log topics", () => {
    for (const event of productEvents) {
      assert.ok(event.name);
      const topic = encodeEventTopics({ abi: [event], eventName: event.name })[0];
      assert.equal(topic, toEventSelector(eventSignature(event)));
    }
  });

  it("decodes the registration document into the log payload", () => {
    assert.equal(keccak256(toBytes(document)), metadataHash);
    const log = encodedLog({
      eventName: "BatchRegistered",
      args: { batchId, manufacturer, batchCode, metadataHash, metadataCid, createdAt: 1_793_000_000n, document },
      blockNumber: 1,
      blockHash: `0x${"01".repeat(32)}`,
      txHash: `0x${"02".repeat(32)}`,
      logIndex: 0,
    });
    const decoded = decodeProductLog(log);
    assert.ok(typeof decoded === "object");
    assert.equal(decoded.eventName, "BatchRegistered");
    const payload = decoded.payload as BatchRegisteredPayload;
    assert.equal(payload.document, document);
    assert.equal(payload.metadataHash, metadataHash);
    assert.equal(payload.batchCode, batchCode);
    assert.equal(payload.createdAt, 1_793_000_000);
  });

  it("ignores the version 1 registration topic and rejects version 1 data under the version 2 topic", () => {
    const v1Topic = toEventSelector("BatchRegistered(bytes32,address,string,bytes32,string,uint64)");
    const v1Data = encodeAbiParameters(parseAbiParameters("string, bytes32, string, uint64"), [
      batchCode,
      metadataHash,
      metadataCid,
      1_793_000_000n,
    ]);
    const indexed = [batchId, `0x${manufacturer.slice(2).padStart(64, "0")}`];
    const base = {
      blockNumber: 1,
      blockHash: `0x${"01".repeat(32)}`,
      transactionHash: `0x${"02".repeat(32)}`,
      logIndex: 0,
      data: v1Data,
    };
    assert.equal(decodeProductLog({ ...base, topics: [v1Topic, ...indexed] }), "ignore");
    const v2Topic = toEventSelector("BatchRegistered(bytes32,address,string,bytes32,string,uint64,string)");
    assert.equal(decodeProductLog({ ...base, topics: [v2Topic, ...indexed] }), "invalid");
  });
});
