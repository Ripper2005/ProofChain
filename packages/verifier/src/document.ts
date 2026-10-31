import { computeBatchId, MetadataError, parseAndValidate, type ProductMetadata } from "@proofchain/metadata";
import { keccak256, type Hex } from "viem";
import { checkRawCid, type CidCheck } from "./cid.ts";
import { sameHex } from "./format.ts";
import { describeReaderError, withTimeout, type FetchLike } from "./rpc.ts";

export const DEFAULT_GATEWAY_TIMEOUT_MS = 10_000;

export type CheckResult = "pass" | "fail" | "not-run";

export type DocumentCheck = {
  id: "hash" | "canonical" | "batch-code" | "batch-id";
  label: string;
  result: CheckResult;
  detail: string | null;
};

export type DocumentJudgement = {
  verdict: "match" | "mismatch";
  checks: DocumentCheck[];
  document: ProductMetadata | null;
  text: string | null;
  hash: Hex;
  reason: string | null;
};

export type GatewayAttempt = {
  gateway: string;
  url: string;
  outcome: "passed" | "wrong-bytes" | "no-bytes";
  detail: string;
  hash: Hex | null;
  cidCheck: CidCheck | null;
};

export type IpfsCopy = {
  status: "match" | "mismatch" | "unavailable";
  cid: string;
  attempts: GatewayAttempt[];
  cidCheck: CidCheck | null;
  bytes: Uint8Array | null;
};

export type OnChainDocument =
  | { status: "read"; judgement: DocumentJudgement; txHash: Hex | null; blockNumber: bigint | null }
  | { status: "unavailable"; reason: string };

export type DocumentReport = {
  verdict: "match" | "mismatch" | "unavailable";
  source: "on-chain" | "ipfs" | null;
  reason: string | null;
  document: ProductMetadata | null;
  onChain: OnChainDocument;
  ipfs: IpfsCopy;
  standIn: DocumentJudgement | null;
};

const LABELS: Record<DocumentCheck["id"], string> = {
  hash: "keccak256 of the bytes equals the metadataHash getBatch returned at the anchor block",
  canonical: "re-canonicalizing the parsed JSON produces the same bytes",
  "batch-code": "batchCode inside the document equals the batch code in the URL",
  "batch-id": "computeBatchId of that batch code equals the id used to read the contract",
};

export function judgeDocument(bytes: Uint8Array, metadataHash: Hex, urlBatchCode: string, batchId: Hex): DocumentJudgement {
  const hash = keccak256(bytes);
  const checks: DocumentCheck[] = [];
  checks.push(check("hash", sameHex(hash, metadataHash), sameHex(hash, metadataHash) ? null : `the bytes hash to ${hash}`));

  let text: string | null = null;
  let document: ProductMetadata | null = null;
  let canonicalDetail: string | null = null;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    canonicalDetail = "the bytes are not UTF-8";
  }
  if (text !== null) {
    try {
      document = parseAndValidate(text);
    } catch (error) {
      canonicalDetail = error instanceof MetadataError ? `${error.code}: ${error.message}` : "the bytes are not a product document";
    }
  }
  checks.push(check("canonical", document !== null, canonicalDetail));

  if (document) {
    const codeMatches = document.batchCode === urlBatchCode;
    checks.push(check("batch-code", codeMatches, codeMatches ? null : `the document says ${document.batchCode}`));
    const idMatches = sameHex(computeBatchId(document.batchCode), batchId);
    checks.push(check("batch-id", idMatches, idMatches ? null : `${document.batchCode} hashes to another id`));
  } else {
    checks.push(notRun("batch-code"), notRun("batch-id"));
  }

  const failed = checks.find((item) => item.result !== "pass");
  return {
    verdict: failed ? "mismatch" : "match",
    checks,
    document,
    text,
    hash,
    reason: failed ? `Check failed: ${failed.label}${failed.detail ? ` (${failed.detail})` : ""}.` : null,
  };
}

export function ipfsUrl(gateway: string, cid: string): string {
  return `${gateway.replace(/\/+$/, "")}/ipfs/${encodeURIComponent(cid)}`;
}

export async function fetchIpfsCopy(input: {
  cid: string;
  metadataHash: Hex;
  gateways: readonly string[];
  fetch: FetchLike;
  timeoutMs?: number;
}): Promise<IpfsCopy> {
  const send = input.fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_GATEWAY_TIMEOUT_MS;
  const attempts: GatewayAttempt[] = [];
  let firstBytes: Uint8Array | null = null;
  for (const gateway of input.gateways) {
    const url = ipfsUrl(gateway, input.cid);
    let bytes: Uint8Array;
    try {
      bytes = await withTimeout(timeoutMs, async (signal) => {
        const response = await send(url, { method: "GET", signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      });
    } catch (error) {
      attempts.push({ gateway, url, outcome: "no-bytes", detail: describeReaderError(error), hash: null, cidCheck: null });
      continue;
    }
    firstBytes ??= bytes;
    const hash = keccak256(bytes);
    const cidCheck = checkRawCid(input.cid, bytes);
    const hashMatches = sameHex(hash, input.metadataHash);
    if (hashMatches && cidCheck.kind !== "failed") {
      attempts.push({ gateway, url, outcome: "passed", detail: passDetail(cidCheck), hash, cidCheck });
      return { status: "match", cid: input.cid, attempts, cidCheck, bytes };
    }
    attempts.push({
      gateway,
      url,
      outcome: "wrong-bytes",
      detail: hashMatches
        ? "sha256 of the bytes does not equal the digest inside the CID"
        : `${bytes.byteLength} bytes whose keccak256 does not equal the metadataHash`,
      hash,
      cidCheck,
    });
  }
  const answered = attempts.some((attempt) => attempt.outcome === "wrong-bytes");
  return { status: answered ? "mismatch" : "unavailable", cid: input.cid, attempts, cidCheck: null, bytes: firstBytes };
}

export function documentReport(input: {
  onChain: OnChainDocument;
  ipfs: IpfsCopy;
  metadataHash: Hex;
  batchCode: string;
  batchId: Hex;
}): DocumentReport {
  const { onChain, ipfs } = input;
  if (onChain.status === "read") {
    return {
      verdict: onChain.judgement.verdict,
      source: "on-chain",
      reason: onChain.judgement.reason,
      document: onChain.judgement.document,
      onChain,
      ipfs,
      standIn: null,
    };
  }
  if (ipfs.status === "unavailable" || !ipfs.bytes) {
    return { verdict: "unavailable", source: null, reason: null, document: null, onChain, ipfs, standIn: null };
  }
  const standIn = judgeDocument(ipfs.bytes, input.metadataHash, input.batchCode, input.batchId);
  const verdict = ipfs.status === "match" ? standIn.verdict : "mismatch";
  return {
    verdict,
    source: "ipfs",
    reason:
      ipfs.status === "mismatch"
        ? "The on-chain document could not be read, and the IPFS copy failed its checks at every gateway that answered."
        : standIn.reason,
    document: standIn.document,
    onChain,
    ipfs,
    standIn,
  };
}

function passDetail(cidCheck: CidCheck): string {
  if (cidCheck.kind === "passed") return "keccak256 equals the metadataHash, and sha256 equals the digest inside the CID";
  if (cidCheck.kind === "not-checked") return `keccak256 equals the metadataHash; CID not checked, because ${cidCheck.reason}`;
  return "keccak256 equals the metadataHash";
}

function check(id: DocumentCheck["id"], passed: boolean, detail: string | null): DocumentCheck {
  return { id, label: LABELS[id], result: passed ? "pass" : "fail", detail };
}

function notRun(id: DocumentCheck["id"]): DocumentCheck {
  return { id, label: LABELS[id], result: "not-run", detail: "the document could not be parsed" };
}
