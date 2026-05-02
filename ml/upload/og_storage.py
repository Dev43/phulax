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
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from og_client import OGStorageClient, WriteResult
from prompt.template import TEMPLATE_VERSION
from finetune.lora import BASE_MODEL

ROOT = Path(__file__).resolve().parent.parent
MERGED = ROOT / "artifacts" / "merged"
GGUF_Q4 = MERGED / "phulax-q4.gguf"
ADAPTER = ROOT / "artifacts" / "lora" / "adapter.safetensors"
DATASET = ROOT / "data" / "dataset.jsonl"
REPORT = ROOT / "eval" / "REPORT.md"
INDEX = ROOT / "artifacts" / "embeddings_index.json"
MANIFEST = ROOT / "artifacts.json"
RUN_RECORD = ROOT / "artifacts" / "og-ft" / "run.json"

HARNESS_FILES = [
    ROOT / "eval" / "harness.py",
    ROOT / "prompt" / "template.py",
    ROOT / "data" / "build_dataset.py",
    ROOT / "data" / "exploits.py",
    ROOT / "data" / "benign.py",
    ROOT / "pyproject.toml",
    ROOT / "README.md",
]

# Stream id for the publish-log (todo §10.1 Stage C step 4). Same 32-byte hex
# convention as the exploits stream in `embed/index.py` — distinct namespace
# so consumers can subscribe to publishes without scanning exploit writes.
DEFAULT_PUBLISH_STREAM_ID = "0x" + ("70" * 31) + "02"


def _ptr(result: WriteResult) -> dict[str, str]:
    return {"rootHash": result.root_hash, "txHash": result.tx_hash}


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return "0x" + h.hexdigest()


def _read_run_record() -> dict | None:
    if not RUN_RECORD.exists():
        return None
    try:
        return json.loads(RUN_RECORD.read_text())
    except json.JSONDecodeError:
        return None


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

    if ADAPTER.exists():
        # Adapter pinned separately from the merged dir so the publish-log
        # entry can reference the LoRA delta (todo §10.1 Stage C step 4).
        print(f"uploading {ADAPTER.name}")
        manifest["model"]["adapter"] = _ptr(client.upload_file(ADAPTER))
    else:
        print("no adapter.safetensors found - skipping (local PEFT path produces merged only)")

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

    # Append the `model_publish` entry to the 0G Storage Log (todo §10.1
    # Stage C step 4). One Flow tx, single key/value, persists the bundle of
    # hashes + provider/task pointers so any third party can replay a fire
    # against the exact same model + template + dataset.
    publish_stream_id = os.environ.get(
        "OG_PUBLISH_STREAM_ID", DEFAULT_PUBLISH_STREAM_ID
    )
    run = _read_run_record()
    # Prefer the GGUF rootHash (what `inference/server.py` actually loads on
    # CPU); fall back to model.safetensors from the merged dir, then any
    # weights-shaped file. Tokenizer/config files are not weights — skip them.
    weight_candidates = ["model.safetensors", "pytorch_model.bin"]
    fallback_root = next(
        (merged[p]["rootHash"] for p in weight_candidates if p in merged),
        None,
    )
    model_root = (
        manifest["model"].get("gguf_q4", {}).get("rootHash") or fallback_root
    )
    publish_entry = {
        "kind": "model_publish",
        "model_hash": _sha256_file(GGUF_Q4) if GGUF_Q4.exists() else None,
        "template_version": TEMPLATE_VERSION,
        "dataset_sha256": _sha256_file(DATASET),
        "weights_cid": model_root,
        "adapter_cid": manifest["model"].get("adapter", {}).get("rootHash"),
        "eval_cid": (
            manifest.get("eval", {}).get("report", {}).get("rootHash")
            if "eval" in manifest else None
        ),
        "provider": run.get("provider") if run else None,
        "task_id": run.get("taskId") if run else None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    publish_key = f"phulax/publish/{publish_entry['model_hash'] or model_root}"
    print(f"appending model_publish log entry to stream {publish_stream_id}")
    log_result = client.kv_put_batch(
        publish_stream_id,
        [{"key": publish_key, "value": json.dumps(publish_entry)}],
    )
    manifest["publish_log"] = {
        **_ptr(log_result),
        "streamId": publish_stream_id,
        "key": publish_key,
        "entry": publish_entry,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2))
    print(f"  rootHash={log_result.root_hash} txHash={log_result.tx_hash}")


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(ROOT))
    main()
