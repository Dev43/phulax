// Narrow ABI: agent path is restricted to `withdraw(adapter)` only.
// Full ABI lives in contracts/ (Track B); we re-export the typed
// fragment we are allowed to call so misuse becomes a type error.
export const phulaxAccountAbi = [
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "adapter", type: "address" }],
    outputs: [],
  },
] as const;
