# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

**Phulax** is a hackathon project: an autonomous on-chain "guardian agent" that watches a yield/lending pool, detects nefarious transactions in real time, and pulls user funds out before an attacker drains the pool. Detection runs on 0G (vector-similarity over a corpus of historical exploits + a fine-tuned Qwen2.5-0.5B classifier), execution runs through KeeperHub workflows, and the user owns their guardian as an ERC-7857 iNFT.

Read these files before doing anything substantive — they are the source of truth:

- `idea.md` — original brainstorm.
- `STRATEGY.md` — *what* and *why*. Pitch shape, architecture diagram, scope cuts, demo script.
- `tasks/todo.md` — *how*, *with what*, *in what order*. **Single source of truth** for the build plan: architectural sections (§1–§13), current punch list with shipped/open status (§14), sharp edges (§15), and the demo-day operational checklist (§16). Per-package details live in each package's `README.md`.
- `tasks/agents/track-{a..f}-*.md` — per-track dispatch docs used to brief subagents.

If `STRATEGY.md` and `tasks/todo.md` disagree, `tasks/todo.md` wins (more recently revised, contains the resolved decisions).

## Repo layout

Monorepo with `pnpm-workspace.yaml` listing `contracts`, `agent`, `web`, `keeperhub`. `ml/` and `inference/` are Python (managed separately with `uv` and pip respectively). Each top-level directory is one of the six tracks in `tasks/todo.md` §1:

- `contracts/` — Foundry project (`PhulaxAccount`, `Hub`, `PhulaxINFT` ERC-7857, `FakeLendingPool` with **five** intentional vulns: open-oracle borrow drain, reentrancy via hook-token, flash-loan amplified drain, liquidation-via-oracle-crash, admin reserve sweep). Each vuln is backed by a working drain test; see the demo-coverage matrix in `contracts/README.md`. Generated typed ABIs land in `contracts/generated/wagmi.ts` and JSON fallbacks in `contracts/abis/`.
- `agent/` — TypeScript guardian (Node 20, viem, fastify). Detection pipeline + risk aggregator + KeeperHub workflow client + withdraw executor + SSE server. **At runtime, the only module that signs is `agent/src/exec/withdraw.ts`** — calldata is constructed in-module from the typed ABI fragment.
- `inference/` — Self-hosted FastAPI classifier endpoint. Real merged Qwen2.5-0.5B + LoRA against `ml/artifacts/merged/` when `PHULAX_MODEL_DIR` is set; deterministic stub fallback when it isn't (so dep-free tests stay fast). HMAC-signed `(input_hash, output, model_hash)` receipts on every fire.
- `ml/` — Offline-only Python pipeline (uv): dataset builder, frozen prompt template (`ml/prompt/template.py`, versioned), LoRA fine-tune (local PEFT path), merge+quantize, embeddings indexer, eval harness, 0G upload. There's also a Colab notebook (`ml/finetune/colab_train.ipynb`) that mirrors the local fine-tune on a free T4 in ~12-20 min — the path actually used to produce `ml/artifacts/merged/`. Outputs go to `ml/artifacts.json` which Track D + iNFT metadata consume.
- `tools/finetune/` — separate TS workspace driving the 0G fine-tuning broker (`@0glabs/0g-serving-broker`). **Lives outside `agent/` on purpose**: uses its own `PHULAX_FT_PRIVATE_KEY`, never the agent runtime key, so `agent/src/exec/withdraw.ts` stays the only signer in the runtime container. Subcommands: `discover`/`fund`/`submit`/`poll`/`ack`/`safety-cron`. The `safety-cron` defends the 48h ack deadline (30% fee penalty if missed).
- `web/` — Next.js 14 App Router dashboard (one screen): connect → position → live risk gauge (SSE) → streaming log panel → incident timeline.
- `keeperhub/` — git submodule, our fork of KeeperHub, all 0G integration work on `feature/0g-integration` branch. **Follow `keeperhub/CLAUDE.md`** for that submodule (Next.js 16 + Drizzle + pnpm, `pnpm check && pnpm type-check && pnpm fix` before every commit, conventional-commit titles, PRs to `staging`). Don't duplicate those rules here.

## Common commands

**Agent (`agent/`)** — `pnpm install` then:
- `pnpm test` (vitest), `pnpm test:watch`, `vitest run path/to/file.test.ts -t "name"` for a single test
- `pnpm typecheck`, `pnpm dev` (tsx watch), `pnpm build` then `pnpm start`

**Web (`web/`)** — `pnpm install` then `pnpm dev`, `pnpm build`, `pnpm type-check`, `pnpm lint`.

**Contracts (`contracts/`)** — requires Foundry locally; if `contracts/lib/` is empty: `forge install --no-git foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts` (the `--no-git` matters when working inside a `.dmux` worktree where submodule pathspec resolution fails). Then:
- `pnpm test` (= `forge test -vv`), `pnpm fuzz` (invariant tests, `[fuzz] runs = 512` in `foundry.toml`)
- `forge test --match-test testFuzz_withdrawAlwaysToOwner -vvv` for one test
- `pnpm build`, `pnpm abis` (extracts JSON ABI fallbacks), `pnpm wagmi` (regenerate typed ABIs for agent/web)
- `pnpm deploy:zerog` deploys to 0G testnet. Needs `PRIVATE_KEY` (deployer, ~0.025 0G with headroom), `AGENT_ADDRESS` (the single-selector guardian, separate per §3 invariant), `ZEROG_RPC_URL`, `ZEROG_EXPLORER_API_KEY`, `ZEROG_EXPLORER_URL`. The script appends `--priority-gas-price 2gwei` because **Galileo enforces a 2 gwei minimum priority fee** — without it the relay rejects with `gas tip cap 1, minimum needed 2000000000`.

**ML (`ml/`)** — `uv sync` then run modules from `ml/`: `python -m data.build_dataset`, `python -m finetune.lora`, `python -m finetune.merge_and_quantize`, `python -m embed.index`, `python -m eval.harness`, `python -m upload.og_storage`. See `ml/README.md` for the run order, or `how-to-finetune.md` Step 2a for the Colab path that's actually been used to produce shipped weights.

**0G fine-tuning broker driver (`tools/finetune/`)** — `pnpm --filter @phulax/finetune {discover,fund,submit,poll,ack,safety-cron,status}`. Idempotent — re-runs check `ml/artifacts/og-ft/run.json` before doing work. Requires `PHULAX_FT_PRIVATE_KEY` (must not equal the agent runtime key).

**Inference (`inference/`)** — `pip install -r requirements.txt` then `uvicorn server:app --reload` (or `docker build` from the Dockerfile). Test with `pytest test_server.py`. `PHULAX_INFERENCE_HMAC_KEY` must be set at runtime — no in-image default.

**KeeperHub submodule** — defer to `keeperhub/CLAUDE.md`. Day-1 bridge work uses its slash commands (`/add-chain 0G`, `/add-plugin 0g-storage`, `/add-plugin 0g-compute`).

## The Day-1 prerequisite

Nothing else works end-to-end until the **0G ↔ KeeperHub bridge** lands. That work happens in the `keeperhub/` submodule on `feature/0g-integration`, driven by the mapping table in `tasks/todo.md` §7.1. The per-tx detection pattern is **`Block` trigger + `web3/query-transactions` filter** (locked in §7.4) — don't write a per-tx trigger from scratch. Track A's review in `tasks/todo.md` documents what's already shipped (chain seeds, `0g-storage` plugin, `0g-compute` plugin, workflow skeleton) and what's still open (WSS endpoint for Galileo, end-to-end testnet run).

## Live testnet state (as of 2026-04-28)

Contracts deployed on 0G Galileo (chain id **16602**, broadcast at `contracts/broadcast/Deploy.s.sol/16602/run-latest.json`). Addresses already wired into `web/.env.local`, `agent/.env`, and the KH workflow JSON:

- Hub `0x573b9Ec4BB93bbDA59C0DBA953831d58fC36498C`
- PhulaxINFT `0xe5c3e4b205844EFe2694949d5723aa93B7F91616`
- FakeLendingPool `0xb1DE7278b81e1Fd40027bDac751117AE960d8747`
- DemoAsset (pUSD, permissionless mint) `0x21937016d3E3d43a0c2725F47cC56fcb2B51d615`
- FakePoolAdapter `0x0c39fF914e41DA07B815937ee70772ba21A5C760`
- PhulaxAccount `0xA70060465c1cD280E72366082fE20C7618C18a66`
- Agent EOA `0x47d3CF2a314aeF4Da43dB8eBC7Eb818bF2496260` (funded ~2.5 0G; `AGENT_PRIVATE_KEY` blank in `agent/.env` — user fills)
- Deployer `0x734da1B3b4F4E0Bd1D5F68A470798CbBAe74ab00`

## Sharp edges (subtle, will bite if missed)

- **Galileo chain id is 16602, not 16601.** 0G migrated the testnet chain id since some seeds were committed. Some review prose in `tasks/todo.md` still references 16601 — historical only; current code is on 16602.
- **2 gwei minimum priority fee** on Galileo. `forge --broadcast` fails without `--priority-gas-price 2gwei`. `cast send` calls need it too.
- **0G WSS lives at `wss://evmrpc-testnet.0g.ai/ws/`** — trailing slash is mandatory. `/ws` (no slash) returns an HTTP 301 redirect that WebSocket clients silently fail on (timeout, no error), so it looks like the endpoint doesn't exist. Confirmed against chain id `0x40da`/16602 with `eth_subscribe("newHeads")` streaming heads at ~250 ms cadence (resolved 2026-05-02; see `tasks/todo.md` Review).
- **Adapter owns the pool position, not PhulaxAccount.** After the 2026-04-26 ownership-model fix, `pool.balanceOf(asset, user)` returns 0 for a Phulax-protected user. `agent/src/detection/hydrate.ts` and any code wanting "this user's pool position" must read `adapter.balanceOf(account)`.
- **0G Storage writes signed by org KeeperHub wallet via the Flow contract** `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296` (Galileo), not bearer auth. Threat-model line for the pitch: "the workflow's signing wallet pays for the write."
- **`@0glabs/0g-serving-broker` requires an `ethers.Wallet`, not a `JsonRpcSigner`** — `broker.fineTuning` is undefined otherwise (there's an `instanceof Wallet` check inside the broker source).
- **0G fine-tuning config schema is rigid** — exactly `{neftune_noise_alpha, num_train_epochs, per_device_train_batch_size, learning_rate, max_steps}`, decimal notation only, no `fp16`/`bf16` flags. Unknown keys are silently accepted then fail training. `tools/finetune/` validates against `LOCKED_TRAINING_CONFIG` before submit.
- **Pydantic v2 reserves the `model_` namespace** — `inference/server.py` keeps the `model_hash` field name (the wire shape is locked in §10) by setting `ConfigDict(protected_namespaces=())`.

## Architectural invariants (do not violate)

These come from `tasks/todo.md` §3 and §5. They are non-negotiable:

- **Agent never holds user funds.** `PhulaxAccount.withdraw` is hard-coded to send to `owner`; no `to` parameter, no agent-controlled recipient. Enforced in the contract, not in the off-chain agent.
- **Agent key has one selector.** The agent role can call `withdraw(adapter)` and nothing else. No upgradability, no `delegatecall`, no escape hatch on the agent path. Fuzz tests in `PhulaxAccount.fuzz.t.sol` enforce this across 512 fuzz runs / 256k invariant calls.
- **Two signing surfaces in the repo, not one.** The runtime container has only `agent/src/exec/withdraw.ts`. The offline 0G fine-tuning broker driver (`tools/finetune/`) uses a separate `PHULAX_FT_PRIVATE_KEY` and is intentionally a different workspace so the runtime invariant holds.
- **Detection pipeline is pure.** `detect(tx, ctx) -> Score` has no side effects so any historical exploit can be replayed through it as a regression test. All I/O is isolated in `agent/src/detection/hydrate.ts`. There's a purity test asserting repeated calls are deep-equal — keep it green.
- **No database in `agent/`.** 0G Storage (KV + Log) is the database; this is part of the pitch.
- **Self-hosted classifier, not 0G sealed inference** (because 0G doesn't currently serve our LoRA-adapted Qwen2.5-0.5B). Verifiability story is "publish-and-replay": merged weights + eval harness on 0G Storage, signed `(input_hash, output, model_hash)` receipts written to a 0G Storage Log on every fire. The `0g-compute` KeeperHub plugin still ships in the upstream PR for users hitting 0G-served base models — it just isn't on the demo's hot path.
- **One canonicaliser for `input_hash`.** Inference server and agent both compute `sha256(canonical_json(features))` with sorted keys and `(",", ":")` separators. If you change one side, change both — Track D and Track E both depend on byte-identical hashing.
- **Frozen prompt template.** `ml/prompt/template.py` carries `TEMPLATE_VERSION` and is imported by fine-tune, eval, and inference. Bumping the version invalidates published weights.
- **One-language rule:** TypeScript everywhere it can be. Python is sandboxed to `ml/` (offline) and `inference/` (single FastAPI service). Solidity for contracts.

## Scope discipline

Cuts are explicit in `STRATEGY.md` §8 and `tasks/todo.md` §13:

- **x402 / MPP autonomous payment is cut from v1.** One-line roadmap mention only.
- **No multi-chain.** 0G testnet (Galileo, chain id 16602) for the demo.
- **No fancy frontend.** One screen. The streaming logs panel is the credibility moment.
- **FakeLendingPool is not a KeeperHub `protocols/` plugin.** It's a deployed demo contract; workflows consume its ABI via `abi-with-auto-fetch`, with `contracts/abis/*.json` as paste-in fallback.

When in doubt about scope, re-read `STRATEGY.md` §8 before adding anything.

## Working norms (project-specific, on top of global CLAUDE.md)

- **Update `tasks/todo.md` Review section** after each working session — what shipped, what surprised us, what to change in `STRATEGY.md`. Per-track entries already exist; append, don't rewrite.
- **Update `tasks/lessons.md`** after any user correction (per global rule).
- **Don't push or open PRs without explicit user confirmation** (also enforced inside the keeperhub submodule).
- **Open the upstream KeeperHub PR only after the demo is recorded** (`tasks/todo.md` §7.5). No upstream review noise during the hackathon.
