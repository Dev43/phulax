"""Real-data dataset expansion (#8 in training-todo.md) — SKELETON.

The synthetic corpus in `exploits.py` + `benign.py` + `hard_benign.py` covers
~330 rows across ~15 exploit families. The remaining bottleneck is dataset
diversity: Qwen2.5-0.5B has plenty of capacity to memorise this set, so any
further accuracy gains come from richer training data, not bigger models.

This module is the entry point for that work. It is intentionally a skeleton:
running it requires external API access (Tenderly transaction simulator + an
RPC archive node, or Etherscan PRO) which is not provisioned in this repo. Fill
in `_fetch_decoded_calldata` and `_fetch_balance_delta` against whichever
provider you have access to.

Plan:
  1. For each exploit in `holdout.OOD_NEFARIOUS`, fetch the actual on-chain
     transaction(s) referenced in the post-mortem (block range + attacker
     address) and decode calldata + balance deltas from receipts.
  2. For each exploited protocol, sample N benign transactions from the same
     contract in the surrounding ±30 days that DID succeed and are tagged
     SAFE. This gives matched negatives — same selectors, same protocol,
     different outcome. Strong signal for the model.
  3. Cross-reference each exploit row against the post-mortem corpus that the
     `embed/` pipeline already indexes; the post-mortem text gives us
     the `signal` label and the `caller` role.
  4. Append to `data/dataset.jsonl` (do NOT overwrite the synthetic rows —
     they're still useful regularisation), then re-fine-tune.

Required env vars when implementing:
  TENDERLY_ACCESS_TOKEN  — gateway access for tx simulation + receipt decode
  TENDERLY_PROJECT_SLUG
  ETHERSCAN_API_KEY      — fallback for receipt fetch on chains Tenderly
                            doesn't cover (Sui, Starknet, Linea, …)

Until those are wired, calling this module raises NotImplementedError so the
rest of the pipeline keeps working.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "real_rows.jsonl"

# Per-exploit metadata pulled from post-mortems. Block range and attacker
# address let us deterministically refetch decoded calldata + balance deltas.
# Add entries here as you implement scraping for each one.
EXPLOIT_FETCH_PLAN: list[dict[str, Any]] = [
    # {
    #     "id": "euler-2023-03",
    #     "chain": "ethereum",
    #     "blocks": [16817996],
    #     "tx_hashes": [
    #         "0xc310a0affe2169d1f6feec1c63dbc7f7c62a887fa48795d327d4d2da2d6b111d",
    #         # ... additional drain txs
    #     ],
    #     "signal": "donation_attack",
    # },
    # ... one entry per OOD exploit
]


def _fetch_decoded_calldata(chain: str, tx_hash: str) -> dict[str, Any]:
    raise NotImplementedError(
        "Wire in Tenderly /v1/account/{slug}/project/{slug}/contract/decode-input "
        "or Etherscan eth_getTransactionByHash + ABI lookup."
    )


def _fetch_balance_delta(chain: str, tx_hash: str) -> dict[str, str]:
    raise NotImplementedError(
        "Diff balances of (lending pool, attacker, oracle) before/after this tx. "
        "Tenderly's /trace API or local archive node geth_traceTransaction."
    )


def _fetch_caller(chain: str, tx_hash: str) -> dict[str, Any]:
    raise NotImplementedError(
        "From the receipt's `from`: classify role (timelock/multisig/eoa/contract) "
        "via getCode + known-multisig registry; age_days from first-seen index; "
        "signer_quorum by reading multisig threshold() if applicable."
    )


def fetch_all() -> list[dict]:
    if not os.environ.get("TENDERLY_ACCESS_TOKEN"):
        raise SystemExit(
            "set TENDERLY_ACCESS_TOKEN (and TENDERLY_PROJECT_SLUG) — see "
            "module docstring."
        )
    rows: list[dict] = []
    for plan in EXPLOIT_FETCH_PLAN:
        for tx_hash in plan["tx_hashes"]:
            decoded = _fetch_decoded_calldata(plan["chain"], tx_hash)
            delta = _fetch_balance_delta(plan["chain"], tx_hash)
            caller = _fetch_caller(plan["chain"], tx_hash)
            rows.append({
                "id": f"{plan['id']}-real-{tx_hash[:10]}",
                "caller": caller,
                "selector": decoded["selector"],
                "fn": decoded["fn"],
                "decoded_args": decoded["args"],
                "balance_delta": delta,
                "context": f"on-chain capture of {plan['id']}",
                "source": f"chain:{plan['chain']}/tx:{tx_hash}",
                "signal": plan["signal"],
                "label": "RISK",
                "risk_score": 0.95,
            })
    return rows


def main() -> None:
    rows = fetch_all()
    with OUT.open("w") as f:
        for r in rows:
            import json
            f.write(json.dumps(r) + "\n")
    print(f"wrote {OUT} - {len(rows)} real rows")


if __name__ == "__main__":
    main()
