import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  ALLOWED_CONFIG_KEYS,
  CONFIG_PATH,
  DATASET_PATH,
  DEFAULT_MODEL,
  LOCKED_TRAINING_CONFIG,
  MANIFEST_PATH,
  ML_OG_FT_DIR,
} from "./config.js";
import { openBroker } from "./broker.js";
import { deadlineFromSubmit, writeRun } from "./run-store.js";

export type SubmitOptions = {
  provider: string;
  model?: string | undefined;
  datasetPath?: string | undefined;
};

type Manifest = {
  rows: number;
  sha256: string;
  template_version: string;
  base_model: string;
  label_distribution: Record<string, number>;
  built_at: string;
};

async function readManifest(): Promise<Manifest> {
  const raw = await readFile(MANIFEST_PATH, "utf8");
  return JSON.parse(raw) as Manifest;
}

async function sha256File(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

function freezeConfig(): typeof LOCKED_TRAINING_CONFIG {
  // Defensive: validate at submit time too (build_dataset already checks this).
  const keys = Object.keys(LOCKED_TRAINING_CONFIG);
  for (const k of keys) {
    if (!ALLOWED_CONFIG_KEYS.has(k)) {
      throw new Error(`internal: locked config has unknown key '${k}'`);
    }
  }
  return LOCKED_TRAINING_CONFIG;
}

async function writeConfig(): Promise<{ path: string; hash: string }> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  const json = JSON.stringify(freezeConfig(), null, 2) + "\n";
  await writeFile(CONFIG_PATH, json, "utf8");
  const hash = createHash("sha256").update(json).digest("hex");
  return { path: CONFIG_PATH, hash };
}

export async function submit(opts: SubmitOptions): Promise<void> {
  const datasetPath = opts.datasetPath
    ? isAbsolute(opts.datasetPath)
      ? opts.datasetPath
      : resolve(process.cwd(), opts.datasetPath)
    : DATASET_PATH;

  // Sanity: dataset + manifest must exist and agree on sha256.
  const ds = await stat(datasetPath).catch(() => null);
  if (!ds || !ds.isFile()) {
    throw new Error(
      `dataset not found at ${datasetPath}. Run 'uv run python -m finetune.og_emit' first.`,
    );
  }
  const datasetSha256 = await sha256File(datasetPath);
  const manifest = await readManifest().catch(() => {
    throw new Error(
      `manifest not found at ${MANIFEST_PATH}. Run 'uv run python -m finetune.og_emit' first.`,
    );
  });
  if (manifest.sha256 !== datasetSha256) {
    throw new Error(
      `dataset sha256 drift: file=${datasetSha256} manifest=${manifest.sha256}. Re-run 'uv run python -m finetune.og_emit'.`,
    );
  }

  const config = await writeConfig();

  const { broker, address } = await openBroker();

  console.log(`Wallet: ${address}`);
  console.log(`Provider: ${opts.provider}`);
  console.log(`Model: ${opts.model ?? DEFAULT_MODEL}`);
  console.log(`Dataset: ${datasetPath} (sha256=${datasetSha256.slice(0, 16)}…)`);
  console.log(`Config: ${config.path} (sha256=${config.hash.slice(0, 16)}…)`);

  console.log("\nUploading dataset to 0G Storage…");
  const datasetHash = await broker.fineTuning!.uploadDataset(datasetPath);
  if (!datasetHash) {
    throw new Error("uploadDataset returned no root hash. Check OG storage indexer.");
  }
  console.log(`  datasetHash = ${datasetHash}`);

  console.log("\nVerifying provider TEE signer…");
  try {
    await broker.fineTuning!.acknowledgeProviderSigner(opts.provider);
  } catch (err) {
    // already acknowledged is fine
    console.log(`  (${(err as Error).message})`);
  }

  console.log("\nCreating task…");
  const taskId = await broker.fineTuning!.createTask(
    opts.provider,
    opts.model ?? DEFAULT_MODEL,
    datasetHash,
    config.path,
  );
  console.log(`  taskId = ${taskId}`);

  const submittedAt = new Date().toISOString();
  await mkdir(ML_OG_FT_DIR, { recursive: true });
  await writeRun({
    taskId,
    provider: opts.provider,
    model: opts.model ?? DEFAULT_MODEL,
    datasetHash,
    datasetSha256,
    templateVersion: manifest.template_version,
    configHash: config.hash,
    submittedAt,
    deadlineAt: deadlineFromSubmit(submittedAt),
    acknowledgedAt: null,
    decryptedAt: null,
    encryptedModelPath: null,
    decryptedModelPath: null,
  });

  console.log(
    `\nSubmitted. Run 'pnpm --filter @phulax/finetune poll' to track progress.\n` +
      `Ack deadline: ${deadlineFromSubmit(submittedAt)} (48h hard cap, 30% penalty if missed).`,
  );
}
