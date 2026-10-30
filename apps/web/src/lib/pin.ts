import type { Hex } from "viem";

export async function pinBlob(bytes: Uint8Array): Promise<string> {
  const response = await fetch("/api/blobs", {
    method: "POST",
    headers: { "content-type": "application/octet-stream", accept: "application/json" },
    body: blobFrom(bytes),
  });
  const body = await readJson(response);
  if (!response.ok) throw new Error(pinMessage(body, response.status));
  if (!body || typeof body.cid !== "string") throw new Error("Pin service response did not include a CID");
  return body.cid;
}

export async function pinMetadata(canonical: string, batchCode: string): Promise<{ cid: string; metadataHash: Hex }> {
  const response = await fetch("/api/metadata", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ canonical, batchCode }),
  });
  const body = await readJson(response);
  if (!response.ok) throw new Error(pinMessage(body, response.status));
  if (!body || typeof body.cid !== "string" || typeof body.metadataHash !== "string") {
    throw new Error("Pin service response did not include a CID and metadata hash");
  }
  return { cid: body.cid, metadataHash: body.metadataHash as Hex };
}

function blobFrom(bytes: Uint8Array): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy]);
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value = (await response.json()) as unknown;
    if (!value || typeof value !== "object") return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pinMessage(body: Record<string, unknown> | null, status: number): string {
  if (body && typeof body.error === "string" && typeof body.message === "string") return `${body.error}: ${body.message}`;
  return `Pin service returned ${status}`;
}
