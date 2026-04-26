// Side-effect import: load .env before reading any env var. Re-importing
// from config.ts (in addition to cli.ts) means modules that pull config
// directly — e.g. unit tests, ad-hoc scripts — also get .env loaded.
import "./env.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
export const REPO_ROOT = resolve(HERE, "..", "..", "..");

export const ML_DIR = resolve(REPO_ROOT, "ml");
export const ML_OG_FT_DIR = resolve(ML_DIR, "artifacts", "og-ft");
export const RUN_PATH = resolve(ML_OG_FT_DIR, "run.json");
export const CONFIG_PATH = resolve(ML_OG_FT_DIR, "training-config.json");
export const DATASET_PATH = resolve(ML_OG_FT_DIR, "dataset.jsonl");
export const MANIFEST_PATH = resolve(ML_OG_FT_DIR, "manifest.json");
export const ENCRYPTED_DIR = resolve(ML_OG_FT_DIR, "encrypted");
export const DECRYPTED_DIR = resolve(REPO_ROOT, "ml", "artifacts", "lora");

const DEFAULT_RPC = "https://evmrpc-testnet.0g.ai";

export type Env = {
  privateKey: string;
  rpcUrl: string;
};

export function loadEnv(): Env {
  const privateKey = process.env.PHULAX_FT_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error(
      "PHULAX_FT_PRIVATE_KEY is unset. This is the funding/submitter key for the 0G fine-tuning job. " +
        "It MUST NOT be the agent runtime key (the one that calls PhulaxAccount.withdraw). " +
        "See ml/.env.example.",
    );
  }
  return {
    privateKey,
    rpcUrl: process.env.PHULAX_FT_RPC_URL ?? DEFAULT_RPC,
  };
}

/**
 * Locked training config per 0G's rigid schema. Decimal notation only,
 * no fp16/bf16, no extra keys. Adding/removing keys breaks the job.
 *
 * Sized for ~160 train rows × 3 epochs at batch 2:
 *   ceil(160 / 2) × 3 = 240 steps. Cap at 480 to allow re-shuffles.
 */
export const LOCKED_TRAINING_CONFIG = {
  neftune_noise_alpha: 5,
  num_train_epochs: 3,
  per_device_train_batch_size: 2,
  learning_rate: 0.0002,
  max_steps: 480,
} as const;

export const ALLOWED_CONFIG_KEYS = new Set(Object.keys(LOCKED_TRAINING_CONFIG));

export const DEFAULT_MODEL = "Qwen2.5-0.5B-Instruct";

export const ACK_DEADLINE_MS = 48 * 60 * 60 * 1000;
export const SAFETY_ACK_AT_MS = 47 * 60 * 60 * 1000;
