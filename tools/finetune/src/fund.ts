import { formatEther, parseEther } from "ethers";
import { openBroker } from "./broker.js";

const NEURON_PER_ZG = 10n ** 18n;

export type FundOptions = {
  provider: string;
  ledgerZG: number;
  subAccountZG: number;
  dryRun?: boolean | undefined;
};

/**
 * Idempotent funding for a fine-tuning job.
 *
 * 1. Ensures a Ledger exists for this wallet (addLedger if not).
 * 2. Tops up the main Ledger to >= ledgerZG.
 * 3. Acknowledges the provider's TEE signer (required before transferFund).
 * 4. Tops up the provider sub-account to >= subAccountZG.
 *
 * Re-runnable without overpaying — every step checks current balance first.
 */
export async function fund(opts: FundOptions): Promise<void> {
  const { broker, address } = await openBroker();

  const subAccountTarget = parseEther(opts.subAccountZG.toString());
  const ledgerTarget = parseEther(opts.ledgerZG.toString());

  console.log(`Wallet: ${address}`);
  console.log(`Provider: ${opts.provider}`);
  console.log(
    `Targets: ledger >= ${opts.ledgerZG} 0G, sub-account >= ${opts.subAccountZG} 0G`,
  );

  // 1. Ledger
  let ledger;
  try {
    ledger = await broker.ledger.getLedger();
  } catch {
    ledger = null;
  }

  if (!ledger) {
    console.log(`No ledger exists — addLedger(${opts.ledgerZG} 0G)`);
    if (!opts.dryRun) await broker.ledger.addLedger(opts.ledgerZG);
  } else {
    const total = BigInt(ledger.totalBalance);
    if (total < ledgerTarget) {
      const deltaZG = Number(formatEther(ledgerTarget - total));
      console.log(
        `Ledger total=${formatEther(total)} 0G < target — depositFund(${deltaZG} 0G)`,
      );
      if (!opts.dryRun) await broker.ledger.depositFund(deltaZG);
    } else {
      console.log(`Ledger total=${formatEther(total)} 0G — sufficient`);
    }
  }

  // 2. Acknowledge provider TEE signer (no-op if already acknowledged in contract).
  console.log(`acknowledgeProviderSigner(${opts.provider})`);
  if (!opts.dryRun) {
    try {
      await broker.fineTuning!.acknowledgeProviderSigner(opts.provider);
    } catch (err) {
      // The contract throws if already acknowledged. Treat as soft-error and continue.
      console.warn(`  (ack returned: ${(err as Error).message})`);
    }
  }

  // 3. Sub-account
  const detail = await broker.fineTuning!.getAccountWithDetail(opts.provider);
  const balance = BigInt(detail.account.balance);
  const pendingRefund = BigInt(detail.account.pendingRefund);
  const available = balance - pendingRefund;

  if (available < subAccountTarget) {
    const delta = subAccountTarget - available;
    const deltaNeuron = (delta * NEURON_PER_ZG) / NEURON_PER_ZG; // delta is already in wei (== neuron)
    console.log(
      `Sub-account available=${formatEther(available)} 0G < target — transferFund(${formatEther(delta)} 0G)`,
    );
    if (!opts.dryRun) {
      await broker.ledger.transferFund(opts.provider, "fine-tuning", deltaNeuron);
    }
  } else {
    console.log(`Sub-account available=${formatEther(available)} 0G — sufficient`);
  }

  console.log("fund: done");
}
