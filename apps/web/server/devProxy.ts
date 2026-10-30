import type { IncomingMessage, ServerResponse } from "node:http";
import { inspectRpcBody, pinPostDecision } from "./policy.ts";
import { ipfsCid, joinUrl, stripMount } from "./urls.ts";

export type ProxyTargets = {
  rpcUrl: string;
  pinUrl: string;
  indexerUrl: string;
  ipfsGatewayUrl: string;
};

export type NextFunction = (error?: unknown) => void;

const RPC_BODY_LIMIT = 1024 * 1024;
const PIN_BODY_LIMIT = 6 * 1024 * 1024;

export function createDevMiddleware(targets: ProxyTargets) {
  return function proofchainDevProxy(req: IncomingMessage, res: ServerResponse, next: NextFunction) {
    const url = req.url ?? "/";
    const path = url.split("?")[0] ?? "/";
    if (path === "/rpc") {
      void handleRpc(req, res, targets.rpcUrl);
      return;
    }
    if (path === "/api" || path.startsWith("/api/")) {
      void handleApi(req, res, targets);
      return;
    }
    if (path === "/ipfs" || path.startsWith("/ipfs/")) {
      void handleIpfs(req, res, targets.ipfsGatewayUrl);
      return;
    }
    next();
  };
}

async function handleRpc(req: IncomingMessage, res: ServerResponse, rpcUrl: string) {
  if (req.headers.upgrade) {
    sendJson(res, 400, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32601, message: "WebSocket proxying is not enabled on /rpc" },
    });
    req.resume();
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "JSON-RPC requests must use POST" },
    });
    req.resume();
    return;
  }
  const raw = await readBody(req, RPC_BODY_LIMIT);
  if (raw === null) {
    sendJson(res, 413, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "JSON-RPC body is too large" },
    });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    sendJson(res, 400, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "JSON-RPC body is not JSON" },
    });
    return;
  }
  const decision = inspectRpcBody(parsed);
  if (!decision.ok) {
    sendJson(res, 403, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32601, message: decision.message },
    });
    return;
  }
  await forward(res, rpcUrl, "POST", raw, contentType(req));
}

async function handleApi(req: IncomingMessage, res: ServerResponse, targets: ProxyTargets) {
  const method = req.method ?? "GET";
  if (method === "POST") {
    const decision = pinPostDecision(req.socket.remoteAddress, headerValue(req.headers.host));
    if (!decision.ok) {
      sendJson(res, 403, { error: "PinProxyRejected", message: decision.message });
      req.resume();
      return;
    }
    const suffix = stripMount(req.url ?? "/", "/api");
    if (!suffix) {
      sendJson(res, 400, { error: "InvalidPath", message: "Pin path is not allowed" });
      req.resume();
      return;
    }
    const raw = await readBody(req, PIN_BODY_LIMIT);
    if (raw === null) {
      sendJson(res, 413, { error: "TooLarge", message: "Pin request body exceeds 6 MB" });
      return;
    }
    await forward(res, joinUrl(targets.pinUrl, suffix), "POST", raw, contentType(req));
    return;
  }
  if (method === "GET" || method === "HEAD") {
    const suffix = stripMount(req.url ?? "/", "/api");
    if (!suffix) {
      sendJson(res, 400, { error: "InvalidPath", message: "Indexer path is not allowed" });
      return;
    }
    await forward(res, joinUrl(targets.indexerUrl, suffix), method, undefined, contentType(req));
    return;
  }
  sendJson(res, 405, { error: "MethodNotAllowed", message: "Use GET for the indexer or POST for the pin service" });
  req.resume();
}

async function handleIpfs(req: IncomingMessage, res: ServerResponse, gateway: string) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "MethodNotAllowed", message: "The IPFS proxy accepts GET" });
    req.resume();
    return;
  }
  const cid = ipfsCid(req.url ?? "/");
  if (!cid) {
    sendJson(res, 400, { error: "InvalidCid", message: "IPFS proxy expects /ipfs/{cid}" });
    return;
  }
  const queryAt = (req.url ?? "").indexOf("?");
  const query = queryAt === -1 ? "" : (req.url ?? "").slice(queryAt);
  await forward(res, joinUrl(gateway, `/ipfs/${encodeURIComponent(cid)}${query}`), req.method, undefined, undefined);
}

async function forward(
  res: ServerResponse,
  target: string,
  method: string,
  body: Uint8Array | undefined,
  type: string | undefined,
) {
  try {
    const headers = new Headers();
    if (type) headers.set("content-type", type);
    const response = await fetch(target, {
      method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const out: Record<string, string> = { "cache-control": "no-store" };
    const responseType = response.headers.get("content-type");
    if (responseType) out["content-type"] = responseType;
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (res.headersSent) return;
    sendJson(res, 502, { error: "ProxyTargetUnavailable", message: "The upstream service did not respond" });
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function contentType(req: IncomingMessage): string | undefined {
  const value = req.headers["content-type"];
  return typeof value === "string" ? value : undefined;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (value: Uint8Array | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.byteLength;
      if (total > maxBytes) {
        finish(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish(Buffer.concat(chunks)));
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}
