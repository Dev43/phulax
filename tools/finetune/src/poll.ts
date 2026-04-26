import { setTimeout as sleep } from "node:timers/promises";
import { openBroker } from "./broker.js";
import { readRun } from "./run-store.js";

const TERMINAL_OK = new Set(["Finished", "Delivered", "Completed"]);
const TERMINAL_FAIL = new Set(["Failed", "Cancelled"]);

export type PollOptions = {
  intervalSec?: number | undefined;
  maxMinutes?: number | undefined;
  once?: boolean | undefined;
};

export async function poll(opts: PollOptions = {}): Promise<string> {
  const intervalMs = (opts.intervalSec ?? 30) * 1000;
  const deadlineMs = Date.now() + (opts.maxMinutes ?? 240) * 60_000;

  const run = await readRun();
  const { broker } = await openBroker();

  let lastProgress = "";
  for (;;) {
    const task = await broker.fineTuning!.getTask(run.provider, run.taskId);
    if (task.progress !== lastProgress) {
      console.log(
        `[${new Date().toISOString()}] taskId=${run.taskId} progress=${task.progress} fee=${task.fee}`,
      );
      lastProgress = task.progress ?? "";
    }
    if (TERMINAL_OK.has(task.progress ?? "")) {
      console.log("Task finished. Run 'pnpm --filter @phulax/finetune ack' next.");
      return task.progress ?? "Finished";
    }
    if (TERMINAL_FAIL.has(task.progress ?? "")) {
      const log = await broker.fineTuning!.getLog(run.provider, run.taskId).catch(
        () => "(log unavailable)",
      );
      console.error(`Task ${task.progress}. Log:\n${log}`);
      throw new Error(`task ${run.taskId} ended in state '${task.progress}'`);
    }
    if (opts.once) return task.progress ?? "";
    if (Date.now() > deadlineMs) {
      throw new Error(
        `poll timed out after ${opts.maxMinutes ?? 240} minutes (last progress=${task.progress}).`,
      );
    }
    await sleep(intervalMs);
  }
}
