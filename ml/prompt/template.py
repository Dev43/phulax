"""Frozen prompt template - imported by fine-tune, eval, and the inference server.

DO NOT edit casually: any change invalidates the eval numbers in REPORT.md and
breaks compatibility with the merged weights already published to 0G Storage.
Bump TEMPLATE_VERSION and re-run the full pipeline if you must change it.
"""

from __future__ import annotations

import json
from typing import Any

TEMPLATE_VERSION = "1.0.0"

SYSTEM = (
    "You are Phulax, a transaction risk classifier for DeFi lending pools. "
    "Output ONLY a single JSON object of the form "
    '{"p_nefarious": <float in [0,1]>, "tag": <one of "SAFE","RISK">}. '
    "No prose, no markdown, no explanation. The score reflects probability that "
    "the transaction is part of an exploit (oracle manipulation, reentrancy, "
    "uncollateralised mint, governance hijack, signature bypass, share-price "
    "manipulation, or solvency break)."
)


def canonicalise(row: dict[str, Any]) -> str:
    """Stable, sorted JSON of just the features the model is allowed to see."""
    feature_blob = {
        "selector": row["selector"],
        "fn": row["fn"],
        "decoded_args": row["decoded_args"],
        "balance_delta": row["balance_delta"],
    }
    return json.dumps(feature_blob, sort_keys=True, separators=(",", ":"))


def user_message(row: dict[str, Any]) -> str:
    return f"Classify this transaction:\n{canonicalise(row)}"


def assistant_target(row: dict[str, Any]) -> str:
    p = 0.94 if row["label"] == "RISK" else 0.03
    return json.dumps({"p_nefarious": p, "tag": row["label"]}, separators=(",", ":"))


def chat_messages(row: dict[str, Any], with_target: bool = True) -> list[dict[str, str]]:
    msgs = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": user_message(row)},
    ]
    if with_target:
        msgs.append({"role": "assistant", "content": assistant_target(row)})
    return msgs
