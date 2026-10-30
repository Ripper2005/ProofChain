import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MetadataError,
  canonicalize,
  computeBatchId,
  hashMetadata,
  parseAndValidate,
  validateBatchCode,
} from "../dist/index.js";

const GOLDEN =
  '{"batchCode":"PCB-2026-001","description":"","imageCid":"","manufacturerName":"Demo Electronics Pvt. Ltd.","name":"STM32 Controller Development Board","productionDate":"2026-10-15","quantity":50,"schemaVersion":1,"sku":"CTRL-STM32-A"}';

describe("golden vector", () => {
  it("reproduces the batch id and metadata hash", () => {
    assert.equal(computeBatchId("PCB-2026-001"), "0x9d6be2557c721891700c118158cc27ec51fd21cd40d2b73a7670b7e1466936d2");
    assert.equal(hashMetadata(GOLDEN), "0xd318be071fd3161c69b2f2eb4ff0a4d1ba56e1657a6ca854291454927994a752");
    assert.equal(canonicalize(JSON.parse(GOLDEN)), GOLDEN);
    assert.equal(parseAndValidate(GOLDEN).batchCode, "PCB-2026-001");
  });
});

describe("batch codes", () => {
  it("keeps case distinct and rejects characters outside the contract rule", () => {
    assert.equal(validateBatchCode("PCB-2026-001"), true);
    assert.equal(validateBatchCode("pcb-2026-001"), true);
    assert.notEqual(computeBatchId("PCB-2026-001"), computeBatchId("pcb-2026-001"));
    assert.equal(validateBatchCode(""), false);
    assert.equal(validateBatchCode("PCB 2026"), false);
    assert.equal(validateBatchCode("PCB_2026"), false);
    assert.equal(validateBatchCode("A".repeat(65)), false);
    assert.throws(() => computeBatchId("bad code"), MetadataError);
  });
});

describe("parseAndValidate", () => {
  it("rejects unknown keys, string quantities, bad dates, and untrimmed names", () => {
    const parsed = JSON.parse(GOLDEN) as Record<string, unknown>;
    assert.throws(() => parseAndValidate(JSON.stringify({ ...parsed, extra: true })), (error: unknown) => {
      return error instanceof MetadataError && error.code === "UnknownKey";
    });
    assert.throws(() => parseAndValidate(withField(parsed, "quantity", "50")), MetadataError);
    assert.throws(() => parseAndValidate(withField(parsed, "productionDate", "2026-02-29")), MetadataError);
    assert.throws(() => parseAndValidate(withField(parsed, "productionDate", "2026-13-01")), MetadataError);
    assert.throws(() => parseAndValidate(withField(parsed, "name", " Board")), MetadataError);
    assert.throws(() => parseAndValidate(withField(parsed, "name", "")), MetadataError);
    assert.throws(() => parseAndValidate(withField(parsed, "schemaVersion", 2)), MetadataError);
    assert.throws(() => parseAndValidate(withField(parsed, "imageCid", "not a cid")), MetadataError);
  });

  it("rejects a canonical-looking document whose bytes differ", () => {
    assert.throws(() => parseAndValidate(GOLDEN.replace("{", "{ ")), (error: unknown) => {
      return error instanceof MetadataError && error.code === "NonCanonical";
    });
  });

  it("rejects NaN before it can become null", () => {
    assert.throws(() => canonicalize({ quantity: Number.NaN }), MetadataError);
  });
});

function withField(source: Record<string, unknown>, key: string, value: unknown): string {
  return canonicalize({ ...source, [key]: value });
}
