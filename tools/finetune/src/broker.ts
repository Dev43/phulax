import { createRequire } from "node:module";
import type { JsonRpcProvider as JsonRpcProviderType, Wallet as WalletType } from "ethers";
import type { ZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { loadEnv } from "./config.js";

// Import via CJS to dodge a tsx/esbuild bug that mishandles the broker's
// chunked ESM rollup output (`./lib.esm/index.mjs` re-exports as `C as ...`
// and tsx fails to resolve the short identifiers). The CJS build at
// `lib.commonjs/index.js` exports the same surface without the rename hop.
//
// We must also `require` ethers from the same CJS realm: the broker SDK
// internally checks `signer instanceof ethers.Wallet` against *its own*
// CJS-loaded class. An ESM-imported `Wallet` is a different class identity
// even when the package version matches, so the instanceof fails and
// `broker.fineTuning` silently stays undefined.
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require("@0glabs/0g-serving-broker") as {
  createZGComputeNetworkBroker: (
    signer: WalletType,
  ) => Promise<ZGComputeNetworkBroker>;
};
const { Wallet, JsonRpcProvider } = require("ethers") as {
  Wallet: typeof WalletType;
  JsonRpcProvider: typeof JsonRpcProviderType;
};

export type BrokerHandle = {
  broker: ZGComputeNetworkBroker;
  signer: WalletType;
  address: string;
};

export async function openBroker(): Promise<BrokerHandle> {
  const env = loadEnv();
  const provider = new JsonRpcProvider(env.rpcUrl);
  const signer = new Wallet(env.privateKey, provider);
  const broker = await createZGComputeNetworkBroker(signer);
  if (!broker.fineTuning) {
    throw new Error(
      "broker.fineTuning is undefined. createZGComputeNetworkBroker requires a Wallet (not a JsonRpcSigner) for fine-tuning.",
    );
  }
  return { broker, signer, address: await signer.getAddress() };
}
