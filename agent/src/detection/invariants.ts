import type { InvariantSnapshot, Signal } from "./types.js";

/**
 * Tier 1: invariant checks. Pure, ~5ms when called with a hydrated snapshot.
 * Any single violation pushes the score to >= 0.6 and short-circuits the
 * pipeline (todo §6). We weight at 0.8 — comfortably above the 0.7 default
 * threshold — because an invariant break is unforgeable: the pool state is
 * mathematically inconsistent, so we don't need a classifier to corroborate.
 */
export function checkInvariants(s: InvariantSnapshot): Signal[] {
  const out: Signal[] = [];

  // Monotonic share price: a yield pool's per-share price never decreases
  // in normal operation. A drop indicates value extraction.
  if (s.sharePrice < s.prevSharePrice) {
    out.push({
      kind: "invariant.sharePrice",
      delta: 0.8,
      detail: `sharePrice ${s.sharePrice} < prev ${s.prevSharePrice}`,
    });
  }

  // Utilization > 100% means borrows exceed supply.
  if (s.utilizationBps > 10_000n) {
    out.push({
      kind: "invariant.utilization",
      delta: 0.8,
      detail: `utilizationBps=${s.utilizationBps}`,
    });
  }

  // Accounting: totalSupply == reserves + borrows. Any drift = state corruption.
  const expected = s.totalReserves + s.totalBorrows;
  if (s.totalSupply !== expected) {
    out.push({
      kind: "invariant.accounting",
      delta: 0.8,
      detail: `totalSupply=${s.totalSupply} != reserves+borrows=${expected}`,
    });
  }

  return out;
}
