"use client";

import { useCallback } from "react";
import { useChainId, useSwitchChain } from "wagmi";
import { OG_CHAIN_ID } from "@/lib/wagmi";

// Single chain-switch helper used before every write tx. Wallets default to
// their currently-active chain (often Ethereum mainnet on a fresh install),
// so without an explicit switch the wallet's confirmation modal proposes a
// tx on the wrong network. We force-switch to 0G Galileo before signing.
export function useEnsureOgChain() {
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

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
    onWrongChain: chainId !== OG_CHAIN_ID,
    currentChainId: chainId,
  };
}
