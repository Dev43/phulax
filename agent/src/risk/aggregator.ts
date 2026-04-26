import type { Score } from "../detection/types.js";
import { config } from "../config.js";

export interface RiskPolicy {
  /** Per-account threshold from the iNFT metadata; falls back to config. */
  threshold: number;
  /** Whether the user has explicitly disabled auto-withdraw. */
  paused: boolean;
}

export interface RiskDecision {
  fire: boolean;
  threshold: number;
  maxScore: Score | null;
  /** Index in the input array that produced the max score. */
  maxIndex: number;
}

/**
 * Aggregate detect() results across the txs in a block (todo §7.4 step 3).
 * Returns the **max** score; withdraw is a binary decision so we don't
 * average — one bad tx is enough.
 */
export function aggregate(scores: Score[], policy: RiskPolicy): RiskDecision {
  const threshold = policy.threshold ?? config().defaultThreshold;
  if (policy.paused) {
    return { fire: false, threshold, maxScore: null, maxIndex: -1 };
  }

  let maxScore: Score | null = null;
  let maxIndex = -1;
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i]!;
    if (!maxScore || s.value > maxScore.value) {
      maxScore = s;
      maxIndex = i;
    }
  }
  const fire = maxScore !== null && maxScore.value > threshold;
  return { fire, threshold, maxScore, maxIndex };
}

export function defaultPolicy(): RiskPolicy {
  return { threshold: config().defaultThreshold, paused: false };
}
