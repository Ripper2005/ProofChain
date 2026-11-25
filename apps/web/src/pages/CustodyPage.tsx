import { computeBatchId, validateBatchCode } from "@proofchain/metadata";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { getAddress, isAddress } from "viem";
import { BatchLookupPanel } from "../components/BatchLookupPanel.tsx";
import { ConnectButton } from "../components/ConnectButton.tsx";
import { SimulationNotice } from "../components/SimulationNotice.tsx";
import { DEMO_DOCUMENT } from "../demo.ts";
import { useSendAction } from "../lib/actions.ts";
import { writeTarget, writeTargetMessage } from "../lib/deployments.ts";
import { loadBatch } from "../lib/reader.ts";

export function CustodyPage() {
  const queryClient = useQueryClient();
  const batchInputId = useId();
  const batchHintId = useId();
  const recipientInputId = useId();
  const recipientHintId = useId();
  const target = writeTarget();
  const current = target.kind === "ready" ? target.deployment : null;
  const action = useSendAction();
  const [batchCode, setBatchCode] = useState<string>(DEMO_DOCUMENT.batchCode);
  const [recipient, setRecipient] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [touchedBatch, setTouchedBatch] = useState(false);
  const [touchedRecipient, setTouchedRecipient] = useState(false);
  const codeIsValid = validateBatchCode(batchCode);
  const recipientIsValid = isAddress(recipient);

  const batch = useQuery({
    queryKey: ["custody-batch", current?.chainId, current?.address, batchCode],
    enabled: Boolean(current && codeIsValid),
    queryFn: () => loadBatch(current!.chainId, current!.address, batchCode),
  });

  async function propose() {
    setLocalError(null);
    setTouchedBatch(true);
    setTouchedRecipient(true);
    if (!codeIsValid) {
      setLocalError("Enter a valid batch code. The typed case is kept.");
      return;
    }
    if (!isAddress(recipient)) {
      setLocalError("Enter a valid 0x Ethereum address for the wallet that should accept the handoff.");
      return;
    }
    const hash = await action.send({
      functionName: "proposeCustodyTransfer",
      args: [computeBatchId(batchCode), getAddress(recipient)],
    });
    if (hash) await queryClient.invalidateQueries();
  }

  async function accept() {
    setLocalError(null);
    setTouchedBatch(true);
    if (!codeIsValid) {
      setLocalError("Enter a valid batch code. The typed case is kept.");
      return;
    }
    const hash = await action.send({
      functionName: "acceptCustodyTransfer",
      args: [computeBatchId(batchCode)],
    });
    if (hash) await queryClient.invalidateQueries();
  }

  async function cancel() {
    setLocalError(null);
    setTouchedBatch(true);
    if (!codeIsValid) {
      setLocalError("Enter a valid batch code. The typed case is kept.");
      return;
    }
    const hash = await action.send({
      functionName: "cancelCustodyTransfer",
      args: [computeBatchId(batchCode)],
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
          <h1>Custody handoff</h1>
          <p className="lead">
            The current custodian proposes a handoff. Only the named recipient wallet can accept it, or the custodian can
            cancel it. Any connected wallet may submit a proposal so the contract&apos;s own authorization check can be
            demonstrated.
          </p>
        </div>
      </div>

      {!current ? (
        <p className="warning" data-testid="write-not-configured">
          {writeTargetMessage(target)}
        </p>
      ) : null}

      <section className="card">
        <h2>1. Connected wallet</h2>
        <ConnectButton />
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
        <h2>3. Handoff action</h2>
        <div className="field">
          <label className="field-label" htmlFor={recipientInputId}>
            Recipient wallet (required only to propose)
          </label>
          <p id={recipientHintId} className="field-hint">
            Enter the 0x address that will be authorized to accept custody.
          </p>
          <input
            id={recipientInputId}
            className="mono"
            value={recipient}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            placeholder="0x..."
            aria-describedby={recipientHintId}
            aria-invalid={touchedRecipient && recipient.length > 0 && !recipientIsValid ? true : undefined}
            onBlur={() => setTouchedRecipient(true)}
            onChange={(event) => {
              setRecipient(event.target.value);
              if (localError) setLocalError(null);
            }}
            data-testid="recipient"
          />
        </div>

        <div className="actions">
          <button type="button" onClick={() => void propose()} disabled={action.pending}>
            {action.pending ? "Submitting…" : "Propose handoff"}
          </button>
          <button type="button" onClick={() => void accept()} disabled={action.pending}>
            Accept handoff
          </button>
          <button type="button" className="secondary" onClick={() => void cancel()} disabled={action.pending}>
            Cancel handoff
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
              <strong>Transaction confirmed</strong>
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
