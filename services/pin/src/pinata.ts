import type { Pinner } from "./pinner.ts";

export const PINATA_API_URL = "https://uploads.pinata.cloud/v3";
export const PINATA_TIMEOUT_MS = 120_000;

export type PinataOptions = {
  jwt: string;
  apiUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const CID_PATTERN = /^[A-Za-z0-9]{1,128}$/;

export function createPinataPinner({
  jwt,
  apiUrl = PINATA_API_URL,
  timeoutMs = PINATA_TIMEOUT_MS,
  fetchImpl = fetch,
}: PinataOptions): Pinner {
  return {
    async pin(bytes, fileName) {
      const url = new URL("files", apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
      const form = new FormData();
      form.append("file", new Blob([bytes], fileName.endsWith(".json") ? { type: "application/json" } : {}), fileName);
      form.append("network", "public");
      form.append("name", fileName);
      // Must stay the profile that reproduces Kubo's cid-version=1 DAG, or every CID check fails.
      form.append("cid_version", "v1");

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { authorization: `Bearer ${jwt}` },
          body: form,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new Error(isTimeout(error) ? `Pinata upload timed out after ${timeoutMs} ms` : "Pinata upload request failed");
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Pinata upload failed with ${response.status}`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new Error(isTimeout(error) ? `Pinata upload timed out after ${timeoutMs} ms` : "Pinata upload response was not JSON");
      }
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
      if (typeof data.network === "string" && data.network !== "public") {
        throw new Error("Pinata did not store the upload on the public network");
      }
      if (typeof data.cid !== "string" || !CID_PATTERN.test(data.cid)) {
        throw new Error("Pinata upload response did not include a CID");
      }
      return data.cid;
    },
  };
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
