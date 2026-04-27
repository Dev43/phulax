# Phulax classifier eval report

Generated: 2026-04-27 00:39:54 UTC

- mode: `local`
- model: `./artifacts/merged`
- threshold: `0.5`
- targets: precision ≥ 0.8, recall ≥ 0.6

## Confusion matrix (held-out 20%, n=42)

|             | pred SAFE | pred RISK |
|-------------|-----------|-----------|
| actual SAFE | 32 | 0 |
| actual RISK | 0 | 10 |

## Metrics

- precision: **1.000**
- recall:    **1.000**
- f1:        **1.000**

## Latency (ms)

- p50: 2088.3
- p95: 2326.9
- max: 2429.8

## Verdict

**PASS**

## Reproducibility

This harness is published to 0G Storage alongside the merged weights. To
reproduce:

```bash
git clone <repo> && cd ml
uv sync
# fetch dataset.jsonl + merged weights from CIDs in artifacts.json
MODEL_DIR=./artifacts/merged uv run python -m eval.harness
```
