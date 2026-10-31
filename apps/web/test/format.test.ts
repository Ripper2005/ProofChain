import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionResult, parseAbiItem, type AbiParameter, type Hex } from "viem";
import { productRegistryAbi } from "../src/contracts/ProductRegistry.ts";
import { castGetBatch } from "../src/lib/format.ts";

const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const MANUFACTURER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BATCH_ID = "0x9d6be2557c721891700c118158cc27ec51fd21cd40d2b73a7670b7e1466936d2";
const HASH = "0xd318be071fd3161c69b2f2eb4ff0a4d1ba56e1657a6ca854291454927994a752";
const CID = "bafkreicjx37puhth4lglmhqqna5gjrcvjedfpputssey6isdy5slgiz7im";
// eth_call getBatch(PCB-2026-001) against the version 2 contract on a local Anvil, block 2.
const GET_BATCH_RETURN: Hex =
  "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266d318be071fd3161c69b2f2eb4ff0a4d1ba56e1657a6ca854291454927994a75200000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000006ae4ea8c000000000000000000000000000000000000000000000000000000000000000c5043422d323032362d3030310000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003b6261666b726569636a7833377075687468346c676c6d6871716e6135676a7263766a6564667070757473736579366973647935736c67697a37696d0000000000";

function solidityType(parameter: AbiParameter): string {
  if (!parameter.type.startsWith("tuple")) return parameter.type;
  const components = "components" in parameter ? parameter.components : [];
  return `(${components.map(solidityType).join(",")})${parameter.type.slice("tuple".length)}`;
}

function abiSignature(): string {
  const getBatch = productRegistryAbi.find((item) => item.type === "function" && item.name === "getBatch");
  assert.ok(getBatch && getBatch.type === "function");
  const inputs = getBatch.inputs.map(solidityType).join(",");
  const outputs = getBatch.outputs.map(solidityType).join(",");
  return `getBatch(${inputs})(${outputs})`;
}

function quotedSignature(command: string): string {
  const quoted = [...command.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
  assert.equal(quoted.length, 1);
  return quoted[0] ?? "";
}

test("the cast command quotes exactly the getBatch signature derived from the ABI", () => {
  const signature = abiSignature();
  assert.equal(signature, "getBatch(bytes32)((string,address,address,bytes32,string,uint8,uint64))");

  const command = castGetBatch(CONTRACT, BATCH_ID);
  assert.equal(quotedSignature(command), signature);
  assert.equal(command, `cast call ${CONTRACT} "${signature}" ${BATCH_ID} --rpc-url <YOUR_NODE_URL>`);
});

test("the quoted signature decodes a real getBatch return and the flat form does not", () => {
  const signature = quotedSignature(castGetBatch(CONTRACT, BATCH_ID));
  const parts = /^(\w+)\(([^)]*)\)\((.*)\)$/.exec(signature);
  assert.ok(parts);
  const quoted = parseAbiItem(`function ${parts[1]}(${parts[2]}) view returns (${parts[3]})`);
  const decoded = decodeFunctionResult({ abi: [quoted], functionName: "getBatch", data: GET_BATCH_RETURN });
  assert.deepEqual(decoded, ["PCB-2026-001", MANUFACTURER, MANUFACTURER, HASH, CID, 1, 1793387148n]);

  const fromAbi = decodeFunctionResult({ abi: productRegistryAbi, functionName: "getBatch", data: GET_BATCH_RETURN });
  assert.deepEqual(Object.values(fromAbi), decoded);

  const flat = parseAbiItem(
    "function getBatch(bytes32) view returns (string,address,address,bytes32,string,uint8,uint64)",
  );
  assert.throws(() => decodeFunctionResult({ abi: [flat], functionName: "getBatch", data: GET_BATCH_RETURN }));
});
