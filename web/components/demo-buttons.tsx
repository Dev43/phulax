"use client";

import { useCallback, useState } from "react";
import { type Hex, parseEther } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { Button } from "@/components/ui/button";
import { Skull, Sparkles } from "lucide-react";

const POOL = (process.env.NEXT_PUBLIC_FAKE_POOL ??
  "0xb1DE7278b81e1Fd40027bDac751117AE960d8747") as Hex;
const PUSD = (process.env.NEXT_PUBLIC_DEMO_ASSET ??
  "0x21937016d3E3d43a0c2725F47cC56fcb2B51d615") as Hex;

// Pool functions we touch. Inlined as `const` arrays so wagmi can infer
// argument types per call without us shipping the full ABI in this file.
const POOL_ABI = [
  {
    type: "function",
    name: "supply",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setAssetPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "price", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const HUNDRED = parseEther("100"); // 100 pUSD
const FIFTY = parseEther("50"); // 50 pUSD
const ONE = parseEther("1"); // 1 pUSD
const NORMAL_PRICE = parseEther("1"); // 1e18
const INFLATED_PRICE = 10_000_000_000_000_000_000_000_000n; // 1e25 — 10^7x

type StepLabel = string;
type Status = "idle" | "running" | "done" | "error";

interface DemoButtonsProps {
  onLog: (msg: string) => void;
}

export function DemoButtons({ onLog }: DemoButtonsProps) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [running, setRunning] = useState<"benign" | "nefarious" | null>(null);
  const [step, setStep] = useState<StepLabel>("");

  const send = useCallback(
    async (
      label: StepLabel,
      to: Hex,
      // biome-ignore lint/suspicious/noExplicitAny: ABI fragments inferred per call
      abi: any,
      functionName: string,
      args: readonly unknown[],
    ): Promise<Hex> => {
      setStep(label);
      onLog(`[demo] ${label} — sending`);
      const hash = await writeContractAsync({
        address: to,
        abi,
        // biome-ignore lint/suspicious/noExplicitAny: see above
        functionName: functionName as any,
        // biome-ignore lint/suspicious/noExplicitAny: see above
        args: args as any,
        // 0G Galileo enforces a 2 gwei minimum priority fee. Without
        // explicitly setting maxPriorityFeePerGas the wallet's default
        // (often 1 wei or 1 gwei) is rejected: "gas tip cap 1, minimum
        // needed 2000000000". See CLAUDE.md sharp edges.
        maxPriorityFeePerGas: 2_000_000_000n,
      });
      onLog(`[demo] ${label} — tx ${hash.slice(0, 10)}…`);
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
        onLog(`[demo] ${label} — confirmed`);
      }
      return hash;
    },
    [onLog, publicClient, writeContractAsync],
  );

  const runBenign = useCallback(async () => {
    if (!address) {
      onLog("[demo] connect a wallet first");
      return;
    }
    setRunning("benign");
    try {
      onLog("[demo] benign sequence: mint → approve → supply → withdraw 1");

      // Skip mint if balance already sufficient.
      const bal = publicClient
        ? await publicClient.readContract({
            address: PUSD,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          })
        : 0n;
      if ((bal as bigint) < HUNDRED) {
        await send("mint 100 pUSD", PUSD, ERC20_ABI, "mint", [
          address,
          HUNDRED,
        ]);
      } else {
        onLog("[demo] mint skipped — balance already ≥ 100 pUSD");
      }

      // Skip approve if allowance already sufficient.
      const allowance = publicClient
        ? await publicClient.readContract({
            address: PUSD,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, POOL],
          })
        : 0n;
      if ((allowance as bigint) < HUNDRED) {
        await send("approve pool", PUSD, ERC20_ABI, "approve", [POOL, HUNDRED]);
      } else {
        onLog("[demo] approve skipped — allowance already ≥ 100 pUSD");
      }

      await send("supply 50 pUSD", POOL, POOL_ABI, "supply", [PUSD, FIFTY]);
      await send(
        "withdraw 1 pUSD (this is what the workflow catches)",
        POOL,
        POOL_ABI,
        "withdraw",
        [PUSD, ONE, address],
      );

      onLog("[demo] benign sequence done — expect outcome=monitored");
      setStep("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog(`[demo] benign failed: ${msg.split("\n")[0]}`);
      setStep("error");
    } finally {
      setRunning(null);
    }
  }, [address, onLog, publicClient, send]);

  const runNefarious = useCallback(async () => {
    if (!address) {
      onLog("[demo] connect a wallet first");
      return;
    }
    setRunning("nefarious");
    try {
      onLog("[demo] nefarious sequence: oracle inflate → drain → restore");
      await send(
        "inflate price 10⁷×",
        POOL,
        POOL_ABI,
        "setAssetPrice",
        [PUSD, INFLATED_PRICE],
      );
      await send(
        "drain 50 pUSD via inflated oracle (workflow should fire)",
        POOL,
        POOL_ABI,
        "withdraw",
        [PUSD, FIFTY, address],
      );
      await send(
        "restore price (cleanup)",
        POOL,
        POOL_ABI,
        "setAssetPrice",
        [PUSD, NORMAL_PRICE],
      );

      onLog("[demo] nefarious sequence done — expect outcome=fired");
      setStep("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog(`[demo] nefarious failed: ${msg.split("\n")[0]}`);
      setStep("error");
    } finally {
      setRunning(null);
    }
  }, [address, onLog, send]);

  const busy = running !== null;
  const disabled = !isConnected || busy;
  const label =
    running === "benign"
      ? `benign · ${step}`
      : running === "nefarious"
        ? `attack · ${step}`
        : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={runBenign}
        disabled={disabled}
      >
        <Sparkles className="h-4 w-4" />
        {running === "benign" ? `running… ${step}` : "Send benign tx"}
      </Button>
      <Button
        size="sm"
        variant="danger"
        onClick={runNefarious}
        disabled={disabled}
      >
        <Skull className="h-4 w-4" />
        {running === "nefarious" ? `attack… ${step}` : "Demo: simulate attack"}
      </Button>
      {label === null && !isConnected && (
        <span className="text-[11px] text-muted-foreground">
          connect wallet to enable
        </span>
      )}
    </div>
  );
}
