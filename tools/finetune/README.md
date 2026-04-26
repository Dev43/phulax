# `tools/finetune` — 0G fine-tuning driver

TypeScript wrapper over [`@0glabs/0g-serving-broker`](https://github.com/0gfoundation/0g-serving-user-broker) that submits the Phulax classifier dataset to 0G Compute, polls progress, and decrypts the LoRA adapter.

This package lives **outside** `agent/` to preserve the runtime invariant that *only* `agent/src/exec/withdraw.ts` signs transactions (`CLAUDE.md`). Use a dedicated funding key — never the agent's runtime key.

## Pipeline contract

This package consumes:

- `ml/artifacts/og-ft/dataset.jsonl` — JSONL in instruction/input/output shape, emitted by `python -m finetune.og_emit`.
- `ml/artifacts/og-ft/manifest.json` — `{rows, sha256, template_version, label_distribution, base_model}`. Submit cross-checks the sha256 against the file.

It produces:

- `ml/artifacts/og-ft/training-config.json` — the locked 0G config (rigid schema, see `src/config.ts:LOCKED_TRAINING_CONFIG`).
- `ml/artifacts/og-ft/run.json` — `{taskId, provider, datasetHash, templateVersion, submittedAt, deadlineAt, acknowledgedAt, decryptedAt, …}`. Single source of truth across `submit → poll → ack`.
- `ml/artifacts/og-ft/encrypted/<taskId>.bin` — encrypted adapter from the provider.
- `ml/artifacts/lora/adapter_model.safetensors` — decrypted LoRA adapter (consumed by `python -m finetune.merge_and_quantize`).

## Run order

```bash
pnpm --filter @phulax/finetune install
# (one-time) discover providers, pin one
pnpm --filter @phulax/finetune discover

# fund the ledger + provider sub-account (idempotent)
pnpm --filter @phulax/finetune fund -- --provider 0xPROV

# build the dataset upstream:
( cd ml && uv run python -m data.build_dataset && uv run python -m finetune.og_emit )

# submit the job
pnpm --filter @phulax/finetune submit -- --provider 0xPROV

# in another terminal, the watchdog (defends 48h deadline)
pnpm --filter @phulax/finetune safety-cron

# poll until Finished, then ack + decrypt
pnpm --filter @phulax/finetune poll
pnpm --filter @phulax/finetune ack
```

## Why a separate workspace

- Keeps the broker SDK's `Wallet` signer out of the agent runtime container.
- Keeps fine-tuning offline-only — nothing here is in the hot path.
- Mirrors `ml/scripts/og.mjs`'s pattern: small TS island that the Python `ml/` pipeline shells into when 0G is required.

## Environment

Set these in your shell or in `ml/.env` (the Python pipeline shares the file):

- `PHULAX_FT_PRIVATE_KEY` — funded 0G testnet wallet that submits jobs.
  **Must not be the agent runtime key.**
- `PHULAX_FT_RPC_URL` — defaults to `https://evmrpc-testnet.0g.ai`.
