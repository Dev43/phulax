import { type Hex, toFunctionSelector } from "viem";
import type { InvariantSnapshot, Signal } from "./types.js";

/**
 * Tier 1: invariant checks against the deployed FakeLendingPool surface
 * (todo §6 + §14.A.7 + §14 Review).
 *
 * Two unforgeable, per-tx invariants:
 *
 *   - Admin sweep (vuln #4): selector matches `withdrawReserves(address,address)`
 *     AND tx sender is the pool admin EOA. The admin EOA is hard-coded
 *     into the contract's immutable `admin` slot, so spoofing requires
 *     compromising that key — at which point the rug *is* the signal.
 *
 *   - Reentrancy (vuln #2): for a `withdraw(asset, amount, to)` tx the
 *     pool's ERC-20 reserve dropped by more than the visible `amount`
 *     (plus 5% slack for other txs in the same block). A reentrant call
 *     drains extra without re-emitting `Withdraw` for the second pass.
 *
 * Both push delta=0.8, comfortably above the 0.7 default threshold;
 * detect() short-circuits on either, skipping the classifier call.
 *
 * The original §6 design (sharePrice monotonic, utilization, accounting)
 * is preserved in `STRATEGY.md` §3 because it generalises to any real
 * pool with aggregate getters — but our demo target intentionally has
 * none, so those checks would always be a fiction here.
 */

// Computed at module load — viem's `toFunctionSelector` does keccak over
// the function signature.
export const SELECTOR_WITHDRAW_RESERVES: Hex = toFunctionSelector(
  "withdrawReserves(address,address)",
);
export const SELECTOR_WITHDRAW: Hex = toFunctionSelector(
  "withdraw(address,uint256,address)",
);

// 5% slack on the visible withdraw amount before we fire reentrancy.
// Allows other txs in the same block to nibble at the reserve without
// false-positive. Tighter than this triggers on benign inter-block churn.
const REENTRANCY_SLACK_BPS = 500n;

export function checkInvariants(s: InvariantSnapshot): Signal[] {
  const out: Signal[] = [];

  // Vuln #4: admin sweep. Selector + sender==admin together = rug.
  if (s.selector === SELECTOR_WITHDRAW_RESERVES && s.fromIsAdmin) {
    out.push({
      kind: "invariant.adminSweep",
      delta: 0.8,
      detail: `withdrawReserves from admin EOA`,
    });
  }

  // Vuln #2: reentrancy. Pool reserve dropped more than the tx's visible
  // withdraw amount. Only meaningful when we actually hydrated reserves
  // (skip when asset is null or prev was 0n — placeholder rows).
  if (
    s.selector === SELECTOR_WITHDRAW &&
    s.txAmount !== null &&
    s.txAmount > 0n &&
    s.poolReservePrev > 0n &&
    s.poolReserve <= s.poolReservePrev
  ) {
    const actualDrop = s.poolReservePrev - s.poolReserve;
    const slack = (s.txAmount * REENTRANCY_SLACK_BPS) / 10_000n;
    const ceiling = s.txAmount + slack;
    if (actualDrop > ceiling) {
      out.push({
        kind: "invariant.reentrancy",
        delta: 0.8,
        detail: `pool drop=${actualDrop} > tx amount=${s.txAmount} (ceiling=${ceiling})`,
      });
    }
  }

  return out;
}
