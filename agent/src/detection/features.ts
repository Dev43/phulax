import { type Hex, getAbiItem } from "viem";
import { fakeLendingPoolAbi } from "../abis/FakeLendingPool.js";
import type { InvariantSnapshot } from "./types.js";

/**
 * Canonical feature blob handed to the classifier. Must match the schema
 * the LoRA was fine-tuned on (ml/prompt/template.py 2.0.0):
 *   { caller, selector, fn, decoded_args, balance_delta }
 *
 * Wrong keys here are silently coerced to empty defaults inside
 * inference/server.py:_row_for_template, which makes the prompt look
 * neutral and the model returns SAFE regardless of selector.
 */
export interface ClassifierFeatures {
  caller: { role: string; age_days: number; signer_quorum: number | null };
  selector: Hex;
  fn: string;
  decoded_args: Record<string, string>;
  balance_delta: Record<string, string>;
}

export interface ClassifierInput {
  features: ClassifierFeatures;
}

export function buildClassifierFeatures(input: {
  selector: Hex;
  functionName: string | null;
  args: readonly unknown[];
  fromIsAdmin?: boolean;
  invariants?: InvariantSnapshot;
}): ClassifierFeatures {
  const { selector, functionName, args, fromIsAdmin, invariants } = input;

  const decoded_args: Record<string, string> = {};
  let abiInputs: readonly { name?: string }[] | null = null;
  if (functionName) {
    try {
      const item = getAbiItem({
        abi: fakeLendingPoolAbi,
        // biome-ignore lint/suspicious/noExplicitAny: viem's getAbiItem requires
        // a literal name; KH supplies it as a runtime string.
        name: functionName as any,
      });
      if (item && item.type === "function") {
        abiInputs = item.inputs as readonly { name?: string }[];
      }
    } catch {
      /* selector not in pool ABI — fall through to positional names */
    }
  }
  args.forEach((v, i) => {
    const name = abiInputs?.[i]?.name || `arg${i}`;
    decoded_args[name] = serialize(v);
  });

  // balance_delta: pool reserves(blockN) - reserves(blockN-1). Negative deltas
  // (drains/sweeps) are the discriminating signal the LoRA was trained on.
  const balance_delta: Record<string, string> = {};
  if (
    invariants &&
    (invariants.poolReserve > 0n || invariants.poolReservePrev > 0n)
  ) {
    const delta = invariants.poolReserve - invariants.poolReservePrev;
    balance_delta.reserves = delta.toString();
  }

  return {
    caller: {
      role: fromIsAdmin ? "admin" : "eoa",
      age_days: 0,
      signer_quorum: null,
    },
    selector,
    fn: functionName ?? "unknown",
    decoded_args,
    balance_delta,
  };
}

function serialize(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (v === null || v === undefined) return "";
  return String(v);
}
