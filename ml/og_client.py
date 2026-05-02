"""0G Storage client for the offline ml/ pipeline.

0G Storage is **not** an HTTP REST server. KV writes are on-chain Flow
transactions submitted through `@0gfoundation/0g-ts-sdk`; reads pull a blob
from the Indexer at `${indexer}/file?root=<rootHash>` and decode the
StreamData wire format. See `keeperhub/plugins/0g-storage/server-core.ts`.

There is no Python SDK, so this module shells out to a small Node helper at
`ml/scripts/og.mjs` that uses the same SDK + a plain ethers signer (the
keeperhub plugin uses Para; we sign with a private key from env). Both code
paths converge on `Indexer.upload(...)` and `Batcher.exec(...)`.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent / "scripts"
HELPER = SCRIPTS_DIR / "og.mjs"

# 0G testnet `Indexer.upload` is CPU-bound on Merkle-root construction at ~256
# bytes per leaf. ~1 GB blobs are practically unuploadable in a single tx
# from this client (observed > 30 min CPU at 100% with no progress on a
# 988 MB safetensors). For anything above this threshold we record a
# `{sha256, size}` placeholder in the manifest instead of a `{rootHash, txHash}`
# and let the publish-and-replay story fall back to the offline hash. The
# Fly.io inference image already serves the merged weights directly.
MAX_BLOB_BYTES = int(os.environ.get("OG_MAX_BLOB_BYTES", str(64 * 1024 * 1024)))


@dataclass
class WriteResult:
    root_hash: str
    tx_hash: str


@dataclass
class SkippedBlob:
    """Returned in place of a `WriteResult` when a file exceeds MAX_BLOB_BYTES."""
    sha256: str
    size: int
    reason: str = "size > OG_MAX_BLOB_BYTES"


@dataclass
class OGStorageClient:
    """Thin subprocess wrapper over `ml/scripts/og.mjs`.

    Required env (passed straight through to the Node helper):
      - OG_PRIVATE_KEY   wallet that pays gas for Flow transactions
      - OG_RPC_URL       0G EVM RPC (default: Galileo testnet)
      - OG_INDEXER_URL   0G storage indexer (default: testnet turbo indexer)
      - OG_FLOW_ADDRESS  Flow contract address (default: Galileo testnet)
      - OG_CHAIN_ID      0G chain id (default: 16602)
    """

    @classmethod
    def from_env(cls) -> "OGStorageClient":
        if not os.environ.get("OG_PRIVATE_KEY"):
            raise SystemExit(
                "OG_PRIVATE_KEY is unset. Copy ml/.env.example -> ml/.env and "
                "fill it. 0G KV writes are on-chain Flow transactions and "
                "require a funded wallet."
            )
        if not HELPER.exists():
            raise SystemExit(
                f"{HELPER} is missing. Run `cd ml/scripts && pnpm install` "
                "(or npm/yarn) once before invoking the upload pipeline."
            )
        return cls()

    def _invoke(self, command: str, payload: dict[str, Any]) -> dict[str, Any]:
        proc = subprocess.run(
            ["node", str(HELPER), command],
            input=json.dumps(payload).encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f"og.mjs {command} failed ({proc.returncode}): "
                f"{proc.stderr.decode('utf-8', errors='replace').strip()}"
            )
        return json.loads(proc.stdout.decode("utf-8"))

    def upload_file(self, path: Path) -> "WriteResult | SkippedBlob":
        """Upload a blob; returns the on-chain root hash + tx hash.

        Falls back to a `SkippedBlob` placeholder when the file is larger
        than `MAX_BLOB_BYTES` so the caller's manifest still gets a
        deterministic pointer (sha256) for files we cannot pin in one tx.
        """
        size = path.stat().st_size
        if size > MAX_BLOB_BYTES:
            h = hashlib.sha256()
            with path.open("rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    h.update(chunk)
            return SkippedBlob(sha256="0x" + h.hexdigest(), size=size)
        out = self._invoke("upload-blob", {"path": str(path)})
        return WriteResult(root_hash=out["rootHash"], tx_hash=out["txHash"])

    def upload_dir(self, root: Path) -> dict[str, "WriteResult | SkippedBlob"]:
        """Upload every file under `root`; returns {relative_path: result}."""
        results: dict[str, WriteResult | SkippedBlob] = {}
        for p in sorted(root.rglob("*")):
            if p.is_file():
                results[p.relative_to(root).as_posix()] = self.upload_file(p)
        return results

    def kv_put_batch(
        self, stream_id: str, entries: list[dict[str, Any]]
    ) -> WriteResult:
        """Write many KV entries in a single Flow transaction.

        StreamDataBuilder accepts multiple `set(streamId, key, value)` calls
        before a single `Batcher.exec()`, so a corpus of N exploits costs one
        tx, not N. `entries` is `[{ "key": str, "value": str|json }, ...]`.
        """
        out = self._invoke(
            "kv-put-batch", {"streamId": stream_id, "entries": entries}
        )
        return WriteResult(root_hash=out["rootHash"], tx_hash=out["txHash"])
