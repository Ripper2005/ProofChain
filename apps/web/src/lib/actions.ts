import { useState } from "react";
import type { Address, Hex } from "viem";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { productRegistryAbi } from "../contracts/ProductRegistry.ts";
import { supportedChainId, wagmiConfig, type WalletChainId } from "../wagmi.ts";
import { currentDeployment } from "./deployments.ts";
import { contractErrorText, walletRejected } from "./errors.ts";

export type ContractAction =
  | { functionName: "registerBatch"; args: readonly [string, Hex, string] }
  | { functionName: "proposeCustodyTransfer"; args: readonly [Hex, Address] }
  | { functionName: "acceptCustodyTransfer"; args: readonly [Hex] }
  | { functionName: "cancelCustodyTransfer"; args: readonly [Hex] }
  | { functionName: "recallBatch"; args: readonly [Hex, string] };

type WriteFn = ReturnType<typeof useWriteContract>["writeContractAsync"];

export function useSendAction() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);

  async function send(action: ContractAction): Promise<Hex | null> {
    setError(null);
    setTxHash(null);
    if (!address) {
      setError("Connect a wallet before this action.");
      return null;
    }
    setPending(true);
    try {
      const hash = await submitAction({
        action,
        account: address,
        walletChainId: chainId,
        switchChain: (next) => switchChainAsync({ chainId: next }),
        write: writeContractAsync,
      });
      setTxHash(hash);
      return hash;
    } catch (caught) {
      setError(walletRejected(caught) ? "The wallet rejected the request." : contractErrorText(caught));
      return null;
    } finally {
      setPending(false);
    }
  }

  return { send, pending, error, txHash, isConnected, address, chainId };
}

export async function submitAction(input: {
  action: ContractAction;
  account: Address;
  walletChainId: number | undefined;
  switchChain: (chainId: WalletChainId) => Promise<unknown>;
  write: WriteFn;
}): Promise<Hex> {
  const current = currentDeployment();
  if (!current) throw new Error("No current deployment is configured.");
  if (!supportedChainId(current.chainId)) {
    throw new Error(`This wallet setup can switch to Anvil or Sepolia. The current deployment is chain ${current.chainId}.`);
  }
  if (input.walletChainId !== current.chainId) {
    await input.switchChain(current.chainId);
  }
  const hash = await writeAction(input.write, current.address, current.chainId, input.account, input.action);
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: current.chainId });
  if (receipt.status !== "success") {
    throw new Error("The transaction reverted. The contract did not apply this action.");
  }
  return hash;
}

async function writeAction(
  write: WriteFn,
  contract: Address,
  chainId: WalletChainId,
  account: Address,
  action: ContractAction,
): Promise<Hex> {
  const shared = { abi: productRegistryAbi, address: contract, chainId, account } as const;
  switch (action.functionName) {
    case "registerBatch":
      return write({ ...shared, functionName: "registerBatch", args: action.args });
    case "proposeCustodyTransfer":
      return write({ ...shared, functionName: "proposeCustodyTransfer", args: action.args });
    case "acceptCustodyTransfer":
      return write({ ...shared, functionName: "acceptCustodyTransfer", args: action.args });
    case "cancelCustodyTransfer":
      return write({ ...shared, functionName: "cancelCustodyTransfer", args: action.args });
    case "recallBatch":
      return write({ ...shared, functionName: "recallBatch", args: action.args });
  }
}
