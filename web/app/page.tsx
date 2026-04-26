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
  { name: "invariant", weight: 0.0, detail: "share price monotonic ✓" },
  { name: "oracle", weight: 0.0, detail: "Δ vs Chainlink = 0.0%" },
  { name: "vector", weight: 0.0, detail: "no recent embed" },
  { name: "classifier", weight: 0.0, detail: "idle" },
];

export default function Home() {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [score, setScore] = useState(0.12);
  const [signals, setSignals] = useState<Signal[]>(INITIAL_SIGNALS);
  const [fired, setFired] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>(MOCK_INCIDENTS);
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

  // Phase 1 fake SSE — replaced in Phase 3 with EventSource against /stream.
  useEffect(() => {
    const id = setInterval(() => {
      if (firingRef.current) return;
      const events = fakeStreamTick();
      const newLogs: LogLine[] = [];
      for (const e of events) {
        if (e.kind === "log") newLogs.push({ ts: e.ts, level: e.level, msg: e.msg });
        else {
          setScore(e.score);
          setSignals(e.signals);
        }
      }
      if (newLogs.length) pushLogs(newLogs);
    }, 900);
    return () => clearInterval(id);
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
          phase-1 mock · data is synthetic · wire-up to <code>agent/server.ts</code> on
          Day 4 (track-E7)
        </footer>
      </main>
    </div>
  );
}
