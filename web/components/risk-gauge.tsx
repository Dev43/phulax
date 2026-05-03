"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Signal } from "@/lib/types";
import { cn } from "@/lib/utils";

const THRESHOLD = 0.7;

export function RiskGauge({
  score,
  signals,
  fired,
}: {
  score: number;
  signals: Signal[];
  fired: boolean;
}) {
  const pct = Math.min(1, Math.max(0, score)) * 100;
  const tone =
    score >= THRESHOLD ? "danger" : score >= 0.4 ? "warn" : "primary";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live risk</CardTitle>
        <span
          className={cn(
            "text-xs font-mono",
            fired ? "text-danger animate-pulse-glow" : "text-muted-foreground"
          )}
        >
          {fired ? "● FIRING" : score >= THRESHOLD ? "● escalating" : "● monitoring"}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="font-mono text-5xl tabular-nums">
            {score.toFixed(2)}
          </div>
          <div className="text-xs text-muted-foreground pb-2">
            threshold {THRESHOLD.toFixed(2)}
          </div>
        </div>

        <div className="relative h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "absolute inset-y-0 left-0 transition-[width] duration-300",
              tone === "danger" && "bg-danger",
              tone === "warn" && "bg-warn",
              tone === "primary" && "bg-primary"
            )}
            style={{ width: `${pct}%` }}
          />
          <div
            className="absolute inset-y-0 w-px bg-foreground/40"
            style={{ left: `${THRESHOLD * 100}%` }}
            aria-label="threshold"
          />
        </div>

        <ul className="space-y-1.5 text-xs">
          {signals.map((s) => (
            <li key={s.name} className="flex items-baseline justify-between gap-3">
              <span className="font-mono uppercase text-muted-foreground w-20">
                {s.name}
              </span>
              <span className="flex-1 truncate text-foreground/80">
                {s.detail}
              </span>
              <span className="font-mono tabular-nums text-muted-foreground">
                +{s.weight.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
