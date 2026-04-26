# Phulax Build Checklist

Synthesized from `tasks/todo.md` Review sections and §491 cross-track snapshot (2026-04-25).

## Done

### Track A — KeeperHub × 0G bridge (`keeperhub/`, branch `feature/0g-integration`)
- [x] A1 chain seeds: 0G Mainnet (16661) + Galileo Testnet (16601) wired in `lib/rpc/rpc-config.ts` + `scripts/seed/seed-chains.ts`
- [x] A2 `plugins/0g-storage`: `kv-get`, `kv-put`, `log-append` via Flow-contract writes (org KeeperHub wallet signs)
- [x] A3 `plugins/0g-compute`: `sealed-inference` action with `acknowledgeProviderSigner` + `processResponse` verification
- [x] A4 / A6 workflow skeleton: `specs/0g-integration/per-tx-detection.workflow.json`
- [x] A5 measurement script: `scripts/0g/measure-block-time.ts` (script written, not yet run)
- [x] `plugin-allowlist.json` updated; `pnpm discover-plugins` regenerated
- [x] Smoke-test recipes at `specs/0g-integration/smoke-tests.md`

### Track B — Contracts (`contracts/`)
- [x] Foundry scaffold (`foundry.toml`, `remappings.txt`, `package.json`)
- [x] Repo-root `pnpm-workspace.yaml` (contracts, agent, web, keeperhub)
- [x] `PhulaxAccount.sol` — single-selector agent path, hard-coded `owner` recipient
- [x] `Hub.sol` registry + risk policy events
- [x] `PhulaxINFT.sol` (ERC-7857-shaped, OZ v5)
- [x] `IAdapter` + `FakePoolAdapter`
- [x] `FakeLendingPool` with both intentional vulns + Aave-shape events
- [x] `PhulaxAccount.fuzz.t.sol` + `PhulaxAccount.invariant.t.sol` + `ExploitReplay.t.sol`
- [x] `script/Deploy.s.sol` targeting 0G testnet
- [x] `scripts/extract-abis.mjs` + `wagmi.config.ts`
- [x] **Foundry installed locally** (`forge 1.5.1-stable`); `forge install --no-git foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts` succeeded
- [x] **`forge build` clean** (only style notes, no errors)
- [x] **`forge test -vv` all green: 11/11 across 7 suites**
- [x] Adapter accounting fix: `FakePoolAdapter` is now the pool's supplier of record with per-account internal bookkeeping
- [x] Oracle exploit math fix: `FakeLendingPool.borrow` uses asymmetric pricing (collateral oracle-priced, borrow side in token units) — Mango/Cream-shape drain now lands
- [x] **Vuln #2: reentrancy drain** — `ExploitReentrancy.t.sol` + `MockHookToken` + `ReentrancyAttacker`. Hook-token re-enters `pool.withdraw` through the CEI door; attacker double-drains their own deposit. (Lendf.Me / CREAM shape.)
- [x] **Vuln #3: flash-loan oracle drain** — `ExploitFlashLoan.t.sol` + `FlashLender` mock + `FlashLoanOracleAttacker`. Zero-capital attacker borrows from external lender, supplies dust, pumps oracle, drains pool, repays loan. (Inverse / Beanstalk shape.)
- [x] **Vuln #4: liquidation via oracle crash** — `ExploitLiquidation.t.sol`. Honest borrower opens healthy position; attacker crashes oracle (inverse direction); liquidates and seizes full collateral. New `FakeLendingPool.liquidate` function. (Solend cascade shape.)
- [x] **Vuln #5: admin rug** — `ExploitAdminRug.t.sol`. New `FakeLendingPool.withdrawReserves` admin-only sweep. Demos a compromised-key / rogue-team rug.

### Track C — ML pipeline (`ml/`)
- [x] uv project (`pyproject.toml`, `.env.example`, `README.md`)
- [x] Dataset builder → 210 rows (60 RISK / 150 benign), schema locked
- [x] Frozen prompt template `ml/prompt/template.py` (`TEMPLATE_VERSION=1.0.0`)
- [x] LoRA fine-tune script (rank 16, α 32, lr 2e-4, 3 epochs)
- [x] Merge + Q4_K_M quantize via llama.cpp
- [x] Embeddings indexer (`all-MiniLM-L6-v2`, 384-dim) → 0G KV
- [x] 0G Storage HTTP client shim (`ml/og_client.py`)
- [x] Eval harness (local + remote endpoint modes)
- [x] Upload manifest builder → `ml/artifacts.json`

### Track D — Inference (`inference/`)
- [x] D1 stub `POST /classify` + `GET /healthz` with full real-shape response
- [x] Canonical-JSON `input_hash` (sorted keys, `(",", ":")` separators)
- [x] HMAC-SHA256 signature over `model_hash || input_hash || canonical(output)`
- [x] Dockerfile (`python:3.11-slim`, pinned deps)
- [x] 4 passing tests (healthz, shape, hash determinism, signature verify)

### Track E — Agent (`agent/`)
- [x] E1–E8 scaffold: Node 20, viem, fastify, strict TS
- [x] Narrow `PhulaxAccount` ABI (single-selector at type level)
- [x] Pure detection tiers in `detection/{invariants,oracle,vector,classifier,detect}.ts` + `hydrate.ts` for I/O
- [x] Purity test (deep-equal on repeated calls)
- [x] Risk aggregator (max-across-block, iNFT-policy threshold)
- [x] 0G client (`og/http.ts` + `kv.ts` + `log.ts`)
- [x] KeeperHub workflow spec + MCP client
- [x] `exec/withdraw.ts` as the only signing module
- [x] `server.ts`: `/stream` SSE, `/incidents/:account`, `/feedback`, `/detect-batch`
- [x] 7 exploit fixtures + 2 negative controls; 9/9 vitest green; `tsc --noEmit` clean

### Track F — Web (`web/`)
- [x] F1 Next.js 14 App Router scaffold (Tailwind, shadcn primitives, wagmi v2, viem, react-query)
- [x] F2 one-screen dashboard: connect, position, risk gauge, streaming log panel, incident timeline, FP-feedback toggle
- [x] Mock SSE stream + "simulate attack" demo button
- [x] `pnpm install` / `type-check` / `build` / `dev` all clean

---

## To do

### Hard blockers (must land before end-to-end demo)
- [ ] Identify 0G Galileo WSS endpoint (or implement polling fallback for `Block` trigger)
- [ ] Run `scripts/0g/measure-block-time.ts` against testnet; record p50/p95 RPC latency + block time
- [ ] `forge script Deploy.s.sol --rpc-url 0g_testnet --broadcast` → record FakeLendingPool / Hub / PhulaxAccount addresses
- [ ] Run LoRA fine-tune (needs `OG_FT_ENDPOINT` credentials or GPU box)
- [ ] Upload merged weights + GGUF + dataset + index + harness to 0G Storage → populate `ml/artifacts.json`
- [ ] Generate `ml/eval/REPORT.md`; verify ≥0.8 precision / ≥0.6 recall on holdout

### Sequenced follow-on work
- [ ] D2: lock FastAPI-vs-llama.cpp decision after benchmarking Q4 GGUF latency on target Fly/Railway instance
- [ ] D3–D6: swap inference stub for real merged weights; populate `PHULAX_MODEL_HASH` from CID
- [ ] Track E ABI swap: replace hand-rolled `FakeLendingPool` ABI with Track B's `generated/wagmi.ts`
- [ ] Fill workflow JSON address slots (`{{TODO_FAKE_LENDING_POOL_ADDRESS}}`, `env.PHULAX_*`, inference URL + HMAC)
- [ ] End-to-end testnet run: import `per-tx-detection.workflow.json` into KH dev project; fire one synthetic block; confirm KV read + classifier call + log-append + (optional) `write-contract`
- [ ] F3 wallet/account reads via generated `wagmi.config.ts` (post-B8)
- [ ] F4 deposit/withdraw wired to `PhulaxAccount` (post-B8)
- [ ] F5 real `/stream` EventSource (post-E7)
- [ ] F6 `/incidents/:account` proxy (post-E7)
- [ ] F8 `POST /feedback` from toggle (post-E7)
- [ ] Restore `keeperhub/FEEDBACK.md` against the SDK-backed implementation

### Demo / shipping
- [ ] Mint script wiring `PhulaxINFT.mint(owner, cid)` against `ml/artifacts.json` CIDs
- [ ] Twitter scraper (Day-4 tiebreaker — defer unless time permits)
- [ ] Demo video
- [ ] README polish
- [ ] Open upstream KeeperHub PR to `staging` (only **after** demo is recorded — §7.5)

### Demo coverage matrix

The pool now exposes five intentional vulns; tests prove each one drains real funds. The agent's detection pipeline (`agent/src/detection/*`) needs a fixture per exploit so the corresponding tier fires correctly:

| # | Exploit                       | Test file                       | Primary detection tier(s)                    | Real-world match                  |
|---|-------------------------------|---------------------------------|----------------------------------------------|-----------------------------------|
| 1 | Open-oracle borrow drain      | `ExploitReplay.t.sol`           | invariant + oracle deviation                 | Mango / Cream                     |
| 2 | Reentrancy via hook-token     | `ExploitReentrancy.t.sol`       | invariant (`Σ Transfer > supplied`)          | Lendf.Me / CREAM ERC777           |
| 3 | Flash-loan amplified drain    | `ExploitFlashLoan.t.sol`        | vector (huge in-tx balance delta) + oracle   | Inverse / Beanstalk               |
| 4 | Liquidation via oracle crash  | `ExploitLiquidation.t.sol`      | oracle deviation (negative) + classifier     | Solend cascade                    |
| 5 | Admin reserve sweep           | `ExploitAdminRug.t.sol`         | classifier (admin selector, abnormal `to`)   | TornadoCash gov / bridge admins   |

- [ ] **Track E follow-up** — register fixture replays for #2–#5 in `agent/test/fixtures/exploits.ts` so each tier's purity test covers the new shapes. Existing 7 fixtures cover #1 only; need ~4 more.
- [ ] *(Skipped: donation/share-inflation — needs a share-based vault we don't have. Sandwich/MEV — not a defensive-agent value-add. Bad-debt — too slow for one-block demo.)*

### STRATEGY.md edits queued
- [ ] §2(b): tighten to "LoRA-only fine-tune of Qwen2.5-0.5B-Instruct as a structured classifier"
- [ ] §3 / §10: note 0G Storage writes are signed by org KeeperHub wallet via Flow contract `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296`, not bearer auth
- [ ] §5 Day 3: link to `ml/README.md` for run order instead of restating
