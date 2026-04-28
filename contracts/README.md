# contracts

Foundry project for Track B. Solidity 0.8.24, no upgradability, no `delegatecall`
on the agent path.

## Layout

- `src/PhulaxAccount.sol` — per-user account. `withdraw(adapter)` is the agent's
  only callable selector and **always** sends to `owner`.
- `src/Hub.sol` — registry of accounts + risk policies (events drive the UI).
- `src/inft/PhulaxINFT.sol` — ERC-7857-shaped iNFT (minimal ERC-721 + metadata
  pointer to a 0G Storage CID).
- `src/adapters/IAdapter.sol`, `src/adapters/FakePoolAdapter.sol` — adapter
  shape + a wrapper around `FakeLendingPool`.
- `src/pools/FakeLendingPool.sol` — Aave-shape demo pool with **two intentional
  vulns** (open oracle, reentrant withdraw). Not a KeeperHub plugin.

## First-time setup

```sh
forge install foundry-rs/forge-std
forge install OpenZeppelin/openzeppelin-contracts
```

## Test

```sh
forge test -vv
```

`PhulaxAccount.fuzz.t.sol` proves no input redirects funds away from `owner`.
`ExploitReplay.t.sol` runs the oracle-manipulation drain twice — once without
Phulax (victim loses funds) and once with the agent firing first (≥ 99%
recovery).

## Deploy to 0G testnet (Galileo, chain id 16601)

`Deploy.s.sol` is self-contained: it deploys `Hub`, `PhulaxINFT`,
`FakeLendingPool`, a fresh `DemoAsset` ERC20, the `FakePoolAdapter`,
and a `PhulaxAccount` for the deployer in one transaction set. The pool
is seeded with `POOL_SEED_AMOUNT` (default 100e18) of DemoAsset so a
demo attacker has reserves to drain.

```sh
cp .env.example .env             # then fill in PRIVATE_KEY + AGENT_ADDRESS
set -a; source .env; set +a      # exports the env

# 1) dry-run against the live RPC — no broadcast, just simulates the txs
forge script script/Deploy.s.sol:Deploy --rpc-url zerog_testnet -vvv

# 2) when the simulation prints sane addresses, broadcast for real
forge script script/Deploy.s.sol:Deploy --rpc-url zerog_testnet --broadcast --verify

# 3) regenerate ABIs (already produced by `forge build` upstream of this)
pnpm run abis        # writes ABIs to ./abis/ as a paste-in fallback
pnpm run wagmi       # writes ./generated/wagmi.ts for tracks E and F
```

Capture the printed `Hub`, `PhulaxAccount`, `FakeLendingPool`, and
`DemoAsset` addresses — they go into the agent `.env`, the web
`.env.local`, and the KeeperHub workflow JSON
(`{{TODO_FAKE_LENDING_POOL_ADDRESS}}` slot).

**Faucet:** https://faucet.0g.ai — request both for `PRIVATE_KEY` and
`AGENT_ADDRESS` if they're separate.

**Verify failures are non-fatal:** if `--verify` errors out (rate
limit, indexer lag), drop the flag and re-run the equivalent
`forge verify-contract` later, or just ship the JSON ABIs from
`./abis/` to the workflow as paste-in fallback.
