import type { ClassifierReceipt, Signal } from "./types.js";

/**
 * Tier 4: fine-tuned classifier. Weighted into the score; the receipt
 * is appended to the 0G Storage Log on every fire (todo §6 + §10).
 *
 * Receipt verification (signature, model_hash) is handled in
 * detection/hydrate.ts before the receipt is handed to detect(). This
 * function only consumes the verified probability so the pipeline stays pure.
 */
export function checkClassifier(c: ClassifierReceipt | null): Signal[] {
  if (!c) return [];
  if (c.pNefarious < 0.5) return [];
  // Weight: classifier confidence above 0.5 contributes up to 0.4
  // (so it can lift a borderline 0.3 from earlier tiers over the 0.7 default
  // threshold, but cannot single-handedly fire without other signals).
  const delta = (c.pNefarious - 0.5) * 0.8;
  return [
    {
      kind: "classifier.nefarious",
      delta,
      detail: `p_nefarious=${c.pNefarious.toFixed(3)} tag=${c.tag}`,
    },
  ];
}
