# Track C — ML pipeline (offline Python)

Fully offline. Independent of every other track. Outputs (CIDs on 0G Storage) feed Tracks D and E.

## Dispatch prompt

> You are working on the Phulax hackathon project. Before writing any code, read `STRATEGY.md`, `tasks/todo.md` (especially §6, §10, §13.3, §13.4, §15), and the root `CLAUDE.md`. `tasks/todo.md` wins on conflicts.
>
> Your job is to build the offline `ml/` artifact pipeline. Python 3.11, managed with `uv`. Python is sandboxed to `ml/` per the **one-language rule** (CLAUDE.md + todo §2): runtime never touches Python — your output is artifacts uploaded to 0G Storage, not a service.
>
> The classifier model is **`Qwen2.5-0.5B-Instruct`** (locked, todo §13.3). It is too small for free-form risk reasoning; use it as a **structured classifier** with a tightly-templated prompt that returns a single JSON object `{"p_nefarious": <0..1>, "tag": "<class>"}`. LoRA fine-tune only — full fine-tune isn't on 0G's surface and isn't needed at this dataset size (todo §10).
>
> Pipeline you must deliver:
>
> 1. **Dataset** (~200 rows): 50 nefarious from public post-mortems (Euler, Mango, Cream, etc.), 150 benign mainnet samples. Schema per row: `{calldata, decoded_args, balance_delta, label}`.
> 2. **Prompt template**: system message defines the task; user message is the canonicalised tx feature blob; assistant target is the JSON object above.
> 3. **LoRA fine-tune** via 0G's fine-tuning surface. Rank 8 or 16, target attention + MLP projections, lr ~2e-4, 3–5 epochs.
> 4. **Merge LoRA into base** locally → safetensors and a Q4-quantized GGUF (~400MB). Both go to 0G Storage.
> 5. **Embeddings track** (separate from the classifier): `all-MiniLM-L6-v2` over `(4-byte selector, abi-decoded args canonicalised, balance-delta vector)`. Push to 0G Storage **KV** with key=exploit id, value=vector+metadata. This is the corpus the agent's vector-similarity tier queries.
> 6. **Eval harness** in `ml/eval/`: 80/20 hold-out, report precision / recall / latency in `ml/eval/REPORT.md`. **Target ≥0.8 precision at ≥0.6 recall.**
> 7. **Upload** merged weights + tokenizer + config + the eval harness itself to 0G Storage. Record CIDs in a JSON manifest at `ml/artifacts.json` so Track D (inference server) and the iNFT metadata can reference them.
>
> Fallback (todo §10 last paragraph + §12): if the classifier underperforms the target, drop it from the live aggregator path; the demo narrative survives because vector similarity is the headline novelty per STRATEGY.md.
>
> Constraints:
> - Don't introduce Python anywhere outside `ml/`.
> - The eval harness is part of the **publish-and-replay verifiability story** (todo §3 + §10) — it must be runnable by a third party with only the 0G Storage CIDs. Treat it as user-facing.
>
> When you finish a chunk, append to the Review section of `tasks/todo.md`. If the user corrects you, update `tasks/lessons.md`.

## Checklist
- [x] C1. Dataset curated (210 rows = 60 RISK + 150 SAFE; `ml/data/build_dataset.py`)
- [x] C2. Prompt template fixed and committed (`ml/prompt/template.py`, v1.0.0)
- [ ] C3. LoRA fine-tune complete on 0G fine-tuning surface — *script ready (`ml/finetune/lora.py`); needs `OG_FT_ENDPOINT` or GPU to execute*
- [ ] C4. Merged weights (safetensors + Q4 GGUF) produced — *script ready (`ml/finetune/merge_and_quantize.py`); needs C3 + `LLAMA_CPP_DIR`*
- [ ] C5. Embeddings indexed in 0G Storage KV — *script ready (`ml/embed/index.py`); needs `OG_STORAGE_ENDPOINT`*
- [ ] C6. Eval harness + REPORT.md hitting ≥0.8 P / ≥0.6 R — *harness ready (`ml/eval/harness.py`); REPORT.md generated on first eval run*
- [ ] C7. Artifacts uploaded to 0G Storage; `ml/artifacts.json` manifest published — *uploader ready (`ml/upload/og_storage.py`); needs C3+C4+C6 outputs and 0G credentials*
