import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { Row, Rows } from "../components/Rows.tsx";
import { ipfsFileUrl } from "../lib/document.ts";
import { DOCUMENT_UNAVAILABLE, READER_FAILURE } from "../lib/failures.ts";
import { formatUnix, parseChainId } from "../lib/format.ts";
import { loadVerification, type Trust, type VerifyResult } from "../lib/reader.ts";

export function VerifyPage() {
  const params = useParams();
  const chainId = parseChainId(params.chainId ?? "");
  const rawAddress = params.contractAddress ?? "";
  const batchCode = params.batchCode ?? "";
  const addressOk = isAddress(rawAddress);
  const contract = addressOk ? getAddress(rawAddress) : null;

  const query = useQuery({
    queryKey: ["verify", chainId, contract, batchCode],
    enabled: chainId !== null && contract !== null && batchCode.length > 0,
    queryFn: () => loadVerification(chainId!, contract!, batchCode),
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
      {query.isPending ? <p>Reading the contract through this site&apos;s reader.</p> : null}
      {query.isError ? (
        <p className="revert" role="alert">
          {READER_FAILURE}
        </p>
      ) : null}
      {query.data ? <ResultView result={query.data} /> : null}
    </>
  );
}

function ResultView({ result }: { result: VerifyResult }) {
  if (result.kind === "cannot-read") {
    return (
      <div>
        <p data-testid="cannot-read-chain">This site cannot read chain {result.chainId}.</p>
        <p>The chain id in the URL does not match the chain this site&apos;s reader is connected to, or this deployment has no reader.</p>
      </div>
    );
  }
  if (result.kind === "rpc-error") {
    return (
      <p className="revert" role="alert">
        {result.message}
      </p>
    );
  }
  if (result.kind === "invalid-code") {
    return <p>This batch code is not valid, so there is no contract id to read. Case is significant.</p>;
  }
  if (result.kind === "absent") {
    return (
      <div>
        <TrustBanner trust={result.trust} />
        <p className="revert" data-testid="raw-read">
          {result.errorText}
        </p>
        <ReaderNote cast={result.cast} chainId={result.chainId} contract={result.contract} />
      </div>
    );
  }
  return <PresentView result={result} />;
}

function PresentView({ result }: { result: Extract<VerifyResult, { kind: "present" }> }) {
  const greenSeal = result.trust.kind !== "unrecognized" && result.verdict === "match";
  return (
    <div>
      <TrustBanner trust={result.trust} />
      <div className="actions">
        {result.status === "recalled" ? (
          <span className="seal seal-alert" data-testid="recalled-seal">
            Recalled
          </span>
        ) : (
          <span data-testid="status-active">Active</span>
        )}
        {result.pending ? <span>Handoff pending</span> : null}
        {greenSeal ? (
          <span className="seal seal-match" data-testid="green-seal">
            Match
          </span>
        ) : null}
        {result.verdict === "mismatch" ? (
          <span className="seal seal-alert" data-testid="mismatch-seal">
            Mismatch
          </span>
        ) : null}
      </div>
      {greenSeal ? (
        <p>This seal covers the document hash on a trusted deployment. Recall status is separate.</p>
      ) : null}
      {result.trust.kind === "unrecognized" && result.verdict === "match" ? (
        <p>The fetched bytes match the hash stored in this contract. There is no green seal.</p>
      ) : null}

      <h2>Batch</h2>
      <Rows>
        <Row label="Batch code">
          <span className="mono">{result.batchCode}</span>
        </Row>
        <Row label="Status">{result.status === "recalled" ? "Recalled" : result.status === "active" ? "Active" : "None"}</Row>
        <Row label="Registering wallet">
          <span className="mono">{result.manufacturer}</span>
        </Row>
        <Row label="Manufacturer role">
          {result.manufacturerRole === null ? "could not be read" : result.manufacturerRole ? "held" : "not held"}
        </Row>
        <Row label="Current custodian">
          <span className="mono" data-testid="current-custodian">
            {result.currentCustodian}
          </span>
        </Row>
        <Row label="Registered at">{formatUnix(result.createdAt)}</Row>
        <Row label="Registration transaction">
          <Tx hash={result.registrationTx} chainId={result.chainId} />
        </Row>
        <Row label="Metadata hash">
          <span className="mono">{result.metadataHash}</span>
        </Row>
        <Row label="Metadata CID">
          <span className="mono">{result.metadataCid}</span>
        </Row>
        {result.fetchedHash ? (
          <Row label="Hash of fetched bytes">
            <span className="mono">{result.fetchedHash}</span>
          </Row>
        ) : null}
      </Rows>
      <p className="muted">Origin is the registering wallet and the registration time. Accepted handoffs are listed below.</p>

      <h2>Product document</h2>
      {result.verdict === "unavailable" ? (
        <p data-testid="document-unavailable">{DOCUMENT_UNAVAILABLE}</p>
      ) : null}
      {result.verdict === "mismatch" ? <p>{result.mismatchReason}</p> : null}
      {result.document ? (
        <>
          <Rows>
            <Row label="Product name">{result.document.name}</Row>
            <Row label="SKU">
              <span className="mono">{result.document.sku}</span>
            </Row>
            <Row label="Quantity">{result.document.quantity}</Row>
            <Row label="Production date">{result.document.productionDate}</Row>
            <Row label="Company name claimed in the document">{result.document.manufacturerName}</Row>
            <Row label="Description">{result.document.description || "None"}</Row>
          </Rows>
          {result.document.imageCid ? <OptionalFile cid={result.document.imageCid} /> : null}
        </>
      ) : null}

      <h2>Pending handoff</h2>
      {result.pending ? (
        <Rows>
          <Row label="From">
            <span className="mono">{result.pending.from}</span>
          </Row>
          <Row label="To">
            <span className="mono">{result.pending.to}</span>
          </Row>
          <Row label="Proposed at">{formatUnix(result.pending.proposedAt)}</Row>
          <Row label="Transaction">
            <Tx hash={result.pending.txHash} chainId={result.chainId} />
          </Row>
        </Rows>
      ) : (
        <p>No handoff is pending. Pending is a flag on an active batch, not a third status.</p>
      )}

      <h2>Accepted handoffs</h2>
      {result.history.length === 0 ? (
        <p data-testid="custody-history">No accepted handoff is recorded.</p>
      ) : (
        <table data-testid="custody-history">
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Accepted at</th>
              <th>Transaction</th>
            </tr>
          </thead>
          <tbody>
            {result.history.map((row, index) => (
              <tr key={`${row.txHash ?? "row"}-${index}`}>
                <td className="mono">{row.from}</td>
                <td className="mono">{row.to}</td>
                <td>{formatUnix(row.timestamp)}</td>
                <td>
                  <Tx hash={row.txHash} chainId={result.chainId} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result.logsUnavailable ? <p>Transaction hashes are unavailable because the logs could not be loaded. Custody above comes from the contract.</p> : null}
      {result.historyDisagrees ? (
        <p className="warning" data-testid="history-disagreement">
          The on-chain custody array and the CustodyTransferred logs disagree in count or order. The contract array is
          the history above.
        </p>
      ) : null}

      <h2>Recall</h2>
      {result.status !== "recalled" ? <p>This batch has not been recalled.</p> : null}
      {result.status === "recalled" && result.recall ? (
        <Rows>
          <Row label="Recalled by">
            <span className="mono">{result.recall.recalledBy}</span>
          </Row>
          <Row label="Reason">
            <span data-testid="recall-reason">{result.recall.reason.length > 0 ? result.recall.reason : "No reason was given."}</span>
          </Row>
          <Row label="Pending handoff cleared">{result.recall.pendingCleared ? "Yes" : "No"}</Row>
          <Row label="Transaction">
            <Tx hash={result.recall.txHash} chainId={result.chainId} />
          </Row>
        </Rows>
      ) : null}
      {result.status === "recalled" && !result.recall ? (
        <p>The recall reason is unavailable because the logs could not be loaded.</p>
      ) : null}

      <ReaderNote cast={result.cast} chainId={result.chainId} contract={result.contract} />
      <p>Copying this QR onto another box is possible. ProofChain checks the recorded story and which wallet signed it.</p>
    </div>
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
            The current contract is <span className="mono">{trust.current.address}</span> on chain {trust.current.chainId} (
            {trust.current.label}).
          </p>
        ) : (
          <p>No deployment is marked current.</p>
        )}
      </div>
    );
  }
  return <p>Recognized deployment: {trust.label}.</p>;
}

function ReaderNote({ cast, chainId, contract }: { cast: string; chainId: number; contract: Address }) {
  return (
    <section>
      <h2>Check this read</h2>
      <p>This page read the contract through this site&apos;s reader.</p>
      {chainId === 11155111 ? (
        <p>
          <a href={`https://sepolia.etherscan.io/address/${contract}`}>Contract on the Sepolia explorer</a>
        </p>
      ) : (
        <p>On this computer the Anvil node is http://127.0.0.1:8545. Replace &lt;YOUR_NODE_URL&gt; with a node you choose.</p>
      )}
      <pre className="cast">{cast}</pre>
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
