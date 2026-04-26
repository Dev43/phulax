import type { OracleSnapshot, Signal } from "./types.js";

/**
 * Tier 2: oracle deviation. Pool's internal price vs Chainlink + DEX TWAP.
 * 2% drift on either reference adds 0.2 to score (todo §6).
 *
 * Per-block deviation is the strongest signal we have for single-block oracle
 * manipulation, which is exactly the FakeLendingPool's intentional vuln (§5).
 */
const DEVIATION_THRESHOLD_BPS = 200n; // 2%

export function checkOracle(o: OracleSnapshot): Signal[] {
  if (o.poolPrice === 0n) return [];
  const out: Signal[] = [];

  const deviationBps = (a: bigint, b: bigint): bigint => {
    if (b === 0n) return 0n;
    const diff = a > b ? a - b : b - a;
    return (diff * 10_000n) / b;
  };

  const dChain = deviationBps(o.poolPrice, o.chainlinkPrice);
  const dTwap = deviationBps(o.poolPrice, o.twapPrice);

  if (dChain > DEVIATION_THRESHOLD_BPS) {
    out.push({
      kind: "oracle.deviation",
      delta: 0.2,
      detail: `pool vs chainlink Δ=${dChain}bps`,
    });
  }
  if (dTwap > DEVIATION_THRESHOLD_BPS && dChain <= DEVIATION_THRESHOLD_BPS) {
    // Don't double-count when both references disagree with the pool —
    // the chainlink signal is enough.
    out.push({
      kind: "oracle.deviation",
      delta: 0.2,
      detail: `pool vs twap Δ=${dTwap}bps`,
    });
  }
  return out;
}
