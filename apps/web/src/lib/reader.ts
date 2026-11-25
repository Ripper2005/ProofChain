import { computeBatchId, validateBatchCode } from "@proofchain/metadata";
import { DEFAULT_ADMIN_ROLE, MANUFACTURER_ROLE, RECALL_ROLE } from "@proofchain/verifier";
import { createPublicClient, fallback, http, type Address } from "viem";
import { productRegistryAbi } from "../contracts/ProductRegistry.ts";
import { readerUrls } from "./deployments.ts";
import { contractErrorText, isContractRevert } from "./errors.ts";

export type LoadedBatch = {
  batchCode: string;
  manufacturer: Address;
  currentCustodian: Address;
  status: "active" | "recalled" | "none";
  pending: { from: Address; to: Address; proposedAt: bigint } | null;
};

export type BatchLookupResult =
  | { kind: "found"; batch: LoadedBatch }
  | { kind: "not-registered"; batchCode: string; errorText: string };

type BatchReadClient = Pick<ReturnType<typeof createPublicClient>, "readContract">;

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

export async function loadBatch(
  chainId: number,
  contract: Address,
  batchCode: string,
  connect: (chainId: number) => Promise<BatchReadClient> = checkedClient,
): Promise<BatchLookupResult> {
  if (!validateBatchCode(batchCode)) throw new Error("InvalidBatchCode");
  const client = await connect(chainId);
  const batchId = computeBatchId(batchCode);
  let batch;
  try {
    batch = await client.readContract({
      address: contract,
      abi: productRegistryAbi,
      functionName: "getBatch",
      args: [batchId],
    });
  } catch (error) {
    if (isContractRevert(error)) {
      const errorText = contractErrorText(error);
      if (errorText.startsWith("BatchNotFound")) {
        return { kind: "not-registered", batchCode, errorText };
      }
      throw new Error(errorText);
    }
    throw error;
  }
  const pending = await client.readContract({
    address: contract,
    abi: productRegistryAbi,
    functionName: "getPendingTransfer",
    args: [batchId],
  });
  return {
    kind: "found",
    batch: {
      batchCode: batch.batchCode,
      manufacturer: batch.manufacturer,
      currentCustodian: batch.currentCustodian,
      status: batch.status === 1 ? "active" : batch.status === 2 ? "recalled" : "none",
      pending: pending.active ? { from: pending.from, to: pending.to, proposedAt: pending.proposedAt } : null,
    },
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
