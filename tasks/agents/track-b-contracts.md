# Track B — Solidity contracts (Foundry)

Independent of Track A. Can start immediately. Output ABIs unblock Tracks E and F.

## Dispatch prompt

> You are working on the Phulax hackathon project. Before writing any code, read `STRATEGY.md`, `tasks/todo.md` (especially §3, §4, §5, §11, §13), and the root `CLAUDE.md`. `tasks/todo.md` wins on conflicts.
>
> Your job is to build the `contracts/` deliverable: a Foundry project with the five contracts described in `tasks/todo.md` §5, plus the deploy script and forge tests. Solidity 0.8.24, Foundry, no upgradability, no `delegatecall` on the agent path.
>
> **Architectural invariants that must be enforced in code, not docs:**
> - `PhulaxAccount.withdraw(address adapter)` always sends to `owner`. There is no `to` parameter. The agent role has exactly one selector available — `withdraw` — and nothing else.
> - `setAgent`, `revokeAgent`, `setAdapter`, `execute(target,data)` are all owner-only. `execute` is the only escape hatch and it is never reachable from the agent path.
> - `FakeLendingPool` is **intentionally vulnerable**: (a) single-block oracle manipulation via a manipulable getter, (b) reentrancy on `withdraw`. These vulns must be reachable in tests so we can demo a draining txn. Use Aave-shape events (`Supply`, `Borrow`, `Withdraw`) so Track A's `web3/query-transactions` decode lights up.
> - `FakeLendingPool` is **not** a KeeperHub `protocols/` plugin (todo §1 + §7.1 + CLAUDE.md scope discipline). Don't push it into the keeperhub submodule.
> - `PhulaxINFT` follows ERC-7857. If the reference impl is rough, ship a minimal ERC-721 with the same metadata schema and call it "ERC-7857-shaped" (§12 risk).
>
> Tests required:
> 1. Forge fuzz: there is no input under which `PhulaxAccount.withdraw` transfers to a non-owner address.
> 2. Exploit replay: a scripted draining txn against `FakeLendingPool` succeeds when Phulax is absent; with the agent firing in the same block, owner recovers ≥99% of principal.
>
> Deploy script (`script/Deploy.s.sol`):
> - Targets 0G testnet.
> - **Verify the deployed contracts on the 0G explorer** so KeeperHub's `abi-with-auto-fetch` works in workflows (todo §5 + §7.1).
> - Drop the ABI JSON in `contracts/abis/` as a fallback for paste-in.
> - Emit a `wagmi.config.ts` (or generate the wagmi inputs) so Tracks E and F can import typed ABIs directly from Foundry artifacts.
>
> Repo wiring: add `contracts/` to `pnpm-workspace.yaml` at the root. The `phulax/` repo currently contains only docs + the `keeperhub/` submodule — you are creating `contracts/` from scratch, following the layout in `tasks/todo.md` §4.
>
> When you finish a chunk, append to the Review section of `tasks/todo.md`. If the user corrects you, update `tasks/lessons.md`. Do not push branches or open PRs without explicit user confirmation.

## Checklist
- [x] B1. Foundry scaffold + workspace entry
- [x] B2. `IAdapter.sol`, `FakePoolAdapter.sol`
- [x] B3. `FakeLendingPool.sol` with the two intentional vulns + Aave-shape events
- [x] B4. `PhulaxAccount.sol` — hard-coded owner recipient, agent-selector restricted
- [x] B5. `Hub.sol`, `PhulaxINFT.sol` (ERC-7857 or shaped fallback)
- [~] B6. Deploy + verify on 0G testnet, ABI fallback files (script + extractor written; not run — needs forge installed locally and 0G env vars)
- [~] B7. Forge fuzz + exploit-replay tests green (tests written; not executed — `forge` unavailable in this sandbox)
- [x] B8. `wagmi.config.ts` outputs ready for Tracks E and F
