import {
  type Address,
  type Hex,
  decodeFunctionData,
  getAddress,
  keccak256,
  toHex,
} from "viem";
import { erc20BalanceOfAbi, fakeLendingPoolAbi } from "../abis/FakeLendingPool.js";
import { publicClient } from "../chain/clients.js";
import { config } from "../config.js";
import { kvLookupNearest } from "../og/kv.js";
import {
  SELECTOR_WITHDRAW,
  SELECTOR_WITHDRAW_RESERVES,
} from "./invariants.js";
import { buildClassifierFeatures } from "./features.js";
import type {
  ClassifierReceipt,
  InvariantSnapshot,
  OracleSnapshot,
  TxContext,
  VectorMatch,
} from "./types.js";

/**
 * Hydrate a TxContext for detect(). All I/O lives here so detect() stays pure.
 *
 * `decodedTx` shape matches what KeeperHub's `web3/query-transactions` step
 * returns (todo §7.4) — selector + decoded args. When running locally
 * (replays, tests) the caller can build the same shape from a viem
 * `getTransaction` + manual decode.
 */
export interface RawTx {
  hash: Hex;
  blockNumber: bigint;
  from: Address;
  to: Address;
  value: bigint;
  input: Hex;
}

export interface HydrateOptions {
  /** Override pool address (defaults to config().pool). */
  pool?: Address | undefined;
  /** Skip the classifier call (used when an earlier tier short-circuits). */
  skipClassifier?: boolean;
}

// Selectors that take an `amount` arg in args[1]. supply/borrow/withdraw
// all use this slot; liquidate/withdrawReserves do not.
const AMOUNT_BEARING_SELECTORS = new Set<string>([
  "supply",
  "borrow",
  "withdraw",
]);

export async function hydrate(
  raw: RawTx,
  opts: HydrateOptions = {},
): Promise<TxContext> {
  const pool = opts.pool ?? config().pool;
  const pc = publicClient();
  const selector = raw.input.slice(0, 10) as Hex;

  // Decode calldata against the pool ABI. If the tx isn't to our pool we
  // still proceed but with null function name.
  let functionName: string | null = null;
  let args: readonly unknown[] = [];
  try {
    const decoded = decodeFunctionData({
      abi: fakeLendingPoolAbi,
      data: raw.input,
    });
    functionName = decoded.functionName;
    args = (decoded.args ?? []) as readonly unknown[];
  } catch {
    // Selector not in pool ABI — keep nulls.
  }

  const blockTag = { blockNumber: raw.blockNumber } as const;
  const prevBlockTag = { blockNumber: raw.blockNumber - 1n } as const;
  // Oracle reference baseline. The pool's getAssetPrice changes per-block
  // when an attacker calls setAssetPrice — and on Galileo the typical
  // inflate→drain pattern lands setAssetPrice and withdraw in adjacent
  // blocks, so blockN-1 ALREADY reflects the inflated price (deviation
  // reads zero, tier-2 misses the attack). Look back enough blocks to
  // predate any single-tx manipulation; ~30 blocks ≈ 13s at Galileo's
  // ~430ms cadence — well outside a one-tx attack window. Configurable
  // via ORACLE_BASELINE_LOOKBACK env (default 30).
  const oracleBaselineLookback = BigInt(
    Number(process.env["ORACLE_BASELINE_LOOKBACK"] ?? "30"),
  );
  const oracleBaselineBlock = raw.blockNumber > oracleBaselineLookback
    ? raw.blockNumber - oracleBaselineLookback
    : raw.blockNumber - 1n;
  const oracleBaselineTag = { blockNumber: oracleBaselineBlock } as const;

  // Asset arg if the selector takes one (supply/borrow/withdraw/liquidate
  // all have the asset somewhere in args[0..1]; only the four selectors
  // we care about consistently put it at args[0]).
  const asset = extractAsset(functionName, args);
  const txAmount = extractAmount(functionName, args);

  // Tier 1: real-pool reads — admin EOA + ERC-20 reserve at blockN/N-1.
  const [adminAddr, poolReserve, poolReservePrev] = await Promise.all([
    pc.readContract({
      address: pool,
      abi: fakeLendingPoolAbi,
      functionName: "admin",
      ...blockTag,
    }).catch(() => null),
    asset
      ? pc.readContract({
          address: asset,
          abi: erc20BalanceOfAbi,
          functionName: "balanceOf",
          args: [pool],
          ...blockTag,
        }).catch(() => 0n)
      : Promise.resolve(0n),
    asset
      ? pc.readContract({
          address: asset,
          abi: erc20BalanceOfAbi,
          functionName: "balanceOf",
          args: [pool],
          ...prevBlockTag,
        }).catch(() => 0n)
      : Promise.resolve(0n),
  ]);

  const fromIsAdmin =
    adminAddr !== null &&
    getAddress(raw.from) === getAddress(adminAddr as Address);

  const invariants: InvariantSnapshot = {
    selector,
    fromIsAdmin,
    asset,
    poolReserve: poolReserve as bigint,
    poolReservePrev: poolReservePrev as bigint,
    txAmount,
  };

  // Tier 2: oracle. The pool exposes an asset price for the asset arg
  // (when present); chainlink + TWAP feeds are placeholders that Track B
  // wires through real oracle adapters. Until those land, we use the pool's
  // own historical price ~30 blocks back as a stand-in baseline (see
  // oracleBaselineBlock above). Reading from blockN-1 alone misses the
  // common inflate-then-drain pattern where both the manipulation and the
  // exit land in adjacent blocks.
  const oracleAsset = asset ?? pool;
  const [poolPrice, poolPriceBaseline] = await Promise.all([
    pc.readContract({
      address: pool,
      abi: fakeLendingPoolAbi,
      functionName: "getAssetPrice",
      args: [oracleAsset],
      ...blockTag,
    }).catch(() => 0n),
    pc.readContract({
      address: pool,
      abi: fakeLendingPoolAbi,
      functionName: "getAssetPrice",
      args: [oracleAsset],
      ...oracleBaselineTag,
    }).catch(() => 0n),
  ]);
  const oracle: OracleSnapshot = {
    poolPrice: poolPrice as bigint,
    chainlinkPrice: poolPriceBaseline as bigint, // placeholder — replaced when feeds wired
    twapPrice: poolPriceBaseline as bigint,
    decimals: 8,
  };

  // Tier 3: vector lookup against 0G Storage KV.
  const featureKey = featureFingerprint(raw, args);
  const vectorMatch: VectorMatch | null = await kvLookupNearest(featureKey).catch(() => null);

  // Tier 4: classifier — skipped when caller hints early-exit, or when
  // tier-1 already has an admin-sweep / reentrancy short-circuit signal
  // (hydrate doesn't actually run detect; the caller does that. The
  // skipClassifier hint mirrors the §6 short-circuit semantics).
  const willShortCircuitTier1 =
    (selector === SELECTOR_WITHDRAW_RESERVES && fromIsAdmin) ||
    (selector === SELECTOR_WITHDRAW &&
      txAmount !== null &&
      txAmount > 0n &&
      (poolReservePrev as bigint) > 0n &&
      (poolReserve as bigint) <= (poolReservePrev as bigint) &&
      (poolReservePrev as bigint) - (poolReserve as bigint) >
        txAmount + (txAmount * 500n) / 10_000n);

  let classifier: ClassifierReceipt | null = null;
  if (!opts.skipClassifier && !willShortCircuitTier1) {
    classifier = await callClassifier({
      raw,
      args,
      functionName,
      invariants,
    }).catch(() => null);
  }

  return {
    txHash: raw.hash,
    blockNumber: raw.blockNumber,
    from: raw.from,
    to: raw.to,
    value: raw.value,
    selector,
    functionName,
    args,
    calldata: raw.input,
    invariants,
    oracle,
    vectorMatch,
    classifier,
  };
}

function extractAsset(
  functionName: string | null,
  args: readonly unknown[],
): Address | null {
  if (!functionName) return null;
  // supply/borrow/withdraw/setAssetPrice/withdrawReserves all put asset at args[0].
  // liquidate(user, asset) puts it at args[1].
  if (functionName === "liquidate") {
    return (args[1] as Address | undefined) ?? null;
  }
  return (args[0] as Address | undefined) ?? null;
}

function extractAmount(
  functionName: string | null,
  args: readonly unknown[],
): bigint | null {
  if (!functionName || !AMOUNT_BEARING_SELECTORS.has(functionName)) return null;
  const a = args[1];
  return typeof a === "bigint" ? a : null;
}

/**
 * Fingerprint = `(selector, first-32-bytes-of-args, balance-delta-hash)`
 * (todo §6 tier 3). Balance delta is approximated from the value field
 * for native transfers; Track C's embedder uses the full decoded form.
 */
function featureFingerprint(raw: RawTx, args: readonly unknown[]): Hex {
  const selector = raw.input.slice(0, 10);
  const firstArg = args[0] !== undefined ? String(args[0]) : "";
  const secondArg = args[1] !== undefined ? String(args[1]) : "";
  return keccak256(toHex(`${selector}|${firstArg}|${secondArg}|${raw.value}`));
}

async function callClassifier(input: {
  raw: RawTx;
  args: readonly unknown[];
  functionName: string | null;
  invariants: InvariantSnapshot;
}): Promise<ClassifierReceipt | null> {
  const url = config().classifierUrl;
  // inference/server.py expects `{ features: <blob> }` — Pydantic model
  // ClassifyRequest.features: Any. The inner blob must match the schema
  // ml/prompt/template.py was fine-tuned on (caller/fn/decoded_args/
  // balance_delta), or _row_for_template coerces it to neutral defaults
  // and the model returns SAFE.
  const body = {
    features: buildClassifierFeatures({
      selector: input.raw.input.slice(0, 10) as Hex,
      functionName: input.functionName,
      args: input.args,
      fromIsAdmin: input.invariants.fromIsAdmin,
      invariants: input.invariants,
    }),
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as ClassifierReceipt;
  return j;
}
