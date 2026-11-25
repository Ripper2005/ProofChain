import type { UseQueryResult } from "@tanstack/react-query";
import { AddressChip } from "./AddressChip.tsx";
import { Row, Rows } from "./Rows.tsx";
import { contractErrorText } from "../lib/errors.ts";
import { formatUnix } from "../lib/format.ts";
import type { BatchLookupResult } from "../lib/reader.ts";

export function BatchLookupPanel({
  query,
  codeIsValid,
  chainId,
}: {
  query: UseQueryResult<BatchLookupResult>;
  codeIsValid: boolean;
  chainId: number | null;
}) {
  if (!codeIsValid || chainId === null) {
    return (
      <p className="muted">
        Enter a valid batch code (1–64 characters from A–Z, a–z, 0–9, and hyphen) to inspect its on-chain custody
        state.
      </p>
    );
  }

  if (query.isPending) {
    return <p className="muted">Reading batch state from chain {chainId}…</p>;
  }

  if (query.isError) {
    return (
      <div className="revert" role="alert" data-testid="batch-read-error">
        <p>Could not read batch state from the chain reader.</p>
        <p className="mono">{contractErrorText(query.error)}</p>
      </div>
    );
  }

  if (!query.data) return null;

  if (query.data.kind === "not-registered") {
    return (
      <div className="notice" data-testid="batch-not-registered">
        <p>
          No batch with code <span className="mono">{query.data.batchCode}</span> is registered on this contract yet.
        </p>
        <p className="muted mono">Contract check: {query.data.errorText}</p>
        <p className="muted">
          {chainId === 11155111
            ? "New batches are registered from the local operator console. Enter a registered batch code to manage custody, or view the read-only Sepolia examples from Home."
            : "Register this batch on the Register page first, or enter an already registered batch code."}
        </p>
      </div>
    );
  }

  const { batch } = query.data;
  return (
    <div className="card card-subtle" data-testid="batch-custody-summary">
      <Rows>
        <Row label="Status">
          {batch.status === "recalled" ? (
            <span className="seal seal-alert">! On-chain record recalled</span>
          ) : batch.status === "active" ? (
            <span className="seal seal-match">✓ Active</span>
          ) : (
            <span className="seal seal-neutral">None</span>
          )}
        </Row>
        <Row label="Current custodian">
          <span data-testid="current-custodian">
            <AddressChip address={batch.currentCustodian} />
          </span>
        </Row>
        <Row label="Pending handoff">
          {batch.pending ? (
            <div className="stack-sm">
              <span className="pill seal-warn">Handoff awaiting acceptance</span>
              <span>
                <AddressChip address={batch.pending.from} /> → <AddressChip address={batch.pending.to} /> at{" "}
                {formatUnix(batch.pending.proposedAt)}
              </span>
            </div>
          ) : (
            "None"
          )}
        </Row>
      </Rows>
    </div>
  );
}
