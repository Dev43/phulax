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

import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent / "scripts"
HELPER = SCRIPTS_DIR / "og.mjs"


@dataclass
class WriteResult:
    root_hash: str
    tx_hash: str


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

    def upload_file(self, path: Path) -> WriteResult:
        """Upload a blob; returns the on-chain root hash + tx hash."""
        out = self._invoke("upload-blob", {"path": str(path)})
        return WriteResult(root_hash=out["rootHash"], tx_hash=out["txHash"])

    def upload_dir(self, root: Path) -> dict[str, WriteResult]:
        """Upload every file under `root`; returns {relative_path: WriteResult}."""
        results: dict[str, WriteResult] = {}
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
