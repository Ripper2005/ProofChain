import { canonicalize, hashMetadata, parseAndValidate } from "@proofchain/metadata";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { ConnectButton } from "../components/ConnectButton.tsx";
import { QrCard } from "../components/QrCard.tsx";
import { Row, Rows } from "../components/Rows.tsx";
import { DEMO_DOCUMENT } from "../demo.ts";
import { SimulationNotice } from "../components/SimulationNotice.tsx";
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
  txHash: Hex;
};

export function RegisterPage() {
  const queryClient = useQueryClient();
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
    <>
      <h1>Register a batch</h1>
      <p>
        The company name is a claim inside the product document. The manufacturer the contract recognizes is the wallet
        that signs registerBatch. The QR appears only after a successful receipt.
      </p>
      <ConnectButton />
      {current ? (
        <p>
          Writes go to chain {current.chainId} at <span className="mono">{current.address}</span>.
          {account.chain && account.chain.id !== current.chainId
            ? ` The wallet is on chain ${account.chain.id}. The next registration requests a switch to chain ${current.chainId}.`
            : ""}
        </p>
      ) : (
        <p className="warning" data-testid="write-not-configured">
          {writeTargetMessage(target)}
        </p>
      )}

      <label className="field">
        <span>QR origin</span>
        <input
          value={originField}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setOriginField(event.target.value)}
          data-testid="qr-origin"
        />
      </label>
      {parsedOrigin && originIsLoopback(parsedOrigin) ? (
        <p className="warning" data-testid="loopback-warning">
          A phone cannot open a QR whose origin is localhost or 127.0.0.1. JavaScript on the phone would call the phone,
          not this computer. Type the LAN address of this computer when you join the network.
        </p>
      ) : null}
      {!parsedOrigin ? (
        <p className="revert">Enter an absolute http or https origin, without a path, query, or user info.</p>
      ) : null}

      <form className="stack" onSubmit={onSubmit}>
        <label className="field">
          <span>Product name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>SKU</span>
          <input className="mono" value={sku} onChange={(event) => setSku(event.target.value)} />
        </label>
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
        <label className="field">
          <span>Quantity</span>
          <input inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </label>
        <label className="field">
          <span>Production date</span>
          <input type="date" value={productionDate} onChange={(event) => setProductionDate(event.target.value)} />
        </label>
        <label className="field">
          <span>Company name</span>
          <input value={manufacturerName} onChange={(event) => setManufacturerName(event.target.value)} />
        </label>
        <p className="muted">The company name is stored in the document. It is not a wallet address.</p>
        <label className="field">
          <span>Description</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label className="field">
          <span>Optional image or certificate</span>
          <input
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Registering" : "Register batch"}
        </button>
      </form>
      {simulated ? (
        <p className="muted" data-testid="simulation-passed">
          The simulation of registerBatch passed before anything was pinned.
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

      {receipt && qrUrl ? (
        <section>
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
            <Row label="Transaction">
              <span className="mono">{receipt.txHash}</span>
            </Row>
          </Rows>
          <QrCard url={qrUrl} batchCode={receipt.batchCode} />
        </section>
      ) : null}
    </>
  );
}
