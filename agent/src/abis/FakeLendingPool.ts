// Real ABI for the deployed FakeLendingPool (todo §14.A.7 + §14 Review).
//
// The contract is per-asset/per-user-mapping shaped — there are no
// pool-wide aggregate getters (`totalSupply`/`utilizationBps`/`sharePrice`
// never existed on-chain). The fictional aggregate ABI that previously
// lived here is gone; hydrate.ts now derives per-tx invariants from the
// real surface (admin-sweep selector + reentrancy detected via
// `IERC20(asset).balanceOf(pool)` deltas vs the visible withdraw amount).
//
// Mirror is hand-curated rather than imported from `contracts/generated/`
// to keep the agent build self-contained and avoid pulling the contracts
// workspace into agent's tsconfig include set.
export const fakeLendingPoolAbi = [
  // --- read surface ---
  {
    type: "function",
    name: "admin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "getAssetPrice",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  // Note arg order: balanceOf(asset, user), supplied(user, asset).
  // The pool exposes both; we use balanceOf for clarity.
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "asset", type: "address" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "borrowedOf",
    stateMutability: "view",
    inputs: [
      { name: "asset", type: "address" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },

  // --- write surface (decode-only; never called from agent) ---
  {
    type: "function",
    name: "supply",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "borrow",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "liquidate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "asset", type: "address" },
    ],
    outputs: [{ name: "seized", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawReserves",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "setAssetPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "newPrice", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

// Minimal ERC-20 read surface — used by hydrate.ts to read the pool's
// reserve balance for the reentrancy invariant.
export const erc20BalanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
