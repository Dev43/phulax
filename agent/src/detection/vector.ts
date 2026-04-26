import type { Signal, VectorMatch } from "./types.js";

/**
 * Tier 3: vector similarity. Cosine of the tx feature vector against the
 * 0G Storage KV index of historical exploits (Track C populates).
 * Top-1 ≥ 0.85 → +0.3 (todo §6).
 *
 * Note: the actual embedding + KV lookup happens in keeperhub/ workflow steps
 * (so it can be replayed inside KeeperHub), or in detection/hydrate.ts for
 * local replays. detect() just consumes the result.
 */
const SIMILARITY_THRESHOLD = 0.85;

export function checkVector(m: VectorMatch | null): Signal[] {
  if (!m) return [];
  if (m.cosine < SIMILARITY_THRESHOLD) return [];
  return [
    {
      kind: "vector.similarity",
      delta: 0.3,
      detail: `match=${m.exploitId} cosine=${m.cosine.toFixed(3)}`,
    },
  ];
}
