# Track E — TS guardian runtime

Joins after Track A's plugin shapes are stable and Track B has emitted ABIs (B8). Day-2 morning is the realistic earliest start.

## Dispatch prompt

> You are working on the Phulax hackathon project. Before writing any code, read `STRATEGY.md`, `tasks/todo.md` (especially §3, §4, §6, §7, §9, §10, §11), and the root `CLAUDE.md`. `tasks/todo.md` wins on conflicts.
>
> Your job is to build `agent/` — the TypeScript long-running guardian process. Node 20, viem, KeeperHub MCP client. The structure is fixed in `tasks/todo.md` §4: `detection/`, `risk/`, `og/`, `keeperhub/`, `exec/`, `server.ts`.
>
> **Architectural invariants (must hold; some are also enforced upstream by Track B's contracts):**
> - Agent never holds user funds. The contract enforces that — your code path just calls `withdraw(adapter)`.
> - The agent signing key has authority over **exactly one selector**: `withdraw(adapter)`. Don't reach for any other contract function from the agent path.
> - **`detect(txCtx) -> Score` is pure.** No side effects, no network writes, no logging inside. This is what lets us replay any historical exploit through it as a regression test (todo §3 + §6).
> - **No database in `agent/`.** 0G Storage (KV + Log) is the database. This is part of the pitch — don't sneak in sqlite or Redis "just for caching".
> - One-language rule: TypeScript. Don't shell out to Python.
>
> **Detection pipeline** (todo §6) — implement as four tiers in this order with early-exit short-circuits:
>
> 1. Invariant tier (~5ms, viem reads): monotonic share price, utilization ≤ 100%, totalSupply == reserves+borrows. Violation → score ≥ 0.6, short-circuit.
> 2. Oracle deviation: pool price vs Chainlink + DEX TWAP. `|Δ| > 2%` → +0.2.
> 3. Vector similarity (~100ms): embed `(4-byte selector, first-32-bytes of args, balance-delta vector)`, cosine vs the 0G Storage KV index Track C populated. Top-1 ≥ 0.85 → +0.3.
> 4. Classifier (~300ms): HTTP POST to `inference/`'s `/classify`. Returns `p_nefarious` + signed receipt `(input_hash, output, model_hash, signature)`. Append the receipt to the 0G Storage Log on every fire — this is the verifiability story.
>
> Aggregator: weighted sum, clamped, threshold default `0.7`, configurable per-account via iNFT policy.
>
> **KeeperHub integration** (todo §7.4): trigger pipeline is `Block` trigger → `web3/query-transactions` step (contractAddress = `FakeLendingPool`, fromBlock=toBlock=trigger.blockNumber) → your detection runs across the returned tx array → aggregator returns the **max** score → if `> threshold`, fire `withdraw` via KeeperHub MCP. Don't write a per-tx trigger from scratch — that decision is locked.
>
> Workflow definitions live in `agent/keeperhub/` and reference the plugins Track A added (`0g-storage`, `0g-compute`) and existing primitives (`web3/query-transactions`, HTTP Request). Use `abi-with-auto-fetch` for FakeLendingPool — Track B verified the contract on the explorer.
>
> **`server.ts`** (todo §9):
> - `GET /stream` — SSE feed of detection events (powers Track F's gauge + log panel).
> - `GET /incidents/:account` — proxied from 0G Storage Log.
> - `POST /feedback` — user marks a fire as FP; persist to iNFT memory (0G Storage entry referenced by token metadata).
> - Agent privkey from env. KMS later — for the demo a hot key is fine because the contract is the blast-radius enforcement.
>
> **0G client (`agent/og/`):** if `@0glabs/0g-ts-sdk` is missing the calls you need (KV bulk ops, Log append shape), wrap raw HTTP and write the SDK fragment yourself (todo §12 risk #1). Keep it isolated so an upstream SDK release is a single-file swap.
>
> **Regression suite:** because `detect()` is pure, replay each historical exploit fixture through it and assert score > threshold. This is the test that catches detection regressions during Day-3 polish.
>
> Constraints:
> - Don't push to a remote without explicit user confirmation.
> - Update `tasks/todo.md` Review section when you land a chunk; `tasks/lessons.md` after corrections.

## Checklist
- [ ] E1. Workspace scaffold + viem clients + ABIs from Track B's `wagmi.config.ts`
- [ ] E2. `detection/` four tiers, pure `detect()` function
- [ ] E3. `risk/` aggregator with early-exit short-circuits, iNFT-policy-driven threshold
- [ ] E4. `og/` Storage KV + Log clients (HTTP fallback if SDK gaps)
- [ ] E5. `keeperhub/` workflow defs + MCP client wired
- [ ] E6. `exec/` withdraw executor using `withdraw`-only hot key
- [ ] E7. `server.ts` SSE + incidents + feedback endpoints
- [ ] E8. Exploit-replay regression suite green
