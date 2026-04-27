"""Hard-SAFE training generator: "large but legit" patterns.

The original `benign.py` only emits small-amount routine activity, so the model
has no anchor for "size alone ≠ exploit" — confirmed by the holdout where 10/15
adversarial benigns flipped to RISK (see HOLDOUT_REPORT.md before the fix).

This module generates ~120 hard-SAFE rows across patterns that look risky on
the feature blob alone but are benign in context:

  - timelock-executed treasury sweeps (large transfer)
  - whale single-block deposits
  - liquidation cascades (paired reserves/borrow drop)
  - vault strategy rebalances (large reserve out then in)
  - PSM stable swaps (large reserve move, 1:1 invariant)
  - bridge VAA mints (completeTransfer, large reserve+)
  - governance-signed slashes (share_price step but bounded)
  - Chainlink oracle updates during volatility
  - protocol-rewards claims (transfer-shape delta)
  - liquidity migrations v2→v3 (large remove)
  - POL TWAP harvests
  - market-init seeded deposits (donation-attack-shaped but pre-seeded)

Risk-score band is 0.10-0.25: the model should NOT learn these as p≈0 (they
genuinely have higher base rate of suspicion than a random small swap), but
should rank them well below confirmed exploits at p≈0.92.

Identifiers are randomised so none collide with the held-out fingerprints in
`data/holdout.py:HARD_SAFE`. The holdout stays a true generalisation test.
"""

from __future__ import annotations

import hashlib
import random


ASSETS = ["USDC", "USDT", "DAI", "WETH", "WBTC", "stETH", "rETH", "FRAX",
          "sUSDe", "AAVE", "COMP", "CRV", "MKR"]
MULTISIGS = ["aave-collector", "compound-treasury", "maker-pause-proxy",
             "lido-dao", "yearn-treasury", "convex-treasury", "ops-multisig",
             "curve-admin", "spark-dao"]


def _amount(rng: random.Random, low_mag: float, high_mag: float) -> str:
    mag = rng.uniform(low_mag, high_mag)
    return f"{mag:.2e}"


def _id(prefix: str, i: int) -> str:
    return f"hard-train-{prefix}-{i:03d}"


def _selector(seed_str: str) -> str:
    return "0x" + hashlib.sha256(seed_str.encode()).hexdigest()[:8]


def _timelock_caller(rng: random.Random) -> dict:
    return {"role": "timelock", "age_days": int(rng.uniform(180, 2000)),
            "signer_quorum": None}


def _multisig_caller(rng: random.Random, quorum_low: int = 4,
                     quorum_high: int = 9) -> dict:
    return {"role": "multisig", "age_days": int(rng.uniform(180, 2000)),
            "signer_quorum": int(rng.uniform(quorum_low, quorum_high))}


def _contract_caller(rng: random.Random) -> dict:
    return {"role": "contract", "age_days": int(rng.uniform(90, 2000)),
            "signer_quorum": None}


def _eoa_caller(rng: random.Random) -> dict:
    return {"role": "eoa", "age_days": int(rng.uniform(90, 2500)),
            "signer_quorum": None}


def _treasury_sweep(rng: random.Random, i: int) -> dict:
    amt = _amount(rng, 1e22, 1e26)
    return {
        "id": _id("treasury-sweep", i),
        "caller": _timelock_caller(rng),
        "selector": "0xa9059cbb",
        "fn": "transfer",
        "decoded_args": {"to": rng.choice(MULTISIGS), "amount": amt},
        "balance_delta": {"reserves": f"-{amt}"},
        "context": "timelock-executed treasury sweep to known multisig",
        "source": "synthetic-hard-benign",
    }


def _whale_deposit(rng: random.Random, i: int) -> dict:
    amt = _amount(rng, 5e22, 8e25)
    fn = rng.choice(["supply", "deposit"])
    return {
        "id": _id("whale-deposit", i),
        "caller": _eoa_caller(rng) if rng.random() < 0.6 else _contract_caller(rng),
        "selector": "0x617ba037" if fn == "supply" else "0x47e7ef24",
        "fn": fn,
        "decoded_args": {"asset": rng.choice(ASSETS), "amount": amt},
        "balance_delta": {
            "reserves": f"+{amt}",
            "utilization": f"{-rng.uniform(0.05, 0.25):.3f}",
            "share_price": f"{rng.uniform(-0.0005, 0.0005):+.4f}",
        },
        "context": "single-block large deposit from institutional wallet",
        "source": "synthetic-hard-benign",
    }


def _liquidation(rng: random.Random, i: int) -> dict:
    amt = _amount(rng, 1e21, 5e23)
    return {
        "id": _id("liquidation", i),
        "caller": _contract_caller(rng) if rng.random() < 0.7 else _eoa_caller(rng),
        "selector": "0x96cd4ddb",
        "fn": "liquidationCall",
        "decoded_args": {
            "collateral": rng.choice(["WETH", "WBTC", "stETH"]),
            "debt": rng.choice(["USDC", "USDT", "DAI"]),
            "user": "underwater-borrower",
            "amount": amt,
        },
        "balance_delta": {
            "reserves": f"-{amt}",
            "borrow": f"-{amt}",
            "utilization": f"{-rng.uniform(0.05, 0.25):.3f}",
            "oracle_price": f"{-rng.uniform(0.05, 0.20):.3f}x",
        },
        "context": "routine liquidation during volatility; paired legs match",
        "source": "synthetic-hard-benign",
    }


def _vault_rebalance(rng: random.Random, i: int) -> dict:
    amt = _amount(rng, 1e21, 5e23)
    return {
        "id": _id("vault-rebalance", i),
        "caller": _multisig_caller(rng),
        "selector": "0xb8a878a8",
        "fn": "updateMaxDebtForStrategy",
        "decoded_args": {"strategy": f"strat-{i}", "newDebt": "0"},
        "balance_delta": {
            "reserves": f"-{amt}",
            "share_price": f"{rng.uniform(-0.001, 0.001):+.4f}",
        },
        "context": "yearn v3 strategy rotation; full debt withdraw before redeposit",
        "source": "synthetic-hard-benign",
    }


def _psm_swap(rng: random.Random, i: int) -> dict:
    amt = _amount(rng, 1e22, 1e24)
    return {
        "id": _id("psm-swap", i),
        "caller": _contract_caller(rng),
        "selector": "0x078dfbe7",
        "fn": "buyGem",
        "decoded_args": {"usr": "trading-firm", "gemAmt": amt},
        "balance_delta": {
            "reserves": f"-{amt}",
            "share_price": "0",
            "utilization": "+0.0",
        },
        "context": "PSM stable swap bounded by debt ceiling and 1:1 invariant",
        "source": "synthetic-hard-benign",
    }


def _bridge_mint(rng: random.Random, i: int) -> dict:
    amt = _amount(rng, 5e21, 5e23)
    return {
        "id": _id("bridge-mint", i),
        "caller": _contract_caller(rng),
        "selector": "0xc6878519",
        "fn": "completeTransfer",
        "decoded_args": {"vaa": "0xguardian-quorum...", "amount": amt},
        "balance_delta": {"reserves": f"+{amt}"},
        "context": "Wormhole VAA verified by guardian quorum; legit inbound mint",
        "source": "synthetic-hard-benign",
    }


def _slash(rng: random.Random, i: int) -> dict:
    amt = _amount(rng, 1e22, 5e23)
    drop = rng.uniform(0.10, 0.40)
    return {
        "id": _id("gov-slash", i),
        "caller": _timelock_caller(rng),
        "selector": "0xc4d66de8",
        "fn": "slash",
        "decoded_args": {"amount": amt, "to": "shortfall-recipient"},
        "balance_delta": {
            "reserves": f"-{amt}",
            "share_price": f"-{drop:.3f}",
        },
        "context": "SafetyModule slash after governance shortfall vote",
        "source": "synthetic-hard-benign",
    }


def _oracle_update(rng: random.Random, i: int) -> dict:
    move = rng.uniform(-0.40, 0.40)
    return {
        "id": _id("oracle-update", i),
        "caller": _contract_caller(rng),
        "selector": "0xc9807539",
        "fn": "transmit",
        "decoded_args": {
            "feed": rng.choice(["ETH-USD", "BTC-USD", "stETH-ETH"]),
            "answer": _amount(rng, 1e10, 1e12),
        },
        "balance_delta": {
            "oracle_price": f"{move:+.3f}x",
            "share_price": "0",
            "utilization": f"{rng.uniform(-0.05, 0.05):+.3f}",
        },
        "context": "Chainlink OCR2 transmit during volatility; trusted aggregator",
        "source": "synthetic-hard-benign",
    }


def _rewards_claim(rng: random.Random, i: int) -> dict:
    amt = _amount(rng, 1e20, 5e22)
    return {
        "id": _id("rewards-claim", i),
        "caller": _eoa_caller(rng),
        "selector": "0x372500ab",
        "fn": "claim",
        "decoded_args": {
            "comet": rng.choice(["cUSDCv3", "cWETHv3", "cUSDTv3"]),
            "src": "user",
            "shouldAccrue": "true",
        },
        "balance_delta": {"reserves": f"-{amt}"},
        "context": "Comet rewards claim; transfer-shape delta but rewards path",
        "source": "synthetic-hard-benign",
    }


def _liquidity_migration(rng: random.Random, i: int) -> dict:
    amt = _amount(rng, 1e22, 5e23)
    return {
        "id": _id("lp-migration", i),
        "caller": _timelock_caller(rng),
        "selector": "0xbaa2abde",
        "fn": "removeLiquidity",
        "decoded_args": {
            "pair": f"{rng.choice(ASSETS)}-{rng.choice(ASSETS)}-v2",
            "liquidity": amt,
        },
        "balance_delta": {
            "reserves": f"-{amt}",
            "share_price": f"{rng.uniform(-0.001, 0.001):+.4f}",
        },
        "context": "DAO-approved v2→v3 LP migration; outflow paired with v3 add",
        "source": "synthetic-hard-benign",
    }


def _pol_harvest(rng: random.Random, i: int) -> dict:
    amt = _amount(rng, 1e21, 5e22)
    return {
        "id": _id("pol-harvest", i),
        "caller": _timelock_caller(rng),
        "selector": "0x372500ab",
        "fn": "claimRewards",
        "decoded_args": {"recipient": rng.choice(MULTISIGS), "amount": amt},
        "balance_delta": {"reserves": f"-{amt}", "share_price": "0"},
        "context": "POL TWAP harvest paid to ops multisig via timelocked path",
        "source": "synthetic-hard-benign",
    }


def _seeded_market_init(rng: random.Random, i: int) -> dict:
    amt = _amount(rng, 1e20, 5e21)
    return {
        "id": _id("market-init", i),
        "caller": _timelock_caller(rng),
        "selector": "0x617ba037",
        "fn": "supply",
        "decoded_args": {
            "asset": rng.choice(["rsETH", "weETH", "ezETH", "pufETH"]),
            "amount": amt,
        },
        "balance_delta": {
            "share_price": "+0.0",
            "reserves": f"+{amt}",
            "utilization": "0",
        },
        "context": "first deposit on freshly listed market - reserve pre-seeded "
                   "by treasury (donation-attack mitigation)",
        "source": "synthetic-hard-benign",
    }


GENERATORS = [
    _treasury_sweep, _whale_deposit, _liquidation, _vault_rebalance,
    _psm_swap, _bridge_mint, _slash, _oracle_update, _rewards_claim,
    _liquidity_migration, _pol_harvest, _seeded_market_init,
]


def generate(n: int = 120, seed: int = 11) -> list[dict]:
    """Emit n hard-SAFE rows distributed across the generator families.

    risk_score is sampled from 0.10-0.25: clearly SAFE (well below the
    eval threshold of 0.5 and below confirmed-exploit p≈0.92), but elevated
    above the routine 0.02-0.08 band so the model learns "risky-shaped but
    legit" as its own category, not as `p=0`.
    """
    rng = random.Random(seed)
    out: list[dict] = []
    per_family = max(1, n // len(GENERATORS))
    for family_idx, gen in enumerate(GENERATORS):
        for i in range(per_family):
            row = gen(rng, family_idx * per_family + i)
            row["risk_score"] = round(0.10 + rng.random() * 0.15, 3)
            # ~10% chance: scramble selector so model can't shortcut on it.
            if rng.random() < 0.10:
                row["selector"] = _selector(row["id"])
            out.append(row)
    return out
