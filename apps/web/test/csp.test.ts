import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type Header = { key?: string; value?: string };
type VercelConfig = {
  buildCommand?: string;
  rewrites?: { source?: string; destination?: string }[];
  headers?: { source?: string; headers?: Header[] }[];
};

test("the hosted policy lists every configured reader and gateway origin", () => {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as VercelConfig;
  const trusted = JSON.parse(readFileSync(new URL("../trusted-deployments.json", import.meta.url), "utf8")) as {
    deployments?: { rpcUrls?: unknown }[];
  };
  const env = readFileSync(new URL("../.env.sepolia", import.meta.url), "utf8");
  const origins = [...new Set([...readerOrigins(trusted), ...gatewayOrigins(env)])];
  assert.ok(origins.length > 0);

  assert.equal(vercel.buildCommand, "vite build --mode sepolia");
  assert.ok(vercel.rewrites?.some((rule) => rule.destination === "/index.html"));

  const block = vercel.headers?.find((item) => item.source === "/(.*)");
  assert.ok(block, "headers are not set on every path");
  const header = (name: string) => block.headers?.find((item) => item.key === name)?.value;
  assert.equal(header("X-Content-Type-Options"), "nosniff");
  assert.equal(header("Referrer-Policy"), "strict-origin-when-cross-origin");
  const policy = header("Content-Security-Policy");
  if (typeof policy !== "string") throw new Error("missing Content-Security-Policy");

  assert.deepEqual(sources(policy, "default-src"), ["'self'"]);
  assert.deepEqual(sources(policy, "script-src"), ["'self'"]);
  assert.deepEqual(sources(policy, "style-src"), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(sources(policy, "object-src"), ["'none'"]);
  assert.deepEqual(sources(policy, "base-uri"), ["'self'"]);
  assert.deepEqual(sources(policy, "frame-ancestors"), ["'none'"]);

  const connect = sources(policy, "connect-src");
  const images = sources(policy, "img-src");
  assert.deepEqual([...connect].sort(), ["'self'", ...origins].sort());
  assert.deepEqual([...images].sort(), ["'self'", "data:", ...origins].sort());
  for (const origin of origins) {
    assert.ok(connect.includes(origin), `${origin} is missing from connect-src`);
  }
});

function readerOrigins(file: { deployments?: { rpcUrls?: unknown }[] }): string[] {
  const origins: string[] = [];
  for (const deployment of file.deployments ?? []) {
    if (!Array.isArray(deployment.rpcUrls)) continue;
    for (const url of deployment.rpcUrls) {
      if (typeof url !== "string" || url.length === 0) continue;
      origins.push(new URL(url).origin);
    }
  }
  return origins;
}

function gatewayOrigins(env: string): string[] {
  const line = env.split(/\r?\n/).find((row) => row.startsWith("VITE_IPFS_GATEWAYS="));
  if (!line) return [];
  const value = line.slice("VITE_IPFS_GATEWAYS=".length).trim().replace(/^["']|["']$/g, "");
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => new URL(item).origin);
}

function sources(policy: string, name: string): string[] {
  const directive = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  assert.ok(directive, `missing ${name}`);
  return directive.split(/\s+/).slice(1);
}
