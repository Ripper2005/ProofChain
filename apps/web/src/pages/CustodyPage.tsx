import { computeBatchId, validateBatchCode } from "@proofchain/metadata";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getAddress, isAddress } from "viem";
import { ConnectButton } from "../components/ConnectButton.tsx";
import { Row, Rows } from "../components/Rows.tsx";
import { SimulationNotice } from "../components/SimulationNotice.tsx";
import { DEMO_DOCUMENT } from "../demo.ts";
import { useSendAction } from "../lib/actions.ts";
import { writeTarget, writeTargetMessage } from "../lib/deployments.ts";
import { formatUnix } from "../lib/format.ts";
import { loadBatch } from "../lib/reader.ts";

export function CustodyPage() {
  const queryClient = useQueryClient();
  const target = writeTarget();
  const current = target.kind === "ready" ? target.deployment : null;
  const action = useSendAction();
  const [batchCode, setBatchCode] = useState<string>(DEMO_DOCUMENT.batchCode);
  const [recipient, setRecipient] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const codeIsValid = validateBatchCode(batchCode);

  const batch = useQuery({
    queryKey: ["custody-batch", current?.chainId, current?.address, batchCode],
    enabled: Boolean(current && codeIsValid),
    queryFn: () => loadBatch(current!.chainId, current!.address, batchCode),
  });

  async function propose() {
    setLocalError(null);
    if (!codeIsValid) {
      setLocalError("Enter a valid batch code. The typed case is kept.");
      return;
    }
    if (!isAddress(recipient)) {
      setLocalError("Enter the wallet that should accept the handoff.");
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
    <>
      <h1>Custody</h1>
      <p>
        The current custodian proposes a handoff. The named wallet accepts it, or the custodian cancels it. Any
        connected wallet can submit a proposal. The contract decides whether that wallet is allowed.
      </p>
      {!current ? (
        <p className="warning" data-testid="write-not-configured">
          {writeTargetMessage(target)}
        </p>
      ) : null}
      <ConnectButton />
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
      {batch.isSuccess ? (
        <Rows>
          <Row label="Status">{batch.data.status === "active" ? "Active" : batch.data.status === "recalled" ? "Recalled" : "None"}</Row>
          <Row label="Custodian">
            <span className="mono" data-testid="current-custodian">
              {batch.data.currentCustodian}
            </span>
          </Row>
          <Row label="Pending handoff">
            {batch.data.pending ? (
              <span>
                <span className="mono">{batch.data.pending.from}</span> to <span className="mono">{batch.data.pending.to}</span> at{" "}
                {formatUnix(batch.data.pending.proposedAt)}
              </span>
            ) : (
              "None"
            )}
          </Row>
        </Rows>
      ) : null}
      {batch.isError ? <p className="muted">{batch.error instanceof Error ? batch.error.message : "The batch could not be read."}</p> : null}

      <label className="field">
        <span>Recipient</span>
        <input
          className="mono"
          value={recipient}
          spellCheck={false}
          autoComplete="off"
          placeholder="0x"
          onChange={(event) => setRecipient(event.target.value)}
          data-testid="recipient"
        />
      </label>
      <div className="actions">
        <button type="button" onClick={() => void propose()} disabled={action.pending}>
          Propose handoff
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
        <p>
          Transaction <span className="mono">{action.txHash}</span>
        </p>
      ) : null}
    </>
  );
}
