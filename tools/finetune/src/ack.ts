import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { DECRYPTED_DIR, ENCRYPTED_DIR } from "./config.js";
import { openBroker } from "./broker.js";
import { patchRun, readRun } from "./run-store.js";

export type AckOptions = {
  downloadMethod?: "auto" | "tee" | "0g-storage" | undefined;
};

/**
 * Idempotent acknowledge + decrypt.
 *
 * acknowledgeModel: downloads the encrypted artefact and writes the
 * acknowledgement on-chain. The 48h deadline is on this step. If
 * run.acknowledgedAt is already set, we skip the download/ack and only
 * re-decrypt if the decrypted output is missing.
 */
export async function ack(opts: AckOptions = {}): Promise<void> {
  const run = await readRun();
  const { broker } = await openBroker();

  const encryptedDir = ENCRYPTED_DIR;
  const decryptedDir = DECRYPTED_DIR;
  const encryptedPath = resolve(encryptedDir, `${run.taskId}.bin`);
  const decryptedPath = resolve(decryptedDir, `adapter_model.safetensors`);

  await mkdir(encryptedDir, { recursive: true });
  await mkdir(decryptedDir, { recursive: true });

  if (!run.acknowledgedAt) {
    console.log(`acknowledgeModel(taskId=${run.taskId}) -> ${encryptedDir}`);
    await broker.fineTuning!.acknowledgeModel(run.provider, run.taskId, encryptedDir, {
      downloadMethod: opts.downloadMethod ?? "auto",
    });
    await patchRun({
      acknowledgedAt: new Date().toISOString(),
      encryptedModelPath: encryptedDir,
    });
    console.log("  ✓ acknowledged");
  } else {
    console.log(`Already acknowledged at ${run.acknowledgedAt} — skipping ack.`);
  }

  if (!run.decryptedAt) {
    console.log(`decryptModel -> ${decryptedPath}`);
    await broker.fineTuning!.decryptModel(
      run.provider,
      run.taskId,
      encryptedPath,
      decryptedPath,
    );
    await patchRun({
      decryptedAt: new Date().toISOString(),
      decryptedModelPath: decryptedPath,
    });
    console.log("  ✓ decrypted");
  } else {
    console.log(`Already decrypted at ${run.decryptedAt} — skipping decrypt.`);
  }

  console.log(
    `\nDone. Adapter at ${decryptedPath}.\n` +
      `Next: 'uv run python -m finetune.merge_and_quantize' (in ml/).`,
  );
}
