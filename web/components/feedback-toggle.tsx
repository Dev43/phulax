"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function FeedbackToggle({
  onLog,
}: {
  onLog: (msg: string) => void;
}) {
  const [dryRun, setDryRun] = useState(false);

  // Phase 3: POST /feedback to agent/server.ts
  const toggle = () => {
    const next = !dryRun;
    setDryRun(next);
    onLog(
      `[ui] POST /feedback { mode: ${next ? '"dry-run"' : '"live"'} } — phase-3 stub`
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent mode</CardTitle>
        <span className="text-xs text-muted-foreground">FP feedback → iNFT memory</span>
      </CardHeader>
      <CardContent>
        <button
          onClick={toggle}
          className={cn(
            "flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted",
            dryRun && "border-warn/40"
          )}
          aria-pressed={dryRun}
        >
          <span className="flex flex-col items-start">
            <span className="font-medium">
              {dryRun ? "Dry-run" : "Live withdraw"}
            </span>
            <span className="text-xs text-muted-foreground">
              {dryRun
                ? "alerts only — no on-chain action"
                : "withdraw on threshold breach"}
            </span>
          </span>
          <span
            className={cn(
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
              dryRun ? "bg-warn/60" : "bg-primary/70"
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                dryRun ? "translate-x-4" : "translate-x-0.5"
              )}
            />
          </span>
        </button>
      </CardContent>
    </Card>
  );
}
