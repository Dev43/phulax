#!/usr/bin/env node
// Load .env BEFORE any handler module so process.env is populated by the time
// yargs builders evaluate (some read PHULAX_FT_PROVIDER as defaults).
import "./env.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { ack } from "./ack.js";
import { discover } from "./discover.js";
import { fund } from "./fund.js";
import { poll } from "./poll.js";
import { safetyCron } from "./safety-cron.js";
import { status } from "./status.js";
import { submit } from "./submit.js";

// Read at handler-call time so the dotenv loader in env.ts has populated
// process.env regardless of yargs builder evaluation order. An empty/whitespace
// `--provider` (e.g. when `--provider $PHULAX_FT_PROVIDER` shell-expands to
// nothing because the var lives only in .env) falls through to the env var
// rather than failing — this is the common footgun.
function resolveProvider(flag: string | undefined): string {
  const fromFlag = flag?.trim();
  const provider = fromFlag || process.env.PHULAX_FT_PROVIDER?.trim();
  if (!provider) {
    throw new Error(
      "provider not set: pass --provider <address> or set PHULAX_FT_PROVIDER in .env",
    );
  }
  return provider;
}

// `pnpm run X -- --flag` passes a literal `--` through to the underlying
// command, and yargs treats `--` as "stop parsing options" — every flag
// after it falls into argv._ instead of being recognized. Strip it so the
// invocations documented in the README (`pnpm fund -- --provider 0x…`)
// behave as users expect.
const args = hideBin(process.argv).filter((a) => a !== "--");

await yargs(args)
  .scriptName("phulax-ft")
  .strict()
  .demandCommand(1)
  .command(
    "discover",
    "List 0G fine-tuning providers",
    (y) =>
      y
        .option("json", { type: "boolean", default: false })
        .option("pick-cheapest", { type: "boolean", default: false })
        .option("include-invalid", { type: "boolean", default: false }),
    async (argv) => {
      await discover({
        json: argv.json,
        pickCheapest: argv["pick-cheapest"],
        includeInvalid: argv["include-invalid"],
      });
    },
  )
  .command(
    "fund",
    "Top up ledger + provider sub-account (idempotent)",
    (y) =>
      y
        .option("provider", {
          type: "string",
          describe: "provider address; falls back to PHULAX_FT_PROVIDER env var",
        })
        .option("ledger", {
          type: "number",
          default: 3.0,
          describe: "main ledger target in 0G (testnet minimum is 3)",
        })
        .option("sub-account", {
          type: "number",
          default: 0.5,
          describe: "provider sub-account target in 0G",
        })
        .option("dry-run", { type: "boolean", default: false }),
    async (argv) => {
      await fund({
        provider: resolveProvider(argv.provider),
        ledgerZG: argv.ledger,
        subAccountZG: argv["sub-account"],
        dryRun: argv["dry-run"],
      });
    },
  )
  .command(
    "submit",
    "Upload dataset + create fine-tuning task",
    (y) =>
      y
        .option("provider", {
          type: "string",
          describe: "provider address; falls back to PHULAX_FT_PROVIDER env var",
        })
        .option("model", { type: "string" })
        .option("dataset-path", { type: "string" }),
    async (argv) => {
      await submit({
        provider: resolveProvider(argv.provider),
        model: argv.model,
        datasetPath: argv["dataset-path"],
      });
    },
  )
  .command(
    "poll",
    "Poll task progress until terminal state",
    (y) =>
      y
        .option("interval", { type: "number", default: 30, describe: "seconds between polls" })
        .option("max-minutes", { type: "number", default: 240 })
        .option("once", { type: "boolean", default: false }),
    async (argv) => {
      await poll({
        intervalSec: argv.interval,
        maxMinutes: argv["max-minutes"],
        once: argv.once,
      });
    },
  )
  .command(
    "ack",
    "Acknowledge + decrypt the delivered model (idempotent)",
    (y) =>
      y.option("download-method", {
        choices: ["auto", "tee", "0g-storage"] as const,
        default: "auto" as const,
      }),
    async (argv) => {
      await ack({ downloadMethod: argv["download-method"] });
    },
  )
  .command("safety-cron", "Watchdog that forces ack at 47h", {}, async () => {
    await safetyCron();
  })
  .command("status", "Print run.json + live task progress", {}, async () => {
    await status();
  })
  .help()
  .parse();
