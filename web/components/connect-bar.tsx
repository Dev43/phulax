"use client";

import { formatUnits } from "viem";
import { useAccount, useConnect, useDisconnect, useReadContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { shortAddr } from "@/lib/utils";
import { FAKE_POOL_ADAPTER, PHULAX_ACCOUNT } from "@/lib/contracts";
import { fakePoolAdapterAbi } from "@/contracts/abis";
import { Shield } from "lucide-react";

export function ConnectBar() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  // Per CLAUDE.md sharp edge: adapter owns the pool position, not the
  // PhulaxAccount. pool.balanceOf(asset, user) is always 0 for a Phulax-
  // protected user — the canonical position read is adapter.balanceOf(account).
  const { data: positionRaw } = useReadContract({
    address: FAKE_POOL_ADAPTER,
    abi: fakePoolAdapterAbi,
    functionName: "balanceOf",
    args: [PHULAX_ACCOUNT],
    query: { refetchInterval: 12_000 },
  });
  const position =
    typeof positionRaw === "bigint"
      ? `${Number(formatUnits(positionRaw, 18)).toLocaleString(undefined, {
          maximumFractionDigits: 4,
        })} pUSD`
      : "—";

  return (
    <header className="flex items-center justify-between border-b border-border bg-card/50 px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
          <Shield className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-semibold tracking-tight">Phulax</div>
          <div className="text-xs text-muted-foreground">guardian agent · 0G Galileo</div>
        </div>
      </div>

      <div className="flex items-center gap-6 text-sm">
        <div className="hidden md:flex flex-col items-end">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            PhulaxAccount
          </span>
          <span className="font-mono text-xs">{shortAddr(PHULAX_ACCOUNT)}</span>
        </div>
        <div className="hidden md:flex flex-col items-end">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Position
          </span>
          <span className="font-mono text-xs">{position}</span>
        </div>

        {isConnected ? (
          <Button variant="outline" size="sm" onClick={() => disconnect()}>
            {shortAddr(address)}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() =>
              connectors[0] ? connect({ connector: connectors[0] }) : undefined
            }
          >
            Connect wallet
          </Button>
        )}
      </div>
    </header>
  );
}
