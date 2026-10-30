import { computeBatchId, validateBatchCode } from "@proofchain/metadata";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "../components/ConnectButton.tsx";
import { useSendAction } from "../lib/actions.ts";
import { currentDeployment } from "../lib/deployments.ts";
import { readRoles } from "../lib/reader.ts";

export function RecallPage() {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const current = currentDeployment();
  const action = useSendAction();
  const [batchCode, setBatchCode] = useState<string>("PCB-2026-001");
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const reasonBytes = new TextEncoder().encode(reason).byteLength;

  const roles = useQuery({
    queryKey: ["roles", current?.chainId, current?.address, address],
    enabled: Boolean(current && address),
    queryFn: () => readRoles(current!.chainId, current!.address, address!),
  });

  async function recall() {
    setLocalError(null);
    if (!validateBatchCode(batchCode)) {
      setLocalError("Enter a valid batch code. The typed case is kept.");
      return;
    }
    const hash = await action.send({
      functionName: "recallBatch",
      args: [computeBatchId(batchCode), reason],
    });
    if (hash) await queryClient.invalidateQueries();
  }

  const shownError = localError ?? action.error;

  return (
    <>
      <h1>Recall</h1>
      <p>
        Recall freezes the batch and clears a pending handoff. A blank reason is sent as an empty string. The contract
        stores the reason in the recall event.
      </p>
      <ConnectButton />
      {address && roles.data && !roles.data.recall ? (
        <p className="warning" data-testid="recall-role-warning">
          This wallet does not hold the recall role. You can still submit. If the contract reverts, the error is shown
          below.
        </p>
      ) : null}
      <label className="field">
        <span>Batch code</span>
        <input
          className="mono"
          value={batchCode}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setBatchCode(event.target.value)}
        />
      </label>
      <label className="field">
        <span>Reason</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} data-testid="recall-reason-input" />
      </label>
      <p className="muted">{reasonBytes} bytes. The contract allows at most 128. A longer reason still submits, and the revert is shown.</p>
      <button type="button" onClick={() => void recall()} disabled={action.pending}>
        {action.pending ? "Submitting" : "Recall batch"}
      </button>
      {shownError ? (
        <p className="revert" role="alert" data-testid="contract-error">
          {shownError}
        </p>
      ) : null}
      {action.txHash ? (
        <p>
          Transaction <span className="mono">{action.txHash}</span>
        </p>
      ) : null}
    </>
  );
}
