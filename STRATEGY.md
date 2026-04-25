# Phulax — Hackathon Strategy

**Project codename:** Phulax (Greek φύλαξ, "guardian")
**One-liner:** An autonomous on-chain guardian agent that detects DeFi exploits in real time and pulls your funds out before the attacker drains the pool. Sleep while you yield.

---

## 0. Prerequisite — 0G ↔ KeeperHub does not exist yet

> **Read this first.** KeeperHub today has **zero** integration with the 0G chain. Before any of the Phulax-specific work below is possible, we have to build that bridge ourselves. This is the single biggest unknown in the project and the first thing we ship.
>
> Concretely we need KeeperHub workflows to be able to:
> - call **0G Storage** (KV reads/writes, Log appends) as first-class workflow steps
> - call **0G Compute** sealed-inference endpoints (vector similarity + the fine-tuned classifier) as first-class workflow steps
> - sign / submit transactions on 0G chain from inside a KeeperHub action
>
> Until this bridge exists, the per-txn trigger workflow that the rest of the strategy depends on cannot be written. Day 1 of the build plan is dedicated to it.

---

## 1. The idea

A user deposits into a yield protocol (an Aave-inspired fake lending pool for the demo) through a **Phulax Account** — a smart contract wallet with a strict 2-party permission model:

- **Owner key (you):** full control — deposit, withdraw, swap, change adapters, revoke the agent.
- **Agent key (Phulax):** can ONLY call `withdraw(adapter)`. Cannot transfer to arbitrary addresses, cannot swap, cannot upgrade. Funds always return to the owner's address.

A **main hub contract** acts as the link between users (OpenClaw-style). Users set up their account through it, plug in **adapters** (one per protocol), and the only action the agent is ever authorised to take is `withdraw`.

A separate **iNFT (ERC-7857)** is minted per user and is linked to the shared fine-tuned model that powers our **Guardian Agent**. The agent runs a KeeperHub workflow on every transaction sent to the monitored pool, scores risk, and if risk exceeds the user's threshold it triggers the agent key to withdraw. Withdrawals are routed through **KeeperHub** for guaranteed, private (non-frontrunnable) execution.

**Abstracted-account mode:** the same primitive lets a protocol under attack force a coordinated exit for all opted-in users.

---

## 2. Detection — vector DB + a 0G fine-tuned classifier

Two complementary cores, both running on 0G:

**(a) Vector DB of historical attacks.** Embed each historical exploit as `{calldata pattern, state delta, protocol class, root cause tag}`. Store on **0G Storage** as a KV index + append-only Log of incidents. New tx → embed → cosine similarity against the corpus → if top-k matches exceed a threshold, escalate. The DB doubles as a **fuzz-testing corpus** against live protocols.

**(b) 0G fine-tuned txn classifier.** Fine-tune a model on 0G over a labelled corpus of nefarious vs benign txns touching lending/yield pools. At inference time the model returns a `p(nefarious)` score that feeds into the risk aggregator alongside the vector-similarity signal. The vector DB gives us *"does this look like a known attack?"*; the fine-tuned model gives us *"does this look nefarious at all?"* — together they cover known-class mutations and novel patterns.

**Trigger workflow (KeeperHub).** We register a **KeeperHub workflow** that fires per-transaction on the monitored fake lending pool. The workflow runs the detection pipeline (invariants → oracle deviation → vector similarity → 0G fine-tuned classifier) and, if risk crosses the threshold, calls `withdraw` through KeeperHub's private routing in the same flow.

### Detection tiers (ranked by signal-to-noise)

1. **Invariant watchers** — per-block checks: solvency, utilization, collateral factor drift, `totalSupply` vs reserves, vault share price monotonicity. Reliable, ~12s post-inclusion. **Build this first.**
2. **Oracle-deviation monitors** — protocol's read price vs Chainlink / DEX TWAP / CEX spot. Catches the Mango / Cream / Inverse class directly.
3. **Social chatter (Twitter/X, Farcaster, Discord)** — scrape for hack chatter on monitored protocols; on a hit, withdraw out of abundance of caution. Tiebreaker, not a primary signal.
4. **Governance/admin-key monitoring** — timelock queues, delegate shifts, proxy upgrades, role grants. Slow-moving but catches rug-class events.

The agent also reasons about **second- and third-order effects** (e.g. a KeplDAO-style hit propagating into Aave collateral) before firing.

---

## 3. Action plan by component

### Smart contracts
- **PhulaxAccount** — minimal smart-contract wallet with the 2-party permission model (owner = full; agent = `withdraw(adapter)` only; funds return to owner).
- **Hub contract** (OpenClaw-style) — link between users and adapters. Users register, attach adapters, set risk policy.
- **Fake lending pool** — Aave-inspired, intentionally simple, with hooks we can attack (oracle manipulation, drain-via-single-tx) for the demo.
- **Adapter** — one adapter against the fake pool, normalised `deposit` / `withdraw` interface.
- **iNFT (ERC-7857)** — separate contract from PhulaxAccount; each user's guardian is minted as an iNFT embedding:
  - risk policy (thresholds, whitelisted protocols)
  - adapter set
  - learned per-user preferences (false-positive feedback)
  - pointer into 0G Storage for memory/incident log
  - link to the shared fine-tuned classifier
- **Fee / royalty split** — the agent takes **10% of the yield** generated for the user (e.g. 0.5 percentage points of a 5% APY). Auto-split via the iNFT to (a) Phulax treasury, (b) framework devs, (c) referrer.

### 0G integrations
- **0G Storage** — vector DB of attack embeddings (KV for similarity index, Log for append-only per-user incident history). Also backs iNFT memory.
- **0G Compute (sealed inference)** — run the risk-scoring LLM call (e.g. qwen3.6-plus) verifiably. The user doesn't have to trust us; the scoring is attestable.
- **0G fine-tuning** — fine-tune a single shared txn classifier on a labelled nefarious-vs-benign corpus and serve it through sealed inference, so both the weights and the scoring are verifiable. Every user's iNFT links to this same model.

### KeeperHub integration
- **0G ↔ KeeperHub bridge (does not exist yet — build this first)** — add 0G chain support and 0G actions into KeeperHub: 0G Storage reads/writes, 0G Compute sealed-inference calls, and 0G chain tx signing, all callable from inside a workflow. Everything else in this section depends on this landing.
- **Trigger workflow** — fires per-transaction on the fake lending pool and runs the full detection pipeline (invariants → oracle deviation → vector similarity → 0G fine-tuned classifier). One primitive covers *"when to check"*.
- **Execution layer** — on a threshold breach the same workflow calls `withdraw` through the KeeperHub MCP server: guaranteed execution, private routing (non-frontrunnable), retry on failure, gas-optimised.
- **Autonomous payment** — the agent pays for KeeperHub usage via **x402** or **MPP** at fire time.


### Off-chain guardian agent
- Driven by the KeeperHub per-txn trigger above (no separate block/mempool listener).
- Aggregator that combines invariant / oracle / vector-similarity / 0G-classifier signals into one risk score.
- Second- and third-order effect reasoning before firing (e.g. KelpDAO-style propagation into Aave collateral).
- Twitter/X chatter scraper as a secondary tiebreaker signal.


---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER (owner)                            │
└──────────────────────┬──────────────────────────────────────────┘
                       │ deposits / configures policy
                       ▼
        ┌──────────────────────────────────┐
        │   PhulaxAccount (smart wallet)   │
        │   - owner: full control          │
        │   - agent: withdraw() ONLY       │◄──────── iNFT (ERC-7857)
        │   - adapters: [Aave, Morpho,...] │           ├─ policy
        └──────────────────────────────────┘           ├─ adapters
                       ▲                               └─ memory
                       │ withdraw() via KeeperHub
                       │ (private routing, retry, gas-opt)
        ┌──────────────────────────────────┐
        │       Guardian Agent (off-chain) │
        │  ┌────────────────────────────┐  │
        │  │ KeeperHub per-txn trigger  │  │
        │  │ Invariant checks           │  │
        │  │ Oracle deviation checks    │  │
        │  │ Twitter/X chatter scraper  │  │
        │  └─────────────┬──────────────┘  │
        │                ▼                 │
        │  Risk scorer (0G Compute,        │
        │  sealed inference, qwen3.6)      │
        │                │                 │
        │                ▼                 │
        │  Vector similarity (0G Storage)  │
        │  vs historical exploit DB        │
        │                │                 │
        │  2nd/3rd-order effect reasoning  │
        │                │                 │
        │  if risk > threshold → FIRE      │
        └────────────────┬─────────────────┘
                         │
                         ▼
                   KeeperHub MCP
                  (private mempool,
                   guaranteed exec)
```

---

## 5. Build plan (hackathon timeline)

### Day 1 — Build the 0G ↔ KeeperHub bridge (HARD PREREQUISITE — does not exist today)
This is the riskiest, most-blocking piece of work. KeeperHub currently has no concept of 0G; we are adding it.
- [ ] Add **0G chain** as a supported chain in KeeperHub (RPC, signer, tx submission)
- [ ] Add **0G Storage actions** to KeeperHub: KV read, KV write, Log append, callable as first-class workflow steps
- [ ] Add **0G Compute actions** to KeeperHub: sealed-inference endpoint call, callable as a first-class workflow step
- [ ] Minimal end-to-end workflow that fires on a lending-pool txn, reads from 0G Storage, calls a 0G Compute endpoint, and returns a score
- [ ] **Demo:** synthetic pool txn → workflow fires → 0G Storage + 0G Compute round-trip completes end-to-end inside a single KeeperHub run

### Day 2 — Contracts & foundation
- [ ] `PhulaxAccount.sol`: minimal smart wallet, owner + agent roles, `withdraw(adapter)` only for agent
- [ ] Hub contract (OpenClaw-style) + adapter interface + fake Aave-inspired lending pool with intentional vulnerabilities + 1 adapter against it
- [ ] Off-chain agent skeleton: hooks into the KeeperHub workflow, fires `withdraw()` on a hardcoded condition
- [ ] **Demo:** local fork, deposit → manually trigger agent → funds return to owner

### Day 3 — Detection stack on 0G
- [ ] Invariant watcher for the fake pool (monotonic share price, utilization sane)
- [ ] Oracle deviation check on the fake pool's price feed
- [ ] Embed 5–10 historical exploits, store vectors on 0G Storage KV
- [ ] Label a small nefarious-vs-benign txn corpus and **fine-tune the shared classifier on 0G**; serve it via sealed inference
- [ ] Risk scoring aggregator combines: invariants + oracle deviation + vector similarity + 0G fine-tuned classifier score
- [ ] iNFT contract — mint guardian, embed policy + link to the shared classifier as metadata pointer to 0G Storage
- [ ] **Demo:** craft a draining txn against the fake pool; agent detects + withdraws within the same KeeperHub workflow

### Day 4 — Execution & polish
- [ ] **KeeperHub trigger workflow (full pipeline):** fire the detection pipeline per-transaction on the fake pool; on threshold breach, call `withdraw` in the same flow
- [ ] Wire withdraw execution through KeeperHub MCP
- [ ] x402/MPP payment for KeeperHub usage (autonomous agent payment)
- [ ] Twitter/X chatter scraper as a secondary signal
- [ ] **Demo video** (<3 min): historical-exploit replay, voiceover explains the stack
- [ ] `README.md`, `FEEDBACK.md` (KeeperHub), architecture diagram
- [ ] Deploy contracts, mint reference iNFT, get explorer link

---

## 6. Demo script (the thing judges actually watch)

> "Here's our fake Aave-inspired lending pool with a Phulax-protected position in it.
> An attacker submits a draining transaction — KeeperHub fires the workflow on that very txn, the calldata matches a known-attack embedding on 0G Storage, the 0G fine-tuned classifier scores `p(nefarious) = 0.94`, and the agent fires `withdraw` via KeeperHub's private routing in the same flow.
> The attack tx still lands. Pool still drained. We're just not in it anymore.
> The agent runs autonomously, scores risk verifiably on 0G, remembers attack patterns on 0G Storage, and is owned by the user as an iNFT."

This 30 seconds is the moment that wins. Everything else is in service of it.

---

## 7. Risks & how to address them in the pitch

| Risk | Mitigation |
|------|-----------|
| **False positives** drain yield unnecessarily | Tunable thresholds per user; dry-run mode that alerts but doesn't withdraw; on-chain FP-rate track record |
| Agent key compromised | Agent can ONLY withdraw to owner — worst case attacker forces an exit, doesn't steal |
| 12s block time is too slow | KeeperHub per-txn trigger reacts within the same flow as the malicious tx; invariant tier catches multi-block patterns |
| Twitter signal is noisy / spoofable | Used as tiebreaker, never primary; abundance-of-caution withdraws are reversible on next deposit |
| What about L2s | Chain-agnostic; demo on Ethereum, Arbitrum/Base/Unichain on the roadmap |
| Why trust the risk model | Sealed inference on 0G Compute → verifiable; vector DB open + append-only on 0G Storage |
| Doesn't this shift losses to other LPs | Yes — Phulax is insurance for the individual, not a protocol-level fix. We say so openly |

---

## 8. Scope discipline

Keep (per README intent):
- ✅ Vector-DB-of-attacks as the headline novelty
- ✅ Twitter chatter scraper (secondary / tiebreaker)
- ✅ Abstracted-account protocol-wide-exit mode

Cut / deprioritise:
- ❌ Standalone ML classifier trained on historical exploits — doesn't generalise, attacks mutate (keep vector similarity instead)
- ❌ Multi-chain support for v1 (Ethereum mainnet fork only for the demo)
- ❌ Fancy frontend — a CLI + streaming terminal logs is more credible than a half-baked dashboard
- ❌ Governance/admin-key tier — mention as roadmap, don't build

**The single most important thing:** the 0G ↔ KeeperHub bridge has to land on Day 1. Nothing downstream works without it. Treat anything that competes for time on Day 1 as a distraction.

---

## 9. Submission deliverables checklist

- [ ] Public GitHub repo, README + one-command setup
- [ ] Demo video <3 min
- [ ] Live demo link (Loom of the local fork run is fine)
- [ ] Deployed contract addresses (PhulaxAccount factory, hub, iNFT, adapters)
- [ ] Architecture diagram
- [ ] One working example agent in the repo (the guardian itself)
- [ ] Minted iNFT on 0G explorer, link in README
- [ ] `FEEDBACK.md` for KeeperHub
- [ ] Team contact: Telegram + X handles
- [ ] Explicit list of 0G / KeeperHub features used, with file:line pointers

