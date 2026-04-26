import type { Hex } from "viem";
import type { VectorMatch } from "../detection/types.js";
import { og } from "./http.js";

/**
 * 0G Storage KV. Track C populates the exploit-vector index; we read.
 * Bulk ops aren't in @0glabs/0g-ts-sdk yet (todo §12) so we wrap raw HTTP.
 */
export async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const r = await og.get<{ value: T }>(`/kv/${encodeURIComponent(key)}`);
    return r.value ?? null;
  } catch {
    return null;
  }
}

export async function kvPut<T>(key: string, value: T): Promise<void> {
  await og.put(`/kv/${encodeURIComponent(key)}`, { value });
}

/**
 * Cosine-similarity nearest-neighbour against the exploit corpus.
 * Track C exposes this as a server-side query so we don't need to pull
 * the full index over the wire.
 */
export async function kvLookupNearest(featureKey: Hex): Promise<VectorMatch | null> {
  try {
    const r = await og.post<{ match: VectorMatch | null }>(`/kv/nearest`, {
      key: featureKey,
      topK: 1,
    });
    return r.match;
  } catch {
    return null;
  }
}
