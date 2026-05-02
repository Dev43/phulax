# `agent/` — Phulax guardian runtime

TypeScript guardian (Node 20 + viem + fastify) that watches a lending pool, scores transactions through a 4-tier detection pipeline, and pulls user funds out via `PhulaxAccount.withdraw(adapter)` when the score crosses the iNFT-policy threshold. KeeperHub fires this off as part of the per-tx workflow on every 0G block.

This is **the only signing surface in the runtime container.** `src/exec/withdraw.ts` is the only module that holds a private key, can only call `withdraw(adapter)`, and the contract hard-codes the recipient to `owner`. Even if the agent key leaks, the blast radius is "user gets force-exited", not theft (see `tasks/todo.md` §3 invariants).

## Source layout

```
src/
├── detection/      # 4 pure tiers — invariants, oracle dev, vector sim, classifier
│   ├── invariants.ts   tier 1 (~5 ms)   "math broke"
│   ├── oracle.ts       tier 2           pool price vs. Chainlink/TWAP > 2 %
│   ├── vector.ts       tier 3 (~100 ms) cosine similarity vs. 0G KV exploit corpus
│   ├── classifier.ts   tier 4 (~300 ms) HTTP call to inference/server.py
│   ├── detect.ts       aggregator      max-across-block, weighted, capped
│   └── hydrate.ts      ALL I/O isolated here so detect() stays pure
├── risk/           # threshold logic + iNFT-policy override
├── og/             # 0G Storage client (kv.ts + log.ts over og/http.ts)
├── keeperhub/      # workflow defs + thin MCP client
├── exec/withdraw.ts   # the ONLY module that signs (single selector)
├── server.ts          # /stream (SSE) + /incidents/:account + /feedback + /detect-batch
└── chain/             # viem clients + typed ABIs (re-exported from contracts/generated/wagmi.ts)
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

- `RPC_URL` — `https://evmrpc-testnet.0g.ai` for Galileo. WSS is `wss://evmrpc-testnet.0g.ai/ws/` (trailing slash matters — see CLAUDE.md sharp edges).
- `CHAIN_ID` — `16602` (Galileo).
- `POOL_ADDRESS`, `PHULAX_ACCOUNT_ADDRESS`, `PHULAX_ADAPTER_ADDRESS`, `HUB_ADDRESS`, `DEMO_ASSET_ADDRESS` — populated from the `Deploy.s.sol` broadcast.
- `AGENT_PRIVATE_KEY` — funds the single-selector `withdraw` calls. Must hold the key for the address registered as `PhulaxAccount.agent` (`0x47d3CF2a314aeF4Da43dB8eBC7Eb818bF2496260` on the current testnet deploy). Blast radius is forced exit — keep it out of git anyway.
- `INFERENCE_URL` + `PHULAX_INFERENCE_HMAC_KEY` — public URL of `inference/server.py` and the HMAC key used to verify receipts.
- `OG_STORAGE_*` — KV + Log endpoints for the 0G Storage client.

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
