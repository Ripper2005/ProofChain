import assert from "node:assert/strict";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createDevMiddleware } from "../server/devProxy.ts";

test("rejects a mixed JSON-RPC batch without forwarding it", async () => {
  const upstreamHits: string[] = [];
  const upstream = await listen((req, res) => {
    upstreamHits.push(req.method ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify([{ jsonrpc: "2.0", id: 1, result: "0x1" }]));
  });
  const app = await listen(
    createDevMiddleware({
      rpcUrl: upstream.url,
      pinUrl: "http://127.0.0.1:9",
      indexerUrl: "http://127.0.0.1:9",
      ipfsGatewayUrl: "http://127.0.0.1:9",
    }),
  );

  const rejected = await post(app.url, "/rpc", [
    { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
    { jsonrpc: "2.0", id: 2, method: "eth_sendTransaction", params: [{}] },
  ]);
  assert.equal(rejected.status, 403);
  assert.equal(Array.isArray(rejected.body), false);
  assert.match(JSON.stringify(rejected.body), /rejected/);
  assert.equal(upstreamHits.length, 0);

  const allowed = await post(app.url, "/rpc", { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
  assert.equal(allowed.status, 200);
  assert.equal(upstreamHits.length, 1);

  const upgrade = await request(app.url, "/rpc", "GET", { upgrade: "websocket", connection: "Upgrade" });
  assert.equal(upgrade.status, 400);
  assert.equal(upstreamHits.length, 1);

  await upstream.close();
  await app.close();
});

test("pin POST requires a localhost Host even from loopback", async () => {
  const pinHits: string[] = [];
  const pin = await listen((req, res) => {
    pinHits.push(req.url ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ cid: "bafy", metadataHash: "0x1" }));
  });
  const app = await listen(
    createDevMiddleware({
      rpcUrl: "http://127.0.0.1:9",
      pinUrl: pin.url,
      indexerUrl: "http://127.0.0.1:9",
      ipfsGatewayUrl: "http://127.0.0.1:9",
    }),
  );

  const rejected = await post(app.url, "/api/metadata", { canonical: "{}", batchCode: "PCB-2026-001" }, { host: "10.42.28.58:5173" });
  assert.equal(rejected.status, 403);
  assert.equal(pinHits.length, 0);

  const allowed = await post(app.url, "/api/metadata", { canonical: "{}", batchCode: "PCB-2026-001" }, { host: "localhost:5173" });
  assert.equal(allowed.status, 200);
  assert.deepEqual(pinHits, ["/metadata"]);

  await pin.close();
  await app.close();
});

function listen(handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) {
  const server = createServer((req, res) => {
    handler(req, res, () => {
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, reject) => {
            server.close((error) => (error ? reject(error) : done()));
          }),
      });
    });
  });
}

function post(base: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return request(base, path, "POST", { "content-type": "application/json", ...headers }, JSON.stringify(body));
}

function request(
  base: string,
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; body: unknown }> {
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = text;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
          resolve({ status: response.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
