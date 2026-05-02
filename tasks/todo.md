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

---

## 14. Status (last updated 2026-05-02)

### Shipped — green and on testnet

- **Contracts** deployed on Galileo (chain id 16602, broadcast at `contracts/broadcast/Deploy.s.sol/16602/run-latest.json`). All addresses wired into `web/.env.local`, `agent/.env`, and the KH workflow JSON. See `contracts/README.md` for the table.
- **Five intentional vulns** in `FakeLendingPool`, each backed by a working drain test (`ExploitReplay`, `ExploitReentrancy`, `ExploitFlashLoan`, `ExploitLiquidation`, `ExploitAdminRug`). 11/11 forge tests green, including 512-run owner-only-recipient invariant fuzz.
- **Agent** (`agent/`): pure detection pipeline (4 tiers), risk aggregator, single-signer `exec/withdraw.ts`, SSE server, 9/9 vitest fixtures + purity test. `tsc --noEmit` clean.
- **Inference** (`inference/`): real merged Qwen2.5-0.5B + LoRA serving from `ml/artifacts/merged/`. HMAC-signed receipts. Eval `0.750 P / 0.923 R` in-domain, `0.625 / 0.625` OOD. Stub fallback for dep-free tests. Dockerfile present.
- **ML pipeline** (`ml/`): dataset (210 rows, 60/150 RISK/SAFE), frozen prompt template (`TEMPLATE_VERSION 2.0.0`), LoRA fine-tune (Colab T4 path is the one actually used), merge+quantize, embeddings indexer, eval harness, upload script. `ml/artifacts/merged/` populated.
- **Fine-tune broker driver** (`tools/finetune/`): TypeScript wrapper over `@0glabs/0g-serving-broker`, six idempotent subcommands, 47h safety-cron defends the 48h ack deadline.
- **KeeperHub bridge** (submodule `keeperhub/`, branch `feature/0g-integration`): chain seeds (16602 + 16661), `0g-storage` plugin (kv-get / kv-put / log-append over Flow contract), `0g-compute` plugin (sealed-inference action), `per-tx-detection.workflow.json` skeleton with FakeLendingPool address filled in.
- **Web** (`web/`): one-screen Next.js 14 dashboard (Phase 1 mock — connect, position, risk gauge, streaming log panel, incident timeline, FP-feedback toggle).
- **WSS endpoint** identified: `wss://evmrpc-testnet.0g.ai/ws/` (trailing slash required). `eth_chainId = 0x40da` (16602) ✓, `eth_subscribe("newHeads")` streaming at ~250 ms cadence — far below the 1-block detection budget. (Resolved 2026-05-02.)

### Open punch list (in dependency order)

Going top-to-bottom unblocks each successive section. Items grouped by what blocks the end-to-end demo recording.

#### A. Critical path (must land for E2E to work)

1. **Wire WSS into KeeperHub.** Set `CHAIN_RPC_CONFIG` JSON in `keeperhub/.env` so `0g-testnet` carries `primaryWssUrl: "wss://evmrpc-testnet.0g.ai/ws/"`. No code change to `lib/rpc/rpc-config.ts` needed. *Owner: Track A.*
2. **Run the block-time + RPC-latency measurement.** `cd keeperhub && pnpm tsx scripts/0g/measure-block-time.ts`. Capture p50/p95 of `eth_getBlockByNumber` and WSS notification stability over 5 minutes; record the numbers here. *Owner: Track A.*
3. **Host `inference/server.py` publicly.** `docker build -f inference/Dockerfile -t phulax-inference .` (build context = repo root — Dockerfile copies `ml/prompt/`). Mount `ml/artifacts/merged/` (~2 GB) at `PHULAX_MODEL_DIR=/app/model`. Set `PHULAX_INFERENCE_HMAC_KEY` (random 32 bytes — same value goes into the workflow secret). Deploy to Fly.io or Railway, single CPU container. Smoke-test:
   ```bash
   curl -X POST https://<host>/classify -H 'content-type: application/json' \
     -d '{"features":{"selector":"0xa9059cbb","value":"0"}}'
   ```
   Should return `{p_nefarious, tag, model_hash, input_hash, signature}`. Note the public URL — feeds A6. *Owner: Track D.*
4. **Fill `AGENT_PRIVATE_KEY` in `agent/.env`.** Currently blank. The on-chain agent role is `0x47d3CF2a314aeF4Da43dB8eBC7Eb818bF2496260`; whoever holds that key pastes it in. Verify: `cd agent && pnpm tsx -e "import {agent} from './src/exec/withdraw'; console.log(agent.address)"` should print `0x47d3…6260`. Blast radius is forced exit only — agent role can call `withdraw(adapter)` and nothing else.
5. **Upload artifacts to 0G Storage and populate `ml/artifacts.json`.** Without CIDs, the iNFT mint has nothing to anchor and the publish-and-replay verifiability story is empty.
   - `cd ml && uv run python -m upload.og_storage` — uploads merged weights, GGUF, dataset, embeddings index, eval report, harness sources. Writes CIDs to `ml/artifacts.json`.
   - Then append a `model_publish` entry to the 0G Storage Log (one-line addition to `ml/upload/og_storage.py` per §10.1 Stage C step 4 — currently missing). *Owner: Track C.*
6. **Fill remaining KH workflow slots.** `keeperhub/specs/0g-integration/per-tx-detection.workflow.json` still has placeholders for `env.PHULAX_INFERENCE_URL` (from step 3), `env.PHULAX_INFERENCE_HMAC_KEY` (from step 3), `env.PHULAX_AGENT_*` (already in `agent/.env`, copy across), and 0G Storage KV namespace key for the embedding index (from step 5). Verify by importing the workflow into the KH dev project and clicking through field validation. *Owner: Track A.*
7. **Track E ABI swap.** Replace `agent/src/abis/FakeLendingPool.ts` import to read from `contracts/generated/wagmi.ts`. One-file change post-B8 (B8 has shipped). Then `cd agent && pnpm typecheck && pnpm test` — must stay green.
8. **End-to-end testnet dry run.** Steps 1–7 must be green first.
   - `cd agent && pnpm dev` — start the SSE server. Verify `/healthz` and that detection fires on the test fixtures.
   - Import `keeperhub/specs/0g-integration/per-tx-detection.workflow.json` into the KH dev project on `feature/0g-integration`.
   - Trigger one synthetic block manually (or fire a benign supply tx through `web/`) — expect: `Block` → `query-transactions` returns the tx → `kv-get` reads the embeddings index → HTTP step calls inference → score is logged via `log-append`. No `withdraw` should fire (score < 0.7).
   - Now run the **demo attack** — script the oracle-manipulation drain from `contracts/test/ExploitReplay.t.sol` against the deployed pool:
     ```bash
     cast send 0xb1DE7278b81e1Fd40027bDac751117AE960d8747 \
       "setAssetPrice(address,uint256)" 0x21937016d3E3d43a0c2725F47cC56fcb2B51d615 1000000000000000000000000 \
       --rpc-url $ZEROG_RPC_URL --private-key $ATTACKER_PRIVATE_KEY \
       --priority-gas-price 2gwei
     # then borrow against inflated collateral
     ```
   - Confirm `withdraw` lands within ≤ 1 block, victim recovers ≥ 99 % of principal in `DemoAsset.balanceOf(deployer)`. **This is the demo.**
   - If anything in the demo run fails, **stop and re-plan** rather than patching forward.

#### B. Demo polish (after A is green)

9. **Mint a reference iNFT.** Required by `STRATEGY.md` §9 deliverables. Add `contracts/script/MintINFT.s.sol` calling `PhulaxINFT.mint(deployer, cid)` where `cid` is the `ml/artifacts.json` `classifier_pointer` from step 5. Run with `--priority-gas-price 2gwei`. Capture explorer URL (`https://chainscan-galileo.0g.ai/token/<INFT-address>?id=<tokenId>`) for the README.
10. **Web Phase 2** — wire deposit/withdraw to `PhulaxAccount`. F3: replace `lib/mock.ts` reads with wagmi hooks against `contracts/generated/wagmi.ts`. F4: deposit/withdraw buttons call `PhulaxAccount.deposit/withdraw`; add a "Mint 100 pUSD" button (DemoAsset is permissionless mint). `pnpm type-check && pnpm build` clean before merging. *Owner: Track F.*
11. **Web Phase 3** — replace mock SSE with real `/stream` (F5: `EventSource('/api/stream')` proxied to `agent/server.ts:GET /stream` via `NEXT_PUBLIC_AGENT_URL`), `/incidents/:account` proxy (F6), `POST /feedback` button (F8). *Owner: Track F.*
12. **(Optional) re-run the eval** to refresh `ml/eval/REPORT.md` against the current `ml/artifacts/merged/` weights: `cd ml && uv run python -m eval.harness`. Last run was `0.750 P / 0.923 R` (in-domain) on 2026-04-28. Below the `0.8 P / 0.6 R` gate but defensible — the aggregator caps classifier-alone contribution at `0.392`, so corroboration is required regardless. Document honestly in the demo voiceover.
13. **(Defer if time-pressed)** Add fixture replays for vulns #2–#5 in `agent/test/fixtures/exploits.ts` — current 7 fixtures are all variants of vuln #1. Tier mapping: #2 invariants, #3 vector + oracle, #4 oracle (negative dev) + classifier, #5 classifier only. Demo only shows vuln #1 live, so this is regression coverage, not a blocker. *Owner: Track E.*
14. **Restore `keeperhub/FEEDBACK.md`.** Drafted then dropped during the 2026-04-25 SDK rewrite. One page describing the SDK-backed plugin shape, org-wallet signing through the Flow contract `0x22E0…5296`, and the per-tx primitive (`Block` + `web3/query-transactions`).
15. **Record the demo video** (< 3 min). Script per `STRATEGY.md` §6: pool with protected position → attacker tx hits → KH workflow fires → classifier + vector both score → withdraw lands → "attack tx still landed, pool drained, we're not in it." Capture: terminal split with `agent` SSE log on the left, `web/` dashboard on the right, KH workflow run page underneath. Loom is fine.
16. **Top-level README + STRATEGY.md polish.** README: one-command setup, deployed addresses, explorer links for INFT, ASCII architecture diagram (in §3 above), explicit list of 0G + KeeperHub features used with file:line pointers. STRATEGY.md edits queued: §2(b) tighten to "LoRA-only fine-tune of Qwen2.5-0.5B-Instruct as a structured classifier"; §3 / §10 note that 0G Storage writes go through the org wallet via Flow contract `0x22E0…5296`; §5 Day 3 link to `ml/README.md` for run order; §2(a) reference the five-vuln matrix.

### Cuts (explicitly not doing in v1, per `STRATEGY.md` §8 + §13 above)

- ❌ x402 / MPP autonomous payment — one-line README roadmap mention only.
- ❌ Multi-chain — 0G testnet (Galileo, 16602) only.
- ❌ Fancy frontend — one screen, streaming logs panel is the credibility moment.
- ❌ Standalone exploit-classifier ML beyond the structured Qwen head — vector similarity is the headline novelty.
- ❌ Governance/admin-key tier as a live signal — captured in vuln #5 fixture and that's it.
- ❌ Per-tx KeeperHub trigger from scratch — `Block` + `web3/query-transactions` is the locked decision (§7.4).

### Post-demo (do not start before recording lands)

- Open the upstream KeeperHub PR from `feature/0g-integration` → `staging` (per §7.5). Title: `feat(0g): add 0G chain + storage + compute integration`. Link to `keeperhub/FEEDBACK.md`. Run `pnpm check && pnpm type-check && pnpm fix` from the submodule before pushing.
- Twitter chatter scraper (Day-4 tiebreaker) — defer unless judges specifically ask for the secondary signal.

---

## 15. Sharp edges (env-specific quirks that silently break naive code)

These all live in the project `CLAUDE.md` "Sharp edges" section — duplicated here so they survive in `tasks/todo.md` once `CLAUDE.md` evolves. Read CLAUDE.md for the canonical list.

- **Galileo chain id is 16602, not 16601.** Some historical review prose still says 16601; current code is on 16602.
- **2 gwei minimum priority fee on Galileo.** `forge --broadcast` and `cast send` need `--priority-gas-price 2gwei`.
- **0G WSS lives at `wss://evmrpc-testnet.0g.ai/ws/`** — trailing slash mandatory. `/ws` returns a 301 that WS clients silently fail on.
- **Adapter owns the pool position, not PhulaxAccount.** `pool.balanceOf(asset, user)` returns 0 for a Phulax-protected user — read `adapter.balanceOf(account)`.
- **0G Storage writes signed by org KH wallet via Flow contract `0x22E0…5296`**, not bearer auth.
- **`@0glabs/0g-serving-broker` requires an `ethers.Wallet`**, not a `JsonRpcSigner` — `broker.fineTuning` is undefined otherwise.
- **0G fine-tuning config schema is rigid** — exactly `{neftune_noise_alpha, num_train_epochs, per_device_train_batch_size, learning_rate, max_steps}`. Unknown keys silently accepted then fail training. `tools/finetune/` validates against `LOCKED_TRAINING_CONFIG`.
- **Pydantic v2 reserves `model_` namespace** — `inference/server.py` keeps the `model_hash` field name (locked wire shape) by setting `ConfigDict(protected_namespaces=())`.

---

## 16. Demo-day operational checklist

Run through this once Section 14.A is green, then again 1 hour before recording:

- [ ] Galileo RPC reachable: `cast block-number --rpc-url $ZEROG_RPC_URL`
- [ ] Agent EOA balance ≥ 0.5 0G: `cast balance 0x47d3...6260 --rpc-url $ZEROG_RPC_URL`
- [ ] Inference server `/healthz` returns 200 from a public URL
- [ ] KH workflow imported, all env slots green, last test fire was successful
- [ ] `agent/server.ts` running, `/stream` open in a browser tab
- [ ] `web/` running, wallet connected, position visible
- [ ] DemoAsset balance freshly minted to the demo "victim" wallet
- [ ] Attacker wallet funded with ~0.05 0G for gas
- [ ] Screen recording set up — three panels visible: terminal logs, web UI, KH run page
- [ ] Backup plan: local Anvil fork ready if testnet is flaky during recording
