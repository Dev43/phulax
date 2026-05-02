import { EventEmitter } from "node:events";
import type { Address, Hex } from "viem";
import type { Score } from "./detection/types.js";

/**
 * In-process event bus for SSE fan-out to the web dashboard. Emitted by
 * `/detect-features` and `/decide`; subscribed by `/stream`. Drops if no
 * subscribers — durable record is the 0G Storage Log via appendIncident().
 *
 * Three event kinds map onto the web's mock data shape so the dashboard
 * code path didn't have to learn a new contract:
 *   - "score":    rolling risk gauge update + per-tier signal breakdown
 *   - "log":      one human-readable line for the streaming log panel
 *   - "incident": prepend to the timeline (one fire-or-skip per block run)
 */

export type StreamSignalName =
  | "invariant"
  | "oracle"
  | "vector"
  | "classifier";

export interface StreamSignal {
  name: StreamSignalName;
  weight: number;
  detail: string;
}

export type StreamEvent =
  | {
      kind: "log";
      ts: number;
      level: "info" | "warn" | "fire";
      msg: string;
    }
  | {
      kind: "score";
      ts: number;
      score: number;
      signals: StreamSignal[];
    }
  | {
      kind: "incident";
      ts: number;
      txHash: Hex;
      account: Address;
      score: number;
      outcome: "fired" | "monitored" | "fp";
      reason: string;
    };

class Bus extends EventEmitter {
  emit_(e: StreamEvent): void {
    this.emit("stream", e);
  }
  on_(fn: (e: StreamEvent) => void): () => void {
    this.on("stream", fn);
    return () => this.off("stream", fn);
  }
}

export const bus = new Bus();
bus.setMaxListeners(128);

const KIND_TO_NAME: Record<string, StreamSignalName> = {
  "invariant.adminSweep": "invariant",
  "invariant.reentrancy": "invariant",
  "oracle.deviation": "oracle",
  "vector.similarity": "vector",
  "classifier.nefarious": "classifier",
};

const EMPTY_SIGNALS: StreamSignal[] = [
  { name: "invariant", weight: 0, detail: "—" },
  { name: "oracle", weight: 0, detail: "—" },
  { name: "vector", weight: 0, detail: "—" },
  { name: "classifier", weight: 0, detail: "—" },
];

export function scoreToSignals(score: Score | null): StreamSignal[] {
  if (!score) return EMPTY_SIGNALS.map((s) => ({ ...s }));
  const map: Record<StreamSignalName, StreamSignal> = {
    invariant: { name: "invariant", weight: 0, detail: "—" },
    oracle: { name: "oracle", weight: 0, detail: "—" },
    vector: { name: "vector", weight: 0, detail: "—" },
    classifier: { name: "classifier", weight: 0, detail: "—" },
  };
  for (const s of score.signals) {
    const name = KIND_TO_NAME[s.kind];
    if (!name) continue;
    if (s.delta > map[name].weight) {
      map[name].weight = s.delta;
      map[name].detail = s.detail;
    }
  }
  return [map.invariant, map.oracle, map.vector, map.classifier];
}
