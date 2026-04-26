import { config } from "../config.js";

/**
 * Raw 0G Storage HTTP shim. Isolated so that swapping in @0glabs/0g-ts-sdk
 * later is a single-file change (todo §12 risk #1).
 */
async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const cfg = config();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.ogStorageAuth) headers["authorization"] = `Bearer ${cfg.ogStorageAuth}`;
  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(5_000),
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${cfg.ogStorageUrl}${path}`, init);
  if (!res.ok) {
    throw new Error(`0G ${method} ${path} -> ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export const og = {
  get: <T>(p: string) => req<T>("GET", p),
  post: <T>(p: string, b: unknown) => req<T>("POST", p, b),
  put: <T>(p: string, b: unknown) => req<T>("PUT", p, b),
};
