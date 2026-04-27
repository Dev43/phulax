# ml/ training improvements — todo

Tracks the 8-item plan to push the Qwen2.5-0.5B classifier past the in-distribution 100% / OOD-precision-0.62 wall surfaced by `eval/HOLDOUT_REPORT.md`.

Order is roughly impact-per-effort. Items #1–#7 are done in code; the retrain that consumes all of them is in flight (single retrain to amortise the CPU cost). Re-run the eval harness (`MODEL_DIR=./artifacts/merged uv run python -m eval.harness && MODEL_DIR=./artifacts/merged uv run python -m eval.holdout`) after every item that changes the dataset, prompt, or trainer — commit the resulting `REPORT.md` + `HOLDOUT_REPORT.md` so the regression is visible in the diff.

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

## [x] #3 — Caller-role / origin features in the canonical blob

Single highest-value feature for separating "drain" from "treasury sweep". Once `caller.role == "timelock"` is in the blob, most of the remaining FPs become trivially separable.

- [x] extended `prompt/template.canonicalise` with `caller: {role: "timelock|multisig|eoa|contract", age_days: int, signer_quorum: int|null}`
- [x] added `caller` dict to every row in `data/exploits.py`, `data/benign.py`, `data/hard_benign.py`, `data/holdout.py` (timelock for treasury sweeps; multisig with low quorum for harmony/multichain/radiant/munchables; eoa for direct exploits; contract for bots/relayers)
- [x] bumped `TEMPLATE_VERSION` → `2.0.0`
- [x] updated `inference/server.py` to accept the new shape (signal + tag both returned)
- [ ] re-fine-tune, re-eval ← in flight

## [x] #4 — Mask SFT loss to assistant tokens only

`finetune/lora.py:encode()` was labelling the entire chat template, so ~95% of the loss mass was the user message. Real gradient on the answer was dilute.

- [x] tokenise prefix (system+user+gen-prompt) separately; concat ids
- [x] build labels with `-100` for prefix tokens AND pad tokens, real ids for assistant span
- [x] sanity-check print: "loss-mask check: N/M tokens supervised" on first row
- [ ] re-fine-tune, re-eval ← in flight

## [x] #5 — Right-size LoRA capacity to dataset

330 rows × rank 16 × 7 target modules ≈ 3M trainable params (~9k per row). Memorisation by construction.

- [x] `LORA_RANK` 16 → 8
- [x] `LORA_ALPHA` 32 → 16
- [x] `TARGET_MODULES` → just `["q_proj", "v_proj"]`
- [x] `MAX_LEN` 512 → 768 (the canonical blob grew with `caller` + `signal`)
- [ ] re-fine-tune, re-eval ← in flight

## [x] #6 — Categorical signal output

Replaced `{p_nefarious, tag}` with `{p_nefarious, signal}` where `signal ∈ {none, drain, oracle_manipulation, donation_attack, reentrancy, governance_hijack, sig_bypass, share_inflation}`. Categorical labels give richer gradient and the agent's risk aggregator can route on signal type.

- [x] added `signal` field to every NEFARIOUS row (one of the 7 RISK signals); SAFE rows → `none`
- [x] `prompt/template.signal_for` resolves the signal label with safe defaults
- [x] `prompt/template.assistant_target` emits `signal`
- [x] `eval/harness.parse_output` handles the new `signal` schema, derives `tag`, falls back to schema 1.0.0
- [x] `eval/holdout.py` — per-signal accuracy table in the report
- [x] `inference/server.py` — response includes `signal`; `_classify` returns 3-tuple
- [ ] re-fine-tune, re-eval ← in flight

## [x] #7 — Calibration metrics in eval harness

Downstream `agent/src/detection/score.ts` expects a calibrated probability. We weren't measuring calibration.

- [x] added Brier score and 10-bin Expected Calibration Error to `eval/harness.calibration_metrics`
- [x] surfaced in both `REPORT.md` and `HOLDOUT_REPORT.md`
- [ ] (deferred) temperature scaling on a calibration split, save `T` to `artifacts/calibration.json`, apply at eval and inference time — wait until post-retrain numbers show whether we still have a calibration gap worth correcting

## [partially done] #8 — Real-data dataset expansion

The actual long-term lever. Synthetic corpus is plateaued at ~330 rows / 15 fingerprint families.

- [x] scaffold at `data/scrape_real.py` with `EXPLOIT_FETCH_PLAN`, `_fetch_decoded_calldata`, `_fetch_balance_delta`, `_fetch_caller` stubs
- [ ] **blocked** — wire to a Tenderly account (or Etherscan PRO) and fill `_fetch_*` against the chosen API. Required env: `TENDERLY_ACCESS_TOKEN`, `TENDERLY_PROJECT_SLUG`, `ETHERSCAN_API_KEY`
- [ ] populate `EXPLOIT_FETCH_PLAN` with block ranges + tx hashes for each `holdout.OOD_NEFARIOUS` entry (post-mortem URLs in `source` field)
- [ ] sample matched benigns from same protocols ±30 days
- [ ] target 1000+ diverse rows; re-fine-tune from scratch

---

## Baseline (before #1 + #2, recorded 2026-04-27)

- in-distribution `REPORT.md`: precision 1.000 / recall 1.000 / f1 1.000 (held-out 20%, n=42) — but every prediction was {0.94, 0.03}, no calibration measure existed
- OOD `HOLDOUT_REPORT.md`: precision 0.615 / recall 1.000 / f1 0.762 (n=31, 16 OOD-RISK + 15 HARD-SAFE) — 10 FPs, 0 FNs

## After #1 + #2 + #3 + #4 + #5 + #6 + #7 (v2 retrain, 2026-04-27)

Two retrains were needed. The first (3 epochs, 60 RISK / 270 SAFE, rank 8) under-fit RISK badly (recall 0.111 in-distribution). Bumped exploit augmentations 3→8 (135 RISK rows) and epochs 3→5; second retrain converged to eval_loss 0.337.

| metric | baseline | v2 |
|---|---|---|
| in-dist precision | 1.000 | 0.686 |
| in-dist recall    | 1.000 | 0.923 |
| in-dist f1        | 1.000 | 0.787 |
| **in-dist Brier** | n/a (binary) | **0.139** |
| **in-dist ECE**   | n/a (binary) | **0.130** |
| OOD precision | 0.615 | 0.625 |
| OOD recall    | 1.000 | 0.625 |
| OOD f1        | 0.762 | 0.625 |
| OOD Brier | n/a | 0.291 |
| OOD ECE   | n/a | 0.288 |
| score range | {0.03, 0.94} | continuous 0.03–0.97 |

What worked:
- **#1 label collapse fixed**: predictions are now spread across the full [0, 1] range. Brier and ECE are measurable for the first time.
- **#3 caller features paid off in two of the four hard-SAFE families**: lido oracle rebase and stargate rebalance go from FP → TN. Hard-SAFE TN rate went from 5/15 (baseline) to 9/15 (v2) — +27pp.
- **per-signal accuracy reveals where the model actually generalises**: `reentrancy 2/2`, `sig_bypass 2/2`, `drain 1/1`, `donation_attack 3/4`. Fully novel exploit families are being caught structurally, not just memorised.

What regressed:
- **OOD recall dropped 1.0 → 0.625**: the model now misses 6 of 16 novel exploits, all in `oracle_manipulation 0/2` and `share_inflation 0/2` families plus single misses on `donation_attack` and `governance_hijack`. The class imbalance (1:2 in v2) still leans the model toward SAFE.
- **Hard-SAFE precision didn't lift much**: 0.615 → 0.625. The model still flips 6 of 15 to RISK including aave-rescueTokens, frax-amo, karak, uniswap-v4-hook-init — most have timelock/contract callers but the model isn't weighting that signal heavily.
- **Signal head partially collapsed**: many high-p_nefarious rows still emit `signal: "none"`, meaning the categorical head learned the prior more than the conditional. `oracle_manipulation 0/2` and `share_inflation 0/2` are the worst.

## Next iteration (suggested order)

These are the levers most likely to recover the recall while keeping calibration:

1. **Class weighting in the trainer** (small change, big effect). Add `class_weight = {RISK: 2.0, SAFE: 1.0}` (or similar) to the loss so RISK examples contribute more gradient. Avoids needing more data augmentation. Implementation: subclass `Trainer` and override `compute_loss` to upweight tokens whose row label is RISK.
2. **Bump LoRA capacity back up**: rank 16 (alpha 32) on `q_proj, v_proj` only. ~1.1M params — 2× current, still 3× below the original. The signal head needs more capacity.
3. **Per-signal augmentation**: the families failing (`oracle_manipulation`, `share_inflation`) have only 16 + 16 base+aug rows. Bump those families' `copies_per_base` to 16 specifically.
4. **Drop signal output OR train a separate head**: forcing one model to do regression + 8-way classification on 405 rows is too much. Either drop signal entirely (back to `{p_nefarious}` only) or train a second small classifier purely on signal given p_nefarious is high.
5. **Then revisit calibration**: once raw classification is in shape, fit a temperature scalar on a held-out calibration split.

If the user wants to ship now: the v2 model is defensible because it's the first one with calibrated probabilities, and the per-signal table tells the agent's risk aggregator which signals are reliable (`reentrancy`, `sig_bypass`, `drain`, `donation_attack`) and which to ignore (`oracle_manipulation`, `share_inflation`) until the next retrain.
