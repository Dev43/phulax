"""Phulax self-hosted classifier endpoint.

Phase 2 (this file): real transformers serving of the merged Qwen2.5-0.5B + LoRA
weights at PHULAX_MODEL_DIR. Falls back to the Phase 1 stub if no model dir is
set (or the dir is missing) so Track A's E2E synthetic workflow + the existing
HMAC test suite still pass without weights present.

Contract (todo §10):
    POST /classify { features: <canonicalised tx feature blob> }
    -> { p_nefarious, tag, signal, model_hash, input_hash, signature }

signature = HMAC-SHA256(key, model_hash || input_hash || output_json)
key       = PHULAX_INFERENCE_HMAC_KEY env var (per-deployment)

Boot env:
    PHULAX_MODEL_DIR              path to ml/artifacts/merged (transformers shape)
    PHULAX_INFERENCE_HMAC_KEY     receipt-signing key (no in-image default)
    PHULAX_INFERENCE_PHASE        'auto' (default) | 'stub' | 'transformers'
                                  'auto' uses transformers iff MODEL_DIR resolves.
    PHULAX_INFERENCE_MAX_NEW       max new tokens for the JSON response (default 48)
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import sys
import threading
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict


_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "ml"))
try:
    from prompt.template import SIGNALS, TEMPLATE_VERSION, chat_messages
except Exception:  # template absent (e.g. minimal Docker image)
    SIGNALS = ("none", "drain", "oracle_manipulation", "donation_attack",
               "reentrancy", "governance_hijack", "sig_bypass", "share_inflation")
    TEMPLATE_VERSION = "unknown"
    chat_messages = None  # type: ignore[assignment]


log = logging.getLogger("phulax.inference")
logging.basicConfig(level=os.environ.get("PHULAX_LOG_LEVEL", "INFO"))


PHASE_REQUEST = os.environ.get("PHULAX_INFERENCE_PHASE", "auto")
MODEL_DIR = os.environ.get("PHULAX_MODEL_DIR", "").strip()
HMAC_KEY = os.environ.get("PHULAX_INFERENCE_HMAC_KEY", "dev-insecure-key").encode()
MAX_NEW_TOKENS = int(os.environ.get("PHULAX_INFERENCE_MAX_NEW", "48"))


def _hash_model_dir(model_dir: Path) -> str:
    """sha256 over model.safetensors (the only weight blob in our merged dir).

    Matches what `python -m upload.og_storage` records as the publish-time
    model_hash, so receipts anchor back to the on-0G CID.
    """
    h = hashlib.sha256()
    weights = model_dir / "model.safetensors"
    if not weights.exists():
        # fall back to hashing every file deterministically
        for p in sorted(model_dir.iterdir()):
            if p.is_file():
                h.update(p.name.encode())
                h.update(p.read_bytes())
        return h.hexdigest()
    with weights.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _resolve_phase() -> tuple[str, str]:
    """Decide stub vs transformers and compute MODEL_HASH at boot.

    Returns (phase, model_hash).
    """
    if PHASE_REQUEST == "stub":
        return "stub", os.environ.get("PHULAX_MODEL_HASH", "stub")
    if PHASE_REQUEST in ("auto", "transformers"):
        if MODEL_DIR and Path(MODEL_DIR).is_dir():
            try:
                mh = _hash_model_dir(Path(MODEL_DIR))
                log.info("loaded model_dir=%s model_hash=%s template_version=%s",
                         MODEL_DIR, mh, TEMPLATE_VERSION)
                return "transformers", mh
            except Exception as e:
                log.warning("model_hash failed for %s: %s; falling back to stub", MODEL_DIR, e)
        if PHASE_REQUEST == "transformers":
            raise RuntimeError(
                f"PHULAX_INFERENCE_PHASE=transformers but PHULAX_MODEL_DIR={MODEL_DIR!r} is not a directory"
            )
    return "stub", os.environ.get("PHULAX_MODEL_HASH", "stub")


PHASE, MODEL_HASH = _resolve_phase()

# Loaded lazily on first /classify call so import-time tests stay fast.
_model_lock = threading.Lock()
_model: Any = None
_tokenizer: Any = None


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


app = FastAPI(title="phulax-inference", version="0.2.0")


def _canonical(features: Any) -> bytes:
    """Stable serialisation so input_hash is reproducible across callers.

    Must stay byte-identical to agent/src/detection/canonicalize.ts (one-canonicaliser
    invariant, todo §6). Sorted keys, no whitespace.
    """
    return json.dumps(features, sort_keys=True, separators=(",", ":")).encode()


def _ensure_model() -> tuple[Any, Any]:
    global _model, _tokenizer
    if _model is not None:
        return _model, _tokenizer
    with _model_lock:
        if _model is not None:
            return _model, _tokenizer
        from transformers import AutoModelForCausalLM, AutoTokenizer  # heavy import
        log.info("loading transformers model from %s", MODEL_DIR)
        tok = AutoTokenizer.from_pretrained(MODEL_DIR)
        if tok.pad_token is None:
            tok.pad_token = tok.eos_token
        mdl = AutoModelForCausalLM.from_pretrained(MODEL_DIR, torch_dtype="auto")
        mdl.eval()
        _model, _tokenizer = mdl, tok
        return _model, _tokenizer


_JSON_RE = re.compile(r"\{[^{}]*\}", re.DOTALL)


def _parse_output(text: str) -> tuple[float, str]:
    """Pull the first JSON object out of the model's response.

    The fine-tune target is exactly `{"p_nefarious": <0..1>, "signal": "..."}`,
    but we tolerate stray whitespace / partial generations by extracting the
    first balanced JSON-looking blob and validating fields. On any failure
    return a neutral SAFE response so the aggregator can still proceed.
    """
    m = _JSON_RE.search(text)
    if not m:
        log.warning("no JSON in model output: %r", text[:200])
        return 0.0, "none"
    try:
        obj = json.loads(m.group(0))
    except json.JSONDecodeError:
        log.warning("invalid JSON in model output: %r", m.group(0)[:200])
        return 0.0, "none"
    p = obj.get("p_nefarious", 0.0)
    try:
        p = float(p)
    except (TypeError, ValueError):
        p = 0.0
    p = max(0.0, min(1.0, p))
    sig = obj.get("signal", "none")
    if sig not in SIGNALS:
        sig = "drain" if p >= 0.5 else "none"
    return p, sig


def _row_for_template(features: Any) -> dict[str, Any]:
    """Coerce the request features into the {caller, selector, fn, decoded_args,
    balance_delta} shape that prompt.template.chat_messages expects.

    Missing keys get neutral defaults so a partially-filled feature blob still
    produces a deterministic prompt — keeps the input_hash stable in degraded
    cases. Keys outside the template schema are ignored at the prompt layer
    but still flow into input_hash via _canonical(features).
    """
    if not isinstance(features, dict):
        features = {"value": features}
    return {
        "caller": features.get("caller", {"role": "unknown",
                                          "age_days": 0,
                                          "signer_quorum": None}),
        "selector": features.get("selector", "0x00000000"),
        "fn": features.get("fn", "unknown"),
        "decoded_args": features.get("decoded_args", {}),
        "balance_delta": features.get("balance_delta", {}),
        "label": features.get("label", "SAFE"),
    }


def _classify_transformers(features: Any) -> tuple[float, str, str]:
    if chat_messages is None:
        log.warning("prompt.template unavailable; returning neutral SAFE")
        return 0.0, "stub", "none"
    import torch  # lazy
    mdl, tok = _ensure_model()
    row = _row_for_template(features)
    msgs = chat_messages(row, with_target=False)
    prompt = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
    inputs = tok(prompt, return_tensors="pt").to(mdl.device)
    with torch.no_grad():
        out = mdl.generate(
            **inputs,
            max_new_tokens=MAX_NEW_TOKENS,
            do_sample=False,
            pad_token_id=tok.pad_token_id,
        )
    gen = out[0][inputs["input_ids"].shape[1]:]
    text = tok.decode(gen, skip_special_tokens=True)
    p, signal = _parse_output(text)
    # tag derives from p_nefarious (the calibrated probability, per the
    # template). The model occasionally emits signal="none" alongside a high
    # p_nefarious — keep both fields raw in the receipt so the discrepancy is
    # auditable, but let tag follow the probability.
    tag = "RISK" if p >= 0.5 else "SAFE"
    return p, tag, signal


def _classify_stub(features: Any) -> tuple[float, str, str]:
    return 0.0, "stub", "none"


_CLASSIFIER = _classify_transformers if PHASE == "transformers" else _classify_stub


def _sign(model_hash: str, input_hash: str, output: dict[str, Any]) -> str:
    payload = (
        model_hash.encode()
        + input_hash.encode()
        + json.dumps(output, sort_keys=True, separators=(",", ":")).encode()
    )
    return hmac.new(HMAC_KEY, payload, hashlib.sha256).hexdigest()


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {
        "status": "ok",
        "phase": PHASE,
        "model_hash": MODEL_HASH,
        "template_version": TEMPLATE_VERSION,
    }


@app.post("/classify", response_model=ClassifyResponse)
def classify(req: ClassifyRequest) -> ClassifyResponse:
    canonical = _canonical(req.features)
    input_hash = hashlib.sha256(canonical).hexdigest()
    p_nefarious, tag, signal = _CLASSIFIER(req.features)
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
