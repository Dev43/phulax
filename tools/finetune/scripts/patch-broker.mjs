#!/usr/bin/env node
// Postinstall patch for @0glabs/0g-serving-broker@0.7.5.
//
// The compiled CJS at lib.commonjs/fine-tuning/zg-storage/zg-storage.js uses
// four `..` segments to locate `binary/0g-storage-client`, but the file lives
// only three levels up (at the broker package root). Four ups lands at
// `@0glabs/`, producing the path `@0glabs/binary/0g-storage-client` which
// doesn't exist — submit/download fail with ENOENT.
//
// Idempotent: the script is a no-op once the file is already patched.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS_FT = resolve(HERE, "..");

const require = createRequire(`${TOOLS_FT}/`);

// The broker's package.json declares an `exports` map that doesn't include
// "./package.json", so we can't resolve it directly. Resolve the main entry
// (lib.commonjs/index.js) and walk up to the package root instead.
let brokerEntry;
try {
  brokerEntry = require.resolve("@0glabs/0g-serving-broker");
} catch {
  // Broker not installed yet (e.g. fresh clone before deps land). Skip.
  process.exit(0);
}
// brokerEntry == .../node_modules/@0glabs/0g-serving-broker/lib.commonjs/index.js
const brokerRoot = resolve(dirname(brokerEntry), "..");
const target = resolve(
  brokerRoot,
  "lib.commonjs/fine-tuning/zg-storage/zg-storage.js",
);

if (!existsSync(target)) {
  console.warn(`[patch-broker] target missing: ${target}`);
  process.exit(0);
}

const before = "'..', '..', '..', '..', 'binary'";
const after = "'..', '..', '..', 'binary'";

const original = await readFile(target, "utf8");
if (!original.includes(before)) {
  if (original.includes(after)) {
    // Already patched.
    process.exit(0);
  }
  console.warn(
    "[patch-broker] expected pattern not found — broker version may have changed; skipping",
  );
  process.exit(0);
}

const patched = original.split(before).join(after);
await writeFile(target, patched);
console.log(`[patch-broker] patched ${target}`);
