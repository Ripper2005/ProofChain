import { computeBatchId, hashMetadata } from "@proofchain/metadata";
import { CID } from "multiformats/cid";
import { create as createDigest } from "multiformats/hashes/digest";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  keccak256,
  bytesToHex,
  numberToHex,
  padHex,
  sha256,
  toRlp,
  toBytes,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";
import { batchStorageSlots } from "../src/storage-proof.ts";
import {
  parseDeployments,
  productRegistryAbi,
  ReaderUnreachable,
  RpcError,
  type FetchLike,
  type FetchResponse,
  type Reader,
} from "../src/index.ts";

export const CONTRACT: Address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
export const A: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const B: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const C: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
export const D: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
export const ZERO: Address = "0x0000000000000000000000000000000000000000";

export const GOLDEN =
  '{"batchCode":"PCB-2026-001","description":"","imageCid":"","manufacturerName":"Demo Electronics Pvt. Ltd.","name":"STM32 Controller Development Board","productionDate":"2026-10-15","quantity":50,"schemaVersion":1,"sku":"CTRL-STM32-A"}';
export const GOLDEN_BYTES = new TextEncoder().encode(GOLDEN);
export const GOLDEN_HASH: Hex = "0xd318be071fd3161c69b2f2eb4ff0a4d1ba56e1657a6ca854291454927994a752";
export const GOLDEN_CID = "bafkreicjx37puhth4lglmhqqna5gjrcvjedfpputssey6isdy5slgiz7im";
export const GOLDEN_ID: Hex = "0x9d6be2557c721891700c118158cc27ec51fd21cd40d2b73a7670b7e1466936d2";
export const CODE = "PCB-2026-001";

export const GATEWAY = "http://gateway.test";
export const SECOND_GATEWAY = "http://second-gateway.test";

export const DEPLOYMENTS = parseDeployments({
  deployments: [
    { chainId: 31337, address: CONTRACT, startBlock: 1, label: "local anvil", current: true, rpcUrls: [] },
  ],
});

export type BatchState = {
  batchCode: string;
  manufacturer: Address;
  currentCustodian: Address;
  metadataHash: Hex;
  metadataCid: string;
  status: number;
  createdAt: bigint;
  pending: { from: Address; to: Address; proposedAt: bigint } | null;
  history: Array<{ from: Address; to: Address; timestamp: bigint }>;
  manufacturerRole: boolean;
};

export type RawLog = {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  logIndex: Hex;
  transactionHash: Hex;
  removed: boolean;
};

export type FakeChain = {
  chainId: number;
  head: bigint;
  batches: Map<Hex, BatchState>;
  logs: RawLog[];
};

export function rawCid(bytes: Uint8Array): string {
  return CID.create(1, 0x55, createDigest(0x12, sha256(bytes, "bytes"))).toString();
}

export function txHash(label: string): Hex {
  return keccak256(toBytes(`tx ${label}`));
}

export function blockHash(number: bigint, fork = "main", stateRoot = "0x" as Hex): Hex {
  return keccak256(toBytes(`${fork} block ${number} state root ${stateRoot}`));
}

export function eventLog(
  eventName:
    | "BatchRegistered"
    | "CustodyTransferProposed"
    | "CustodyTransferCancelled"
    | "CustodyTransferred"
    | "BatchRecalled",
  args: Record<string, unknown>,
  blockNumber: bigint,
  label: string,
  logIndex = 0,
): RawLog {
  const item = productRegistryAbi.find((entry) => entry.type === "event" && entry.name === eventName) as AbiEvent;
  const indexed = Object.fromEntries(item.inputs.filter((input) => input.indexed).map((input) => [input.name, args[input.name ?? ""]]));
  const plain = item.inputs.filter((input) => !input.indexed);
  return {
    address: CONTRACT,
    topics: encodeEventTopics({ abi: productRegistryAbi, eventName, args: indexed } as never) as Hex[],
    data: encodeAbiParameters(plain, plain.map((input) => args[input.name ?? ""]) as never),
    blockNumber: numberToHex(blockNumber),
    logIndex: numberToHex(logIndex),
    transactionHash: txHash(label),
    removed: false,
  };
}

export function goldenChain(head = 2n): FakeChain {
  return {
    chainId: 31337,
    head,
    batches: new Map([
      [
        GOLDEN_ID,
        {
          batchCode: CODE,
          manufacturer: A,
          currentCustodian: A,
          metadataHash: GOLDEN_HASH,
          metadataCid: GOLDEN_CID,
          status: 1,
          createdAt: 1_793_387_148n,
          pending: null,
          history: [],
          manufacturerRole: true,
        },
      ],
    ]),
    logs: [
      eventLog(
        "BatchRegistered",
        {
          batchId: GOLDEN_ID,
          manufacturer: A,
          batchCode: CODE,
          metadataHash: GOLDEN_HASH,
          metadataCid: GOLDEN_CID,
          createdAt: 1_793_387_148n,
          document: GOLDEN,
        },
        2n,
        "register",
      ),
    ],
  };
}

export function recalledChain(): { chain: FakeChain; batchId: Hex; code: string; document: string; cid: string } {
  const code = "PCB-2026-R01";
  const document = GOLDEN.replace("PCB-2026-001", code);
  const batchId = computeBatchId(code);
  const metadataHash = hashMetadata(document);
  const cid = rawCid(new TextEncoder().encode(document));
  const chain: FakeChain = {
    chainId: 31337,
    head: 9n,
    batches: new Map([
      [
        batchId,
        {
          batchCode: code,
          manufacturer: A,
          currentCustodian: C,
          metadataHash,
          metadataCid: cid,
          status: 2,
          createdAt: 100n,
          pending: null,
          history: [
            { from: A, to: B, timestamp: 102n },
            { from: B, to: C, timestamp: 104n },
          ],
          manufacturerRole: true,
        },
      ],
    ]),
    logs: [
      eventLog(
        "BatchRegistered",
        { batchId, manufacturer: A, batchCode: code, metadataHash, metadataCid: cid, createdAt: 100n, document },
        3n,
        "r01 register",
      ),
      eventLog("CustodyTransferProposed", { batchId, from: A, to: B, proposedAt: 101n }, 4n, "r01 propose b"),
      eventLog("CustodyTransferred", { batchId, from: A, to: B, timestamp: 102n }, 5n, "r01 accept b"),
      eventLog("CustodyTransferProposed", { batchId, from: B, to: C, proposedAt: 103n }, 6n, "r01 propose c"),
      eventLog("CustodyTransferred", { batchId, from: B, to: C, timestamp: 104n }, 7n, "r01 accept c"),
      eventLog(
        "BatchRecalled",
        { batchId, recalledBy: A, pendingCleared: false, recalledAt: 106n, reason: "Damaged seal" },
        9n,
        "r01 recall",
      ),
    ],
  };
  return { chain, batchId, code, document, cid };
}

export type ReaderOptions = {
  chainId?: number;
  head?: bigint;
  fork?: string;
  fail?: (method: string, params: readonly unknown[]) => Error | null;
  edit?: (batch: BatchState) => BatchState;
  calls?: Array<{ method: string; params: readonly unknown[] }>;
  proofEdit?: (proof: Record<string, unknown>) => unknown;
  headerStateRoot?: Hex;
};

export function fakeReader(url: string, chain: FakeChain, options: ReaderOptions = {}): Reader {
  let proofState: Promise<FakeProofState> | null = null;
  const getProofState = () => (proofState ??= makeProofState(chain));
  return {
    url,
    async request(method, params) {
      options.calls?.push({ method, params });
      const failure = options.fail?.(method, params);
      if (failure) throw failure;
      switch (method) {
        case "eth_chainId":
          return numberToHex(options.chainId ?? chain.chainId);
        case "eth_blockNumber":
          return numberToHex(options.head ?? chain.head);
        case "eth_getBlockByNumber": {
          const proofState = await getProofState();
          return {
            number: params[0],
            hash: blockHash(BigInt(params[0] as string), options.fork, proofState.stateRoot),
            stateRoot: options.headerStateRoot ?? proofState.stateRoot,
          };
        }
        case "eth_getProof": {
          const proof = await (await getProofState()).getProof(params[1]);
          return options.proofEdit ? options.proofEdit(proof) : proof;
        }
        case "eth_call":
          return call(chain, (params[0] as { data: Hex }).data, options.edit);
        case "eth_getLogs":
          return getLogs(chain, params[0] as LogFilter);
        default:
          throw new RpcError(-32601, `method ${method} not found`, undefined);
      }
    },
  };
}

type FakeProofState = {
  stateRoot: Hex;
  getProof(slots: unknown): Promise<Record<string, unknown>>;
};

async function makeProofState(chain: FakeChain): Promise<FakeProofState> {
  const { Trie } = await import("@ethereumjs/trie");
  const storageTrie = new Trie({ useKeyHashing: true });
  const values = new Map<string, Hex>();
  for (const [batchId, batch] of chain.batches) {
    const slots = batchStorageSlots(batchId);
    const custodianWord = padHex(batch.currentCustodian, { size: 32 }) as Hex;
    const statusWord = numberToHex(BigInt(batch.status), { size: 32 });
    values.set(slots.custodian.toLowerCase(), custodianWord);
    values.set(slots.status.toLowerCase(), statusWord);
    await storageTrie.put(toBytes(slots.custodian), toRlp(minimalBytes(BigInt(custodianWord)), "bytes"));
    await storageTrie.put(toBytes(slots.status), toRlp(minimalBytes(BigInt(statusWord)), "bytes"));
  }

  const codeHash = keccak256(toBytes("fake ProductRegistry runtime"));
  const account = toRlp([new Uint8Array(), new Uint8Array(), storageTrie.root(), toBytes(codeHash)], "bytes");
  const stateTrie = new Trie({ useKeyHashing: true });
  await stateTrie.put(toBytes(CONTRACT), account);
  const stateRoot = bytesToHex(stateTrie.root()) as Hex;
  const accountProof = (await stateTrie.createProof(toBytes(CONTRACT))).map((node) => bytesToHex(node));
  const entryProofs = new Map<string, Hex[]>();
  for (const key of values.keys()) {
    const proof = (await storageTrie.createProof(toBytes(key as Hex))).map((node) => bytesToHex(node));
    entryProofs.set(key, proof as Hex[]);
  }

  return {
    stateRoot,
    async getProof(requested) {
      if (!Array.isArray(requested)) throw new Error("fake eth_getProof expected storage keys");
      const storageProof = requested.map((key) => {
        const normalized = typeof key === "string" ? key.toLowerCase() : "";
        const word = values.get(normalized);
        const proof = entryProofs.get(normalized);
        if (!word || !proof || typeof key !== "string") throw new Error("fake eth_getProof received an unknown storage key");
        return { key, value: numberToHex(BigInt(word)), proof };
      });
      return {
        address: CONTRACT.toLowerCase(),
        accountProof,
        balance: "0x0",
        codeHash,
        nonce: "0x0",
        storageHash: bytesToHex(storageTrie.root()),
        storageProof,
      };
    },
  };
}

function minimalBytes(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array();
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  return toBytes(`0x${hex}`);
}

export function unreachableReader(url: string, calls?: string[]): Reader {
  return {
    url,
    async request(method) {
      calls?.push(method);
      throw new ReaderUnreachable("the request failed (fetch failed)");
    },
  };
}

export function bytesResponse(bytes: Uint8Array, status = 200): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return JSON.parse(new TextDecoder().decode(bytes));
    },
    async arrayBuffer() {
      return bytes.slice().buffer;
    },
  };
}

export function fakeFetch(
  routes: Record<string, Uint8Array | number | Error>,
  seen: string[] = [],
): FetchLike {
  return async (url) => {
    seen.push(url);
    const route = routes[url];
    if (route === undefined) return bytesResponse(new TextEncoder().encode("not found"), 404);
    if (route instanceof Error) throw route;
    if (typeof route === "number") return bytesResponse(new Uint8Array(), route);
    return bytesResponse(route);
  };
}

export function gatewayUrl(gateway: string, cid: string): string {
  return `${gateway}/ipfs/${cid}`;
}

type LogFilter = { address: Address; topics: [Hex[], Hex]; fromBlock: Hex; toBlock: Hex };

function call(chain: FakeChain, data: Hex, edit?: (batch: BatchState) => BatchState): Hex {
  const decoded = decodeFunctionData({ abi: productRegistryAbi, data });
  if (decoded.functionName === "hasRole") {
    const [, account] = decoded.args as [Hex, Address];
    const held = [...chain.batches.values()].some(
      (batch) => batch.manufacturer.toLowerCase() === account.toLowerCase() && batch.manufacturerRole,
    );
    return encodeFunctionResult({ abi: productRegistryAbi, functionName: "hasRole", result: held });
  }
  const [batchId] = decoded.args as [Hex];
  const stored = chain.batches.get(batchId);
  if (!stored) {
    throw new RpcError(
      3,
      "execution reverted",
      encodeErrorResult({ abi: productRegistryAbi, errorName: "BatchNotFound", args: [batchId] }),
    );
  }
  const batch = edit ? edit(stored) : stored;
  switch (decoded.functionName) {
    case "getBatch":
      return encodeFunctionResult({
        abi: productRegistryAbi,
        functionName: "getBatch",
        result: {
          batchCode: batch.batchCode,
          manufacturer: batch.manufacturer,
          currentCustodian: batch.currentCustodian,
          metadataHash: batch.metadataHash,
          metadataCid: batch.metadataCid,
          status: batch.status,
          createdAt: batch.createdAt,
        },
      });
    case "getPendingTransfer":
      return encodeFunctionResult({
        abi: productRegistryAbi,
        functionName: "getPendingTransfer",
        result: batch.pending
          ? { ...batch.pending, active: true }
          : { from: ZERO, to: ZERO, proposedAt: 0n, active: false },
      });
    case "getCustodyHistory":
      return encodeFunctionResult({ abi: productRegistryAbi, functionName: "getCustodyHistory", result: batch.history });
    default:
      throw new Error(`unexpected call ${decoded.functionName}`);
  }
}

function getLogs(chain: FakeChain, filter: LogFilter): RawLog[] {
  const from = BigInt(filter.fromBlock);
  const to = BigInt(filter.toBlock);
  const [topic0s, topic1] = filter.topics;
  return chain.logs.filter((log) => {
    const block = BigInt(log.blockNumber);
    return (
      block >= from &&
      block <= to &&
      log.address.toLowerCase() === filter.address.toLowerCase() &&
      topic0s.includes(log.topics[0]!) &&
      log.topics[1]?.toLowerCase() === topic1.toLowerCase()
    );
  });
}
