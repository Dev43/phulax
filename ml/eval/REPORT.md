# Phulax classifier eval report

Generated: 2026-04-28 16:16:16 UTC

- mode: `local`
- model: `./artifacts/lora`
- threshold: `0.5`
- targets: precision ≥ 0.8, recall ≥ 0.6

## Confusion matrix (held-out 20%, n=81)

|             | pred SAFE | pred RISK |
|-------------|-----------|-----------|
| actual SAFE | 47 | 8 |
| actual RISK | 2 | 24 |

## Metrics

- precision: **0.750**
- recall:    **0.923**
- f1:        **0.828**
- brier:     **0.1148**  _(lower = better calibrated, 0 = perfect)_
- ece:       **0.1092**  _(10-bin Expected Calibration Error)_

## Latency (ms)

- p50: 2346.7
- p95: 2574.2
- max: 2804.0

## Verdict

**FAIL — fall back to vector-similarity-only path (todo §10 last paragraph)**

## Reproducibility

This harness is published to 0G Storage alongside the merged weights. To
reproduce:

```bash
git clone <repo> && cd ml
uv sync
# fetch dataset.jsonl + merged weights from CIDs in artifacts.json
MODEL_DIR=./artifacts/merged uv run python -m eval.harness
```
