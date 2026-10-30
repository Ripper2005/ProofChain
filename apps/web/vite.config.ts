import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { createDevMiddleware } from "./server/devProxy.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const rpcUrl = env.RPC_URL || "http://127.0.0.1:8545";
  const pinUrl = env.PIN_URL || "http://127.0.0.1:8788";
  const indexerUrl = env.INDEXER_URL || "http://127.0.0.1:8787";
  const ipfsGatewayUrl = env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080";

  return {
    plugins: [
      react(),
      {
        name: "proofchain-dev-proxy",
        configureServer(server) {
          server.middlewares.use(
            createDevMiddleware({
              rpcUrl,
              pinUrl,
              indexerUrl,
              ipfsGatewayUrl,
            }),
          );
          server.httpServer?.on("upgrade", (req, socket) => {
            const path = (req.url ?? "/").split("?")[0];
            if (path !== "/rpc") return;
            const body = JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32601, message: "WebSocket proxying is not enabled on /rpc" },
            });
            socket.end(
              `HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
            );
          });
        },
      },
    ],
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      allowedHosts: true,
    },
  };
});
