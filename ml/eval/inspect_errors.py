"""Print every misclassified row from the held-out 20% with full context.

Goal: turn the eval REPORT.md confusion matrix (8 FP / 2 FN) into an actionable
list of training-data fixes. For each error, print predicted score + ground
truth + source + caller + selector/fn + a compact balance-delta summary so
patterns jump out at a glance.

Reuses `eval.harness` for the model load + the deterministic split, so the
errors here line up exactly with what's reported in REPORT.md.

Usage:
    cd ml
    MODEL_DIR=./artifacts/merged uv run python -m eval.inspect_errors

    # or against the running inference server:
    INFERENCE_URL=http://localhost:8000/classify uv run python -m eval.inspect_errors

Output groups errors by FP vs FN, sorted by descending |error|, so the most
egregiously wrong rows surface first.
"""

from __future__ import annotations

import json
import os
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from eval.harness import (  # noqa: E402
    DATA,
    THRESHOLD,
    classify_local,
    classify_remote,
    split_eval,
)


def fmt_balance_delta(bd: dict) -> str:
    """Compact one-line summary of a balance-delta map. Strips zeros."""
    if not isinstance(bd, dict):
        return str(bd)
    nonzero = {k: v for k, v in bd.items() if str(v) not in ("0", "0.0", "")}
    if not nonzero:
        return "{}"
    parts = []
    for k, v in list(nonzero.items())[:3]:
        sv = str(v)
        # truncate long ints to scientific-ish notation
        if sv.lstrip("-").isdigit() and len(sv) > 8:
            n = int(sv)
            sign = "-" if n < 0 else "+"
            mag = len(str(abs(n)))
            parts.append(f"{k[:8]}:{sign}1e{mag - 1}")
        else:
            parts.append(f"{k[:8]}:{sv[:10]}")
    if len(nonzero) > 3:
        parts.append(f"+{len(nonzero) - 3} more")
    return "{" + ", ".join(parts) + "}"


def fmt_args(args: dict) -> str:
    """Compact one-line of decoded args. Only keys + truncated values."""
    if not isinstance(args, dict):
        return str(args)
    parts = []
    for k, v in list(args.items())[:4]:
        sv = str(v)
        if sv.lstrip("-").isdigit() and len(sv) > 8:
            n = int(sv)
            sign = "-" if n < 0 else ""
            mag = len(str(abs(n)))
            parts.append(f"{k}={sign}1e{mag - 1}")
        else:
            parts.append(f"{k}={sv[:24]}")
    if len(args) > 4:
        parts.append(f"+{len(args) - 4}")
    return ", ".join(parts)


def short_source(src: str) -> str:
    if not src:
        return "?"
    if src.startswith("synthetic-"):
        return src.replace("synthetic-", "syn-")
    # post-mortem URLs: pick the protocol slug
    for tok in ("rari", "beanstalk", "bonq", "wormhole", "curve", "harmony",
                "yearn", "cream", "saddle", "euler", "nomad", "platypus",
                "cashio", "kyber", "mango"):
        if tok in src.lower():
            return f"pm:{tok}"
    return src[:24]


def short_caller(caller) -> str:
    if not isinstance(caller, dict):
        return str(caller)[:18]
    role = caller.get("role", "?")
    age = caller.get("age_days", 0)
    quorum = caller.get("signer_quorum")
    s = f"{role}/age={age}"
    if quorum is not None:
        s += f"/q={quorum}"
    return s


def main() -> None:
    rows = [json.loads(line) for line in DATA.read_text().splitlines() if line.strip()]
    eval_rows = split_eval(rows)
    print(f"loaded {len(rows)} rows; evaluating on {len(eval_rows)} held-out", flush=True)

    if os.environ.get("INFERENCE_URL"):
        preds = classify_remote(eval_rows)
        mode = "remote"
    elif os.environ.get("MODEL_DIR"):
        preds = classify_local(eval_rows)
        mode = "local"
    else:
        raise SystemExit("set MODEL_DIR (local merged weights) or INFERENCE_URL")

    fps: list[tuple[float, dict]] = []
    fns: list[tuple[float, dict]] = []
    for row, (p, _tag, _lat) in zip(eval_rows, preds):
        actual_risk = row["label"] == "RISK"
        pred_risk = p >= THRESHOLD
        if actual_risk and not pred_risk:
            fns.append((p, row))
        elif not actual_risk and pred_risk:
            fps.append((p, row))

    # FPs: most confident wrong predictions first (highest p first)
    fps.sort(key=lambda t: -t[0])
    # FNs: most confident wrong predictions first (lowest p first)
    fns.sort(key=lambda t: t[0])

    print()
    print(f"=== mode={mode} threshold={THRESHOLD} | {len(fps)} FP, {len(fns)} FN of {len(eval_rows)} ===")

    if fps:
        print()
        print(f"--- FP (predicted RISK, actually SAFE) — sorted by score desc ---")
        for p, row in fps:
            src = short_source(row.get("source", ""))
            caller = short_caller(row.get("caller"))
            sel = row.get("selector", "?")
            fn = row.get("fn", "?")
            args = fmt_args(row.get("decoded_args", {}))
            bd = fmt_balance_delta(row.get("balance_delta", {}))
            risk_score = row.get("risk_score", "?")
            print(f"  p={p:.3f} src={src:20s} caller={caller:18s} {sel} {fn}")
            print(f"        args:  {args}")
            print(f"        Δbal:  {bd}  (gt risk_score={risk_score})")

    if fns:
        print()
        print(f"--- FN (predicted SAFE, actually RISK) — sorted by score asc ---")
        for p, row in fns:
            src = short_source(row.get("source", ""))
            caller = short_caller(row.get("caller"))
            sel = row.get("selector", "?")
            fn = row.get("fn", "?")
            args = fmt_args(row.get("decoded_args", {}))
            bd = fmt_balance_delta(row.get("balance_delta", {}))
            sig = row.get("signal", "?")
            risk_score = row.get("risk_score", "?")
            print(f"  p={p:.3f} src={src:20s} caller={caller:18s} {sel} {fn}  signal={sig}")
            print(f"        args:  {args}")
            print(f"        Δbal:  {bd}  (gt risk_score={risk_score})")

    # Cluster summary — what shapes dominate the errors?
    def cluster(rows_subset: list[tuple[float, dict]]) -> None:
        sources = Counter(short_source(r.get("source", "")) for _, r in rows_subset)
        callers = Counter(
            (r.get("caller", {}) or {}).get("role", "?") for _, r in rows_subset
        )
        fns_ = Counter(r.get("fn", "?")[:32] for _, r in rows_subset)
        sigs = Counter(r.get("signal", "?") for _, r in rows_subset)
        print(f"        sources: {dict(sources.most_common())}")
        print(f"        callers: {dict(callers.most_common())}")
        print(f"        fns:     {dict(fns_.most_common())}")
        print(f"        signals: {dict(sigs.most_common())}")

    print()
    print("--- cluster summary ---")
    if fps:
        print("  FPs:")
        cluster(fps)
    if fns:
        print("  FNs:")
        cluster(fns)


if __name__ == "__main__":
    main()
