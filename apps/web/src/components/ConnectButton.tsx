import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";

export function ConnectButton() {
  const { address, isConnected, chain } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <div className="actions">
        <span className="account">{address}</span>
        <span className="muted">{chain ? `${chain.name} (${chain.id})` : "Network unread"}</span>
        <button type="button" className="secondary" onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <button type="button" onClick={() => connect({ connector: injected() })} disabled={isPending}>
        {isPending ? "Waiting for the wallet" : "Connect wallet"}
      </button>
      <p className="muted">
        Connect the wallet in this browser. Wallet writes use the network configured in the wallet. For Anvil that
        network is http://127.0.0.1:8545.
      </p>
    </div>
  );
}
