import { type Address, type Hex } from "viem";

const req = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};
const opt = (k: string, d: string): string => process.env[k] ?? d;

export interface Config {
  rpcUrl: string;
  chainId: number;
  pool: Address;
  agentPrivateKey: Hex;
  defaultThreshold: number;
  classifierUrl: string;
  ogStorageUrl: string;
  ogStorageAuth: string | undefined;
  keeperHubUrl: string;
  keeperHubKey: string | undefined;
  serverPort: number;
}

export function loadConfig(): Config {
  return {
    rpcUrl: opt("RPC_URL", "http://localhost:8545"),
    chainId: Number(opt("CHAIN_ID", "16602")), // 0G Galileo testnet
    pool: (opt("POOL_ADDRESS", "0x0000000000000000000000000000000000000000") as Address),
    agentPrivateKey: (opt(
      "AGENT_PRIVATE_KEY",
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    ) as Hex),
    defaultThreshold: Number(opt("RISK_THRESHOLD", "0.7")),
    classifierUrl: opt("CLASSIFIER_URL", "http://localhost:8000/classify"),
    ogStorageUrl: opt("OG_STORAGE_URL", "http://localhost:5678"),
    ogStorageAuth: process.env["OG_STORAGE_AUTH"],
    keeperHubUrl: opt("KEEPERHUB_URL", "http://localhost:3000"),
    keeperHubKey: process.env["KEEPERHUB_API_KEY"],
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
