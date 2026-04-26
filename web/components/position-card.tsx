"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { MOCK_BALANCE } from "@/lib/mock";

export function PositionCard({ onLog }: { onLog: (msg: string) => void }) {
  const [busy, setBusy] = useState<"deposit" | "withdraw" | null>(null);

  // Phase 1: stub. Phase 2 will call PhulaxAccount.deposit / withdraw via wagmi.
  const fire = (which: "deposit" | "withdraw") => {
    setBusy(which);
    onLog(
      which === "deposit"
        ? "[ui] deposit(adapter=fakePool, amount=1000) — phase-2 stub"
        : "[ui] withdraw(adapter=fakePool) — phase-2 stub"
    );
    setTimeout(() => setBusy(null), 700);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Position · FakeLendingPool</CardTitle>
        <span className="text-xs text-muted-foreground">via FakePoolAdapter</span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-3xl font-semibold tracking-tight">{MOCK_BALANCE}</div>
          <div className="text-xs text-muted-foreground">
            principal + 4.82% APY · agent fee 10% of yield
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={() => fire("deposit")}
            disabled={busy !== null}
          >
            <ArrowDownToLine className="h-4 w-4" />
            {busy === "deposit" ? "submitting…" : "Deposit"}
          </Button>
          <Button
            className="flex-1"
            variant="outline"
            onClick={() => fire("withdraw")}
            disabled={busy !== null}
          >
            <ArrowUpFromLine className="h-4 w-4" />
            {busy === "withdraw" ? "submitting…" : "Withdraw"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
