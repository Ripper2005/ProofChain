import { createServer } from "node:http";
import { createApp } from "./api.ts";
import { createChainReader } from "./chain.ts";
import { loadConfig, syncConfigOf } from "./config.ts";
import { createPool, migrate, PgStore } from "./pg-store.ts";
import { probePin } from "./pin.ts";
import { createSyncLoop, resync } from "./sync.ts";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const pool = createPool(config.databaseUrl);
  pool.on("error", (error) => {
    console.error(`Indexer: ${error.message}`);
  });
  const store = new PgStore(pool);
  await migrate(pool);

  const syncConfig = syncConfigOf(config);
  if (process.argv.includes("--resync")) {
    const result = await resync(store, syncConfig);
    if (result === "mismatch") {
      console.error(
        "Refusing to resync because the chain id or contract address does not match indexer_meta. Empty the database to change either.",
      );
      await pool.end();
      process.exit(1);
    }
  }

  const loop = createSyncLoop({
    store,
    chain: createChainReader(config),
    config: syncConfig,
    intervalMs: config.pollIntervalMs,
  });

  const app = createApp({
    store,
    status: () => loop.status(),
    pinOk: () => probePin(config.pinUrl),
    webOrigin: config.webOrigin,
  });
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? `${config.host}:${config.port}`;
      const url = new URL(req.url ?? "/", `http://${host}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(", "));
      }
      const response = await app.fetch(new Request(url, { method: req.method, headers }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (res.headersSent) return;
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Internal", message: "Indexer failed" }));
    }
  });

  server.listen(config.port, config.host, () => {
    console.log(`indexer listening on ${config.host}:${config.port}`);
  });
  void loop.tick();
  loop.start();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
