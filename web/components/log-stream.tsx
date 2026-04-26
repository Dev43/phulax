"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, fmtTime } from "@/lib/utils";

export type LogLine = { ts: number; level: "info" | "warn" | "fire"; msg: string };

const TONE = {
  info: "text-foreground/70",
  warn: "text-warn",
  fire: "text-danger font-semibold",
} as const;

export function LogStream({ lines }: { lines: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>agent stream · /stream</CardTitle>
        <span className="text-xs font-mono text-primary">
          ● connected (mock)
        </span>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        <div
          ref={ref}
          className="log-scroller h-[420px] overflow-y-auto bg-black/40 px-4 py-3 font-mono text-[12px] leading-relaxed"
        >
          {lines.length === 0 ? (
            <div className="text-muted-foreground">waiting for events…</div>
          ) : (
            lines.map((l, i) => (
              <div key={i} className={cn("whitespace-pre-wrap", TONE[l.level])}>
                <span className="mr-2 text-muted-foreground">{fmtTime(l.ts)}</span>
                {l.msg}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
