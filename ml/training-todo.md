# ml/ training improvements — todo

Tracks the 8-item plan to push the Qwen2.5-0.5B classifier past the in-distribution 100% / OOD-precision-0.62 wall surfaced by `eval/HOLDOUT_REPORT.md`.

Order is roughly impact-per-effort. Items #1–#2 are done; everything else is a fresh task. Re-run the eval harness (`MODEL_DIR=./artifacts/merged uv run python -m eval.harness && MODEL_DIR=./artifacts/merged uv run python -m eval.holdout`) after every item that changes the dataset, prompt, or trainer — commit the resulting `REPORT.md` + `HOLDOUT_REPORT.md` so the regression is visible in the diff.

---

## [x] #1 — Stop label collapse (per-row `risk_score` targets)

`prompt/template.py:assistant_target` was hard-coded to `0.94 / 0.03`, so the fine-tune produced a binary classifier in regression clothing. Now reads `row["risk_score"]` set per-row.

- [x] `data/exploits.py` — `risk_score` field per NEFARIOUS row, severity-banded (donation/sig-bypass 0.95-0.97, oracle/reentrancy 0.92-0.94, compromised-key 0.82)
- [x] `data/exploits.py:synthesise_nefarious_more` — jitter score by ±0.03 within bounds
- [x] `data/benign.py` — random `risk_score` in 0.02-0.08
- [x] `prompt/template.py:assistant_target` — read `row["risk_score"]`, fallback to old constants for unmigrated rows
- [x] verified target distribution: RISK 0.81-0.99 (44 unique), SAFE 0.02-0.08 (58 unique)

## [x] #2 — Hard-SAFE training set generator

The 10/15 holdout false positives were all "large but legit." `data/benign.py` only emits small-amount routine ops, so the model had no anchor for size ≠ exploit.

- [x] `data/hard_benign.py` — generator across 12 families (treasury sweeps, whale deposits, liquidations, vault rebalances, PSM swaps, bridge mints, slashes, oracle updates, rewards claims, LP migrations, POL harvests, seeded market inits)
- [x] `risk_score` 0.10-0.25 — clearly SAFE but elevated above routine 0.02-0.08
- [x] wired into `data/build_dataset.py` (120 rows; dataset 210 → 330)
- [x] replaced `data/holdout.py:HARD_SAFE` with 15 fresh adversarial rows from genuinely different protocols (Lido, EigenLayer, GMX, Frax AMO, Pendle PT maturity, Karak, Maker DSR, Stargate, Synthetix, Spark D3M, Uniswap v4 hook init, JonesDAO, Curve admin fee, Aave rescueTokens, Convex shutdown) so the holdout stays a true generalisation test

## [ ] Re-fine-tune + re-run both eval harnesses after #1 + #2

```bash
cd ml
uv run python -m data.build_dataset
uv run python -m finetune.lora
uv run python -m finetune.merge_and_quantize
MODEL_DIR=./artifacts/merged uv run python -m eval.harness
MODEL_DIR=./artifacts/merged uv run python -m eval.holdout
```

- [ ] in-distribution `REPORT.md` — expect Brier-style improvement (scores spread across 0.02-0.99) but precision/recall should stay at or near 1.0
- [ ] OOD `HOLDOUT_REPORT.md` — predict precision lifts ~0.62 → ~0.85 with no recall loss; remaining FPs become the next backlog
- [ ] commit both reports

## [ ] #3 — Caller-role / origin features in the canonical blob

Single highest-value feature for separating "drain" from "treasury sweep". Once `caller.role == "timelock"` is in the blob, most of the remaining FPs become trivially separable.

- [ ] extend `prompt/template.canonicalise` with `caller: {role: "timelock|multisig|eoa|contract", age_days: int, signer_quorum: int|null}`
- [ ] add `caller` dict to every row in `data/exploits.py`, `data/benign.py`, `data/hard_benign.py`, `data/holdout.py` (timelock for treasury sweeps; multisig with low quorum for harmony/multichain/radiant; eoa for direct exploits)
- [ ] bump `TEMPLATE_VERSION` → `2.0.0`
- [ ] update `inference/server.py` to accept the new shape; bump model_hash on next merge
- [ ] re-fine-tune, re-eval

## [ ] #4 — Mask SFT loss to assistant tokens only

`finetune/lora.py:encode()` currently labels the entire chat template, so ~95% of the loss mass is the user message (the huge canonical JSON). Real gradient on the answer is dilute.

- [ ] tokenise prefix (system+user) and assistant target separately; concat ids
- [ ] build labels with `-100` for prefix tokens, real ids for assistant span
- [ ] sanity-check: print label coverage on one row before training
- [ ] re-fine-tune, re-eval

## [ ] #5 — Right-size LoRA capacity to dataset

330 rows × rank 16 × 7 target modules ≈ 3M trainable params (~9k per row). Memorisation by construction.

- [ ] `LORA_RANK` 16 → 8
- [ ] `LORA_ALPHA` 32 → 16
- [ ] `TARGET_MODULES` → just `["q_proj", "v_proj"]`
- [ ] re-fine-tune, re-eval — accept some in-distribution accuracy hit if OOD generalises better

## [ ] #6 — Categorical signal output

Replace `{p_nefarious, tag}` with `{p_nefarious, signal}` where `signal ∈ {oracle_manipulation, donation_attack, reentrancy, governance_hijack, sig_bypass, share_inflation, drain, none}`. Categorical labels give richer gradient and the agent's risk aggregator can route on signal type, not just scalar.

- [ ] add `signal` field to every NEFARIOUS row (one of the 7 RISK signals); SAFE rows → `none`
- [ ] update `prompt/template.assistant_target` to emit `signal`
- [ ] update `eval/harness.parse_output` to parse it; add per-signal recall to the report
- [ ] update `inference/server.py` response schema; bump `TEMPLATE_VERSION`
- [ ] re-fine-tune, re-eval

## [ ] #7 — Calibration metrics in eval harness

Downstream `agent/src/detection/score.ts` expects a calibrated probability. We're not measuring calibration today.

- [ ] add Brier score and Expected Calibration Error (10-bin) to `metrics()` in `eval/harness.py` and `eval/holdout.py`
- [ ] include in `REPORT.md` / `HOLDOUT_REPORT.md`
- [ ] (optional) fit temperature scaling on a calibration split, save `T` to `artifacts/calibration.json`, apply at eval and inference time

## [ ] #8 — Real-data dataset expansion

The actual long-term lever. Everything above is wringing more from a 60-fingerprint corpus.

- [ ] script (Tenderly or Etherscan API) to fetch decoded calldata for the OOD exploits in `data/holdout.py:OOD_NEFARIOUS` from real on-chain block ranges
- [ ] script to sample matched benigns from the same blocks (same protocol, same selectors, different outcome)
- [ ] cross-reference with the post-mortem corpus the `embed/` pipeline indexes
- [ ] target 1000+ diverse rows
- [ ] re-fine-tune from scratch; this is when `Qwen2.5-1.5B` becomes worth trying

---

## Baseline (before #1 + #2, recorded 2026-04-27)

- in-distribution `REPORT.md`: precision 1.000 / recall 1.000 / f1 1.000 (held-out 20%, n=42) — but every prediction was {0.94, 0.03}
- OOD `HOLDOUT_REPORT.md`: precision 0.615 / recall 1.000 / f1 0.762 (n=31, 16 OOD-RISK + 15 HARD-SAFE) — 10 FPs, 0 FNs
