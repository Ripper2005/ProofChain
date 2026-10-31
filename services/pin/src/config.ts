import { parseEnv } from "node:util";
import { PINATA_API_URL } from "./pinata.ts";

export const LOCAL_IPFS_API_URL = "http://127.0.0.1:5001";

// The root .env also holds PRIVATE_KEY, which this service must never receive.
export const PIN_VARIABLES = ["PORT", "PIN_HOST", "IPFS_API_URL", "PINATA_JWT", "PIN_REQUIRE_PUBLIC", "PINATA_API_URL"];

export function pinEnvironment(
  processEnv: Record<string, string | undefined>,
  envFileText: string | undefined,
): Record<string, string | undefined> {
  const fromFile = envFileText ? parseEnv(envFileText) : {};
  return Object.fromEntries(PIN_VARIABLES.map((name) => [name, processEnv[name] ?? fromFile[name]]));
}

export type PinConfig = {
  port: number;
  host: string;
  ipfsApiUrl: string;
  pinata: { jwt: string; apiUrl: string; required: boolean } | undefined;
};

export function loadConfig(env: Record<string, string | undefined>): PinConfig {
  const required = optionalBoolean(env.PIN_REQUIRE_PUBLIC, "PIN_REQUIRE_PUBLIC") ?? true;
  const jwt = env.PINATA_JWT?.trim();
  const apiUrl = env.PINATA_API_URL || PINATA_API_URL;
  if (jwt && !isHttpsOrLoopback(apiUrl)) {
    throw new Error("PINATA_API_URL must be an https URL or a loopback http URL");
  }

  return {
    port: Number(env.PORT || 8788),
    host: env.PIN_HOST || "127.0.0.1",
    ipfsApiUrl: env.IPFS_API_URL || LOCAL_IPFS_API_URL,
    pinata: jwt ? { jwt, apiUrl, required } : undefined,
  };
}

function optionalBoolean(value: string | undefined, name: string): boolean | undefined {
  if (value == null || value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function isHttpsOrLoopback(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
}
