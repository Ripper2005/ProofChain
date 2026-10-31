import { useState } from "react";
import type { Address, Hex } from "viem";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { productRegistryAbi } from "../contracts/ProductRegistry.ts";
import { supportedChainId, wagmiConfig, type WalletChainId } from "../wagmi.ts";
import { writeTarget, writeTargetMessage, type Deployment } from "./deployments.ts";
import { contractErrorText, isContractRevert, walletRejected } from "./errors.ts";
import { receiptAccepted, REVERTED_RECEIPT } from "./failures.ts";
import { checkedClient } from "./reader.ts";

export type ContractAction =
  | { functionName: "registerBatch"; args: readonly [string, string, string] }
  | { functionName: "proposeCustodyTransfer"; args: readonly [Hex, Address] }
  | { functionName: "acceptCustodyTransfer"; args: readonly [Hex] }
  | { functionName: "cancelCustodyTransfer"; args: readonly [Hex] }
  | { functionName: "recallBatch"; args: readonly [Hex, string] };

export type Simulation =
  | { kind: "passed" }
  | { kind: "rejected"; text: string }
  | { kind: "not-run"; text: string };

export type StoppedSimulation = Exclude<Simulation, { kind: "passed" }>;

export type Simulate = (input: { action: ContractAction; deployment: Deployment; account: Address }) => Promise<Simulation>;

export class SimulationStopped extends Error {
  readonly simulation: StoppedSimulation;

  constructor(simulation: StoppedSimulation) {
    super(simulation.text);
    this.name = "SimulationStopped";
    this.simulation = simulation;
  }
}

type WriteFn = ReturnType<typeof useWriteContract>["writeContractAsync"];

export function useSendAction() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [stopped, setStopped] = useState<{ action: ContractAction; simulation: StoppedSimulation } | null>(null);

  async function send(action: ContractAction, skipSimulation = false): Promise<Hex | null> {
    setError(null);
    setTxHash(null);
    setStopped(null);
    if (!address) {
      setError("Connect a wallet before this action.");
      return null;
    }
    const target = writeTarget();
    if (target.kind !== "ready") {
      setError(writeTargetMessage(target));
      return null;
    }
    setPending(true);
    try {
      const hash = await submitAction({
        action,
        deployment: target.deployment,
        account: address,
        walletChainId: chainId,
        switchChain: (next) => switchChainAsync({ chainId: next }),
        write: writeContractAsync,
        skipSimulation,
      });
      setTxHash(hash);
      return hash;
    } catch (caught) {
      if (caught instanceof SimulationStopped) {
        setStopped({ action, simulation: caught.simulation });
      } else {
        setError(walletRejected(caught) ? "The wallet rejected the request." : contractErrorText(caught));
      }
      return null;
    } finally {
      setPending(false);
    }
  }

  async function sendAnyway(): Promise<Hex | null> {
    if (!stopped) return null;
    return send(stopped.action, true);
  }

  return { send, sendAnyway, stopped: stopped?.simulation ?? null, pending, error, txHash, isConnected, address, chainId };
}

export async function submitAction(input: {
  action: ContractAction;
  deployment: Deployment;
  account: Address;
  walletChainId: number | undefined;
  switchChain: (chainId: WalletChainId) => Promise<unknown>;
  write: WriteFn;
  simulate?: Simulate;
  skipSimulation?: boolean;
  confirmReceipt?: (hash: Hex, chainId: number) => Promise<{ status: "success" | "reverted" }>;
}): Promise<Hex> {
  const { deployment } = input;
  const chainId = await switchToWriteChain(deployment, input.walletChainId, input.switchChain);
  if (!input.skipSimulation) {
    const simulation = await (input.simulate ?? simulateAction)({
      action: input.action,
      deployment,
      account: input.account,
    });
    if (simulation.kind !== "passed") throw new SimulationStopped(simulation);
  }
  const hash = await writeAction(input.write, deployment.address, chainId, input.account, input.action);
  const receipt = input.confirmReceipt
    ? await input.confirmReceipt(hash, chainId)
    : await waitForTransactionReceipt(wagmiConfig, { hash, chainId });
  if (!receiptAccepted(receipt.status)) throw new Error(REVERTED_RECEIPT);
  return hash;
}

export async function switchToWriteChain(
  deployment: Deployment,
  walletChainId: number | undefined,
  switchChain: (chainId: WalletChainId) => Promise<unknown>,
): Promise<WalletChainId> {
  if (!supportedChainId(deployment.chainId)) {
    throw new Error(`This wallet setup can switch to Anvil or Sepolia. The write chain is ${deployment.chainId}.`);
  }
  if (walletChainId !== deployment.chainId) {
    await switchChain(deployment.chainId);
  }
  return deployment.chainId;
}

type SimulationClient = Pick<Awaited<ReturnType<typeof checkedClient>>, "simulateContract">;

export async function simulateAction(
  input: { action: ContractAction; deployment: Deployment; account: Address },
  connect: (chainId: number) => Promise<SimulationClient> = checkedClient,
): Promise<Simulation> {
  try {
    const client = await connect(input.deployment.chainId);
    const shared = { abi: productRegistryAbi, address: input.deployment.address, account: input.account } as const;
    const { action } = input;
    switch (action.functionName) {
      case "registerBatch":
        await client.simulateContract({ ...shared, functionName: "registerBatch", args: action.args });
        break;
      case "proposeCustodyTransfer":
        await client.simulateContract({ ...shared, functionName: "proposeCustodyTransfer", args: action.args });
        break;
      case "acceptCustodyTransfer":
        await client.simulateContract({ ...shared, functionName: "acceptCustodyTransfer", args: action.args });
        break;
      case "cancelCustodyTransfer":
        await client.simulateContract({ ...shared, functionName: "cancelCustodyTransfer", args: action.args });
        break;
      case "recallBatch":
        await client.simulateContract({ ...shared, functionName: "recallBatch", args: action.args });
        break;
    }
    return { kind: "passed" };
  } catch (error) {
    if (isContractRevert(error)) return { kind: "rejected", text: contractErrorText(error) };
    return { kind: "not-run", text: contractErrorText(error) };
  }
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
