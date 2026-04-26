import { config } from "../config.js";
import type { WorkflowSpec } from "./workflows/per-block-detect.js";

/**
 * Thin KeeperHub MCP client. Two surfaces:
 *  - upsert a workflow definition (Day-2 deploy)
 *  - trigger a one-shot run (used by exec/withdraw fallback path)
 *
 * KeeperHub MCP is HTTP+JSON; the schema lives in their fork. We hit it
 * over their REST shim so this stays runtime-language-agnostic.
 */
async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const cfg = config();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.keeperHubKey) headers["x-api-key"] = cfg.keeperHubKey;
  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(10_000),
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${cfg.keeperHubUrl}${path}`, init);
  if (!res.ok) {
    throw new Error(`KeeperHub ${method} ${path} -> ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function upsertWorkflow(spec: WorkflowSpec): Promise<{ id: string }> {
  return call<{ id: string }>("/api/mcp/workflows", "POST", spec);
}

export async function runWorkflow(id: string, input: unknown): Promise<{ runId: string }> {
  return call<{ runId: string }>(`/api/mcp/workflows/${id}/run`, "POST", { input });
}
