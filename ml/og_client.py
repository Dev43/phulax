"""Thin 0G Storage HTTP client.

We talk to 0G Storage over HTTP with two operations the pipeline needs:
  - kv_put(key, value)         → vector index
  - upload_file(path) → cid    → merged weights, tokenizer, eval harness

If `@0glabs/0g-ts-sdk` exposes a stable Python binding later, replace this
shim. For now we keep the surface tiny and env-driven so it can be redirected
at a local mock during CI.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx


@dataclass
class OGStorageClient:
    endpoint: str
    token: str | None = None

    @classmethod
    def from_env(cls) -> OGStorageClient:
        ep = os.environ.get("OG_STORAGE_ENDPOINT")
        if not ep:
            raise SystemExit(
                "OG_STORAGE_ENDPOINT is unset. Copy .env.example → .env and fill it."
            )
        return cls(endpoint=ep.rstrip("/"), token=os.environ.get("OG_STORAGE_TOKEN") or None)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def kv_put(self, key: str, value: dict[str, Any]) -> None:
        with httpx.Client(timeout=60) as c:
            r = c.put(
                f"{self.endpoint}/kv/{key}",
                content=json.dumps(value),
                headers={**self._headers(), "Content-Type": "application/json"},
            )
            r.raise_for_status()

    def upload_file(self, path: Path) -> str:
        """Upload a file; return the CID."""
        with httpx.Client(timeout=None) as c, path.open("rb") as f:
            r = c.post(
                f"{self.endpoint}/files",
                headers=self._headers(),
                files={"file": (path.name, f, "application/octet-stream")},
            )
            r.raise_for_status()
            return r.json()["cid"]

    def upload_dir(self, root: Path) -> dict[str, str]:
        """Upload every file under `root`, returning {relative_path: cid}."""
        out: dict[str, str] = {}
        for p in sorted(root.rglob("*")):
            if p.is_file():
                rel = p.relative_to(root).as_posix()
                out[rel] = self.upload_file(p)
        return out
