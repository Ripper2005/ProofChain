import { contractErrorText } from "@proofchain/verifier";
import { BaseError } from "viem";

export { contractErrorText, isContractRevert } from "@proofchain/verifier";

export function walletRejected(error: unknown): boolean {
  if (errorCode(error) === 4001) return true;
  const text = contractErrorText(error).toLowerCase();
  return text.includes("user rejected") || text.includes("user denied");
}

function errorCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "number") {
    return error.code;
  }
  if (error instanceof BaseError) {
    const found = error.walk(
      (item) => typeof item === "object" && item !== null && "code" in item && (item as { code?: unknown }).code === 4001,
    );
    if (typeof found === "object" && found !== null && "code" in found && typeof found.code === "number") {
      return found.code;
    }
  }
  return undefined;
}
