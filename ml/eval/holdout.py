"""Out-of-distribution holdout eval.

Runs the merged model against `data.holdout.OOD_NEFARIOUS` (real exploits the
fine-tune has never seen) + `data.holdout.HARD_SAFE` (adversarial benign that
mimics risk signals). Reports per-row predictions so the failure modes are
visible, not buried inside an aggregate confusion matrix.

Modes mirror `eval/harness.py`:
  - MODEL_DIR=./artifacts/merged   → load via transformers
  - INFERENCE_URL=...              → POST to Track D's endpoint

Output: ml/eval/HOLDOUT_REPORT.md
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from data.holdout import all_holdout  # noqa: E402
from eval.harness import (  # noqa: E402, F401
    calibration_metrics,
    classify_local,
    classify_remote,
    parse_output,
)

REPORT = Path(__file__).parent / "HOLDOUT_REPORT.md"
THRESHOLD = 0.5


def per_row_metrics(rows: list[dict], preds: list[tuple[float, str, float]]) -> dict:
    tp = fp = fn = tn = 0
    misses: list[dict] = []
    detail: list[dict] = []
    per_signal: dict[str, dict[str, int]] = {}
    for row, (p, tag, lat) in zip(rows, preds):
        actual_risk = row["label"] == "RISK"
        pred_risk = p >= THRESHOLD
        if actual_risk and pred_risk: tp += 1; verdict = "TP"
        elif actual_risk and not pred_risk: fn += 1; verdict = "FN"
        elif not actual_risk and pred_risk: fp += 1; verdict = "FP"
        else: tn += 1; verdict = "TN"
        sig = row.get("signal", "drain" if actual_risk else "none")
        bucket = per_signal.setdefault(sig, {"hit": 0, "miss": 0})
        if actual_risk:
            bucket["hit" if pred_risk else "miss"] += 1
        else:
            # SAFE rows go in the "none" bucket; "hit" means correctly SAFE.
            bucket["hit" if not pred_risk else "miss"] += 1
        entry = {
            "id": row["id"],
            "label": row["label"],
            "signal": sig,
            "p": p,
            "tag": tag,
            "verdict": verdict,
            "lat_ms": lat,
            "context": row["context"],
        }
        detail.append(entry)
        if verdict in ("FN", "FP"):
            misses.append(entry)

    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    lats = [lat for _, _, lat in preds]
    cal = calibration_metrics(rows, preds)
    return {
        "n": len(rows), "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": precision, "recall": recall, "f1": f1,
        "threshold": THRESHOLD,
        "brier": cal["brier"],
        "ece": cal["ece"],
        "latency_ms": {
            "p50": statistics.median(lats) if lats else 0,
            "p95": sorted(lats)[int(len(lats) * 0.95) - 1] if lats else 0,
            "max": max(lats) if lats else 0,
        },
        "per_signal": per_signal,
        "detail": detail,
        "misses": misses,
    }


def render_table(detail: list[dict]) -> str:
    lines = ["| id | actual | signal | p | pred | verdict | latency (ms) |",
             "|----|--------|--------|---|------|---------|--------------|"]
    for d in detail:
        flag = " ❌" if d["verdict"] in ("FN", "FP") else ""
        lines.append(
            f"| `{d['id']}` | {d['label']} | {d['signal']} | {d['p']:.3f} | "
            f"{d['tag']} | {d['verdict']}{flag} | {d['lat_ms']:.0f} |"
        )
    return "\n".join(lines)


def render_per_signal(per_signal: dict[str, dict[str, int]]) -> str:
    rows = []
    for sig, b in sorted(per_signal.items()):
        total = b["hit"] + b["miss"]
        rate = b["hit"] / total if total else 0.0
        rows.append(f"| `{sig}` | {b['hit']}/{total} | {rate:.2f} |")
    if not rows:
        return ""
    return "\n".join(["| signal | hit/total | rate |", "|---|---|---|", *rows])


def write_report(m: dict, mode: str, model_ref: str) -> None:
    n_risk = sum(1 for d in m["detail"] if d["label"] == "RISK")
    n_safe = sum(1 for d in m["detail"] if d["label"] == "SAFE")

    sections = [
        f"# Phulax OOD holdout report",
        "",
        f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}",
        "",
        f"- mode: `{mode}`",
        f"- model: `{model_ref}`",
        f"- threshold: `{m['threshold']}`",
        f"- rows: **{m['n']}** ({n_risk} OOD-RISK, {n_safe} HARD-SAFE)",
        "",
        "This set is **disjoint from training**. OOD-RISK rows are public "
        "exploits from 2023-2025 not present in `data/exploits.py`. HARD-SAFE "
        "rows are benign transactions engineered to mimic risk signals (oracle "
        "moves, large transfers, donation-shaped deposits, …).",
        "",
        "## Confusion matrix",
        "",
        "|             | pred SAFE | pred RISK |",
        "|-------------|-----------|-----------|",
        f"| actual SAFE | {m['tn']} | {m['fp']} |",
        f"| actual RISK | {m['fn']} | {m['tp']} |",
        "",
        "## Metrics",
        "",
        f"- precision: **{m['precision']:.3f}**",
        f"- recall:    **{m['recall']:.3f}**",
        f"- f1:        **{m['f1']:.3f}**",
        f"- brier:     **{m['brier']:.4f}**  _(lower = better calibrated)_",
        f"- ece:       **{m['ece']:.4f}**  _(10-bin Expected Calibration Error)_",
        "",
        "## Per-signal accuracy",
        "",
        "Hit = correctly classified RISK rows for exploit signals, correctly "
        "classified SAFE for `none`. Surfaces which exploit families the model "
        "is weakest on.",
        "",
        render_per_signal(m["per_signal"]),
        "",
        "## Latency (ms)",
        "",
        f"- p50: {m['latency_ms']['p50']:.1f}",
        f"- p95: {m['latency_ms']['p95']:.1f}",
        f"- max: {m['latency_ms']['max']:.1f}",
        "",
        "## Per-row predictions",
        "",
        render_table(m["detail"]),
        "",
    ]

    if m["misses"]:
        sections += [
            "## Misclassifications",
            "",
            f"{len(m['misses'])} of {m['n']} rows wrong. Each one is the next "
            "thing to address — either add the family to training, adjust the "
            "prompt, or accept it as a known weakness.",
            "",
        ]
        for d in m["misses"]:
            sections += [
                f"### `{d['id']}` — actual {d['label']}, predicted "
                f"{d['tag']} (p={d['p']:.3f})",
                "",
                f"> {d['context']}",
                "",
            ]

    REPORT.write_text("\n".join(sections))
    print(f"report → {REPORT}")


def main() -> None:
    rows = all_holdout()
    print(f"evaluating on {len(rows)} OOD holdout rows")

    if os.environ.get("INFERENCE_URL"):
        preds = classify_remote(rows)
        mode, ref = "remote", os.environ["INFERENCE_URL"]
    elif os.environ.get("MODEL_DIR"):
        preds = classify_local(rows)
        mode, ref = "local", os.environ["MODEL_DIR"]
    else:
        raise SystemExit("set MODEL_DIR (local merged weights) or INFERENCE_URL")

    m = per_row_metrics(rows, preds)
    print(json.dumps({k: v for k, v in m.items() if k not in ("detail", "misses")},
                     indent=2))
    write_report(m, mode, ref)


if __name__ == "__main__":
    main()
