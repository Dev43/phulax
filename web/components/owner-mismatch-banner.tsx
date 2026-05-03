"use client";

import { useAccount, useReadContract } from "wagmi";
import { phulaxAccountAbi } from "@/contracts/abis";
import { PHULAX_ACCOUNT } from "@/lib/contracts";
import { OG_CHAIN_ID } from "@/lib/wagmi";
import { shortAddr } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

// Surfaced when the connected wallet isn't `PhulaxAccount.owner()`. The
// contract gates `deposit/withdraw/setAgent/setAdapter/execute` on the
// owner, so a non-owner wallet hits a `NotOwner` revert at the wallet
// popup with no useful context. We catch it pre-flight.
export function OwnerMismatchBanner() {
  const { address, isConnected } = useAccount();

  const { data: owner } = useReadContract({
    address: PHULAX_ACCOUNT,
    abi: phulaxAccountAbi,
    functionName: "owner",
    chainId: OG_CHAIN_ID,
    query: { staleTime: 60_000 },
  });

  if (!isConnected || !address || !owner) return null;
  if ((owner as string).toLowerCase() === address.toLowerCase()) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
      <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />
      <div className="flex-1 min-w-[260px]">
        Connected wallet{" "}
        <code className="font-mono text-xs">{shortAddr(address)}</code> is{" "}
        <strong>not the owner</strong> of this PhulaxAccount. Deposit /
        withdraw will revert with{" "}
        <code className="font-mono text-xs">NotOwner</code>. Switch to{" "}
        <code className="font-mono text-xs">{shortAddr(owner as string)}</code>{" "}
        to act.
      </div>
    </div>
  );
}
