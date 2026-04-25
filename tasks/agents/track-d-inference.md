# Track D — Self-hosted inference server

Stub first (so Track A's E2E can pass without waiting on Track C). Real serving lands once C7 publishes weights.

## Dispatch prompt

> You are working on the Phulax hackathon project. Before writing any code, read `STRATEGY.md`, `tasks/todo.md` (especially §3, §6, §9, §10 "Inference serving", §13.4, §15), and the root `CLAUDE.md`. `tasks/todo.md` wins on conflicts.
>
> Your job is to build `inference/` — a self-hosted classifier endpoint serving the LoRA-merged Qwen2.5-0.5B from Track C. **This is not optional and not a 0G Compute call**: 0G's sealed-inference surface does not currently serve our LoRA-adapted weights, so the demo classifier runs here (decision locked in todo §13.4).
>
> **Endpoint contract** (todo §10):
>
> ```
> POST /classify
>   { features: <canonicalised tx feature blob> }
> ->
>   { p_nefarious: number, tag: string,
>     model_hash: string, input_hash: string, signature: string }
> ```
>
> `signature` = HMAC-SHA256 over `(model_hash || input_hash || output)` with a per-deployment key from env. This is the **publish-and-replay** verifiability story (todo §3 + §10) — not TEE-sealed, but tampering is detectable and the 0G-published weights + eval harness mean any third party can replay any fire.
>
> **Phase 1 (do this immediately, ~30 min): a stub.**
> - Returns `{ p_nefarious: 0.0, tag: "stub", model_hash: "stub", input_hash: <sha256(features)>, signature: <hmac> }`.
> - Same shape as the real endpoint. Track A needs this online today so the synthetic workflow can call it via the existing HTTP Request system action.
>
> **Phase 2 (after Track C7 publishes CIDs in `ml/artifacts.json`): real serving.**
> - Default stack: **`llama.cpp` HTTP server** with the Q4-quantized GGUF — single binary, no Python in the runtime image.
> - Fallback: FastAPI wrapping `transformers` directly. Pick whichever lands faster.
> - Boot sequence: read CIDs from `ml/artifacts.json`, fetch merged weights + tokenizer + config from 0G Storage, then start the HTTP server.
> - Compute `model_hash` once at boot from the on-disk weights and bake it into responses.
> - **Reproducibility ledger:** every successful `/classify` response is also written to a 0G Storage Log entry as `(input_hash, output, model_hash, signature, weights_cid)`. The agent process can do this write instead — coordinate with Track E so we don't double-log.
>
> **Hardware / colocation** (open question §15):
> - CPU is sufficient for 0.5B at our QPS (one fire per 0G block). No GPU.
> - Default colocation: same Fly/Railway box as `agent/server.ts`, dedicated process. Switch to a separate container behind a private DNS name only if measurements force it.
>
> **Latency budget**: target <1s per call on CPU. If too slow, swap in a smaller fine-tuned classifier (DistilBERT-class, ~70M params; todo §12 risk #3). Coordinate that fallback with Track C.
>
> Constraints:
> - Python in this directory is fine **only** because it's a runtime dependency of the model, not part of the agent. Keep it isolated; the agent stays TS (one-language rule).
> - No database. Logs go to 0G Storage Log, not Postgres or sqlite.
> - Dockerfile must be reproducible from `ml/artifacts.json` alone.
>
> When you finish a chunk, append to the Review section of `tasks/todo.md`. If the user corrects you, update `tasks/lessons.md`.

## Checklist
- [ ] D1. Stub endpoint live with correct response shape (unblocks Track A E2E)
- [ ] D2. Stack decision (llama.cpp vs FastAPI) recorded in todo Review
- [ ] D3. Real `/classify` serving merged weights from `ml/artifacts.json` CIDs
- [ ] D4. HMAC-SHA256 signing wired with per-deployment key from env
- [ ] D5. Dockerfile reproducible end-to-end
- [ ] D6. Latency measured on CPU; fallback decision if >1s
