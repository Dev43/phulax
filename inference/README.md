# `inference/` — self-hosted Phulax classifier

FastAPI endpoint that wraps a merged Qwen2.5-0.5B + Phulax-LoRA checkpoint and returns `{p_nefarious, tag, model_hash, input_hash, signature}` per call. The KeeperHub workflow calls this via the existing **HTTP Request** system action (no new plugin needed); the agent independently recomputes `input_hash` and verifies the HMAC signature before logging the receipt to 0G Storage.

We host this ourselves because 0G's sealed-inference surface does not currently serve our LoRA-adapted weights. The verifiability replacement is **publish-and-replay**: merged weights + eval harness are uploaded to 0G Storage, every fire writes a signed `(input_hash, output, model_hash)` receipt to a 0G Storage Log, and anyone with the CIDs can replay (`tasks/todo.md` §10, §13.4).

## Endpoint

```
POST /classify
  body: { features: { selector, value, ... } }
  -> { p_nefarious, tag, model_hash, input_hash, signature }

GET /healthz -> 200 OK
```

- `input_hash = sha256(canonical_json(features))` — sorted keys, `(",", ":")` separators. **Must be byte-identical to `agent/src/detection/canonicalize.ts`** — this is one of the locked invariants in `tasks/todo.md` §3 ("one canonicaliser").
- `signature = HMAC-SHA256(PHULAX_INFERENCE_HMAC_KEY, model_hash || input_hash || canonical_json(output))`. The agent verifies before trusting. Operator could lie, but tampering is detectable.
- `model_hash` is computed at boot from the safetensors files in `PHULAX_MODEL_DIR`. Logged once at startup so it appears in container logs alongside the published CID.

## Two modes

| Mode | When | Cost |
|---|---|---|
| **Real inference** | `PHULAX_MODEL_DIR` is set and points at a merged checkpoint (e.g. `ml/artifacts/merged/`) | ~2 GB image (torch + transformers); ~1–3 s per call on CPU |
| **Stub** | `PHULAX_MODEL_DIR` is unset | Returns deterministic SAFE; ~150 MB image; useful for tests + Track-A workflow smoke tests without weights |

Both modes return the same response shape and HMAC-sign identically, so callers don't branch.

## Run locally

```bash
pip install -r requirements.txt
export PHULAX_INFERENCE_HMAC_KEY=$(openssl rand -hex 32)
export PHULAX_MODEL_DIR=/abs/path/to/ml/artifacts/merged   # optional; stub if unset
uvicorn server:app --reload

# verify
curl -X POST http://localhost:8000/classify \
  -H 'content-type: application/json' \
  -d '{"features":{"selector":"0xa9059cbb","value":"0"}}'
```

Tests: `pytest test_server.py` runs the four stub-mode tests (healthz, response shape, hash determinism, signature verify). For a real-weights smoke test set `PHULAX_SMOKE_MODEL_DIR` to a merged checkpoint path; default suite stays in stub mode and runs in <1 s.

## Build & deploy

```bash
docker build -f inference/Dockerfile -t phulax-inference .   # build context = repo root (Dockerfile copies ml/prompt/)
docker run -p 8000:8000 \
  -e PHULAX_INFERENCE_HMAC_KEY=<32-byte hex> \
  -e PHULAX_MODEL_DIR=/app/model \
  -v "$(pwd)/ml/artifacts/merged:/app/model:ro" \
  phulax-inference
```

For the demo, deploy this single container to Fly.io or Railway behind a public URL. CPU is fine — 0.5 B Q4 on a small instance handles the demo's QPS (one fire per 0G block, low rate).

## Inputs

- `PHULAX_INFERENCE_HMAC_KEY` (required, no in-image default).
- `PHULAX_MODEL_DIR` (optional). If set, contents are hashed into `model_hash` and used to load the merged Qwen2.5-0.5B + LoRA via `transformers`.
- `ml/prompt/template.py` is copied into the image at build time (under `/app/ml/prompt/`). Importing `chat_messages` + `SIGNALS` + `TEMPLATE_VERSION` from the same source as fine-tune + eval prevents train/serve skew. Bumping `TEMPLATE_VERSION` invalidates published weights.

## Performance / quality

Latest eval (`ml/eval/REPORT.md`, 2026-04-28): **0.750 P / 0.923 R / F1 0.828** on the in-domain holdout, **0.625 / 0.625** on the OOD set (`ml/eval/HOLDOUT_REPORT.md`). The agent's classifier weight `(p − 0.5) × 0.8` caps the classifier-alone contribution to `0.344`, well below the `0.7` fire threshold — corroboration from at least one other tier is required, by design. Full re-train script: `ml/finetune/colab_train.ipynb` (Colab T4, ~12–20 min) or `ml/finetune/lora.py` locally.

## See also

- `ml/README.md` — how the merged weights and the eval harness get produced.
- `tasks/todo.md` §10 — full inference-serving spec including the publish-and-replay verifiability story.
- `agent/README.md` — the caller, and the only thing that signs receipts in the runtime.
