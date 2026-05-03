"""Phulax self-hosted classifier endpoint.

Phase 3 (this file): three serving backends behind one wire shape.
  - llama_cpp     — Q4 GGUF via llama-cpp-python (fastest CPU path, default
                    when a *.gguf file lives under PHULAX_MODEL_DIR)
  - transformers  — full safetensors via the transformers library
  - stub          — deterministic SAFE-only fallback for tests / dep-free runs

Selection is automatic via PHULAX_INFERENCE_BACKEND=auto:
  *.gguf in MODEL_DIR  →  llama_cpp
  transformers files   →  transformers
  neither              →  stub
PHULAX_INFERENCE_BACKEND=llama_cpp|transformers|stub forces a specific path
(legacy PHULAX_INFERENCE_PHASE is honored as a fallback for the same choice).

Contract (todo §10):
    POST /classify { features: <canonicalised tx feature blob> }
    -> { p_nefarious, tag, signal, model_hash, input_hash, signature }

signature = HMAC-SHA256(key, model_hash || input_hash || output_json)
key       = PHULAX_INFERENCE_HMAC_KEY env var (per-deployment)

Boot env:
    PHULAX_MODEL_DIR              path to ml/artifacts/merged or a dir with *.gguf
    PHULAX_INFERENCE_HMAC_KEY     receipt-signing key (no in-image default)
    PHULAX_INFERENCE_BACKEND      'auto' (default) | 'stub' | 'transformers' | 'llama_cpp'
    PHULAX_INFERENCE_PHASE        legacy alias for BACKEND
    PHULAX_INFERENCE_MAX_NEW      max new tokens for the JSON response (default 48)
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


# Resolve backend with new-name preference, fall through to legacy PHASE name.
_BACKEND_REQUEST = (
    os.environ.get("PHULAX_INFERENCE_BACKEND")
    or os.environ.get("PHULAX_INFERENCE_PHASE")
    or "auto"
).lower()
MODEL_DIR = os.environ.get("PHULAX_MODEL_DIR", "").strip()
HMAC_KEY = os.environ.get("PHULAX_INFERENCE_HMAC_KEY", "dev-insecure-key").encode()
MAX_NEW_TOKENS = int(os.environ.get("PHULAX_INFERENCE_MAX_NEW", "48"))


def _find_gguf(model_dir: Path) -> Path | None:
    """First *.gguf under model_dir, sorted (so phulax-q4.gguf wins over phulax-fp16.gguf)."""
    if not model_dir.is_dir():
        return None
    ggufs = sorted(model_dir.glob("*.gguf"))
    # Prefer Q* (quantized) over fp16 — Q comes before f in ASCII, so the
    # default sort already does the right thing for our naming convention
    # (phulax-q4.gguf < phulax-fp16.gguf is False — sort by size instead).
    if not ggufs:
        return None
    return min(ggufs, key=lambda p: p.stat().st_size)


def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _hash_model_dir(model_dir: Path) -> str:
    """Compute the published model_hash for the receipt.

    Prefer the GGUF (matches what `python -m upload.og_storage` records when
    the GGUF is the published artifact). Fall back to model.safetensors, then
    to a deterministic hash of every file in the dir.
    """
    gguf = _find_gguf(model_dir)
    if gguf is not None:
        return _hash_file(gguf)
    weights = model_dir / "model.safetensors"
    if weights.exists():
        return _hash_file(weights)
    h = hashlib.sha256()
    for p in sorted(model_dir.iterdir()):
        if p.is_file():
            h.update(p.name.encode())
            h.update(p.read_bytes())
    return h.hexdigest()


def _resolve_phase() -> tuple[str, str]:
    """Decide stub | transformers | llama_cpp and compute MODEL_HASH at boot.

    Returns (phase, model_hash). `phase` matches what /healthz reports.
    """
    if _BACKEND_REQUEST == "stub":
        return "stub", os.environ.get("PHULAX_MODEL_HASH", "stub")

    have_dir = bool(MODEL_DIR) and Path(MODEL_DIR).is_dir()
    gguf = _find_gguf(Path(MODEL_DIR)) if have_dir else None

    # Auto: prefer llama_cpp when a GGUF is present, else transformers, else stub.
    if _BACKEND_REQUEST == "auto":
        if gguf is not None:
            phase = "llama_cpp"
        elif have_dir:
            phase = "transformers"
        else:
            return "stub", os.environ.get("PHULAX_MODEL_HASH", "stub")
    elif _BACKEND_REQUEST in ("llama_cpp", "transformers"):
        phase = _BACKEND_REQUEST
        if not have_dir:
            raise RuntimeError(
                f"PHULAX_INFERENCE_BACKEND={phase} but PHULAX_MODEL_DIR={MODEL_DIR!r} is not a directory"
            )
        if phase == "llama_cpp" and gguf is None:
            raise RuntimeError(
                f"PHULAX_INFERENCE_BACKEND=llama_cpp but no *.gguf under {MODEL_DIR}"
            )
    else:
        log.warning("unknown PHULAX_INFERENCE_BACKEND=%r; falling back to stub", _BACKEND_REQUEST)
        return "stub", os.environ.get("PHULAX_MODEL_HASH", "stub")

    try:
        mh = _hash_model_dir(Path(MODEL_DIR))
        log.info(
            "loaded model_dir=%s phase=%s model_hash=%s template_version=%s gguf=%s",
            MODEL_DIR, phase, mh, TEMPLATE_VERSION, gguf.name if gguf else None,
        )
        return phase, mh
    except Exception as e:
        log.warning("model_hash failed for %s: %s; falling back to stub", MODEL_DIR, e)
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


app = FastAPI(title="phulax-inference", version="0.3.0")


def _canonical(features: Any) -> bytes:
    """Stable serialisation so input_hash is reproducible across callers.

    Must stay byte-identical to agent/src/detection/canonicalize.ts (one-canonicaliser
    invariant, todo §6). Sorted keys, no whitespace.
    """
    return json.dumps(features, sort_keys=True, separators=(",", ":")).encode()


def _ensure_transformers_model() -> tuple[Any, Any]:
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
        # transformers 4.43+ stores chat templates in a sidecar chat_template.jinja
        # next to tokenizer_config.json. AutoTokenizer.from_pretrained does not
        # always auto-attach it on local-dir loads (observed on 4.46.3 against
        # ml/artifacts/merged), so set it explicitly when present.
        if not getattr(tok, "chat_template", None):
            template_file = Path(MODEL_DIR) / "chat_template.jinja"
            if template_file.exists():
                tok.chat_template = template_file.read_text()
                log.info("attached chat_template from %s", template_file)
        mdl = AutoModelForCausalLM.from_pretrained(MODEL_DIR, torch_dtype="auto")
        mdl.eval()
        _model, _tokenizer = mdl, tok
        return _model, _tokenizer


def _ensure_llama_cpp_model() -> Any:
    """Lazy-init llama_cpp.Llama with the chat template attached."""
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        from llama_cpp import Llama  # heavy import
        from llama_cpp.llama_chat_format import Jinja2ChatFormatter

        gguf = _find_gguf(Path(MODEL_DIR))
        if gguf is None:
            raise RuntimeError(f"no *.gguf under {MODEL_DIR}")
        log.info("loading llama_cpp model from %s", gguf)

        # Chat template: prefer the sidecar .jinja from the merged dir over
        # whatever's embedded in the GGUF (the embedded one occasionally
        # decays to a generic format that breaks structured-JSON output).
        template_file = Path(MODEL_DIR) / "chat_template.jinja"
        chat_handler = None
        if template_file.exists():
            chat_handler = Jinja2ChatFormatter(
                template=template_file.read_text(),
                eos_token="<|im_end|>",
                bos_token="",
            ).to_chat_handler()
            log.info("attached chat_template from %s", template_file)

        n_threads = max(1, (os.cpu_count() or 4))
        mdl = Llama(
            model_path=str(gguf),
            n_ctx=int(os.environ.get("PHULAX_INFERENCE_N_CTX", "2048")),
            n_threads=n_threads,
            n_threads_batch=n_threads,
            chat_handler=chat_handler,
            verbose=False,
        )
        _model = mdl
        return _model


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
    mdl, tok = _ensure_transformers_model()
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


def _classify_llama_cpp(features: Any) -> tuple[float, str, str]:
    if chat_messages is None:
        log.warning("prompt.template unavailable; returning neutral SAFE")
        return 0.0, "stub", "none"
    mdl = _ensure_llama_cpp_model()
    row = _row_for_template(features)
    msgs = chat_messages(row, with_target=False)
    # Greedy decode (temperature=0, top_p=1, top_k=1) so input_hash → output
    # remains deterministic across calls. Receipts only round-trip if this
    # holds.
    out = mdl.create_chat_completion(
        messages=msgs,
        max_tokens=MAX_NEW_TOKENS,
        temperature=0.0,
        top_p=1.0,
        top_k=1,
        stop=["</s>", "<|im_end|>"],
    )
    text = out["choices"][0]["message"]["content"] or ""
    p, signal = _parse_output(text)
    tag = "RISK" if p >= 0.5 else "SAFE"
    return p, tag, signal


def _classify_stub(features: Any) -> tuple[float, str, str]:
    return 0.0, "stub", "none"


_CLASSIFIER = (
    _classify_llama_cpp if PHASE == "llama_cpp"
    else _classify_transformers if PHASE == "transformers"
    else _classify_stub
)


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
