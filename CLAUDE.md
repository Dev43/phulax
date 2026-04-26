# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

**Phulax** is a hackathon project: an autonomous on-chain "guardian agent" that watches a yield/lending pool, detects nefarious transactions in real time, and pulls user funds out before an attacker drains the pool. Detection runs on 0G (vector-similarity over a corpus of historical exploits + a fine-tuned Qwen2.5-0.5B classifier), execution runs through KeeperHub workflows, and the user owns their guardian as an ERC-7857 iNFT.

Read these three files before doing anything substantive — they are the source of truth, and overlap is intentional:

- `idea.md` — original brainstorm.
- `STRATEGY.md` — *what* and *why*. Pitch shape, architecture diagram, scope cuts, demo script.
- `tasks/todo.md` — *how*, *with what*, *in what order*. Concrete build plan with locked-in decisions (§13), still-open questions (§15), and per-track Review entries that capture what each track actually shipped vs. spec.

If `STRATEGY.md` and `tasks/todo.md` disagree, `tasks/todo.md` wins (more recently revised, contains the resolved decisions).

## Repo layout

Monorepo with `pnpm-workspace.yaml` listing `contracts`, `agent`, `web`, `keeperhub`. `ml/` and `inference/` are Python (managed separately with `uv` and pip respectively). Each top-level directory is one of the six tracks in `tasks/todo.md` §1:

- `contracts/` — Foundry project (`PhulaxAccount`, `Hub`, `PhulaxINFT` ERC-7857, `FakeLendingPool` with intentional vulns, adapters). Generated typed ABIs land in `contracts/generated/wagmi.ts` and JSON fallbacks in `contracts/abis/`.
- `agent/` — TypeScript guardian (Node 20, viem, fastify). Detection pipeline + risk aggregator + KeeperHub workflow client + withdraw executor + SSE server. **The only module that signs is `agent/src/exec/withdraw.ts`** — calldata is constructed in-module from the typed ABI fragment.
- `inference/` — Self-hosted FastAPI classifier endpoint. Currently a stub returning the real response shape; Phase 2 swaps in merged Qwen2.5-0.5B + LoRA weights pulled from 0G Storage CIDs.
- `ml/` — Offline-only Python pipeline (uv): dataset builder, frozen prompt template (`ml/prompt/template.py`, versioned), LoRA fine-tune, merge+quantize, embeddings indexer, eval harness, 0G upload. Outputs go to `ml/artifacts.json` which Track D + iNFT metadata consume.
- `web/` — Next.js 14 App Router dashboard (one screen): connect → position → live risk gauge (SSE) → streaming log panel → incident timeline.
- `keeperhub/` — git submodule, our fork of KeeperHub, all 0G integration work on `feature/0g-integration` branch. **Follow `keeperhub/CLAUDE.md`** for that submodule (Next.js 16 + Drizzle + pnpm, `pnpm check && pnpm type-check && pnpm fix` before every commit, conventional-commit titles, PRs to `staging`). Don't duplicate those rules here.

## Common commands

**Agent (`agent/`)** — `pnpm install` then:
- `pnpm test` (vitest), `pnpm test:watch`, `vitest run path/to/file.test.ts -t "name"` for a single test
- `pnpm typecheck`, `pnpm dev` (tsx watch), `pnpm build` then `pnpm start`

**Web (`web/`)** — `pnpm install` then `pnpm dev`, `pnpm build`, `pnpm type-check`, `pnpm lint`.

**Contracts (`contracts/`)** — requires Foundry locally; first run: `forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts`. Then:
- `pnpm test` (= `forge test -vv`), `pnpm fuzz` (invariant tests, `[fuzz] runs = 512` in `foundry.toml`)
- `forge test --match-test testFuzz_withdrawAlwaysToOwner -vvv` for one test
- `pnpm build`, `pnpm abis` (extracts JSON ABI fallbacks), `pnpm wagmi` (regenerate typed ABIs for agent/web)
- `pnpm deploy:zerog` deploys to 0G testnet (needs `ZEROG_RPC_URL`, `ZEROG_EXPLORER_API_KEY`, `ZEROG_EXPLORER_URL`)

**ML (`ml/`)** — `uv sync` then run modules from `ml/`: `python -m data.build_dataset`, `python -m finetune.lora`, `python -m finetune.merge_and_quantize`, `python -m embed.index`, `python -m eval.harness`, `python -m upload.og_storage`. See `ml/README.md` for the run order.

**Inference (`inference/`)** — `pip install -r requirements.txt` then `uvicorn server:app --reload` (or `docker build` from the Dockerfile). Test with `pytest test_server.py`. `PHULAX_INFERENCE_HMAC_KEY` must be set at runtime — no in-image default.

**KeeperHub submodule** — defer to `keeperhub/CLAUDE.md`. Day-1 bridge work uses its slash commands (`/add-chain 0G`, `/add-plugin 0g-storage`, `/add-plugin 0g-compute`).

## The Day-1 prerequisite

Nothing else works end-to-end until the **0G ↔ KeeperHub bridge** lands. That work happens in the `keeperhub/` submodule on `feature/0g-integration`, driven by the mapping table in `tasks/todo.md` §7.1. The per-tx detection pattern is **`Block` trigger + `web3/query-transactions` filter** (locked in §7.4) — don't write a per-tx trigger from scratch. Track A's review in `tasks/todo.md` documents what's already shipped (chain seeds, `0g-storage` plugin, `0g-compute` plugin, workflow skeleton) and what's still open (WSS endpoint for Galileo, end-to-end testnet run).

## Architectural invariants (do not violate)

These come from `tasks/todo.md` §3 and §5. They are non-negotiable:

- **Agent never holds user funds.** `PhulaxAccount.withdraw` is hard-coded to send to `owner`; no `to` parameter, no agent-controlled recipient. Enforced in the contract, not in the off-chain agent.
- **Agent key has one selector.** The agent role can call `withdraw(adapter)` and nothing else. No upgradability, no `delegatecall`, no escape hatch on the agent path. Fuzz test (`PhulaxAccount.fuzz.t.sol`) enforces this.
- **Detection pipeline is pure.** `detect(tx, ctx) -> Score` has no side effects so any historical exploit can be replayed through it as a regression test. All I/O is isolated in `agent/src/detection/hydrate.ts`. There's a purity test asserting repeated calls are deep-equal — keep it green.
- **No database in `agent/`.** 0G Storage (KV + Log) is the database; this is part of the pitch.
- **Self-hosted classifier, not 0G sealed inference** (because 0G doesn't currently serve our LoRA-adapted Qwen2.5-0.5B). Verifiability story is "publish-and-replay": merged weights + eval harness on 0G Storage, signed `(input_hash, output, model_hash)` receipts written to a 0G Storage Log on every fire. The `0g-compute` KeeperHub plugin still ships in the upstream PR for users hitting 0G-served base models — it just isn't on the demo's hot path.
- **One canonicaliser for `input_hash`.** Inference server and agent both compute `sha256(canonical_json(features))` with sorted keys and `(",", ":")` separators. If you change one side, change both — Track D and Track E both depend on byte-identical hashing.
- **Frozen prompt template.** `ml/prompt/template.py` carries `TEMPLATE_VERSION` and is imported by fine-tune, eval, and inference. Bumping the version invalidates published weights.
- **One-language rule:** TypeScript everywhere it can be. Python is sandboxed to `ml/` (offline) and `inference/` (single FastAPI service). Solidity for contracts.

## Scope discipline

Cuts are explicit in `STRATEGY.md` §8 and `tasks/todo.md` §13:

- **x402 / MPP autonomous payment is cut from v1.** One-line roadmap mention only.
- **No multi-chain.** 0G testnet (Galileo, chain id 16601) for the demo.
- **No fancy frontend.** One screen. The streaming logs panel is the credibility moment.
- **FakeLendingPool is not a KeeperHub `protocols/` plugin.** It's a deployed demo contract; workflows consume its ABI via `abi-with-auto-fetch`, with `contracts/abis/*.json` as paste-in fallback.

When in doubt about scope, re-read `STRATEGY.md` §8 before adding anything.

## Working norms (project-specific, on top of global CLAUDE.md)

- **Update `tasks/todo.md` Review section** after each working session — what shipped, what surprised us, what to change in `STRATEGY.md`. Per-track entries already exist; append, don't rewrite.
- **Update `tasks/lessons.md`** after any user correction (per global rule).
- **Don't push or open PRs without explicit user confirmation** (also enforced inside the keeperhub submodule).
- **Open the upstream KeeperHub PR only after the demo is recorded** (`tasks/todo.md` §7.5). No upstream review noise during the hackathon.
