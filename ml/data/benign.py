"""Synthetic benign mainnet-shape rows.

Real benign mainnet calldata would be ideal but is out of scope for an offline
hackathon dataset. We generate 150 rows whose distribution matches typical
lending/yield activity: small-to-medium deposits/withdrawals/borrows/repays with
proportional balance deltas and stable share_price + utilization.
"""

from __future__ import annotations

import hashlib
import random


SELECTORS: dict[str, str] = {
    "supply":        "0x617ba037",
    "deposit":       "0x47e7ef24",
    "withdraw":      "0x2e1a7d4d",
    "redeem":        "0xdb006a75",
    "borrow":        "0xc5ebeaec",
    "repay":         "0x5ceae9c4",
    "transfer":      "0xa9059cbb",
    "swapExactIn":   "0x12aa3caf",
    "addLiquidity":  "0xe8e33700",
    "removeLiquidity": "0xbaa2abde",
    "claimRewards":  "0x372500ab",
    "stake":         "0xa694fc3a",
    "unstake":       "0x2e17de78",
}

ASSETS = ["USDC", "USDT", "DAI", "WETH", "WBTC", "stETH", "LINK", "AAVE"]


def _amount(rng: random.Random) -> str:
    mag = rng.choice([1e1, 1e2, 1e3, 1e4, 1e5, 1e18, 1e19, 1e20, 1e21, 1e22])
    return f"{mag * (0.5 + rng.random()):.2e}"


def generate(n: int = 150, seed: int = 7) -> list[dict]:
    rng = random.Random(seed)
    out: list[dict] = []
    for i in range(n):
        fn = rng.choice(list(SELECTORS))
        asset = rng.choice(ASSETS)
        amount = _amount(rng)
        # Balance delta proportional to action; small share_price drift only.
        deltas = {
            "share_price": f"{(rng.random() - 0.5) * 0.002:+.4f}",
            "utilization": f"{(rng.random() - 0.5) * 0.05:+.3f}",
            "oracle_price": f"{(rng.random() - 0.5) * 0.005:+.4f}x",
        }
        if fn in ("supply", "deposit", "stake", "addLiquidity"):
            deltas["reserves"] = f"+{amount}"
        elif fn in ("withdraw", "redeem", "unstake", "removeLiquidity"):
            deltas["reserves"] = f"-{amount}"
        elif fn == "borrow":
            deltas["borrow"] = f"+{amount}"
        elif fn == "repay":
            deltas["borrow"] = f"-{amount}"

        row = {
            "id": f"benign-{i:04d}",
            "selector": SELECTORS[fn],
            "fn": fn,
            "decoded_args": {"asset": asset, "amount": amount},
            "balance_delta": deltas,
            "context": f"routine {fn} on {asset}",
            "source": "synthetic-benign",
        }
        # Slightly randomise selector so it isn't a free shortcut for the model.
        if rng.random() < 0.08:
            row["selector"] = "0x" + hashlib.sha256(
                f"{row['id']}".encode()
            ).hexdigest()[:8]
        out.append(row)
    return out
