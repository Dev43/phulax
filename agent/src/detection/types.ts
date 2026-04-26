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

export interface InvariantSnapshot {
  sharePrice: bigint;
  prevSharePrice: bigint;
  utilizationBps: bigint;
  totalSupply: bigint;
  totalReserves: bigint;
  totalBorrows: bigint;
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
  | "invariant.sharePrice"
  | "invariant.utilization"
  | "invariant.accounting"
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
