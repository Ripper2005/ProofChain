import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Hex } from "viem";
import { productRegistryAbi } from "./abi.ts";

export function contractErrorText(error: unknown): string {
  for (const item of causeChain(error)) {
    const reverted = revertedData(item);
    if (reverted) return formatRevert(reverted.errorName, reverted.args);
    const raw = hexField(item, "raw");
    const decoded = decodeRaw(raw);
    if (decoded) return formatRevert(decoded.errorName, decoded.args);
    const embedded = decodeEmbedded(`${errorText(item)} ${messageOf(item)}`);
    if (embedded) return formatRevert(embedded.errorName, embedded.args);
  }
  const text = errorText(error);
  const embedded = decodeEmbedded(text);
  if (embedded) return formatRevert(embedded.errorName, embedded.args);
  return text || "The contract call failed";
}

export function revertText(data: Hex): string {
  const decoded = decodeRaw(data);
  if (decoded) return formatRevert(decoded.errorName, decoded.args);
  if (data === "0x") return "execution reverted without data";
  return `execution reverted with data ${data}`;
}

export function isContractRevert(error: unknown): boolean {
  for (const item of causeChain(error)) {
    if (item instanceof ContractFunctionRevertedError) return true;
    if (typeof item === "object" && item !== null && (item as { name?: unknown }).name === "ContractFunctionRevertedError") {
      return true;
    }
  }
  return /execution reverted/i.test(`${errorText(error)} ${messageOf(error)}`);
}

function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    if (typeof (current as { walk?: unknown }).walk === "function") {
      try {
        (current as BaseError).walk((item) => {
          if (item && typeof item === "object" && !seen.has(item)) {
            seen.add(item);
            chain.push(item);
          }
          return false;
        });
      } catch {
        // A duplicate viem copy can make walk throw. The cause links still work.
      }
    }
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function revertedData(error: unknown): { errorName: string; args?: readonly unknown[] } | null {
  if (!error || typeof error !== "object") return null;
  const record = error as { name?: unknown; data?: { errorName?: unknown; args?: readonly unknown[] } };
  if (record.name !== "ContractFunctionRevertedError" && !(error instanceof ContractFunctionRevertedError)) return null;
  if (typeof record.data?.errorName === "string") {
    return { errorName: record.data.errorName, args: record.data.args };
  }
  return null;
}

function hexField(error: unknown, key: string): Hex | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" && value.startsWith("0x") ? (value as Hex) : undefined;
}

function decodeEmbedded(text: string): { errorName: string; args?: readonly unknown[] } | null {
  const match = /custom error (0x[0-9a-fA-F]{8}):\s*([0-9a-fA-F]+)/.exec(text);
  if (!match) return null;
  return decodeRaw(`${match[1]}${match[2]}` as Hex);
}

function formatRevert(name: string, args: readonly unknown[] | undefined): string {
  if (args && args.length > 0) return `${name}(${args.map(formatArg).join(", ")})`;
  return name;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function errorText(error: unknown): string {
  if (error && typeof error === "object" && "shortMessage" in error && typeof error.shortMessage === "string") {
    return error.shortMessage;
  }
  if (error instanceof Error) return error.message;
  return "";
}

function decodeRaw(raw: Hex | undefined): { errorName: string; args?: readonly unknown[] } | null {
  if (!raw || raw === "0x") return null;
  try {
    const decoded = decodeErrorResult({ abi: productRegistryAbi, data: raw });
    return { errorName: decoded.errorName, args: decoded.args };
  } catch {
    return null;
  }
}

function formatArg(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
}
