import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";

export const zeroG = defineChain({
  id: 16600,
  name: "0G Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [config().rpcUrl] } },
});

let _public: PublicClient | undefined;
export function publicClient(): PublicClient {
  if (!_public) {
    _public = createPublicClient({
      chain: { ...zeroG, id: config().chainId },
      transport: http(config().rpcUrl),
    });
  }
  return _public;
}

let _wallet: WalletClient | undefined;
export function agentWallet(): WalletClient {
  if (!_wallet) {
    const account = privateKeyToAccount(config().agentPrivateKey);
    _wallet = createWalletClient({
      account,
      chain: { ...zeroG, id: config().chainId },
      transport: http(config().rpcUrl),
    });
  }
  return _wallet;
}
