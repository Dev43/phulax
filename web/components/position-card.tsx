"use client";

import { useCallback, useState } from "react";
import { formatUnits, parseEther } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import {
  demoAssetAbi,
  fakePoolAdapterAbi,
  phulaxAccountAbi,
} from "@/contracts/abis";
import {
  DEMO_ASSET,
  FAKE_POOL_ADAPTER,
  MIN_PRIORITY_FEE,
  PHULAX_ACCOUNT,
} from "@/lib/contracts";
import { OG_CHAIN_ID } from "@/lib/wagmi";
import { useEnsureOgChain } from "@/lib/chain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowDownToLine, ArrowUpFromLine, Coins } from "lucide-react";

const DEPOSIT_AMOUNT = parseEther("100"); // 100 pUSD per click — same scale as demo-buttons

type Busy = "mint" | "deposit" | "withdraw" | null;

export function PositionCard({ onLog }: { onLog: (msg: string) => void }) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: OG_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const { ensure: ensureOgChain, isReady: chainReady } = useEnsureOgChain();
  const [busy, setBusy] = useState<Busy>(null);

  // Adapter holds the user's pool position — pool.balanceOf(asset, user) is
  // always 0 for a Phulax-protected user (CLAUDE.md sharp edge).
  const { data: positionRaw, refetch: refetchPosition } = useReadContract({
    address: FAKE_POOL_ADAPTER,
    abi: fakePoolAdapterAbi,
    functionName: "balanceOf",
    args: [PHULAX_ACCOUNT],
    chainId: OG_CHAIN_ID,
    query: { refetchInterval: 12_000 },
  });

  // Owner's wallet pUSD balance — drives the "Mint pUSD" hint.
  const { data: walletRaw, refetch: refetchWallet } = useReadContract({
    address: DEMO_ASSET,
    abi: demoAssetAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: OG_CHAIN_ID,
    query: { enabled: Boolean(address), refetchInterval: 12_000 },
  });

  // PhulaxAccount.deposit/withdraw are onlyOwner. Pre-gate the buttons
  // so a non-owner wallet doesn't hit a `NotOwner` revert at the wallet
  // popup with no context. The full message lives in OwnerMismatchBanner.
  const { data: ownerRaw } = useReadContract({
    address: PHULAX_ACCOUNT,
    abi: phulaxAccountAbi,
    functionName: "owner",
    chainId: OG_CHAIN_ID,
    query: { staleTime: 60_000 },
  });
  const isOwner =
    Boolean(address) &&
    typeof ownerRaw === "string" &&
    ownerRaw.toLowerCase() === address!.toLowerCase();

  const position = (positionRaw as bigint | undefined) ?? 0n;
  const wallet = (walletRaw as bigint | undefined) ?? 0n;
  const positionFmt = `${Number(formatUnits(position, 18)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  })} pUSD`;
  const walletFmt = `${Number(formatUnits(wallet, 18)).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })} pUSD`;

  const sendTx = useCallback(
    async (label: string, hash: `0x${string}`) => {
      onLog(`[ui] ${label} — tx ${hash.slice(0, 10)}…`);
      if (!publicClient) return;
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      onLog(
        `[ui] ${label} — ${receipt.status === "success" ? "confirmed" : "failed"} block=${receipt.blockNumber}`,
      );
    },
    [onLog, publicClient],
  );

  const mint = useCallback(async () => {
    if (!address) return;
    setBusy("mint");
    try {
      await ensureOgChain();
      const hash = await writeContractAsync({
        address: DEMO_ASSET,
        abi: demoAssetAbi,
        functionName: "mint",
        args: [address, DEPOSIT_AMOUNT],
        maxPriorityFeePerGas: MIN_PRIORITY_FEE,
      });
      await sendTx("mint 100 pUSD", hash);
      await refetchWallet();
    } catch (err) {
      onLog(`[ui] mint failed: ${shortErr(err)}`);
    } finally {
      setBusy(null);
    }
  }, [address, ensureOgChain, onLog, refetchWallet, sendTx, writeContractAsync]);

  const deposit = useCallback(async () => {
    if (!address || !publicClient) return;
    setBusy("deposit");
    try {
      await ensureOgChain();
      // Approve PhulaxAccount to pull pUSD from owner if allowance is short.
      const allowance = (await publicClient.readContract({
        address: DEMO_ASSET,
        abi: demoAssetAbi,
        functionName: "allowance",
        args: [address, PHULAX_ACCOUNT],
      })) as bigint;

      if (allowance < DEPOSIT_AMOUNT) {
        const approveHash = await writeContractAsync({
          address: DEMO_ASSET,
          abi: demoAssetAbi,
          functionName: "approve",
          args: [PHULAX_ACCOUNT, DEPOSIT_AMOUNT],
          maxPriorityFeePerGas: MIN_PRIORITY_FEE,
        });
        await sendTx("approve PhulaxAccount", approveHash);
      } else {
        onLog("[ui] approve skipped — allowance already sufficient");
      }

      const depositHash = await writeContractAsync({
        address: PHULAX_ACCOUNT,
        abi: phulaxAccountAbi,
        functionName: "deposit",
        args: [FAKE_POOL_ADAPTER, DEPOSIT_AMOUNT],
        maxPriorityFeePerGas: MIN_PRIORITY_FEE,
      });
      await sendTx("PhulaxAccount.deposit(adapter, 100 pUSD)", depositHash);
      await Promise.all([refetchPosition(), refetchWallet()]);
    } catch (err) {
      onLog(`[ui] deposit failed: ${shortErr(err)}`);
    } finally {
      setBusy(null);
    }
  }, [
    address,
    ensureOgChain,
    onLog,
    publicClient,
    refetchPosition,
    refetchWallet,
    sendTx,
    writeContractAsync,
  ]);

  const withdraw = useCallback(async () => {
    if (!address) return;
    setBusy("withdraw");
    try {
      await ensureOgChain();
      const hash = await writeContractAsync({
        address: PHULAX_ACCOUNT,
        abi: phulaxAccountAbi,
        functionName: "withdraw",
        args: [FAKE_POOL_ADAPTER],
        maxPriorityFeePerGas: MIN_PRIORITY_FEE,
      });
      await sendTx("PhulaxAccount.withdraw(adapter)", hash);
      await Promise.all([refetchPosition(), refetchWallet()]);
    } catch (err) {
      onLog(`[ui] withdraw failed: ${shortErr(err)}`);
    } finally {
      setBusy(null);
    }
  }, [
    address,
    ensureOgChain,
    onLog,
    refetchPosition,
    refetchWallet,
    sendTx,
    writeContractAsync,
  ]);

  // Strict-gate writes on `chainReady` (wallet's actual eth_chainId === 16602),
  // not just `isConnected`. Without this we'd let the user click Mint while
  // the wallet is on Ethereum, and the tx would land on the wrong chain.
  // Mint stays open to any wallet (DemoAsset.mint is permissionless), but
  // deposit/withdraw need ownership over PhulaxAccount.
  const baseDisabled = !isConnected || busy !== null || !chainReady;
  const ownerOnlyDisabled = baseDisabled || !isOwner;
  const needsMint = isConnected && wallet < DEPOSIT_AMOUNT;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Position · FakeLendingPool</CardTitle>
        <span className="text-xs text-muted-foreground">via FakePoolAdapter</span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-3xl font-semibold tracking-tight">
            {positionFmt}
          </div>
          <div className="text-xs text-muted-foreground">
            {!isConnected ? (
              "connect a wallet to deposit"
            ) : !chainReady ? (
              <span className="text-warn">switch to 0G Galileo to act</span>
            ) : (
              <>
                wallet {walletFmt} · adapter {FAKE_POOL_ADAPTER.slice(0, 6)}…
                {FAKE_POOL_ADAPTER.slice(-4)}
              </>
            )}
          </div>
        </div>

        {needsMint && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={mint}
            disabled={baseDisabled}
          >
            <Coins className="h-4 w-4" />
            {busy === "mint" ? "minting…" : "Mint 100 pUSD"}
          </Button>
        )}

        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={deposit}
            disabled={ownerOnlyDisabled || wallet < DEPOSIT_AMOUNT}
            title={
              !isOwner && isConnected
                ? "connected wallet is not the PhulaxAccount owner"
                : wallet < DEPOSIT_AMOUNT
                  ? "mint pUSD first"
                  : undefined
            }
          >
            <ArrowDownToLine className="h-4 w-4" />
            {busy === "deposit" ? "depositing…" : "Deposit 100"}
          </Button>
          <Button
            className="flex-1"
            variant="outline"
            onClick={withdraw}
            disabled={ownerOnlyDisabled || position === 0n}
            title={
              !isOwner && isConnected
                ? "connected wallet is not the PhulaxAccount owner"
                : undefined
            }
          >
            <ArrowUpFromLine className="h-4 w-4" />
            {busy === "withdraw" ? "withdrawing…" : "Withdraw"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function shortErr(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split("\n")[0].slice(0, 140);
}
