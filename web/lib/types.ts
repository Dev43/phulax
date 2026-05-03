// Wire-types shared with the agent server. Mirrored from agent/src/bus.ts
// (StreamEvent / StreamSignal) and agent/src/og/log.ts (IncidentEntry). Kept
// hand-rolled — no shared package — because the surface is small and the
// agent lives in a different workspace.

export type SignalName = "invariant" | "oracle" | "vector" | "classifier";

export type Signal = {
  name: SignalName;
  weight: number;
  detail: string;
};

export type IncidentOutcome = "fired" | "monitored" | "fp";

export type Incident = {
  id: string;
  ts: number;
  score: number;
  outcome: IncidentOutcome;
  txHash: string;
  txHashFull?: `0x${string}`;
  reason: string;
};

// Mirrors agent/src/bus.ts StreamEvent shape exactly.
export type AgentEvent =
  | { kind: "log"; ts: number; level: "info" | "warn" | "fire"; msg: string }
  | { kind: "score"; ts: number; score: number; signals: Signal[] }
  | {
      kind: "incident";
      ts: number;
      txHash: `0x${string}`;
      account: `0x${string}`;
      score: number;
      outcome: IncidentOutcome;
      reason: string;
    };

// Mirrors agent/src/og/log.ts IncidentEntry shape (returned by GET /incidents/:account).
export type IncidentEntryWire = {
  ts: number;
  account: `0x${string}`;
  txHash: `0x${string}`;
  blockNumber: string;
  score: { value: number; signals: Array<{ kind: string; delta: number; detail: string }> };
  outcome: "fired" | "skipped";
  feedback?: { falsePositive: true; note?: string; ts: number };
};
