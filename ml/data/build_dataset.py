"""Emit ml/data/dataset.jsonl - the labelled corpus used by both fine-tune and eval."""

from __future__ import annotations

import json
import random
from pathlib import Path

from .benign import generate as gen_benign
from .exploits import all_nefarious

OUT = Path(__file__).parent / "dataset.jsonl"


def build(seed: int = 1337) -> list[dict]:
    rows: list[dict] = []
    for r in all_nefarious():
        rows.append({**r, "label": "RISK"})
    for r in gen_benign(150, seed=seed):
        rows.append({**r, "label": "SAFE"})

    rng = random.Random(seed)
    rng.shuffle(rows)
    return rows


def main() -> None:
    rows = build()
    with OUT.open("w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    n_risk = sum(1 for r in rows if r["label"] == "RISK")
    n_safe = sum(1 for r in rows if r["label"] == "SAFE")
    print(f"wrote {OUT} - {len(rows)} rows ({n_risk} RISK / {n_safe} SAFE)")


if __name__ == "__main__":
    main()
