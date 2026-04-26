import type { Address, Hex } from "viem";
import type { ClassifierReceipt, Score } from "../detection/types.js";
import { og } from "./http.js";

/**
 * 0G Storage Log = the agent's append-only audit trail.
 * Every fire writes one entry; replay/eval harness consumes them.
 */

export type IncidentEntry = {
  ts: number;
  account: Address;
  txHash: Hex;
  blockNumber: string; // bigint as string for JSON
  score: Score;
  receipt: ClassifierReceipt | null;
  outcome: "fired" | "skipped";
  /** Set on user-initiated FP marks via POST /feedback. */
  feedback?: { falsePositive: true; note?: string; ts: number };
};

const INCIDENT_LOG = "phulax.incidents";
const FEEDBACK_LOG = "phulax.feedback";

export async function appendIncident(e: IncidentEntry): Promise<void> {
  await og.post(`/log/${INCIDENT_LOG}/append`, serialize(e));
}

export async function listIncidents(account: Address): Promise<IncidentEntry[]> {
  try {
    const r = await og.get<{ entries: IncidentEntry[] }>(
      `/log/${INCIDENT_LOG}?account=${account}`,
    );
    return r.entries ?? [];
  } catch {
    return [];
  }
}

export async function appendFeedback(account: Address, txHash: Hex, note: string): Promise<void> {
  await og.post(`/log/${FEEDBACK_LOG}/append`, {
    ts: Date.now(),
    account,
    txHash,
    note,
    falsePositive: true,
  });
}

function serialize(e: IncidentEntry): unknown {
  return JSON.parse(
    JSON.stringify(e, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}
