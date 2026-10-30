import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(scriptDir, "..", "..", "..");
const artifactPath = resolve(workspace, "contracts/out/ProductRegistry.sol/ProductRegistry.json");
const destination = resolve(scriptDir, "../src/contracts/ProductRegistry.ts");
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

if (!Array.isArray(artifact.abi)) {
  throw new Error(`No ABI array in ${artifactPath}. Run forge build first.`);
}

const functionNames = new Set(
  artifact.abi.filter((item) => item.type === "function").map((item) => item.name),
);
for (const name of [
  "registerBatch",
  "getBatch",
  "proposeCustodyTransfer",
  "acceptCustodyTransfer",
  "cancelCustodyTransfer",
  "recallBatch",
  "getPendingTransfer",
  "getCustodyHistory",
  "hasRole",
]) {
  if (!functionNames.has(name)) {
    throw new Error(`ABI is missing ${name}`);
  }
}

mkdirSync(dirname(destination), { recursive: true });
const source = `// Generated from contracts/out/ProductRegistry.sol/ProductRegistry.json.
// Regenerate with: npm run generate:abi --prefix apps/web
// Do not edit by hand.

import type { Abi } from "viem";

export const productRegistryAbi = ${JSON.stringify(artifact.abi, null, 2)} as const satisfies Abi;
`;
writeFileSync(destination, source);
console.log(`Wrote ${destination}`);
