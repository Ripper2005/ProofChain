import { canonicalize, hashMetadata, parseAndValidate } from "@proofchain/metadata";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { ConnectButton } from "../components/ConnectButton.tsx";
import { QrCard } from "../components/QrCard.tsx";
import { Row, Rows } from "../components/Rows.tsx";
import { SimulationNotice } from "../components/SimulationNotice.tsx";
import { DEMO_DOCUMENT } from "../demo.ts";
import { simulateAction, submitAction, switchToWriteChain, type StoppedSimulation } from "../lib/actions.ts";
import { writeTarget, writeTargetMessage } from "../lib/deployments.ts";
import { registrationFailureText } from "../lib/failures.ts";
import { originIsLoopback, parseOrigin, verificationUrl } from "../lib/format.ts";
import { pinBlob, pinMetadata } from "../lib/pin.ts";
import type { Address, Hex } from "viem";

const PLACEHOLDER_CID = `bafkrei${"a".repeat(52)}`;

type RegistrationReceipt = {
  batchCode: string;
  contract: Address;
  chainId: number;
  metadataHash: Hex;
  cid: string;
  publicCopy: boolean;
  txHash: Hex;
};

export function RegisterPage() {
  const queryClient = useQueryClient();
  const originInputId = useId();
  const nameInputId = useId();
  const skuInputId = useId();
  const batchCodeInputId = useId();
  const quantityInputId = useId();
  const dateInputId = useId();
  const companyInputId = useId();
  const companyHintId = useId();
  const descriptionInputId = useId();
  const fileInputId = useId();
  const fileHintId = useId();

  const account = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const target = writeTarget();
  const current = target.kind === "ready" ? target.deployment : null;
  const [name, setName] = useState<string>(DEMO_DOCUMENT.name);
  const [sku, setSku] = useState<string>(DEMO_DOCUMENT.sku);
  const [batchCode, setBatchCode] = useState<string>(DEMO_DOCUMENT.batchCode);
  const [quantity, setQuantity] = useState<string>(DEMO_DOCUMENT.quantity);
  const [productionDate, setProductionDate] = useState<string>(DEMO_DOCUMENT.productionDate);
  const [manufacturerName, setManufacturerName] = useState<string>(DEMO_DOCUMENT.manufacturerName);
  const [description, setDescription] = useState<string>(DEMO_DOCUMENT.description);
  const [file, setFile] = useState<File | null>(null);
  const [originField, setOriginField] = useState(
    () => import.meta.env.VITE_PUBLIC_ORIGIN?.trim() || window.location.origin,
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [stopped, setStopped] = useState<StoppedSimulation | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [receipt, setReceipt] = useState<RegistrationReceipt | null>(null);

  const hasPinService = import.meta.env.DEV;
  const parsedOrigin = parseOrigin(originField);
  const qrUrl =
    receipt && parsedOrigin ? verificationUrl(parsedOrigin, receipt.chainId, receipt.contract, receipt.batchCode) : null;

  function buildDocument(imageCid: string): string {
    const canonical = canonicalize({
      schemaVersion: 1,
      name: name.trim(),
      sku: sku.trim(),
      batchCode,
      quantity: Number(quantity.trim()),
      productionDate,
      manufacturerName: manufacturerName.trim(),
      description: description.trim(),
      imageCid,
    });
    parseAndValidate(canonical);
    return canonical;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await register(false);
  }

  async function register(skipSimulation: boolean) {
    setMessage(null);
    setStopped(null);
    setSimulated(false);
    if (!account.address) {
      setMessage("Connect a wallet before registering.");
      return;
    }
    if (!current) {
      setMessage(writeTargetMessage(target));
      return;
    }
    setPending(true);
    let pinned = false;
    try {
      if (!/^\d+$/.test(quantity.trim())) {
        throw new Error("Quantity must be an integer greater than or equal to 1.");
      }
      if (file && file.size === 0) throw new Error("The optional file is empty.");
      const walletChainId = await switchToWriteChain(current, account.chainId, (chainId) => switchChainAsync({ chainId }));
      if (!skipSimulation) {
        const draft = buildDocument(file ? PLACEHOLDER_CID : "");
        const simulation = await simulateAction({
          action: { functionName: "registerBatch", args: [batchCode, draft, PLACEHOLDER_CID] },
          deployment: current,
          account: account.address,
        });
        if (simulation.kind !== "passed") {
          setStopped(simulation);
          return;
        }
        setSimulated(true);
      }
      let imageCid = "";
      if (file) {
        imageCid = await pinBlob(new Uint8Array(await file.arrayBuffer()));
      }
      const canonical = buildDocument(imageCid);
      const localHash = hashMetadata(canonical);
      const pinnedDocument = await pinMetadata(canonical, batchCode);
      pinned = true;
      if (pinnedDocument.metadataHash.toLowerCase() !== localHash.toLowerCase()) {
        throw new Error("The pin service returned a different metadata hash. The wallet will not sign registerBatch.");
      }
      const txHash = await submitAction({
        action: {
          functionName: "registerBatch",
          args: [batchCode, canonical, pinnedDocument.cid],
        },
        deployment: current,
        account: account.address,
        walletChainId,
        switchChain: (chainId) => switchChainAsync({ chainId }),
        write: writeContractAsync,
        skipSimulation: true,
      });
      setReceipt({
        batchCode,
        contract: current.address,
        chainId: current.chainId,
        metadataHash: localHash,
        cid: pinnedDocument.cid,
        publicCopy: pinnedDocument.public,
        txHash,
      });
      await queryClient.invalidateQueries();
    } catch (error) {
      setMessage(registrationFailureText(error, pinned));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Register a batch</h1>
          <p className="lead">
            The company name is a self-reported claim inside the product document. The manufacturer the contract
            recognizes is the wallet that signs <span className="mono">registerBatch</span>. The QR appears only after a successful receipt.
          </p>
        </div>
      </div>

      {!hasPinService ? (
        <div className="warning" data-testid="no-pin-service-notice">
          <p>
            <strong>Registration runs on the local operator console.</strong>
          </p>
          <p>
            This static hosted build has no pin service, so document pinning and registration cannot complete here. Run{" "}
            <span className="mono">pnpm dev:sepolia</span> (or <span className="mono">pnpm dev</span> for local Anvil)
            on your workstation to register new batches.
          </p>
        </div>
      ) : null}

      <section className="card stack">
        <h2>1. Wallet &amp; target deployment</h2>
        <ConnectButton />
        {current ? (
          <p className="muted">
            Writes go to chain {current.chainId} at <span className="mono">{current.address}</span> ({current.label}).
            {account.chain && account.chain.id !== current.chainId
              ? ` Your wallet is currently on chain ${account.chain.id}; submitting will request a switch to chain ${current.chainId}.`
              : ""}
          </p>
        ) : (
          <p className="warning" data-testid="write-not-configured">
            {writeTargetMessage(target)}
          </p>
        )}
      </section>

      <section className="card stack">
        <h2>2. Product batch details</h2>
        <form className="stack" onSubmit={onSubmit}>
          <fieldset className="group">
            <legend>Product document fields (hashed &amp; emitted on-chain)</legend>
            <div className="field">
              <label className="field-label" htmlFor={nameInputId}>
                Product name
              </label>
              <input id={nameInputId} value={name} required onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={skuInputId}>
                SKU
              </label>
              <input
                id={skuInputId}
                className="mono"
                value={sku}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                required
                onChange={(event) => setSku(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={batchCodeInputId}>
                Batch code
              </label>
              <input
                id={batchCodeInputId}
                className="mono"
                value={batchCode}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                required
                onChange={(event) => setBatchCode(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={quantityInputId}>
                Quantity
              </label>
              <input
                id={quantityInputId}
                inputMode="numeric"
                value={quantity}
                required
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={dateInputId}>
                Production date
              </label>
              <input
                id={dateInputId}
                type="date"
                value={productionDate}
                required
                onChange={(event) => setProductionDate(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={companyInputId}>
                Name in document (company name)
              </label>
              <p id={companyHintId} className="field-hint">
                Stored as a claim inside the canonical JSON document. It is not verified by the contract.
              </p>
              <input
                id={companyInputId}
                value={manufacturerName}
                aria-describedby={companyHintId}
                required
                onChange={(event) => setManufacturerName(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={descriptionInputId}>
                Description (optional)
              </label>
              <textarea
                id={descriptionInputId}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={fileInputId}>
                Optional image or certificate
              </label>
              <p id={fileHintId} className="field-hint">
                Pinned up to 5 MB before the canonical document is hashed so its CID sits in imageCid.
              </p>
              <input
                id={fileInputId}
                type="file"
                aria-describedby={fileHintId}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
          </fieldset>

          <fieldset className="group">
            <legend>QR verification link target</legend>
            <div className="field">
              <label className="field-label" htmlFor={originInputId}>
                QR origin
              </label>
              <input
                id={originInputId}
                value={originField}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                aria-invalid={!parsedOrigin ? true : undefined}
                onChange={(event) => setOriginField(event.target.value)}
                data-testid="qr-origin"
              />
            </div>
            {parsedOrigin && originIsLoopback(parsedOrigin) ? (
              <p className="warning" data-testid="loopback-warning">
                A phone cannot open a QR whose origin is localhost or 127.0.0.1. JavaScript on the phone would call the
                phone, not this computer. Type the LAN address of this computer when you join the network.
              </p>
            ) : null}
            {!parsedOrigin ? (
              <p className="revert">Enter an absolute http or https origin, without a path, query, or user info.</p>
            ) : null}
          </fieldset>

          <div className="actions">
            <button type="submit" disabled={pending}>
              {pending ? "Registering…" : "Register batch"}
            </button>
          </div>
        </form>

        {simulated ? (
          <p className="notice notice-match" data-testid="simulation-passed">
            ✓ Pre-flight simulation of registerBatch passed before pinning.
          </p>
        ) : null}
        {stopped ? (
          <SimulationNotice simulation={stopped} pending={pending} onSendAnyway={() => void register(true)} />
        ) : null}
        {message ? (
          <p className="revert" role="alert" data-testid="contract-error">
            {message}
          </p>
        ) : null}
      </section>

      {receipt && qrUrl ? (
        <section className="card card-match stack">
          <h2>Registration receipt</h2>
          <Rows>
            <Row label="Batch code">
              <span className="mono">{receipt.batchCode}</span>
            </Row>
            <Row label="Contract">
              <span className="mono">{receipt.contract}</span>
            </Row>
            <Row label="Metadata hash">
              <span className="mono">{receipt.metadataHash}</span>
            </Row>
            <Row label="CID">
              <span className="mono">{receipt.cid}</span>
            </Row>
            <Row label="Public copy">
              <span data-testid="public-copy">
                {receipt.publicCopy ? "Yes (pinned publicly)" : "No. The copy is only on this computer's IPFS node."}
              </span>
            </Row>
            <Row label="Transaction">
              {receipt.chainId === 11155111 ? (
                <a
                  className="mono"
                  href={`https://sepolia.etherscan.io/tx/${receipt.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {receipt.txHash}
                </a>
              ) : (
                <span className="mono">{receipt.txHash}</span>
              )}
            </Row>
          </Rows>
          <QrCard url={qrUrl} batchCode={receipt.batchCode} />
        </section>
      ) : null}
    </div>
  );
}
