import type { Address, Hex } from "viem";

/**
 * TxContext is the *fully-hydrated* input to detect(). All chain reads,
 * vector lookups, and classifier calls happen upstream so detect() itself
 * is pure — same input → same Score, every time. This is what lets the
 * regression suite replay historical exploits through it (todo §6).
 */
export interface TxContext {
  txHash: Hex;
  blockNumber: bigint;
  from: Address;
  to: Address;
  value: bigint;
  /** 4-byte selector + abi-decoded args (see KeeperHub query-transactions). */
  selector: Hex;
  functionName: string | null;
  args: readonly unknown[];
  /** Raw calldata, used for vector embedding inputs. */
  calldata: Hex;

  /** Pool/account state at trigger.blockNumber, hydrated by the caller. */
  invariants: InvariantSnapshot;
  /** Oracle reads, hydrated by the caller. */
  oracle: OracleSnapshot;
  /** Top-1 cosine match from 0G Storage KV index (Track C populates). */
  vectorMatch: VectorMatch | null;
  /** Optional — classifier may be skipped on early-exit short-circuit. */
  classifier: ClassifierReceipt | null;
}

/**
 * Tier-1 (per-tx, real-pool-readable) invariant snapshot.
 *
 * The deployed FakeLendingPool exposes per-asset/per-user mappings only —
 * no pool-wide aggregates — so the original sharePrice/utilization/
 * accounting invariants from §6 cannot be checked here without off-chain
 * user enumeration. We replace them with two invariants that *do* map
 * to the deployed surface and the demo's vulns (todo §14 Review):
 *
 *   - Admin sweep (vuln #4): selector == `withdrawReserves` from admin EOA.
 *   - Reentrancy (vuln #2): for a `withdraw(asset, amount, to)`, the pool's
 *     ERC-20 reserve dropped by more than `amount` (with slack for other
 *     txs in the same block).
 *
 * Both are checkable per-tx with reads at blockN and blockN-1.
 */
export interface InvariantSnapshot {
  /** 4-byte selector of the tx — the admin-sweep rule keys off this. */
  selector: Hex;
  /** True when raw.from === pool.admin(). Required to confirm admin-sweep. */
  fromIsAdmin: boolean;
  /** Asset arg if present (args[0] for supply/borrow/withdraw/liquidate). */
  asset: Address | null;
  /** IERC20(asset).balanceOf(pool) at blockN. 0n when asset is null. */
  poolReserve: bigint;
  /** IERC20(asset).balanceOf(pool) at blockN-1. 0n when asset is null. */
  poolReservePrev: bigint;
  /** Decoded `amount` arg if the selector takes one. Null otherwise. */
  txAmount: bigint | null;
}

export interface OracleSnapshot {
  poolPrice: bigint;
  chainlinkPrice: bigint;
  twapPrice: bigint;
  /** All three priced in the same denomination (e.g. 1e8). */
  decimals: number;
}

export interface VectorMatch {
  exploitId: string;
  cosine: number;
  postmortemUrl: string | null;
}

export interface ClassifierReceipt {
  pNefarious: number;
  tag: string;
  inputHash: Hex;
  outputHash: Hex;
  modelHash: Hex;
  weightsCid: string;
  signature: Hex;
}

export type SignalKind =
  | "invariant.adminSweep"
  | "invariant.reentrancy"
  | "oracle.deviation"
  | "vector.similarity"
  | "classifier.nefarious";

export interface Signal {
  kind: SignalKind;
  /** Contribution to the aggregated score, before clamping. */
  delta: number;
  detail: string;
}

export interface Score {
  /** Clamped to [0,1]. */
  value: number;
  /** True when an invariant violation forced an early-exit short-circuit. */
  shortCircuited: boolean;
  signals: Signal[];
}
