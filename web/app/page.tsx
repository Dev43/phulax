"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectBar } from "@/components/connect-bar";
import { PositionCard } from "@/components/position-card";
import { RiskGauge } from "@/components/risk-gauge";
import { IncidentTimeline } from "@/components/incident-timeline";
import { LogStream, type LogLine } from "@/components/log-stream";
import { FeedbackToggle } from "@/components/feedback-toggle";
import { Button } from "@/components/ui/button";
import { Zap } from "lucide-react";
import {
  MOCK_INCIDENTS,
  fakeStreamTick,
  type Incident,
  type Signal,
} from "@/lib/mock";

const MAX_LOGS = 250;
const INITIAL_SIGNALS: Signal[] = [
  { name: "invariant", weight: 0.0, detail: "—" },
  { name: "oracle", weight: 0.0, detail: "—" },
  { name: "vector", weight: 0.0, detail: "—" },
  { name: "classifier", weight: 0.0, detail: "—" },
];

const AGENT_BASE_URL =
  process.env.NEXT_PUBLIC_AGENT_BASE_URL ?? "http://localhost:8787";

// Mirrors agent/src/bus.ts StreamEvent. Kept hand-rolled (no shared
// package) because the payload is small and the agent's TS lives in a
// different workspace.
type AgentEvent =
  | { kind: "log"; ts: number; level: "info" | "warn" | "fire"; msg: string }
  | { kind: "score"; ts: number; score: number; signals: Signal[] }
  | {
      kind: "incident";
      ts: number;
      txHash: string;
      account: string;
      score: number;
      outcome: "fired" | "monitored" | "fp";
      reason: string;
    };

export default function Home() {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [score, setScore] = useState(0.0);
  const [signals, setSignals] = useState<Signal[]>(INITIAL_SIGNALS);
  const [fired, setFired] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>(MOCK_INCIDENTS);
  const [streamConnected, setStreamConnected] = useState(false);
  const firingRef = useRef(false);

  const pushLogs = useCallback((next: LogLine[]) => {
    setLogs((prev) => {
      const merged = [...prev, ...next];
      return merged.length > MAX_LOGS ? merged.slice(-MAX_LOGS) : merged;
    });
  }, []);

  const onUserLog = useCallback(
    (msg: string) => pushLogs([{ ts: Date.now(), level: "info", msg }]),
    [pushLogs]
  );

  // Live SSE feed from agent/server.ts:GET /stream. Auto-reconnect is
  // built into EventSource; no manual retry loop. Falls back to the
  // mock-driven view if the agent is unreachable.
  useEffect(() => {
    const url = `${AGENT_BASE_URL}/stream`;
    const es = new EventSource(url);

    es.onopen = () => {
      setStreamConnected(true);
      pushLogs([
        {
          ts: Date.now(),
          level: "info",
          msg: `[stream] connected to ${url}`,
        },
      ]);
    };

    es.onerror = () => {
      // Browser auto-reconnects; just surface the state.
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
          if (firingRef.current) return;
          setScore(evt.score);
          setSignals(evt.signals);
          break;
        case "incident":
          setIncidents((prev) => [
            {
              id: `i_${evt.ts}`,
              ts: evt.ts,
              score: evt.score,
              outcome: evt.outcome,
              txHash: `${evt.txHash.slice(0, 6)}…${evt.txHash.slice(-4)}`,
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

  const triggerAttack = useCallback(() => {
    if (firingRef.current) return;
    firingRef.current = true;
    setFired(true);
    setScore(0.93);
    setSignals([
      { name: "invariant", weight: 0.6, detail: "share price NON-MONOTONIC ⚠" },
      { name: "oracle", weight: 0.2, detail: "Δ vs Chainlink = 4.1% ⚠" },
      { name: "vector", weight: 0.3, detail: "top-1 cluster=cream-2021 cos=0.91" },
      { name: "classifier", weight: 0.31, detail: "p_nefarious=0.94" },
    ]);
    const events = fakeStreamTick({ fire: true });
    const lines: LogLine[] = events
      .filter((e): e is Extract<typeof e, { kind: "log" }> => e.kind === "log")
      .map((e) => ({ ts: e.ts, level: e.level, msg: e.msg }));
    // stagger writes so the log scrolls visibly
    lines.forEach((line, i) => {
      setTimeout(() => pushLogs([line]), i * 220);
    });
    setTimeout(() => {
      setIncidents((prev) => [
        {
          id: `i_${Date.now()}`,
          ts: Date.now(),
          score: 0.93,
          outcome: "fired",
          txHash: "0x9af3…c12d",
          reason: "demo attack — vector match cream-2021 + classifier 0.94",
        },
        ...prev,
      ]);
    }, lines.length * 220 + 200);
    setTimeout(() => {
      firingRef.current = false;
      setFired(false);
    }, lines.length * 220 + 2000);
  }, [pushLogs]);

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
          <Button variant="danger" size="sm" onClick={triggerAttack} disabled={fired}>
            <Zap className="h-4 w-4" />
            {fired ? "attack in progress…" : "Demo: simulate attack"}
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="grid gap-6 md:grid-cols-2">
              <PositionCard onLog={onUserLog} />
              <RiskGauge score={score} signals={signals} fired={fired} />
            </div>
            <LogStream lines={logs} />
          </div>

          <div className="space-y-6">
            <FeedbackToggle onLog={onUserLog} />
            <IncidentTimeline incidents={incidents} />
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
          · agent <code>{AGENT_BASE_URL}</code> · simulate button is a local
          UI mock, not chain activity
        </footer>
      </main>
    </div>
  );
}
