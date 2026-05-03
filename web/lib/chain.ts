"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { OG_CHAIN_ID } from "@/lib/wagmi";

// Why this file talks to `window.ethereum` directly instead of wagmi:
//
// wagmi's `useChainId()` reflects its own connector state machine, which on
// Rabby's injected provider lags the wallet's real `eth_chainId`. We had
// banners that didn't show + writes pinned to chainId throwing
// `ChainMismatchError` — both rooted in the same lag. The fix is to use
// EIP-1193 directly: it's the source of truth for what the wallet will
// actually sign on, and it's exactly what Rabby reports in its own popup.

const OG_CHAIN_ID_HEX = `0x${OG_CHAIN_ID.toString(16)}`;
const OG_RPC =
  process.env.NEXT_PUBLIC_OG_RPC ?? "https://evmrpc-testnet.0g.ai";
const OG_EXPLORER = "https://chainscan-galileo.0g.ai";

// Don't redeclare `Window['ethereum']` — wagmi/viem already declare it as
// `any`, and TypeScript's "subsequent property declarations must match"
// rule rejects a tighter type. We type-assert at the use site instead.
interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
}

function provider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  const eth = (window as any).ethereum;
  return eth ?? null;
}

async function readWalletChainId(): Promise<number | null> {
  const eth = provider();
  if (!eth) return null;
  try {
    const hex = (await eth.request({ method: "eth_chainId" })) as string;
    return parseInt(hex, 16);
  } catch {
    return null;
  }
}

async function switchOrAdd(): Promise<void> {
  const eth = provider();
  if (!eth) throw new Error("no injected wallet (window.ethereum)");

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: OG_CHAIN_ID_HEX }],
    });
    return;
  } catch (err) {
    // 4902 = chain not added to wallet. Fall through to addEthereumChain.
    // Rabby surfaces an unrecognized-chain message; MetaMask returns 4902.
    const code = (err as { code?: number })?.code;
    if (code !== 4902 && code !== -32603) throw err;
  }

  await eth.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: OG_CHAIN_ID_HEX,
        chainName: "0G Galileo Testnet",
        nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
        rpcUrls: [OG_RPC],
        blockExplorerUrls: [OG_EXPLORER],
      },
    ],
  });
}

// Hook returns: live wallet-chain state for UI gating + an `ensure()` action
// that switches (or adds) the chain and waits for confirmation before
// resolving. UI gates should branch on `onWrongChain`; click handlers should
// `await ensure()` before issuing writes.
export function useEnsureOgChain() {
  const { isConnected } = useAccount();
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Subscribe to chainChanged + bootstrap. The injected provider fires
  // `chainChanged` after a successful switch; otherwise we only know via
  // the next eth_chainId read.
  useEffect(() => {
    let cancelled = false;
    const eth = provider();
    if (!eth) {
      setWalletChainId(null);
      return;
    }
    readWalletChainId().then((id) => {
      if (!cancelled) setWalletChainId(id);
    });
    const onChange = (...args: unknown[]) => {
      const hex = args[0];
      if (typeof hex === "string") setWalletChainId(parseInt(hex, 16));
    };
    eth.on?.("chainChanged", onChange);
    return () => {
      cancelled = true;
      eth.removeListener?.("chainChanged", onChange);
    };
  }, [isConnected]);

  const ensure = useCallback(async () => {
    if (walletChainId === OG_CHAIN_ID) return;
    setIsPending(true);
    try {
      await switchOrAdd();
      // chainChanged fires asynchronously; poll briefly so callers don't
      // hand off to a write before the wallet has actually switched.
      const deadline = Date.now() + 4_000;
      while (Date.now() < deadline) {
        const id = await readWalletChainId();
        if (id === OG_CHAIN_ID) {
          setWalletChainId(id);
          return;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      const final = await readWalletChainId();
      setWalletChainId(final);
      if (final !== OG_CHAIN_ID) {
        throw new Error(
          `wallet did not switch to chain ${OG_CHAIN_ID} (still on ${final ?? "?"})`,
        );
      }
    } finally {
      setIsPending(false);
    }
  }, [walletChainId]);

  return {
    ensure,
    isPending,
    onWrongChain: isConnected && walletChainId !== null && walletChainId !== OG_CHAIN_ID,
    isReady: isConnected && walletChainId === OG_CHAIN_ID,
    currentChainId: walletChainId,
  };
}
