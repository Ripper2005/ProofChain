import { computeBatchId, validateBatchCode } from "@proofchain/metadata";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useAccount } from "wagmi";
import { BatchLookupPanel } from "../components/BatchLookupPanel.tsx";
import { ConnectButton } from "../components/ConnectButton.tsx";
import { SimulationNotice } from "../components/SimulationNotice.tsx";
import { DEMO_DOCUMENT } from "../demo.ts";
import { useSendAction } from "../lib/actions.ts";
import { writeTarget, writeTargetMessage } from "../lib/deployments.ts";
import { loadBatch, readRoles } from "../lib/reader.ts";

export function RecallPage() {
  const queryClient = useQueryClient();
  const batchInputId = useId();
  const batchHintId = useId();
  const reasonInputId = useId();
  const reasonHintId = useId();
  const { address } = useAccount();
  const target = writeTarget();
  const current = target.kind === "ready" ? target.deployment : null;
  const action = useSendAction();
  const [batchCode, setBatchCode] = useState<string>(DEMO_DOCUMENT.batchCode);
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [touchedBatch, setTouchedBatch] = useState(false);
  const codeIsValid = validateBatchCode(batchCode);
  const reasonBytes = new TextEncoder().encode(reason).byteLength;

  const roles = useQuery({
    queryKey: ["roles", current?.chainId, current?.address, address],
    enabled: Boolean(current && address),
    queryFn: () => readRoles(current!.chainId, current!.address, address!),
  });

  const batch = useQuery({
    queryKey: ["recall-batch", current?.chainId, current?.address, batchCode],
    enabled: Boolean(current && codeIsValid),
    queryFn: () => loadBatch(current!.chainId, current!.address, batchCode),
  });

  async function recall() {
    setLocalError(null);
    setTouchedBatch(true);
    if (!codeIsValid) {
      setLocalError("Enter a valid batch code. The typed case is kept.");
      return;
    }
    const hash = await action.send({
      functionName: "recallBatch",
      args: [computeBatchId(batchCode), reason],
    });
    if (hash) await queryClient.invalidateQueries();
  }

  async function sendAnyway() {
    const hash = await action.sendAnyway();
    if (hash) await queryClient.invalidateQueries();
  }

  const shownError = localError ?? action.error;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Batch recall</h1>
          <p className="lead">
            Recalling a batch freezes its on-chain status permanently and clears any pending handoff. A blank reason is
            sent as an empty string; reasons are stored in the <span className="mono">BatchRecalled</span> event.
          </p>
        </div>
      </div>

      {!current ? (
        <p className="warning" data-testid="write-not-configured">
          {writeTargetMessage(target)}
        </p>
      ) : null}

      <section className="card stack">
        <h2>1. Connected wallet &amp; recall role</h2>
        <ConnectButton />
        {address && roles.data && !roles.data.recall ? (
          <p className="warning" data-testid="recall-role-warning">
            This wallet does not hold the recall role. You can still submit. The simulation shows the contract&apos;s
            rejection first, and Send anyway records it on-chain.
          </p>
        ) : null}
      </section>

      <section className="card stack">
        <h2>2. Select batch</h2>
        <div className="field">
          <label className="field-label" htmlFor={batchInputId}>
            Batch code
          </label>
          <p id={batchHintId} className="field-hint">
            Case-sensitive identifier (1–64 characters: A–Z, a–z, 0–9, or hyphen).
          </p>
          <input
            id={batchInputId}
            className="mono"
            value={batchCode}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            aria-describedby={batchHintId}
            aria-invalid={touchedBatch && !codeIsValid ? true : undefined}
            onBlur={() => setTouchedBatch(true)}
            onChange={(event) => {
              setBatchCode(event.target.value);
              if (localError) setLocalError(null);
            }}
          />
        </div>

        <BatchLookupPanel
          query={batch}
          codeIsValid={codeIsValid}
          chainId={current?.chainId ?? null}
        />
      </section>

      <section className="card stack">
        <h2>3. Execute recall</h2>
        <div className="field">
          <label className="field-label" htmlFor={reasonInputId}>
            Reason (optional)
          </label>
          <p id={reasonHintId} className="field-hint">
            {reasonBytes} / 128 UTF-8 bytes used. A longer reason still submits so the contract&apos;s InvalidReason
            revert can be observed.
          </p>
          <textarea
            id={reasonInputId}
            value={reason}
            aria-describedby={reasonHintId}
            aria-invalid={reasonBytes > 128 ? true : undefined}
            onChange={(event) => setReason(event.target.value)}
            data-testid="recall-reason-input"
          />
        </div>

        <div className="actions">
          <button type="button" onClick={() => void recall()} disabled={action.pending}>
            {action.pending ? "Submitting…" : "Recall batch"}
          </button>
        </div>

        {action.stopped ? (
          <SimulationNotice simulation={action.stopped} pending={action.pending} onSendAnyway={() => void sendAnyway()} />
        ) : null}
        {shownError ? (
          <p className="revert" role="alert" data-testid="contract-error">
            {shownError}
          </p>
        ) : null}
        {action.txHash ? (
          <div className="notice notice-match" role="status">
            <p>
              <strong>On-chain record recalled</strong>
            </p>
            <p className="mono">
              {current?.chainId === 11155111 ? (
                <a href={`https://sepolia.etherscan.io/tx/${action.txHash}`} target="_blank" rel="noreferrer">
                  {action.txHash}
                </a>
              ) : (
                action.txHash
              )}
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
