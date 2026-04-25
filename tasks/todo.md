# Phulax — Concrete Build Plan

Companion to `STRATEGY.md`. Strategy says *what* and *why*; this doc says *how*, *with what*, and *in what order*.

---

## 1. System map (what we are actually shipping)

Five deliverables, in dependency order:

1. **`keeperhub-0g`** — fork/extension of KeeperHub adding 0G chain + 0G Storage + 0G Compute as first-class workflow primitives. (Day 1 prerequisite.)
2. **`contracts/`** — Solidity: `PhulaxAccount`, `Hub`, `Adapter`, `FakeLendingPool`, `PhulaxINFT` (ERC-7857).
3. **`agent/`** — TypeScript off-chain guardian: detection pipeline, risk aggregator, KeeperHub workflow definitions, 0G Storage/Compute clients.
4. **`ml/`** — Python: dataset curation, embeddings, fine-tuning job spec, eval harness. Outputs are uploaded to 0G; runtime never touches Python.
5. **`web/`** — Minimal Next.js dashboard for the demo: deposit, view position, view risk score stream, withdraw button, FP-feedback toggle.

Everything lives in a single monorepo (pnpm workspaces + Foundry + a Python `ml/` sub-tree managed with `uv`).

---

## 2. Language & runtime choices (with rationale)

| Layer | Choice | Why |
|---|---|---|
| Smart contracts | **Solidity 0.8.24 + Foundry** | ERC-7857 reference is Solidity; Foundry is fastest for fork-mode exploit replays which we *will* be running constantly. |
| Off-chain agent | **TypeScript (Node 20) + viem** | KeeperHub workflows are JS-native; viem gives us typed ABIs from Foundry artifacts; one language across agent + frontend. |
| ML / fine-tune | **Python 3.11 + PyTorch + sentence-transformers** | Only used offline to produce artifacts (embeddings + fine-tuned weights) uploaded to 0G. Keeps Python out of the hot path. |
| KeeperHub extension | **TypeScript** (matches upstream) | Stay in-tree with KeeperHub so the bridge can be upstreamed/demoed cleanly. |
| Frontend | **Next.js 14 (App Router) + wagmi + viem + Tailwind + shadcn/ui** | Boring, fast, judges-friendly. App Router lets the same TS types flow from agent → UI. |
| Infra | **Docker Compose** for local (anvil + agent + web), **Railway/Fly** for the live demo backend. | One command up. |

**One language rule:** TypeScript everywhere it can be. Python is sandboxed to the `ml/` artifact pipeline.

---

## 3. Architecture (concrete)

```
                          ┌──────────────────────────┐
                          │       Next.js web        │
                          │ wagmi+viem  ·  shadcn/ui │
                          └──────────┬───────────────┘
                                     │ JSON-RPC + SSE
                                     ▼
┌──────────────────────────────────────────────────────────────┐
│                     agent/ (TypeScript)                      │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────────┐   │
│  │ Risk         │  │ Detection      │  │ KeeperHub       │   │
│  │ aggregator   │◄─┤ pipeline       │◄─┤ workflow client │   │
│  │ (weighted)   │  │ (invariants,   │  │ (per-txn trig.) │   │
│  └──────┬───────┘  │  oracle dev,   │  └────────┬────────┘   │
│         │          │  vector sim,   │           │            │
│         │          │  classifier)   │           │            │
│         │          └────────┬───────┘           │            │
│         │                   │                   │            │
│         ▼                   ▼                   ▼            │
│   ┌────────────┐    ┌──────────────┐    ┌────────────────┐   │
│   │ withdraw() │    │ 0G Storage   │    │ 0G Compute     │   │
│   │ executor   │    │ KV+Log SDK   │    │ sealed-inf SDK │   │
│   └─────┬──────┘    └──────────────┘    └────────────────┘   │
└─────────┼────────────────────────────────────────────────────┘
          │
          ▼
   KeeperHub MCP ──── private routing ──► PhulaxAccount.withdraw(adapter)
```

Key invariants:

- **Agent never holds user funds.** Withdraws always route to `owner`. Enforced in the contract, not the agent.
- **Agent decisions are reproducible.** Every `FIRE` event embeds a 0G Compute attestation hash + the Storage CIDs of the inputs used.
- **Detection pipeline is pure.** `detect(tx, ctx) -> Score` has no side effects so we can replay any historical exploit through it as a regression test.

---

## 4. Repository layout

```
phulax/
├── contracts/              # Foundry project
│   ├── src/
│   │   ├── PhulaxAccount.sol
│   │   ├── Hub.sol
│   │   ├── adapters/
│   │   │   ├── IAdapter.sol
│   │   │   └── FakePoolAdapter.sol
│   │   ├── pools/FakeLendingPool.sol
│   │   └── inft/PhulaxINFT.sol      # ERC-7857
│   ├── test/                         # forge tests + exploit replays
│   └── script/Deploy.s.sol
├── agent/                  # TS guardian
│   ├── src/
│   │   ├── detection/      # invariants, oracle, vector, classifier
│   │   ├── risk/           # aggregator + thresholds
│   │   ├── og/             # 0G Storage + Compute clients
│   │   ├── keeperhub/      # workflow defs + MCP client
│   │   ├── exec/           # withdraw executor
│   │   └── server.ts       # SSE feed for the UI
│   └── package.json
├── keeperhub-0g/           # fork: 0G chain + actions
├── ml/                     # Python, offline only
│   ├── embed/              # exploit corpus → vectors
│   ├── finetune/           # 0G fine-tuning job spec
│   └── eval/
├── web/                    # Next.js
│   └── app/
├── docker/                 # compose for local demo
├── tasks/
│   ├── todo.md
│   └── lessons.md
└── pnpm-workspace.yaml
```

---

## 5. Smart contract design (concrete shapes)

**`PhulaxAccount`**
- Storage: `address owner; address agent; mapping(address adapter => bool) allowed;`
- Functions:
  - `deposit(address adapter, uint256 amount)` — owner-only
  - `withdraw(address adapter)` — `owner || agent`; pulls from adapter; sends to `owner` *only*. Hard-coded recipient — no `to` parameter.
  - `setAgent`, `revokeAgent`, `setAdapter` — owner-only
  - `execute(target, data)` — owner-only escape hatch
- No upgradability. No `delegatecall`. Agent path uses a tiny fixed selector set.

**`Hub`** — registry: `register(account)`, `setRiskPolicy(thresholds)`, `linkINFT(tokenId)`. Events drive the UI.

**`PhulaxINFT` (ERC-7857)** — separate contract. Per-user token. Metadata pointer to 0G Storage CID containing `{policy, adapters, classifier_pointer, incident_log_cid}`.

**`FakeLendingPool`** — Aave-lite: `supply`, `borrow`, `withdraw`, oracle-priced. **Intentional vulns:** (a) single-block oracle manipulation via a manipulable getter, (b) reentrancy on `withdraw` that we leave open to demo a draining txn.

**`FakePoolAdapter`** — normalises pool calls to `IAdapter.deposit/withdraw/balance`.

Tests:
- Forge fuzz: `PhulaxAccount.withdraw` cannot ever transfer to a non-owner address.
- Exploit replay: scripted draining txn against `FakeLendingPool`; assert account balance = 0 in pool but ≥ 99% of principal back to owner if agent fired in the same block.

---

## 6. Detection pipeline (concrete)

`detect(txCtx) -> { score: 0..1, signals: Signal[], attestation }`:

1. **Invariant tier** (synchronous, ~5ms). Pure TS, reads chain state via viem. Checks: monotonic share price, utilization ≤ 100%, totalSupply == reserves+borrows. Any violation → `score >= 0.6`.
2. **Oracle deviation** (synchronous). Pool price vs Chainlink + DEX TWAP. `|Δ| > 2%` → `score += 0.2`.
3. **Vector similarity** (~100ms). Embed `{calldata 4-byte + first-32-bytes of args, balance delta vector}`; cosine vs 0G Storage KV index. Top-1 ≥ 0.85 → `score += 0.3`.
4. **0G fine-tuned classifier** (~300ms, sealed inference). Returns `p(nefarious)`. Weighted into final score.

Aggregator: weighted sum, clamped, with **early-exit short circuits** at tier 1 (don't burn 0G Compute calls on obvious cases). Threshold default `0.7`, configurable via iNFT policy.

The whole pipeline is one TS function so it can be unit-tested with replayed exploit fixtures.

---

## 7. KeeperHub bridge work (Day 1, the hard part)

We **fork** keeperhub, do all the work in-tree, and open a PR back to `staging` once stable. The fork lives as the `keeperhub/` git submodule already wired into this repo. KeeperHub already exposes a set of slash commands (in `keeperhub/.claude/commands/`) that drive its own Blueprint pipeline (Orchestrator → Researcher → Builder → Verifier → PR). We use them — they're the cheapest path to lint-clean, type-safe, upstream-shaped code.

### 7.1 Slash-command mapping (which command does which piece)

| 0G integration piece | Command | Why this one |
|---|---|---|
| 0G chain support (RPC, signer, explorer, supported tokens) | **`/add-chain 0G`** | Exactly what it does — seeds `chains` + `explorer_configs` + `supported_tokens`, wires `lib/rpc/rpc-config.ts`, idempotent. |
| 0G Storage as workflow steps (`kvGet`, `kvPut`, `logAppend`) | **`/add-plugin 0g-storage`** | Credential-based plugin (storage endpoint + auth). Three actions, each a step file under `plugins/0g-storage/steps/`. |
| 0G Compute sealed inference (`sealedInference`) | **`/add-plugin 0g-compute`** | Credential-based plugin. Single `sealed-inference` action returning `{output, attestation}`. **`maxRetries = 0`** — a retry on a sealed-inference call masks signal we want to surface as a hard failure. |
| 0G chain tx signing from inside a workflow | **new action on existing `web3` plugin** (`/add-plugin` guidance: prefer extending `web3` over a new plugin when the infra is shared) | Once `/add-chain 0G` lands, web3's `chain-select` and tx-submit actions already work on 0G. No new plugin needed. |
| FakeLendingPool monitoring surface | **`/add-protocol fake-lending-pool`** (or just `/add-protocol Aave` against a 0G testnet deployment if one exists) | Generates `protocols/fake-lending-pool.ts` via `defineAbiProtocol()` from a reduced ABI. Gives us typed actions + UI for the demo pool. |
| **Per-tx trigger on a 0G contract** | **NOT a slash-command target — manual** | Triggers live in `app/api/mcp/schemas/route.ts` `TRIGGERS` + `components/workflow/config/trigger-config.tsx`. Add a `0g-tx` trigger type alongside the existing `Event` trigger. This is the one piece that falls outside the Blueprint pipeline. |

`/develop-plugin` is the lower-level inline-spec version of `/add-plugin`. We default to `/add-plugin` (Orchestrator-driven, better quality bar) and only fall through to `/develop-plugin` if the Orchestrator gets stuck.

`/suggest-workflows` is useful on Day 4 to sanity-check the per-tx detection workflow we wire up. Not a build dependency.

### 7.2 Day-1 execution order

1. `/add-chain 0G` — chain seed first; everything else depends on it being routable.
2. `/add-plugin 0g-storage` — KV + Log actions. Smoke-test from a throwaway workflow.
3. `/add-plugin 0g-compute` — sealed-inference action. Remember `maxRetries = 0`.
4. Manual edit: add `0g-tx` trigger type to `TRIGGERS` schema + trigger config UI.
5. `/add-protocol` against the FakeLendingPool ABI (after Day-2 contracts deploy on 0G testnet — defer to Day 2 if blocking).
6. End-of-day: synthetic workflow on 0G testnet — trigger fires on a tx → reads KV → calls sealed inference → appends a Log entry. Green E2E.

### 7.3 Fork hygiene

- All work lives on a feature branch in the fork: `feature/0g-integration`.
- Commits follow keeperhub's conventional-commit format (their `pr-title-check` enforces this on PRs to `staging`).
- Run `pnpm check && pnpm type-check && pnpm fix` before every commit (their pre-commit hook will block otherwise).
- `FEEDBACK.md` (strategy §9 deliverable) gets written into the fork at the same time and links to the open PR.
- PR to upstream `staging` is opened **after** the demo lands, not before — we don't want upstream review feedback on Day 4.

---

## 8. Frontend considerations

Scope is deliberately small (strategy §8 cuts a "fancy frontend"). What we build:

- **One screen.** Connect wallet → see your `PhulaxAccount` → deposit/withdraw → live risk-score gauge fed by SSE from `agent/server.ts` → incident timeline pulled from 0G Storage Log.
- **Streaming logs panel** (terminal-styled) so judges *see* the agent thinking. This is the credibility moment.
- **No auth, no DB.** State is on-chain + 0G; UI is a thin reader.
- **wagmi v2 + viem** for typed contract reads; ABIs imported directly from Foundry artifacts via a generated `wagmi.config.ts`.

Defer: charts, history pages, multi-account UX, mobile.

---

## 9. Backend considerations

The "backend" is `agent/server.ts`:

- Long-running Node process. One per deployment.
- Subscribes to KeeperHub workflow events (the per-tx trigger).
- Holds the agent signing key in env (KMS later; for the demo, a hot key with `withdraw`-only authority is fine — the contract enforces the blast radius).
- Exposes:
  - `GET /stream` — SSE of detection events
  - `GET /incidents/:account` — proxied from 0G Storage Log
  - `POST /feedback` — user marks a fire as FP; written to iNFT memory
- **No database.** 0G Storage is the database. This is also a story we tell.
- Deployed as a single Docker container behind Railway/Fly. Env: RPC URLs, KeeperHub API key, agent privkey, 0G endpoints.

---

## 10. ML pipeline (offline)

**Available model on 0G: `Qwen2.5-0.5B-Instruct`.** This is a 0.5B-parameter instruct model — tiny by LLM standards. That shapes the design:

- It is **not** strong enough for free-form risk reasoning ("explain whether this tx is suspicious"). Outputs would be unreliable and slow relative to signal.
- It **is** plenty for a **structured classifier head** — give it a tightly-templated prompt that asks for a single token (`SAFE` / `RISK`) or a JSON `{p_nefarious: <0..1>}`, and it can do that well after fine-tuning on a few hundred labelled examples.
- Full fine-tuning (not LoRA) is feasible at 0.5B if 0G's fine-tuning surface allows it; otherwise LoRA is fine.
- Inference latency at 0.5B through sealed inference should be sub-second, which keeps us inside same-block reaction time.

Pipeline (offline, laptop → 0G):

1. Curate ~200 labelled txns (50 nefarious from post-mortems, 150 benign from mainnet samples). Each row: `{calldata, decoded_args, balance_delta, label}`.
2. Build a fixed prompt template: system message defines the task; user message contains canonicalised tx features; expected assistant output is a single JSON object `{"p_nefarious": <0..1>, "tag": "<class>"}`.
3. Fine-tune `Qwen2.5-0.5B-Instruct` on those (prompt, completion) pairs via 0G's fine-tuning surface.
4. Embeddings (separate from the classifier) — use a dedicated sentence-transformer (`all-MiniLM-L6-v2`) over `(calldata 4-byte, abi-decoded args canonicalised, balance-delta vector)`. Embeddings are independent of the classifier. Push to 0G Storage KV (key = exploit id, value = vector + metadata).
5. Eval harness: hold-out 20%; report precision/recall + latency; commit numbers to `ml/eval/REPORT.md`.

Target: ≥0.8 precision at ≥0.6 recall on the holdout. Below that we lean harder on invariants + oracle tier and demote the classifier to a supporting signal in the aggregator.

**Fallback if Qwen2.5-0.5B underperforms after fine-tuning:** drop the classifier from the live path entirely, keep only invariants + oracle deviation + vector similarity. The strategy already calls vector similarity the headline novelty, so the demo narrative survives.

---

## 11. Day-by-day execution (mapped to STRATEGY §5)

**Day 1 — KeeperHub × 0G bridge.** §7 above. Owner: whoever knows KeeperHub internals best. Hard stop: end-of-day E2E demo of the synthetic workflow.

**Day 2 — Contracts + agent skeleton.** Foundry scaffold, contracts above with tests, agent stub that fires `withdraw` on a hardcoded condition through the bridge from Day 1. Local fork demo.

**Day 3 — Detection stack.** Invariants + oracle + embed corpus to 0G + fine-tune + risk aggregator + iNFT contract + mint flow. End-of-day: crafted draining txn → agent withdraws within the same KeeperHub run.

**Day 4 — Execution polish + frontend.** KeeperHub MCP wiring, Twitter scraper (tiebreaker), Next.js UI (one screen), demo video, README, FEEDBACK.md, deploy. Open the upstream KeeperHub PR from our fork once the demo is recorded (not before).

Parallelism: Day 2 contracts and Day 3 ML work can start in parallel on Day 1 once the bridge shape is agreed. Frontend can start as a static mock on Day 2.

---

## 12. Risks specific to the build

- **0G SDK gaps.** If `@0glabs/0g-ts-sdk` is missing pieces we need (sealed-inference attestations, KV bulk ops), we wrap raw HTTP + write the SDK fragment ourselves. Budget half a day for this on Day 1.
- **KeeperHub per-tx trigger latency.** If end-to-end is > 1 block, the demo narrative still works (we say "next-block exit") but we'd prefer same-block. Measure on Day 1.
- **Fine-tune doesn't beat random.** Fallback: ship vector similarity + invariants only; classifier becomes a roadmap item. The strategy already calls vector-sim the headline; we're insulated.
- **iNFT (ERC-7857) tooling immature.** If the reference impl is rough, mint a minimal ERC-721 with the same metadata schema and call it "ERC-7857-shaped." Don't block on standards purity.

---

## 13. Resolved decisions (locked in 2026-04-25)

1. **Fork strategy:** work in a fork of keeperhub on `feature/0g-integration`, open PR to upstream `staging` after the demo is recorded. FEEDBACK.md ships in the fork at the same time.
2. **Live demo on 0G testnet:** confirmed — testnet funds already in hand. No need to record around faucet downtime.
3. **Sealed-inference model:** `Qwen2.5-0.5B-Instruct`. Use as a **structured classifier** (templated JSON output), not for free-form reasoning. See §10.
4. **Autonomous payment (x402 / MPP):** **cut from v1.** Agent gas paid from a hot key topped up with testnet funds; KeeperHub execution cost is ours since we're running our own fork. Keep as a one-line roadmap item in the README. Revisit only if a 0G/KeeperHub bounty specifically calls out x402 or MPP usage.

## 14. Still-open questions

- Does 0G's fine-tuning surface accept full fine-tunes of Qwen2.5-0.5B, or is it LoRA-only? Affects §10 step 3 but not the architecture.
- Is there an existing Aave-on-0G-testnet deployment we can `/add-protocol` against directly, or do we ship our own `FakeLendingPool` ABI? Either works; existing-deployment is faster.
- Per-tx trigger granularity: does 0G's RPC expose a subscription primitive efficient enough for per-tx, or do we poll `eth_getBlockByNumber` with full tx objects? Measure on Day 1.

---

## Review section
*(filled in after each working session — what shipped, what surprised us, what to update in `STRATEGY.md`)*
