"""Smoke tests for the stub /classify endpoint.

Run: python -m pytest inference/test_server.py
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os

os.environ["PHULAX_INFERENCE_HMAC_KEY"] = "test-key"

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

    output = {"p_nefarious": r["p_nefarious"], "tag": r["tag"]}
    payload = (
        r["model_hash"].encode()
        + r["input_hash"].encode()
        + json.dumps(output, sort_keys=True, separators=(",", ":")).encode()
    )
    expected_sig = hmac.new(b"test-key", payload, hashlib.sha256).hexdigest()
    assert r["signature"] == expected_sig
