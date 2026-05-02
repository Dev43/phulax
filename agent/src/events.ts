import { EventEmitter } from "node:events";
import type { Address, Hex } from "viem";
import type { ClassifierReceipt, Score } from "./detection/types.js";

/**
 * In-process event bus for SSE fan-out. Scoped to one agent process —
 * this is *not* a database (todo §3 invariant: 0G Storage is the DB).
 * Drops if no subscribers; the durable record is the 0G Storage Log.
 */
export interface DetectionEvent {
  ts: number;
  account: Address;
  txHash: Hex;
  blockNumber: string;
  score: Score;
  receipt: ClassifierReceipt | null;
  outcome: "fired" | "skipped";
  // Dispatch ack from the KeeperHub webhook. The chain tx hash is not
  // known at dispatch time (KH signs and broadcasts asynchronously); the
  // resulting tx is recorded in the 0G Storage receipt log instead.
  fired?: { runId: string; dispatchedAt: number } | undefined;
}

class Bus extends EventEmitter {
  emitDetection(e: DetectionEvent): void {
    this.emit("detection", e);
  }
  onDetection(fn: (e: DetectionEvent) => void): () => void {
    this.on("detection", fn);
    return () => this.off("detection", fn);
  }
}

export const bus = new Bus();
bus.setMaxListeners(64);
