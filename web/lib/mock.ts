// Phase-1 fake data. Replaced in Phase 3 by SSE from agent/server.ts and
// `GET /incidents/:account` proxied off 0G Storage Log.

export type StreamEvent =
  | { kind: "log"; ts: number; level: "info" | "warn" | "fire"; msg: string }
  | { kind: "score"; ts: number; score: number; signals: Signal[] };

export type Signal = {
  name: "invariant" | "oracle" | "vector" | "classifier";
  weight: number;
  detail: string;
};

export type Incident = {
  id: string;
  ts: number;
  score: number;
  outcome: "fired" | "monitored" | "fp";
  txHash: string;
  reason: string;
};

export const MOCK_ACCOUNT = "0xA11ce0000000000000000000000000000000F00d";
export const MOCK_BALANCE = "12,438.21 USDC";

export const MOCK_INCIDENTS: Incident[] = [
  {
    id: "i_004",
    ts: Date.now() - 1000 * 60 * 14,
    score: 0.94,
    outcome: "fired",
    txHash: "0x9af3…c12d",
    reason: "calldata matched cream-finance-2021 cluster (cosine 0.91)",
  },
  {
    id: "i_003",
    ts: Date.now() - 1000 * 60 * 60 * 6,
    score: 0.42,
    outcome: "monitored",
    txHash: "0x3b71…77ea",
    reason: "oracle deviation 1.4% — under threshold",
  },
  {
    id: "i_002",
    ts: Date.now() - 1000 * 60 * 60 * 22,
    score: 0.18,
    outcome: "fp",
    txHash: "0x882c…0a91",
    reason: "user-marked false-positive (large legitimate redemption)",
  },
  {
    id: "i_001",
    ts: Date.now() - 1000 * 60 * 60 * 38,
    score: 0.71,
    outcome: "fired",
    txHash: "0x44de…91ff",
    reason: "share price non-monotonic + classifier 0.88",
  },
];

const SIGNAL_POOL: Signal[] = [
  { name: "invariant", weight: 0.35, detail: "share price monotonic ✓" },
  { name: "oracle", weight: 0.18, detail: "Δ vs Chainlink = 0.4%" },
  { name: "vector", weight: 0.22, detail: "top-1 cosine 0.61 (benign cluster)" },
  { name: "classifier", weight: 0.31, detail: "p_nefarious=0.22 model=qwen-0.5b-lora" },
];

const LOG_TEMPLATES = [
  "[block 2_341_{n}] query-transactions → 3 txs against FakeLendingPool",
  "[invariant] totalSupply==reserves+borrows ✓",
  "[invariant] utilization=0.{n}{m} ≤ 1.0 ✓",
  "[oracle] pool.price=1.000{n} chainlink=1.000{m} Δ=0.0{n}%",
  "[vector] embed(calldata) → 0G KV top-1 cluster=cream-2021 cos=0.{n}{m}",
  "[classifier] POST /classify → p_nefarious=0.{n}{m} latency={n}{m}ms",
  "[aggregator] score=0.{n}{m} threshold=0.70 → MONITOR",
  "[receipt] 0G Storage Log append cid=bafy...{n}{m}{n} ✓",
];

const FIRE_LOGS = [
  "[invariant] share price NON-MONOTONIC at block 2_341_109 ⚠",
  "[vector] top-1 cluster=cream-2021 cos=0.91 → ESCALATE",
  "[classifier] p_nefarious=0.94 (qwen-0.5b-lora, 312ms)",
  "[aggregator] score=0.93 threshold=0.70 → FIRE",
  "[exec] PhulaxAccount.withdraw(adapter) via KeeperHub MCP …",
  "[exec] tx 0x9af3…c12d included next-block ✓ funds=owner",
];

let counter = 0;
function rng() {
  counter = (counter * 9301 + 49297) % 233280;
  return counter / 233280;
}
const d = (n = 1) => Math.floor(rng() * 10 ** n)
  .toString()
  .padStart(n, "0");

export function fakeStreamTick(opts: { fire?: boolean } = {}): StreamEvent[] {
  const ts = Date.now();
  if (opts.fire) {
    return FIRE_LOGS.map((msg, i) => ({
      kind: "log" as const,
      ts: ts + i * 40,
      level: msg.includes("FIRE") || msg.includes("ESCALATE") || msg.includes("⚠") ? "fire" : "warn",
      msg,
    }));
  }
  const tmpl = LOG_TEMPLATES[Math.floor(rng() * LOG_TEMPLATES.length)];
  const msg = tmpl.replace(/\{n\}/g, () => d()).replace(/\{m\}/g, () => d());
  const events: StreamEvent[] = [{ kind: "log", ts, level: "info", msg }];
  if (rng() < 0.3) {
    const score = 0.05 + rng() * 0.45;
    events.push({
      kind: "score",
      ts,
      score,
      signals: SIGNAL_POOL.map((s) => ({ ...s })),
    });
  }
  return events;
}
