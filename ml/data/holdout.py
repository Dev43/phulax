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
    # Fresh holdout — distinct protocols/scenarios from hard_benign.py training
    # generator. Chosen so each row tests a *different* axis of "looks risky
    # but isn't" not represented in the training distribution by exact match.
    {
        "id": "hard-safe-aave-rescueTokens",
        "selector": "0x4c8a2d18",
        "fn": "rescueTokens",
        "decoded_args": {"token": "USDC", "to": "aave-collector",
                         "amount": "3.4e22"},
        "balance_delta": {"reserves": "-3.4e22"},
        "context": "Aave admin rescues $34M of mistakenly sent USDC; "
                   "permissioned function gated on POOL_ADMIN role",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-lido-oracle-rebase",
        "selector": "0x9f6f6e9f",
        "fn": "handleOracleReport",
        "decoded_args": {"epochId": "245760", "clValidators": "350000",
                         "clBalance": "1.12e25"},
        "balance_delta": {"share_price": "+0.0028", "reserves": "+1.4e22",
                          "oracle_price": "+0.0011x"},
        "context": "Lido daily oracle quorum rebases stETH; share_price drifts "
                   "up by accrued staking rewards (legit positive step)",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-convex-pool-shutdown",
        "selector": "0x80809ce0",
        "fn": "shutdownPool",
        "decoded_args": {"pid": "42"},
        "balance_delta": {"reserves": "-7.8e22", "share_price": "0"},
        "context": "Convex booster shuts down a deprecated gauge; full LP "
                   "balance migrates to gauge contract for stakers to withdraw",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-eigenlayer-queueWithdrawal",
        "selector": "0xf123abcd",
        "fn": "queueWithdrawals",
        "decoded_args": {"strategy": "stETH-strat", "shares": "5.5e22"},
        "balance_delta": {"reserves": "-5.5e22", "share_price": "0"},
        "context": "EigenLayer operator queues large unbond; 7-day delay before "
                   "completeWithdrawal can fire",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-gmx-glp-redeem",
        "selector": "0x9304c934",
        "fn": "unstakeAndRedeemGlp",
        "decoded_args": {"tokenOut": "USDC", "glpAmount": "3.0e22"},
        "balance_delta": {"reserves": "-3.0e22", "share_price": "-0.002",
                          "utilization": "+0.04"},
        "context": "$30M GLP redemption by an institutional LP; bounded by GLP "
                   "AUM and oracle-spread fee",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-frax-amo-mint",
        "selector": "0x5b16ebb7",
        "fn": "mintRedeemPart1",
        "decoded_args": {"frax_amount": "5.0e24"},
        "balance_delta": {"reserves": "+5.0e24", "share_price": "0"},
        "context": "Frax AMO mints into Curve metapool; permissioned controller "
                   "writes governed by AMO Minter ceiling — selector LOOKS like "
                   "an unauthorized mint but role-gated",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-pendle-pt-redeem-maturity",
        "selector": "0x0d2b1c34",
        "fn": "redeemPY",
        "decoded_args": {"PT": "PT-stETH-26DEC2025", "amount": "4.2e22"},
        "balance_delta": {"share_price": "-0.124", "reserves": "-4.2e22"},
        "context": "PT redemption at maturity; share_price step is the expected "
                   "yield-token settlement, not exploit-induced",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-karak-epoch-finalize",
        "selector": "0x7f3a2d11",
        "fn": "finalizeEpoch",
        "decoded_args": {"epoch": "183", "totalUnstake": "1.8e23"},
        "balance_delta": {"reserves": "-1.8e23", "share_price": "0"},
        "context": "Karak finalizes epoch unstake batch; queued during a 7-day "
                   "withdrawal window so balance delta is large but expected",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-maker-dsr-rate-change",
        "selector": "0x29ae8114",
        "fn": "file",
        "decoded_args": {"what": "dsr", "data": "1.000000003"},
        "balance_delta": {"share_price": "+0.0014", "utilization": "0"},
        "context": "Maker governance updates DSR rate; share_price drift "
                   "compounds across $4B sDAI but per-tx effect is tiny",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-stargate-rebalance",
        "selector": "0x252f7b01",
        "fn": "swapRemote",
        "decoded_args": {"srcChain": "arbitrum", "dstPool": "USDC",
                         "amount": "9.5e22"},
        "balance_delta": {"reserves": "-9.5e22", "share_price": "+0.0001"},
        "context": "Stargate cross-chain pool rebalance; reserves move out but "
                   "matching liquidity arrives on dst chain (off-chain to "
                   "this tx)",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-synthetix-debt-snapshot",
        "selector": "0x4d4e8f3a",
        "fn": "takeDebtSnapshot",
        "decoded_args": {"period": "weekly"},
        "balance_delta": {"share_price": "-0.018", "utilization": "+0.003"},
        "context": "Synthetix weekly debt pool snapshot; share_price re-anchors "
                   "to current oracle prices — step but not directional drain",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-spark-sdai-rebalance",
        "selector": "0x6e553f65",
        "fn": "deposit",
        "decoded_args": {"assets": "8.0e25", "receiver": "spark-pool"},
        "balance_delta": {"reserves": "+8.0e25", "share_price": "+0.0",
                          "utilization": "-0.05"},
        "context": "Spark protocol redeposits $80M DAI from Maker D3M; "
                   "round-trip via Maker DSS, role-gated",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-uniswap-v4-hook-init",
        "selector": "0xa1ee9c2c",
        "fn": "initialize",
        "decoded_args": {"poolKey": "USDC-WETH-3000", "sqrtPriceX96": "..."},
        "balance_delta": {"share_price": "+1.0", "reserves": "+1"},
        "context": "Uniswap v4 pool initialised with treasury seed; share_price "
                   "starts at 1:1 by construction (looks like donation-attack "
                   "first-deposit but is the protocol-defined init)",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-jonesdao-adapter-swap",
        "selector": "0xa9b8cd14",
        "fn": "swapAdapter",
        "decoded_args": {"oldAdapter": "v1-strat", "newAdapter": "v2-strat"},
        "balance_delta": {"reserves": "-2.6e22", "share_price": "+0.0001"},
        "context": "JonesDAO governance-approved adapter swap; vault liquidity "
                   "rotates to new strategy contract in same tx",
        "source": "synthetic-hard-safe",
    },
    {
        "id": "hard-safe-curve-admin-fee-claim",
        "selector": "0xe2982c21",
        "fn": "claim_admin_fees",
        "decoded_args": {"pool": "3pool"},
        "balance_delta": {"reserves": "-1.4e22", "share_price": "+0.0"},
        "context": "Curve weekly admin fee sweep to fee distributor; large "
                   "transfer but capped by accrued admin_fee accumulator",
        "source": "synthetic-hard-safe",
    },
]


def all_holdout() -> list[dict]:
    """Returns rows with `label` field set, ready for the eval harness."""
    return (
        [{**r, "label": "RISK"} for r in OOD_NEFARIOUS]
        + [{**r, "label": "SAFE"} for r in HARD_SAFE]
    )
