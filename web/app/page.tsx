"use client";

import { useCallback, useEffect, useState } from "react";
import { ConnectBar } from "@/components/connect-bar";
import { DemoButtons } from "@/components/demo-buttons";
import { PositionCard } from "@/components/position-card";
import { RiskGauge } from "@/components/risk-gauge";
import { IncidentTimeline } from "@/components/incident-timeline";
import { LogStream, type LogLine } from "@/components/log-stream";
import { AgentStatus } from "@/components/agent-status";
import { AGENT_BASE_URL, PHULAX_ACCOUNT } from "@/lib/contracts";
import type {
  AgentEvent,
  Incident,
  IncidentEntryWire,
  Signal,
} from "@/lib/types";

const MAX_LOGS = 250;
const INITIAL_SIGNALS: Signal[] = [
  { name: "invariant", weight: 0.0, detail: "—" },
  { name: "oracle", weight: 0.0, detail: "—" },
  { name: "vector", weight: 0.0, detail: "—" },
  { name: "classifier", weight: 0.0, detail: "—" },
];

export default function Home() {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [score, setScore] = useState(0.0);
  const [signals, setSignals] = useState<Signal[]>(INITIAL_SIGNALS);
  const [fired, setFired] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [streamConnected, setStreamConnected] = useState(false);

  const pushLogs = useCallback((next: LogLine[]) => {
    setLogs((prev) => {
      const merged = [...prev, ...next];
      return merged.length > MAX_LOGS ? merged.slice(-MAX_LOGS) : merged;
    });
  }, []);

  const onUserLog = useCallback(
    (msg: string) => pushLogs([{ ts: Date.now(), level: "info", msg }]),
    [pushLogs],
  );

  // Initial backfill from 0G Storage Log via the agent service. The SSE
  // stream below only delivers new incidents; this gives history on cold
  // load. Failures are silent — empty timeline is acceptable.
  useEffect(() => {
    const url = `${AGENT_BASE_URL}/incidents/${PHULAX_ACCOUNT}`;
    let cancelled = false;
    fetch(url)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: IncidentEntryWire[] | { entries?: IncidentEntryWire[] }) => {
        if (cancelled) return;
        const entries = Array.isArray(data)
          ? data
          : Array.isArray(data?.entries)
            ? data.entries
            : [];
        setIncidents(
          entries
            .map(toIncident)
            .sort((a, b) => b.ts - a.ts),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Live SSE feed from agent/server.ts:GET /stream. EventSource auto-
  // reconnects on its own; we just surface the open/error transitions.
  useEffect(() => {
    const url = `${AGENT_BASE_URL}/stream`;
    const es = new EventSource(url);

    es.onopen = () => {
      setStreamConnected(true);
      pushLogs([
        { ts: Date.now(), level: "info", msg: `[stream] connected ${url}` },
      ]);
    };

    es.onerror = () => {
      setStreamConnected(false);
    };

    es.onmessage = (msg) => {
      let evt: AgentEvent;
      try {
        evt = JSON.parse(msg.data) as AgentEvent;
      } catch {
        return;
      }
      switch (evt.kind) {
        case "log":
          pushLogs([{ ts: evt.ts, level: evt.level, msg: evt.msg }]);
          break;
        case "score":
          setScore(evt.score);
          setSignals(evt.signals);
          break;
        case "incident":
          setIncidents((prev) => [
            {
              id: `i_${evt.ts}_${evt.txHash.slice(2, 10)}`,
              ts: evt.ts,
              score: evt.score,
              outcome: evt.outcome,
              txHash: `${evt.txHash.slice(0, 6)}…${evt.txHash.slice(-4)}`,
              txHashFull: evt.txHash,
              reason: evt.reason,
            },
            ...prev,
          ]);
          if (evt.outcome === "fired") {
            setFired(true);
            setTimeout(() => setFired(false), 4000);
          }
          break;
      }
    };

    return () => es.close();
  }, [pushLogs]);

  const markFp = useCallback((id: string) => {
    setIncidents((prev) =>
      prev.map((i) => (i.id === id ? { ...i, outcome: "fp" } : i)),
    );
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <ConnectBar />

      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Guardian dashboard
            </h1>
            <p className="text-sm text-muted-foreground">
              one screen · one job · make the agent's thinking visible
            </p>
          </div>
          <DemoButtons onLog={onUserLog} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="grid gap-6 md:grid-cols-2">
              <PositionCard onLog={onUserLog} />
              <RiskGauge score={score} signals={signals} fired={fired} />
            </div>
            <LogStream lines={logs} connected={streamConnected} />
          </div>

          <div className="space-y-6">
            <AgentStatus />
            <IncidentTimeline
              incidents={incidents}
              onLog={onUserLog}
              onMarkFp={markFp}
            />
          </div>
        </div>

        <footer className="pt-4 text-center text-[11px] text-muted-foreground">
          stream:{" "}
          <span
            className={
              streamConnected ? "text-emerald-500" : "text-amber-500"
            }
          >
            {streamConnected ? "● live" : "○ disconnected"}
          </span>{" "}
          · agent <code>{AGENT_BASE_URL}</code> · all txs broadcast to 0G
          Galileo (chain 16602)
        </footer>
      </main>
    </div>
  );
}

// Map agent/og/log.ts IncidentEntry → web Incident. The wire shape carries
// the structured Score; we collapse it to the highest-delta signal as the
// human-readable reason and keep the rest in the log stream.
function toIncident(e: IncidentEntryWire): Incident {
  const top = e.score?.signals
    ?.slice()
    .sort((a, b) => b.delta - a.delta)[0];
  const reason = top?.detail ?? `score ${e.score?.value?.toFixed(2) ?? "—"}`;
  const outcome: Incident["outcome"] = e.feedback?.falsePositive
    ? "fp"
    : e.outcome === "fired"
      ? "fired"
      : "monitored";
  return {
    id: `i_${e.ts}_${e.txHash.slice(2, 10)}`,
    ts: e.ts,
    score: e.score?.value ?? 0,
    outcome,
    txHash: `${e.txHash.slice(0, 6)}…${e.txHash.slice(-4)}`,
    txHashFull: e.txHash,
    reason,
  };
}
