import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ACK_DEADLINE_MS, RUN_PATH } from "./config.js";

export type RunRecord = {
  taskId: string;
  provider: string;
  model: string;
  datasetHash: string;
  datasetSha256: string;
  templateVersion: string;
  configHash: string;
  submittedAt: string;
  deadlineAt: string;
  acknowledgedAt: string | null;
  decryptedAt: string | null;
  encryptedModelPath: string | null;
  decryptedModelPath: string | null;
};

export async function writeRun(record: RunRecord): Promise<void> {
  await mkdir(dirname(RUN_PATH), { recursive: true });
  await writeFile(RUN_PATH, JSON.stringify(record, null, 2) + "\n", "utf8");
}

export async function readRun(): Promise<RunRecord> {
  const raw = await readFile(RUN_PATH, "utf8");
  return JSON.parse(raw) as RunRecord;
}

export async function tryReadRun(): Promise<RunRecord | null> {
  try {
    return await readRun();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function patchRun(patch: Partial<RunRecord>): Promise<RunRecord> {
  const current = await readRun();
  const next = { ...current, ...patch };
  await writeRun(next);
  return next;
}

export function deadlineFromSubmit(submittedAtIso: string): string {
  const submitted = new Date(submittedAtIso).getTime();
  return new Date(submitted + ACK_DEADLINE_MS).toISOString();
}
