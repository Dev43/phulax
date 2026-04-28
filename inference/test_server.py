"""Smoke tests for the /classify endpoint.

The default suite hits the stub path (no PHULAX_MODEL_DIR set) so it stays
fast and zero-dep. The real-model smoke test at the bottom only runs when
PHULAX_MODEL_DIR points at a transformers checkpoint.

Run: python -m pytest inference/test_server.py
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path

os.environ["PHULAX_INFERENCE_HMAC_KEY"] = "test-key"
# Force stub mode for the default suite even if a model is present in the dev tree.
os.environ.setdefault("PHULAX_INFERENCE_PHASE", "stub")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from server import app  # noqa: E402


client = TestClient(app)


def test_healthz():
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_classify_shape_and_stub_value():
    r = client.post("/classify", json={"features": {"foo": 1, "bar": [2, 3]}})
    assert r.status_code == 200
    body = r.json()
    assert body["p_nefarious"] == 0.0
    assert body["tag"] == "stub"
    assert body["signal"] == "none"
    assert body["model_hash"] == "stub"
    assert len(body["input_hash"]) == 64
    assert len(body["signature"]) == 64


def test_input_hash_is_canonical():
    a = client.post("/classify", json={"features": {"a": 1, "b": 2}}).json()
    b = client.post("/classify", json={"features": {"b": 2, "a": 1}}).json()
    assert a["input_hash"] == b["input_hash"]
    assert a["signature"] == b["signature"]


def test_signature_verifies():
    features = {"calldata": "0xdeadbeef", "value": "100"}
    r = client.post("/classify", json={"features": features}).json()

    canonical = json.dumps(features, sort_keys=True, separators=(",", ":")).encode()
    expected_input_hash = hashlib.sha256(canonical).hexdigest()
    assert r["input_hash"] == expected_input_hash

    output = {"p_nefarious": r["p_nefarious"], "tag": r["tag"], "signal": r["signal"]}
    payload = (
        r["model_hash"].encode()
        + r["input_hash"].encode()
        + json.dumps(output, sort_keys=True, separators=(",", ":")).encode()
    )
    expected_sig = hmac.new(b"test-key", payload, hashlib.sha256).hexdigest()
    assert r["signature"] == expected_sig


# Real-model smoke test. Skipped unless an end-to-end run is requested with
# PHULAX_SMOKE_MODEL_DIR pointing at ml/artifacts/merged. We launch a second
# TestClient against a fresh import of the server module configured for the
# transformers phase so the default suite stays in stub mode.
def test_real_inference_smoke():
    model_dir = os.environ.get("PHULAX_SMOKE_MODEL_DIR", "").strip()
    if not model_dir or not Path(model_dir).is_dir():
        pytest.skip("set PHULAX_SMOKE_MODEL_DIR=ml/artifacts/merged to run")

    import importlib
    import sys
    os.environ["PHULAX_MODEL_DIR"] = model_dir
    os.environ["PHULAX_INFERENCE_PHASE"] = "transformers"
    sys.modules.pop("server", None)
    real_server = importlib.import_module("server")
    real_client = TestClient(real_server.app)

    health = real_client.get("/healthz").json()
    assert health["phase"] == "transformers"
    assert health["model_hash"] != "stub"
    assert len(health["model_hash"]) == 64

    features = {
        "caller": {"role": "eoa", "age_days": 1, "signer_quorum": None},
        "selector": "0x69328dec",
        "fn": "withdraw(address,uint256,address)",
        "decoded_args": {"asset": "0xUSD", "amount": "1000000000000000000",
                         "to": "0xATTACKER"},
        "balance_delta": {"0xUSD": "-1000000000000000000"},
    }
    r = real_client.post("/classify", json={"features": features})
    assert r.status_code == 200
    body = r.json()
    assert 0.0 <= body["p_nefarious"] <= 1.0
    assert body["tag"] in ("SAFE", "RISK")
    assert body["signal"] in (
        "none", "drain", "oracle_manipulation", "donation_attack",
        "reentrancy", "governance_hijack", "sig_bypass", "share_inflation",
    )
    assert body["model_hash"] == health["model_hash"]
    assert len(body["input_hash"]) == 64
    assert len(body["signature"]) == 64
