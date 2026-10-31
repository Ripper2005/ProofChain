import { MetadataError } from "@proofchain/metadata";
import { contractErrorText, walletRejected } from "./errors.ts";

export const READER_FAILURE = "This site's readers did not respond. The batch is not shown as found or as missing.";

export const DOCUMENT_UNAVAILABLE =
  "The product document is unavailable. Custody, status, hashes, and transactions above still come from the contract.";

export const REVERTED_RECEIPT = "The transaction reverted. The contract did not apply this action.";

export function receiptAccepted(status: "success" | "reverted"): boolean {
  return status === "success";
}

export function registrationFailureText(error: unknown, pinned: boolean): string {
  if (error instanceof MetadataError) return `${error.code}: ${error.message}`;
  if (pinned && walletRejected(error)) {
    return "The wallet rejected the request. The pin remains on IPFS, and this page will not offer a QR code.";
  }
  if (pinned) {
    return `${contractErrorText(error)} The pin remains on IPFS, and this page will not offer a QR code until a receipt succeeds.`;
  }
  return contractErrorText(error);
}
