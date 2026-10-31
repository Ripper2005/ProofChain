import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(scriptDir, "..", "..", "..");
const artifactPath = resolve(workspace, "contracts/out/ProductRegistry.sol/ProductRegistry.json");
const destinations = [
  resolve(scriptDir, "../src/contracts/ProductRegistry.ts"),
  resolve(workspace, "packages/verifier/src/abi.ts"),
];
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

const source = `// Generated from contracts/out/ProductRegistry.sol/ProductRegistry.json.
// Regenerate with: pnpm --dir apps/web generate:abi
// Do not edit by hand.

import type { Abi } from "viem";

export const productRegistryAbi = ${JSON.stringify(artifact.abi, null, 2)} as const satisfies Abi;
`;
for (const destination of destinations) {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, source);
  console.log(`Wrote ${destination}`);
}
