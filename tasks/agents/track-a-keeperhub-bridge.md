# Track A — KeeperHub × 0G bridge

**This is the Day-1 critical path. Nothing else ships until this lands.**

## Dispatch prompt

> You are working on the Phulax hackathon project. Before writing any code, read `STRATEGY.md`, `tasks/todo.md` (especially §1, §3, §7, §13, §15), the root `CLAUDE.md`, and `keeperhub/CLAUDE.md`. `tasks/todo.md` wins on any conflict with `STRATEGY.md`.
>
> Your job is to land the **0G ↔ KeeperHub bridge** inside the `keeperhub/` git submodule on a feature branch `feature/0g-integration`. All work happens inside that submodule and follows its own `CLAUDE.md` (Next.js 16 + Drizzle + pnpm; run `pnpm check && pnpm type-check && pnpm fix` before every commit; conventional-commit titles; PRs target `staging`).
>
> Use KeeperHub's own slash commands as the primary build mechanism — they drive the Orchestrator → Researcher → Builder → Verifier pipeline and produce upstream-shaped code. Mapping (locked in `tasks/todo.md` §7.1):
>
> 1. `/add-chain 0G` — chain seed first.
> 2. `/add-plugin 0g-storage` — `kvGet`, `kvPut`, `logAppend` step files.
> 3. `/add-plugin 0g-compute` — `sealedInference` action with `maxRetries = 0`. Ships in upstream PR; not on demo's hot path.
> 4. **No new trigger work.** Per-tx detection uses existing `Block` trigger + `web3/query-transactions` filter (decision §7.4).
> 5. **No `/add-protocol`.** FakeLendingPool is a deployed demo contract; workflows reference it via `abi-with-auto-fetch`.
>
> End-of-day deliverable: a synthetic workflow on 0G testnet where `Block` trigger fires, `query-transactions` returns the block's pool-targeting txs, a 0G Storage KV is read, the **self-hosted classifier endpoint** is called via the existing HTTP Request system action (point at Track D's stub at `http://localhost:<port>/classify`), and an entry is appended to a 0G Storage Log. Green E2E.
>
> Also on Day 1, in parallel: measure 0G testnet block time + RPC latency vs the detection budget, and verify WSS `eth_subscribe` stability (existing `Block`/`Event` triggers depend on it — see §15). If WSS is flaky, design a polling fallback but don't build it yet.
>
> Constraints:
> - Do **not** push or open the upstream PR. The PR to `staging` opens only after the demo is recorded (§7.5).
> - Write `keeperhub/FEEDBACK.md` alongside the work; link to the (still-local) branch.
> - If `/add-plugin` Orchestrator gets stuck, fall through to `/develop-plugin` (todo §7.1 last paragraph). Don't invent a third path.
> - If `@0glabs/0g-ts-sdk` has gaps, wrap raw HTTP and write the SDK fragment yourself (§12 risk #1; budget half a day).
>
> When you finish a chunk, append to the Review section of `tasks/todo.md`. If the user corrects you, update `tasks/lessons.md`.

## Checklist
- [ ] A1. `/add-chain 0G`
- [ ] A2. `/add-plugin 0g-storage` + smoke-test workflow
- [ ] A3. `/add-plugin 0g-compute` + smoke-test against any 0G-served base model
- [ ] A4. Per-tx flow against deployed `FakeLendingPool` (waits on Track B6)
- [ ] A5. Block-time + WSS-stability measurements, written into todo.md Review
- [ ] A6. End-of-Day-1 green E2E workflow
- [ ] A7. `keeperhub/FEEDBACK.md` drafted
