import type { Address, Hex } from "viem";
import { asAddress, asBigint } from "./format.ts";
import type { ProductLog } from "./logs.ts";

type Position = {
  time: bigint | null;
  blockNumber: bigint | null;
  txHash: Hex | null;
};

export type TimelineStep =
  | (Position & { kind: "registered"; manufacturer: Address })
  | (Position & { kind: "proposed"; from: Address; to: Address })
  | (Position & { kind: "cancelled"; from: Address; to: Address })
  | (Position & { kind: "accepted"; from: Address; to: Address })
  | (Position & { kind: "recalled"; recalledBy: Address | null; reason: string | null; pendingCleared: boolean | null })
  | (Position & { kind: "pending"; from: Address; to: Address; open: true });

export type PendingHandoff = {
  from: Address;
  to: Address;
  proposedAt: bigint;
  txHash: Hex | null;
  blockNumber: bigint | null;
};

export type AcceptedHandoff = {
  from: Address;
  to: Address;
  timestamp: bigint;
  txHash: Hex | null;
  blockNumber: bigint | null;
};

export function timelineFromLogs(logs: readonly ProductLog[], pending: PendingHandoff | null): TimelineStep[] {
  const steps: TimelineStep[] = [];
  for (const log of logs) {
    const position = { blockNumber: log.blockNumber, txHash: log.transactionHash };
    const from = asAddress(log.args.from);
    const to = asAddress(log.args.to);
    switch (log.eventName) {
      case "BatchRegistered": {
        const manufacturer = asAddress(log.args.manufacturer);
        if (manufacturer) steps.push({ kind: "registered", manufacturer, time: asBigint(log.args.createdAt), ...position });
        break;
      }
      case "CustodyTransferProposed":
        if (from && to) steps.push({ kind: "proposed", from, to, time: asBigint(log.args.proposedAt), ...position });
        break;
      case "CustodyTransferCancelled":
        if (from && to) steps.push({ kind: "cancelled", from, to, time: asBigint(log.args.cancelledAt), ...position });
        break;
      case "CustodyTransferred":
        if (from && to) steps.push({ kind: "accepted", from, to, time: asBigint(log.args.timestamp), ...position });
        break;
      case "BatchRecalled":
        steps.push({
          kind: "recalled",
          recalledBy: asAddress(log.args.recalledBy),
          reason: typeof log.args.reason === "string" ? log.args.reason : null,
          pendingCleared: typeof log.args.pendingCleared === "boolean" ? log.args.pendingCleared : null,
          time: asBigint(log.args.recalledAt),
          ...position,
        });
        break;
    }
  }
  if (pending) steps.push(pendingStep(pending));
  return steps;
}

export function timelineFromContract(input: {
  manufacturer: Address;
  createdAt: bigint;
  history: readonly AcceptedHandoff[];
  recalled: boolean;
  pending: PendingHandoff | null;
}): TimelineStep[] {
  const steps: TimelineStep[] = [
    { kind: "registered", manufacturer: input.manufacturer, time: input.createdAt, blockNumber: null, txHash: null },
    ...input.history.map(
      (row): TimelineStep => ({
        kind: "accepted",
        from: row.from,
        to: row.to,
        time: row.timestamp,
        blockNumber: null,
        txHash: null,
      }),
    ),
  ];
  if (input.recalled) {
    steps.push({
      kind: "recalled",
      recalledBy: null,
      reason: null,
      pendingCleared: null,
      time: null,
      blockNumber: null,
      txHash: null,
    });
  }
  if (input.pending) steps.push(pendingStep(input.pending));
  return steps;
}

function pendingStep(pending: PendingHandoff): TimelineStep {
  return {
    kind: "pending",
    from: pending.from,
    to: pending.to,
    time: pending.proposedAt,
    blockNumber: pending.blockNumber,
    txHash: pending.txHash,
    open: true,
  };
}
