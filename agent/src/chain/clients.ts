import {
  createPublicClient,
  http,
  defineChain,
  type PublicClient,
} from "viem";
import { config } from "../config.js";

export const zeroG = defineChain({
  id: 16602,
  name: "0G Galileo Testnet",
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
