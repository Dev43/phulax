import { formatEther } from "ethers";
import { openBroker } from "./broker.js";
import { DEFAULT_MODEL } from "./config.js";

type ProviderRow = {
  index: number;
  provider: string;
  available: boolean;
  pricePerTokenNeuron: bigint;
  pricePerTokenZG: string;
};

export async function discover(opts: {
  json?: boolean | undefined;
  pickCheapest?: boolean | undefined;
  includeInvalid?: boolean | undefined;
} = {}): Promise<ProviderRow[]> {
  const { broker } = await openBroker();
  const services = await broker.fineTuning!.listService(opts.includeInvalid ?? false);

  const rows: ProviderRow[] = services.map((svc, i) => ({
    index: i + 1,
    provider: svc.provider,
    available: !svc.occupied,
    pricePerTokenNeuron: BigInt(svc.pricePerToken ?? 0),
    pricePerTokenZG: formatEther(BigInt(svc.pricePerToken ?? 0)),
  }));

  if (opts.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return rows;
  }

  if (rows.length === 0) {
    console.log("(no fine-tuning providers found)");
    return rows;
  }

  console.log(`Fine-tuning providers (model: ${DEFAULT_MODEL}):`);
  for (const row of rows) {
    console.log(
      `  [${row.index}] ${row.provider} ` +
        `available=${row.available} ` +
        `price/byte=${row.pricePerTokenZG} 0G`,
    );
  }

  if (opts.pickCheapest) {
    const candidates = rows.filter((r) => r.available);
    if (candidates.length === 0) {
      console.log("(no available providers — re-run without --pick-cheapest)");
      return rows;
    }
    const cheapest = candidates.reduce((a, b) =>
      a.pricePerTokenNeuron <= b.pricePerTokenNeuron ? a : b,
    );
    console.log(`\npick-cheapest -> ${cheapest.provider}`);
  }

  console.log(
    "\nPin a provider into ml/artifacts/og-ft/run.json by running:" +
      "\n  pnpm --filter @phulax/finetune submit -- --provider <ADDRESS>",
  );
  return rows;
}
