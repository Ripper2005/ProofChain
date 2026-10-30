import assert from "node:assert/strict";
import test from "node:test";
import { LogsUnavailable, readLogsInChunks } from "../src/lib/logRange.ts";

test("shrinks a rejected log range and then continues", async () => {
  const calls: Array<[bigint, bigint]> = [];
  await readLogsInChunks(
    async (from, to) => {
      calls.push([from, to]);
      if (to - from + 1n > 5n) throw new Error("block range too large");
      return [from];
    },
    0n,
    11n,
  );
  const successes = calls.filter(([from, to]) => to - from + 1n <= 5n);
  assert.equal(successes[0]?.[0], 0n);
  assert.equal(successes.at(-1)?.[1], 11n);
  for (let index = 1; index < successes.length; index += 1) {
    assert.equal(successes[index]?.[0], (successes[index - 1]?.[1] ?? 0n) + 1n);
  }
  assert.ok(calls.some(([from, to]) => to - from + 1n > 5n));
});

test("a transport failure does not keep splitting the range", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      readLogsInChunks(async () => {
        calls += 1;
        throw new Error("connect ECONNREFUSED 127.0.0.1:8545");
      }, 0n, 10n),
    LogsUnavailable,
  );
  assert.equal(calls, 1);
});
