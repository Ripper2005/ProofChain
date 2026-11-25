import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { writeTarget } from "../lib/deployments.ts";
import { AddressChip } from "./AddressChip.tsx";

export function ConnectButton() {
  const { address, isConnected, chain } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const target = writeTarget();
  const targetNote =
    target.kind === "ready" && target.deployment.chainId === 31337
      ? "For local Anvil, configure http://127.0.0.1:8545 (chain ID 31337) in your wallet."
      : target.kind === "ready"
        ? `Target write chain: ${target.deployment.label} (chain ID ${target.deployment.chainId}).`
        : "Public verification requires no wallet.";

  if (isConnected && address) {
    return (
      <div className="actions">
        <AddressChip address={address} />
        <span className="pill">{chain ? `${chain.name} (${chain.id})` : "Network unread"}</span>
        <button type="button" className="secondary compact" onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="stack-sm">
      <div className="actions">
        <button type="button" onClick={() => connect({ connector: injected() })} disabled={isPending}>
          {isPending ? "Waiting for wallet…" : "Connect wallet"}
        </button>
      </div>
      <p className="muted">
        Connect a browser wallet (such as MetaMask) to sign writes. {targetNote}
      </p>
    </div>
  );
}
