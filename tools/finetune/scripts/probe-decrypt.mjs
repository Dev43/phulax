// Minimal-isolation: replay the ECIES-decrypt of `encryptedSecret` outside
// the broker. If this works but `pnpm ack` fails, the issue is in the broker
// path. If this also fails, eciesjs/noble can't handle the input.
import "../src/env.js";
import { createRequire } from "node:module";
import { openBroker } from "../src/broker.js";
import { readRun } from "../src/run-store.js";

const require = createRequire(import.meta.url);
const eciesjs = require("eciesjs");

const { broker } = await openBroker();
const run = await readRun();

const proc = broker.fineTuning.modelProcessor;
const deliverable = await proc.contract.getDeliverable(run.provider, run.taskId);

const signer = proc.contract.signer;
console.log("signer.privateKey present:", typeof signer.privateKey === "string", signer.privateKey?.length);

const sk = eciesjs.PrivateKey.fromHex(signer.privateKey);
console.log("PrivateKey.secret:", sk.secret.toString("hex").length, "hex chars (=", sk.secret.length, "bytes)");
console.log("ECIES_CONFIG:", {
  curve: eciesjs.ECIES_CONFIG.ellipticCurve,
  ephCompressed: eciesjs.ECIES_CONFIG.isEphemeralKeyCompressed,
  hkdfCompressed: eciesjs.ECIES_CONFIG.isHkdfKeyCompressed,
  ephKeySize: eciesjs.ECIES_CONFIG.ephemeralKeySize,
});

const hex = deliverable.encryptedSecret.startsWith("0x")
  ? deliverable.encryptedSecret.slice(2)
  : deliverable.encryptedSecret;
const data = Buffer.from(hex, "hex");
console.log("encryptedSecret bytes:", data.length, "first byte:", data[0].toString(16));

try {
  const out = eciesjs.decrypt(sk.secret, data);
  console.log("✓ decrypt OK, plaintext bytes:", out.length, "hex:", out.toString("hex"));
} catch (e) {
  console.error("✗ decrypt FAILED:", e.message);
  console.error(e.stack);
}
