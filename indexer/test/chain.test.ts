import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createChainReader, shrinksLogRange } from "../src/chain.ts";
import { loadConfig } from "../src/config.ts";

type Reply = "range" | "results" | "rate" | "hang";

describe("chain reader errors", () => {
  let server: Server;
  let url = "";
  let reply: Reply = "range";

  before(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });
      req.on("end", () => {
        const id = (JSON.parse(body) as { id: number }).id;
        if (reply === "hang") return;
        if (reply === "rate") {
          res.writeHead(429, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32005, message: "rate limit exceeded" } }));
          return;
        }
        const message =
          reply === "range" ? "exceed maximum block range: 50000" : "query returned more than 10000 results";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: reply === "range" ? -32701 : -32005, message } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server.closeAllConnections();
    server.close();
  });

  it("shrinks the range on publicnode's range rejection, a result cap, and a timeout, but not on a rate limit or a refused connection", async () => {
    const reader = createChainReader(readerConfig(url), { timeoutMs: 200 });
    for (const [mode, shrinks] of [
      ["range", true],
      ["results", true],
      ["hang", true],
      ["rate", false],
    ] as Array<[Reply, boolean]>) {
      reply = mode;
      const error = await reader.getLogs(0, 60_000).then(
        () => assert.fail(`${mode} should reject`),
        (caught: unknown) => caught,
      );
      assert.equal(shrinksLogRange(error), shrinks, mode);
    }

    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const closedUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const refused = await createChainReader(readerConfig(closedUrl), { timeoutMs: 1000 })
      .getLogs(0, 10)
      .then(
        () => assert.fail("a closed port should reject"),
        (caught: unknown) => caught,
      );
    assert.equal(shrinksLogRange(refused), false);
  });
});

function readerConfig(chainRpcUrl: string) {
  return loadConfig({
    CONTRACT_ADDRESS: `0x${"ab".repeat(20)}`,
    START_BLOCK: "0",
    CHAIN_RPC_URL: chainRpcUrl,
  });
}
