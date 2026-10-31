import { isHex, type Hex } from "viem";
import { isRecord } from "./format.ts";

export type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>;

export type Reader = {
  url: string;
  request(method: string, params: readonly unknown[]): Promise<unknown>;
};

export const DEFAULT_READER_TIMEOUT_MS = 8_000;

export class RpcError extends Error {
  readonly code: number | null;
  readonly data: unknown;

  constructor(code: number | null, message: string, data: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

export class ReaderTimeout extends Error {
  constructor(milliseconds: number) {
    super(`no answer within ${milliseconds} ms`);
    this.name = "ReaderTimeout";
  }
}

export class ReaderUnreachable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReaderUnreachable";
  }
}

export function httpReader(url: string, options: { fetch: FetchLike; timeoutMs?: number }): Reader {
  const send = options.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_READER_TIMEOUT_MS;
  let nextId = 1;
  return {
    url,
    request(method, params) {
      const id = nextId;
      nextId += 1;
      return withTimeout(timeoutMs, async (signal) => {
        let response: FetchResponse;
        try {
          response = await send(url, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
            signal,
          });
        } catch (error) {
          throw new ReaderUnreachable(`the request failed (${messageOf(error)})`);
        }
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        if (isRecord(body) && isRecord(body.error)) {
          const code = typeof body.error.code === "number" ? body.error.code : null;
          const message = typeof body.error.message === "string" ? body.error.message : "JSON-RPC error";
          throw new RpcError(code, message, body.error.data);
        }
        if (!response.ok) throw new ReaderUnreachable(`HTTP ${response.status}`);
        if (!isRecord(body) || !("result" in body)) throw new ReaderUnreachable("the answer was not JSON-RPC");
        return body.result;
      });
    },
  };
}

export async function withTimeout<T>(milliseconds: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ReaderTimeout(milliseconds));
      controller.abort();
    }, milliseconds);
  });
  try {
    return await Promise.race([work(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

export function revertData(error: unknown): Hex | null {
  if (!(error instanceof RpcError)) return null;
  if (error.code !== 3 && !/revert/i.test(error.message)) return null;
  return pickHex(error.data) ?? "0x";
}

export function describeReaderError(error: unknown): string {
  if (error instanceof RpcError) return `RPC error${error.code === null ? "" : ` ${error.code}`}: ${error.message}`;
  if (error instanceof ReaderTimeout || error instanceof ReaderUnreachable) return error.message;
  return messageOf(error) || "the reader failed";
}

export async function rpcQuantity(reader: Reader, method: string): Promise<bigint> {
  const value = await reader.request(method, []);
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new ReaderUnreachable(`${method} returned ${JSON.stringify(value)}, which is not a quantity`);
  }
  return BigInt(value);
}

function pickHex(value: unknown): Hex | null {
  if (typeof value === "string") {
    if (isHex(value)) return value;
    const embedded = /0x[0-9a-fA-F]*/.exec(value);
    return embedded ? (embedded[0] as Hex) : null;
  }
  if (isRecord(value)) return pickHex(value.data);
  return null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
