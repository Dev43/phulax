"use client";

import { useCallback } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { OG_CHAIN_ID } from "@/lib/wagmi";

// Single chain-switch helper used by the wrong-chain banner. Wallets default
// to their currently-active chain (often Ethereum mainnet on a fresh
// install), so we surface a banner that blocks tx buttons until the user
// switches.
//
// Note on `chainId` strict-match: passing `chainId` to `writeContractAsync`
// causes wagmi to compare the connector's reported chain id against the
// target. With Rabby's injected provider that comparison lags behind the
// actual wallet state, so even a successfully-completed switch can race
// with the next write and throw `ChainMismatchError`. We work around it by
// gating writes behind `useChainId() === OG_CHAIN_ID` at the UI layer
// instead — the action buttons stay disabled until the chain matches.
export function useEnsureOgChain() {
  const chainId = useChainId();
  const { isConnected } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();

  const ensure = useCallback(async () => {
    if (chainId === OG_CHAIN_ID) return;
    if (!switchChainAsync) {
      throw new Error(
        `wallet is on chain ${chainId}; switch to ${OG_CHAIN_ID} (0G Galileo) manually`,
      );
    }
    await switchChainAsync({ chainId: OG_CHAIN_ID });
  }, [chainId, switchChainAsync]);

  return {
    ensure,
    isPending,
    onWrongChain: isConnected && chainId !== OG_CHAIN_ID,
    isReady: isConnected && chainId === OG_CHAIN_ID,
    currentChainId: chainId,
  };
}
