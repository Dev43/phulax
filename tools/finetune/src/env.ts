// Side-effect module: load .env files into process.env at import time.
// Imported first by cli.ts and re-imported by config.ts so every entrypoint
// (every yargs subcommand, every handler module) sees the same env regardless
// of module load order. Idempotent — dotenv's default behaviour is to never
// override already-set vars, so the shell environment always wins, then
// ml/.env (canonical per the README), then repo-root .env (fallback).
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

const candidates = [
  resolve(REPO_ROOT, "ml", ".env"),
  resolve(REPO_ROOT, ".env"),
];

const loaded: string[] = [];
for (const path of candidates) {
  if (existsSync(path)) {
    loadDotenv({ path });
    loaded.push(path);
  }
}

// Make the loaded paths inspectable for diagnostics.
export const ENV_FILES_LOADED = loaded;
