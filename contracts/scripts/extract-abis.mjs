#!/usr/bin/env node
// Extract ABI JSON from forge build artifacts into `contracts/abis/`.
// These are the paste-in fallback for KeeperHub `abi-with-auto-fetch` when
// 0G explorer verification hasn't propagated.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const out = join(root, "abis");
if (!existsSync(out)) mkdirSync(out, { recursive: true });

const targets = [
  "PhulaxAccount",
  "Hub",
  "PhulaxINFT",
  "FakeLendingPool",
  "FakePoolAdapter",
  "IAdapter",
];

for (const name of targets) {
  const candidates = [
    join(root, "out", `${name}.sol`, `${name}.json`),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) {
    console.warn(`skip ${name}: no artifact (run \`forge build\` first)`);
    continue;
  }
  const artifact = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(join(out, `${name}.json`), JSON.stringify(artifact.abi, null, 2));
  console.log(`wrote abis/${name}.json`);
}
