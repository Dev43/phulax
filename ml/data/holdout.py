"""Out-of-distribution holdout set.

These rows are NEVER fed into `build_dataset.build()` — they are reserved for
`ml/eval/holdout.py` so we can measure generalisation beyond the 15 exploit
families baked into `exploits.NEFARIOUS`.

Two buckets:

  OOD_NEFARIOUS  – real public exploits from 2023-2025 with structural
                   fingerprints that do NOT appear in training. New exploit
                   families (donation attack, signature reuse, read-only
                   reentrancy, decimal-mismatch overflow, …) plus protocols
                   the model has never seen.

  HARD_SAFE      – synthetic benign rows engineered to *look* risky: oracle
                   shifts during real volatility, governance-approved large
                   transfers, whale flows, liquidation cascades, vault
                   migrations. If the model has just learned "big delta ⇒
                   RISK" these will flip false-positive.

Together they form an adversarial test set: a model that reaches 100 % on the
in-distribution held-out 20 % can still score poorly here, and that gap is the
honest signal of how well the fine-tune actually generalises.

------------------------------------------------------------------------
HOW TO USE
------------------------------------------------------------------------

Run the harness against locally merged weights:

    cd ml
    MODEL_DIR=./artifacts/merged uv run python -m eval.holdout

Or against the deployed inference endpoint (Track D):

    INFERENCE_URL=http://localhost:8000/classify uv run python -m eval.holdout

Output lands in `ml/eval/HOLDOUT_REPORT.md` with a per-row table so misses
are visible. Treat the FN/FP rows as the next-iteration backlog: each one is
either a family to add to training, a feature to expose to the model, or a
documented known weakness.

------------------------------------------------------------------------
HOW TO ADD A ROW
------------------------------------------------------------------------

Every row MUST contain these keys (matches `prompt/template.canonicalise`):

    id            stable string, prefix `hard-safe-` for HARD_SAFE,
                  `<protocol>-<yyyy>-<mm>` for OOD_NEFARIOUS
    selector      4-byte hex; reuse the real on-chain selector for OOD rows,
                  or pick a plausible one for HARD_SAFE
    fn            function name as it appears in the verified ABI
    decoded_args  dict of ABI-decoded arguments; bucket large numbers to
                  scientific notation strings (e.g. "1.2e23") so the model
                  sees magnitudes, not raw wei
    balance_delta dict over a stable vocabulary: `reserves`, `borrow`,
                  `share_price`, `oracle_price`, `utilization`. Sign and
                  magnitude only — strings like "+1.0e23", "-0.42",
                  "+9.4x" for oracle multipliers
    context       one-sentence English summary; this is for the human
                  reviewing the report, the model never sees it
    source        URL to the post-mortem (OOD) or the literal string
                  `synthetic-hard-safe`

DO NOT add a `label` field on the literal — `all_holdout()` attaches it. That
keeps the bucket lists honest: an OOD row is a RISK by virtue of being in
OOD_NEFARIOUS.

Conventions to preserve (so this file remains an *adversarial* test, not just
more training data):

  * OOD rows must use exploit families NOT in `exploits.NEFARIOUS`. Before
    adding, grep for the protocol name in `data/exploits.py` and skip if it
    already lives there — duplicating leaks signal into the test.
  * HARD_SAFE rows should reuse selectors, magnitudes, or balance-delta
    shapes from real exploits whenever possible. The whole point is to look
    risky to a "big delta ⇒ RISK" heuristic but be benign in context.
  * Keep both buckets roughly balanced (currently 16 RISK / 15 SAFE) so
    precision and recall are both measurable.
  * If you add or remove rows, re-run the harness and commit
    `ml/eval/HOLDOUT_REPORT.md` alongside the change so the regression is
    visible in the diff.
"""

from __future__ import annotations


OOD_NEFARIOUS: list[dict] = [
    {
        "id": "multichain-2023-07",
        "selector": "0xa9059cbb",
        "fn": "transfer",
        "decoded_args": {"to": "attacker", "amount": "1.26e26"},
        "balance_delta": {"reserves": "-1.26e26"},
        "context": "MPC key compromise drains Fantom/Moonriver bridge vaults; "
                   "structurally indistinguishable from a legit transfer except "
                   "for the destination + size against TVL",
        "source": "https://multichain-xyz.medium.com/security-incident-update-71-jul-2023",
    },
    {
        "id": "conic-2023-07",
        "selector": "0x441a3e70",
        "fn": "withdraw",
        "decoded_args": {"poolId": "ETH-LP", "shares": "1.7e21"},
        "balance_delta": {"oracle_price": "+1.04x", "share_price": "-0.18",
                          "reserves": "-1.7e21", "utilization": "+0.06"},
        "context": "read-only reentrancy via Curve get_virtual_price; oracle "
                   "drifts mid-callback before withdraw settles",
        "source": "https://medium.com/chainsecurity/conic-omnipool-incident-report",
    },
    {
        "id": "raft-2023-11",
        "selector": "0x6e553f65",
        "fn": "deposit",
        "decoded_args": {"assets": "1", "receiver": "self"},
        "balance_delta": {"share_price": "+1.0e18", "reserves": "+1",
                          "utilization": "+0.0"},
        "context": "first-depositor donation attack on empty cR-token; share "
                   "price inflated to 1e18 so subsequent depositors mint zero",
        "source": "https://medium.com/raft-fi/raft-incident-report-nov-10-2023",
    },
    {
        "id": "onyx-2023-11",
        "selector": "0xdb006a75",
        "fn": "redeem",
        "decoded_args": {"cTokenAmount": "1"},
        "balance_delta": {"reserves": "-2.1e6", "share_price": "+9.9e17",
                          "utilization": "+0.81"},
        "context": "Compound v2 fork CEther rounding: redeem(1) returns full "
                   "underlying after empty-market donation",
        "source": "https://medium.com/onyx-protocol/post-mortem-nov-2023",
    },
    {
        "id": "prisma-2024-03",
        "selector": "0x4f1ef286",
        "fn": "migrateTroveZap",
        "decoded_args": {"to": "attacker", "data": "0xface..."},
        "balance_delta": {"reserves": "-1.1e7", "borrow": "+1.1e7"},
        "context": "MigrateTroveZap forwards arbitrary callback to user-controlled "
                   "contract; trove debt re-assigned mid-call",
        "source": "https://prismafinance.medium.com/incident-march-28-2024",
    },
    {
        "id": "woofi-2024-03",
        "selector": "0x7c025200",
        "fn": "swap",
        "decoded_args": {"fromToken": "WOO", "amount": "1.0e25"},
        "balance_delta": {"oracle_price": "-0.97x", "reserves": "-8.75e6",
                          "share_price": "-0.05"},
        "context": "sPMM oracle anchored to thin spot pool; flash-loan crashes "
                   "WOO mark price then drains stable pair",
        "source": "https://woo.org/blog/woofi-spmm-incident-report",
    },
    {
        "id": "munchables-2024-03",
        "selector": "0x3659cfe6",
        "fn": "upgradeTo",
        "decoded_args": {"newImplementation": "attacker"},
        "balance_delta": {"reserves": "-6.3e7"},
        "context": "rogue dev pre-set storage owner during initialiser; later "
                   "upgrade swaps implementation and drains via owner-only path",
        "source": "https://medium.com/munchables/incident-march-26-2024",
    },
    {
        "id": "hedgey-2024-04",
        "selector": "0x86a0e8d8",
        "fn": "claim",
        "decoded_args": {"campaignId": "42", "sig": "0xrep..."},
        "balance_delta": {"reserves": "-4.5e7", "share_price": "0"},
        "context": "claim signature replay across campaigns; same sig redeemed N "
                   "times with no nonce check",
        "source": "https://hedgey.medium.com/incident-report-april-19-2024",
    },
    {
        "id": "sonne-2024-05",
        "selector": "0x617ba037",
        "fn": "supply",
        "decoded_args": {"asset": "VELO", "amount": "1"},
        "balance_delta": {"share_price": "+1.2e18", "reserves": "+1",
                          "utilization": "-0.0"},
        "context": "empty-market donation attack on freshly listed VELO market "
                   "before reserves seeded; classic Compound v2 fork inflate",
        "source": "https://medium.com/sonnefinance/post-mortem-may-15-2024",
    },
    {
        "id": "velocore-2024-06",
        "selector": "0x12aa3caf",
        "fn": "swap",
        "decoded_args": {"pool": "CVE-WETH", "amountIn": "1.0e21"},
        "balance_delta": {"share_price": "-0.61", "reserves": "-6.8e6",
                          "oracle_price": "+1.1x"},
        "context": "convergent pool fee multiplier overflow; negative fee credits "
                   "attacker on each swap leg",
        "source": "https://velocore.medium.com/incident-report-june-2-2024",
    },
    {
        "id": "uwulend-2024-06",
        "selector": "0xc5ebeaec",
        "fn": "borrow",
        "decoded_args": {"asset": "USDT", "amount": "1.93e7"},
        "balance_delta": {"oracle_price": "+3.7x", "borrow": "+1.93e7",
                          "utilization": "+0.95"},
        "context": "sUSDE oracle pulls median across thin Curve pool; flash-loan "
                   "skew lets attacker borrow 4x face",
        "source": "https://uwulend.medium.com/incident-report-june-10-2024",
    },
    {
        "id": "lifi-2024-07",
        "selector": "0x4630a0d8",
        "fn": "swapAndStartBridgeTokensViaPermit",
        "decoded_args": {"caller": "attacker", "permit": "0xforged..."},
        "balance_delta": {"reserves": "-1.0e7"},
        "context": "facet did not validate `caller` against approver; old "
                   "infinite-approvals on diamond drained via crafted permit",
        "source": "https://li.fi/news/incident-report-july-16-2024",
    },
    {
        "id": "penpie-2024-09",
        "selector": "0x6e9960c3",
        "fn": "registerPenpiePool",
        "decoded_args": {"market": "attacker-market", "rewarder": "attacker"},
        "balance_delta": {"reserves": "-2.7e7", "share_price": "-0.4"},
        "context": "permissionless registerPenpiePool + reentrancy via fake "
                   "Pendle market harvests duplicate rewards",
        "source": "https://medium.com/penpiexyz/incident-report-sept-3-2024",
    },
    {
        "id": "radiant-2024-10",
        "selector": "0x4f1ef286",
        "fn": "upgradeTo",
        "decoded_args": {"target": "lendingPool", "impl": "attacker"},
        "balance_delta": {"reserves": "-5.0e7", "borrow": "+5.0e7"},
        "context": "three multisig signers' devices compromised via malware; "
                   "legitimate-looking upgrade replaces pool with backdoored impl",
        "source": "https://medium.com/@RadiantCapital/post-mortem-oct-16-2024",
    },
    {
        "id": "zklend-2025-02",
        "selector": "0x617ba037",
        "fn": "supply",
        "decoded_args": {"asset": "wstETH", "amount": "1"},
        "balance_delta": {"share_price": "+8.5e17", "reserves": "+1"},
        "context": "Starknet port of Compound-v2-style empty-market donation; "
                   "rounding on lending_accumulator inflates 1-wei deposit",
        "source": "https://zklend.medium.com/incident-report-feb-12-2025",
    },
    {
        "id": "cetus-2025-05",
        "selector": "0x4f1ef286",
        "fn": "add_liquidity",
        "decoded_args": {"pool": "CETUS-SUI", "deltaA": "1", "deltaB": "2.2e8"},
        "balance_delta": {"share_price": "-0.998", "reserves": "-2.2e8",
                          "utilization": "+0.3"},
        "context": "Sui Move overflow on liquidity_math::get_amount_by_liquidity; "
                   "mints near-zero LP for attacker, then drains both reserves",
        "source": "https://blog.cetus.zone/post-mortem-may-22-2025",
    },
]


HARD_SAFE: list[dict] = [
    {
        "id": "hard-safe-aave-treasury-sweep",
        "selector": "0xa9059cbb",
        "fn": "transfer",
        "decoded_args": {"to": "aave-collector-multisig", "amount": "4.5e25"},
        "balance_delta": {"reserves": "-4.5e25"},
        "context": "scheduled AIP-executed sweep of accrued protocol fees from "
                   "Aave Collector to Ecosystem Reserve; large but routine",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-chainlink-eth-crash",
        "selector": "0xa9059cbb",
        "fn": "transmit",
        "decoded_args": {"feed": "ETH-USD", "answer": "1.2e11"},
        "balance_delta": {"oracle_price": "-0.34x", "share_price": "0",
                          "utilization": "+0.04"},
        "context": "legitimate Chainlink OCR2 transmit during ETH flash-crash; "
                   "large oracle_price move but published by trusted aggregator",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-whale-deposit",
        "selector": "0x617ba037",
        "fn": "supply",
        "decoded_args": {"asset": "USDC", "amount": "5.0e25"},
        "balance_delta": {"reserves": "+5.0e25", "utilization": "-0.18",
                          "share_price": "+0.0001"},
        "context": "single-block $50M USDC deposit from a Fireblocks-tagged "
                   "institutional wallet; share_price barely moves",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-liquidation-cascade",
        "selector": "0x96cd4ddb",
        "fn": "liquidationCall",
        "decoded_args": {"collateral": "WETH", "debt": "USDC",
                         "user": "underwater", "amount": "1.8e22"},
        "balance_delta": {"reserves": "-1.8e22", "borrow": "-1.8e22",
                          "utilization": "-0.21", "oracle_price": "-0.12x"},
        "context": "routine liquidation during high volatility; both legs match "
                   "and HF crosses from <1 to >1 in the same tx",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-yearn-v3-rebalance",
        "selector": "0xb8a878a8",
        "fn": "updateMaxDebtForStrategy",
        "decoded_args": {"strategy": "compound-v3-strat", "newDebt": "0"},
        "balance_delta": {"reserves": "-3.2e22", "share_price": "+0.0003"},
        "context": "yearn v3 vault rotates strategies; full debt withdraw from "
                   "old strat then redeposit via new one (next tx)",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-maker-psm-swap",
        "selector": "0x078dfbe7",
        "fn": "buyGem",
        "decoded_args": {"usr": "trading-firm", "gemAmt": "2.0e13"},
        "balance_delta": {"reserves": "-2.0e22", "share_price": "0",
                          "utilization": "+0.0"},
        "context": "$20M PSM USDC→DAI swap; touches reserves but bounded by "
                   "PSM debt ceiling and 1:1 invariant",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-bridge-mint-completeTransfer",
        "selector": "0xc6878519",
        "fn": "completeTransfer",
        "decoded_args": {"vaa": "0xguardian-quorum...", "amount": "8.0e22"},
        "balance_delta": {"reserves": "+8.0e22"},
        "context": "Wormhole VAA verified by guardian quorum; legitimate inbound "
                   "mint after a cross-chain bridge - same selector as "
                   "wormhole-2022-02 but signature is valid",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-curve-gauge-rebalance",
        "selector": "0x4f02c420",
        "fn": "checkpoint_gauge",
        "decoded_args": {"gauge": "3pool"},
        "balance_delta": {"share_price": "+0.0007", "utilization": "+0.001"},
        "context": "weekly Curve gauge checkpoint; CRV emissions update changes "
                   "vault accounting but no token movement",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-compound-rewards-claim",
        "selector": "0xa9059cbb",
        "fn": "claim",
        "decoded_args": {"comet": "cUSDCv3", "src": "user", "shouldAccrue": "true"},
        "balance_delta": {"reserves": "-9.4e21"},
        "context": "user claims 9.4k COMP accrued over 3 months; transfer-shape "
                   "delta but emitted by Comet rewards contract",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-stkAAVE-slash",
        "selector": "0xc4d66de8",
        "fn": "slash",
        "decoded_args": {"amount": "1.5e23", "to": "shortfall-recipient"},
        "balance_delta": {"reserves": "-1.5e23", "share_price": "-0.30"},
        "context": "Aave SafetyModule slash executed by governance after "
                   "shortfall vote; large negative share_price step but "
                   "governance-signed",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-new-market-init",
        "selector": "0x617ba037",
        "fn": "supply",
        "decoded_args": {"asset": "rsETH", "amount": "1.0e21"},
        "balance_delta": {"share_price": "+0.0", "reserves": "+1.0e21",
                          "utilization": "0"},
        "context": "first deposit on freshly listed rsETH market - reserve seed "
                   "by treasury pre-funded the empty market so share_price "
                   "stays 1:1 (mitigation against donation attacks)",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-liquidity-migration",
        "selector": "0xbaa2abde",
        "fn": "removeLiquidity",
        "decoded_args": {"pair": "USDC-DAI-v2", "liquidity": "8.0e22"},
        "balance_delta": {"reserves": "-8.0e22", "share_price": "+0.0002"},
        "context": "DAO-approved migration of LP from Uniswap v2 → v3; large "
                   "outflow followed by addLiquidity on v3 next tx",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-pol-twap-harvest",
        "selector": "0x372500ab",
        "fn": "claimRewards",
        "decoded_args": {"recipient": "ops-multisig", "amount": "2.2e22"},
        "balance_delta": {"reserves": "-2.2e22", "share_price": "0"},
        "context": "protocol-owned-liquidity TWAP harvest paid to ops multisig "
                   "via timelocked withdrawAdmin path",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-chainlink-feed-migration",
        "selector": "0xa9059cbb",
        "fn": "proposeAggregator",
        "decoded_args": {"feed": "stETH-ETH", "newAgg": "0xnew..."},
        "balance_delta": {"oracle_price": "+0.022x"},
        "context": "Chainlink scheduled aggregator migration; small step in "
                   "reported price between old and new median",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-timelock-treasury-transfer",
        "selector": "0xa9059cbb",
        "fn": "transfer",
        "decoded_args": {"to": "ops-multisig", "amount": "1.0e26"},
        "balance_delta": {"reserves": "-1.0e26"},
        "context": "$100M treasury sweep executed by 7-day timelock after "
                   "successful on-chain vote; same selector + magnitude as "
                   "harmony-2022-06 but origin is the timelock contract",
        "source": "synthetic-hard-safe",
    },
]


def all_holdout() -> list[dict]:
    """Returns rows with `label` field set, ready for the eval harness."""
    return (
        [{**r, "label": "RISK"} for r in OOD_NEFARIOUS]
        + [{**r, "label": "SAFE"} for r in HARD_SAFE]
    )
