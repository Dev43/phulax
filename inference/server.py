"""Phulax self-hosted classifier endpoint.

Phase 1: stub. Returns p_nefarious=0.0 with the real response shape so Track A's
E2E synthetic workflow can call it via KeeperHub's HTTP Request action.

Phase 2 (after Track C7 publishes CIDs in ml/artifacts.json): swap _classify()
for a real call into llama.cpp / transformers serving the merged Qwen2.5-0.5B
+ LoRA weights. Everything else (hashing, signing, response shape) stays.

Contract (todo §10):
    POST /classify { features: <canonicalised tx feature blob> }
    -> { p_nefarious, tag, model_hash, input_hash, signature }

signature = HMAC-SHA256(key, model_hash || input_hash || output_json)
key       = PHULAX_INFERENCE_HMAC_KEY env var (per-deployment)
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict


PHASE = os.environ.get("PHULAX_INFERENCE_PHASE", "stub")
MODEL_HASH = os.environ.get("PHULAX_MODEL_HASH", "stub")
HMAC_KEY = os.environ.get("PHULAX_INFERENCE_HMAC_KEY", "dev-insecure-key").encode()


class ClassifyRequest(BaseModel):
    features: Any


class ClassifyResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    p_nefarious: float
    tag: str
    signal: str = "none"
    model_hash: str
    input_hash: str
    signature: str


app = FastAPI(title="phulax-inference", version="0.1.0")


def _canonical(features: Any) -> bytes:
    """Stable serialisation so input_hash is reproducible across callers."""
    return json.dumps(features, sort_keys=True, separators=(",", ":")).encode()


def _classify(features: Any) -> tuple[float, str, str]:
    """Phase 1 stub. Phase 2 swaps in a real model call here.

    Returns (p_nefarious, tag, signal). signal ∈ prompt.template.SIGNALS;
    tag is derived (SAFE iff signal == "none") for backwards compat with
    callers built against schema 1.0.0.
    """
    return 0.0, "stub", "none"


def _sign(model_hash: str, input_hash: str, output: dict[str, Any]) -> str:
    payload = (
        model_hash.encode()
        + input_hash.encode()
        + json.dumps(output, sort_keys=True, separators=(",", ":")).encode()
    )
    return hmac.new(HMAC_KEY, payload, hashlib.sha256).hexdigest()


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "phase": PHASE, "model_hash": MODEL_HASH}


@app.post("/classify", response_model=ClassifyResponse)
def classify(req: ClassifyRequest) -> ClassifyResponse:
    canonical = _canonical(req.features)
    input_hash = hashlib.sha256(canonical).hexdigest()
    p_nefarious, tag, signal = _classify(req.features)
    output = {"p_nefarious": p_nefarious, "tag": tag, "signal": signal}
    signature = _sign(MODEL_HASH, input_hash, output)
    return ClassifyResponse(
        p_nefarious=p_nefarious,
        tag=tag,
        signal=signal,
        model_hash=MODEL_HASH,
        input_hash=input_hash,
        signature=signature,
    )
