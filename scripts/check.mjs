import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contracts = join(root, "contracts");
const web = join(root, "apps/web");
const foundryBin = join(homedir(), ".foundry/bin");
const env = { ...process.env, PATH: [process.env.PATH, foundryBin].filter(Boolean).join(delimiter) };

const FORBIDDEN_NAMES = ["PRIVATE_KEY", "PINATA", "RPC_URL", "PIN_URL"];
const ANVIL_KEYS = [
  "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
];

const outDir = mkdtempSync(join(tmpdir(), "proofchain-check-"));
const steps = [
  ["forge fmt --check", () => run("forge", ["fmt", "--check"], contracts)],
  ["forge build", () => run("forge", ["build"], contracts)],
  ["forge test", () => run("forge", ["test"], contracts)],
  ["node tests", () => run("pnpm", ["test"], root)],
  ["web type-check", () => run("pnpm", ["exec", "tsc", "-p", "tsconfig.json", "--noEmit"], web)],
  [
    "hosted build (mode sepolia)",
    () => run("pnpm", ["exec", "vite", "build", "--mode", "sepolia", "--outDir", outDir, "--emptyOutDir"], web),
  ],
  ["bundle scan", () => scanBundle(outDir)],
];

let failed = null;
try {
  for (const [name, step] of steps) {
    console.log(`\n== ${name}`);
    if (!step()) {
      failed = name;
      break;
    }
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failed) {
  console.error(`\npnpm check failed at: ${failed}`);
  process.exit(1);
}
console.log("\npnpm check passed");

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) console.error(`${command}: ${result.error.message}`);
  return result.status === 0;
}

function scanBundle(dir) {
  const needles = [
    ...FORBIDDEN_NAMES.map((value) => ({ label: value, value })),
    ...ANVIL_KEYS.map((value, index) => ({ label: `Anvil development key ${index}`, value })),
    ...localSecrets(),
  ];
  const hits = [];
  for (const file of filesUnder(dir)) {
    const text = readFileSync(file, "utf8").toLowerCase();
    for (const needle of needles) {
      if (text.includes(needle.value.toLowerCase())) hits.push(`${needle.label} in ${file.slice(dir.length + 1)}`);
    }
  }
  for (const hit of hits) console.error(`found ${hit}`);
  if (hits.length === 0) console.log(`no forbidden string in ${filesUnder(dir).length} files`);
  return hits.length === 0;
}

// Values are compared, never printed: the labels name the variable only.
function localSecrets() {
  const file = join(root, ".env");
  if (!existsSync(file)) return [];
  const secrets = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^(PRIVATE_KEY|PINATA_JWT)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "").replace(/^0x/i, "");
    if (value.length >= 16) secrets.push({ label: `the value of ${match[1]} from .env`, value });
  }
  return secrets;
}

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}
