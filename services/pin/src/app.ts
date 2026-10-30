import { MetadataError, hashMetadata, parseAndValidate } from "@proofchain/metadata";
import { Hono } from "hono";
import { MAX_BLOB_BYTES, type Pinner } from "./pinner.ts";

export function createApp(pinner: Pinner) {
  const app = new Hono();

  app.post("/blobs", async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0) {
      return c.json({ error: "EmptyBody", message: "Blob body is empty" }, 400);
    }
    if (bytes.byteLength > MAX_BLOB_BYTES) {
      return c.json({ error: "TooLarge", message: "Blob exceeds 5 MB" }, 413);
    }
    try {
      const cid = await pinner.pin(bytes, "blob");
      return c.json({ cid });
    } catch {
      return c.json({ error: "PinFailed", message: "Kubo did not pin the blob" }, 502);
    }
  });

  app.post("/metadata", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "InvalidJson", message: "Request body must be JSON" }, 400);
    }
    if (!isRecord(body) || !hasExactKeys(body, ["batchCode", "canonical"])) {
      return c.json({ error: "InvalidRequest", message: "Body must contain only canonical and batchCode" }, 400);
    }
    if (typeof body.canonical !== "string" || typeof body.batchCode !== "string") {
      return c.json({ error: "InvalidRequest", message: "canonical and batchCode must be strings" }, 400);
    }

    let document;
    try {
      document = parseAndValidate(body.canonical);
    } catch (error) {
      if (error instanceof MetadataError) {
        return c.json({ error: error.code, message: error.message }, 400);
      }
      throw error;
    }
    if (body.batchCode !== document.batchCode) {
      return c.json({ error: "BatchCodeMismatch", message: "batchCode does not match the document" }, 400);
    }

    try {
      const cid = await pinner.pin(new TextEncoder().encode(body.canonical), "metadata.json");
      return c.json({ cid, metadataHash: hashMetadata(body.canonical) });
    } catch {
      return c.json({ error: "PinFailed", message: "Kubo did not pin the document" }, 502);
    }
  });

  return app;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
