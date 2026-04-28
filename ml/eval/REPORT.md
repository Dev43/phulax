# Phulax classifier eval report

Generated: 2026-04-28 02:23:42 UTC

- mode: `local`
- model: `./artifacts/lora`
- threshold: `0.5`
- targets: precision ≥ 0.8, recall ≥ 0.6

## Confusion matrix (held-out 20%, n=81)

|             | pred SAFE | pred RISK |
|-------------|-----------|-----------|
| actual SAFE | 40 | 15 |
| actual RISK | 2 | 24 |

## Metrics

- precision: **0.615**
- recall:    **0.923**
- f1:        **0.738**
- brier:     **0.1913**  _(lower = better calibrated, 0 = perfect)_
- ece:       **0.2088**  _(10-bin Expected Calibration Error)_

## Latency (ms)

- p50: 2297.8
- p95: 2444.8
- max: 4798.0

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
