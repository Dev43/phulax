"""Convert ml/data/dataset.jsonl into the 0G fine-tuning input shape.

0G accepts JSONL with three keys per row: ``instruction``, ``input``, ``output``.
We render those via ``prompt.template.instruction_io`` so the SYSTEM message
and target string stay consistent with the local LoRA path
(``finetune.lora`` uses ``chat_messages`` and re-wraps the same fields).

Outputs land in ``ml/artifacts/og-ft/`` and are consumed by
``tools/finetune`` (the TS broker driver) — paths are mirrored there in
``tools/finetune/src/config.ts``. Do not move them without updating both sides.
"""

from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))  # so `from prompt.template import …` works

from prompt.template import TEMPLATE_VERSION, instruction_io  # noqa: E402

DATASET_IN = ROOT / "data" / "dataset.jsonl"
OUT_DIR = ROOT / "artifacts" / "og-ft"
DATASET_OUT = OUT_DIR / "dataset.jsonl"
MANIFEST_OUT = OUT_DIR / "manifest.json"

BASE_MODEL = "Qwen2.5-0.5B-Instruct"
MIN_ROWS = 10  # 0G hard minimum


def _load_rows() -> list[dict]:
    if not DATASET_IN.exists():
        raise SystemExit(
            f"{DATASET_IN} missing - run `uv run python -m data.build_dataset` first."
        )
    return [
        json.loads(line)
        for line in DATASET_IN.read_text().splitlines()
        if line.strip()
    ]


def _emit(rows: list[dict]) -> tuple[bytes, dict]:
    """Render JSONL bytes + manifest for the given rows. Bytes are hashed for sha256."""
    lines: list[str] = []
    for row in rows:
        record = instruction_io(row)
        # ensure_ascii=False keeps UTF-8 (0G mandates UTF-8); separators kill
        # incidental whitespace so the sha256 is stable across re-runs.
        lines.append(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
    blob = ("\n".join(lines) + "\n").encode("utf-8")

    label_counts = Counter(r["label"] for r in rows)
    manifest = {
        "rows": len(rows),
        "sha256": hashlib.sha256(blob).hexdigest(),
        "template_version": TEMPLATE_VERSION,
        "base_model": BASE_MODEL,
        "label_distribution": dict(label_counts),
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    return blob, manifest


def main() -> None:
    rows = _load_rows()
    if len(rows) < MIN_ROWS:
        raise SystemExit(
            f"dataset has {len(rows)} rows (< {MIN_ROWS}) - 0G fine-tuning rejects this."
        )

    blob, manifest = _emit(rows)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    DATASET_OUT.write_bytes(blob)
    MANIFEST_OUT.write_text(json.dumps(manifest, indent=2) + "\n")

    dist = ", ".join(f"{k}={v}" for k, v in manifest["label_distribution"].items())
    print(f"wrote {DATASET_OUT} ({manifest['rows']} rows: {dist})")
    print(f"wrote {MANIFEST_OUT} (sha256={manifest['sha256'][:16]}…, template={TEMPLATE_VERSION})")


if __name__ == "__main__":
    main()
