import { openBroker } from "./broker.js";
import { tryReadRun } from "./run-store.js";

export async function status(): Promise<void> {
  const run = await tryReadRun();
  if (!run) {
    console.log("No run.json — submit a task first.");
    return;
  }

  console.log(`taskId:           ${run.taskId}`);
  console.log(`provider:         ${run.provider}`);
  console.log(`model:            ${run.model}`);
  console.log(`datasetHash:      ${run.datasetHash}`);
  console.log(`datasetSha256:    ${run.datasetSha256}`);
  console.log(`templateVersion:  ${run.templateVersion}`);
  console.log(`configHash:       ${run.configHash}`);
  console.log(`submittedAt:      ${run.submittedAt}`);
  console.log(`deadlineAt:       ${run.deadlineAt}`);
  console.log(`acknowledgedAt:   ${run.acknowledgedAt ?? "(pending)"}`);
  console.log(`decryptedAt:      ${run.decryptedAt ?? "(pending)"}`);

  try {
    const { broker } = await openBroker();
    const task = await broker.fineTuning!.getTask(run.provider, run.taskId);
    console.log(`\nLive task progress: ${task.progress}`);
    console.log(`Live task fee:      ${task.fee}`);
  } catch (err) {
    console.log(`\n(could not reach broker: ${(err as Error).message})`);
  }
}
