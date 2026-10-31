import { HttpRequestError, RpcRequestError, TimeoutError } from "viem";
import type { ChainReader } from "../src/chain.ts";
import type { RawLog } from "../src/events.ts";

export class FakeChain implements ChainReader {
  chainId: number;
  head = 0;
  salt = 1;
  fail = false;
  logs: RawLog[] = [];
  blockReads: number[] = [];
  logRanges: Array<[number, number]> = [];
  logFailure: ((fromBlock: number, toBlock: number) => Error | undefined) | undefined;
  private custom = new Map<number, { hash: string; parentHash: string }>();
  private missing = new Set<number>();

  constructor(chainId = 31337) {
    this.chainId = chainId;
  }

  hashOf(number: number): string {
    return this.custom.get(number)?.hash ?? hexWord(this.salt * 1_000_000 + number + 1);
  }

  setBlockHash(number: number, hash: string): void {
    this.custom.set(number, {
      hash,
      parentHash: number === 0 ? hexWord(0) : this.hashOf(number - 1),
    });
  }

  reset(salt: number): void {
    this.salt = salt;
    this.custom.clear();
    this.missing.clear();
    this.logs = [];
  }

  async getChainId(): Promise<number> {
    if (this.fail) throw new Error("rpc down");
    return this.chainId;
  }

  async getHeadBlock(): Promise<number> {
    if (this.fail) throw new Error("rpc down");
    return this.head;
  }

  async getBlock(number: number) {
    this.blockReads.push(number);
    if (this.fail) throw new Error("rpc down");
    if (number < 0) throw new Error("negative block");
    if (number > this.head || this.missing.has(number)) return null;
    const custom = this.custom.get(number);
    return {
      number,
      hash: this.hashOf(number),
      parentHash: custom?.parentHash ?? (number === 0 ? hexWord(0) : this.hashOf(number - 1)),
    };
  }

  async getLogs(fromBlock: number, toBlock: number): Promise<RawLog[]> {
    this.logRanges.push([fromBlock, toBlock]);
    if (this.fail) throw new Error("rpc down");
    const failure = this.logFailure?.(fromBlock, toBlock);
    if (failure) throw failure;
    return this.logs
      .filter((log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock)
      .sort((left, right) => left.blockNumber - right.blockNumber || left.logIndex - right.logIndex)
      .map((log) => ({ ...log, topics: [...log.topics] }));
  }
}

export function rangeRejection(limit: number): Error {
  return new RpcRequestError({
    body: { method: "eth_getLogs" },
    error: { code: -32701, message: `exceed maximum block range: ${limit}` },
    url: "http://fake.rpc",
  });
}

export function requestTimeout(): Error {
  return new TimeoutError({ body: { method: "eth_getLogs" }, url: "http://fake.rpc" });
}

export function rateLimited(): Error {
  return new HttpRequestError({ body: { method: "eth_getLogs" }, status: 429, details: "Too Many Requests", url: "http://fake.rpc" });
}

export function hexWord(value: number): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

export function txWord(value: number): string {
  return `0x${"ab"}${value.toString(16).padStart(62, "0")}`;
}
