"""Upload artifacts to 0G Storage and write ml/artifacts.json.

Track D (`inference/`) and the iNFT metadata both reference these CIDs, so the
manifest is authoritative. We upload:
  - merged weights directory (safetensors + tokenizer + config)
  - phulax-q4.gguf (if produced)
  - dataset.jsonl
  - eval/REPORT.md
  - eval/harness.py + prompt/template.py + data/build_dataset.py (the harness
    itself is part of the verifiability story per todo §3 + §10)

Outputs `ml/artifacts.json` shaped:
  {
    "model": {"base": "Qwen/...", "merged": {"path": "cid", ...}, "gguf_q4": "cid"},
    "dataset": "cid",
    "eval": {"report": "cid", "harness": {"path": "cid", ...}},
    "embeddings_index": "cid",
    "prompt_template_version": "1.0.0"
  }
"""

from __future__ import annotations

import json
from pathlib import Path

from og_client import OGStorageClient
from prompt.template import TEMPLATE_VERSION
from finetune.lora import BASE_MODEL

ROOT = Path(__file__).resolve().parent.parent
MERGED = ROOT / "artifacts" / "merged"
GGUF_Q4 = MERGED / "phulax-q4.gguf"
DATASET = ROOT / "data" / "dataset.jsonl"
REPORT = ROOT / "eval" / "REPORT.md"
INDEX = ROOT / "artifacts" / "embeddings_index.json"
MANIFEST = ROOT / "artifacts.json"

HARNESS_FILES = [
    ROOT / "eval" / "harness.py",
    ROOT / "prompt" / "template.py",
    ROOT / "data" / "build_dataset.py",
    ROOT / "data" / "exploits.py",
    ROOT / "data" / "benign.py",
    ROOT / "pyproject.toml",
    ROOT / "README.md",
]


def main() -> None:
    if not MERGED.exists():
        raise SystemExit(f"{MERGED} missing - run merge_and_quantize first")
    if not DATASET.exists():
        raise SystemExit(f"{DATASET} missing - run data.build_dataset first")

    client = OGStorageClient.from_env()
    print("uploading merged weights directory")
    merged_cids = {
        p: cid for p, cid in client.upload_dir(MERGED).items()
        if not p.endswith(".gguf")  # gguf tracked separately
    }

    manifest: dict = {
        "model": {
            "base": BASE_MODEL,
            "merged": merged_cids,
        },
        "prompt_template_version": TEMPLATE_VERSION,
    }

    if GGUF_Q4.exists():
        print(f"uploading {GGUF_Q4.name}")
        manifest["model"]["gguf_q4"] = client.upload_file(GGUF_Q4)
    else:
        print("no Q4 GGUF found - skipping (Track D will load safetensors)")

    print("uploading dataset")
    manifest["dataset"] = client.upload_file(DATASET)

    if INDEX.exists():
        print("uploading embeddings index manifest")
        manifest["embeddings_index"] = client.upload_file(INDEX)

    if REPORT.exists():
        print("uploading eval report + harness")
        manifest["eval"] = {
            "report": client.upload_file(REPORT),
            "harness": {p.relative_to(ROOT).as_posix(): client.upload_file(p)
                         for p in HARNESS_FILES if p.exists()},
        }

    MANIFEST.write_text(json.dumps(manifest, indent=2))
    print(f"manifest → {MANIFEST}")


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(ROOT))
    main()
