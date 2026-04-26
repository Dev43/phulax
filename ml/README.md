# Phulax `ml/` — offline artifact pipeline

Python is sandboxed here per the one-language rule (`CLAUDE.md`, `tasks/todo.md` §2). Runtime never touches Python: this directory produces artifacts that get uploaded to 0G Storage and consumed by Track D (`inference/`) and Track E (`agent/`) and referenced from the iNFT metadata.

## What this pipeline produces

1. `data/dataset.jsonl` — ~200 rows: 50 nefarious (curated from public post-mortems), 150 benign (mainnet-shape synthetic). Schema: `{calldata, decoded_args, balance_delta, label, source}`.
2. `prompt/template.py` — frozen prompt template. Single source of truth used by both fine-tune and inference.
3. `finetune/lora.py` — LoRA fine-tune of `Qwen2.5-0.5B-Instruct` (rank 16, lr 2e-4, 3 epochs). Emits adapter weights to `artifacts/lora/`.
4. `finetune/merge_and_quantize.py` — merges adapter into base → `artifacts/merged/` (safetensors) and `artifacts/merged/phulax-q4.gguf` via llama.cpp.
5. `embed/index.py` — embeds the corpus with `all-MiniLM-L6-v2` and pushes vectors to 0G Storage KV. Key = exploit id, value = vector + metadata.
6. `eval/harness.py` — 80/20 hold-out, computes precision / recall / F1 / latency, writes `eval/REPORT.md`.
7. `upload/og_storage.py` — uploads merged weights, tokenizer, config, eval harness to 0G Storage; writes `artifacts.json` manifest.

## Run order

```bash
cd ml
uv sync
uv run python -m data.build_dataset           # → data/dataset.jsonl
uv run python -m finetune.lora                 # → artifacts/lora/
uv run python -m finetune.merge_and_quantize   # → artifacts/merged/{,*.gguf}
uv run python -m eval.harness                  # → eval/REPORT.md
uv run python -m embed.index                   # → 0G Storage KV
uv run python -m upload.og_storage             # → artifacts.json
```

## Environment

Set in `.env` (see `.env.example`):

- `OG_STORAGE_ENDPOINT` — KV/Log HTTP endpoint
- `OG_STORAGE_TOKEN` — bearer for the above
- `OG_FT_ENDPOINT` / `OG_FT_TOKEN` — 0G fine-tuning surface (optional; falls back to local LoRA training)
- `LLAMA_CPP_DIR` — path to a built `llama.cpp` checkout (for GGUF conversion + quantization)

## Verifiability story

Per `tasks/todo.md` §3 + §10, the runtime classifier is self-hosted, not 0G sealed inference. The verifiability replacement is **publish-and-replay**: this entire harness ships to 0G Storage alongside the merged weights. A third party with only the CIDs in `artifacts.json` can reproduce every reported number. Treat `eval/` as user-facing.

## Fallback

If `eval/REPORT.md` falls below the target (≥0.8 precision @ ≥0.6 recall), the classifier is dropped from the live aggregator path; vector similarity (`embed/`) becomes the headline novelty — it stands on its own per `STRATEGY.md`. Document the miss in `REPORT.md`; do not silently downgrade.
