"use client";

import { useEffect, useState } from "react";
import type { Incident, Signal } from "@/lib/types";
import { cn } from "@/lib/utils";

const HIGH_RISK_THRESHOLD = 0.5;
// Keep the banner visible long enough that judges can read it during a demo
// even if the score drops back to baseline a few seconds after a fire.
const STICKY_AFTER_FIRE_MS = 30_000;

/**
 * Prominent top-of-page banner that appears when the agent flags HIGH RISK
 * or has just fired a withdraw. Stays visible for ~30s after a fire so the
 * demo audience can actually catch it.
 */
export function RiskAlert({
  score,
  signals,
  fired,
  incidents,
}: {
  score: number;
  signals: Signal[];
  fired: boolean;
  incidents: Incident[];
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const lastFire = incidents.find((i) => i.outcome === "fired");
  const sinceFireMs = lastFire ? now - lastFire.ts : Number.POSITIVE_INFINITY;
  const recentFire = sinceFireMs < STICKY_AFTER_FIRE_MS;
  const highScore = score >= HIGH_RISK_THRESHOLD;

  if (!fired && !recentFire && !highScore) return null;

  const top = signals
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .find((s) => s.weight > 0);

  const headline = fired || recentFire
    ? "RISK HIGH — withdraw triggered"
    : "RISK HIGH — agent escalating";

  const subline = fired || recentFire
    ? lastFire
      ? `tier: ${lastFire.reason} · tx ${lastFire.txHash} · ${Math.max(0, Math.round(sinceFireMs / 1000))}s ago`
      : "fire signal received"
    : top
      ? `top signal: ${top.name} (+${top.weight.toFixed(2)}) — ${top.detail}`
      : `score ${score.toFixed(2)} above threshold ${HIGH_RISK_THRESHOLD.toFixed(2)}`;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "relative overflow-hidden rounded-lg border-2 px-5 py-4",
        "border-danger bg-danger/15 text-danger",
        "shadow-[0_0_24px_rgba(239,68,68,0.45)]",
        (fired || recentFire) && "animate-pulse-glow"
      )}
    >
      <div className="flex items-center gap-4">
        <span
          className="flex h-3 w-3 shrink-0 rounded-full bg-danger"
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="font-semibold tracking-wide uppercase text-sm">
            {headline}
          </div>
          <div className="font-mono text-xs opacity-90 truncate">
            {subline}
          </div>
        </div>
        <div className="font-mono text-2xl tabular-nums shrink-0">
          {score.toFixed(2)}
        </div>
      </div>
    </div>
  );
}
