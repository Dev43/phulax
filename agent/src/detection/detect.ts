import { checkInvariants } from "./invariants.js";
import { checkOracle } from "./oracle.js";
import { checkVector } from "./vector.js";
import { checkClassifier } from "./classifier.js";
import type { Score, Signal, TxContext } from "./types.js";

/**
 * Pure detection function (todo §3 + §6).
 *
 * No side effects. No network. No logging. Same input → same output, every
 * time. This is what lets us replay any historical exploit fixture through
 * detect() as a regression test.
 *
 * Tier order with early-exit short-circuits:
 *   1. invariants (force ≥0.6, short-circuit)
 *   2. oracle deviation (+0.2)
 *   3. vector similarity (+0.3)
 *   4. classifier (weighted, only if upstream tiers didn't already fire)
 */
export function detect(ctx: TxContext): Score {
  const signals: Signal[] = [];

  // Tier 1
  const invSignals = checkInvariants(ctx.invariants);
  signals.push(...invSignals);
  if (invSignals.length > 0) {
    // Short-circuit: pool state is mathematically broken; no need to burn
    // classifier time. Still surface oracle/vector hits as corroborating
    // signals if they're already on the context, but don't *require* them.
    signals.push(...checkOracle(ctx.oracle));
    signals.push(...checkVector(ctx.vectorMatch));
    return finalize(signals, true);
  }

  // Tier 2
  signals.push(...checkOracle(ctx.oracle));

  // Tier 3
  signals.push(...checkVector(ctx.vectorMatch));

  // Tier 4
  signals.push(...checkClassifier(ctx.classifier));

  return finalize(signals, false);
}

function finalize(signals: Signal[], shortCircuited: boolean): Score {
  const sum = signals.reduce((acc, s) => acc + s.delta, 0);
  const value = Math.max(0, Math.min(1, sum));
  return { value, shortCircuited, signals };
}
