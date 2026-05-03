import { http, createConfig } from "wagmi";
import { defineChain } from "viem";
import { injected } from "wagmi/connectors";

export const OG_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_OG_CHAIN_ID ?? 16602,
);

const OG_RPC_HTTP =
  process.env.NEXT_PUBLIC_OG_RPC ?? "https://evmrpc-testnet.0g.ai";

// Galileo testnet (chain id 16602). The block explorer is wired in so
// wallets that auto-add an unknown chain (Rabby, MetaMask) get the right
// metadata in one click instead of dropping into Ethereum mainnet.
export const ogTestnet = defineChain({
  id: OG_CHAIN_ID,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: {
    default: { http: [OG_RPC_HTTP] },
  },
  blockExplorers: {
    default: {
      name: "0G Chainscan",
      url: "https://chainscan-galileo.0g.ai",
    },
  },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [ogTestnet],
  connectors: [injected()],
  transports: { [ogTestnet.id]: http() },
  ssr: true,
});
