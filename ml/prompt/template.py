"""Frozen prompt template - imported by fine-tune, eval, and the inference server.

DO NOT edit casually: any change invalidates the eval numbers in REPORT.md and
breaks compatibility with the merged weights already published to 0G Storage.
Bump TEMPLATE_VERSION and re-run the full pipeline if you must change it.

Schema history:
  1.0.0 — features: {selector, fn, decoded_args, balance_delta}
          target:   {p_nefarious, tag}                    (tag ∈ {SAFE,RISK})
  2.0.0 — features: {caller, selector, fn, decoded_args, balance_delta}
          target:   {p_nefarious, signal}
              signal ∈ {none, drain, oracle_manipulation, donation_attack,
                        reentrancy, governance_hijack, sig_bypass,
                        share_inflation}
              tag is derived: SAFE iff signal == "none"
"""

from __future__ import annotations

import json
from typing import Any

TEMPLATE_VERSION = "2.0.0"

SIGNALS = (
    "none",
    "drain",
    "oracle_manipulation",
    "donation_attack",
    "reentrancy",
    "governance_hijack",
    "sig_bypass",
    "share_inflation",
)

SYSTEM = (
    "You are Phulax, a transaction risk classifier for DeFi lending pools. "
    "You receive a feature blob describing a single on-chain transaction, "
    "including the caller's role and history (timelock, multisig, EOA, "
    "contract), the function signature, the decoded arguments, and the "
    "resulting balance-delta vector. "
    "Output ONLY a single JSON object of the form "
    '{"p_nefarious": <float in [0,1]>, "signal": <one of '
    '"none","drain","oracle_manipulation","donation_attack","reentrancy",'
    '"governance_hijack","sig_bypass","share_inflation">}. '
    "No prose, no markdown, no explanation. p_nefarious is a calibrated "
    "probability, not a binary tag — use intermediate values when the "
    "transaction is suspicious-shaped but executed by a trusted caller "
    "(timelock, governance multisig with high quorum). signal == \"none\" "
    "means SAFE."
)


def canonicalise(row: dict[str, Any]) -> str:
    """Stable, sorted JSON of just the features the model is allowed to see."""
    feature_blob = {
        "caller": row.get("caller", {"role": "unknown",
                                     "age_days": 0,
                                     "signer_quorum": None}),
        "selector": row["selector"],
        "fn": row["fn"],
        "decoded_args": row["decoded_args"],
        "balance_delta": row["balance_delta"],
    }
    return json.dumps(feature_blob, sort_keys=True, separators=(",", ":"))


def user_message(row: dict[str, Any]) -> str:
    return f"Classify this transaction:\n{canonicalise(row)}"


def signal_for(row: dict[str, Any]) -> str:
    """Resolve the signal label for a row, defaulting from `label` if absent."""
    sig = row.get("signal")
    if sig in SIGNALS:
        return sig
    return "none" if row.get("label", "SAFE") == "SAFE" else "drain"


def assistant_target(row: dict[str, Any]) -> str:
    # Per-row risk_score gives the model a regression signal instead of
    # collapsing to two values. signal gives a categorical gradient.
    if "risk_score" in row:
        p = float(row["risk_score"])
    else:
        p = 0.94 if row.get("label") == "RISK" else 0.03
    p = round(max(0.0, min(1.0, p)), 3)
    return json.dumps(
        {"p_nefarious": p, "signal": signal_for(row)},
        separators=(",", ":"),
    )


def chat_messages(row: dict[str, Any], with_target: bool = True) -> list[dict[str, str]]:
    msgs = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": user_message(row)},
    ]
    if with_target:
        msgs.append({"role": "assistant", "content": assistant_target(row)})
    return msgs
