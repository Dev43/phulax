"use client";

import { formatUnits } from "viem";
import { useReadContract } from "wagmi";
import { hubAbi, phulaxAccountAbi } from "@/contracts/abis";
import { HUB, PHULAX_ACCOUNT } from "@/lib/contracts";
import { OG_CHAIN_ID } from "@/lib/wagmi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { shortAddr } from "@/lib/utils";
import { ShieldCheck } from "lucide-react";

// On-chain readout of the guardian's authorization + policy. Replaces the
// Phase-1 "live withdraw / dry-run" toggle which never had a real backend.
//
// Three fields:
//   - agent role on PhulaxAccount (the only address allowed to call withdraw)
//   - threshold from Hub.policy(account) (bps; bps/10_000 = score floor)
//   - per-block cap (in pUSD; uint256.max → "uncapped")
export function AgentStatus() {
  const { data: agent } = useReadContract({
    address: PHULAX_ACCOUNT,
    abi: phulaxAccountAbi,
    functionName: "agent",
    chainId: OG_CHAIN_ID,
    query: { refetchInterval: 30_000 },
  });

  const { data: policy } = useReadContract({
    address: HUB,
    abi: hubAbi,
    functionName: "policy",
    args: [PHULAX_ACCOUNT],
    chainId: OG_CHAIN_ID,
    query: { refetchInterval: 30_000 },
  });

  const [thresholdBps, perBlockCap] = (policy as
    | readonly [number, bigint]
    | undefined) ?? [0, 0n];
  const thresholdScore = thresholdBps ? thresholdBps / 10_000 : null;
  const capFmt =
    perBlockCap === 0n
      ? "—"
      : perBlockCap > 2n ** 200n
        ? "uncapped"
        : `${Number(formatUnits(perBlockCap, 18)).toLocaleString()} pUSD`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Guardian status</CardTitle>
        <span className="text-xs text-muted-foreground">
          on-chain · Hub.policy + PhulaxAccount.agent
        </span>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Row
          label="agent role"
          value={
            agent && agent !== "0x0000000000000000000000000000000000000000" ? (
              <span className="flex items-center gap-1 font-mono text-xs">
                <ShieldCheck className="h-3 w-3 text-emerald-500" />
                {shortAddr(agent as string)}
              </span>
            ) : (
              <span className="font-mono text-xs text-warn">revoked</span>
            )
          }
        />
        <Row
          label="fire threshold"
          value={
            <span className="font-mono text-xs">
              {thresholdScore !== null
                ? `${thresholdScore.toFixed(2)} (${thresholdBps} bps)`
                : "—"}
            </span>
          }
        />
        <Row
          label="per-block cap"
          value={<span className="font-mono text-xs">{capFmt}</span>}
        />
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {value}
    </div>
  );
}
