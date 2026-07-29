import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import { defineChain } from "viem";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: {
    name: "Monad",
    symbol: "MON",
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_RPC_URL ?? "https://testnet-rpc.monad.xyz"
      ]
    }
  },
  blockExplorers: {
    default: {
      name: "Monadscan",
      url:
        process.env.NEXT_PUBLIC_EXPLORER_URL ??
        "https://testnet.monadscan.com"
    }
  },
  testnet: true
});

export const wagmiConfig = createConfig({
  chains: [monadTestnet],
  connectors: [injected()],
  transports: {
    [monadTestnet.id]: http(monadTestnet.rpcUrls.default.http[0])
  },
  ssr: true
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
