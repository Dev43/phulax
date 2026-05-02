import { type Address, type Hex, encodeFunctionData } from "viem";
import { phulaxAccountAbi } from "../abis/PhulaxAccount.js";
import { config } from "../config.js";

/**
 * Webhook dispatcher.
 *
 * The agent does NOT sign the withdraw transaction. The on-chain `agent`
 * role on `PhulaxAccount` is held by KeeperHub's organization wallet
 * (Turnkey-custodied). When the risk aggregator decides to fire, this
 * module POSTs the (account, adapter, txHash, score, reason) tuple to a
 * KH webhook trigger; KH then runs `web3/write-contract` against
 * `PhulaxAccount.withdraw(adapter)` and appends a receipt to 0G Storage
 * (see `workflows/phulax-guardian.workflow.json`).
 *
 * The runtime container therefore has zero signing surface. The contract
 * still hard-locks `withdraw` to send funds to `owner`, so even a
 * compromised KH wallet cannot redirect funds — at worst it can pull a
 * user's position back to the user.
 */

/**
 * Pure helper kept around so the SSE event can show the calldata that
 * was dispatched (useful for replay tooling). No signing involved.
 */
export function encodeWithdraw(adapter: Address): Hex {
  return encodeFunctionData({
    abi: phulaxAccountAbi,
    functionName: "withdraw",
    args: [adapter],
  });
}

export interface WithdrawDispatch {
  /** KH-assigned run ID if returned, else empty string. */
  runId: string;
  /** Local timestamp of the webhook ack. */
  dispatchedAt: number;
}

export interface DispatchContext {
  /** Source attacker tx that triggered detection. */
  txHash?: Hex | undefined;
  /** Final risk score (0..1). */
  score?: number | undefined;
  /** Short human-readable trigger summary, e.g. tier-1 signal name. */
  reason?: string | undefined;
}

export async function executeWithdraw(
  account: Address,
  adapter: Address,
  ctx: DispatchContext = {},
): Promise<WithdrawDispatch> {
  const url = config().keeperHubWebhookUrl;
  if (!url) {
    throw new Error(
      "KH_WEBHOOK_URL is not set — cannot dispatch withdraw. Configure it to the Phulax Guardian workflow webhook URL in KeeperHub.",
    );
  }

  const body = {
    account,
    adapter,
    txHash: ctx.txHash,
    score: ctx.score,
    reason: ctx.reason,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`KH webhook ${res.status}: ${await res.text()}`);
  }

  let runId = "";
  try {
    const json = (await res.json()) as { id?: string; runId?: string };
    runId = json.runId ?? json.id ?? "";
  } catch {
    // Webhook may return an empty body — treat as accepted.
  }

  return { runId, dispatchedAt: Date.now() };
}
