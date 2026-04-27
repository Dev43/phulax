# Phulax OOD holdout report

Generated: 2026-04-27 00:59:46 UTC

- mode: `local`
- model: `./artifacts/merged`
- threshold: `0.5`
- rows: **31** (16 OOD-RISK, 15 HARD-SAFE)

This set is **disjoint from training**. OOD-RISK rows are public exploits from 2023-2025 not present in `data/exploits.py`. HARD-SAFE rows are benign transactions engineered to mimic risk signals (oracle moves, large transfers, donation-shaped deposits, …).

## Confusion matrix

|             | pred SAFE | pred RISK |
|-------------|-----------|-----------|
| actual SAFE | 5 | 10 |
| actual RISK | 0 | 16 |

## Metrics

- precision: **0.615**
- recall:    **1.000**
- f1:        **0.762**

## Latency (ms)

- p50: 2396.2
- p95: 2698.2
- max: 3088.4

## Per-row predictions

| id | actual | p | pred | verdict | latency (ms) |
|----|--------|---|------|---------|--------------|
| `multichain-2023-07` | RISK | 0.940 | RISK | TP | 2698 |
| `conic-2023-07` | RISK | 0.940 | RISK | TP | 2632 |
| `raft-2023-11` | RISK | 0.940 | RISK | TP | 2500 |
| `onyx-2023-11` | RISK | 0.940 | RISK | TP | 2392 |
| `prisma-2024-03` | RISK | 0.940 | RISK | TP | 2647 |
| `woofi-2024-03` | RISK | 0.940 | RISK | TP | 2500 |
| `munchables-2024-03` | RISK | 0.940 | RISK | TP | 2564 |
| `hedgey-2024-04` | RISK | 0.940 | RISK | TP | 2334 |
| `sonne-2024-05` | RISK | 0.940 | RISK | TP | 2396 |
| `velocore-2024-06` | RISK | 0.940 | RISK | TP | 2362 |
| `uwulend-2024-06` | RISK | 0.940 | RISK | TP | 2293 |
| `lifi-2024-07` | RISK | 0.940 | RISK | TP | 2477 |
| `penpie-2024-09` | RISK | 0.940 | RISK | TP | 2706 |
| `radiant-2024-10` | RISK | 0.940 | RISK | TP | 2665 |
| `zklend-2025-02` | RISK | 0.940 | RISK | TP | 2212 |
| `cetus-2025-05` | RISK | 0.940 | RISK | TP | 3088 |
| `hard-safe-aave-treasury-sweep` | SAFE | 0.940 | RISK | FP ❌ | 2524 |
| `hard-safe-chainlink-eth-crash` | SAFE | 0.340 | SAFE | TN | 2307 |
| `hard-safe-whale-deposit` | SAFE | 0.940 | RISK | FP ❌ | 2369 |
| `hard-safe-liquidation-cascade` | SAFE | 0.940 | RISK | FP ❌ | 2546 |
| `hard-safe-yearn-v3-rebalance` | SAFE | 0.030 | SAFE | TN | 2345 |
| `hard-safe-maker-psm-swap` | SAFE | 0.940 | RISK | FP ❌ | 2398 |
| `hard-safe-bridge-mint-completeTransfer` | SAFE | 0.940 | RISK | FP ❌ | 2308 |
| `hard-safe-curve-gauge-rebalance` | SAFE | 0.030 | SAFE | TN | 2316 |
| `hard-safe-compound-rewards-claim` | SAFE | 0.940 | RISK | FP ❌ | 2376 |
| `hard-safe-stkAAVE-slash` | SAFE | 0.940 | RISK | FP ❌ | 2447 |
| `hard-safe-new-market-init` | SAFE | 0.940 | RISK | FP ❌ | 2396 |
| `hard-safe-liquidity-migration` | SAFE | 0.030 | SAFE | TN | 2459 |
| `hard-safe-pol-twap-harvest` | SAFE | 0.940 | RISK | FP ❌ | 2289 |
| `hard-safe-chainlink-feed-migration` | SAFE | 0.020 | SAFE | TN | 2113 |
| `hard-safe-timelock-treasury-transfer` | SAFE | 0.940 | RISK | FP ❌ | 2310 |

## Misclassifications

10 of 31 rows wrong. Each one is the next thing to address — either add the family to training, adjust the prompt, or accept it as a known weakness.

### `hard-safe-aave-treasury-sweep` — actual SAFE, predicted RISK (p=0.940)

> scheduled AIP-executed sweep of accrued protocol fees from Aave Collector to Ecosystem Reserve; large but routine

### `hard-safe-whale-deposit` — actual SAFE, predicted RISK (p=0.940)

> single-block $50M USDC deposit from a Fireblocks-tagged institutional wallet; share_price barely moves

### `hard-safe-liquidation-cascade` — actual SAFE, predicted RISK (p=0.940)

> routine liquidation during high volatility; both legs match and HF crosses from <1 to >1 in the same tx

### `hard-safe-maker-psm-swap` — actual SAFE, predicted RISK (p=0.940)

> $20M PSM USDC→DAI swap; touches reserves but bounded by PSM debt ceiling and 1:1 invariant

### `hard-safe-bridge-mint-completeTransfer` — actual SAFE, predicted RISK (p=0.940)

> Wormhole VAA verified by guardian quorum; legitimate inbound mint after a cross-chain bridge - same selector as wormhole-2022-02 but signature is valid

### `hard-safe-compound-rewards-claim` — actual SAFE, predicted RISK (p=0.940)

> user claims 9.4k COMP accrued over 3 months; transfer-shape delta but emitted by Comet rewards contract

### `hard-safe-stkAAVE-slash` — actual SAFE, predicted RISK (p=0.940)

> Aave SafetyModule slash executed by governance after shortfall vote; large negative share_price step but governance-signed

### `hard-safe-new-market-init` — actual SAFE, predicted RISK (p=0.940)

> first deposit on freshly listed rsETH market - reserve seed by treasury pre-funded the empty market so share_price stays 1:1 (mitigation against donation attacks)

### `hard-safe-pol-twap-harvest` — actual SAFE, predicted RISK (p=0.940)

> protocol-owned-liquidity TWAP harvest paid to ops multisig via timelocked withdrawAdmin path

### `hard-safe-timelock-treasury-transfer` — actual SAFE, predicted RISK (p=0.940)

> $100M treasury sweep executed by 7-day timelock after successful on-chain vote; same selector + magnitude as harmony-2022-06 but origin is the timelock contract
