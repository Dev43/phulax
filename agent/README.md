# `agent/` — Phulax detection service

Stateless TypeScript HTTP service (Node 20 + viem + fastify) that exposes the 4-tier detection pipeline as two endpoints. **KeeperHub owns the per-block loop and signs the withdraw**; this service holds zero private keys and never broadcasts a transaction. The runtime container has no signing surface.

The flow: KH `Block` trigger → `web3/query-transactions` (filter pool txs) → `POST /detect-features` (this service, runs tier 1/2/3) → `POST /classify` (the inference endpoint, tier 4 — this is the slot where 0G sealed inference plugs in once it serves our LoRA) → `POST /decide` (this service, aggregates) → conditional `web3/write-contract` for `PhulaxAccount.withdraw` (signed by KH org wallet, the on-chain `agent` role) → `0g-storage/log-append` receipt. See `workflows/phulax-guardian.workflow.json` for the wired-up shape.

## Source layout

```
src/
├── detection/      # 4 pure tiers — invariants, oracle dev, vector sim, classifier
│   ├── invariants.ts   tier 1 (~5 ms)   "math broke"
│   ├── oracle.ts       tier 2           pool price vs. Chainlink/TWAP > 2 %
│   ├── vector.ts       tier 3 (~100 ms) cosine similarity vs. 0G KV exploit corpus
│   ├── classifier.ts   tier 4 (~300 ms) signal-merge helper for receipts from inference/
│   ├── detect.ts       aggregator      max-across-block, weighted, capped
│   └── hydrate.ts      ALL I/O isolated here so detect() stays pure
├── risk/           # threshold logic + iNFT-policy override
├── og/             # 0G Storage client (kv.ts + log.ts over og/http.ts)
├── server.ts       # /detect-features + /decide + /feedback + /incidents/:account
└── chain/          # viem read-only client (no wallet) + typed ABIs
```

`detect(ctx) -> Score` is pure — no I/O, no side effects. A purity test asserts repeated calls return deep-equal output. Any historical exploit can be replayed through it as a regression by populating a `TxContext` fixture.

## Common commands

```bash
pnpm install
pnpm test             # vitest run (9/9 fixture replays + purity test)
pnpm test:watch
pnpm typecheck        # tsc --noEmit, strict (noUncheckedIndexedAccess)
pnpm dev              # tsx watch src/index.ts — boots the SSE server
pnpm build && pnpm start
```

Run a single fixture: `vitest run path/to/file.test.ts -t "name"`.

## Environment

Set in `agent/.env` (see `.env.example`):

- `RPC_URL` — `https://evmrpc-testnet.0g.ai` for Galileo. Read-only — used by `hydrate()` for blockN/N-1 reads.
- `CHAIN_ID` — `16602` (Galileo).
- `POOL_ADDRESS` — `FakeLendingPool` from the `Deploy.s.sol` broadcast.
- `CLASSIFIER_URL` — public URL of `inference/server.py`. Note: in the new flow KH calls this directly; this service no longer hits it from inside `hydrate()`. The env var stays for local replays/tests where the agent reconstructs the full pipeline end-to-end.
- `OG_STORAGE_*` — KV (vector lookup) + Log (incident receipts).

No `AGENT_PRIVATE_KEY` — the on-chain `agent` role is held by the KeeperHub org wallet (`0x47d3CF2a314aeF4Da43dB8eBC7Eb818bF2496260`), Turnkey-custodied. KH's `web3/write-contract` step in `workflows/phulax-guardian.workflow.json` does the signing.

## Detection pipeline tier weights (locked)

```
score = clamp01(
    0.8  * (invariant violated ? 1 : 0)        // tier 1 — decisive on its own
  + 0.2  * min(1, |oracle dev pct| / 0.05)     // tier 2 — 5 % deviation = full weight
  + 0.3  * (top-1 cosine ≥ 0.85 ? 1 : 0)       // tier 3 — vector sim
  + 0.8  * max(0, p_nefarious − 0.5)           // tier 4 — capped so classifier alone < 0.7
)
```

Threshold default is `0.7`, settable per user via `Hub.setRiskPolicy`. Classifier-alone contribution caps at `0.392`, so a fire always requires corroboration from at least one other tier — by design.

## Why no database

0G Storage (KV for the embedding index, Log for the per-fire reproducibility ledger) IS the database. Per-fire receipts `(input_hash, output, model_hash, signature)` get appended to a 0G Storage Log so any third party with `ml/artifacts.json` CIDs can replay the call against the published merged weights and verify. This is the "publish-and-replay" replacement for sealed inference (`STRATEGY.md` §3 + `tasks/todo.md` §10).

## See also

- `tasks/todo.md` §3 — architectural invariants the agent must not violate.
- `tasks/todo.md` §6 — detection-pipeline spec.
- `tasks/todo.md` §7 — KeeperHub bridge work this agent depends on.
- `inference/README.md` — the classifier endpoint this agent calls per fire.
