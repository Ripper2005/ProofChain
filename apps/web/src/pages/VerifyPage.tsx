import {
  agreementSummary,
  attemptText,
  checkText,
  readerStatusText,
  SEAL_RULE,
  verifyBatch,
  type DocumentReport,
  type RegisteredOutcome,
  type SealConditions,
  type StorageProofReport,
  type TimelineStep,
  type VerificationResult,
} from "@proofchain/verifier";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useParams } from "react-router-dom";
import { getAddress, isAddress, keccak256, toBytes, type Hex } from "viem";
import { AddressChip } from "../components/AddressChip.tsx";
import { CodeSnippet } from "../components/CodeSnippet.tsx";
import { Row, Rows } from "../components/Rows.tsx";
import { ipfsGateways, isSameOriginRpc, readerUrls, trustedDeployments, type Trust } from "../lib/deployments.ts";
import { ipfsFileUrl } from "../lib/document.ts";
import { DOCUMENT_UNAVAILABLE, READER_FAILURE } from "../lib/failures.ts";
import { formatUnix, parseChainId } from "../lib/format.ts";

export function VerifyPage() {
  const params = useParams();
  const chainId = parseChainId(params.chainId ?? "");
  const rawAddress = params.contractAddress ?? "";
  const batchCode = params.batchCode ?? "";
  const addressOk = isAddress(rawAddress, { strict: false });
  const contract = addressOk ? getAddress(rawAddress.toLowerCase()) : null;

  const query = useQuery({
    queryKey: ["verify", chainId, contract, batchCode],
    enabled: chainId !== null && contract !== null && batchCode.length > 0,
    queryFn: () =>
      verifyBatch({
        chainId: chainId!,
        contract: contract!,
        batchCode,
        deployments: trustedDeployments(),
        readers: readerUrls(chainId!),
        gateways: ipfsGateways(),
        fetch: (url, init) => fetch(url, init),
      }),
  });

  if (chainId === null) {
    return (
      <section className="card">
        <h1>Verification</h1>
        <p>The chain id in this URL is not a decimal number.</p>
      </section>
    );
  }
  if (!contract) {
    return (
      <section className="card">
        <h1>Verification</h1>
        <p>The contract address in this URL is not an Ethereum address.</p>
      </section>
    );
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Verification</h1>
          <p className="muted">
            Batch <span className="pill mono">{batchCode}</span> on chain {chainId}
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {query.isPending ? (
        <section className="card stack-sm" aria-busy="true">
          <p>Asking every reader this site lists for chain {chainId}…</p>
          <progress aria-label="Loading verification record" />
        </section>
      ) : null}

      {query.isError ? (
        <p className="revert" role="alert">
          {READER_FAILURE}
        </p>
      ) : null}

      {query.data ? <ResultView result={query.data} /> : null}
    </div>
  );
}

function ResultView({ result }: { result: VerificationResult }) {
  const { outcome } = result;
  switch (outcome.kind) {
    case "invalid-address":
      return <p className="card">The contract address in this URL is not an Ethereum address.</p>;
    case "invalid-code":
      return (
        <p className="card">This batch code is not valid, so there is no contract id to read. Case is significant.</p>
      );
    case "no-reader":
    case "cannot-read":
      return (
        <div className="stack">
          <section className="card stack-sm">
            <p data-testid="cannot-read-chain">This site cannot read chain {result.chainId}.</p>
            <p className="muted">
              {outcome.kind === "no-reader"
                ? "This site lists no reader for that chain."
                : "None of this site's readers reports that chain id."}
            </p>
          </section>
          {result.readers.length > 0 ? <AgreementPanel result={result} /> : null}
        </div>
      );
    case "unreachable":
      return (
        <div className="stack">
          <p className="revert" role="alert" data-testid="readers-unreachable">
            {READER_FAILURE}
          </p>
          <AgreementPanel result={result} />
        </div>
      );
    case "not-registered":
      return (
        <div className="stack">
          <TrustBanner trust={result.trust} />
          <section className="card stack-sm">
            <p data-testid="not-registered">No batch with code {result.batchCode} is registered on this contract.</p>
            <p className="revert mono" data-testid="raw-read">
              {outcome.errorText}
            </p>
          </section>
          <AgreementPanel result={result} />
          <ReaderNote result={result} />
        </div>
      );
    case "registered":
      return <RegisteredView result={result} outcome={outcome} />;
  }
}

function RegisteredView({ result, outcome }: { result: VerificationResult; outcome: RegisteredOutcome }) {
  const { batch, document } = outcome;
  const onChainText = document.onChain.status === "read" ? document.onChain.judgement.text : null;
  const isRecalled = batch.status === "recalled";
  const statusCardClass =
    document.verdict === "mismatch" || isRecalled
      ? "card card-alert stack"
      : result.seal.green
        ? "card card-match stack"
        : "card stack";

  return (
    <div className="stack">
      <TrustBanner trust={result.trust} />

      <section className={statusCardClass}>
        <div className="actions" data-testid="status-line">
          {isRecalled ? (
            <span className="seal seal-alert" data-testid="recalled-seal">
              ! On-chain record recalled
            </span>
          ) : (
            <span className="seal seal-neutral" data-testid="status-active">
              ● {batch.status === "active" ? "Active" : "None"}
            </span>
          )}
          {outcome.pending ? <span className="seal seal-warn">◷ Handoff awaiting acceptance</span> : null}
          {result.seal.green ? (
            <span className="seal seal-match" data-testid="green-seal">
              ✓ Digital record matches
            </span>
          ) : null}
          {document.verdict === "mismatch" ? (
            <span className="seal seal-alert" data-testid="mismatch-seal">
              × Document mismatch
            </span>
          ) : null}
        </div>

        {isRecalled && outcome.recall ? (
          <div className="revert stack-sm">
            <p>
              <strong>Batch frozen on-chain.</strong>{" "}
              {outcome.recall.reason.length > 0
                ? `Reason: "${outcome.recall.reason}".`
                : "No reason was recorded."}
            </p>
            {outcome.recall.recalledBy ? (
              <p>
                Recalled by <AddressChip address={outcome.recall.recalledBy} />
              </p>
            ) : null}
          </div>
        ) : null}

        <SealRule seal={result.seal} />
      </section>

      <section className="card stack">
        <div className="card-header">
          <h2>Batch &amp; product summary</h2>
          <span className="pill">
            {result.agreement.holds
              ? `${result.agreement.agreeing}/${result.agreement.configured} readers agree`
              : "Reader agreement missing"}
          </span>
        </div>

        <Rows>
          <Row label="Batch code">
            <span className="mono">{batch.batchCode}</span>
          </Row>
          <Row label="Status">
            {isRecalled ? "Recalled" : batch.status === "active" ? "Active" : "None"}
          </Row>
          <Row label="Current custodian">
            <span data-testid="current-custodian">
              <AddressChip address={batch.currentCustodian} />
            </span>
          </Row>
          {document.document ? (
            <>
              <Row label="Product name">{document.document.name}</Row>
              <Row label="SKU">
                <span className="mono">{document.document.sku}</span>
              </Row>
              <Row label="Quantity">{document.document.quantity}</Row>
              <Row label="Production date">{document.document.productionDate}</Row>
              <Row label="Name in document">
                <span>
                  {document.document.manufacturerName}{" "}
                  <span className="muted">(self-reported claim in document)</span>
                </span>
              </Row>
              <Row label="Description">{document.document.description || "None"}</Row>
            </>
          ) : null}
          <Row label="Registering wallet">
            <span>
              <AddressChip address={batch.manufacturer} />{" "}
              <span className="muted">
                (manufacturer role:{" "}
                {outcome.manufacturerRole === null
                  ? "could not be read"
                  : outcome.manufacturerRole
                    ? "held"
                    : "not held"}
                )
              </span>
            </span>
          </Row>
          <Row label="Registered at">{formatUnix(batch.createdAt)}</Row>
        </Rows>

        <details className="disclosure">
          <summary>Commitments, CID &amp; registration transaction</summary>
          <div className="disclosure-body">
            <Rows>
              <Row label="Registration transaction">
                <Tx hash={outcome.registration?.txHash ?? null} chainId={result.chainId} />
              </Row>
              <Row label="Metadata hash">
                <span className="mono">{batch.metadataHash}</span>
              </Row>
              <Row label="Metadata CID">
                <span className="mono">{batch.metadataCid}</span>
              </Row>
            </Rows>
          </div>
        </details>
      </section>

      <AgreementPanel result={result} />
      <StorageProofPanel proof={outcome.storageProof} anchor={result.agreement.anchor} />

      <section className="card stack">
        <h2>Custody timeline</h2>
        <p className="muted">
          Oldest first.{" "}
          {outcome.logs.status === "loaded"
            ? `Reconstructed from the logs of ${outcome.logs.reader}.`
            : "From contract state only, because no agreeing reader returned the logs. Transaction hashes are unavailable."}
        </p>
        <ol className="timeline" data-testid="custody-history">
          {outcome.timeline.map((step, index) => (
            <TimelineItem key={`${step.kind}-${index}`} step={step} chainId={result.chainId} />
          ))}
        </ol>
        {outcome.historyDisagrees ? (
          <p className="warning" data-testid="history-disagreement">
            The on-chain custody array and the CustodyTransferred logs disagree in count or order. The contract array is
            the custody record. Transaction hashes are not paired with it.
          </p>
        ) : null}
      </section>

      <DocumentSection document={document} chainId={result.chainId} />

      <TamperSimulation
        key={`${batch.metadataHash}:${onChainText === null ? "none" : "text"}`}
        original={onChainText}
        unavailableReason={document.onChain.status === "unavailable" ? document.onChain.reason : null}
        metadataHash={batch.metadataHash}
      />

      <section className="card stack-sm" data-testid="pending-handoff">
        <h2>Pending handoff</h2>
        {outcome.pending ? (
          <Rows>
            <Row label="State">
              <span className="pill seal-warn">◷ Handoff awaiting acceptance</span>
            </Row>
            <Row label="From">
              <AddressChip address={outcome.pending.from} />
            </Row>
            <Row label="To">
              <AddressChip address={outcome.pending.to} />
            </Row>
            <Row label="Proposed at">{formatUnix(outcome.pending.proposedAt)}</Row>
            <Row label="Transaction">
              <Tx hash={outcome.pending.txHash} chainId={result.chainId} />
            </Row>
          </Rows>
        ) : (
          <p className="muted">No handoff is pending. Pending is a flag on an active batch, not a third status.</p>
        )}
      </section>

      <section className="card stack-sm" data-testid="recall">
        <h2>Recall</h2>
        {!isRecalled ? <p className="muted">This batch has not been recalled.</p> : null}
        {isRecalled && outcome.recall ? (
          <Rows>
            <Row label="Recalled by">
              {outcome.recall.recalledBy ? <AddressChip address={outcome.recall.recalledBy} /> : "unavailable"}
            </Row>
            <Row label="Reason">
              <span data-testid="recall-reason">
                {outcome.recall.reason.length > 0 ? outcome.recall.reason : "No reason was given."}
              </span>
            </Row>
            <Row label="Pending handoff cleared">{outcome.recall.pendingCleared ? "Yes" : "No"}</Row>
            <Row label="Transaction">
              <Tx hash={outcome.recall.txHash} chainId={result.chainId} />
            </Row>
          </Rows>
        ) : null}
        {isRecalled && !outcome.recall ? (
          <p>The recall reason is unavailable because the logs could not be loaded.</p>
        ) : null}
      </section>

      <p className="notice">
        <strong>Physical packaging note:</strong> Copying this QR onto another box is possible. ProofChain checks the
        recorded story and which wallet signed each step; it does not inspect physical goods.
      </p>

      <ReaderNote result={result} />
    </div>
  );
}

function SealRule({ seal }: { seal: SealConditions }) {
  return (
    <div className="stack-sm" data-testid="seal-rule">
      <p className="muted">{SEAL_RULE}</p>
      <ul className="seal-checks">
        <li className={`pill ${seal.trusted ? "seal-match" : "seal-alert"}`}>
          {seal.trusted ? "✓" : "×"} Recognized deployment: {seal.trusted ? "yes" : "no"}
        </li>
        <li className={`pill ${seal.documentMatch ? "seal-match" : "seal-alert"}`}>
          {seal.documentMatch ? "✓" : "×"} Document match: {seal.documentMatch ? "yes" : "no"}
        </li>
        <li className={`pill ${seal.copyNotMismatch ? "seal-match" : "seal-alert"}`}>
          {seal.copyNotMismatch ? "✓" : "×"} IPFS copy not a mismatch: {seal.copyNotMismatch ? "yes" : "no"}
        </li>
        <li className={`pill ${seal.agreement ? "seal-match" : "seal-alert"}`}>
          {seal.agreement ? "✓" : "×"} Reader agreement: {seal.agreement ? "yes" : "no"}
        </li>
      </ul>
    </div>
  );
}

function AgreementPanel({ result }: { result: VerificationResult }) {
  const onlyLocal =
    result.readers.length === 1 && result.readers[0] !== undefined && isSameOriginRpc(result.readers[0].url);
  return (
    <section className="card stack-sm" data-testid="reader-agreement">
      <div className="card-header">
        <h2>Reader agreement</h2>
        <span className={`pill ${result.agreement.holds ? "seal-match" : "seal-alert"}`}>
          {result.agreement.holds
            ? `✓ ${result.agreement.agreeing}/${result.agreement.configured} agree`
            : "! No agreement"}
        </span>
      </div>
      <p data-testid={result.agreement.holds ? "agreement-holds" : "agreement-missing"}>
        {agreementSummary(result.agreement)}
      </p>
      {onlyLocal ? (
        <p className="muted" data-testid="single-reader-note">
          On the local stack there is one reader, this computer&apos;s /rpc proxy to the Anvil node. One reader cannot
          show that another node would answer the same.
        </p>
      ) : null}
      <details className="disclosure">
        <summary>Inspect reader endpoints ({result.readers.length})</summary>
        <div className="disclosure-body">
          <ul className="check-list">
            {result.readers.map((report) => (
              <li key={report.url} data-testid={`reader-${report.status}`}>
                <span className="mono">{report.url}</span>: {readerStatusText(report)}
                {report.status === "disagrees" && report.answer.length > 0 ? (
                  <ul className="check-list">
                    {report.answer.map((line) => (
                      <li key={line} className="mono">
                        answered {line}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="muted">
            Each reader is one company&apos;s node. Agreement at one block makes a single lying or broken provider
            visible. It is not proof.
          </p>
        </div>
      </details>
    </section>
  );
}

function StorageProofPanel({ proof, anchor }: { proof: StorageProofReport; anchor: bigint | null }) {
  const label = {
    verified: "Verified: the account and both storage proofs match the agreed contract read.",
    mismatch: "The proofs are valid, but the storage values do not match the contract read.",
    invalid: "The storage proof is invalid and was rejected.",
    unavailable: "A storage proof could not be checked.",
  }[proof.status];
  const badgeClass =
    proof.status === "verified" ? "seal-match" : proof.status === "unavailable" ? "" : "seal-alert";
  const badgeIcon = proof.status === "verified" ? "✓" : proof.status === "unavailable" ? "—" : "!";

  return (
    <section className="card stack-sm" data-testid="storage-proof">
      <div className="card-header">
        <h2>Storage proof (additional check)</h2>
        <span className={`pill ${badgeClass}`}>
          {badgeIcon} {proof.status}
        </span>
      </div>
      <p data-testid={`storage-proof-${proof.status}`}>{label}</p>
      <p className="muted">
        This optional EIP-1186 check verifies against the readers&apos; agreed state root; it is not a consensus light
        client and does not change the green seal.
      </p>
      <details className="disclosure">
        <summary>Inspect anchor state root &amp; storage slots</summary>
        <div className="disclosure-body">
          <Rows>
            {proof.reader ? (
              <Row label="Proof reader">
                <span className="mono">{proof.reader}</span>
              </Row>
            ) : null}
            {anchor !== null ? <Row label="Anchor block">{anchor.toString()}</Row> : null}
            <Row label="Anchor state root">
              <span className="mono">{proof.stateRoot}</span>
            </Row>
            <Row label="Custodian slot">
              <span className="mono">{proof.custodianSlot}</span>
              <br />
              Proven value: <span className="mono">{proof.custodian ?? "unavailable"}</span> (
              {proof.custodianMatches === true
                ? "matches"
                : proof.custodianMatches === false
                  ? "does not match"
                  : "not checked"}
              )
            </Row>
            <Row label="Status slot">
              <span className="mono">{proof.statusSlot}</span>
              <br />
              Proven status: {proof.provenStatus === null ? "unavailable" : proof.provenStatus} (
              {proof.statusMatches === true
                ? "matches"
                : proof.statusMatches === false
                  ? "does not match"
                  : "not checked"}
              )
            </Row>
          </Rows>
          {proof.detail ? (
            <p className={proof.status === "invalid" || proof.status === "mismatch" ? "warning" : "muted"}>
              {proof.detail}
            </p>
          ) : null}
        </div>
      </details>
    </section>
  );
}

function TimelineItem({ step, chainId }: { step: TimelineStep; chainId: number }) {
  const cls =
    step.kind === "pending"
      ? "timeline-step timeline-open"
      : step.kind === "recalled"
        ? "timeline-step timeline-recalled"
        : step.kind === "accepted"
          ? "timeline-step timeline-accepted"
          : "timeline-step";

  return (
    <li
      data-step={step.kind}
      className={cls}
      data-testid={step.kind === "pending" ? "timeline-open" : undefined}
    >
      <div>
        {step.kind === "pending" ? <strong>Handoff awaiting acceptance: </strong> : null}
        <TimelineCopy step={step} />
      </div>
      <div className="timeline-meta">
        <span>
          {step.time === null ? "time unavailable" : formatUnix(step.time)} •{" "}
          {step.blockNumber === null ? "block unavailable" : `block ${step.blockNumber}`}
        </span>
        <Tx hash={step.txHash} chainId={chainId} />
      </div>
    </li>
  );
}

function TimelineCopy({ step }: { step: TimelineStep }) {
  switch (step.kind) {
    case "registered":
      return (
        <>
          Registered by <AddressChip address={step.manufacturer} />
        </>
      );
    case "proposed":
      return (
        <>
          Handoff proposed from <AddressChip address={step.from} /> to <AddressChip address={step.to} />
        </>
      );
    case "cancelled":
      return (
        <>
          Handoff from <AddressChip address={step.from} /> to <AddressChip address={step.to} /> cancelled
        </>
      );
    case "accepted":
      return (
        <>
          Handoff accepted: custody moved from <AddressChip address={step.from} /> to <AddressChip address={step.to} />
        </>
      );
    case "recalled":
      return (
        <>
          On-chain record recalled
          {step.recalledBy ? (
            <>
              {" "}
              by <AddressChip address={step.recalledBy} />
            </>
          ) : null}
          {recallDetail(step)}
        </>
      );
    case "pending":
      return (
        <>
          Proposed by <AddressChip address={step.from} /> — awaiting acceptance by <AddressChip address={step.to} />
        </>
      );
  }
}

function recallDetail(step: Extract<TimelineStep, { kind: "recalled" }>): string {
  const reason =
    step.reason === null
      ? ", reason unavailable because the logs could not be loaded"
      : step.reason.length > 0
        ? `, reason "${step.reason}"`
        : ", no reason given";
  return `${reason}${step.pendingCleared ? ", pending handoff cleared" : ""}`;
}

function TamperSimulation({
  original,
  unavailableReason,
  metadataHash,
}: {
  original: string | null;
  unavailableReason: string | null;
  metadataHash: Hex;
}) {
  const editorId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState(original ?? "");
  const editedHash = original === null ? null : keccak256(toBytes(draft));
  const matches = editedHash !== null && editedHash.toLowerCase() === metadataHash.toLowerCase();

  return (
    <section className="card stack-sm" data-testid="tamper-simulation">
      <h2>What would tampering look like?</h2>
      <p id={hintId} className="muted">
        Local browser simulation only — editing this JSON changes nothing on Ethereum or IPFS. Try altering a value
        (such as changing quantity from 50 to 500) to see the hash commitment break.
      </p>
      {original === null || editedHash === null ? (
        <p data-testid="tamper-unavailable">
          {unavailableReason
            ? `The on-chain document is unavailable, because ${unavailableReason}. There is no original text to edit.`
            : "The on-chain document is not UTF-8 text. There is no original text to edit."}
        </p>
      ) : (
        <>
          <div className="field">
            <label className="field-label" htmlFor={editorId}>
              On-chain document text
            </label>
            <textarea
              id={editorId}
              className="tamper-text"
              value={draft}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              aria-describedby={hintId}
              onChange={(event) => setDraft(event.target.value)}
              data-testid="tamper-text"
            />
          </div>
          {matches ? (
            <p className="notice notice-match" data-testid="tamper-match">
              <span className="seal seal-match">✓ Digital record matches</span> keccak256 of the edited bytes equals the
              on-chain commitment.
            </p>
          ) : (
            <p className="revert" role="status" data-testid="tamper-mismatch">
              <strong>× Mismatch:</strong> The edited bytes would not match the on-chain commitment.
            </p>
          )}
          <Rows>
            <Row label="Live keccak256">
              <span className="mono" data-testid="tamper-hash">
                {editedHash}
              </span>
            </Row>
            <Row label="Committed hash">
              <span className="mono">{metadataHash}</span>
            </Row>
          </Rows>
        </>
      )}
    </section>
  );
}

function DocumentSection({ document, chainId }: { document: DocumentReport; chainId: number }) {
  const verdictPillClass =
    document.verdict === "match" ? "seal-match" : document.verdict === "mismatch" ? "seal-alert" : "seal-warn";
  const verdictIcon = document.verdict === "match" ? "✓" : document.verdict === "mismatch" ? "×" : "—";

  return (
    <section className="card stack-sm" data-testid="product-document">
      <div className="card-header">
        <h2>Product document</h2>
        <span className={`pill ${verdictPillClass}`} data-testid={`document-${document.verdict}`}>
          {verdictIcon}{" "}
          {document.verdict === "match"
            ? "Match"
            : document.verdict === "mismatch"
              ? "Mismatch"
              : "Unavailable"}
        </span>
      </div>
      <p>
        Document verdict:{" "}
        {document.verdict === "match"
          ? "Match"
          : document.verdict === "mismatch"
            ? "Mismatch"
            : "Unavailable"}
        {document.source === "on-chain"
          ? ", from the on-chain document."
          : document.source === "ipfs"
            ? ", from the IPFS copy."
            : "."}
      </p>
      <p className="muted">
        On-chain log: {document.onChain.status === "read" ? "read" : "unavailable"} • IPFS copy ({document.ipfs.cid}):{" "}
        {document.ipfs.status}.
      </p>
      {document.verdict === "unavailable" ? <p data-testid="document-unavailable">{DOCUMENT_UNAVAILABLE}</p> : null}
      {document.reason ? <p>{document.reason}</p> : null}

      {document.document?.imageCid ? <OptionalFile cid={document.document.imageCid} /> : null}

      <details className="disclosure">
        <summary>Inspect on-chain document &amp; IPFS copy checks</summary>
        <div className="disclosure-body">
          <h3>On-chain document</h3>
          {document.onChain.status === "read" ? (
            <>
              <p>
                From the <span className="mono">BatchRegistered</span> log in transaction{" "}
                <Tx hash={document.onChain.txHash} chainId={chainId} />.
              </p>
              <ul className="check-list mono" data-testid="onchain-checks">
                {document.onChain.judgement.checks.map((check) => (
                  <li key={check.id}>{checkText(check)}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>Unavailable, because {document.onChain.reason}.</p>
          )}

          <h3>IPFS copy</h3>
          <p>
            CID <span className="mono">{document.ipfs.cid}</span>: {document.ipfs.status}.
          </p>
          {document.ipfs.attempts.length === 0 ? <p>No gateway is configured.</p> : null}
          <ul className="check-list mono" data-testid="ipfs-attempts">
            {document.ipfs.attempts.map((attempt) => (
              <li key={attempt.url}>{attemptText(attempt)}</li>
            ))}
          </ul>
          {document.standIn ? (
            <>
              <p>The IPFS copy stands in for the on-chain document:</p>
              <ul className="check-list mono">
                {document.standIn.checks.map((check) => (
                  <li key={check.id}>{checkText(check)}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </details>
    </section>
  );
}

function TrustBanner({ trust }: { trust: Trust }) {
  if (trust.kind === "unrecognized") {
    return (
      <div className="revert stack-sm" role="alert" data-testid="unrecognized-warning">
        <p>
          <strong>! Unrecognized deployment — no green seal.</strong>
        </p>
        <p>The readings below are raw contract reads. A lookalike contract can store its own matching hash.</p>
      </div>
    );
  }
  if (trust.kind === "earlier") {
    return (
      <div className="notice stack-sm" data-testid="earlier-contract">
        <p>This is an earlier recognized contract ({trust.label}).</p>
        {trust.current ? (
          <p>
            The current contract on chain {trust.current.chainId} is <AddressChip address={trust.current.address} /> (
            {trust.current.label}).
          </p>
        ) : (
          <p>No single deployment on this chain is marked current in trusted-deployments.json.</p>
        )}
      </div>
    );
  }
  return (
    <p className="notice" data-testid="current-deployment">
      ✓ Recognized deployment: <strong>{trust.label}</strong>, the current contract on this chain.
    </p>
  );
}

function ReaderNote({ result }: { result: VerificationResult }) {
  return (
    <section className="card stack-sm" data-testid="check-it-yourself">
      <h2>Check it yourself</h2>
      <p className="muted">
        You do not need this website to trust the record. Replace <span className="mono">&lt;YOUR_NODE_URL&gt;</span>{" "}
        with any Ethereum RPC endpoint you control.
      </p>
      {result.chainId === 11155111 ? (
        <p>
          <a href={`https://sepolia.etherscan.io/address/${result.contract}`} target="_blank" rel="noreferrer">
            Inspect contract on Sepolia Etherscan
          </a>
        </p>
      ) : (
        <p className="muted">On this computer, the local Anvil node is http://127.0.0.1:8545.</p>
      )}
      {result.cast ? <CodeSnippet label="Direct contract read (Foundry cast)" code={result.cast} /> : null}
      <CodeSnippet
        label="Independent CLI verifier"
        code={`pnpm verify-batch ${window.location.href} --rpc <YOUR_NODE_URL>`}
        testId="verify-cli"
      />
    </section>
  );
}

function Tx({ hash, chainId }: { hash: Hex | null; chainId: number }) {
  if (!hash) return <span>unavailable</span>;
  if (chainId === 11155111) {
    return (
      <a className="mono" href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">
        {hash}
      </a>
    );
  }
  return <span className="mono">{hash}</span>;
}

function OptionalFile({ cid }: { cid: string }) {
  const [failed, setFailed] = useState(false);
  const url = ipfsFileUrl(cid);
  return (
    <div className="stack-sm">
      <p>
        <a href={url} target="_blank" rel="noreferrer">
          Open attached optional file
        </a>
      </p>
      {failed ? (
        <p className="muted">The optional file did not load. That does not change the document hash.</p>
      ) : (
        <img
          className="attachment-img"
          src={url}
          alt="Optional file attached to the product document"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
