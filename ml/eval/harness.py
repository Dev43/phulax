"""Eval harness - precision/recall/latency on the held-out 20%.

Designed to be runnable by a third party with only the 0G Storage CIDs of
(merged_weights, tokenizer, dataset, this script). Per tasks/todo.md §3 + §10
this is part of the publish-and-replay verifiability story.

Two modes:
  - `MODEL_DIR` env points at a local merged-weights directory  → load via transformers
  - `INFERENCE_URL` env set                                     → POST to Track D's endpoint

Reports go to ml/eval/REPORT.md.
"""

from __future__ import annotations

import json
import os
import re
import statistics
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "dataset.jsonl"
REPORT = Path(__file__).parent / "REPORT.md"

SEED = 1337
THRESHOLD = 0.5  # tag SAFE if p<thr else RISK
TARGET_PRECISION = 0.8
TARGET_RECALL = 0.6


def split_eval(rows: list[dict]) -> list[dict]:
    import random
    rng = random.Random(SEED)
    rng.shuffle(rows)
    return rows[int(len(rows) * 0.8):]


def parse_output(text: str) -> tuple[float, str]:
    """Extract {p_nefarious, tag} from the model's raw text. Robust to stray prose."""
    m = re.search(r"\{[^{}]*\"p_nefarious\"[^{}]*\}", text)
    if not m:
        return (0.5, "SAFE")
    try:
        obj = json.loads(m.group(0))
        p = float(obj.get("p_nefarious", 0.5))
        tag = str(obj.get("tag", "SAFE")).upper()
        return (max(0.0, min(1.0, p)), tag if tag in ("SAFE", "RISK") else "SAFE")
    except (ValueError, json.JSONDecodeError):
        return (0.5, "SAFE")


def classify_local(rows: list[dict]) -> list[tuple[float, str, float]]:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    from prompt.template import chat_messages

    model_dir = os.environ["MODEL_DIR"]
    print(f"loading {model_dir}")
    tok = AutoTokenizer.from_pretrained(model_dir)
    model = AutoModelForCausalLM.from_pretrained(
        model_dir,
        torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
        device_map="auto" if torch.cuda.is_available() else None,
    )
    model.eval()

    out = []
    for row in rows:
        prompt = tok.apply_chat_template(
            chat_messages(row, with_target=False),
            tokenize=False, add_generation_prompt=True,
        )
        ids = tok(prompt, return_tensors="pt").to(model.device)
        t0 = time.perf_counter()
        with torch.no_grad():
            gen = model.generate(
                **ids, max_new_tokens=48, do_sample=False,
                pad_token_id=tok.pad_token_id or tok.eos_token_id,
            )
        latency = (time.perf_counter() - t0) * 1000
        text = tok.decode(gen[0][ids.input_ids.shape[1]:], skip_special_tokens=True)
        p, tag = parse_output(text)
        out.append((p, tag, latency))
    return out


def classify_remote(rows: list[dict]) -> list[tuple[float, str, float]]:
    import httpx

    from prompt.template import canonicalise

    url = os.environ["INFERENCE_URL"]
    out = []
    with httpx.Client(timeout=60) as c:
        for row in rows:
            t0 = time.perf_counter()
            r = c.post(url, json={"features": json.loads(canonicalise(row))})
            r.raise_for_status()
            latency = (time.perf_counter() - t0) * 1000
            j = r.json()
            out.append((float(j["p_nefarious"]), str(j["tag"]).upper(), latency))
    return out


def metrics(rows: list[dict], preds: list[tuple[float, str, float]]) -> dict:
    tp = fp = fn = tn = 0
    for row, (p, _tag, _lat) in zip(rows, preds):
        actual_risk = row["label"] == "RISK"
        pred_risk = p >= THRESHOLD
        if actual_risk and pred_risk: tp += 1
        elif actual_risk and not pred_risk: fn += 1
        elif not actual_risk and pred_risk: fp += 1
        else: tn += 1
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    lats = [lat for _, _, lat in preds]
    return {
        "n": len(rows), "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": precision, "recall": recall, "f1": f1,
        "threshold": THRESHOLD,
        "latency_ms": {
            "p50": statistics.median(lats),
            "p95": sorted(lats)[int(len(lats) * 0.95) - 1] if lats else 0,
            "max": max(lats) if lats else 0,
        },
    }


def write_report(m: dict, mode: str, model_ref: str) -> None:
    passed = m["precision"] >= TARGET_PRECISION and m["recall"] >= TARGET_RECALL
    verdict = "**PASS**" if passed else "**FAIL — fall back to vector-similarity-only path (todo §10 last paragraph)**"
    REPORT.write_text(f"""# Phulax classifier eval report

Generated: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}

- mode: `{mode}`
- model: `{model_ref}`
- threshold: `{m['threshold']}`
- targets: precision ≥ {TARGET_PRECISION}, recall ≥ {TARGET_RECALL}

## Confusion matrix (held-out 20%, n={m['n']})

|             | pred SAFE | pred RISK |
|-------------|-----------|-----------|
| actual SAFE | {m['tn']} | {m['fp']} |
| actual RISK | {m['fn']} | {m['tp']} |

## Metrics

- precision: **{m['precision']:.3f}**
- recall:    **{m['recall']:.3f}**
- f1:        **{m['f1']:.3f}**

## Latency (ms)

- p50: {m['latency_ms']['p50']:.1f}
- p95: {m['latency_ms']['p95']:.1f}
- max: {m['latency_ms']['max']:.1f}

## Verdict

{verdict}

## Reproducibility

This harness is published to 0G Storage alongside the merged weights. To
reproduce:

```bash
git clone <repo> && cd ml
uv sync
# fetch dataset.jsonl + merged weights from CIDs in artifacts.json
MODEL_DIR=./artifacts/merged uv run python -m eval.harness
```
""")
    print(f"report → {REPORT}")


def main() -> None:
    rows = [json.loads(line) for line in DATA.read_text().splitlines() if line.strip()]
    eval_rows = split_eval(rows)
    print(f"evaluating on {len(eval_rows)} held-out rows")

    if os.environ.get("INFERENCE_URL"):
        preds = classify_remote(eval_rows)
        mode, ref = "remote", os.environ["INFERENCE_URL"]
    elif os.environ.get("MODEL_DIR"):
        preds = classify_local(eval_rows)
        mode, ref = "local", os.environ["MODEL_DIR"]
    else:
        raise SystemExit("set MODEL_DIR (local merged weights) or INFERENCE_URL")

    m = metrics(eval_rows, preds)
    print(json.dumps(m, indent=2))
    write_report(m, mode, ref)


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(ROOT))
    main()
