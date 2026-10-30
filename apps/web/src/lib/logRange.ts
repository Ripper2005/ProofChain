export class LogsUnavailable extends Error {
  constructor() {
    super("Contract logs could not be loaded");
    this.name = "LogsUnavailable";
  }
}

const MAX_SPAN = 2000n;

export function isRangeRejection(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /range|too many|exceed|more than|response size|query returned|log size|block limit/i.test(message);
}

export async function readLogsInChunks<T>(
  read: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<T[]> {
  if (fromBlock > toBlock) return [];
  const logs: T[] = [];
  let from = fromBlock;
  while (from <= toBlock) {
    let window = MAX_SPAN;
    let accepted = false;
    while (window >= 1n) {
      const to = from + window - 1n > toBlock ? toBlock : from + window - 1n;
      try {
        logs.push(...(await read(from, to)));
        from = to + 1n;
        accepted = true;
        break;
      } catch (error) {
        const actual = to - from + 1n;
        if (!isRangeRejection(error) || actual <= 1n) throw new LogsUnavailable();
        window = actual / 2n;
      }
    }
    if (!accepted) throw new LogsUnavailable();
  }
  return logs;
}
