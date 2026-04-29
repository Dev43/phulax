# Phulax — Todo Before Demo

Snapshot date: **2026-04-28**. Synthesized from `tasks/todo.md` Reviews (latest: Track B testnet deploy + Track D Phase-2 real weights, both 2026-04-28) and `checklist.md`. Items are ordered by dependency, so going top-to-bottom unblocks each successive section.

The demo we are shipping is in `STRATEGY.md` §6: a crafted draining tx hits `FakeLendingPool` on 0G Galileo, KeeperHub fires the per-tx workflow, the detection pipeline scores it, and `withdraw()` lands in the same flow — **all on testnet, recorded on video**.

What's already on testnet (don't re-do):
- Contracts deployed on chain id **16602** — Hub `0x573b…498C`, FakeLendingPool `0xb1DE…8747`, PhulaxAccount `0xA700…8a66`, Adapter `0x0c39…C760`, INFT `0xe5c3…1616`, DemoAsset `0x2193…d615`. Agent EOA `0x47d3…6260` funded ~2.5 0G.
- `web/.env.local`, `agent/.env`, KH workflow `FakeLendingPool` slot all wired.
- Real LoRA-merged Qwen2.5-0.5B serving from `inference/server.py` against `ml/artifacts/merged/` (eval: 0.615 P / 0.923 R — below the 0.8/0.6 gate, see §1.5).

---

## 1. Critical path (must land for the demo to work end-to-end)

### 1.1 Find a 0G Galileo WSS endpoint (or polling fallback)
- KeeperHub's `Block` trigger uses `eth_subscribe("newHeads")` (`keeperhub-scheduler/block-dispatcher/chain-monitor.ts`). Without WSS, the workflow never fires.
- Steps:
  1. Probe candidates: `wss://evmws-testnet.0g.ai`, `wss://evmrpc-testnet.0g.ai`, anything documented at https://docs.0g.ai/. Quick test:
     ```bash
     wscat -c wss://<candidate> -x '{"jsonrpc":"2.0","id":1,"method":"eth_subscribe","params":["newHeads"]}'
     ```
  2. If a stable WSS exists → set `CHAIN_0G_TESTNET_PRIMARY_WSS` in `keeperhub/` env and `keeperhub/lib/rpc/rpc-config.ts` config.
  3. If no stable WSS → add a polling fallback to `keeperhub-scheduler/block-dispatcher/chain-monitor.ts` (poll `eth_blockNumber` every 1s, dispatch `Block` event on increment). Half-day budget. Documented in `tasks/todo.md` §15.
- **Owner:** Track A.

### 1.2 Measure block time + RPC latency on Galileo
- `cd keeperhub && pnpm tsx scripts/0g/measure-block-time.ts` once §1.1 lands.
- Capture p50/p95 `eth_getBlockByNumber` + WSS notification stability over 5 minutes.
- Record numbers in `tasks/todo.md` Review and confirm detection finishes inside one block (~2s budget on Galileo).
- **Owner:** Track A.

### 1.3 Host the inference server somewhere KeeperHub can reach
- KH workflow calls `inference/server.py` over HTTP (Track D §10 + workflow JSON). Localhost won't work for a hosted KH run.
- Steps:
  1. `docker build -f inference/Dockerfile -t phulax-inference .` from repo root (per Track D Phase-2 review — Dockerfile copies `ml/prompt/`).
  2. Mount `ml/artifacts/merged/` (~2 GB) at `PHULAX_MODEL_DIR=/app/model` or bake into the image. Set `PHULAX_INFERENCE_HMAC_KEY` (random 32 bytes — also goes into the workflow secret).
  3. Deploy to Fly.io or Railway — single container, CPU is fine for 0.5B Q4. ~$5/mo box. Smoke-test:
     ```bash
     curl -X POST https://<host>/classify -H 'content-type: application/json' \
       -d '{"features":{"selector":"0xa9059cbb","value":"0"}}'
     ```
     Should return `{p_nefarious, tag, model_hash, input_hash, signature}`.
  4. Note the public URL — it goes into the KH workflow `INFERENCE_URL` env (§1.7).
- **Owner:** Track D.

### 1.4 Fund the agent EOA's private key in `agent/.env`
- `agent/.env` has `AGENT_PRIVATE_KEY=` blank (Track B 2026-04-28 review). Without this, `exec/withdraw.ts` cannot sign.
- The address `0x47d3CF2a314aeF4Da43dB8eBC7Eb818bF2496260` is registered as `PhulaxAccount.agent` on chain. Whoever holds the privkey for that address pastes it in.
- Verify: `cd agent && pnpm tsx -e "import {agent} from './src/exec/withdraw'; console.log(agent.address)"` should print `0x47d3…6260`.
- **Risk:** this key has only the `withdraw(adapter)` selector and can only send to `owner` — even if leaked, blast radius is "forced exit", not theft. Still keep it out of git.

### 1.5 Decide: re-train classifier, or ship at 0.615 P / 0.923 R
- Eval gate in `tasks/todo.md` §10 is ≥0.8 P / ≥0.6 R. Current run is recall-leaning, precision-failing.
- **Recommendation: ship as-is** — the aggregator caps classifier-alone contribution at `(0.99 − 0.5) × 0.8 = 0.392`, well below the 0.7 fire threshold. Classifier needs corroboration from invariants/oracle/vector to fire, so its precision matters less than the aggregator's. Document this honestly in the demo voiceover and `ml/eval/REPORT.md`.
- If we want to hill-climb: re-run `ml/finetune/colab_train.ipynb` with 2× RISK augmentation + larger benign sample. ~30 min on a free T4. Owner: Track C.
- Either way, regenerate `ml/eval/REPORT.md` against the merged weights now in `ml/artifacts/merged/`:
  ```bash
  cd ml && uv run python -m eval.harness
  ```

### 1.6 Upload artifacts to 0G Storage and populate `ml/artifacts.json`
- Without CIDs, the iNFT mint has nothing to anchor and the "publish-and-replay" verifiability story is empty.
- Steps:
  1. Set `OG_STORAGE_ENDPOINT` + auth in `ml/.env` (use the org KeeperHub wallet path documented in Track A 2026-04-25 review — Flow contract `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296`).
  2. `cd ml && uv run python -m upload.og_storage` — uploads merged weights, GGUF, dataset, embeddings index, eval report, harness sources. Writes CIDs into `ml/artifacts.json`.
  3. Append a `model_publish` entry to the 0G Storage Log (§10.1 Stage C step 4 — currently missing per Track C 2026-04-26 review). One-line addition to `ml/upload/og_storage.py`.
- **Owner:** Track C.

### 1.7 Fill the remaining KH workflow slots
- `keeperhub/specs/0g-integration/per-tx-detection.workflow.json` still has placeholders:
  - `env.PHULAX_INFERENCE_URL` ← from §1.3
  - `env.PHULAX_INFERENCE_HMAC_KEY` ← from §1.3
  - `env.PHULAX_AGENT_*` (account address, adapter address) ← already in `agent/.env`, copy across
  - 0G Storage KV namespace key for the embedding index ← from `ml/artifacts.json` §1.6
- Verify by importing the workflow into the KH dev project and clicking through field validation.
- **Owner:** Track A.

### 1.8 Track E: swap hand-rolled FakeLendingPool ABI for generated wagmi types
- Track E 2026-04-25 review flagged this as a one-file change post-B8. B8 has shipped (Track B 2026-04-28).
- Replace `agent/src/abis/FakeLendingPool.ts` import to read from `contracts/generated/wagmi.ts`.
- Run `cd agent && pnpm typecheck && pnpm test` — should stay green; if not, the `RawTx` shape may need a tweak (see Track E review).
- **Owner:** Track E.

### 1.9 End-to-end dry run on testnet (the moment of truth)
- Prereqs: §1.1–§1.8 all green.
- Steps:
  1. `cd agent && pnpm dev` — start the SSE server. Verify `/healthz` and that detection fires on the test fixtures.
  2. Import `keeperhub/specs/0g-integration/per-tx-detection.workflow.json` into the KH dev project on the `feature/0g-integration` branch.
  3. Trigger one synthetic block manually (or fire a benign supply tx through `web/`) — expect: `Block` → `query-transactions` returns the tx → `kv-get` reads the embeddings index → HTTP step calls inference → score is logged via `log-append`. No `withdraw` should fire (score < 0.7).
  4. Now run the **demo attack** — script the oracle-manipulation drain from `contracts/test/ExploitReplay.t.sol` against the deployed pool:
     ```bash
     cast send 0xb1DE7278b81e1Fd40027bDac751117AE960d8747 \
       "setAssetPrice(address,uint256)" 0x21937016d3E3d43a0c2725F47cC56fcb2B51d615 1000000000000000000000000 \
       --rpc-url $ZEROG_RPC_URL --private-key $ATTACKER_PRIVATE_KEY \
       --priority-gas-price 2gwei
     # then borrow against inflated collateral
     ```
  5. Confirm `withdraw` lands within ≤1 block, victim recovers ≥99% of principal in `DemoAsset.balanceOf(deployer)`. This is the demo.
- If anything in step 4 fails, **stop and re-plan** rather than patching forward — per global CLAUDE.md "if something goes sideways, STOP".

---

## 2. Demo polish (do these only after §1 is green)

### 2.1 Mint a reference iNFT
- Required by `STRATEGY.md` §9 deliverables ("minted iNFT on 0G explorer, link in README").
- Add `contracts/script/MintINFT.s.sol` that calls `PhulaxINFT.mint(deployer, cid)` where `cid` is the `ml/artifacts.json` `classifier_pointer` from §1.6.
- Run: `forge script script/MintINFT.s.sol --rpc-url zerog_testnet --broadcast --priority-gas-price 2gwei`.
- Capture the explorer URL (`https://chainscan-galileo.0g.ai/token/<INFT-address>?id=<tokenId>`) for the README.

### 2.2 Web Phase 2 — wire deposit/withdraw to `PhulaxAccount`
- Track F review (2026-04-25) Phase 2 deferred until B8. B8 has shipped.
- F3: replace `lib/mock.ts` reads with wagmi hooks against `contracts/generated/wagmi.ts`. Already-laid swap-points are commented in `web/app/page.tsx`.
- F4: `deposit` and `withdraw` buttons call `PhulaxAccount.deposit(adapter, amount)` and `PhulaxAccount.withdraw(adapter)` respectively. DemoAsset is permissionless-mint, so add a "Mint 100 pUSD" button for fresh demos.
- `pnpm type-check && pnpm build` clean before merging.
- **Owner:** Track F.

### 2.3 Web Phase 3 — replace mock SSE with real `/stream` and `/incidents`
- F5: `EventSource('/api/stream')` proxied to `agent/server.ts:GET /stream`. Configure `NEXT_PUBLIC_AGENT_URL`.
- F6: `/incidents/:account` proxy in `web/app/api/incidents/[account]/route.ts` → forwards to `agent/server.ts:GET /incidents/:account` which reads from 0G Storage Log.
- F8: `POST /feedback` button writes to iNFT memory via the agent.
- **Owner:** Track F.

### 2.4 Add fixture replays for vulns #2–#5
- `agent/test/fixtures/exploits.ts` has 7 fixtures, all variants of vuln #1. Each new vuln is one fixture (see Track B 2026-04-26 review for tier mapping):
  - #2 reentrancy → invariants tier (`Σ Transfer > supplied`)
  - #3 flash-loan → vector tier + oracle tier
  - #4 liquidation → oracle (negative deviation) + classifier
  - #5 admin rug → classifier only
- Each fixture is a `TxContext` shape, replayable through `detect()`. Re-run `pnpm test`; expect 13/13 green.
- **Owner:** Track E. Defer to last hour if time-pressed — the demo only shows vuln #1 live.

### 2.5 Record the demo video (<3 min)
- Script per `STRATEGY.md` §6: pool with protected position → attacker tx hits → KH workflow fires → classifier + vector both score → withdraw lands → "attack tx still landed, pool drained, we're not in it".
- Capture: terminal split with `agent` SSE log on the left, `web/` dashboard on the right, KH workflow run page underneath. Voiceover explains the stack.
- One-take Loom is fine per §9 ("Loom of the local fork run is fine"). Try for testnet, fall back to local fork only if testnet flakes.

### 2.6 README + FEEDBACK.md
- Top-level `README.md`: one-command setup, deployed addresses (already captured §1), explorer links for INFT, architecture diagram (the ASCII one in `tasks/todo.md` §3 is fine), explicit list of 0G + KeeperHub features used with file:line pointers (per §9 deliverables).
- Restore `keeperhub/FEEDBACK.md` (Track A 2026-04-25 review noted it was dropped from the branch). Describe the SDK-backed shape, org-wallet signing through the Flow contract, and the per-tx primitive (`Block` + `web3/query-transactions`). One page.

### 2.7 STRATEGY.md edits queued (from `checklist.md`)
- §2(b): tighten to "LoRA-only fine-tune of Qwen2.5-0.5B-Instruct as a structured classifier".
- §3 / §10: note 0G Storage writes are signed by org KeeperHub wallet via Flow contract `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296`, not bearer auth.
- §5 Day 3: link to `ml/README.md` for run order instead of restating it.
- §2(a): tighten to reference the five-vuln matrix (Track B 2026-04-26 note).

---

## 3. After the demo is recorded — do not start before

- Open the upstream KeeperHub PR from `feature/0g-integration` to `staging` (per `tasks/todo.md` §7.5). PR title: `feat(0g): add 0G chain + storage + compute integration`. Link to `keeperhub/FEEDBACK.md`. Run `pnpm check && pnpm type-check && pnpm fix` from the submodule before pushing.
- Twitter chatter scraper (Day-4 tiebreaker) — defer to post-demo unless judges specifically ask for the secondary signal.

---

## Cuts (explicitly not doing for v1, per `STRATEGY.md` §8 / `tasks/todo.md` §13)

- ❌ x402 / MPP autonomous payment — one-line README roadmap mention only.
- ❌ Multi-chain — 0G testnet (Galileo, 16602) only.
- ❌ Fancy frontend — one screen, streaming logs is the credibility moment.
- ❌ Standalone exploit-classifier ML beyond the structured Qwen head — vector similarity is the headline novelty.
- ❌ Governance/admin-key tier as a live signal — captured in vuln #5 fixture and that's it.

---

## Demo-day operational checklist

Run through this once §1 is green, then again 1 hour before recording:

- [ ] Galileo RPC reachable (`cast block-number --rpc-url $ZEROG_RPC_URL`)
- [ ] Agent EOA balance ≥ 0.5 0G (`cast balance 0x47d3...6260 --rpc-url $ZEROG_RPC_URL`)
- [ ] Inference server `/healthz` returns 200 from a public URL
- [ ] KH workflow imported, all env slots green, last test fire was successful
- [ ] `agent/server.ts` running, `/stream` open in a browser tab
- [ ] `web/` running, wallet connected, position visible
- [ ] DemoAsset balance freshly minted to the demo "victim" wallet
- [ ] Attacker wallet funded with ~0.05 0G for gas
- [ ] Screen recording set up — three panels visible: terminal logs, web UI, KH run page
- [ ] Backup plan: local Anvil fork ready if testnet is flaky during recording
