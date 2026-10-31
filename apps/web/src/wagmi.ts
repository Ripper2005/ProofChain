import { createConfig, custom, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { sepolia } from "viem/chains";
import { listedReaders, trustedDeployments } from "./lib/deployments.ts";

export const anvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
});

const sepoliaReader = listedReaders(trustedDeployments(), sepolia.id)[0];

export const wagmiConfig = createConfig({
  chains: [anvil, sepolia],
  connectors: [injected()],
  transports: {
    [anvil.id]: http("http://127.0.0.1:8545", { batch: false }),
    [sepolia.id]: sepoliaReader
      ? http(sepoliaReader, { batch: false })
      : custom({
          async request() {
            throw new Error("trusted-deployments.json lists no Sepolia reader for this site.");
          },
        }),
  },
  ssr: false,
});

export type WalletChainId = (typeof wagmiConfig)["chains"][number]["id"];

export function supportedChainId(chainId: number): chainId is WalletChainId {
  return wagmiConfig.chains.some((chain) => chain.id === chainId);
}
