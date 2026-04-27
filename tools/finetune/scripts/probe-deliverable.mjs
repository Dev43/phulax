// Diagnostic: dump the on-chain Deliverable for the current run.
// Helps distinguish "encryptedSecret not yet posted" (zero-bytes / wrong length)
// from a real decrypt-side bug.
import "../src/env.js";
import { openBroker } from "../src/broker.js";
import { readRun } from "../src/run-store.js";

const { broker } = await openBroker();
const run = await readRun();

// `getDeliverable` isn't exposed on the public broker API; reach into
// modelProcessor.contract to call the underlying contract directly.
const proc = broker.fineTuning.modelProcessor ?? broker.fineTuning;
const contract = proc?.contract;
if (!contract?.getDeliverable) {
  console.error("Could not find contract.getDeliverable. Broker shape:", Object.keys(proc ?? {}));
  process.exit(1);
}

const deliverable = await contract.getDeliverable(run.provider, run.taskId);
const secret = deliverable.encryptedSecret ?? "";
const stripped =
  typeof secret === "string" && secret.startsWith("0x") ? secret.slice(2) : secret;
const bytes = typeof stripped === "string" ? stripped.length / 2 : 0;
const allZero = typeof stripped === "string" && /^0+$/.test(stripped);

const task = await broker.fineTuning.getTask(run.provider, run.taskId);
console.log("provider:          ", run.provider);
console.log("taskId:            ", run.taskId);
console.log("task progress:     ", task.progress);
console.log("modelRootHash:     ", deliverable.modelRootHash);
console.log("acknowledged:      ", deliverable.acknowledged);
console.log("encryptedSecret:   ", secret);
console.log("  length (bytes):  ", bytes);
console.log("  all-zero:        ", allZero);
console.log("  expected: 65 (uncompressed pub) + 16 IV + 16 tag + N ciphertext = >= 97 bytes");
