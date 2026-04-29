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

### 10.1 0G fine-tuning execution plan (concrete)

**Surface used:** `0g-serving-user-broker` (TypeScript) against the 0G Compute fine-tuning service. CLI is `0g-compute-cli fine-tuning ...`; we drive the same flow programmatically because the 48h acknowledgement deadline and the publish-and-replay receipt both need automation.

**Locked facts from the 0G docs (do not re-litigate):**

- Model = `Qwen2.5-0.5B-Instruct` (0.5 0G / Mtok). LoRA only.
- Dataset = JSONL, **Instruction/Input/Output** shape, UTF-8, ≥10 rows.
- Config schema is **rigid** — exactly `{neftune_noise_alpha, num_train_epochs, per_device_train_batch_size, learning_rate, max_steps}`. Decimal notation only. **No `fp16` / `bf16` flags.** Adding/removing keys breaks the job.
- Output is an **encrypted LoRA adapter** on 0G Storage. **48h hard deadline** to acknowledge; missing it costs 30% fee + the model.
- Decryption key is delivered on-chain encrypted with the user's pubkey; broker SDK handles decrypt locally.
- Storage reserve ≈ 0.01 0G for the 0.5B LoRA. Training fee ≈ `(tokens / 1M) * 0.5 * epochs`.

**Stage A — Data collection (`ml/data/`, Python).** Driven by `python -m data.build_dataset`.

1. Sources:
   - **Nefarious (~50)**: Rekt + SlowMist post-mortem tx hashes (oracle manipulation, reentrancy, flash-loan drains). Pull tx via RPC, decode calldata against the target ABI.
   - **Benign (~150)**: random sample of mainnet Aave/Compound `supply`/`withdraw`/`borrow` over the last ~1k blocks, plus pool-shape txs against our deployed `FakeLendingPool`.
2. Canonicalisation: `ml/data/canonicalize.py` — tx → `{selector, decoded_args, value, balance_delta, caller_history_score, oracle_dev_pct}`. **Must produce byte-identical output to `agent/src/detection/canonicalize.ts`** (the one-canonicaliser invariant). Sorted keys, `(",", ":")` separators, fixed precision.
3. Labelling: `ml/data/label.py` walks unlabeled rows; manual pass for ~200 rows is one sitting.
4. Emit JSONL using the frozen `ml/prompt/template.py` to render `instruction` (constant per `TEMPLATE_VERSION`), `input` (canonicalised features JSON), `output` (`{"p_nefarious": <0..1>, "tag": "<benign|oracle_manip|reentrancy|flashloan_drain|other>"}`).
5. 80/20 split. Holdout never goes to 0G — local eval only.
6. `ml/data/manifest.json`: `{rows, sha256(dataset.jsonl), label_distribution, schema_version, template_version, base_model: "Qwen2.5-0.5B-Instruct"}`. The sha is the dataset receipt anchored in the 0G Storage Log.

**Stage B — Job submission (`tools/finetune/`, new TS workspace).** Out of `agent/` to preserve the "only `withdraw.ts` signs" invariant. Add to `pnpm-workspace.yaml`. Uses a dedicated funding key (env: `PHULAX_FT_PRIVATE_KEY`) — never the agent's runtime key.

- `tools/finetune/src/discover.ts` — `broker.fineTuning.listProviders()` + `listModels()`. Print a table; user (or a `--auto-cheapest` flag) picks one. Selected provider/model pinned into `tools/finetune/run.json` for the rest of the job's lifecycle.
- `tools/finetune/src/fund.ts` — checks main account balance; if below `(estimatedTrainingFee + 0.01 storage + 10% headroom)`, calls `deposit()` and then `transferToProvider()`. Idempotent, safe to re-run.
- `tools/finetune/src/submit.ts`:
  1. Read `ml/data/dataset.jsonl` + `ml/data/manifest.json`.
  2. Upload dataset → `datasetHash`.
  3. Write the locked config:
     ```json
     {"neftune_noise_alpha": 5,
      "num_train_epochs": 3,
      "per_device_train_batch_size": 2,
      "learning_rate": 0.0002,
      "max_steps": 480}
     ```
     `max_steps` = `ceil(trainRows / batch) * epochs` capped; revisit after first run if loss plateaus early.
  4. `broker.fineTuning.createTask({ providerAddress, model, datasetHash, configPath })`.
  5. Persist `tools/finetune/run.json = { taskId, provider, model, datasetHash, configHash, datasetSha256, templateVersion, submittedAt, deadlineAt: submittedAt + 48h }`.
- `tools/finetune/src/poll.ts` — `getTask` loop with backoff until `Finished` or `Failed`. Structured logs.
- `tools/finetune/src/ack.ts` — downloads encrypted model, calls `acknowledgeModel`, then `decryptModel`. Writes `adapter.safetensors` into `ml/finetune/in/`. **Idempotent re-runs are safe.**
- `tools/finetune/src/safety-cron.ts` — separate process (or a `setTimeout` for the demo) firing 47h after `submittedAt`. If `run.json.acknowledgedAt` is unset, run `ack.ts`. Belt-and-braces against the 30% penalty.

**Stage C — Post-training (`ml/`, Python).**

1. `python -m finetune.merge_and_quantize` — PEFT `merge_and_unload` over `ml/finetune/in/adapter.safetensors` + base Qwen2.5-0.5B-Instruct → merged safetensors → `llama.cpp` Q4_K_M GGUF (~400 MB).
2. `python -m eval.harness` — runs holdout against the merged model using the **same `ml/prompt/template.py`** as training. Writes `ml/eval/REPORT.md` with precision/recall/latency. Gate: ≥0.8 precision @ ≥0.6 recall (§10).
3. `python -m upload.og_storage` — uploads `merged/`, `adapter.safetensors`, `dataset.jsonl`, `manifest.json`, `tools/finetune/run.json`, `eval/REPORT.md`. Records all CIDs into `ml/artifacts.json` (already the published handoff to Track D + iNFT metadata).
4. Append a single 0G Storage Log entry: `{kind: "model_publish", model_hash: sha256(GGUF), template_version, dataset_sha256, weights_cid, adapter_cid, eval_cid, provider, task_id, timestamp}`.

**Stage D — Runtime wiring (`inference/`).** Already stubbed. On real-weights load: log `model_hash = sha256(GGUF)` at boot, read `template_version` from `ml/prompt/template.py`, both flow into the per-fire `(input_hash, output, model_hash, signature)` receipt. No interface change for Track D / agent.

**Sequencing.** Stage A runs in parallel with Day-1 KeeperHub work (independent). Stages B–D land on Day 3 alongside the §10 work.

**Failure modes worth pre-empting:**

- Eval misses the gate → fall back per §10 paragraph above; do not gate the demo on the classifier.
- Provider fails the task → `run.json` retains `datasetHash`; re-run `submit.ts` against a different pinned provider with no re-upload cost.
- 48h deadline overrun → safety cron is the primary defence; the secondary defence is that `acknowledgeModel` is the same call whether triggered by us or the cron — no divergent code path.
- Config drift → `tools/finetune/src/submit.ts` validates the config object against a frozen schema before sending; rejects unknown keys (the 0G surface silently accepts and then fails training).

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

### 2026-04-25 — Track E (agent/) initial scaffold

**Shipped (E1–E8 all green):**
- `agent/` workspace: Node 20, viem, fastify, vitest, strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Narrow `PhulaxAccount` ABI exporting only `withdraw(adapter)` — single-selector enforcement at the type level. `FakeLendingPool` ABI inlined locally; will be regenerated from Track B's `wagmi.config.ts` once that lands.
- Detection split into pure tiers (`detection/{invariants,oracle,vector,classifier,detect}.ts`) with all I/O isolated in `detection/hydrate.ts`. `detect(ctx) → Score` is fully pure — covered by a purity test asserting repeated calls are deep-equal.
- Risk aggregator returns max-across-block per §7.4; iNFT-policy-driven threshold with paused override.
- 0G client wraps raw HTTP (`og/http.ts`) behind `kv.ts` + `log.ts` — single-file swap when `@0glabs/0g-ts-sdk` catches up (per §12 risk #1).
- KeeperHub: `Block` trigger + `web3/query-transactions` workflow spec + thin MCP client; per §7.4 no per-tx trigger from scratch.
- `exec/withdraw.ts` is the **only** module that signs; calldata is constructed in-module from the typed ABI fragment so external calldata can never reach the wallet.
- `server.ts`: `/stream` (SSE), `/incidents/:account`, `/feedback`, `/detect-batch` (KeeperHub callback). No DB.
- 7 fixture replays in `test/fixtures/exploits.ts` covering each tier + 2 negative-control fixtures (vector-only / classifier-only must NOT fire alone). 9/9 vitest tests green; `tsc --noEmit` clean.

**Decisions deviating from / refining the doc:**
- Invariant tier weighted at **0.8**, not 0.6. Spec says "≥0.6" but threshold default is 0.7 — invariants are mathematically decisive when they break, so 0.8 puts them comfortably above threshold. Kept the "≥0.6" spec promise as a floor in the comments. This is the one place the dispatch-prompt numbers needed adjusting to actually fire.
- Classifier weight: `(p_nefarious − 0.5) × 0.8`, capped so a classifier alone (even at p=0.99 → 0.392) cannot single-handedly cross 0.7. Forces corroboration with at least one other tier — defensible since the classifier is the noisiest signal.
- `TxContext` carries already-hydrated invariant snapshots, oracle reads, vector match, and classifier receipt. Hydrator (`hydrate.ts`) does all I/O upstream so any fixture can be replayed offline with no mocks.

**Surprises / follow-ups:**
- Track B's `wagmi.config.ts` not yet present in this worktree — agent's ABI is currently hand-rolled to match §5 contract shape. Swap when Track B B8 lands (one file: `src/abis/FakeLendingPool.ts`).
- 0G Storage HTTP shim assumes a REST endpoint at `OG_STORAGE_URL`. If 0G Storage SDK only exposes a binary protocol, `og/http.ts` becomes the swap point — keep that file isolated.
- `RawTx` shape in `hydrate.ts` matches what KeeperHub `query-transactions` should emit (hash, blockNumber, from, to, value, input). Track A may emit a slightly different shape; if so, conversion lives in `server.ts:toRaw` — single point of contact.
- Withdraw calldata is also built into the workflow spec (`buildPerBlockDetectWorkflow`) so KeeperHub can fire the tx server-side as a fallback if the agent server is down. The agent's hot-key path is the primary; KeeperHub's MPC-key path is the backup.

**Nothing to change in `STRATEGY.md`** — the build matches §3 architecture diagram and §8 scope cuts.

### 2026-04-25 - Track C (ml/) scaffold

**Shipped:**
- Full `ml/` tree under `uv` (`pyproject.toml`, `.env.example`, `.gitignore`, `README.md`).
- Dataset builder (`ml/data/`) emits 210 rows = 60 RISK (15 curated public post-mortems × 3 jittered augmentations) + 150 synthetic benign mainnet-shape rows. Schema per row: `{id, selector, fn, decoded_args, balance_delta, context, source, label}`. Verified by running `python3 -m data.build_dataset` → `data/dataset.jsonl`.
- Frozen prompt template (`ml/prompt/template.py`, `TEMPLATE_VERSION=1.0.0`). Single source of truth for fine-tune + eval + Track D inference. Imports cheap; bumping the version invalidates published weights.
- LoRA fine-tune script (`ml/finetune/lora.py`) - rank 16, α 32, dropout 0.05, target attention + MLP projections, lr 2e-4, 3 epochs, seed 1337. Auto-routes to 0G fine-tuning surface when `OG_FT_ENDPOINT` is set, otherwise local transformers + peft.
- Merge + Q4 quantize (`ml/finetune/merge_and_quantize.py`) - merges adapter into base, exports safetensors + Q4_K_M GGUF via llama.cpp. Skips quantize cleanly if `LLAMA_CPP_DIR` unset.
- Embeddings indexer (`ml/embed/index.py`) - `all-MiniLM-L6-v2`, 384-dim, pushes to 0G Storage KV with key `phulax/exploit/<id>` and writes a manifest at `artifacts/embeddings_index.json`.
- 0G Storage HTTP client shim (`ml/og_client.py`): `kv_put`, `upload_file`, `upload_dir`. Env-driven so it can be redirected to a mock in CI.
- Eval harness (`ml/eval/harness.py`) - 80/20 split (deterministic), supports two modes: local merged model (`MODEL_DIR`) or remote endpoint (`INFERENCE_URL`). Writes `eval/REPORT.md` with confusion matrix, P/R/F1, p50/p95/max latency, and an explicit PASS/FAIL verdict against the ≥0.8 P / ≥0.6 R target. Includes a "Reproducibility" section so a third party with only the CIDs can replay.
- Upload manifest builder (`ml/upload/og_storage.py`) - uploads merged weights, GGUF, dataset, embeddings index, eval report, and the harness sources themselves; writes `ml/artifacts.json` keyed for Track D + iNFT metadata to consume.

**Not yet run (need credentials/compute the worktree doesn't have):**
- Actual LoRA fine-tune. Code path is exercised but a real run needs either `OG_FT_ENDPOINT` or a GPU box.
- 0G Storage uploads. Need `OG_STORAGE_ENDPOINT` + token.
- `eval/REPORT.md` therefore not yet generated; the harness will produce it once a model is available.

**What surprised us:**
- The 50/150 split is published as "~200 rows" - I produced 60/150 = 210 because the 15 curated post-mortems × 3 augmentations naturally lands at 60. Slightly more nefarious examples than spec; documented as "~200" range. Class imbalance (≈29% RISK) is on purpose and matches the deployment distribution better than 50/50.
- Most exploit post-mortems do not preserve full calldata. The dataset stores **structural fingerprints** (selector + decoded args bucketed to magnitudes + balance-delta vector), not raw calldata. This matches what the agent's detection pipeline actually sees at inference time, so train/serve skew is minimised. Callout in `ml/data/exploits.py` docstring.
- `prompt/template.py` is referenced from three places (fine-tune, eval, Track D inference). Made it the single import source and versioned it explicitly so any change forces a re-train.

**Suggestions for `STRATEGY.md`:**
- §2(b) currently says "fine-tune a model on 0G over a labelled corpus". Worth tightening to "LoRA-only fine-tune of Qwen2.5-0.5B-Instruct as a structured classifier" - matches the locked decision in §13.3 of this doc and the actual pipeline shape.
- §5 Day 3 ML bullet could link directly to `ml/README.md` for the run order instead of restating it.

**Handoff to Track D:**
- Track D should `import` from `ml/prompt/template.py` (or re-implement byte-for-byte against `TEMPLATE_VERSION`) to avoid skew.
- `ml/artifacts.json` (once populated) is the single source of CIDs for Track D and the iNFT `classifier_pointer`.

### 2026-04-25 — Track A Day-1 bridge

**Shipped on `keeperhub/` submodule, branch `feature/0g-integration` (5 commits, local only):**

- **A1 chain seeds.** Both 0G Mainnet (16661, RPC `https://evmrpc.0g.ai`) **and** 0G Galileo Testnet (16602, RPC `https://evmrpc-testnet.0g.ai`) wired into `lib/rpc/rpc-config.ts` (`PUBLIC_RPCS.ZERO_G_*` + `CHAIN_CONFIG[16661]` + `CHAIN_CONFIG[16602]`) and `scripts/seed/seed-chains.ts` (DEFAULT_CHAINS + chainToDefaultIdMap + EXPLORER_CONFIG_TEMPLATES, Blockscout-family Chainscan). Symbol `0G`. jsonKeys `0g-mainnet` / `0g-testnet`. Mainnet shipped because `0g-compute` lets users target it from the start. **Note:** the testnet chain id was originally seeded as 16601 and migrated to 16602 by 0G; the seeds (and this entry) are now correct, but historical commits and downstream references may still say 16601.
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

### 2026-04-25 — Track F (web/) Phase 1: static mock

**Shipped** (F1 + F2 of `tasks/agents/track-f-web.md`):
- Scaffolded `web/` as a standalone Next.js 14 App Router app (Tailwind, shadcn-style primitives in `components/ui/`, wagmi v2 + viem + react-query providers, 0G testnet chain wired with injected connector).
- One-screen dashboard at `app/page.tsx`: connect bar (PhulaxAccount + position), deposit/withdraw card (stubs), live risk gauge with threshold marker + per-signal weights, terminal-styled streaming log panel, FP-feedback toggle, incident timeline.
- Fake stream lives in `lib/mock.ts`. A `setInterval` on the client pushes ~1 event/sec, plus a "Demo: simulate attack" button that drops the canonical FIRE sequence (invariant violation → vector match → classifier → aggregator → KeeperHub exec → receipt) into the log and prepends an incident.
- `pnpm install` clean, `pnpm type-check` clean, `pnpm build` succeeds, `pnpm dev` serves 200 with all five panel headings rendered in SSR HTML.

**Surprises:**
- `wagmi/connectors` is a barrel that pulls the MetaMask SDK + WalletConnect / pino-pretty modules even when you only use `injected()`. Build emits non-fatal "Module not found" warnings for `@react-native-async-storage/async-storage` and `pino-pretty`. Standard wagmi v2 noise; left as-is.
- Worktree had no root `package.json` / `pnpm-workspace.yaml` yet, so `web/` is currently a standalone pnpm project. When the monorepo lands (todo §4), `web/` slots in as a workspace member with no code changes.

**Deferred to Phase 2** (after Track B6 deploys + B8 emits ABIs): F3 wallet/account reads via generated `wagmi.config.ts`, F4 deposit/withdraw wired to `PhulaxAccount`.

**Deferred to Phase 3** (after Track E7 ships SSE): F5 real `/stream` EventSource, F6 `/incidents/:account` proxy, F8 `POST /feedback` from the toggle. Swap-points are commented in `app/page.tsx` and `components/feedback-toggle.tsx`.

**Nothing to change in `STRATEGY.md`** — §8 ("no fancy frontend") and §6 (demo script) match what's built. The streaming log panel is the credibility moment per todo §8.

### 2026-04-25 — Track D, Phase 1 (stub) shipped

**Shipped:**
- `inference/server.py` — FastAPI `POST /classify` + `GET /healthz`. Returns the full real-shape response: `{p_nefarious: 0.0, tag: "stub", model_hash: "stub", input_hash, signature}`.
- `input_hash = sha256(canonical_json(features))` — keys sorted, no whitespace. Same `features` from any caller produces the same hash; verified by test.
- `signature = HMAC-SHA256(PHULAX_INFERENCE_HMAC_KEY, model_hash || input_hash || canonical_json(output))`. Key has no in-image default; must be supplied at runtime.
- `inference/Dockerfile` — `python:3.11-slim`, deps pinned in `requirements.txt`. Reproducible today; Phase 2 will add a stage that fetches CIDs from `ml/artifacts.json` at build/boot and rehashes weights into `PHULAX_MODEL_HASH`.
- `inference/test_server.py` — 4 tests, all passing: healthz, response shape, canonical-hash determinism, end-to-end signature verification with the exact HMAC payload Track E will use to verify ledger entries.

**Checklist status:**
- [x] D1. Stub endpoint live with correct response shape — Track A unblocked.
- [ ] D2. Stack decision (llama.cpp vs FastAPI) — **tentatively FastAPI+transformers** for Phase 2 (single language with the stub, fewer moving parts), but keeping the option to swap in `llama.cpp` HTTP behind the same FastAPI proxy if CPU latency on Q4 GGUF is materially better. Will lock once we have a real merged GGUF to benchmark.
- [ ] D3–D6 — Phase 2, blocked on Track C7 publishing CIDs in `ml/artifacts.json`.

**Surprises / notes:**
- Pydantic v2 reserves the `model_` namespace, so `model_hash` field name collides. Resolved with `ConfigDict(protected_namespaces=())` rather than renaming, because the wire shape is locked by the contract in §10.
- Canonical JSON (sorted keys, `(",", ":")` separators) needs to be the *same* on the agent side when it independently recomputes `input_hash` for the 0G Storage Log entry. Worth flagging to Track E so we don't end up with two slightly different canonicalisers.
- Track A integration: the workflow calls this via KeeperHub's existing **HTTP Request** system action (todo §10) — no new plugin needed. Endpoint URL + HMAC key go in workflow secrets.

**For Track E (reproducibility ledger):** the agent process should be the one writing the 0G Storage Log entry per fire (`input_hash, output, model_hash, signature, weights_cid`). The inference server intentionally does *not* write the log itself — keeps it stateless and avoids double-logging.

### 2026-04-25 — Track B contracts scaffold

Shipped (all in `contracts/`):

- Foundry project (`foundry.toml`, `remappings.txt`, `package.json`, `.gitignore`, `README.md`).
- `pnpm-workspace.yaml` at repo root including `contracts/`, `agent/`, `web/`, `keeperhub`.
- Solidity sources:
  - `src/PhulaxAccount.sol` — `withdraw(adapter)` is the only agent-callable selector and routes hard-coded to `owner`. `setAgent`, `revokeAgent`, `setAdapter`, `execute`, `deposit` all `onlyOwner`.
  - `src/Hub.sol` — registry + risk policy, events drive UI.
  - `src/inft/PhulaxINFT.sol` — ERC-7857-shaped (minimal ERC-721, metadata pointer to 0G CID).
  - `src/adapters/IAdapter.sol`, `src/adapters/FakePoolAdapter.sol`.
  - `src/pools/IFakeLendingPool.sol`, `src/pools/FakeLendingPool.sol` — both vulns wired (open `setAssetPrice`, CEI-violating `withdraw`). Aave-shape `Supply`/`Borrow`/`Withdraw` events. Not in `keeperhub/protocols/`.
- Tests:
  - `test/PhulaxAccount.fuzz.t.sol` — `testFuzz_withdrawAlwaysToOwner` over fuzzed caller/recipient/payout; `test_agentCanOnlyCallWithdraw` checks each non-`withdraw` selector reverts with `NotOwner` when called by the agent.
  - `test/PhulaxAccount.invariant.t.sol` — invariant fuzz: no non-owner ever holds the asset.
  - `test/ExploitReplay.t.sol` — drain succeeds and victim withdraw reverts when Phulax absent; agent firing first recovers ≥99% of principal.
- `script/Deploy.s.sol` — deploys Hub, INFT, FakeLendingPool, optional adapter+account; targets 0G testnet via `foundry.toml` `[rpc_endpoints]` + `[etherscan]` blocks.
- `scripts/extract-abis.mjs` — emits `abis/*.json` paste-in fallback for KeeperHub `abi-with-auto-fetch`.
- `wagmi.config.ts` — outputs typed ABIs at `generated/wagmi.ts` for Tracks E and F.

Not run: `forge install`, `forge build`, `forge test`, `forge script` — Foundry isn't installed in the sandbox and the `curl | bash` install was denied. First action when Foundry is available locally: `forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts && forge test -vv`.

Surprises:

- KeeperHub `web3/query-transactions` (per `tasks/todo.md` §7.1, §7.4) decodes calldata, so the only thing the demo pool *must* preserve are Aave-shape event topics — easy. No need to touch any KeeperHub plugin from this track.
- `forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts` is the only external dep; OZ v5 `_requireOwned` is the right shape for `tokenURI` now (used in `PhulaxINFT`).

### 2026-04-25 — Cross-track status snapshot

All six tracks (A keeperhub-0g, B contracts, C ml, D inference, E agent, F web) have landed Phase-1 scaffolds locally. The pieces are independently green (typecheck / unit tests where applicable), but **nothing has been wired end-to-end on 0G testnet yet**. What stands between us and a recorded demo:

**Hard blockers (must land before E2E)**
1. **0G Galileo WSS endpoint** — Track A's `Block` trigger depends on `eth_subscribe("newHeads")`. URL still unknown (§15, A-review). If WSS isn't available, drop in a polling `chain-monitor` fallback before A5 measurements can run.
2. **`forge install` + deploy** — Track B's contracts are unbuilt; need Foundry locally, then `forge script Deploy.s.sol --rpc-url 0g_testnet --broadcast` to get FakeLendingPool / Hub / PhulaxAccount addresses. Those addresses unblock Track A workflow JSON (`{{TODO_FAKE_LENDING_POOL_ADDRESS}}`) and Track F Phase 2.
3. **LoRA fine-tune run** — Track C is fully scripted but needs either `OG_FT_ENDPOINT` credentials or a GPU box; until it runs, no `eval/REPORT.md`, no merged weights CID, no Track D Phase 2.

**Sequenced follow-on work**
4. Track D Phase 2: swap stub for real merged weights once Track C publishes `ml/artifacts.json`. Bench Q4 GGUF latency on the target Fly/Railway instance to lock the FastAPI-vs-llama.cpp decision (D2).
5. Track E ABI swap: replace hand-rolled `FakeLendingPool` ABI with Track B's `generated/wagmi.ts` (single-file change, noted in E review).
6. Track A end-of-day E2E: import `per-tx-detection.workflow.json` into a KH dev project, fill in deployed addresses + inference URL + HMAC, fire one synthetic block, confirm KV read + classifier call + log-append + (optional) `write-contract`.
7. Track F Phase 2 + 3: wire wallet/account reads (post-B8) and real SSE `/stream` (post-E7).
8. Restore `keeperhub/FEEDBACK.md` against the SDK-backed shape; queue upstream PR for **after** the demo recording (per §7.5).

**Demo-script gaps** (STRATEGY §6 / todo §8)
- Twitter scraper (Day-4 tiebreaker) — not started; defer unless time permits.
- Demo video + README polish — last-day work.
- Mint flow for `PhulaxINFT` — contract exists, but no script wires `mint(owner, cid)` against the published `ml/artifacts.json` CIDs yet.

**Threat-model line to add to STRATEGY.md** (per Track A review): 0G Storage writes are signed by the org's KeeperHub wallet via the Flow contract on Galileo (`0x22E0…5296`), not bearer auth. Changes the hot-key story from "we hold one" to "the workflow's signing wallet pays for the write" — strictly better for the pitch.

**No code changes in this entry** — pure status synthesis to make the next session's first move obvious.

### 2026-04-26 — Foundry installed; first `forge test` exposes Track B bugs

**Setup:**
- Installed Foundry locally (`forge 1.5.1-stable`, commit `b0a9dd9`).
- `forge install --no-git foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts` (no-git because we're inside a `.dmux` git worktree where submodule pathspec resolution fails — vendored under `contracts/lib/` instead).
- `forge build` clean: 0 errors, only `screaming-snake-case-immutable` style notes (cosmetic).

**`forge test -vv` results — 3 pass / 2 fail:**

✅ `PhulaxAccount.fuzz.t.sol::testFuzz_withdrawAlwaysToOwner` — 512 fuzz runs, owner-only recipient invariant holds.
✅ `PhulaxAccount.fuzz.t.sol::test_agentCanOnlyCallWithdraw` — every non-`withdraw` selector reverts `NotOwner` from agent.
✅ `PhulaxAccount.invariant.t.sol::invariant_withdrawAlwaysToOwner` — 512 runs / 256 000 calls / 0 reverts.

❌ `ExploitReplay.t.sol::test_exploit_agentFiresFirst_recovers99pct` — `FakeLendingPool::withdraw` reverts `"exceeds balance"`.
   - **Root cause: bookkeeping key mismatch.** `FakePoolAdapter.deposit` calls `pool.supply(asset, amount, onBehalfOf = msg.sender = PhulaxAccount)` (`FakePoolAdapter.sol:29`), so `supplied[PhulaxAccount][asset]` holds the position. But `pool.withdraw` decrements `supplied[msg.sender][asset]` (`FakeLendingPool.sol:69`), and `msg.sender` at withdraw time is the adapter, not the PhulaxAccount. Adapter's `supplied` slot is 0, so the require trips.
   - **Fix options (Track B owner to pick):**
     1. Add `onBehalfOf`/`from` parameter to `pool.withdraw` (Aave V3 doesn't, but our pool already deviates), with an auth map so PhulaxAccount can pre-authorize the adapter.
     2. Have the adapter own the supplied position: change `FakePoolAdapter.deposit` to `pool.supply(..., onBehalfOf = address(this))`, read `pool.balanceOf(asset, address(this))` in `withdrawAll`. Implies one adapter instance per user (acceptable for the demo since `setAdapter` is per-account).
     3. Skip the adapter for withdraw and have `PhulaxAccount.withdraw` call `pool.withdraw` directly. Breaks the `IAdapter` shape — not recommended.

❌ `ExploitReplay.t.sol::test_exploit_drainSucceedsWithoutPhulax` — `pool.borrow` reverts `"undercollateralised"`.
   - **Root cause: single-asset oracle exploit is mathematically a no-op.** The collateral check (`FakeLendingPool.sol:54`) computes both `collateralValue = supplied * price / 1e18` *and* `borrowedValue + amount * price / 1e18` against the same `price[asset]`. Inflating price scales numerator and denominator equally, so the inequality is unchanged. Attacker has 1 USD of collateral; can never borrow more than 0.8 USD regardless of oracle.
   - **Fix options (Track B owner to pick):**
     1. **Two-asset world** (recommended): mint a separate `WETH` mock, have the attacker supply WETH as collateral, borrow USD against it. Inflate WETH's price → collateral value spikes while USD borrow side stays denominated in USD. Matches real oracle-manipulation drains and gives the demo two-asset realism.
     2. **Asymmetric pricing**: treat the borrow amount as raw token units (don't multiply by `price`), and only oracle-price the collateral. Cheaper, but less realistic.

**What this means for status:**
- Foundry plumbing is unblocked: builds, runs, fuzzer + invariant happy paths verified across ~256 500 randomized calls. The strongest invariant in the system (`PhulaxAccount` cannot pay non-owner) is now empirically validated.
- The exploit-replay narrative — the *demo* — is currently broken. Track B needs the two fixes above before deployment. Until then, the agent has nothing meaningful to defend against in tests.
- No 0G testnet deploy yet; that step now sequences after the Track B fixes (no point deploying contracts whose demo path doesn't execute).

**Files touched this session:** none. Only `contracts/lib/` populated by `forge install`. `checklist.md` updated to record the result.

**Next move for Track B owner:** pick fix option 2 for the bookkeeping bug + fix option 1 for the oracle drain. Estimated <1h. After that, re-run `forge test -vv`, then move to `forge script Deploy.s.sol --broadcast`.

### 2026-04-26 — Track B fixes + green test suite

**Shipped (all 5 tests now PASS):**

- `contracts/src/adapters/FakePoolAdapter.sol` — adapter is now the supplier of record at the pool. `pool.supply(..., onBehalfOf = address(this))` + per-PhulaxAccount internal `_supplied` mapping (incremented on `deposit`, zeroed on `withdrawAll`). `withdrawAll` calls `pool.withdraw(asset, bal, msg.sender)` so the underlying lands on the calling PhulaxAccount, which then sweeps to owner per existing `PhulaxAccount.withdraw` flow.
- `contracts/src/pools/FakeLendingPool.sol` — `borrow` now uses **asymmetric pricing**: collateral side is oracle-priced, borrow amount is treated as token units. Inflating `price[asset]` scales collateral up while leaving the borrow side fixed, which is what makes single-asset oracle-manipulation drains land. Comment explicitly calls out the Mango/Cream parallel to head off "is this a real exploit shape" pushback during demo.
- `contracts/test/ExploitReplay.t.sol` — one-line update: `victimSupplied` now reads from `adapter.balanceOf(acct)` instead of `pool.balanceOf(usd, acct)`. Reflects the new ownership model where the adapter holds the position at the pool layer.

**`forge test -vv` final result:** 5/5 pass.
- `PhulaxAccount.fuzz` — 512 runs, owner-only recipient invariant holds.
- `test_agentCanOnlyCallWithdraw` — agent can't reach any non-`withdraw` selector.
- `PhulaxAccount.invariant` — 512 runs / 256 000 calls / 0 reverts.
- `test_exploit_drainSucceedsWithoutPhulax` — attacker drains 99% of pool reserves, victim's withdraw reverts, principal stuck.
- `test_exploit_agentFiresFirst_recovers99pct` — agent fires first, victim recovers ≥99% of principal, attacker's follow-up borrow fails.

**Design knock-on:** the adapter→pool ownership change has a property worth noting for Track E. The detection pipeline reads pool state via viem; `pool.balanceOf(asset, user)` for a Phulax-protected user now returns 0 (because the adapter owns the position). Anything in `agent/src/detection/hydrate.ts` that wants "this user's pool position" must read `adapter.balanceOf(account)` instead. Phulax's `PhulaxAccount.deposit/withdraw` flows are unchanged.

**Proposed additional exploits to demo** (waiting on owner OK before implementing — see `checklist.md` "Proposed additional exploits" section). Recommendation: do A (reentrancy) + B (flash-loan oracle), skip C/D unless time permits. Together A+B cover three distinct detection signals (reentrancy invariant violation, huge in-block balance delta, oracle deviation magnification) and exercise three of the four pipeline tiers without overhauling the pool design.

**Files touched this session:** `contracts/src/adapters/FakePoolAdapter.sol`, `contracts/src/pools/FakeLendingPool.sol`, `contracts/test/ExploitReplay.t.sol`. `checklist.md` updated.

### 2026-04-26 — Track B exploit suite expanded to five vulns / 11 tests

**Shipped — pool now has five intentional vulns, each backed by a working drain test:**

| # | Vuln                          | Test file (added this session)         | Pool addition                                  |
|---|-------------------------------|----------------------------------------|------------------------------------------------|
| 1 | Open-oracle borrow drain      | `ExploitReplay.t.sol` (existing)       | (existing — `setAssetPrice` open)              |
| 2 | Reentrancy via hook-token     | `ExploitReentrancy.t.sol`              | (existing CEI violation in `withdraw`)         |
| 3 | Flash-loan amplified drain    | `ExploitFlashLoan.t.sol`               | (none in pool — separate `FlashLender` mock)   |
| 4 | Liquidation via oracle crash  | `ExploitLiquidation.t.sol`             | new `liquidate(user, asset)`                   |
| 5 | Admin reserve sweep           | `ExploitAdminRug.t.sol`                | new `withdrawReserves(asset, to)` admin-only   |

**Pool / interface changes:**
- `FakeLendingPool` gained `LIQUIDATION_THRESHOLD_BPS = 8500`, `admin` (set in constructor to `msg.sender`), `liquidate`, `withdrawReserves`, and a `borrowedOf` view. Custom errors: `NotAdmin`, `NoDebt`, `Healthy`.
- `IFakeLendingPool` extended to match — the new `liquidate` and `withdrawReserves` selectors are part of the official surface so KeeperHub `web3/query-transactions` decoding picks them up automatically (no ABI overrides needed).
- New events: `Liquidate(reserve, user, liquidator, seized, repaid)`, `ReservesSwept(reserve, by, to, amount)`. Standard Aave-shape topic ordering, indexed in three slots so KeeperHub log filters can match by reserve / user / liquidator.

**Test infra added (under `contracts/test/mocks/`):**
- `MockHookToken` — ERC20 + ERC777-style `tokensReceived` callback on the destination address. Hook is best-effort (`try/catch`) so a reverting receiver doesn't brick transfers. Used by `ExploitReentrancy`.
- `FlashLender` — separate flash-loan source. Holds asset reserves, lends with no fee, requires balance-restored invariant. Has to be separate from `FakeLendingPool` because the lending pool itself is the drain target during the callback — using the pool as both source and target would violate the lender's balance-restored check.

**Test details worth flagging:**

- `ExploitReentrancy::test_exploit_reentrancyDrainsTwiceTheSupply` — attacker supplies 50 hookTokens, calls `attack(50)` once. The hook fires inside `pool.withdraw`'s `safeTransfer` leg, attacker's `onTokensReceived` re-enters `pool.withdraw` while `supplied[attacker]` is still un-decremented, second withdraw also passes the require, drains another 50. Final state: attacker EOA holds 100 tokens, pool reserves are 50, victim's bookkeeping still says 100 supplied — pool insolvent.
- `ExploitFlashLoan::test_exploit_flashLoanZeroCapitalDrain` — attacker EOA starts with 0 capital, ends with 100e18. Flow: borrow 500e18 from `FlashLender` → supply 1e18 dust to pool → `setAssetPrice` to 1e24 → borrow pool's full 101e18 reserves → repay 500e18 to lender → forward residual to attacker EOA. Dust must be `1e18`, not `1 wei`: with `inflatedPrice = 1e24` and CF = 80%, `1e18 * 1e24 / 1e18 * 0.8 = 8e23` of borrow capacity (way more than any plausible pool); `1 wei` only yields `1e6` capacity which fails the require.
- `ExploitLiquidation` has a guard test (`test_position_isHealthyAtFairPrice` — liquidate reverts with `Healthy` selector at price 1e18) plus the drain test (price drops to 0.4e18, attacker pays 50, seizes 100 collateral). Liquidator's profit is the spread between depressed-oracle price and real-market value of seized tokens — same shape as Solend.
- `ExploitAdminRug` includes a guard test (`test_nonAdmin_cannotSweepReserves` — reverts with `NotAdmin`) plus the drain (admin sweeps pool reserves to attacker, supplier's later withdraw reverts).

**`forge test -vv` final result:** 11/11 across 7 suites.

**Surprises:**
- Initial reentrancy test asserted on the EOA (`ATTACKER`) but the loot landed on the attacker *contract*. Fix: `ReentrancyAttacker.attack` now forwards its post-drain balance to `msg.sender` (test calls under `vm.prank(ATTACKER)`). Same pattern is now reusable for any future on-chain attacker fixture.
- Initial flash-loan test used `1 wei` of dust collateral and tripped the `borrow` require. Took one debug pass to realise the asymmetric pricing means dust collateral has to clear `borrow_amount * 1e18 * 10000 / (price * 8000)` token-units. With reserves of 100e18 and price of 1e24, dust must be `≥ 1.25e23 / 1e24 ≈ 0.125e0` — 1 token (1e18 wei) is the natural choice.
- `MockHookToken._update` had to use `try/catch` around the receiver call. Without it, any non-implementing recipient (e.g. `FakeLendingPool` itself when supply transfers tokens to the pool) would brick the transfer.

**Detection-pipeline implications for Track E:**
- `agent/test/fixtures/exploits.ts` currently has 7 fixtures, all variants of vuln #1 (oracle borrow drain). To prove the agent generalises, need ~4 more fixtures — one per new vuln. Each fixture is a `TxContext` shape, replayable through the pure `detect()` function.
- Detection-tier mapping (use to write the fixtures):
  - **Vuln #2 (reentrancy):** invariant tier — sum of `Transfer` event amounts in the tx exceeds `supplied[user]` immediately before the tx. Pure check from chain-state snapshot.
  - **Vuln #3 (flash-loan drain):** vector tier — calldata-fingerprint similarity to known flash-loan exploit shapes (cosine ≥ 0.85 against the `ml/embed/index.ts` corpus). Also fires the oracle tier on the in-tx `setAssetPrice` event.
  - **Vuln #4 (oracle crash + liquidate):** oracle tier in the *inverse* direction (negative deviation) + classifier tier (the `liquidate(address,address)` selector with a fresh-price-write in the same tx is a strong fingerprint).
  - **Vuln #5 (admin rug):** classifier tier — `withdrawReserves(address,address)` selector + recipient that's neither the user-known treasury nor a previously-interacted contract. Not catchable by invariants alone since the math is consistent; this is the case that justifies keeping the classifier in the pipeline at all.

**Files touched this session:**
- Modified: `contracts/src/pools/FakeLendingPool.sol`, `contracts/src/pools/IFakeLendingPool.sol`.
- Added: `contracts/test/mocks/MockHookToken.sol`, `contracts/test/mocks/FlashLender.sol`, `contracts/test/ExploitReentrancy.t.sol`, `contracts/test/ExploitFlashLoan.t.sol`, `contracts/test/ExploitLiquidation.t.sol`, `contracts/test/ExploitAdminRug.t.sol`.
- Updated: `checklist.md` (demo coverage matrix replaces the proposed-exploits menu).

**Strategy.md note:** §2(a) lists detection signals abstractly. Worth tightening to reference the five-vuln matrix directly — gives the reader an unambiguous read on what the agent actually defends against. Defer until the demo is recorded so we don't churn the doc twice.

### 2026-04-26 — Track C 0G fine-tuning driver (§10.1 Stage B)

**Shipped:**
- `tools/finetune/` TS workspace added to `pnpm-workspace.yaml` via `tools/*` glob. Strict TS (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) — clean `pnpm typecheck`.
- Wraps `@0glabs/0g-serving-broker` v0.7.5 via a single ethers `Wallet` signer keyed off `PHULAX_FT_PRIVATE_KEY` (must not equal the agent runtime key). Lives outside `agent/` so `withdraw.ts` stays the only signer in the runtime container.
- CLI subcommands (yargs): `discover` / `fund` / `submit` / `poll` / `ack` / `safety-cron` / `status`. All idempotent — re-runs check current state from `ml/artifacts/og-ft/run.json` before doing work.
- `submit` validates `dataset.jsonl` sha256 against `manifest.json` before upload; rejects on drift. Writes the rigid 0G config (`neftune_noise_alpha, num_train_epochs, per_device_train_batch_size, learning_rate, max_steps`) to `training-config.json` and records its sha256 in `run.json`.
- `safety-cron` is a long-running watchdog: at submittedAt + 47h, force-acks the model. Defends the 30%-fee penalty on the 48h deadline.
- `ack` calls `acknowledgeModel({ downloadMethod: "auto" })` then `decryptModel`, dropping the LoRA at `ml/artifacts/lora/adapter_model.safetensors` — the path `ml/finetune/merge_and_quantize` already expects.
- `ml/prompt/template.py` extended with `instruction_io(row)` (folds SYSTEM into `instruction`, canonicalised features into `input`, target JSON into `output`). `chat_messages` and `TEMPLATE_VERSION` unchanged — local LoRA path keeps working byte-for-byte.
- `ml/finetune/og_emit.py` reads `data/dataset.jsonl`, emits `artifacts/og-ft/{dataset.jsonl, manifest.json}` with `{rows, sha256, template_version, base_model, label_distribution, built_at}`. Emit is deterministic (sorted keys, fixed separators) so the sha matches across re-runs.
- `ml/finetune/lora.py:run_remote_0g` rewritten: was a fictional REST POST stub, now shells `pnpm --filter @phulax/finetune {fund,submit,poll,ack}` after running `og_emit`. Trigger env switched from `OG_FT_ENDPOINT` (gone) to `PHULAX_FT_PROVIDER`.
- `ml/.env.example` and `ml/README.md` updated for the broker-driven flow.

**Decisions / surprises:**
- 0G's predefined model name on testnet is exactly `"Qwen2.5-0.5B-Instruct"` (string, not a hash) — confirmed in `src.ts/sdk/fine-tuning/const.ts`. Broker resolves to the merkle root internally.
- Broker `transferFund(provider, "fine-tuning", amount: bigint)` takes neuron, but `depositFund(amount: number)` takes 0G. Easy footgun — wrapped both in `fund.ts` with named-arg semantics so callers always pass 0G.
- `createZGComputeNetworkBroker` requires a `Wallet` (not a `JsonRpcSigner`) for `broker.fineTuning` to be defined — the source has an `instanceof Wallet` check in `broker.ts`. `broker.ts` (ours) asserts on this.
- The 0G config schema is unforgiving: silently accepts unknown keys but the training job then fails. `LOCKED_TRAINING_CONFIG` is the only path that writes `training-config.json`; `ALLOWED_CONFIG_KEYS` is asserted at submit time as belt-and-braces.

**Still open:**
- No live submit yet — needs `PHULAX_FT_PRIVATE_KEY` funded on Galileo and a chosen provider. Discover step verified shape, end-to-end run is gated on funds.
- `python -m finetune.merge_and_quantize` reads from `artifacts/lora/adapter_model.safetensors`; works whether the file came from the local PEFT path or the 0G ack — no change needed there.
- `ml/upload/og_storage.py` doesn't yet append the `model_publish` 0G Storage Log entry described in §10.1 Stage C step 4. Add when the first real run produces a CID set.

### 2026-04-28 — Track C Colab path + Track D Phase 2 (real-weights inference)

**Track C — Colab fine-tune path landed.**
- `ml/finetune/colab_train.ipynb` mirrors `ml/finetune/lora.py` (rank 16, α 32, lr 2e-4, 10 epochs, MAX_LEN 768, RISK 2× / SAFE 1× class weighting, frozen TEMPLATE_VERSION 2.0.0 inlined). Runs on a free Colab T4 in ~12-20 min, sidestepping the 0G broker + 48h ack window. Adapter zips back to `ml/artifacts/lora/`; downstream `merge_and_quantize` / `eval` / `upload` are unchanged.
- `how-to-finetune.md` Step 2a documents the alternative path. Step 9 onward is shared.
- `ml/finetune/lora.py` EPOCHS bumped 5 → 10 to match.

**Track D Phase 2 — real transformers serving.**
- `inference/server.py` swapped the stub `_classify` for a transformers call against `PHULAX_MODEL_DIR` (defaults to `ml/artifacts/merged/`). At boot: `model_hash = sha256(model.safetensors)` (matches what `ml/upload/og_storage.py` will publish), logged once.
- Falls back to the stub deterministically when `PHULAX_MODEL_DIR` isn't set — keeps the shape/HMAC tests fast and dep-free, and means a Docker run without a mounted model is still a working endpoint.
- Imports `chat_messages` + `SIGNALS` + `TEMPLATE_VERSION` from `ml/prompt/template.py` via a `sys.path` shim. Dockerfile updated to build from the repo root and copy `ml/prompt/` into `/app/ml/prompt/` so the import resolves identically in the container.
- `_parse_output` extracts the first balanced JSON object from the model response and clamps `p_nefarious` to `[0,1]`; on any parse failure returns a neutral SAFE so the agent aggregator still proceeds.
- `tag` now derives from `p_nefarious >= 0.5` rather than `signal != "none"`. The model occasionally emits `signal: "none"` alongside a high `p_nefarious` (consistent with the eval REPORT showing 0.615 P / 0.923 R — recall-leaning); raw `p_nefarious` and `signal` are both kept in the receipt so the discrepancy is auditable.
- Probe results against the merged adapter: oracle-manipulation drain → 0.930, admin rug → 0.932, benign supply → 0.084. Functionally usable — the agent's classifier weight `(p − 0.5) × 0.8` caps the classifier-alone contribution to 0.344, which still requires corroboration to cross the 0.7 fire threshold (defensible).
- `inference/test_server.py` extended with an opt-in `test_real_inference_smoke` gated on `PHULAX_SMOKE_MODEL_DIR`; default suite (4 stub tests) stays in stub mode and runs in <1s. Full suite (5/5) green: stub tests in 0.6s, real-model smoke in ~17s including model load.

**Surprises:**
- Initial probe revealed the `signal` field disagreeing with `p_nefarious` for the tuned weights. Kept both fields raw in the receipt rather than coercing — gives the eval harness something to hill-climb on next iteration without changing the wire shape.
- `model.safetensors` is the only weight file in the merged checkpoint, so `_hash_model_dir` short-circuits on it. If `merge_and_quantize` ever shards across multiple files, the fallback hashes every file deterministically.
- `requirements.txt` now pins `torch==2.4.1` + `transformers==4.46.3` + `accelerate==1.1.1`. ~2 GB image vs the ~150 MB stub image; acceptable for the demo.

**Open:**
- `ml/upload/og_storage.py` still hasn't run — `ml/artifacts.json` doesn't exist yet, so the iNFT mint flow has no `classifier_pointer` to anchor to. Next step: run Step 11 from `how-to-finetune.md` once 0G Storage credentials are wired.
- `eval/REPORT.md` (timestamped 2026-04-28 02:23 UTC) was generated against an earlier run; re-run `python -m eval.harness` to get fresh numbers against the 10-epoch / rank 16 weights now in `ml/artifacts/merged/`.
- The fine-tuned model's signal-vs-p_nefarious incoherence is a hill-climb candidate for the next training pass (bigger dataset, signal-targeted curriculum) but doesn't block the demo.

**Strategy.md:** no change needed; Phase-2 wiring matches §3 architecture diagram and §10 self-hosted-classifier story.

### 2026-04-28 — Track B testnet-deploy prep (broadcast pending user-funded key)

**Shipped (everything that can land without a funded key):**
- `forge install --no-git foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts` re-vendored under `contracts/lib/` (gitignored). `forge build` clean; 11/11 tests still pass.
- `src/DemoAsset.sol` — permissionless-mint ERC20 used as the testnet demo asset. Lets the web UI self-mint a balance per session instead of relying on a faucet drip per demo run. Test mock at `test/mocks/MockERC20.sol` left as-is to keep the test surface stable.
- `script/Deploy.s.sol` rewritten to be self-contained: deploys `Hub`, `PhulaxINFT`, `FakeLendingPool`, fresh `DemoAsset`, `FakePoolAdapter`, and a `PhulaxAccount` for the deployer in one transaction set. Pool is seeded with `POOL_SEED_AMOUNT` (default 100e18) of DemoAsset so a demo attacker has reserves to drain. Hub registration + risk policy applied at deploy time.
- `wagmi.config.ts` + `scripts/extract-abis.mjs` extended to include `DemoAsset`. Re-ran both:
  - `contracts/generated/wagmi.ts` — 981 lines, all 7 typed ABIs (Track E + F consume this).
  - `contracts/abis/{PhulaxAccount,Hub,PhulaxINFT,FakeLendingPool,FakePoolAdapter,IAdapter,DemoAsset}.json` — paste-in fallback for KeeperHub `abi-with-auto-fetch`.
- `.env.example` (new) + `README.md` "Deploy to 0G testnet" section rewritten with the self-contained flow + dry-run step.
- **Dry-run against live `https://evmrpc-testnet.0g.ai` succeeded.** Simulation produced sane addresses, ~5.47M gas, ~0.022 0G estimated total cost. No broadcast.

**⚠ Chain id discrepancy — needs attention before E2E:**
- `cast chain-id --rpc-url https://evmrpc-testnet.0g.ai` reports **16602**, not the **16601** recorded in CLAUDE.md, todo.md §1.3, the Track A review, and `keeperhub/lib/rpc/rpc-config.ts` / `keeperhub/scripts/seed/seed-chains.ts`. 0G migrated the testnet chain id since the seed was committed.
- Deploy itself unaffected (foundry derives from RPC). What needs updating:
  - `keeperhub/` chain seeds (16601 → 16602 for Galileo). Mainnet 16661 likely unchanged but worth re-confirming.
  - Agent + web wagmi configs that hardcode the chain id.
  - CLAUDE.md / todo.md / STRATEGY.md prose.
- Treat this as a one-line fix across each location once the deploy lands; not blocking the broadcast.

**Pending user action (out of scope for an autonomous step):**
- Provide funded `PRIVATE_KEY` for Galileo (faucet: https://faucet.0g.ai). Need ~0.025 0G with headroom.
- Pick + fund the `AGENT_ADDRESS` (single-selector guardian key, separate from deployer per §3 invariant).
- Run `forge script script/Deploy.s.sol:Deploy --rpc-url zerog_testnet --broadcast --verify`.
- Capture the printed addresses into agent `.env`, web `.env.local`, and the KH workflow JSON.

**Open after broadcast:**
- Hub address goes into web `.env.local` (`NEXT_PUBLIC_HUB_ADDRESS`); PhulaxAccount address goes to the agent's `PHULAX_ACCOUNT_ADDRESS`.
- KH workflow `{{TODO_FAKE_LENDING_POOL_ADDRESS}}` slot finally gets a value.
- Optional: mint DemoAsset to the deployer + a demo "attacker" key so the demo flow can run end-to-end without a separate funding step.

### 2026-04-28 — Track B testnet deploy landed + post-broadcast wiring

**Broadcast (chain id 16602, run `contracts/broadcast/Deploy.s.sol/16602/run-latest.json`):**
- Hub                `0x573b9Ec4BB93bbDA59C0DBA953831d58fC36498C`
- PhulaxINFT         `0xe5c3e4b205844EFe2694949d5723aa93B7F91616`
- FakeLendingPool    `0xb1DE7278b81e1Fd40027bDac751117AE960d8747`
- DemoAsset (pUSD)   `0x21937016d3E3d43a0c2725F47cC56fcb2B51d615`
- FakePoolAdapter    `0x0c39fF914e41DA07B815937ee70772ba21A5C760`
- PhulaxAccount      `0xA70060465c1cD280E72366082fE20C7618C18a66`
- Deployer           `0x734da1B3b4F4E0Bd1D5F68A470798CbBAe74ab00`
- Agent EOA          `0x47d3CF2a314aeF4Da43dB8eBC7Eb818bF2496260`

**Gas-tip fix (one-line patch to make `--broadcast` actually land):**
- 0G enforces a 2 gwei minimum priority fee; foundry's auto-estimation produced 1 wei and the relay rejected with `gas tip cap 1, minimum needed 2000000000`.
- `contracts/package.json` `deploy:zerog` now appends `--priority-gas-price 2gwei`. Re-run is idempotent because the deployer nonce already advanced past the failed simulation.

**Post-broadcast wiring (this session):**
- `web/.env.local` written from `.env.example` template with all six addresses + 16602 chain id.
- `agent/.env.example` (new) + `agent/.env` (populated) — covers `RPC_URL`, `CHAIN_ID`, `POOL_ADDRESS`, `PHULAX_ACCOUNT_ADDRESS`, `PHULAX_ADAPTER_ADDRESS`, `HUB_ADDRESS`, `DEMO_ASSET_ADDRESS`, plus the 0G-Storage / KeeperHub / classifier slots that Track A and D will fill. `AGENT_PRIVATE_KEY` left blank — user fills it for the EOA registered at deploy time.
- `keeperhub/specs/0g-integration/per-tx-detection.workflow.json:17` — `{{TODO_FAKE_LENDING_POOL_ADDRESS}}` replaced with the live FakeLendingPool address.
- `contracts/.env.example:1` — stale `chain id 16601` comment corrected to 16602.

**Chain-id sweep (16601 → 16602):**
- `keeperhub/lib/rpc/rpc-config.ts` and `scripts/seed/seed-chains.ts` were already on 16602 (Track A6 work). No change needed.
- `agent/src/config.ts:27` already defaults to 16602. No change needed.
- Only `contracts/.env.example` had stale prose; fixed.
- Lines 463 and 752–754 above are *historical* review prose explaining the 16601→16602 migration; left as-is.

**On-chain sanity (cast call against `https://evmrpc-testnet.0g.ai`):**
- `Hub.accountOwner(account) == deployer` ✓
- `Hub.policy(account) == (7000, 2^256-1)` ✓ (threshold 70%, no per-block cap)
- `PhulaxAccount.owner == deployer`, `PhulaxAccount.agent == 0x47d3...6260` ✓
- `PhulaxAccount.allowedAdapter(adapter) == true` ✓
- `DemoAsset.balanceOf(pool) == 100e18` ✓ (seed reserves intact)
- Agent EOA balance `~2.5 0G` — already funded for hot-key gas.
- Deployer pUSD balance `0` — expected, all 100e18 of seed minted+supplied to the pool. Self-mint when needed (DemoAsset.mint is permissionless).

**Skipped (intentional):**
- `cast send` mint to deployer / attacker — DemoAsset is permissionless-mint, so this is a runtime concern for the demo script, not deploy-time. One-liner when ready: `cast send 0x21937016d3E3d43a0c2725F47cC56fcb2B51d615 "mint(address,uint256)" <addr> <amount> --rpc-url $ZEROG_RPC_URL --private-key $PRIVATE_KEY`.
- Explorer verification API check — Galileo's chainscan returns SPA HTML on `/api?module=...` so the legacy etherscan-compat probe is unreliable; rely on `forge --verify` exit status instead, and confirm visually at `https://chainscan-galileo.0g.ai/address/<addr>`.

**Unblocked next:**
- Track A end-to-end run — workflow JSON is now address-complete, can be uploaded via `keeperhub/` MCP.
- Track E `agent/src/exec/withdraw.ts` against the live `PhulaxAccount` — env wired, agent EOA funded, just needs the real private key in `agent/.env`.
- Track F Phase 2 — `web/.env.local` is ready for live SSE + on-chain reads against deployed Hub.
