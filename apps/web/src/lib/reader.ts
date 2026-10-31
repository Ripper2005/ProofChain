import { computeBatchId, validateBatchCode } from "@proofchain/metadata";
import { DEFAULT_ADMIN_ROLE, MANUFACTURER_ROLE, RECALL_ROLE } from "@proofchain/verifier";
import { createPublicClient, fallback, http, type Address } from "viem";
import { productRegistryAbi } from "../contracts/ProductRegistry.ts";
import { readerUrls } from "./deployments.ts";

export type LoadedBatch = {
  batchCode: string;
  manufacturer: Address;
  currentCustodian: Address;
  status: "active" | "recalled" | "none";
  pending: { from: Address; to: Address; proposedAt: bigint } | null;
};

function readClient(chainId: number) {
  const urls = readerUrls(chainId);
  if (urls.length === 0) throw new Error(`This site cannot read chain ${chainId}.`);
  return createPublicClient({
    transport: fallback(urls.map((url) => http(url, { batch: false, timeout: 20_000 }))),
  });
}

export async function checkedClient(chainId: number) {
  const client = readClient(chainId);
  const reported = await client.getChainId();
  if (reported !== chainId) throw new Error(`This site cannot read chain ${chainId}.`);
  return client;
}

export async function loadBatch(chainId: number, contract: Address, batchCode: string): Promise<LoadedBatch> {
  if (!validateBatchCode(batchCode)) throw new Error("InvalidBatchCode");
  const client = await checkedClient(chainId);
  const batchId = computeBatchId(batchCode);
  const batch = await client.readContract({
    address: contract,
    abi: productRegistryAbi,
    functionName: "getBatch",
    args: [batchId],
  });
  const pending = await client.readContract({
    address: contract,
    abi: productRegistryAbi,
    functionName: "getPendingTransfer",
    args: [batchId],
  });
  return {
    batchCode: batch.batchCode,
    manufacturer: batch.manufacturer,
    currentCustodian: batch.currentCustodian,
    status: batch.status === 1 ? "active" : batch.status === 2 ? "recalled" : "none",
    pending: pending.active ? { from: pending.from, to: pending.to, proposedAt: pending.proposedAt } : null,
  };
}

export async function readChainHead(chainId: number): Promise<bigint> {
  const client = await checkedClient(chainId);
  return client.getBlockNumber();
}

export async function readRoles(chainId: number, contract: Address, account: Address): Promise<{
  admin: boolean;
  manufacturer: boolean;
  recall: boolean;
}> {
  const client = readClient(chainId);
  const [admin, manufacturer, recall] = await Promise.all(
    [DEFAULT_ADMIN_ROLE, MANUFACTURER_ROLE, RECALL_ROLE].map((role) =>
      client.readContract({
        address: contract,
        abi: productRegistryAbi,
        functionName: "hasRole",
        args: [role, account],
      }),
    ),
  );
  return { admin: admin === true, manufacturer: manufacturer === true, recall: recall === true };
}
