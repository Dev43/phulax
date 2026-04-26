"""Embed nefarious exploits and push to 0G Storage KV.

This is the corpus the agent's vector-similarity tier queries (todo §6 step 3,
STRATEGY §2). Embeddings are over a canonicalised feature triple:
  (4-byte selector, abi-decoded args canonicalised, balance-delta vector).

Uses sentence-transformers `all-MiniLM-L6-v2` (384-dim).
"""

from __future__ import annotations

import json
from pathlib import Path

from data.exploits import all_nefarious
from og_client import OGStorageClient

ROOT = Path(__file__).resolve().parent.parent
INDEX_OUT = ROOT / "artifacts" / "embeddings_index.json"

EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def feature_text(row: dict) -> str:
    parts = [
        f"selector={row['selector']}",
        f"fn={row['fn']}",
        "args=" + json.dumps(row["decoded_args"], sort_keys=True),
        "delta=" + json.dumps(row["balance_delta"], sort_keys=True),
    ]
    return " | ".join(parts)


def main() -> None:
    from sentence_transformers import SentenceTransformer

    rows = all_nefarious()
    print(f"embedding {len(rows)} exploits with {EMBED_MODEL}")
    model = SentenceTransformer(EMBED_MODEL)
    texts = [feature_text(r) for r in rows]
    vectors = model.encode(texts, normalize_embeddings=True).tolist()

    client = OGStorageClient.from_env()
    index = []
    for row, vec in zip(rows, vectors):
        key = f"phulax/exploit/{row['id']}"
        value = {
            "id": row["id"], "vector": vec,
            "metadata": {
                "selector": row["selector"], "fn": row["fn"],
                "context": row["context"], "source": row["source"],
            },
        }
        client.kv_put(key, value)
        index.append({"id": row["id"], "key": key, "dim": len(vec)})
        print(f"  pushed {key}")

    INDEX_OUT.parent.mkdir(parents=True, exist_ok=True)
    INDEX_OUT.write_text(json.dumps({
        "model": EMBED_MODEL, "dim": len(vectors[0]),
        "count": len(index), "items": index,
    }, indent=2))
    print(f"manifest → {INDEX_OUT}")


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(ROOT))
    main()
