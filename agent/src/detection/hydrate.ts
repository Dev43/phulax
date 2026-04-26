import { type Address, type Hex, decodeFunctionData, keccak256, toHex } from "viem";
import { fakeLendingPoolAbi } from "../abis/FakeLendingPool.js";
import { publicClient } from "../chain/clients.js";
import { config } from "../config.js";
import { kvLookupNearest } from "../og/kv.js";
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

export async function hydrate(
  raw: RawTx,
  prevSharePrice: bigint,
  opts: HydrateOptions = {},
): Promise<TxContext> {
  const pool = opts.pool ?? config().pool;
  const pc = publicClient();

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

  // Tier 1 reads (parallel)
  const [sharePrice, utilizationBps, totalSupply, totalReserves, totalBorrows] =
    await Promise.all([
      pc.readContract({ address: pool, abi: fakeLendingPoolAbi, functionName: "sharePrice", ...blockTag }),
      pc.readContract({ address: pool, abi: fakeLendingPoolAbi, functionName: "utilizationBps", ...blockTag }),
      pc.readContract({ address: pool, abi: fakeLendingPoolAbi, functionName: "totalSupply", ...blockTag }),
      pc.readContract({ address: pool, abi: fakeLendingPoolAbi, functionName: "totalReserves", ...blockTag }),
      pc.readContract({ address: pool, abi: fakeLendingPoolAbi, functionName: "totalBorrows", ...blockTag }),
    ]);
  const invariants: InvariantSnapshot = {
    sharePrice: sharePrice as bigint,
    prevSharePrice,
    utilizationBps: utilizationBps as bigint,
    totalSupply: totalSupply as bigint,
    totalReserves: totalReserves as bigint,
    totalBorrows: totalBorrows as bigint,
  };

  // Tier 2: oracle. The pool exposes an asset price for the asset arg
  // (when present); chainlink + TWAP feeds are placeholders that Track B
  // wires through real oracle adapters. For the demo replay, we read the
  // pool's getter at the block in question and set the references equal
  // to a baseline read at block-1. Replays override this via ctx directly.
  const asset = (args[0] as Address | undefined) ?? pool;
  const [poolPrice, poolPricePrev] = await Promise.all([
    pc.readContract({ address: pool, abi: fakeLendingPoolAbi, functionName: "getAssetPrice", args: [asset], ...blockTag })
      .catch(() => 0n),
    pc.readContract({
      address: pool,
      abi: fakeLendingPoolAbi,
      functionName: "getAssetPrice",
      args: [asset],
      blockNumber: raw.blockNumber - 1n,
    }).catch(() => 0n),
  ]);
  const oracle: OracleSnapshot = {
    poolPrice: poolPrice as bigint,
    chainlinkPrice: poolPricePrev as bigint, // placeholder — replaced when feeds wired
    twapPrice: poolPricePrev as bigint,
    decimals: 8,
  };

  // Tier 3: vector lookup against 0G Storage KV.
  const featureKey = featureFingerprint(raw, args);
  const vectorMatch: VectorMatch | null = await kvLookupNearest(featureKey).catch(() => null);

  // Tier 4: classifier — skipped when caller hints early-exit (rare path,
  // but keeps invariant breaks fast and offline).
  let classifier: ClassifierReceipt | null = null;
  if (!opts.skipClassifier) {
    classifier = await callClassifier({ raw, args, functionName }).catch(() => null);
  }

  return {
    txHash: raw.hash,
    blockNumber: raw.blockNumber,
    from: raw.from,
    to: raw.to,
    value: raw.value,
    selector: raw.input.slice(0, 10) as Hex,
    functionName,
    args,
    calldata: raw.input,
    invariants,
    oracle,
    vectorMatch,
    classifier,
  };
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
}): Promise<ClassifierReceipt | null> {
  const url = config().classifierUrl;
  const body = {
    selector: input.raw.input.slice(0, 10),
    function_name: input.functionName,
    args: input.args.map((a) => (typeof a === "bigint" ? a.toString() : a)),
    value: input.raw.value.toString(),
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(800),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as ClassifierReceipt;
  return j;
}
