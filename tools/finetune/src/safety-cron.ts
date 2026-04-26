import { setTimeout as sleep } from "node:timers/promises";
import { ack } from "./ack.js";
import { SAFETY_ACK_AT_MS } from "./config.js";
import { tryReadRun } from "./run-store.js";

const POLL_MS = 60_000;

/**
 * Long-running watchdog: at submittedAt + 47h, force `ack` if it hasn't
 * happened yet. Defends against the 30% penalty for missing the 48h window.
 *
 * Run alongside the main job:
 *   pnpm --filter @phulax/finetune safety-cron &
 *
 * Idempotent. If ack has already happened, this no-ops on every tick.
 */
export async function safetyCron(): Promise<void> {
  console.log("safety-cron: started");
  for (;;) {
    const run = await tryReadRun();
    if (!run) {
      console.log("safety-cron: no run.json yet — sleeping");
      await sleep(POLL_MS);
      continue;
    }
    if (run.acknowledgedAt) {
      console.log(`safety-cron: already acknowledged at ${run.acknowledgedAt} — exiting`);
      return;
    }
    const submittedMs = new Date(run.submittedAt).getTime();
    const triggerAt = submittedMs + SAFETY_ACK_AT_MS;
    const remainMs = triggerAt - Date.now();
    if (remainMs <= 0) {
      console.log("safety-cron: 47h elapsed — forcing ack");
      try {
        await ack();
        console.log("safety-cron: ack succeeded");
        return;
      } catch (err) {
        console.error(`safety-cron: ack failed — will retry in 60s: ${(err as Error).message}`);
        await sleep(POLL_MS);
        continue;
      }
    }
    const minsLeft = Math.round(remainMs / 60_000);
    console.log(`safety-cron: ${minsLeft} min until forced ack`);
    await sleep(POLL_MS);
  }
}
