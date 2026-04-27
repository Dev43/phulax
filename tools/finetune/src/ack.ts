import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { DECRYPTED_DIR, ENCRYPTED_DIR } from "./config.js";
import { openBroker } from "./broker.js";
import { patchRun, readRun } from "./run-store.js";

const execFileAsync = promisify(execFile);

export type AckOptions = {
  downloadMethod?: "auto" | "tee" | "0g-storage" | undefined;
};

// The broker package's `exports` field doesn't expose subpaths, so we resolve
// the main entry then load encrypt.js by absolute file path. Same realm the
// broker uses internally → eciesjs/noble resolve identically. Verified to
// succeed end-to-end on the encryptedSecret + encrypted blob the broker's own
// decryptModel wrapper occasionally fails on (cause not pinned down — the
// wrapper does identical work but adds a getDeliverable race window).
const require = createRequire(import.meta.url);
const brokerEntry = require.resolve("@0glabs/0g-serving-broker");
const brokerRoot = resolve(dirname(brokerEntry), "..");
const encryptModule = require(
  resolve(brokerRoot, "lib.commonjs/common/utils/encrypt.js"),
) as {
  eciesDecrypt: (signer: unknown, encryptedHex: string) => Promise<string>;
  aesGCMDecryptToFile: (
    secretHex: string,
    encryptedPath: string,
    decryptedPath: string,
    teeSignerAddress: string,
  ) => Promise<void>;
};

/**
 * Idempotent acknowledge + decrypt + extract.
 *
 * Three steps, each guarded by run.json state:
 *   1. acknowledgeModel(...) — downloads the encrypted blob + writes ack tx.
 *   2. decrypt — ECIES-unwraps the AES-GCM key, then AES-decrypts the blob to
 *      a .zip archive (the SDK names the encrypted form `*.zip` but it's raw
 *      bytes; the decrypted output is the *real* zip).
 *   3. extract — pulls the final `output_model/*` PEFT artefacts (excluding
 *      multi-GB optimizer checkpoints) into ml/artifacts/lora/ at the path
 *      `merge_and_quantize` expects.
 */
export async function ack(_opts: AckOptions = {}): Promise<void> {
  const run = await readRun();
  const { broker } = await openBroker();

  const encryptedDir = ENCRYPTED_DIR;
  const decryptedDir = DECRYPTED_DIR;
  const decryptedZipPath = resolve(decryptedDir, `model_${run.taskId}.zip`);
  const finalAdapterPath = resolve(decryptedDir, "adapter_model.safetensors");

  await mkdir(encryptedDir, { recursive: true });
  await mkdir(decryptedDir, { recursive: true });

  // 1. Acknowledge (download + on-chain ack)
  if (!run.acknowledgedAt) {
    console.log(`acknowledgeModel(taskId=${run.taskId}) -> ${encryptedDir}`);
    await broker.fineTuning!.acknowledgeModel(run.provider, run.taskId, encryptedDir, {
      downloadMethod: _opts.downloadMethod ?? "auto",
    });
    await patchRun({
      acknowledgedAt: new Date().toISOString(),
      encryptedModelPath: encryptedDir,
    });
    console.log("  ✓ acknowledged");
  } else {
    console.log(`Already acknowledged at ${run.acknowledgedAt} — skipping ack.`);
  }

  // The SDK writes the encrypted blob to one of two paths:
  //   - 0G Storage: model_<taskId>.bin (raw encrypted bytes)
  //   - TEE fallback: lora_model_<taskId>.zip (also raw encrypted bytes
  //     despite the name — see the README in the project root)
  // 0G Storage failures sometimes leave a 0-byte stub at the .bin path, so
  // we check size>0 before accepting it.
  const binPath = resolve(encryptedDir, `model_${run.taskId}.bin`);
  const zipPath = resolve(encryptedDir, `lora_model_${run.taskId}.zip`);
  const encryptedPath = (await pickNonEmpty([binPath, zipPath])) ?? null;
  if (!encryptedPath) {
    throw new Error(
      `No usable encrypted model file in ${encryptedDir}. ` +
        `Looked for ${binPath} and ${zipPath}. ` +
        `Re-run ack to redownload.`,
    );
  }

  // 2. Decrypt (ECIES-unwrap key + AES-GCM-decrypt blob -> real zip)
  // Trust the file: if the decrypted zip is on disk, skip the decrypt and
  // just backfill run.json. AES-GCM is authenticated, so a tampered-file
  // attack would have already failed at the probe step.
  if (!existsSync(decryptedZipPath)) {
    console.log(`decrypt(${encryptedPath}) -> ${decryptedZipPath}`);
    const proc = (
      broker.fineTuning as unknown as {
        modelProcessor: {
          contract: {
            signer: unknown;
            getService: (a: string) => Promise<{ teeSignerAddress: string }>;
            getDeliverable: (a: string, b: string) => Promise<{ encryptedSecret: string }>;
          };
        };
      }
    ).modelProcessor;
    const [service, deliverable] = await Promise.all([
      proc.contract.getService(run.provider),
      proc.contract.getDeliverable(run.provider, run.taskId),
    ]);
    const secret = await encryptModule.eciesDecrypt(
      proc.contract.signer,
      deliverable.encryptedSecret,
    );
    await encryptModule.aesGCMDecryptToFile(
      secret,
      encryptedPath,
      decryptedZipPath,
      service.teeSignerAddress,
    );
    await patchRun({
      decryptedAt: new Date().toISOString(),
      decryptedModelPath: decryptedZipPath,
    });
    console.log("  ✓ decrypted");
  } else if (!run.decryptedAt) {
    await patchRun({
      decryptedAt: new Date().toISOString(),
      decryptedModelPath: decryptedZipPath,
    });
    console.log(`Decrypted zip already at ${decryptedZipPath} — backfilled run.json.`);
  } else {
    console.log(`Already decrypted at ${run.decryptedAt} — skipping decrypt.`);
  }

  // 3. Extract — pull just output_model/*, skipping checkpoint dirs (each
  // checkpoint is ~50 MB optimizer state, useless for inference).
  if (!existsSync(finalAdapterPath)) {
    await assertIsZip(decryptedZipPath);
    console.log(`extract(${decryptedZipPath}) -> ${decryptedDir}`);
    const tmpDir = resolve(decryptedDir, ".extract-tmp");
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });
    await execFileAsync("unzip", [
      "-q",
      decryptedZipPath,
      "output_model/*",
      "-x",
      "output_model/checkpoint-*/*",
      "-d",
      tmpDir,
    ]);
    const srcDir = resolve(tmpDir, "output_model");
    if (!existsSync(srcDir)) {
      throw new Error(
        `Expected output_model/ inside ${decryptedZipPath} after extract; not found.`,
      );
    }
    for (const entry of await readdir(srcDir)) {
      await rename(resolve(srcDir, entry), resolve(decryptedDir, entry));
    }
    await rm(tmpDir, { recursive: true, force: true });
    console.log("  ✓ extracted final adapter");
  } else {
    console.log(`Adapter already at ${finalAdapterPath} — skipping extract.`);
  }

  console.log(
    `\nDone. Adapter at ${finalAdapterPath}.\n` +
      `Next: 'uv run python -m finetune.merge_and_quantize' (in ml/).`,
  );
}

async function pickNonEmpty(paths: string[]): Promise<string | undefined> {
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const buf = await readFile(p);
    if (buf.length > 0) return p;
  }
  return undefined;
}

async function assertIsZip(path: string): Promise<void> {
  const fd = await readFile(path, { encoding: null });
  // PK\x03\x04 = local file header magic
  if (fd[0] !== 0x50 || fd[1] !== 0x4b || fd[2] !== 0x03 || fd[3] !== 0x04) {
    throw new Error(
      `${path} is not a zip archive (first bytes: ${[...fd.slice(0, 4)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ")}). Decryption may have failed.`,
    );
  }
}
