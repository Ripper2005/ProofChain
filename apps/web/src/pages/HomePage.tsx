import { validateBatchCode } from "@proofchain/metadata";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAccount } from "wagmi";
import { AddressChip } from "../components/AddressChip.tsx";
import { ConnectButton } from "../components/ConnectButton.tsx";
import { Row, Rows } from "../components/Rows.tsx";
import { DEMO_DOCUMENT } from "../demo.ts";
import { writeTarget, writeTargetMessage } from "../lib/deployments.ts";
import { fetchIndexer, readBatchList, readHealth } from "../lib/indexer.ts";
import { readChainHead, readRoles } from "../lib/reader.ts";

export function HomePage() {
  const navigate = useNavigate();
  const lookupInputId = useId();
  const lookupHintId = useId();
  const batchesHeadingId = useId();
  const { address, chain } = useAccount();
  const target = writeTarget();
  const current = target.kind === "ready" ? target.deployment : null;
  const [batchCode, setBatchCode] = useState<string>(DEMO_DOCUMENT.batchCode);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const head = useQuery({
    queryKey: ["chain-head", current?.chainId],
    enabled: Boolean(current),
    queryFn: () => readChainHead(current!.chainId),
  });
  const roles = useQuery({
    queryKey: ["roles", current?.chainId, current?.address, address],
    enabled: Boolean(current && address),
    queryFn: () => readRoles(current!.chainId, current!.address, address!),
  });
  const health = useQuery({
    queryKey: ["indexer-health"],
    retry: false,
    queryFn: async () => {
      const parsed = readHealth(await fetchIndexer("/health"));
      if (!parsed) throw new Error("Indexer health was not readable");
      return parsed;
    },
  });
  const batches = useQuery({
    queryKey: ["indexer-batches", address],
    enabled: Boolean(address),
    retry: false,
    queryFn: async () => {
      const parsed = readBatchList(await fetchIndexer(`/batches?participant=${address!.toLowerCase()}`));
      if (!parsed) throw new Error("Indexer batch list was not readable");
      return parsed;
    },
  });

  function lookup(event: FormEvent) {
    event.preventDefault();
    setLookupError(null);
    if (!current) {
      setLookupError(writeTargetMessage(target));
      return;
    }
    if (!validateBatchCode(batchCode)) {
      setLookupError("Batch code must be 1–64 characters from A-Z, a-z, 0-9, and hyphen. The typed case is kept.");
      return;
    }
    navigate(`/verify/${current.chainId}/${current.address}/${encodeURIComponent(batchCode)}`);
  }

  const listsUnavailable = health.isError || (Boolean(address) && batches.isError);
  const pending = (batches.data ?? []).filter((batch) => batch.pending);

  return (
    <div className="stack">
      <section className="stack-sm">
        <h1>A shared custody log for a product batch</h1>
        <p className="lead">
          ProofChain is a shared custody log for a product batch: Ethereum records who registered it, who accepted each
          handoff, and whether it was recalled, and anyone can check that record without trusting one company&apos;s
          database.
        </p>
        <p className="notice">
          <strong>Boundary:</strong> Copying a QR sticker onto another box is possible. ProofChain verifies the
          on-chain story and which wallet signed each step; it does not prove that physical goods match that record.
        </p>
      </section>

      <section className="card stack">
        <h2>Look up a batch</h2>
        <form className="stack" onSubmit={lookup}>
          <div className="field">
            <label className="field-label" htmlFor={lookupInputId}>
              Batch code
            </label>
            <p id={lookupHintId} className="field-hint">
              Opens the wallet-free public verification view for the active contract deployment.
            </p>
            <input
              id={lookupInputId}
              className="mono"
              value={batchCode}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              aria-describedby={lookupHintId}
              aria-invalid={lookupError ? true : undefined}
              onChange={(event) => {
                setBatchCode(event.target.value);
                if (lookupError) setLookupError(null);
              }}
            />
          </div>
          <div className="actions">
            <button type="submit">Open verification</button>
          </div>
          {lookupError ? (
            <p className="revert" role="alert">
              {lookupError}
            </p>
          ) : null}
        </form>

        {current && current.chainId === 11155111 ? (
          <div className="stack-sm">
            <p className="muted">Live Sepolia showcase batches (read-only verification):</p>
            <div className="showcase-links">
              <Link
                className="btn-link secondary"
                to={`/verify/${current.chainId}/${current.address}/PCB-2026-R02`}
              >
                PCB-2026-R02 (Active)
              </Link>
              <Link
                className="btn-link secondary"
                to={`/verify/${current.chainId}/${current.address}/PCB-2026-R01`}
              >
                PCB-2026-R01 (Recalled)
              </Link>
            </div>
          </div>
        ) : null}
      </section>

      <section className="card stack">
        <h2>Wallet &amp; contract status</h2>
        <ConnectButton />
        <Rows>
          <Row label="Connected address">
            {address ? <AddressChip address={address} /> : "No wallet is connected"}
          </Row>
          <Row label="Network">{chain ? `${chain.name} (${chain.id})` : "No network"}</Row>
          <Row label="Chain head">
            {head.isSuccess ? head.data.toString() : head.isError ? "The chain head could not be read." : "Reading…"}
          </Row>
          <Row label="Indexer last processed block">
            {health.isSuccess ? health.data.lastProcessedBlock : "unavailable"}
          </Row>
          <Row label="Write contract">
            {current ? (
              <span className="mono" data-testid="write-contract">
                chain {current.chainId} {current.address} ({current.label})
              </span>
            ) : (
              writeTargetMessage(target)
            )}
          </Row>
        </Rows>

        <div className="stack-sm">
          <h3>Roles on the write contract</h3>
          {!address ? <p className="muted">Connect a wallet to read roles.</p> : null}
          {address && !current ? <p className="muted">Roles are read from the write contract. None is configured.</p> : null}
          {roles.isError ? <p className="revert">Roles could not be read from the contract.</p> : null}
          {roles.data ? (
            <div className="actions">
              <span className={`pill ${roles.data.admin ? "seal-match" : ""}`}>
                {roles.data.admin ? "✓" : "—"} Admin: {roles.data.admin ? "held" : "not held"}
              </span>
              <span className={`pill ${roles.data.manufacturer ? "seal-match" : ""}`}>
                {roles.data.manufacturer ? "✓" : "—"} Manufacturer: {roles.data.manufacturer ? "held" : "not held"}
              </span>
              <span className={`pill ${roles.data.recall ? "seal-match" : ""}`}>
                {roles.data.recall ? "✓" : "—"} Recall: {roles.data.recall ? "held" : "not held"}
              </span>
            </div>
          ) : null}
          <p className="muted">Roles are read directly with hasRole on the contract, not from the indexer.</p>
        </div>
      </section>

      <section className="card stack">
        <h2 id={batchesHeadingId}>Batches related to this address</h2>
        {!address ? <p className="muted">Connect a wallet to list batches for that address.</p> : null}
        {listsUnavailable ? (
          <p className="notice" data-testid="indexer-unavailable">
            Indexer lists are unavailable. Direct registration, custody, recall, and public verification still work.
          </p>
        ) : null}
        {batches.data ? (
          batches.data.length === 0 ? (
            <p className="muted">The indexer has no batches for this address.</p>
          ) : (
            <BatchTable
              batches={batches.data}
              headingId={batchesHeadingId}
              chainId={current?.chainId ?? null}
              contract={current?.address ?? null}
            />
          )
        ) : null}

        <h3>Pending handoffs</h3>
        {!address ? <p className="muted">Connect a wallet to list pending handoffs.</p> : null}
        {listsUnavailable ? <p className="muted">Indexer lists are unavailable.</p> : null}
        {batches.data ? (
          pending.length === 0 ? (
            <p className="muted">No handoff awaiting acceptance is listed for this address.</p>
          ) : (
            <ul className="check-list">
              {pending.map((batch) => (
                <li key={batch.batchId}>
                  <span className="mono">{batch.batchCode}</span> — from{" "}
                  <AddressChip address={batch.pending?.from ?? ""} /> to{" "}
                  <AddressChip address={batch.pending?.to ?? ""} />
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
    </div>
  );
}

function BatchTable({
  batches,
  headingId,
  chainId,
  contract,
}: {
  batches: Array<{ batchCode: string; status: string; currentCustodian: string }>;
  headingId: string;
  chainId: number | null;
  contract: string | null;
}) {
  return (
    <div tabIndex={0} role="region" aria-labelledby={headingId} className="table-wrapper">
      <table className="responsive-table">
        <caption className="visually-hidden">Indexed batches involving the connected wallet</caption>
        <thead>
          <tr>
            <th scope="col">Batch code</th>
            <th scope="col">Status</th>
            <th scope="col">Current custodian</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.batchCode}>
              <th scope="row" className="mono">
                {chainId && contract ? (
                  <Link to={`/verify/${chainId}/${contract}/${encodeURIComponent(batch.batchCode)}`}>
                    {batch.batchCode}
                  </Link>
                ) : (
                  batch.batchCode
                )}
              </th>
              <td data-label="Status">
                <span className={`pill ${batch.status === "recalled" ? "seal-alert" : "seal-match"}`}>
                  {batch.status === "recalled" ? "! Recalled" : "✓ Active"}
                </span>
              </td>
              <td data-label="Current custodian">
                <AddressChip address={batch.currentCustodian} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
