// Single source of truth for deployed addresses + agent service URL on the
// web side. All values come from web/.env.local (generated 2026-04-28 from
// contracts/broadcast/Deploy.s.sol/16602/run-latest.json). Defaults match
// the live testnet deploy so a fresh checkout works without a .env.

import type { Hex } from "viem";

const required = (key: string, fallback: string): Hex => {
  const v = process.env[key] ?? fallback;
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new Error(`${key} must be a 0x-address; got ${v}`);
  }
  return v as Hex;
};

export const PHULAX_ACCOUNT = required(
  "NEXT_PUBLIC_PHULAX_ACCOUNT",
  "0xA70060465c1cD280E72366082fE20C7618C18a66",
);
export const FAKE_POOL = required(
  "NEXT_PUBLIC_FAKE_POOL",
  "0xb1DE7278b81e1Fd40027bDac751117AE960d8747",
);
export const HUB = required(
  "NEXT_PUBLIC_HUB",
  "0x573b9Ec4BB93bbDA59C0DBA953831d58fC36498C",
);
export const PHULAX_INFT = required(
  "NEXT_PUBLIC_PHULAX_INFT",
  "0xe5c3e4b205844EFe2694949d5723aa93B7F91616",
);
export const FAKE_POOL_ADAPTER = required(
  "NEXT_PUBLIC_FAKE_POOL_ADAPTER",
  "0x0c39fF914e41DA07B815937ee70772ba21A5C760",
);
export const DEMO_ASSET = required(
  "NEXT_PUBLIC_DEMO_ASSET",
  "0x21937016d3E3d43a0c2725F47cC56fcb2B51d615",
);

// Default to the same-origin `/agent` mount so the dockerized deploy (Caddy
// reverse-proxies /agent → agent:8787) works without a build arg. Local
// dev overrides this via web/.env.local → http://localhost:8787.
export const AGENT_BASE_URL =
  process.env.NEXT_PUBLIC_AGENT_BASE_URL ?? "/agent";

// 0G Galileo enforces a 2 gwei minimum priority fee. Without this, every
// wallet tx is rejected: "gas tip cap 1, minimum needed 2000000000".
export const MIN_PRIORITY_FEE = 2_000_000_000n;
