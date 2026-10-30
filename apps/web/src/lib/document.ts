import { computeBatchId, parseAndValidate, type ProductMetadata } from "@proofchain/metadata";
import { keccak256, type Hex } from "viem";
import { sameHex } from "./format.ts";

export type DocumentJudgement =
  | { verdict: "match"; document: ProductMetadata }
  | { verdict: "mismatch"; reason: string; document: ProductMetadata | null };

export function judgeDocument(
  bytes: Uint8Array,
  metadataHash: Hex,
  urlBatchCode: string,
  batchId: Hex,
): DocumentJudgement {
  if (!sameHex(keccak256(bytes), metadataHash)) {
    return {
      verdict: "mismatch",
      reason: "The keccak256 of the fetched bytes does not equal the registered metadata hash.",
      document: tryParse(bytes),
    };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { verdict: "mismatch", reason: "The fetched bytes are not UTF-8.", document: null };
  }
  try {
    const document = parseAndValidate(text);
    if (document.batchCode !== urlBatchCode) {
      return {
        verdict: "mismatch",
        reason: "The batch code inside the document does not equal the batch code in the URL.",
        document,
      };
    }
    if (!sameHex(computeBatchId(document.batchCode), batchId)) {
      return {
        verdict: "mismatch",
        reason: "The batch id computed from the document does not equal the id used to read the contract.",
        document,
      };
    }
    return { verdict: "match", document };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const reason = message.toLowerCase().includes("canonical")
      ? "Re-canonicalizing the parsed JSON does not reproduce the fetched bytes."
      : "The fetched bytes are not a valid canonical product document.";
    return { verdict: "mismatch", reason, document: tryParse(bytes) };
  }
}

export function ipfsFileUrl(cid: string): string {
  const env = import.meta.env as { VITE_IPFS_GATEWAY_URL?: string } | undefined;
  const configured = env?.VITE_IPFS_GATEWAY_URL?.trim() ?? "";
  const path = `/ipfs/${encodeURIComponent(cid)}`;
  if (!configured) return path;
  return `${configured.replace(/\/$/, "")}${path}`;
}

export async function fetchIpfsBytes(cid: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(ipfsFileUrl(cid));
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function tryParse(bytes: Uint8Array): ProductMetadata | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return parseAndValidate(text);
  } catch {
    return null;
  }
}
