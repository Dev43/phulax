# Phulax build agents

Six parallel tracks. Each `track-*.md` is a self-contained dispatch prompt — copy its contents into a fresh agent / worktree.

| File | Track | Critical path? | Depends on |
|---|---|---|---|
| `track-a-keeperhub-bridge.md` | KeeperHub × 0G bridge | **Yes (Day-1 hard block)** | — |
| `track-b-contracts.md` | Solidity contracts (Foundry) | No, but B8 unblocks E+F | — |
| `track-c-ml.md` | ML fine-tune + embeddings (offline Python) | No | — |
| `track-d-inference.md` | Self-hosted classifier server | No (stub first) | C7 for real weights |
| `track-e-agent.md` | TS guardian runtime | Yes | B8 ABIs, A plugin shapes, D stub |
| `track-f-web.md` | Next.js demo dashboard | No | B8 ABIs, E7 SSE |

## Launch order

t=0 — start A, B, C, D (stub), F (mock) in parallel.
t≈Day-1-end — start E once A6 + B8 are green.

## Shared rules every agent must follow

- Read `STRATEGY.md`, `tasks/todo.md`, and root `CLAUDE.md` before writing code. `tasks/todo.md` wins on conflicts.
- Honour the architectural invariants in `tasks/todo.md` §3 and CLAUDE.md: agent never holds funds; agent key has only the `withdraw(adapter)` selector; detection pipeline is pure; no DB in `agent/`; one-language rule (TS everywhere it can be, Python only in `ml/`).
- Scope cuts are real (STRATEGY §8, todo §13): no x402, no multi-chain, no fancy frontend, FakeLendingPool is **not** a KeeperHub `protocols/` plugin.
- Update `tasks/todo.md` Review section when you land a chunk.
- Update `tasks/lessons.md` after any user correction.
- Do not push or open PRs without explicit user confirmation. Upstream KeeperHub PR opens **after** demo recording.
