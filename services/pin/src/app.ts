import { MetadataError, hashMetadata, parseAndValidate } from "@proofchain/metadata";
import { Hono, type Context } from "hono";
import { MAX_BLOB_BYTES, PinError, pinWithPublicCopy, type Log, type Pinner, type PublicCopy } from "./pinner.ts";

export type AppOptions = {
  publicCopy?: PublicCopy;
  log?: Log;
};

export function createApp(pinner: Pinner, options: AppOptions = {}) {
  const log = options.log ?? ((line: string) => console.error(line));
  const pin = (bytes: Uint8Array<ArrayBuffer>, fileName: string) =>
    pinWithPublicCopy(pinner, options.publicCopy, bytes, fileName, log);
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
      const pinned = await pin(bytes, "blob");
      return c.json({ cid: pinned.cid, public: pinned.public });
    } catch (error) {
      return pinFailure(c, error, "blob");
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
      const pinned = await pin(new TextEncoder().encode(body.canonical), "metadata.json");
      return c.json({ cid: pinned.cid, metadataHash: hashMetadata(body.canonical), public: pinned.public });
    } catch (error) {
      return pinFailure(c, error, "document");
    }
  });

  return app;
}

function pinFailure(c: Context, error: unknown, subject: string) {
  if (!(error instanceof PinError)) throw error;
  if (error.code === "CidMismatch") {
    return c.json({ error: "CidMismatch", message: `Pinata reported a different CID than Kubo for the ${subject}` }, 502);
  }
  return c.json({ error: "PinFailed", message: `${error.target} did not pin the ${subject}` }, 502);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
