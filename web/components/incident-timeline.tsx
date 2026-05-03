"use client";

import { useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Incident } from "@/lib/types";
import { AGENT_BASE_URL, PHULAX_ACCOUNT } from "@/lib/contracts";
import { cn, fmtTime } from "@/lib/utils";
import { CircleAlert, CircleCheck, CircleX, Flag } from "lucide-react";

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

export function IncidentTimeline({
  incidents,
  onLog,
  onMarkFp,
}: {
  incidents: Incident[];
  onLog: (msg: string) => void;
  onMarkFp: (id: string) => void;
}) {
  const [marking, setMarking] = useState<string | null>(null);

  const markFp = useCallback(
    async (i: Incident) => {
      if (!i.txHashFull) {
        onLog(`[fp] ${i.id} — no full tx hash on this incident, can't post`);
        return;
      }
      setMarking(i.id);
      try {
        const r = await fetch(`${AGENT_BASE_URL}/feedback`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            account: PHULAX_ACCOUNT,
            txHash: i.txHashFull,
            note: "user-marked false-positive from dashboard",
          }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        onLog(`[fp] marked ${i.txHash} as FP — written to 0G feedback log`);
        onMarkFp(i.id);
      } catch (err) {
        onLog(
          `[fp] failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setMarking(null);
      }
    },
    [onLog, onMarkFp],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Incident timeline</CardTitle>
        <span className="text-xs text-muted-foreground">
          0G Storage Log · /incidents/:account
        </span>
      </CardHeader>
      <CardContent>
        {incidents.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            no incidents yet — fire the demo attack to see one
          </div>
        ) : (
          <ol className="space-y-3">
            {incidents.map((i) => {
              const Icon = ICON[i.outcome];
              return (
                <li key={i.id} className="flex gap-3 text-sm">
                  <Icon
                    className={cn("h-4 w-4 mt-0.5 shrink-0", TONE[i.outcome])}
                  />
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
                    <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                      <span>
                        score {i.score.toFixed(2)} · tx {i.txHash}
                      </span>
                      {i.outcome === "fired" && i.txHashFull && (
                        <button
                          type="button"
                          onClick={() => markFp(i)}
                          disabled={marking !== null}
                          className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:bg-muted disabled:opacity-50"
                          title="mark this fire as a false-positive"
                        >
                          <Flag className="h-3 w-3" />
                          {marking === i.id ? "…" : "mark FP"}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
