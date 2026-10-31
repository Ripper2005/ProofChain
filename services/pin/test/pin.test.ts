import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp } from "../src/app.ts";
import { createKuboPinner } from "../src/kubo.ts";
import { MAX_BLOB_BYTES, type Pinner } from "../src/pinner.ts";

const GOLDEN =
  '{"batchCode":"PCB-2026-001","description":"","imageCid":"","manufacturerName":"Demo Electronics Pvt. Ltd.","name":"STM32 Controller Development Board","productionDate":"2026-10-15","quantity":50,"schemaVersion":1,"sku":"CTRL-STM32-A"}';
const GOLDEN_HASH = "0xd318be071fd3161c69b2f2eb4ff0a4d1ba56e1657a6ca854291454927994a752";
const GOLDEN_CID = "bafkreicjx37puhth4lglmhqqna5gjrcvjedfpputssey6isdy5slgiz7im";

describe("POST /metadata", () => {
  it("pins the exact canonical bytes and returns the golden hash", async () => {
    const pinner = new RecordingPinner();
    const response = await createApp(pinner).request("/metadata", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ canonical: GOLDEN, batchCode: "PCB-2026-001" }),
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { cid: string; metadataHash: string; public: boolean };
    assert.equal(payload.cid, "bafytest");
    assert.equal(payload.metadataHash, "0xd318be071fd3161c69b2f2eb4ff0a4d1ba56e1657a6ca854291454927994a752");
    assert.equal(payload.public, false);
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
    const payload = (await response.json()) as { cid: string; public: boolean };
    assert.equal(payload.cid, "bafytest");
    assert.equal(payload.public, false);
    assert.deepEqual(pinner.calls[0].bytes, new Uint8Array([1, 2, 3]));
  });

  it("rejects a body over 5 MB before any pin", async () => {
    const pinner = new RecordingPinner();
    const response = await createApp(pinner).request("/blobs", {
      method: "POST",
      body: new Uint8Array(MAX_BLOB_BYTES + 1),
    });
    assert.equal(response.status, 413);
    assert.equal(pinner.calls.length, 0);
  });
});

describe("public copy on Pinata", () => {
  it("returns public: true when Pinata reports Kubo's CID, for both routes", async () => {
    const kubo = new RecordingPinner(GOLDEN_CID);
    const pinata = new RecordingPinner(GOLDEN_CID);
    const app = createApp(kubo, { publicCopy: { pinner: pinata, required: true }, log: () => {} });

    const metadata = await postGolden(app);
    assert.equal(metadata.status, 200);
    assert.deepEqual(await metadata.json(), {
      cid: GOLDEN_CID,
      metadataHash: GOLDEN_HASH,
      public: true,
    });
    assert.equal(new TextDecoder().decode(pinata.calls[0].bytes), GOLDEN);
    assert.equal(pinata.calls[0].fileName, "metadata.json");

    const blob = await app.request("/blobs", { method: "POST", body: new Uint8Array([1, 2, 3]) });
    assert.equal(blob.status, 200);
    assert.deepEqual(await blob.json(), { cid: GOLDEN_CID, public: true });
    assert.deepEqual(pinata.calls[1].bytes, new Uint8Array([1, 2, 3]));
  });

  it("fails with CidMismatch and no CID when Pinata reports a different CID", async () => {
    for (const required of [true, false]) {
      const lines: string[] = [];
      const app = createApp(new RecordingPinner(GOLDEN_CID), {
        publicCopy: { pinner: new RecordingPinner("bafybeiotherotherother"), required },
        log: (line) => lines.push(line),
      });

      const metadata = await postGolden(app);
      assert.equal(metadata.status, 502);
      const metadataPayload = (await metadata.json()) as Record<string, unknown>;
      assert.deepEqual(Object.keys(metadataPayload).sort(), ["error", "message"]);
      assert.equal(metadataPayload.error, "CidMismatch");
      assert.doesNotMatch(JSON.stringify(metadataPayload), /bafy|bafk/);

      const blob = await app.request("/blobs", { method: "POST", body: new Uint8Array([1]) });
      assert.equal(blob.status, 502);
      const blobPayload = (await blob.json()) as Record<string, unknown>;
      assert.deepEqual(Object.keys(blobPayload).sort(), ["error", "message"]);
      assert.equal(blobPayload.error, "CidMismatch");

      assert.ok(lines.some((line) => line.includes(GOLDEN_CID) && line.includes("bafybeiotherotherother")));
    }
  });

  it("fails with PinFailed when a required Pinata copy fails", async () => {
    const app = createApp(new RecordingPinner(GOLDEN_CID), {
      publicCopy: { pinner: new FailingPinner(), required: true },
      log: () => {},
    });

    const metadata = await postGolden(app);
    assert.equal(metadata.status, 502);
    assert.deepEqual(await metadata.json(), { error: "PinFailed", message: "Pinata did not pin the document" });

    const blob = await app.request("/blobs", { method: "POST", body: new Uint8Array([1]) });
    assert.equal(blob.status, 502);
    assert.deepEqual(await blob.json(), { error: "PinFailed", message: "Pinata did not pin the blob" });
  });

  it("returns public: false when an optional Pinata copy fails", async () => {
    const lines: string[] = [];
    const app = createApp(new RecordingPinner(GOLDEN_CID), {
      publicCopy: { pinner: new FailingPinner(), required: false },
      log: (line) => lines.push(line),
    });

    const metadata = await postGolden(app);
    assert.equal(metadata.status, 200);
    assert.deepEqual(await metadata.json(), { cid: GOLDEN_CID, metadataHash: GOLDEN_HASH, public: false });

    const blob = await app.request("/blobs", { method: "POST", body: new Uint8Array([1]) });
    assert.equal(blob.status, 200);
    assert.deepEqual(await blob.json(), { cid: GOLDEN_CID, public: false });
    assert.equal(lines.length, 2);
  });

  it("fails on a Kubo error before any Pinata call", async () => {
    const pinata = new RecordingPinner(GOLDEN_CID);
    for (const required of [true, false]) {
      const app = createApp(new FailingPinner(), { publicCopy: { pinner: pinata, required }, log: () => {} });

      const metadata = await postGolden(app);
      assert.equal(metadata.status, 502);
      assert.deepEqual(await metadata.json(), { error: "PinFailed", message: "Kubo did not pin the document" });

      const blob = await app.request("/blobs", { method: "POST", body: new Uint8Array([1]) });
      assert.equal(blob.status, 502);
      assert.deepEqual(await blob.json(), { error: "PinFailed", message: "Kubo did not pin the blob" });
    }
    assert.equal(pinata.calls.length, 0);
  });

  it("keeps the request checks ahead of both pins", async () => {
    const kubo = new RecordingPinner(GOLDEN_CID);
    const pinata = new RecordingPinner(GOLDEN_CID);
    const app = createApp(kubo, { publicCopy: { pinner: pinata, required: true }, log: () => {} });
    const wrongCode = await app.request("/metadata", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ canonical: GOLDEN, batchCode: "OTHER-1" }),
    });
    const empty = await app.request("/blobs", { method: "POST", body: "" });
    assert.equal(wrongCode.status, 400);
    assert.equal(empty.status, 400);
    assert.equal(kubo.calls.length + pinata.calls.length, 0);
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

  it("gives up when Kubo does not answer within the timeout", async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    await assert.rejects(
      createKuboPinner("http://127.0.0.1:5001", fetchImpl, 20).pin(new Uint8Array([1]), "blob"),
      (error: Error) => error.name === "TimeoutError",
    );
  });
});

function postGolden(app: ReturnType<typeof createApp>) {
  return app.request("/metadata", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ canonical: GOLDEN, batchCode: "PCB-2026-001" }),
  });
}

class RecordingPinner implements Pinner {
  calls: { bytes: Uint8Array; fileName: string }[] = [];
  private readonly cid: string;

  constructor(cid = "bafytest") {
    this.cid = cid;
  }

  async pin(bytes: Uint8Array, fileName: string): Promise<string> {
    this.calls.push({ bytes, fileName });
    return this.cid;
  }
}

class FailingPinner implements Pinner {
  calls = 0;

  async pin(): Promise<string> {
    this.calls += 1;
    throw new Error("target unavailable");
  }
}
