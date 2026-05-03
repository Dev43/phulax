# Inference optimization — pickup notes for an LLM

Self-contained handoff. Read this end-to-end before touching anything; every
file path, env var, and command you need is here.

## TL;DR

Our self-hosted classifier (`inference/server.py`) currently serves Qwen2.5-0.5B
+ LoRA via the `transformers` Python library on CPU. On the colocated Hetzner
CX32 box (4 shared vCPU, 8 GB RAM) a single `/classify` call takes **~2 min cold,
~30–60 s warm** — too slow for the demo's expected cadence.

The cheap quick win has been applied:

- `PHULAX_INFERENCE_MAX_NEW=20` is set in `docker-compose.yml` (was 48 default).
  Output is a single-line JSON `{"p_nefarious": 0.X, "tag": "..."}` which fits in
  ~20 tokens, so generation time is roughly halved.

The big remaining win — **switch to `llama.cpp` serving the Q4 GGUF** — is
**on hold by the user as of 2026-05-02**. This doc captures everything needed
to ship it when work resumes.

Expected speedup: 3–5× on CPU at the same hardware tier.

## What's already in place

1. **GGUF artifact exists locally**, but is NOT committed and NOT on the box:
   - `ml/artifacts/merged/phulax-fp16.gguf` (~949 MB)
   - `ml/artifacts/merged/phulax-q4.gguf` (~380 MB) ← this is what we want to serve
   - Both are gitignored under the `ml/artifacts/` rule and were generated from
     `ml/artifacts/merged/model.safetensors` using the official
     `ghcr.io/ggml-org/llama.cpp:full` Docker image. The reproducible commands
     are recorded in the "Regenerating the GGUF" section below.

2. **`merge_and_quantize.py`** — `ml/finetune/merge_and_quantize.py` already
   has the merge + quantize pipeline; it can produce both fp16 and Q4_K_M GGUFs
   if `LLAMA_CPP_DIR` points at a built llama.cpp checkout. We ended up using
   the Docker image instead because building llama.cpp locally was overkill for
   one conversion.

3. **`inference/server.py`** has a clean `_classifier` selector (line ~245):

   ```python
   _CLASSIFIER = _classify_transformers if PHASE == "transformers" else _classify_stub
   ```

   This is the seam where the new `_classify_llama_cpp` function plugs in.

4. **`inference/Dockerfile`** has a multi-stage layout (`base` → `stub` |
   `transformers`) and the `transformers` stage `COPY`s `ml/artifacts/merged`
   into `/app/model`. Adding a `llama-cpp` target is a small additive change.

5. The wire shape (`POST /classify` payload, signed receipts) is **frozen** —
   the agent and KH workflow already depend on it. **Do not change** it.

## What needs to happen (concrete punch list)

### 1. Add a `llama_cpp` backend to `inference/server.py`

- Add `llama-cpp-python==0.3.2` to `inference/requirements.txt`.
- Add an env var `PHULAX_INFERENCE_BACKEND` accepting `auto | transformers |
  llama_cpp | stub`. Default `auto`. Resolution: if `PHULAX_MODEL_DIR` contains
  a `*.gguf` file → `llama_cpp`; else if it's a transformers dir → `transformers`;
  else → `stub`. (Don't break the existing `PHULAX_INFERENCE_PHASE` env — keep
  both for now; deprecate `PHASE` later.)
- Add a `_classify_llama_cpp(features)` mirroring `_classify_transformers`:
  - Load the model **once** via `llama_cpp.Llama(model_path=..., n_ctx=2048,
    n_threads=os.cpu_count(), verbose=False)`. Lazy-init in `_ensure_model`.
  - Render the prompt with the same `prompt.template.chat_messages(row,
    with_target=False)` used today, then `tok.apply_chat_template(...)`. With
    `llama-cpp-python` you can either:
    - (a) pass the chat template at Llama init time (`chat_format="qwen"` or
      construct from the `.jinja` file), then call
      `Llama.create_chat_completion(messages=...)` and read
      `out["choices"][0]["message"]["content"]`; OR
    - (b) build the prompt string ourselves with the existing jinja template
      and call `Llama(..., prompt=...)` for raw completion.
  - Prefer (a) — less to break. `llama-cpp-python>=0.2.30` accepts a
    `chat_handler` constructed from the sidecar `chat_template.jinja`.
  - Set `temperature=0`, `top_p=1`, `max_tokens=PHULAX_INFERENCE_MAX_NEW`,
    `stop=["</s>", "<|im_end|>"]`. Decoding must be **greedy** (deterministic)
    so `input_hash` reproducibility holds.
  - Reuse the existing `_parse_output(text)` to extract `p_nefarious` and
    `tag`. The response object you get from `_parse_output` was already
    designed to tolerate stray whitespace.
- Compute `MODEL_HASH` from the GGUF file (sha256 of the bytes) at boot, log
  it in the same format as today (`loaded model_dir=... model_hash=...
  template_version=...`). Same line, different value.
- The signed-receipt path (`_sign(model_hash, input_hash, output)`) does NOT
  need to change. The receipt format is locked.

### 2. Update `inference/Dockerfile`

- Add a third final stage `llama_cpp`:

  ```dockerfile
  FROM base AS llama_cpp
  COPY ml/artifacts/merged/phulax-q4.gguf /app/model/phulax-q4.gguf
  ENV PHULAX_MODEL_DIR=/app/model \
      PHULAX_INFERENCE_BACKEND=llama_cpp
  ```

- Add `llama-cpp-python` to the pip install in `base` (not in the new stage,
  so the stub stage stays small for tests). The wheel is ~10 MB, brings in a
  bundled libllama.so. **No GPU build needed** — CPU-only is the default and
  ~3-5x faster than transformers FP16 on CPU anyway.
- Keep `transformers` and `stub` stages as-is. Tests stay fast on `stub`.

### 3. Update `.dockerignore`

- The current `.dockerignore` allows `ml/artifacts/merged/**` through. The new
  GGUF is at `ml/artifacts/merged/phulax-q4.gguf`, so it ships automatically.
  No change needed; just verify with `docker build --target llama_cpp -f
  inference/Dockerfile .` and confirm the GGUF is in `/app/model`.

### 4. Update `docker-compose.yml`

- Switch the `inference` service `build.target` from `transformers` to
  `llama_cpp`.
- Add `PHULAX_INFERENCE_BACKEND: llama_cpp` to the `environment` block (env
  var is also baked into the image but compose-level makes the choice
  explicit).
- Drop `PHULAX_INFERENCE_MAX_NEW: "${PHULAX_INFERENCE_MAX_NEW:-20}"` to a
  default of **32** (llama.cpp is so much faster the savings from clipping
  tokens become marginal; 32 gives more headroom for malformed-output recovery
  in `_parse_output`).
- The image will shrink to roughly **~900 MB compressed** (vs. ~1.7 GB today)
  because the GGUF replaces both `model.safetensors` (988 MB) and the
  `transformers` Python deps' weight loaders.

### 5. Validate locally before pushing

```bash
docker build --target llama_cpp -f inference/Dockerfile -t phulax-inference:llama_cpp .

# warm-start latency:
docker run --rm -e PHULAX_INFERENCE_HMAC_KEY=stub -p 8001:8000 \
  phulax-inference:llama_cpp &
# (wait ~5s for boot, then)
time curl -sS -X POST http://localhost:8001/classify \
  -H 'content-type: application/json' \
  -d '{"features":{"selector":"0xa9059cbb","decoded_args":{"to":"0x000…001","amount":"100"}}}'
# expect: response in <5s warm, model_hash is a 64-char hex (NOT "stub")
```

### 6. Bake-and-deploy

```bash
git add inference/Dockerfile inference/requirements.txt inference/server.py docker-compose.yml
git commit -m "perf(inference): switch backend to llama.cpp Q4 (3-5x faster on CPU)"
git push
ssh root@46.225.141.153 'cd /opt/phulax && git pull && docker compose build --no-cache inference && docker compose up -d --force-recreate inference'
```

### 7. Eval gate

After redeploy, **re-run `ml/eval/REPORT.md`** against the live service:

```bash
cd ml && uv run python -m eval.harness --endpoint https://46.225.141.153/inference/classify \
  --hmac-key "$PHULAX_INFERENCE_HMAC_KEY" --basic-auth ethglobal:iofreoifjeroi4324234
```

Q4 quantization typically loses 1–3 percentage points of precision/recall vs.
the FP16 baseline. The current FP16 eval is `0.750 P / 0.923 R` (in-domain) —
the Q4 path needs to stay above `0.7 P / 0.85 R` to remain a corroborating
signal. If it drops below that, fall back to FP16 GGUF (`phulax-fp16.gguf`)
which is still ~2× faster than transformers FP16 at the cost of double the
disk footprint.

## Regenerating the GGUF (reproducible, ~5 min)

If `ml/artifacts/merged/phulax-q4.gguf` is missing or stale:

```bash
# from repo root, requires ml/artifacts/merged/model.safetensors present
docker pull ghcr.io/ggml-org/llama.cpp:full

# safetensors → fp16 GGUF (~30 s)
docker run --rm -v $(pwd)/ml/artifacts/merged:/model \
  ghcr.io/ggml-org/llama.cpp:full \
  --convert /model --outfile /model/phulax-fp16.gguf --outtype f16

# fp16 GGUF → Q4_K_M GGUF (~3 s, ~380 MB output)
docker run --rm -v $(pwd)/ml/artifacts/merged:/model \
  ghcr.io/ggml-org/llama.cpp:full \
  --quantize /model/phulax-fp16.gguf /model/phulax-q4.gguf Q4_K_M
```

(The same outputs are also produced by `python -m finetune.merge_and_quantize`
when `LLAMA_CPP_DIR` is set to a built llama.cpp checkout — see
`ml/finetune/merge_and_quantize.py`. The Docker route is preferred because
it doesn't require building llama.cpp locally.)

## Why we didn't go further (current state of the art for this box)

- **GPU inference**: not available on Hetzner CX32. CCX series with GPUs
  exists but costs ~10× the box price for our token rate. Not worth it for a
  single 0.5B model.
- **`llama.cpp` server-mode native**: replacing the FastAPI wrapper with the
  llama.cpp HTTP server (`./llama-server`) skips one layer but loses our
  HMAC-signed receipt logic, which is contractually depended on by the agent
  and the KH workflow. Keep FastAPI.
- **Speculative decoding / draft model**: 3–4× win in theory but needs a
  smaller "draft" model trained the same way. Out of scope for hackathon.
- **Batching**: workflow fires one /classify per detection, not multiple
  concurrently. No batching opportunity.

## Sharp edges to watch

- **`llama-cpp-python` build time** on the inference Dockerfile. The wheel
  prebuilds for `linux/amd64` Python 3.11 are available since 0.2.85; pin the
  version to dodge a 5-minute source build. If the wheel isn't found, install
  build tools (`apt-get install -y build-essential cmake`) — it'll still work
  but image build jumps from ~2 min to ~7 min.
- **Token sampling determinism**: `temperature=0` with `llama.cpp` uses
  greedy decoding the same way `transformers` does. Verify by hashing the
  output bytes of a fixed input across 5 calls — must be identical.
- **Chat template attachment**: `chat_template.jinja` is the same file as
  the transformers path uses. With `llama-cpp-python`, pass it via the
  `chat_handler=Jinja2ChatFormatter(template=Path(...).read_text(), eos_token="<|im_end|>", bos_token="")`
  pattern. Don't rely on auto-detection from the GGUF metadata — it sometimes
  picks a generic template and breaks the structured-JSON output the model
  was fine-tuned to emit.
- **GGUF doesn't ship the tokenizer.json sidecar**, but llama.cpp embeds the
  tokenizer in the GGUF itself, so this Just Works.
- **`MODEL_HASH` definition changes**: we currently sha256 the
  `model.safetensors` file. Switch to sha256 of the `.gguf` file so the
  receipts continue to anchor to a single, on-disk artifact. Update
  `_hash_model_dir()` to look for `*.gguf` first, then fall back to
  `model.safetensors`.

## Done criteria

You're done when ALL of these are true:

- [ ] `curl https://46.225.141.153/inference/classify` (basic-auth gated)
      returns a response in **< 10 s warm**, **< 30 s cold**.
- [ ] `/healthz` returns `phase: "transformers"` *or* `phase: "llama_cpp"`
      with a 64-char hex `model_hash` (not `"stub"`).
- [ ] Eval harness reports ≥ `0.7 P / 0.85 R`.
- [ ] A workflow fired by `scripts/send-nefarious.sh` completes in
      **< 30 s end-to-end** (vs. 2m49s today).
- [ ] Receipt signature still verifies with the same key the agent uses
      (HMAC compatibility unchanged).
