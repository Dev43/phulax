import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

// Tracks E (web/) and F (agent/) import typed ABIs directly from this file's
// output. Re-run `pnpm wagmi` after every `forge build`.
export default defineConfig({
  out: "generated/wagmi.ts",
  plugins: [
    foundry({
      project: ".",
      include: [
        "PhulaxAccount.sol/**",
        "Hub.sol/**",
        "PhulaxINFT.sol/**",
        "FakeLendingPool.sol/**",
        "FakePoolAdapter.sol/**",
        "IAdapter.sol/**",
      ],
    }),
  ],
});
