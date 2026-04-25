"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Button } from "@/components/ui/button";
import { shortAddr } from "@/lib/utils";
import { MOCK_ACCOUNT, MOCK_BALANCE } from "@/lib/mock";
import { Shield } from "lucide-react";

export function ConnectBar() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  const owner = address ?? "0x" + "0".repeat(38) + "FA"; // mock owner
  const phulaxAccount = MOCK_ACCOUNT;

  return (
    <header className="flex items-center justify-between border-b border-border bg-card/50 px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
          <Shield className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-semibold tracking-tight">Phulax</div>
          <div className="text-xs text-muted-foreground">guardian agent · 0G testnet</div>
        </div>
      </div>

      <div className="flex items-center gap-6 text-sm">
        <div className="hidden md:flex flex-col items-end">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            PhulaxAccount
          </span>
          <span className="font-mono text-xs">{shortAddr(phulaxAccount)}</span>
        </div>
        <div className="hidden md:flex flex-col items-end">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Position
          </span>
          <span className="font-mono text-xs">{MOCK_BALANCE}</span>
        </div>

        {isConnected ? (
          <Button variant="outline" size="sm" onClick={() => disconnect()}>
            {shortAddr(owner)}
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
