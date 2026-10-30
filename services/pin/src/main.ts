import { createServer, type IncomingMessage } from "node:http";
import { createApp } from "./app.ts";
import { createKuboPinner } from "./kubo.ts";
import { MAX_BLOB_BYTES } from "./pinner.ts";

const port = Number(process.env.PORT ?? 8788);
const hostname = process.env.PIN_HOST ?? "127.0.0.1";
const apiUrl = process.env.IPFS_API_URL ?? "http://127.0.0.1:5001";
const app = createApp(createKuboPinner(apiUrl));

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? `${hostname}:${port}`;
    const url = new URL(req.url ?? "/", `http://${host}`);
    const body = await readLimited(req, MAX_BLOB_BYTES);
    if (body === null) {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "TooLarge", message: "Request body exceeds 5 MB" }));
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (key === "transfer-encoding" || key === "content-length") continue;
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(", "));
    }
    const method = req.method ?? "GET";
    const request = new Request(url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
    });
    const response = await app.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (res.headersSent) return;
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Internal", message: "Pin service failed" }));
  }
});

server.listen(port, hostname);

function readLimited(req: IncomingMessage, maxBytes: number): Promise<Uint8Array | null> {
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
