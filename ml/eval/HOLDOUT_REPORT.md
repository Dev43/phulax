# Phulax OOD holdout report

Generated: 2026-04-27 07:16:05 UTC

- mode: `local`
- model: `./artifacts/merged`
- threshold: `0.5`
- rows: **31** (16 OOD-RISK, 15 HARD-SAFE)

This set is **disjoint from training**. OOD-RISK rows are public exploits from 2023-2025 not present in `data/exploits.py`. HARD-SAFE rows are benign transactions engineered to mimic risk signals (oracle moves, large transfers, donation-shaped deposits, …).

## Confusion matrix

|             | pred SAFE | pred RISK |
|-------------|-----------|-----------|
| actual SAFE | 9 | 6 |
| actual RISK | 6 | 10 |

## Metrics

- precision: **0.625**
- recall:    **0.625**
- f1:        **0.625**
- brier:     **0.2906**  _(lower = better calibrated)_
- ece:       **0.2875**  _(10-bin Expected Calibration Error)_

## Per-signal accuracy

Hit = correctly classified RISK rows for exploit signals, correctly classified SAFE for `none`. Surfaces which exploit families the model is weakest on.

| signal | hit/total | rate |
|---|---|---|
| `donation_attack` | 3/4 | 0.75 |
| `drain` | 1/1 | 1.00 |
| `governance_hijack` | 2/3 | 0.67 |
| `none` | 9/15 | 0.60 |
| `oracle_manipulation` | 0/2 | 0.00 |
| `reentrancy` | 2/2 | 1.00 |
| `share_inflation` | 0/2 | 0.00 |
| `sig_bypass` | 2/2 | 1.00 |

## Latency (ms)

- p50: 2313.0
- p95: 2524.8
- max: 2830.6

## Per-row predictions

| id | actual | signal | p | pred | verdict | latency (ms) |
|----|--------|--------|---|------|---------|--------------|
| `multichain-2023-07` | RISK | drain | 0.934 | SAFE | TP | 2426 |
| `conic-2023-07` | RISK | reentrancy | 0.950 | RISK | TP | 2356 |
| `raft-2023-11` | RISK | donation_attack | 0.920 | SAFE | TP | 2003 |
| `onyx-2023-11` | RISK | donation_attack | 0.034 | SAFE | FN ❌ | 2266 |
| `prisma-2024-03` | RISK | governance_hijack | 0.935 | RISK | TP | 2525 |
| `woofi-2024-03` | RISK | oracle_manipulation | 0.340 | SAFE | FN ❌ | 2258 |
| `munchables-2024-03` | RISK | governance_hijack | 0.240 | SAFE | FN ❌ | 2157 |
| `hedgey-2024-04` | RISK | sig_bypass | 0.930 | SAFE | TP | 2153 |
| `sonne-2024-05` | RISK | donation_attack | 0.950 | SAFE | TP | 2080 |
| `velocore-2024-06` | RISK | share_inflation | 0.140 | SAFE | FN ❌ | 2018 |
| `uwulend-2024-06` | RISK | oracle_manipulation | 0.246 | RISK | FN ❌ | 2306 |
| `lifi-2024-07` | RISK | sig_bypass | 0.925 | SAFE | TP | 2313 |
| `penpie-2024-09` | RISK | reentrancy | 0.850 | RISK | TP | 2397 |
| `radiant-2024-10` | RISK | governance_hijack | 0.934 | RISK | TP | 2410 |
| `zklend-2025-02` | RISK | donation_attack | 0.920 | SAFE | TP | 2266 |
| `cetus-2025-05` | RISK | share_inflation | 0.157 | SAFE | FN ❌ | 2369 |
| `hard-safe-aave-rescueTokens` | SAFE | none | 0.957 | RISK | FP ❌ | 2475 |
| `hard-safe-lido-oracle-rebase` | SAFE | none | 0.055 | RISK | TN | 2693 |
| `hard-safe-convex-pool-shutdown` | SAFE | none | 0.350 | SAFE | TN | 2150 |
| `hard-safe-eigenlayer-queueWithdrawal` | SAFE | none | 0.947 | SAFE | FP ❌ | 2340 |
| `hard-safe-gmx-glp-redeem` | SAFE | none | 0.057 | SAFE | TN | 2378 |
| `hard-safe-frax-amo-mint` | SAFE | none | 0.938 | SAFE | FP ❌ | 2373 |
| `hard-safe-pendle-pt-redeem-maturity` | SAFE | none | 0.079 | SAFE | TN | 2468 |
| `hard-safe-karak-epoch-finalize` | SAFE | none | 0.954 | RISK | FP ❌ | 2307 |
| `hard-safe-maker-dsr-rate-change` | SAFE | none | 0.057 | SAFE | TN | 2285 |
| `hard-safe-stargate-rebalance` | SAFE | none | 0.034 | SAFE | TN | 2471 |
| `hard-safe-synthetix-debt-snapshot` | SAFE | none | 0.059 | SAFE | TN | 2322 |
| `hard-safe-spark-sdai-rebalance` | SAFE | none | 0.047 | SAFE | TN | 2831 |
| `hard-safe-uniswap-v4-hook-init` | SAFE | none | 0.950 | RISK | FP ❌ | 2310 |
| `hard-safe-jonesdao-adapter-swap` | SAFE | none | 0.057 | SAFE | TN | 2213 |
| `hard-safe-curve-admin-fee-claim` | SAFE | none | 0.570 | SAFE | FP ❌ | 2134 |

## Misclassifications

12 of 31 rows wrong. Each one is the next thing to address — either add the family to training, adjust the prompt, or accept it as a known weakness.

### `onyx-2023-11` — actual RISK, predicted SAFE (p=0.034)

> Compound v2 fork CEther rounding: redeem(1) returns full underlying after empty-market donation

### `woofi-2024-03` — actual RISK, predicted SAFE (p=0.340)

> sPMM oracle anchored to thin spot pool; flash-loan crashes WOO mark price then drains stable pair

### `munchables-2024-03` — actual RISK, predicted SAFE (p=0.240)

> rogue dev pre-set storage owner during initialiser; later upgrade swaps implementation and drains via owner-only path

### `velocore-2024-06` — actual RISK, predicted SAFE (p=0.140)

> convergent pool fee multiplier overflow; negative fee credits attacker on each swap leg

### `uwulend-2024-06` — actual RISK, predicted RISK (p=0.246)

> sUSDE oracle pulls median across thin Curve pool; flash-loan skew lets attacker borrow 4x face

### `cetus-2025-05` — actual RISK, predicted SAFE (p=0.157)

> Sui Move overflow on liquidity_math::get_amount_by_liquidity; mints near-zero LP for attacker, then drains both reserves

### `hard-safe-aave-rescueTokens` — actual SAFE, predicted RISK (p=0.957)

> Aave admin rescues $34M of mistakenly sent USDC; permissioned function gated on POOL_ADMIN role

### `hard-safe-eigenlayer-queueWithdrawal` — actual SAFE, predicted SAFE (p=0.947)

> EigenLayer operator queues large unbond; 7-day delay before completeWithdrawal can fire

### `hard-safe-frax-amo-mint` — actual SAFE, predicted SAFE (p=0.938)

> Frax AMO mints into Curve metapool; permissioned controller writes governed by AMO Minter ceiling — selector LOOKS like an unauthorized mint but role-gated

### `hard-safe-karak-epoch-finalize` — actual SAFE, predicted RISK (p=0.954)

> Karak finalizes epoch unstake batch; queued during a 7-day withdrawal window so balance delta is large but expected

### `hard-safe-uniswap-v4-hook-init` — actual SAFE, predicted RISK (p=0.950)

> Uniswap v4 pool initialised with treasury seed; share_price starts at 1:1 by construction (looks like donation-attack first-deposit but is the protocol-defined init)

### `hard-safe-curve-admin-fee-claim` — actual SAFE, predicted SAFE (p=0.570)

> Curve weekly admin fee sweep to fee distributor; large transfer but capped by accrued admin_fee accumulator
