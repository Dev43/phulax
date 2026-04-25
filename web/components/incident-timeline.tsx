"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Incident } from "@/lib/mock";
import { cn, fmtTime } from "@/lib/utils";
import { CircleAlert, CircleCheck, CircleX } from "lucide-react";

const ICON = {
  fired: CircleAlert,
  monitored: CircleCheck,
  fp: CircleX,
} as const;

const TONE = {
  fired: "text-danger",
  monitored: "text-primary",
  fp: "text-muted-foreground",
} as const;

export function IncidentTimeline({ incidents }: { incidents: Incident[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Incident timeline</CardTitle>
        <span className="text-xs text-muted-foreground">
          0G Storage Log · /incidents/:account
        </span>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {incidents.map((i) => {
            const Icon = ICON[i.outcome];
            return (
              <li key={i.id} className="flex gap-3 text-sm">
                <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", TONE[i.outcome])} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      {i.outcome === "fired"
                        ? "withdraw fired"
                        : i.outcome === "monitored"
                        ? "monitored"
                        : "false-positive"}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {fmtTime(i.ts)}
                    </span>
                  </div>
                  <div className="truncate">{i.reason}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    score {i.score.toFixed(2)} · tx {i.txHash}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
