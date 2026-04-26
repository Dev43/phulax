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

## Deploy to 0G testnet

```sh
export PRIVATE_KEY=0x...
export AGENT_ADDRESS=0x...
export DEMO_ASSET_ADDRESS=0x...   # optional
export ZEROG_RPC_URL=https://...
export ZEROG_EXPLORER_URL=https://.../api
export ZEROG_EXPLORER_API_KEY=...
forge script script/Deploy.s.sol:Deploy --rpc-url zerog_testnet --broadcast --verify
pnpm run abis        # writes ABIs to ./abis/ as a paste-in fallback
pnpm run wagmi       # writes ./generated/wagmi.ts for tracks E and F
```
