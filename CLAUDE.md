# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

**Phulax** is a hackathon project: an autonomous on-chain "guardian agent" that watches a yield/lending pool, detects nefarious transactions in real time, and pulls user funds out before an attacker drains the pool. Detection runs on 0G (vector-similarity over a corpus of historical exploits + a fine-tuned Qwen2.5-0.5B classifier), execution runs through KeeperHub workflows, and the user owns their guardian as an ERC-7857 iNFT.

Read these three files before doing anything substantive — they are the source of truth, and overlap is intentional:

- `idea.md` — original brainstorm.
- `STRATEGY.md` — *what* and *why*. Pitch shape, architecture diagram, scope cuts, demo script.
- `tasks/todo.md` — *how*, *with what*, *in what order*. Concrete build plan with locked-in decisions (see §13) and still-open questions (§15). When you change approach or finish a chunk, update this file's Review section, not memory.

If `STRATEGY.md` and `tasks/todo.md` disagree, `tasks/todo.md` wins (it is the more recently revised doc and contains the resolved decisions).

## Repo layout (current vs. planned)

Right now the repo contains only the strategy docs and a single git submodule:

- `keeperhub/` — submodule pointing at our fork of KeeperHub (`git@github.com:Dev43/keeperhub.git`). **All KeeperHub work happens inside this submodule, on a feature branch (`feature/0g-integration`), and follows `keeperhub/CLAUDE.md`** (Next.js 16 + Drizzle + pnpm; `pnpm check`, `pnpm type-check`, `pnpm fix`; PRs target `staging` with conventional-commit titles; etc.). Do not duplicate those rules here — defer to that file when editing the submodule.
- `tasks/todo.md` — concrete build plan. `tasks/lessons.md` should be created/updated whenever the user corrects an approach (per global instructions).

Everything else listed in `tasks/todo.md` §4 (`contracts/`, `agent/`, `inference/`, `ml/`, `web/`, `docker/`) does **not exist yet**. When you create those directories, follow the structure and language choices in §2 and §4 of that doc — don't invent your own.

## The Day-1 prerequisite

Nothing else works until the **0G ↔ KeeperHub bridge** lands. That work happens in the `keeperhub/` submodule using KeeperHub's own slash commands (`/add-chain 0G`, `/add-plugin 0g-storage`, `/add-plugin 0g-compute`), driven by the mapping table in `tasks/todo.md` §7.1. Don't write a per-tx trigger from scratch — the decision (locked) is `Block` trigger + `web3/query-transactions` filter (§7.4).

## Architectural invariants (do not violate)

These come from `tasks/todo.md` §3 and §5. They are non-negotiable design constraints:

- **Agent never holds user funds.** `PhulaxAccount.withdraw` is hard-coded to send to `owner`; no `to` parameter, no agent-controlled recipient. Enforced in the contract, not in the off-chain agent.
- **Agent key has one selector.** The agent role can call `withdraw(adapter)` and nothing else. No upgradability, no `delegatecall`, no escape hatch on the agent path.
- **Detection pipeline is pure.** `detect(tx, ctx) -> Score` has no side effects so any historical exploit can be replayed through it as a regression test.
- **No database in `agent/`.** 0G Storage (KV + Log) is the database; this is part of the pitch.
- **Self-hosted classifier, not 0G sealed inference** (because 0G doesn't currently serve our LoRA-adapted Qwen2.5-0.5B). Verifiability story is "publish-and-replay": merged weights + eval harness on 0G Storage, signed `(input_hash, output, model_hash)` receipts written to a 0G Storage Log on every fire. The `0g-compute` KeeperHub plugin still ships in the upstream PR for users hitting 0G-served base models — it just isn't on the demo's hot path.
- **One-language rule:** TypeScript everywhere it can be. Python is sandboxed to the `ml/` artifact pipeline (offline only). Solidity for contracts.

## Scope discipline

Cuts are explicit in `STRATEGY.md` §8 and `tasks/todo.md` §13. Notably:

- **x402 / MPP autonomous payment is cut from v1.** Don't build it. One-line roadmap mention only.
- **No multi-chain.** 0G testnet for the demo, full stop.
- **No fancy frontend.** One screen: connect → see position → live risk gauge (SSE) → incident timeline. Streaming logs panel is the credibility moment.
- **FakeLendingPool is not a KeeperHub `protocols/` plugin.** It's a deployed demo contract; workflows consume its ABI via `abi-with-auto-fetch`.

When in doubt about scope, re-read `STRATEGY.md` §8 before adding anything.

## Working norms (project-specific, on top of global CLAUDE.md)

- **Update `tasks/todo.md` Review section** after each working session — what shipped, what surprised us, what to change in `STRATEGY.md`.
- **Update `tasks/lessons.md`** after any user correction (per global rule).
- **Don't push or open PRs without explicit user confirmation** (also enforced inside the keeperhub submodule).
- **Open the upstream KeeperHub PR only after the demo is recorded** (`tasks/todo.md` §7.5). We don't want upstream review noise during the hackathon.
