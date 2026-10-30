import { computeBatchId, hashMetadata } from "@proofchain/metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { judgeDocument } from "../src/lib/document.ts";

const CANONICAL =
  '{"batchCode":"PCB-2026-001","description":"","imageCid":"","manufacturerName":"Demo Electronics Pvt. Ltd.","name":"STM32 Controller Development Board","productionDate":"2026-10-15","quantity":50,"schemaVersion":1,"sku":"CTRL-STM32-A"}';

test("the demo document matches the golden commitment", () => {
  const hash = hashMetadata(CANONICAL);
  const batchId = computeBatchId("PCB-2026-001");
  assert.equal(hash, "0xd318be071fd3161c69b2f2eb4ff0a4d1ba56e1657a6ca854291454927994a752");
  assert.equal(batchId, "0x9d6be2557c721891700c118158cc27ec51fd21cd40d2b73a7670b7e1466936d2");
  const bytes = new TextEncoder().encode(CANONICAL);
  const judgement = judgeDocument(bytes, hash, "PCB-2026-001", batchId);
  assert.equal(judgement.verdict, "match");
  assert.equal(judgeDocument(bytes, hash, "pcb-2026-001", batchId).verdict, "mismatch");
  const swapped = new Uint8Array(bytes);
  swapped[swapped.length - 2] = swapped[swapped.length - 2]! ^ 1;
  assert.equal(judgeDocument(swapped, hash, "PCB-2026-001", batchId).verdict, "mismatch");
});
