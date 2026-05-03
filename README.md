# Phulax

*Protect. Detect. Withdraw.*

An autonomous on-chain guardian agent that watches your DeFi yield position and pulls your funds out before an attacker drains the pool.

[![Built on 0G](https://img.shields.io/badge/built%20on-0G%20Galileo-7C5CFF)](https://chainscan-galileo.0g.ai/) [![KeeperHub](https://img.shields.io/badge/orchestrated%20by-KeeperHub-22D3EE)](https://keeperhub.com/) [![iNFT](https://img.shields.io/badge/owned%20as-ERC--7857%20iNFT-F43F5E)](#owned-as-an-inft) [![License: MIT](https://img.shields.io/badge/License-MIT-34D399)](LICENSE)

---

## TL;DR

You deposit into a yield pool. Phulax watches every Galileo block. The instant a transaction matches a known exploit pattern - or scores high on a fine-tuned classifier - the guardian fires `withdraw()` on the user's smart wallet and the funds return to the owner before the drain settles.

The agent key can call exactly one function. The contract enforces it.

---

## Demo

| Link | What it is |
|---|---|
| **Demo video** - ./Phulax.mp4 | 3-min walkthrough. Protected position → attacker fires the drain → KeeperHub picks it up the same block → all four detection tiers light up → agent fires `withdraw` → funds return to owner. The pool still drains; we're just not in it. |
| **Live dashboard** - / | The web app on 0G Galileo. Connect a wallet, see your protected position, watch the live risk gauge and the streaming log panel as txs flow through the detection pipeline. |
| **KeeperHub workflow** - / | The 9-node guardian workflow on KeeperHub. `Block` trigger → `web3/query-events` filter → 4-tier detection → `withdraw` via private routing → `0g-storage/log-append` of the signed receipt. JSON in [`workflows/phulax-guardian.workflow.json`](workflows/phulax-guardian.workflow.json). |
| **Frontend** - /web | Frontend to see what the agent is doing. |
| **Informational** - /web/what-is-it | Informational page. |

---

## What it is

Six packages in a pnpm monorepo:

| Path | What it is |
|------|------------|
| [`keeperhub/`](keeperhub/) | Our fork of KeeperHub on `feature/0g-integration`. Adds 0G as a chain, plus first-class `0g-storage` and `0g-compute` plugins. |
| [`contracts/`](contracts/) | Foundry. `PhulaxAccount`, `Hub`, `PhulaxINFT` (ERC-7857), `FakeLendingPool` with 5 intentional vulns, each with a working forge exploit test. |
| [`ml/`](ml/) | Offline pipeline (uv): dataset, frozen prompt, LoRA fine-tune, merge + quantize, embeddings indexer, eval harness, 0G Storage upload. |
| [`inference/`](inference/) | FastAPI classifier endpoint. Real merged Qwen2.5-0.5B + LoRA when `PHULAX_MODEL_DIR` is set; deterministic stub otherwise. HMAC receipts on every fire. |
| [`agent/`](agent/) | TypeScript guardian (Node 20, viem, fastify). Detection pipeline + risk aggregator + KeeperHub workflow client + withdraw executor + SSE log stream. |
| [`web/`](web/) | Next.js 14 dashboard: position → live risk gauge (SSE) → streaming logs → incident timeline. |

Plus [`tools/finetune/`](tools/finetune/) - a separate workspace driving the 0G fine-tuning broker. Lives outside the agent on purpose so the runtime container only ever has one signing surface.

---

## Architecture

![Architecture](docs/img/architecture.png)

---

## How detection works

![Detection pipeline](docs/img/detection-pipeline.png)

Four tiers, ranked by signal-to-noise. `detect(tx, ctx) -> Score` is pure - no I/O, no side effects - so any historical exploit replays through it as a regression test.

1. **Invariants** - share-price monotonicity, solvency, utilization. Cheap, hard to fool.
2. **Oracle deviation** - pool's read price vs Chainlink / DEX TWAP / spot. Catches Mango / Cream / Inverse class directly.
3. **Vector similarity** - embed calldata + state delta, cosine against an index of historical exploits on **0G Storage KV**. Catches mutations of known patterns.
4. **Classifier** - Qwen2.5-0.5B + LoRA, fine-tuned on a labelled nefarious-vs-benign corpus. Returns `p_nefarious`. Picks up novel patterns the vector tier misses.

Aggregator fuses all four into a single risk score with hysteresis. Cross the threshold → fire.

---

## The KeeperHub workflow

![Workflow](docs/img/workflow.png)

Nine nodes, exported as [`workflows/phulax-guardian.workflow.json`](workflows/phulax-guardian.workflow.json). Pattern is `Block` trigger + `web3/query-events` filter, not a per-tx trigger written from scratch. KeeperHub owns the loop; the agent is stateless logic it calls over HTTP.

Every `withdraw()` is paired with a `0g-storage/log-append` step that writes the signed receipt - verifiability turned into a workflow node.

---

## Owned as an iNFT

![iNFT](docs/img/inft.png)

The agent isn't a SaaS account. It's an ERC-7857 iNFT minted per user. Policy, memory, and model pointer travel with the holder. Transfer the iNFT, the new owner inherits the guardian.

Verifiability is publish-and-replay:

- Weights on 0G Storage with their sha256.
- Eval harness checked in.
- Every fire writes a HMAC-signed `(input_hash, output, model_hash, signature)` receipt to a 0G Storage Log.

You don't have to trust us. You can replay any decision end-to-end.

---

## Live deployment (0G Galileo, chain id 16602)

| Contract | Purpose | Address |
|----------|---------|---------|
| Hub | Registers users, attaches adapters, sets risk policy | [`0x573b9E…498C`](https://chainscan-galileo.0g.ai/address/0x573b9Ec4BB93bbDA59C0DBA953831d58fC36498C) |
| PhulaxINFT | ERC-7857 guardian iNFT, one per user | [`0xe5c3e4…1616`](https://chainscan-galileo.0g.ai/address/0xe5c3e4b205844EFe2694949d5723aa93B7F91616) |
| PhulaxAccount | Smart wallet, agent can ONLY call `withdraw(adapter)` | [`0xA70060…8a66`](https://chainscan-galileo.0g.ai/address/0xA70060465c1cD280E72366082fE20C7618C18a66) |
| FakeLendingPool | Aave-inspired demo pool with 5 intentional vulns | [`0xb1DE72…8747`](https://chainscan-galileo.0g.ai/address/0xb1DE7278b81e1Fd40027bDac751117AE960d8747) |
| FakePoolAdapter | Adapter to `FakeLendingPool` | [`0x0c39fF…C760`](https://chainscan-galileo.0g.ai/address/0x0c39fF914e41DA07B815937ee70772ba21A5C760) |
| DemoAsset (pUSD) | Permissionless-mint demo token | [`0x219370…d615`](https://chainscan-galileo.0g.ai/address/0x21937016d3E3d43a0c2725F47cC56fcb2B51d615) |
| Agent EOA | The single-selector guardian key | [`0x47d3CF…6260`](https://chainscan-galileo.0g.ai/address/0x47d3CF2a314aeF4Da43dB8eBC7Eb818bF2496260) |

Broadcast log: [`contracts/broadcast/Deploy.s.sol/16602/run-latest.json`](contracts/broadcast/Deploy.s.sol/16602/run-latest.json).

---

## Quickstart

```bash
git clone --recurse-submodules <repo-url> phulax
cd phulax
pnpm install

# run the agent + classifier + KeeperHub locally
docker compose up

# in another terminal, fire the dashboard
pnpm --filter @phulax/web dev
# open http://localhost:3000
```

Per-package commands live in each package's `README.md` and in [`CLAUDE.md`](CLAUDE.md). The 0G ↔ KeeperHub bridge lives in [`keeperhub/`](keeperhub/) on `feature/0g-integration` - follow [`keeperhub/CLAUDE.md`](keeperhub/CLAUDE.md) inside that submodule.

Re-render the diagrams: `python3 scripts/render_diagrams.py` - pure matplotlib, no graphviz.

---

## Repo layout

```
phulax/
├── contracts/        - Foundry: PhulaxAccount, Hub, INFT, FakeLendingPool (5 vulns)
├── agent/            - TS guardian: detection + aggregator + executor + SSE
├── inference/        - FastAPI classifier (Qwen2.5-0.5B + LoRA + HMAC receipts)
├── ml/               - Python pipeline: dataset, fine-tune, eval, 0G upload
├── tools/finetune/   - 0G fine-tuning broker driver (separate signer)
├── web/              - Next.js 14 dashboard
├── keeperhub/        - submodule: KeeperHub fork with 0G integration
├── workflows/        - KeeperHub workflow JSON exports
├── docs/img/         - architecture diagrams
├── scripts/          - render_diagrams.py + helpers
├── STRATEGY.md       - what & why
├── tasks/todo.md     - how & in what order
├── VIDEO_SCRIPT.md   - 3-min demo script
└── CLAUDE.md         - coding rules + sharp edges
```

---

## Built with

- **0G** - chain (Galileo), Storage (KV + Log), Compute, fine-tuning broker.
- **KeeperHub** - workflow runtime, private routing, retry, gas optimisation.
- **Foundry** - contracts + fuzz invariants.
- **Qwen2.5-0.5B + PEFT/LoRA** - classifier base, fine-tuned on a free Colab T4.
- **viem + fastify** - agent runtime.
- **Next.js 14** - dashboard.
- **FastAPI + transformers** - classifier endpoint.
- **uv** - Python toolchain for `ml/`.

---

Phulax - Greek φύλαξ, *guardian*. Built for the EthGlobal Open Agents hackathon, 2026.
