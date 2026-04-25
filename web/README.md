# `web/` — Phulax demo dashboard

Next.js 14 (App Router) · Tailwind · wagmi v2 + viem.

**Phase 1 (current): static mock.** All data is synthetic. The fake SSE stream
lives in `lib/mock.ts` and is driven by a `setInterval` in `app/page.tsx`.

## Run

```bash
cd web
pnpm install
pnpm dev
```

Then open http://localhost:3000 and click **Demo: simulate attack** — the risk
gauge spikes, the streaming log panel writes the fire sequence, and a new
incident appears at the top of the timeline.

## Layout

```
app/
  layout.tsx       root + providers
  providers.tsx    wagmi + react-query
  page.tsx         the one screen
components/
  connect-bar.tsx        connect wallet, show PhulaxAccount + position
  position-card.tsx      deposit/withdraw stubs (phase 2)
  risk-gauge.tsx         live needle, bar, threshold marker, signal weights
  incident-timeline.tsx  pulled from 0G Storage Log in phase 3
  log-stream.tsx         terminal-styled streaming logs (the credibility moment)
  feedback-toggle.tsx    POSTs to /feedback in phase 3
  ui/                    shadcn-style primitives (Button, Card)
lib/
  mock.ts          fake stream + incidents
  wagmi.ts         0G testnet chain + injected connector
  utils.ts
```

## Phase 2 — wire reads + writes

After Track B (contracts) deploys to 0G testnet and emits ABIs:

- generate `wagmi.config.ts` → typed hooks from Foundry artifacts
- replace `MOCK_BALANCE` / `MOCK_ACCOUNT` with `useReadContract` against
  `PhulaxAccount` + the `FakePoolAdapter`
- wire `PositionCard` deposit/withdraw to `useWriteContract`

## Phase 3 — wire stream + incidents

After Track E7 ships `agent/server.ts`:

- replace `setInterval(fakeStreamTick…)` with `new EventSource("/stream")`
  against `NEXT_PUBLIC_AGENT_BASE_URL`
- replace `MOCK_INCIDENTS` with a fetch of `GET /incidents/:account`
- wire `FeedbackToggle` → `POST /feedback`

## Constraints (per `tasks/todo.md` §4 + §8)

- **No backend in `web/`.** State lives on-chain + 0G Storage + agent SSE.
- **One screen only.** Auth, charts, history pages, mobile UX are deferred.
- TypeScript only.
