# Track F — Next.js demo dashboard

Mock immediately. Real data flows in once Track B has ABIs and Track E has the SSE stream.

## Dispatch prompt

> You are working on the Phulax hackathon project. Before writing any code, read `STRATEGY.md` (especially §6 demo script and §8 cuts), `tasks/todo.md` (especially §4, §8, §11 Day 4), and the root `CLAUDE.md`. `tasks/todo.md` wins on conflicts.
>
> Your job is to build `web/` — a Next.js 14 (App Router) demo dashboard. wagmi v2 + viem + Tailwind + shadcn/ui. **The scope is deliberately small** (STRATEGY §8 explicitly cuts a "fancy frontend"). One screen, one job: make the agent's thinking visible to a judge in <30 seconds.
>
> The one screen contains, top-to-bottom:
>
> 1. **Connect wallet** + show the user's `PhulaxAccount` address and balance.
> 2. **Deposit / withdraw** buttons against the FakeLendingPool via the account.
> 3. **Live risk gauge** fed by SSE from `agent/server.ts`'s `GET /stream` (Track E's E7). This is the live needle — must update visibly when a draining txn enters the mempool.
> 4. **Incident timeline** pulled from `GET /incidents/:account` (proxied from 0G Storage Log).
> 5. **Streaming logs panel** — terminal-styled, monospace, auto-scrolling. **This is the credibility moment** (todo §8). Judges need to *see* invariant violations / vector matches / classifier outputs flowing past in real time.
> 6. **FP-feedback toggle** that POSTs to `agent/server.ts`'s `/feedback`.
>
> **Defer (do not build):** auth, multi-account UX, charts, history pages, mobile responsiveness, settings UI for thresholds (those live in iNFT metadata).
>
> **Phase 1 (do this immediately): static mock.**
> - Scaffold Next.js + Tailwind + shadcn.
> - Stub the entire screen with hardcoded fake data. SSE stream can be a setInterval pushing fake events.
> - This establishes layout + visual language so Day-4 wiring is just swapping data sources.
>
> **Phase 2 (after Track B6 deploys + B8 emits ABIs):**
> - Import typed ABIs from Foundry artifacts via the generated `wagmi.config.ts`.
> - Wire wallet connect + account reads + deposit/withdraw calls.
>
> **Phase 3 (after Track E7 ships the SSE endpoint):**
> - Replace fake stream with real SSE from `agent/server.ts`.
> - Replace incident timeline mock with real `GET /incidents/:account`.
> - Wire the FP-feedback toggle.
>
> Constraints:
> - **No backend in `web/`.** State is on-chain + 0G Storage + the agent's SSE. The Next.js app is a thin reader.
> - One-language rule: TypeScript. No Python, no auxiliary services.
> - Don't push or deploy without explicit user confirmation. Demo deploys to Railway/Fly per todo §2.
>
> When you finish a chunk, append to the Review section of `tasks/todo.md`. If the user corrects you, update `tasks/lessons.md`.

## Checklist
- [ ] F1. Scaffold (Next.js 14 App Router, Tailwind, shadcn, wagmi v2, viem)
- [ ] F2. Static mock of the one screen with fake SSE + fake timeline
- [ ] F3. Wallet connect + `PhulaxAccount` reads via wagmi + Foundry ABIs
- [ ] F4. Deposit / withdraw buttons wired to the account
- [ ] F5. Live SSE risk gauge against `agent/server.ts`
- [ ] F6. Incident timeline from 0G Storage Log proxy
- [ ] F7. Streaming logs panel (terminal-styled)
- [ ] F8. FP-feedback toggle posts to `/feedback`
