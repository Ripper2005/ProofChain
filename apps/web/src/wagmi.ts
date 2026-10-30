import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { sepolia } from "viem/chains";

export const anvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
});

export const wagmiConfig = createConfig({
  chains: [anvil, sepolia],
  connectors: [injected()],
  transports: {
    [anvil.id]: http("http://127.0.0.1:8545", { batch: false }),
    [sepolia.id]: http(sepolia.rpcUrls.default.http[0], { batch: false }),
  },
  ssr: false,
});

export type WalletChainId = (typeof wagmiConfig)["chains"][number]["id"];

export function supportedChainId(chainId: number): chainId is WalletChainId {
  return wagmiConfig.chains.some((chain) => chain.id === chainId);
}
