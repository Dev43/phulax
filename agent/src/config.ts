import { type Address } from "viem";

const opt = (k: string, d: string): string => process.env[k] ?? d;

export interface Config {
  rpcUrl: string;
  chainId: number;
  pool: Address;
  defaultThreshold: number;
  classifierUrl: string;
  ogStorageUrl: string;
  ogStorageAuth: string | undefined;
  keeperHubUrl: string;
  keeperHubKey: string | undefined;
  // Webhook URL of the Phulax Guardian workflow in KeeperHub. The agent POSTs
  // here when risk score crosses threshold; KH signs and broadcasts
  // `PhulaxAccount.withdraw(adapter)` with the org wallet (the on-chain
  // `agent` role). Empty string is allowed at boot so non-firing flows
  // (tests, detection-only dev) work; executeWithdraw throws if it fires
  // without a URL configured.
  keeperHubWebhookUrl: string;
  serverPort: number;
}

export function loadConfig(): Config {
  return {
    rpcUrl: opt("RPC_URL", "http://localhost:8545"),
    chainId: Number(opt("CHAIN_ID", "16602")), // 0G Galileo testnet
    pool: (opt("POOL_ADDRESS", "0x0000000000000000000000000000000000000000") as Address),
    defaultThreshold: Number(opt("RISK_THRESHOLD", "0.7")),
    classifierUrl: opt("CLASSIFIER_URL", "http://localhost:8000/classify"),
    ogStorageUrl: opt("OG_STORAGE_URL", "http://localhost:5678"),
    ogStorageAuth: process.env["OG_STORAGE_AUTH"],
    keeperHubUrl: opt("KEEPERHUB_URL", "http://localhost:3000"),
    keeperHubKey: process.env["KEEPERHUB_API_KEY"],
    keeperHubWebhookUrl: opt("KH_WEBHOOK_URL", ""),
    serverPort: Number(opt("PORT", "8787")),
  };
}

// Pre-loaded so that pure modules can import a frozen object without
// re-parsing env on the hot path. detect() never reads from here.
let _cfg: Config | undefined;
export function config(): Config {
  if (!_cfg) _cfg = loadConfig();
  return _cfg;
}

// For tests.
export function setConfig(c: Config): void {
  _cfg = c;
}
