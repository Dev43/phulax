import { type Address, type Hex, encodeFunctionData } from "viem";
import { phulaxAccountAbi } from "../abis/PhulaxAccount.js";
import { agentWallet, publicClient } from "../chain/clients.js";

/**
 * Single-selector executor.
 *
 * The agent's hot key has authority over **exactly one selector**:
 *   PhulaxAccount.withdraw(address adapter)
 *
 * The contract (Track B) enforces that recipient is hardcoded to `owner`,
 * so the worst the agent can do is force a no-op withdraw against the wrong
 * adapter. This module is the only place in agent/ that signs anything;
 * importing it from a non-exec/ module is a smell and should be flagged
 * in code review.
 */
export function encodeWithdraw(adapter: Address): Hex {
  return encodeFunctionData({
    abi: phulaxAccountAbi,
    functionName: "withdraw",
    args: [adapter],
  });
}

export interface WithdrawResult {
  txHash: Hex;
  blockNumber: bigint;
}

export async function executeWithdraw(
  account: Address,
  adapter: Address,
): Promise<WithdrawResult> {
  const wallet = agentWallet();
  const data = encodeWithdraw(adapter);
  // viem's `sendTransaction` allows arbitrary `to+data`. We restrict
  // ourselves to the withdraw selector by construction (above) — never
  // accept calldata from outside this module.
  const txHash = await wallet.sendTransaction({
    to: account,
    data,
    chain: wallet.chain,
    account: wallet.account!,
  });
  const receipt = await publicClient().waitForTransactionReceipt({ hash: txHash });
  return { txHash, blockNumber: receipt.blockNumber };
}
