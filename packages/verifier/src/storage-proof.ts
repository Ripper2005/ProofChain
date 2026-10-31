import {
  concat,
  fromRlp,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  numberToHex,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { describeReaderError, type Reader } from "./rpc.ts";
import { isRecord } from "./format.ts";

export type StorageProofStatus = "verified" | "mismatch" | "invalid" | "unavailable";

export type StorageProofReport = {
  status: StorageProofStatus;
  reader: string | null;
  stateRoot: Hex;
  custodianSlot: Hex;
  custodian: Address | null;
  custodianMatches: boolean | null;
  statusSlot: Hex;
  statusWord: Hex | null;
  provenStatus: number | null;
  statusMatches: boolean | null;
  detail: string | null;
};

export type BatchStorageSlots = { custodian: Hex; status: Hex };

const BATCHES_MAPPING_SLOT = 1n;
const WORD_MASK = (1n << 256n) - 1n;
const ADDRESS_MASK = (1n << 160n) - 1n;
const MAX_PROOF_NODES = 128;
const MAX_PROOF_NODE_BYTES = 16 * 1024;
const MAX_PROOF_BYTES = 256 * 1024;

/** Storage slots from the ProductRegistry v2 layout. */
export function batchStorageSlots(batchId: Hex): BatchStorageSlots {
  const mappingKey = concat([batchId, numberToHex(BATCHES_MAPPING_SLOT, { size: 32 })]);
  const base = BigInt(keccak256(mappingKey));
  return {
    custodian: numberToHex((base + 2n) & WORD_MASK, { size: 32 }),
    status: numberToHex((base + 5n) & WORD_MASK, { size: 32 }),
  };
}

export async function checkBatchStorageProof(input: {
  reader: Reader | null;
  contract: Address;
  batchId: Hex;
  stateRoot: Hex;
  anchor: bigint;
  currentCustodian: Address;
  status: number;
}): Promise<StorageProofReport> {
  const slots = batchStorageSlots(input.batchId);
  const base: StorageProofReport = {
    status: "unavailable",
    reader: input.reader?.url ?? null,
    stateRoot: input.stateRoot,
    custodianSlot: slots.custodian,
    custodian: null,
    custodianMatches: null,
    statusSlot: slots.status,
    statusWord: null,
    provenStatus: null,
    statusMatches: null,
    detail: null,
  };
  if (!input.reader) {
    return { ...base, detail: "Reader agreement is not established, so there is no reader to request a proof from." };
  }

  let response: unknown;
  try {
    response = await input.reader.request("eth_getProof", [
      input.contract,
      [slots.custodian, slots.status],
      numberToHex(input.anchor),
    ]);
  } catch (error) {
    return { ...base, detail: `Reader did not return a storage proof (${describeReaderError(error)}).` };
  }

  try {
    const result = await verifyProofResponse({
      response,
      contract: input.contract,
      stateRoot: input.stateRoot,
      slots,
      currentCustodian: input.currentCustodian,
      expectedStatus: input.status,
    });
    const matches = result.custodianMatches && result.statusMatches;
    return {
      ...base,
      status: matches ? "verified" : "mismatch",
      custodian: result.custodian,
      custodianMatches: result.custodianMatches,
      statusWord: result.statusWord,
      provenStatus: result.provenStatus,
      statusMatches: result.statusMatches,
      detail: matches ? null : "The proven storage values do not match the contract read at the agreed block.",
    };
  } catch (error) {
    const detail = error instanceof ProofInvalidError ? error.message : "the proof could not be verified";
    return { ...base, status: "invalid", detail: `Invalid storage proof: ${detail}.` };
  }
}

async function verifyProofResponse(input: {
  response: unknown;
  contract: Address;
  stateRoot: Hex;
  slots: BatchStorageSlots;
  currentCustodian: Address;
  expectedStatus: number;
}): Promise<{
  custodian: Address;
  custodianMatches: boolean;
  statusWord: Hex;
  provenStatus: number;
  statusMatches: boolean;
}> {
  const response = requireRecord(input.response, "the RPC response is not an object");
  if (typeof response.address !== "string" || !isAddress(response.address, { strict: false })) {
    throw new ProofInvalidError("the proof names an invalid account address");
  }
  if (response.address.toLowerCase() !== input.contract.toLowerCase()) {
    throw new ProofInvalidError("the proof names a different account");
  }

  const accountProof = proofNodes(response.accountProof, "account proof");
  const accountTrie = await secureTrie();
  const accountValue = await accountTrie.verifyProof(toBytes(input.stateRoot), toBytes(input.contract), accountProof);
  if (!accountValue) throw new ProofInvalidError("the account is absent from the anchor state root");

  const account = decodeRlpList(accountValue, "account value");
  if (account.length !== 4) throw new ProofInvalidError("the account value does not have four fields");
  const [nonce, balance, storageRoot, codeHash] = account;
  if (!nonce || !balance || !storageRoot || !codeHash || storageRoot.length !== 32 || codeHash.length !== 32) {
    throw new ProofInvalidError("the account value has invalid fields");
  }
  if (!equalBytes(nonce, quantityBytes(response.nonce, "account nonce"))) {
    throw new ProofInvalidError("the reported account nonce does not match the account proof");
  }
  if (!equalBytes(balance, quantityBytes(response.balance, "account balance"))) {
    throw new ProofInvalidError("the reported account balance does not match the account proof");
  }
  if (!equalHex(response.storageHash, storageRoot) || !equalHex(response.codeHash, codeHash)) {
    throw new ProofInvalidError("the reported account roots do not match the account proof");
  }

  const storageProofs = requireArray(response.storageProof, "storage proofs");
  if (storageProofs.length !== 2) throw new ProofInvalidError("the response must contain exactly two storage proofs");
  const byKey = new Map<string, Record<string, unknown>>();
  for (const item of storageProofs) {
    const entry = requireRecord(item, "a storage proof entry is not an object");
    const key = requireWord(entry.key, "storage proof key").toLowerCase();
    if (byKey.has(key)) throw new ProofInvalidError("the response contains a duplicate storage proof key");
    byKey.set(key, entry);
  }
  const custodianEntry = byKey.get(input.slots.custodian.toLowerCase());
  const statusEntry = byKey.get(input.slots.status.toLowerCase());
  if (!custodianEntry || !statusEntry) throw new ProofInvalidError("the response does not prove both requested storage slots");

  const storageTrie = await secureTrie();
  const custodianValue = await verifiedStorageValue(storageTrie, storageRoot, input.slots.custodian, custodianEntry);
  const statusValue = await verifiedStorageValue(storageTrie, storageRoot, input.slots.status, statusEntry);
  if (custodianValue > WORD_MASK || statusValue > WORD_MASK) {
    throw new ProofInvalidError("a proven storage value exceeds one EVM word");
  }

  const custodian = getAddress(`0x${(custodianValue & ADDRESS_MASK).toString(16).padStart(40, "0")}`);
  const custodianMatches = custodianValue === BigInt(input.currentCustodian);
  const statusWord = numberToHex(statusValue, { size: 32 });
  const provenStatus = Number(statusValue & 0xffn);
  return {
    custodian,
    custodianMatches,
    statusWord,
    provenStatus,
    statusMatches: provenStatus === input.expectedStatus,
  };
}

async function verifiedStorageValue(
  trie: Awaited<ReturnType<typeof secureTrie>>,
  storageRoot: Uint8Array,
  slot: Hex,
  entry: Record<string, unknown>,
): Promise<bigint> {
  if (typeof entry.key !== "string" || entry.key.toLowerCase() !== slot.toLowerCase()) {
    throw new ProofInvalidError("a storage proof key does not match the requested slot");
  }
  const claimed = parseQuantity(entry.value, "storage proof value");
  const encodedValue = await trie.verifyProof(storageRoot, toBytes(slot), proofNodes(entry.proof, "storage proof"));
  if (!encodedValue) throw new ProofInvalidError("a requested storage slot is absent from the account storage root");
  const decodedValue = decodeRlpBytes(encodedValue, "storage value");
  const proven = bytesToBigInt(decodedValue);
  if (proven !== claimed) throw new ProofInvalidError("the reported storage value does not match its proof");
  return proven;
}

async function secureTrie() {
  const { Trie } = await import("@ethereumjs/trie");
  return new Trie({ useKeyHashing: true });
}

function proofNodes(value: unknown, label: string): Uint8Array[] {
  const values = requireArray(value, label);
  if (values.length === 0) throw new ProofInvalidError(`${label} is empty`);
  if (values.length > MAX_PROOF_NODES) throw new ProofInvalidError(`${label} has too many nodes`);
  let totalBytes = 0;
  return values.map((node) => {
    if (typeof node !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(node)) {
      throw new ProofInvalidError(`${label} contains a malformed node`);
    }
    const nodeBytes = (node.length - 2) / 2;
    totalBytes += nodeBytes;
    if (nodeBytes > MAX_PROOF_NODE_BYTES || totalBytes > MAX_PROOF_BYTES) {
      throw new ProofInvalidError(`${label} is larger than the verifier limit`);
    }
    return toBytes(node as Hex);
  });
}

function decodeRlpList(value: Uint8Array, label: string): Uint8Array[] {
  const decoded = decodeRlp(value);
  if (!Array.isArray(decoded) || decoded.some((field) => !(field instanceof Uint8Array))) {
    throw new ProofInvalidError(`${label} is not an RLP list of byte strings`);
  }
  return decoded as Uint8Array[];
}

function decodeRlpBytes(value: Uint8Array, label: string): Uint8Array {
  const decoded = decodeRlp(value);
  if (!(decoded instanceof Uint8Array)) throw new ProofInvalidError(`${label} is not an RLP byte string`);
  return decoded;
}

function decodeRlp(value: Uint8Array): unknown {
  // Kept as a small wrapper so malformed provider values are reported as invalid proofs.
  try {
    return fromRlp(value, "bytes");
  } catch {
    throw new ProofInvalidError("an RLP value is malformed");
  }
}

function quantityBytes(value: unknown, label: string): Uint8Array {
  return minimalBytes(parseQuantity(value, label));
}

function parseQuantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new ProofInvalidError(`${label} is not a JSON-RPC quantity`);
  }
  return BigInt(value);
}

function minimalBytes(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array();
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  return toBytes(`0x${hex}`);
}

function bytesToBigInt(value: Uint8Array): bigint {
  if (value.length === 0) return 0n;
  let hex = "";
  for (const byte of value) hex += byte.toString(16).padStart(2, "0");
  return BigInt(`0x${hex}`);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function equalHex(value: unknown, bytes: Uint8Array): boolean {
  if (typeof value !== "string" || !isHex(value)) return false;
  const expected = `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return value.toLowerCase() === expected;
}

function requireWord(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new ProofInvalidError(`${label} is not a 32-byte word`);
  }
  return value as Hex;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ProofInvalidError(message);
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new ProofInvalidError(`${label} is not an array`);
  return value;
}

class ProofInvalidError extends Error {}
