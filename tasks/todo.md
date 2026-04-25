# Phulax - Concrete Build Plan

Companion to `STRATEGY.md`. Strategy says *what* and *why*; this doc says *how*, *with what*, and *in what order*.

---

## 1. System map (what we are actually shipping)

Six deliverables, in dependency order:

1. **`keeperhub-0g`** - fork/extension of KeeperHub adding 0G chain + 0G Storage + 0G Compute as first-class workflow primitives. (Day 1 prerequisite.)
2. **`contracts/`** - Solidity: `PhulaxAccount`, `Hub`, `Adapter`, `FakeLendingPool`, `PhulaxINFT` (ERC-7857).
3. **`agent/`** - TypeScript off-chain guardian: detection pipeline, risk aggregator, KeeperHub workflow definitions, 0G Storage/Compute clients.
4. **`ml/`** - Python: dataset curation, embeddings, LoRA fine-tuning job spec, eval harness. Outputs are uploaded to 0G; runtime never touches Python.
5. **`inference/`** - self-hosted classifier endpoint (Qwen2.5-0.5B + merged LoRA on CPU). Used by the demo workflow because 0G sealed inference doesn't yet serve our LoRA-adapted model (§10). The 0G Compute KeeperHub plugin still ships in §1's upstream PR so any future user can call 0G-served models.
6. **`web/`** - Minimal Next.js dashboard for the demo: deposit, view position, view risk score stream, withdraw button, FP-feedback toggle.

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
│   │ withdraw() │    │ 0G Storage   │    │ Self-hosted    │   │
│   │ executor   │    │ KV+Log SDK   │    │ inference      │   │
│   │            │    │              │    │ (Qwen2.5-0.5B  │   │
│   │            │    │              │    │  + LoRA, CPU)  │   │
│   └─────┬──────┘    └──────────────┘    └────────────────┘   │
└─────────┼────────────────────────────────────────────────────┘
          │
          ▼
   KeeperHub MCP ──── private routing ──► PhulaxAccount.withdraw(adapter)
```

Key invariants:

- **Agent never holds user funds.** Withdraws always route to `owner`. Enforced in the contract, not the agent.
- **Agent decisions are reproducible, not sealed.** 0G's sealed-inference surface does not currently serve our LoRA-adapted Qwen2.5-0.5B, so the classifier runs on a self-hosted endpoint. We replace TEE-sealed verifiability with **publish-and-replay**: merged LoRA weights live on 0G Storage, every `FIRE` writes `(input_hash, output, model_hash, signature)` to a 0G Storage Log, and the `ml/eval/` harness ships in the repo so anyone can replay. Weaker than sealed, but honest and defensible. See §10 + §15.
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
│   │   ├── og/             # 0G Storage client (+ Compute client, see §7)
│   │   ├── keeperhub/      # workflow defs + MCP client
│   │   ├── exec/           # withdraw executor
│   │   └── server.ts       # SSE feed for the UI
│   └── package.json
├── inference/              # self-hosted classifier endpoint
│   ├── server.py           # FastAPI + transformers (or llama.cpp HTTP)
│   ├── weights/            # merged LoRA, gitignored, fetched from 0G Storage
│   └── Dockerfile
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
  - `deposit(address adapter, uint256 amount)` - owner-only
  - `withdraw(address adapter)` - `owner || agent`; pulls from adapter; sends to `owner` *only*. Hard-coded recipient - no `to` parameter.
  - `setAgent`, `revokeAgent`, `setAdapter` - owner-only
  - `execute(target, data)` - owner-only escape hatch
- No upgradability. No `delegatecall`. Agent path uses a tiny fixed selector set.

**`Hub`** - registry: `register(account)`, `setRiskPolicy(thresholds)`, `linkINFT(tokenId)`. Events drive the UI.

**`PhulaxINFT` (ERC-7857)** - separate contract. Per-user token. Metadata pointer to 0G Storage CID containing `{policy, adapters, classifier_pointer, incident_log_cid}`.

**`FakeLendingPool`** - Aave-lite: `supply`, `borrow`, `withdraw`, oracle-priced. **Intentional vulns:** (a) single-block oracle manipulation via a manipulable getter, (b) reentrancy on `withdraw` that we leave open to demo a draining txn. Standard Aave-shape events (`Supply`, `Borrow`, `Withdraw`). **Not a KeeperHub protocol plugin** - it's just a deployed contract; its ABI is consumed inside workflows via `abi-with-auto-fetch` (§7.1). Verify the contract on the 0G testnet explorer at deploy time so auto-fetch works; ship the ABI JSON as a fallback in `contracts/abis/` for workflow paste-in.

**`FakePoolAdapter`** - normalises pool calls to `IAdapter.deposit/withdraw/balance`.

Tests:
- Forge fuzz: `PhulaxAccount.withdraw` cannot ever transfer to a non-owner address.
- Exploit replay: scripted draining txn against `FakeLendingPool`; assert account balance = 0 in pool but ≥ 99% of principal back to owner if agent fired in the same block.

---

## 6. Detection pipeline (concrete)

`detect(txCtx) -> { score: 0..1, signals: Signal[], attestation }`:

1. **Invariant tier** (synchronous, ~5ms). Pure TS, reads chain state via viem. Checks: monotonic share price, utilization ≤ 100%, totalSupply == reserves+borrows. Any violation → `score >= 0.6`.
2. **Oracle deviation** (synchronous). Pool price vs Chainlink + DEX TWAP. `|Δ| > 2%` → `score += 0.2`.
3. **Vector similarity** (~100ms). Embed `{calldata 4-byte + first-32-bytes of args, balance delta vector}`; cosine vs 0G Storage KV index. Top-1 ≥ 0.85 → `score += 0.3`.
4. **Fine-tuned classifier** (~300ms, **self-hosted endpoint** - see §10 + §15). Returns `p(nefarious)` plus a signed `(input_hash, output, model_hash)` receipt. Weighted into final score; receipt appended to the 0G Storage Log so any third party can replay.

Aggregator: weighted sum, clamped, with **early-exit short circuits** at tier 1 (don't burn classifier calls on obvious cases). Threshold default `0.7`, configurable via iNFT policy.

The whole pipeline is one TS function so it can be unit-tested with replayed exploit fixtures.

---

## 7. KeeperHub bridge work (Day 1, the hard part)

We **fork** keeperhub, do all the work in-tree, and open a PR back to `staging` once stable. The fork lives as the `keeperhub/` git submodule already wired into this repo. KeeperHub already exposes a set of slash commands (in `keeperhub/.claude/commands/`) that drive its own Blueprint pipeline (Orchestrator → Researcher → Builder → Verifier → PR). We use them - they're the cheapest path to lint-clean, type-safe, upstream-shaped code.

### 7.1 Slash-command mapping (which command does which piece)

| 0G integration piece | Command | Why this one |
|---|---|---|
| 0G chain support (RPC, signer, explorer, supported tokens) | **`/add-chain 0G`** | Exactly what it does - seeds `chains` + `explorer_configs` + `supported_tokens`, wires `lib/rpc/rpc-config.ts`, idempotent. |
| 0G Storage as workflow steps (`kvGet`, `kvPut`, `logAppend`) | **`/add-plugin 0g-storage`** | Credential-based plugin (storage endpoint + auth). Three actions, each a step file under `plugins/0g-storage/steps/`. |
| 0G Compute sealed inference (`sealedInference`) | **`/add-plugin 0g-compute`** - *shipped in upstream PR, not on the demo's hot path* | 0G sealed inference does not currently serve our LoRA-adapted Qwen2.5-0.5B, so the demo classifier runs on a self-hosted endpoint (§10). The plugin is still part of the upstream contribution so any KeeperHub user can call 0G-served models from a workflow. Single `sealed-inference` action with `maxRetries = 0`. |
| 0G chain tx signing from inside a workflow | **new action on existing `web3` plugin** (`/add-plugin` guidance: prefer extending `web3` over a new plugin when the infra is shared) | Once `/add-chain 0G` lands, web3's `chain-select` and tx-submit actions already work on 0G. No new plugin needed. |
| FakeLendingPool monitoring surface | **None - raw ABI in workflow fields** | We don't `/add-protocol`. The pool is our own demo contract, not a KeeperHub-supported protocol. Workflows reference it via the existing `abi-with-auto-fetch` field type (auto-fetched from explorer if verified, otherwise pasted in). Avoids polluting `protocols/` with demo-only artifacts that would block the upstream PR. |
| **Per-tx trigger** | **`Block` trigger + `web3/query-transactions` filter** - see §7.4 | No new trigger type. `Block` fires every block on 0G; `query-transactions` returns the decoded txs hitting our pool in that block. Detection folds across the array. Works against any contract address - no requirement on the target protocol. |

`/develop-plugin` is the lower-level inline-spec version of `/add-plugin`. We default to `/add-plugin` (Orchestrator-driven, better quality bar) and only fall through to `/develop-plugin` if the Orchestrator gets stuck.

`/suggest-workflows` is useful on Day 4 to sanity-check the per-tx detection workflow we wire up. Not a build dependency.

### 7.2 Day-1 execution order

1. `/add-chain 0G` - chain seed first; everything else depends on it being routable.
2. `/add-plugin 0g-storage` - KV + Log actions. Smoke-test from a throwaway workflow.
3. `/add-plugin 0g-compute` - sealed-inference action with `maxRetries = 0`. Ships in the upstream KeeperHub PR so any future workflow author can call 0G-served models. Our demo workflow doesn't route through it (our LoRA isn't 0G-served - see §10), but the plugin still gets a smoke-test workflow against any 0G-available base model.
4. **No new trigger work on Day 1.** `Block` trigger + `web3/query-transactions` covers per-tx-on-contract using existing primitives (§7.4).
5. **No `/add-protocol`** - FakeLendingPool stays as a deployed contract whose ABI is consumed in workflows via the existing `abi-with-auto-fetch` field type. Nothing lands in `protocols/`.
6. End-of-day: synthetic workflow on 0G testnet - `Block` trigger fires, `query-transactions` returns the block's pool-targeting txs, reads a KV from 0G Storage, calls the **self-hosted classifier endpoint** (HTTP step), and appends an entry to the 0G Storage Log. Green E2E.

### 7.4 Per-tx trigger - research findings + decision

KeeperHub today exposes five trigger types (`app/api/mcp/schemas/route.ts:132`, dispatchers in `keeperhub-scheduler/` + `keeperhub-events/`):

| Trigger | Mechanism | Fits per-tx? |
|---|---|---|
| `Manual` | UI/API call | No |
| `Schedule` | Cron | No |
| `Webhook` | HTTP | No |
| `Block` | `eth_subscribe("newHeads")` over WSS, fires every N blocks (`keeperhub-scheduler/block-dispatcher/chain-monitor.ts`) | Per-block - needs a follow-up step to enumerate txs |
| `Event` | `eth_subscribe` on a topic-filtered log filter (`keeperhub-events/event-tracker/src/listener/event-listener.ts`) | Per-event - only fires when a matching log is emitted |

**There is no native per-tx trigger.** What KeeperHub *does* have that closes the gap: the **`web3/query-transactions`** plugin step (`plugins/web3/steps/query-transactions-core.ts`). Given a contract address + block range, it returns the decoded transactions hitting that contract. That's the per-tx-on-contract primitive, just packaged as a step instead of a trigger.

**Decision: `Block` trigger + `web3/query-transactions` filter.** Pipeline shape:

1. `Block` trigger fires every block on 0G chain.
2. Step `web3/query-transactions` with `contractAddress = FakeLendingPool`, `fromBlock = toBlock = trigger.blockNumber`. Returns `0..N` decoded txs.
3. Detection pipeline runs across the array (invariants from chain state + oracle deviation + vector similarity + self-hosted classifier per tx; see §10). Aggregator returns the **max** score across txs in that block.
4. If `maxScore > threshold` → withdraw via KeeperHub MCP.

**Why this:**
- Works against **any** contract address. No assumption about target-protocol event design - Phulax can be pointed at a real deployed Aave/Morpho/whatever the same way it's pointed at our `FakeLendingPool`. The pitch loses the "we control the pool" caveat.
- `query-transactions` already decodes calldata, so detection sees `{functionName, args, value}` structured. Saves a manual decode step.
- Fan-out is not actually fan-out: a single Code-step or aggregator folds across the tx array (`max`/`some`). Withdraw is a binary decision, so no real iterator is needed.
- Uses only existing primitives. Zero new trigger plumbing on Day 1.

**Costs (acceptable):**
- One extra RPC round-trip (`eth_getBlockByNumber` inside `query-transactions`) on top of the `newHeads` notification - ~50–200ms. Withdraw lands next block either way.
- Empty-block work: every 0G block where nobody touches the pool, the workflow fires and gets an empty array back. Cheap on testnet, would matter on a hot chain.
- 0G testnet block time vs RPC latency: needs a Day-1 measurement to confirm we comfortably finish detection before the next block.

### 7.5 Fork hygiene

- All work lives on a feature branch in the fork: `feature/0g-integration`.
- Commits follow keeperhub's conventional-commit format (their `pr-title-check` enforces this on PRs to `staging`).
- Run `pnpm check && pnpm type-check && pnpm fix` before every commit (their pre-commit hook will block otherwise).
- `FEEDBACK.md` (strategy §9 deliverable) gets written into the fork at the same time and links to the open PR.
- PR to upstream `staging` is opened **after** the demo lands, not before - we don't want upstream review feedback on Day 4.

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
- Holds the agent signing key in env (KMS later; for the demo, a hot key with `withdraw`-only authority is fine - the contract enforces the blast radius).
- Exposes:
  - `GET /stream` - SSE of detection events
  - `GET /incidents/:account` - proxied from 0G Storage Log
  - `POST /feedback` - user marks a fire as FP; written to iNFT memory
- **No database.** 0G Storage is the database. This is also a story we tell.
- Deployed as a single Docker container behind Railway/Fly. Env: RPC URLs, KeeperHub API key, agent privkey, 0G endpoints.

---

## 10. ML pipeline (offline)

**Available model on 0G: `Qwen2.5-0.5B-Instruct`.** This is a 0.5B-parameter instruct model - tiny by LLM standards. That shapes the design:

- It is **not** strong enough for free-form risk reasoning ("explain whether this tx is suspicious"). Outputs would be unreliable and slow relative to signal.
- It **is** plenty for a **structured classifier head** - give it a tightly-templated prompt that asks for a single token (`SAFE` / `RISK`) or a JSON `{p_nefarious: <0..1>}`, and it can do that well after fine-tuning on a few hundred labelled examples.
- LoRA only on 0G's fine-tuning surface (full fine-tune not exposed; not needed at this dataset size anyway).
- **Serving: self-hosted, not 0G sealed inference.** 0G's sealed-inference surface does not currently serve our LoRA-adapted Qwen2.5-0.5B. We host the merged classifier ourselves - see "Inference serving" below.

Training pipeline (offline, laptop):

1. Curate ~200 labelled txns (50 nefarious from post-mortems, 150 benign from mainnet samples). Each row: `{calldata, decoded_args, balance_delta, label}`.
2. Build a fixed prompt template: system message defines the task; user message contains canonicalised tx features; expected assistant output is a single JSON object `{"p_nefarious": <0..1>, "tag": "<class>"}`.
3. Fine-tune `Qwen2.5-0.5B-Instruct` via 0G's fine-tuning surface. LoRA, rank 8 or 16, target attention + MLP projections; learning rate ~2e-4; 3–5 epochs.
4. **Merge LoRA into base weights** locally → single GGUF/safetensors artifact, ~700MB FP16 or ~400MB Q4-quantized.
5. Upload merged weights + tokenizer + config + the `ml/eval/` harness to 0G Storage. Record the CIDs in the iNFT metadata so the model used by every fire is publicly addressable.
6. Embeddings (separate from the classifier) - use a dedicated sentence-transformer (`all-MiniLM-L6-v2`) over `(calldata 4-byte, abi-decoded args canonicalised, balance-delta vector)`. Push to 0G Storage KV (key = exploit id, value = vector + metadata).
7. Eval harness: hold-out 20%; report precision/recall + latency; commit numbers to `ml/eval/REPORT.md`.

Target: ≥0.8 precision at ≥0.6 recall on the holdout. Below that we lean harder on invariants + oracle tier and demote the classifier to a supporting signal in the aggregator.

### Inference serving (self-hosted)

- **Stack:** FastAPI (Python) wrapping `transformers` directly, **or** `llama.cpp` HTTP server with the Q4-quantized GGUF. Pick whichever lands faster on Day 3 - both work. Default: `llama.cpp` server, single binary, no Python deps in the runtime image.
- **Hardware:** CPU is sufficient for 0.5B at our QPS (one fire per 0G block, low rate). No GPU needed. Co-locate with `agent/server.ts` on the same Fly/Railway box; or run a separate `inference/` container behind a private DNS name. Whichever is simpler.
- **Endpoint contract:** `POST /classify { features } -> { p_nefarious, tag, model_hash, input_hash, signature }`. The signature is HMAC-SHA256 over `(model_hash || input_hash || output)` with a per-deployment key. Not TEE-sealed - the operator could lie - but tampering is detectable and the 0G-published weights + eval harness mean any third party can replay any fire.
- **Workflow integration:** the KeeperHub workflow calls the endpoint via the existing **HTTP Request** system action. No new plugin needed for the demo. 
- **Reproducibility ledger:** every fire writes `(input_hash, output, model_hash, signature, weights_cid)` to a 0G Storage Log entry. This is the "sealed-inference replacement" - weaker than a TEE attestation but auditable.

**Fallback if Qwen2.5-0.5B underperforms after fine-tuning:** drop the classifier from the live path entirely, keep only invariants + oracle deviation + vector similarity. The strategy already calls vector similarity the headline novelty, so the demo narrative survives.

---

## 11. Day-by-day execution (mapped to STRATEGY §5)

**Day 1 - KeeperHub × 0G bridge.** §7 above. Owner: whoever knows KeeperHub internals best. Hard stop: end-of-day E2E demo of the synthetic workflow.

**Day 2 - Contracts + agent skeleton.** Foundry scaffold, contracts above with tests, agent stub that fires `withdraw` on a hardcoded condition through the bridge from Day 1. Local fork demo.

**Day 3 - Detection stack.** Invariants + oracle + embed corpus to 0G + LoRA fine-tune + **stand up `inference/` server with merged weights + signed-receipt endpoint** + risk aggregator + iNFT contract + mint flow. The KeeperHub workflow calls the inference endpoint via the existing HTTP Request action. End-of-day: crafted draining txn → agent withdraws within the same KeeperHub run, with the classifier receipt logged to 0G Storage.

**Day 4 - Execution polish + frontend.** KeeperHub MCP wiring, Twitter scraper (tiebreaker), Next.js UI (one screen), demo video, README, FEEDBACK.md, deploy. Open the upstream KeeperHub PR from our fork once the demo is recorded (not before).

Parallelism: Day 2 contracts and Day 3 ML work can start in parallel on Day 1 once the bridge shape is agreed. Frontend can start as a static mock on Day 2.

---

## 12. Risks specific to the build

- **0G SDK gaps.** If `@0glabs/0g-ts-sdk` is missing pieces we need (KV bulk ops, sealed-inference attestation parsing for the `0g-compute` plugin), we wrap raw HTTP + write the SDK fragment ourselves. Budget half a day for this on Day 1.
- **Self-hosted inference is a single point of trust.** Operator could lie about classifier output. Mitigated by publishing weights + eval harness to 0G Storage and writing signed receipts to a 0G Storage Log on every fire. Honest in the pitch: weaker than TEE-sealed, defensible via reproducibility. Stretch: re-route through 0G Compute once it serves our LoRA.
- **Inference latency on CPU.** Qwen2.5-0.5B Q4 should hit sub-second per call, but measure on Day 3. If too slow, drop to a smaller fine-tuned classifier (DistilBERT-class, ~70M params) - the templated single-label task is well within range.
- **KeeperHub per-tx trigger latency.** If end-to-end is > 1 block, the demo narrative still works (we say "next-block exit") but we'd prefer same-block. Measure on Day 1.
- **Fine-tune doesn't beat random.** Fallback: ship vector similarity + invariants only; classifier becomes a roadmap item. The strategy already calls vector-sim the headline; we're insulated.
- **iNFT (ERC-7857) tooling immature.** If the reference impl is rough, mint a minimal ERC-721 with the same metadata schema and call it "ERC-7857-shaped." Don't block on standards purity.

---

## 13. Resolved decisions (locked in 2026-04-25)

1. **Fork strategy:** work in a fork of keeperhub on `feature/0g-integration`, open PR to upstream `staging` after the demo is recorded. FEEDBACK.md ships in the fork at the same time.
2. **Live demo on 0G testnet:** confirmed - testnet funds already in hand. No need to record around faucet downtime.
3. **Classifier model:** `Qwen2.5-0.5B-Instruct` + LoRA. Use as a **structured classifier** (templated JSON output), not for free-form reasoning. See §10.
4. **Classifier serving:** **self-hosted, not 0G sealed inference.** 0G doesn't currently serve our LoRA-adapted weights. We host on CPU (llama.cpp + Q4 GGUF), publish merged weights + eval harness to 0G Storage, write signed receipts to a 0G Storage Log on every fire. The 0G Compute KeeperHub plugin still ships in the upstream PR for any user calling 0G-served models.
5. **Autonomous payment (x402 / MPP):** **cut from v1.** Agent gas paid from a hot key topped up with testnet funds; KeeperHub execution cost is ours since we're running our own fork. Keep as a one-line roadmap item in the README. Revisit only if a 0G/KeeperHub bounty specifically calls out x402 or MPP usage.

## 15. Still-open

- 0G testnet WSS endpoint stability for `eth_subscribe` - the existing `Block` and `Event` triggers use WSS subscriptions (`keeperhub-events/event-tracker/src/listener/event-listener.ts:78`, `keeperhub-scheduler/block-dispatcher/chain-monitor.ts`). If 0G testnet only exposes HTTP or has flaky WSS, we may need a polling fallback. Test on Day 1, parallel to `/add-chain`.
- Inference host: same Fly/Railway box as `agent/server.ts`, or a dedicated `inference/` container behind a private DNS name? Decide on Day 3 - depends on whether we can fit Qwen2.5-0.5B Q4 inside whatever instance class we pick for the agent. Default: same box, dedicated process, until measured otherwise.
- For the `/add-plugin 0g-compute` smoke-test workflow on Day 1, which 0G-available base model do we hit? Pick anything cheap that's exposed on testnet - purely to prove the plugin works end-to-end inside KeeperHub.

---

## Review section
*(filled in after each working session - what shipped, what surprised us, what to update in `STRATEGY.md`)*

### 2026-04-25 — Track A Day-1 bridge

**Shipped on `keeperhub/` submodule, branch `feature/0g-integration` (5 commits, local only):**

- **A1 chain seeds.** Both 0G Mainnet (16661, RPC `https://evmrpc.0g.ai`) **and** 0G Galileo Testnet (16601, RPC `https://evmrpc-testnet.0g.ai`) wired into `lib/rpc/rpc-config.ts` (`PUBLIC_RPCS.ZERO_G_*` + `CHAIN_CONFIG[16661]` + `CHAIN_CONFIG[16601]`) and `scripts/seed/seed-chains.ts` (DEFAULT_CHAINS + chainToDefaultIdMap + EXPLORER_CONFIG_TEMPLATES, Blockscout-family Chainscan). Symbol `0G`. jsonKeys `0g-mainnet` / `0g-testnet`. Mainnet shipped because `0g-compute` lets users target it from the start.
- **A2 `plugins/0g-storage`.** Three actions: `kv-get`, `kv-put` (`maxRetries = 0`), `log-append` (`maxRetries = 0`). Implementation evolved from raw HTTP-against-indexer to **on-chain Flow-contract writes signed by the org's KeeperHub wallet (Para or Turnkey)** via a shared `client-core.ts` (`buildReadContext` / `buildWriteContext` / `writeKvEntry` / `uploadBlob`). Defaults: indexer `https://indexer-storage-testnet-turbo.0g.ai`, KV node `http://3.101.147.150:6789`, Flow contract `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296` on Galileo. `requiresCredentials: false` — credentials override endpoints only. Uses `ethers` + `@0glabs/0g-ts-sdk` (the dep was added).
- **A3 `plugins/0g-compute`.** Single action: `sealed-inference` (file `steps/inference.ts`, `maxRetries = 0`). Calls 0G's serving broker, `acknowledgeProviderSigner` + chat-completion + `processResponse` verification. Returns `{output, model, provider, chatId, verified}`. `requiresCredentials: false` (org wallet signs). Per-deployment chain-id override only.
- **`plugin-allowlist.json`** lists `0g-storage` and `0g-compute`; `pnpm discover-plugins` regenerated types/step-registry/codegen-registry.
- **A4 / A6 workflow skeleton.** `specs/0g-integration/per-tx-detection.workflow.json` — `Block` -> `web3/query-transactions` -> `0g-storage/kv-get` -> `code/run-code` (calls self-hosted classifier) -> `0g-storage/log-append` -> condition -> `web3/write-contract`. Address slots (`{{TODO_FAKE_LENDING_POOL_ADDRESS}}`, `env.PHULAX_*`) wait on Track B6.
- **A5 measurement script.** `scripts/0g/measure-block-time.ts` — samples block-time, p50/p95 `eth_getBlockByNumber` latency, then probes WSS `eth_subscribe("newHeads")` stability. Env vars renamed to `CHAIN_0G_TESTNET_PRIMARY_{RPC,WSS}` to match the testnet jsonKey. **Not yet executed against testnet.**
- **Smoke-test recipes** at `specs/0g-integration/smoke-tests.md`.
- **A7 FEEDBACK.md** was drafted then dropped from the branch in this iteration; needs a redo against the SDK-backed implementation before the upstream PR.

**Verification:** `pnpm type-check` clean. `pnpm check` (lint) blocked locally on a `minimumReleaseAge` dlx fetch for `@biomejs/biome@2.4.13` — env issue. `plugins/` is biome-ignored anyway. Defer lint reconciliation until the lockfile/registry policy is sorted.

**What changed vs. the original brief:**
- We **kept the SDK** instead of wrapping raw HTTP. §12 risk #1 budgeted half a day for SDK gaps; in practice `@0glabs/0g-ts-sdk` round-trips for both Storage Flow writes and Compute serving-broker calls, so it earned the dep slot. `client-core.ts` keeps it isolated from `"use step"` files, which is what `plugins/CLAUDE.md` actually wants (no heavy deps *inside* step files — a separate core module is fine).
- **`requiresCredentials: false`** on both plugins, signing via the org's KeeperHub wallet. This is a much better story for the upstream PR than per-user private keys, and removes a class of secret-handling concerns from the Phulax demo. Accept as a strict improvement over the brief.
- Mainnet (16661) seeded alongside testnet at no extra cost.

**Open (still-to-verify):**
- WSS endpoint for 0G Galileo (`CHAIN_0G_TESTNET_PRIMARY_WSS`) — not yet identified. Existing `Block` / `Event` triggers depend on `eth_subscribe` (per `keeperhub-scheduler/block-dispatcher/chain-monitor.ts:*`). If 0G testnet is HTTPS-only, the trigger won't fire and we need a polling fallback (still-open §15).
- Block-time + RPC latency numbers — run `scripts/0g/measure-block-time.ts` once a WSS URL is known; numbers belong here.
- Day-1 green E2E: the workflow JSON skeleton exists but hasn't been imported into a KH dev project and run against testnet. Blocks on (a) a WSS URL, (b) Track B6's deployed FakeLendingPool address.
- Restore `keeperhub/FEEDBACK.md`, this time describing the SDK-backed shape and the org-wallet signing flow.

**No upstream PR.** Per §7.5 the PR to KeeperHub `staging` opens only after the demo is recorded.

**STRATEGY.md changes needed:** still none for the architecture. Worth a one-line note in §3 / §10 that 0G Storage writes go through the org's KeeperHub wallet via the Flow contract (not bearer auth), since it changes the threat-model story from "we hold a hot key" to "the workflow's signing wallet pays for the write".

