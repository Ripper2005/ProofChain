export const RPC_ALLOWLIST = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getCode",
  "eth_getProof",
  "eth_call",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getBalance",
  "eth_gasPrice",
  "eth_estimateGas",
  "net_version",
  "web3_clientVersion",
] as const;

const ALLOWED = new Set<string>(RPC_ALLOWLIST);

export type RpcDecision = { ok: true } | { ok: false; message: string };

export function inspectRpcBody(body: unknown): RpcDecision {
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return { ok: false, message: "JSON-RPC batch rejected because a method is missing or not allowed" };
    }
    for (const entry of body) {
      const method = methodOf(entry);
      if (method === null || !ALLOWED.has(method)) {
        return { ok: false, message: "JSON-RPC batch rejected because a method is missing or not allowed" };
      }
    }
    return { ok: true };
  }
  const method = methodOf(body);
  if (method === null || !ALLOWED.has(method)) {
    return { ok: false, message: "JSON-RPC method is not allowed on this reader" };
  }
  return { ok: true };
}

export function isLoopbackPeer(address: string | undefined): boolean {
  if (!address) return false;
  const value = address.toLowerCase();
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}

export function isLocalhostHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const name = hostnameOf(hostHeader.trim().toLowerCase());
  return name === "localhost" || name === "127.0.0.1";
}

export function pinPostDecision(
  peer: string | undefined,
  host: string | undefined,
): { ok: true } | { ok: false; message: string } {
  const peerOk = isLoopbackPeer(peer);
  const hostOk = isLocalhostHost(host);
  if (peerOk && hostOk) return { ok: true };
  if (!peerOk && !hostOk) {
    return { ok: false, message: "Pin requests require a loopback peer and a localhost Host header." };
  }
  if (!peerOk) {
    return { ok: false, message: "Pin requests require a loopback TCP peer. A forged Host header is not enough." };
  }
  return { ok: false, message: "Pin requests require a Host header of localhost or 127.0.0.1." };
}

function methodOf(entry: unknown): string | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  const method = (entry as { method?: unknown }).method;
  if (typeof method !== "string" || method.length === 0) return null;
  return method;
}

function hostnameOf(host: string): string | null {
  if (host.length === 0) return null;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end <= 1) return null;
    const rest = host.slice(end + 1);
    if (rest !== "" && !/^:\d+$/.test(rest)) return null;
    return host.slice(1, end);
  }
  const colon = host.lastIndexOf(":");
  if (colon === -1) return host;
  const port = host.slice(colon + 1);
  if (!/^\d+$/.test(port)) return null;
  return host.slice(0, colon);
}
