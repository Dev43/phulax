# `contracts/` — Phulax on-chain components

Foundry project. Solidity 0.8.24, no upgradability, no `delegatecall` on the agent path.

## What's here

- `src/PhulaxAccount.sol` — per-user account. `withdraw(adapter)` is the agent's **only** callable selector and **always** sends to `owner`. Hard-coded recipient — no `to` parameter, no escape hatch on the agent path.
- `src/Hub.sol` — registry of accounts + per-account risk policy. Events drive the UI.
- `src/inft/PhulaxINFT.sol` — ERC-7857-shaped iNFT (minimal ERC-721 + metadata pointer to a 0G Storage CID containing `{policy, adapters, classifier_pointer, incident_log_cid}`).
- `src/adapters/IAdapter.sol`, `src/adapters/FakePoolAdapter.sol` — adapter shape + the `FakeLendingPool` wrapper. The adapter is the supplier-of-record at the pool layer (per-PhulaxAccount internal bookkeeping); `pool.balanceOf(asset, account)` returns 0 for a Phulax-protected user — read `adapter.balanceOf(account)` instead.
- `src/pools/FakeLendingPool.sol` — Aave-shape demo pool with **five intentional vulns**, each backed by a working drain test. Not a KeeperHub `protocols/` plugin — workflows consume its ABI via `abi-with-auto-fetch` with `contracts/abis/*.json` as paste-in fallback.
- `src/DemoAsset.sol` — permissionless-mint ERC20 used as the demo asset (lets the web UI self-mint a balance per session).

## The five-vuln matrix

| # | Vuln                          | Test file                   | Real-world match              |
|---|-------------------------------|-----------------------------|-------------------------------|
| 1 | Open-oracle borrow drain      | `ExploitReplay.t.sol`       | Mango / Cream                 |
| 2 | Reentrancy via hook-token     | `ExploitReentrancy.t.sol`   | Lendf.Me / CREAM ERC777       |
| 3 | Flash-loan amplified drain    | `ExploitFlashLoan.t.sol`    | Inverse / Beanstalk           |
| 4 | Liquidation via oracle crash  | `ExploitLiquidation.t.sol`  | Solend cascade                |
| 5 | Admin reserve sweep           | `ExploitAdminRug.t.sol`     | TornadoCash gov / bridge admins |

Each test demonstrates a real drain — attacker EOA's balance increases by ≥ pool-reserves at the end. Vuln #1 is the demo's hot path; #2–#5 exist so the agent's detection pipeline can cover all four tiers with realistic shapes.

## Common commands

```sh
# first-time deps (use --no-git inside .dmux worktrees — submodule pathspec resolution fails there)
forge install --no-git foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts

pnpm test       # = forge test -vv      (11/11 across 7 suites)
pnpm fuzz       # invariant fuzz, foundry.toml [fuzz] runs = 512
pnpm build      # = forge build
pnpm abis       # writes ./abis/*.json paste-in fallback for KH abi-with-auto-fetch
pnpm wagmi      # writes ./generated/wagmi.ts for tracks E and F
```

Run a single test: `forge test --match-test testFuzz_withdrawAlwaysToOwner -vvv`.

The strongest invariant in the system — `PhulaxAccount` cannot pay non-owner — is empirically validated across 512 fuzz runs / 256 000 invariant calls (`PhulaxAccount.fuzz.t.sol` + `PhulaxAccount.invariant.t.sol`).

## Live testnet deploy (0G Galileo, chain id 16602)

Already deployed (broadcast at `broadcast/Deploy.s.sol/16602/run-latest.json`):

| Contract           | Address                                      |
|--------------------|----------------------------------------------|
| `Hub`              | `0x573b9Ec4BB93bbDA59C0DBA953831d58fC36498C` |
| `PhulaxINFT`       | `0xe5c3e4b205844EFe2694949d5723aa93B7F91616` |
| `FakeLendingPool`  | `0xb1DE7278b81e1Fd40027bDac751117AE960d8747` |
| `DemoAsset` (pUSD) | `0x21937016d3E3d43a0c2725F47cC56fcb2B51d615` |
| `FakePoolAdapter`  | `0x0c39fF914e41DA07B815937ee70772ba21A5C760` |
| `PhulaxAccount`    | `0xA70060465c1cD280E72366082fE20C7618C18a66` |
| Deployer           | `0x734da1B3b4F4E0Bd1D5F68A470798CbBAe74ab00` |
| Agent EOA          | `0x47d3CF2a314aeF4Da43dB8eBC7Eb818bF2496260` |

These addresses are wired into `web/.env.local`, `agent/.env`, and the KeeperHub workflow JSON. Don't redeploy unless you intend to re-wire all three.

## Re-deploy from scratch (only if necessary)

```sh
cp .env.example .env                  # then fill in PRIVATE_KEY + AGENT_ADDRESS
set -a; source .env; set +a

# 1) dry-run against the live RPC — no broadcast
forge script script/Deploy.s.sol:Deploy --rpc-url zerog_testnet -vvv

# 2) broadcast — note the priority-gas-price flag
forge script script/Deploy.s.sol:Deploy --rpc-url zerog_testnet --broadcast --verify --priority-gas-price 2gwei

# 3) regenerate ABIs
pnpm abis && pnpm wagmi
```

**Sharp edges** (also in repo CLAUDE.md):

- **Galileo enforces a 2 gwei minimum priority fee.** `forge --broadcast` fails with `gas tip cap 1, minimum needed 2000000000` without `--priority-gas-price 2gwei`. `cast send` calls need it too.
- **Galileo chain id is 16602, not 16601** — 0G migrated the testnet chain id; some historical prose in this repo still says 16601 (review entries only — current code is on 16602).
- **`forge install` inside a `.dmux` worktree must use `--no-git`** — submodule pathspec resolution fails otherwise. Vendored deps land at `contracts/lib/` (gitignored).

**Faucet:** https://faucet.0g.ai — request both for `PRIVATE_KEY` and `AGENT_ADDRESS` if they're separate.

## See also

- `tasks/todo.md` §3 — invariants the contracts enforce (single-selector agent, owner-only recipient).
- `tasks/todo.md` §5 — concrete contract shapes (the original spec).
- `STRATEGY.md` §6 — the demo path that drives vuln #1 live on testnet.
