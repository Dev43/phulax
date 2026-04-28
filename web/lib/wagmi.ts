import { http, createConfig } from "wagmi";
import { defineChain } from "viem";
import { injected } from "wagmi/connectors";

export const ogTestnet = defineChain({
  id: Number(process.env.NEXT_PUBLIC_OG_CHAIN_ID ?? 16602),
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_OG_RPC ?? "https://evmrpc-testnet.0g.ai"],
    },
  },
});

export const wagmiConfig = createConfig({
  chains: [ogTestnet],
  connectors: [injected()],
  transports: { [ogTestnet.id]: http() },
  ssr: true,
});
