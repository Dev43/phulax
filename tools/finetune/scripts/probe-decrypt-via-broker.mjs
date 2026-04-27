// Replicate the *exact* code path the broker uses, but isolate where it fails.
// The wrapper calls eciesDecrypt(signer, encryptedSecret), then
// aesGCMDecryptToFile(secret, encryptedPath, decryptedPath, teeSignerAddress).
import "../src/env.js";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { openBroker } from "../src/broker.js";
import { readRun } from "../src/run-store.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

// Use the broker's *own* require — same realm as the broker uses internally.
// The broker's exports field doesn't expose subpaths, so we resolve the main
// entry then read encrypt.js by absolute path.
const require = createRequire(import.meta.url);
const brokerEntry = require.resolve("@0glabs/0g-serving-broker");
const brokerRoot = resolve(dirname(brokerEntry), "..");
const encPath = resolve(brokerRoot, "lib.commonjs/common/utils/encrypt.js");
const enc = require(encPath);
console.log("eciesDecrypt fn:", typeof enc.eciesDecrypt, "aesGCMDecryptToFile:", typeof enc.aesGCMDecryptToFile);

const { broker } = await openBroker();
const run = await readRun();
const proc = broker.fineTuning.modelProcessor;

const [service, deliverable] = await Promise.all([
  proc.contract.getService(run.provider),
  proc.contract.getDeliverable(run.provider, run.taskId),
]);

console.log("teeSignerAddress:", service.teeSignerAddress);
console.log("encryptedSecret head:", deliverable.encryptedSecret.slice(0, 20), "...");

console.log("\n--- step A: eciesDecrypt(signer, encryptedSecret) ---");
let secret;
try {
  secret = await enc.eciesDecrypt(proc.contract.signer, deliverable.encryptedSecret);
  console.log("✓ eciesDecrypt OK, plaintext key (hex):", secret);
} catch (e) {
  console.error("✗ eciesDecrypt FAILED:", e.message);
  console.error(e.stack?.split("\n").slice(0, 6).join("\n"));
  process.exit(1);
}

const encryptedPath = resolve(
  REPO_ROOT,
  "ml/artifacts/og-ft/encrypted",
  `lora_model_${run.taskId}.zip`,
);
const decryptedDir = resolve(REPO_ROOT, "ml/artifacts/lora");
await mkdir(decryptedDir, { recursive: true });
const decryptedPath = resolve(decryptedDir, "adapter_model.safetensors");

console.log("\n--- step B: aesGCMDecryptToFile(secret, encryptedPath, decryptedPath, teeSigner) ---");
try {
  await enc.aesGCMDecryptToFile(secret, encryptedPath, decryptedPath, service.teeSignerAddress);
  console.log("✓ aesGCMDecryptToFile OK ->", decryptedPath);
} catch (e) {
  console.error("✗ aesGCMDecryptToFile FAILED:", e.message);
  console.error(e.stack?.split("\n").slice(0, 6).join("\n"));
}
