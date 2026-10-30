import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp } from "../src/app.ts";
import { createKuboPinner } from "../src/kubo.ts";
import type { Pinner } from "../src/pinner.ts";

const GOLDEN =
  '{"batchCode":"PCB-2026-001","description":"","imageCid":"","manufacturerName":"Demo Electronics Pvt. Ltd.","name":"STM32 Controller Development Board","productionDate":"2026-10-15","quantity":50,"schemaVersion":1,"sku":"CTRL-STM32-A"}';

describe("POST /metadata", () => {
  it("pins the exact canonical bytes and returns the golden hash", async () => {
    const pinner = new RecordingPinner();
    const response = await createApp(pinner).request("/metadata", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ canonical: GOLDEN, batchCode: "PCB-2026-001" }),
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { cid: string; metadataHash: string };
    assert.equal(payload.cid, "bafytest");
    assert.equal(payload.metadataHash, "0xd318be071fd3161c69b2f2eb4ff0a4d1ba56e1657a6ca854291454927994a752");
    assert.equal(pinner.calls.length, 1);
    assert.equal(new TextDecoder().decode(pinner.calls[0].bytes), GOLDEN);
    assert.equal(pinner.calls[0].fileName, "metadata.json");
  });

  it("rejects a non-canonical body before any pin", async () => {
    const pinner = new RecordingPinner();
    const response = await createApp(pinner).request("/metadata", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ canonical: GOLDEN.replace("{", "{ "), batchCode: "PCB-2026-001" }),
    });
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { error: string };
    assert.equal(payload.error, "NonCanonical");
    assert.equal(pinner.calls.length, 0);
  });

  it("rejects a wrong schemaVersion and an empty name before any pin", async () => {
    const parsed = JSON.parse(GOLDEN) as Record<string, unknown>;
    const pinner = new RecordingPinner();
    const app = createApp(pinner);
    const wrongVersion = await app.request("/metadata", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        canonical: JSON.stringify({ ...parsed, schemaVersion: 2 }),
        batchCode: "PCB-2026-001",
      }),
    });
    const emptyName = await app.request("/metadata", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        canonical: JSON.stringify({ ...parsed, name: "" }),
        batchCode: "PCB-2026-001",
      }),
    });
    assert.equal(wrongVersion.status, 400);
    assert.equal(emptyName.status, 400);
    assert.equal(pinner.calls.length, 0);
  });

  it("rejects a batch code that does not match the document before any pin", async () => {
    const pinner = new RecordingPinner();
    const response = await createApp(pinner).request("/metadata", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ canonical: GOLDEN, batchCode: "OTHER-1" }),
    });
    assert.equal(response.status, 400);
    assert.equal(pinner.calls.length, 0);
  });
});

describe("POST /blobs", () => {
  it("rejects an empty body before any pin", async () => {
    const pinner = new RecordingPinner();
    const response = await createApp(pinner).request("/blobs", { method: "POST", body: "" });
    assert.equal(response.status, 400);
    assert.equal(pinner.calls.length, 0);
  });

  it("returns the CID from the pinner", async () => {
    const pinner = new RecordingPinner();
    const response = await createApp(pinner).request("/blobs", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { cid: string };
    assert.equal(payload.cid, "bafytest");
    assert.deepEqual(pinner.calls[0].bytes, new Uint8Array([1, 2, 3]));
  });
});

describe("Kubo pinner", () => {
  it("asks Kubo for a pinned CIDv1 and does not hash the bytes itself", async () => {
    let requested = "";
    const fetchImpl: typeof fetch = async (input) => {
      requested = String(input);
      return new Response(JSON.stringify({ Hash: "bafyfromkubo", Size: "3" }), { status: 200 });
    };
    const cid = await createKuboPinner("http://127.0.0.1:5001", fetchImpl).pin(new Uint8Array([1, 2, 3]), "blob");
    assert.equal(cid, "bafyfromkubo");
    const url = new URL(requested);
    assert.equal(url.pathname, "/api/v0/add");
    assert.equal(url.searchParams.get("cid-version"), "1");
    assert.equal(url.searchParams.get("pin"), "true");
  });
});

class RecordingPinner implements Pinner {
  calls: { bytes: Uint8Array; fileName: string }[] = [];

  async pin(bytes: Uint8Array, fileName: string): Promise<string> {
    this.calls.push({ bytes, fileName });
    return "bafytest";
  }
}
