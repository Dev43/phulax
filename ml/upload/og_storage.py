"""Upload artifacts to 0G Storage and write ml/artifacts.json.

Track D (`inference/`) and the iNFT metadata both reference these pointers, so
the manifest is authoritative. We upload:
  - merged weights directory (safetensors + tokenizer + config)
  - phulax-q4.gguf (if produced)
  - dataset.jsonl
  - eval/REPORT.md
  - eval/harness.py + prompt/template.py + data/build_dataset.py (the harness
    itself is part of the verifiability story per todo §3 + §10)

0G Storage identifies blobs by an on-chain Merkle `rootHash` (committed via the
Flow contract), not by a CID. The manifest records `{rootHash, txHash}` per
artifact so a third party can reproduce every reported number from
`artifacts.json` alone, fetching each blob via
`${indexerUrl}/file?root=<rootHash>`.

Outputs `ml/artifacts.json` shaped:
  {
    "model": {
      "base": "Qwen/...",
      "merged": {"<rel-path>": {"rootHash": "0x..", "txHash": "0x.."}, ...},
      "gguf_q4": {"rootHash": "0x..", "txHash": "0x.."}
    },
    "dataset": {"rootHash": "0x..", "txHash": "0x.."},
    "eval": {"report": {...}, "harness": {"<rel-path>": {...}, ...}},
    "embeddings_index": {"rootHash": "0x..", "txHash": "0x..", "streamId": "0x.."},
    "prompt_template_version": "1.0.0"
  }
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

from og_client import OGStorageClient, WriteResult
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


def _ptr(result: WriteResult) -> dict[str, str]:
    return {"rootHash": result.root_hash, "txHash": result.tx_hash}


def main() -> None:
    if not MERGED.exists():
        raise SystemExit(f"{MERGED} missing - run merge_and_quantize first")
    if not DATASET.exists():
        raise SystemExit(f"{DATASET} missing - run data.build_dataset first")

    client = OGStorageClient.from_env()
    print("uploading merged weights directory")
    merged = {
        p: _ptr(r) for p, r in client.upload_dir(MERGED).items()
        if not p.endswith(".gguf")  # gguf tracked separately
    }

    manifest: dict = {
        "model": {
            "base": BASE_MODEL,
            "merged": merged,
        },
        "prompt_template_version": TEMPLATE_VERSION,
    }

    if GGUF_Q4.exists():
        print(f"uploading {GGUF_Q4.name}")
        manifest["model"]["gguf_q4"] = _ptr(client.upload_file(GGUF_Q4))
    else:
        print("no Q4 GGUF found - skipping (Track D will load safetensors)")

    print("uploading dataset")
    manifest["dataset"] = _ptr(client.upload_file(DATASET))

    if INDEX.exists():
        # embed/index.py already pushed the corpus to KV in one Flow tx; we
        # also pin the index manifest as a blob so consumers can fetch it
        # without scanning the stream.
        print("uploading embeddings index manifest")
        idx_doc = json.loads(INDEX.read_text())
        idx_blob = client.upload_file(INDEX)
        manifest["embeddings_index"] = {
            **_ptr(idx_blob),
            "streamId": idx_doc.get("streamId"),
            "kvRootHash": idx_doc.get("rootHash"),
            "kvTxHash": idx_doc.get("txHash"),
        }

    if REPORT.exists():
        print("uploading eval report + harness")
        manifest["eval"] = {
            "report": _ptr(client.upload_file(REPORT)),
            "harness": {
                p.relative_to(ROOT).as_posix(): _ptr(client.upload_file(p))
                for p in HARNESS_FILES if p.exists()
            },
        }

    MANIFEST.write_text(json.dumps(manifest, indent=2))
    print(f"manifest -> {MANIFEST}")


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(ROOT))
    main()
