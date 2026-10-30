import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { encodeEventTopics, toEventSelector } from "viem";
import { eventSignature, eventSignaturesFromSource, productEvents, productSignatures } from "../src/events.ts";

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
});
