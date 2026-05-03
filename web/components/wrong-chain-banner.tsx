"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { OG_CHAIN_ID } from "@/lib/wagmi";
import { Button } from "@/components/ui/button";
import { useEnsureOgChain } from "@/lib/chain";
import { AlertTriangle } from "lucide-react";

// Surfaced when the wallet is connected but on the wrong chain. Prevents
// "tx going to Ethereum mainnet" foot-guns where Rabby/MetaMask propose a
// signature on whatever chain they happen to be on.
export function WrongChainBanner() {
  const { isConnected } = useAccount();
  const { onWrongChain, currentChainId, ensure } = useEnsureOgChain();
  const { isPending } = useSwitchChain();

  if (!isConnected || !onWrongChain) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
      <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />
      <div className="flex-1 min-w-[260px]">
        Wallet is on chain{" "}
        <code className="font-mono">{currentChainId ?? "?"}</code>. Phulax
        runs on <strong>0G Galileo testnet</strong> (chain id{" "}
        <code className="font-mono">{OG_CHAIN_ID}</code>) — switch before
        sending any tx.
      </div>
      <Button
        size="sm"
        onClick={() => {
          ensure().catch(() => {});
        }}
        disabled={isPending}
      >
        {isPending ? "switching…" : "Switch to 0G Galileo"}
      </Button>
    </div>
  );
}
