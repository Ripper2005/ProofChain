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
import { useState } from "react";
import { useParams } from "react-router-dom";
import { getAddress, isAddress, keccak256, toBytes, type Hex } from "viem";
import { AddressChip } from "../components/AddressChip.tsx";
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
      <>
        <h1>Verification</h1>
        <p>The chain id in this URL is not a decimal number.</p>
      </>
    );
  }
  if (!contract) {
    return (
      <>
        <h1>Verification</h1>
        <p>The contract address in this URL is not an Ethereum address.</p>
      </>
    );
  }

  return (
    <>
      <h1>Verification</h1>
      <p>Batch code {batchCode}</p>
      <button type="button" className="secondary" onClick={() => void query.refetch()}>
        Refresh
      </button>
      {query.isPending ? <p>Asking every reader this site lists for chain {chainId}.</p> : null}
      {query.isError ? (
        <p className="revert" role="alert">
          {READER_FAILURE}
        </p>
      ) : null}
      {query.data ? <ResultView result={query.data} /> : null}
    </>
  );
}

function ResultView({ result }: { result: VerificationResult }) {
  const { outcome } = result;
  switch (outcome.kind) {
    case "invalid-address":
      return <p>The contract address in this URL is not an Ethereum address.</p>;
    case "invalid-code":
      return <p>This batch code is not valid, so there is no contract id to read. Case is significant.</p>;
    case "no-reader":
    case "cannot-read":
      return (
        <div>
          <p data-testid="cannot-read-chain">This site cannot read chain {result.chainId}.</p>
          <p>
            {outcome.kind === "no-reader"
              ? "This site lists no reader for that chain."
              : "None of this site's readers reports that chain id."}
          </p>
          {result.readers.length > 0 ? <AgreementPanel result={result} /> : null}
        </div>
      );
    case "unreachable":
      return (
        <div>
          <p className="revert" role="alert" data-testid="readers-unreachable">
            {READER_FAILURE}
          </p>
          <AgreementPanel result={result} />
        </div>
      );
    case "not-registered":
      return (
        <div>
          <TrustBanner trust={result.trust} />
          <p data-testid="not-registered">
            No batch with code {result.batchCode} is registered on this contract.
          </p>
          <p className="revert mono" data-testid="raw-read">
            {outcome.errorText}
          </p>
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
  return (
    <div>
      <TrustBanner trust={result.trust} />
      <div className="actions" data-testid="status-line">
        {batch.status === "recalled" ? (
          <span className="seal seal-alert" data-testid="recalled-seal">
            Recalled
          </span>
        ) : (
          <span data-testid="status-active">{batch.status === "active" ? "Active" : "None"}</span>
        )}
        {outcome.pending ? <span>Handoff pending</span> : null}
        {result.seal.green ? (
          <span className="seal seal-match" data-testid="green-seal">
            Match
          </span>
        ) : null}
        {document.verdict === "mismatch" ? (
          <span className="seal seal-alert" data-testid="mismatch-seal">
            Mismatch
          </span>
        ) : null}
      </div>
      <SealRule seal={result.seal} />

      <h2>Batch</h2>
      <Rows>
        <Row label="Batch code">
          <span className="mono">{batch.batchCode}</span>
        </Row>
        <Row label="Status">{batch.status === "recalled" ? "Recalled" : batch.status === "active" ? "Active" : "None"}</Row>
        <Row label="Registering wallet">
          <AddressChip address={batch.manufacturer} />
        </Row>
        <Row label="Manufacturer role">
          {outcome.manufacturerRole === null ? "could not be read" : outcome.manufacturerRole ? "held" : "not held"}
        </Row>
        <Row label="Current custodian">
          <span data-testid="current-custodian">
            <AddressChip address={batch.currentCustodian} />
          </span>
        </Row>
        <Row label="Registered at">{formatUnix(batch.createdAt)}</Row>
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

      <AgreementPanel result={result} />
      <StorageProofPanel proof={outcome.storageProof} anchor={result.agreement.anchor} />

      <h2>Custody timeline</h2>
      <p className="muted">
        Oldest first.{" "}
        {outcome.logs.status === "loaded"
          ? `From the logs of ${outcome.logs.reader}.`
          : "From contract state only, because no agreeing reader returned the logs. Transaction hashes are unavailable."}
      </p>
      <ol data-testid="custody-history">
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

      <DocumentSection document={document} chainId={result.chainId} />

      <TamperSimulation
        key={`${batch.metadataHash}:${onChainText === null ? "none" : "text"}`}
        original={onChainText}
        unavailableReason={document.onChain.status === "unavailable" ? document.onChain.reason : null}
        metadataHash={batch.metadataHash}
      />

      <section data-testid="pending-handoff">
        <h2>Pending handoff</h2>
        {outcome.pending ? (
          <Rows>
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
          <p>No handoff is pending. Pending is a flag on an active batch, not a third status.</p>
        )}
      </section>

      <section data-testid="recall">
        <h2>Recall</h2>
        {batch.status !== "recalled" ? <p>This batch has not been recalled.</p> : null}
        {batch.status === "recalled" && outcome.recall ? (
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
        {batch.status === "recalled" && !outcome.recall ? (
          <p>The recall reason is unavailable because the logs could not be loaded.</p>
        ) : null}
      </section>

      <p>Copying this QR onto another box is possible. ProofChain checks the recorded story and which wallet signed it.</p>
      <ReaderNote result={result} />
    </div>
  );
}

function SealRule({ seal }: { seal: SealConditions }) {
  return (
    <div data-testid="seal-rule">
      <p>{SEAL_RULE}</p>
      <ul className="muted">
        <li>Recognized deployment: {seal.trusted ? "yes" : "no"}</li>
        <li>Document match: {seal.documentMatch ? "yes" : "no"}</li>
        <li>IPFS copy is not a mismatch: {seal.copyNotMismatch ? "yes" : "no"}</li>
        <li>Reader agreement: {seal.agreement ? "yes" : "no"}</li>
      </ul>
    </div>
  );
}

function AgreementPanel({ result }: { result: VerificationResult }) {
  const onlyLocal = result.readers.length === 1 && result.readers[0] !== undefined && isSameOriginRpc(result.readers[0].url);
  return (
    <section data-testid="reader-agreement">
      <h2>Reader agreement</h2>
      <p data-testid={result.agreement.holds ? "agreement-holds" : "agreement-missing"}>
        {agreementSummary(result.agreement)}
      </p>
      {onlyLocal ? (
        <p className="muted" data-testid="single-reader-note">
          On the local stack there is one reader, this computer&apos;s /rpc proxy to the Anvil node. One reader cannot show
          that another node would answer the same.
        </p>
      ) : null}
      <ul>
        {result.readers.map((report) => (
          <li key={report.url} data-testid={`reader-${report.status}`}>
            <span className="mono">{report.url}</span>: {readerStatusText(report)}
            {report.status === "disagrees" && report.answer.length > 0 ? (
              <ul>
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
        Each reader is one company&apos;s node. Agreement at one block makes a single lying or broken provider visible. It
        is not proof.
      </p>
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
  return (
    <section data-testid="storage-proof">
      <h2>Storage proof (additional check)</h2>
      <p data-testid={`storage-proof-${proof.status}`}>{label}</p>
      {proof.reader ? (
        <p>
          Proof reader: <span className="mono">{proof.reader}</span>
        </p>
      ) : null}
      {anchor !== null ? <p>Anchor block: {anchor}</p> : null}
      <Rows>
        <Row label="Anchor state root"><span className="mono">{proof.stateRoot}</span></Row>
        <Row label="Custodian slot">
          <span className="mono">{proof.custodianSlot}</span>
          <br />
          Proven value: {proof.custodian ?? "unavailable"} (
          {proof.custodianMatches === true ? "matches" : proof.custodianMatches === false ? "does not match" : "not checked"})
        </Row>
        <Row label="Status slot">
          <span className="mono">{proof.statusSlot}</span>
          <br />
          Proven status: {proof.provenStatus === null ? "unavailable" : proof.provenStatus} (
          {proof.statusMatches === true ? "matches" : proof.statusMatches === false ? "does not match" : "not checked"})
        </Row>
      </Rows>
      {proof.detail ? (
        <p className={proof.status === "invalid" || proof.status === "mismatch" ? "warning" : "muted"}>
          {proof.detail}
        </p>
      ) : null}
      <p className="muted">This optional cryptographic check is separate from the green seal and does not affect it.</p>
    </section>
  );
}

function TimelineItem({ step, chainId }: { step: TimelineStep; chainId: number }) {
  return (
    <li data-step={step.kind} className={step.kind === "pending" ? "timeline-open" : undefined} data-testid={step.kind === "pending" ? "timeline-open" : undefined}>
      {step.kind === "pending" ? <strong>Open step. </strong> : null}
      <TimelineCopy step={step} />
      <br />
      <span className="muted">
        {step.time === null ? "time unavailable" : formatUnix(step.time)},{" "}
        {step.blockNumber === null ? "block unavailable" : `block ${step.blockNumber}`},{" "}
      </span>
      <Tx hash={step.txHash} chainId={chainId} />
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
          Recalled
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
          Open: the handoff from <AddressChip address={step.from} /> waits for <AddressChip address={step.to} /> to accept
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
  const [draft, setDraft] = useState(original ?? "");
  const editedHash = original === null ? null : keccak256(toBytes(draft));
  const matches = editedHash !== null && editedHash.toLowerCase() === metadataHash.toLowerCase();
  return (
    <section data-testid="tamper-simulation">
      <h2>What would tampering look like?</h2>
      <p>This edit stays in this browser. It changes nothing on the chain or on IPFS.</p>
      {original === null || editedHash === null ? (
        <p data-testid="tamper-unavailable">
          {unavailableReason
            ? `The on-chain document is unavailable, because ${unavailableReason}. There is no original text to edit.`
            : "The on-chain document is not UTF-8 text. There is no original text to edit."}
        </p>
      ) : (
        <>
          <label className="field">
            <span>On-chain document text</span>
            <textarea
              className="tamper-text"
              value={draft}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setDraft(event.target.value)}
              data-testid="tamper-text"
            />
          </label>
          {matches ? (
            <p data-testid="tamper-match">
              <span className="seal seal-match">Match</span> keccak256 of the bytes equals the metadata hash.
            </p>
          ) : (
            <p className="revert" data-testid="tamper-mismatch">
              The edited bytes would not match the commitment.
            </p>
          )}
          <p className="mono" data-testid="tamper-hash">
            {editedHash}
          </p>
        </>
      )}
    </section>
  );
}

function DocumentSection({ document, chainId }: { document: DocumentReport; chainId: number }) {
  return (
    <section data-testid="product-document">
      <h2>Product document</h2>
      <p data-testid={`document-${document.verdict}`}>
        Document verdict: {document.verdict === "match" ? "Match" : document.verdict === "mismatch" ? "Mismatch" : "Unavailable"}
        {document.source === "on-chain" ? ", from the on-chain document." : document.source === "ipfs" ? ", from the IPFS copy." : "."}
      </p>
      {document.verdict === "unavailable" ? <p data-testid="document-unavailable">{DOCUMENT_UNAVAILABLE}</p> : null}
      {document.reason ? <p>{document.reason}</p> : null}

      <h3>On-chain document</h3>
      {document.onChain.status === "read" ? (
        <>
          <p>
            From the BatchRegistered log in transaction <Tx hash={document.onChain.txHash} chainId={chainId} />.
          </p>
          <ul className="mono" data-testid="onchain-checks">
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
      <ul className="mono" data-testid="ipfs-attempts">
        {document.ipfs.attempts.map((attempt) => (
          <li key={attempt.url}>{attemptText(attempt)}</li>
        ))}
      </ul>
      {document.standIn ? (
        <>
          <p>The IPFS copy stands in for the on-chain document:</p>
          <ul className="mono">
            {document.standIn.checks.map((check) => (
              <li key={check.id}>{checkText(check)}</li>
            ))}
          </ul>
        </>
      ) : null}

      {document.document ? (
        <>
          <Rows>
            <Row label="Product name">{document.document.name}</Row>
            <Row label="SKU">
              <span className="mono">{document.document.sku}</span>
            </Row>
            <Row label="Quantity">{document.document.quantity}</Row>
            <Row label="Production date">{document.document.productionDate}</Row>
            <Row label="Company name claimed in the document">{document.document.manufacturerName}</Row>
            <Row label="Description">{document.document.description || "None"}</Row>
          </Rows>
          {document.document.imageCid ? <OptionalFile cid={document.document.imageCid} /> : null}
        </>
      ) : null}
    </section>
  );
}

function TrustBanner({ trust }: { trust: Trust }) {
  if (trust.kind === "unrecognized") {
    return (
      <div className="warning" data-testid="unrecognized-warning">
        <p>This is not a recognized deployment. There is no green seal.</p>
        <p>The readings below are raw contract reads. A lookalike contract can store its own matching hash.</p>
      </div>
    );
  }
  if (trust.kind === "earlier") {
    return (
      <div className="notice" data-testid="earlier-contract">
        <p>This is an earlier contract ({trust.label}).</p>
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
  return <p data-testid="current-deployment">Recognized deployment: {trust.label}, the current contract on this chain.</p>;
}

function ReaderNote({ result }: { result: VerificationResult }) {
  return (
    <section data-testid="check-it-yourself">
      <h2>Check it yourself</h2>
      <p>This page read the contract through the readers listed above.</p>
      {result.chainId === 11155111 ? (
        <p>
          <a href={`https://sepolia.etherscan.io/address/${result.contract}`}>Contract on the Sepolia explorer</a>
        </p>
      ) : (
        <p>On this computer the Anvil node is http://127.0.0.1:8545.</p>
      )}
      <p>Replace &lt;YOUR_NODE_URL&gt; with a node you choose.</p>
      {result.cast ? <pre className="cast">{result.cast}</pre> : null}
      <pre className="cast" data-testid="verify-cli">
        {`pnpm verify-batch ${window.location.href} --rpc <YOUR_NODE_URL>`}
      </pre>
    </section>
  );
}

function Tx({ hash, chainId }: { hash: Hex | null; chainId: number }) {
  if (!hash) return <span>unavailable</span>;
  if (chainId === 11155111) {
    return (
      <a className="mono" href={`https://sepolia.etherscan.io/tx/${hash}`}>
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
    <div>
      <p>
        <a href={url}>Open the optional file</a>
      </p>
      {failed ? (
        <p>The optional file did not load. That does not change the document hash.</p>
      ) : (
        <img src={url} alt="Optional file attached to the product document" onError={() => setFailed(true)} />
      )}
    </div>
  );
}
