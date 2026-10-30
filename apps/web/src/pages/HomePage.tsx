import { validateBatchCode } from "@proofchain/metadata";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount } from "wagmi";
import { ConnectButton } from "../components/ConnectButton.tsx";
import { Row, Rows } from "../components/Rows.tsx";
import { DEMO_DOCUMENT } from "../demo.ts";
import { currentDeployment, currentListedDeployment, envContractAddress } from "../lib/deployments.ts";
import { fetchIndexer, readBatchList, readHealth } from "../lib/indexer.ts";
import { readChainHead, readRoles } from "../lib/reader.ts";

export function HomePage() {
  const navigate = useNavigate();
  const { address, chain } = useAccount();
  const current = currentDeployment();
  const listed = currentListedDeployment();
  const envAddress = envContractAddress();
  const [batchCode, setBatchCode] = useState<string>(DEMO_DOCUMENT.batchCode);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const head = useQuery({
    queryKey: ["chain-head", current?.chainId, current?.address],
    enabled: Boolean(current),
    queryFn: () => readChainHead(current!.chainId, current!.address),
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
      setLookupError("No current deployment is configured.");
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
    <>
      <h1>A shared custody log for a product batch</h1>
      <p className="lead">
        ProofChain is a shared custody log for a product batch: Ethereum records who registered it, who accepted each
        handoff, and whether it was recalled, and anyone can check that record without trusting one company&apos;s
        database.
      </p>
      <p>
        Copying the sticker onto another box is possible. ProofChain checks the recorded story and who signed it. It
        does not prove the physical goods match that story.
      </p>

      <h2>Wallet</h2>
      <ConnectButton />
      <Rows>
        <Row label="Connected address">{address ? <span className="mono">{address}</span> : "No wallet is connected"}</Row>
        <Row label="Network">{chain ? `${chain.name} (${chain.id})` : "No network"}</Row>
        <Row label="Chain head">
          {head.isSuccess ? head.data.toString() : head.isError ? "The chain head could not be read." : "Reading"}
        </Row>
        <Row label="Indexer last processed block">
          {health.isSuccess ? health.data.lastProcessedBlock : "unavailable"}
        </Row>
        <Row label="Current contract">
          {listed ? (
            <span className="mono">
              chain {listed.chainId} {listed.address} ({listed.label})
            </span>
          ) : current ? (
            <span>
              <span className="mono">
                chain {current.chainId} {current.address}
              </span>
              . This address comes from VITE_CONTRACT_ADDRESS and is not in trusted-deployments.json, so verification
              will not show a green seal for it.
            </span>
          ) : (
            "No current deployment is configured."
          )}
        </Row>
        {envAddress && listed && envAddress !== listed.address ? (
          <Row label="VITE_CONTRACT_ADDRESS">
            <span className="mono">{envAddress}</span> does not match the current trusted deployment.
          </Row>
        ) : null}
      </Rows>

      <h2>Roles on the current contract</h2>
      {!address ? <p>Connect a wallet to read roles.</p> : null}
      {address && !current ? <p>Roles are read from the current contract. None is configured.</p> : null}
      {roles.isError ? <p className="revert">Roles could not be read from the contract.</p> : null}
      {roles.data ? (
        <Rows>
          <Row label="Admin">{roles.data.admin ? "held" : "not held"}</Row>
          <Row label="Manufacturer">{roles.data.manufacturer ? "held" : "not held"}</Row>
          <Row label="Recall">{roles.data.recall ? "held" : "not held"}</Row>
        </Rows>
      ) : null}
      <p className="muted">Roles come from hasRole on the contract, not from the indexer.</p>

      <h2>Look up a batch</h2>
      <form className="stack" onSubmit={lookup}>
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
        <button type="submit">Open verification</button>
        {lookupError ? <p className="revert">{lookupError}</p> : null}
      </form>

      <h2>Batches related to this address</h2>
      {!address ? <p>Connect a wallet to list batches for that address.</p> : null}
      {listsUnavailable ? <p data-testid="indexer-unavailable">Indexer lists are unavailable.</p> : null}
      {batches.data ? (
        batches.data.length === 0 ? (
          <p>The indexer has no batches for this address.</p>
        ) : (
          <BatchTable batches={batches.data} />
        )
      ) : null}

      <h2>Pending handoffs</h2>
      {!address ? <p>Connect a wallet to list pending handoffs.</p> : null}
      {listsUnavailable ? <p>Indexer lists are unavailable.</p> : null}
      {batches.data ? (
        pending.length === 0 ? (
          <p>No pending handoff is listed for this address.</p>
        ) : (
          <ul>
            {pending.map((batch) => (
              <li key={batch.batchId}>
                <span className="mono">{batch.batchCode}</span> from <span className="mono">{batch.pending?.from}</span> to{" "}
                <span className="mono">{batch.pending?.to}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}
      <p className="muted">
        Direct registration, custody, and recall still work when these lists are unavailable. Public verification does
        not read the indexer.
      </p>
    </>
  );
}

function BatchTable({ batches }: { batches: Array<{ batchCode: string; status: string; currentCustodian: string }> }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Batch code</th>
          <th>Status</th>
          <th>Custodian</th>
        </tr>
      </thead>
      <tbody>
        {batches.map((batch) => (
          <tr key={batch.batchCode}>
            <td className="mono">{batch.batchCode}</td>
            <td>{batch.status}</td>
            <td className="mono">{batch.currentCustodian}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
