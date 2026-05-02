#!/usr/bin/env node
// 0G Storage helper for the Python ml/ pipeline.
//
// Mirrors keeperhub/plugins/0g-storage/server-core.ts: uses the Indexer +
// FixedPriceFlow contract from @0gfoundation/0g-ts-sdk with an ethers signer.
// The keeperhub plugin signs through Para; we sign with a plain private key so
// the offline ml/ pipeline can run without a KeeperHub workflow.
//
// Subcommands (all read JSON args from stdin, write JSON result to stdout):
//   upload-blob   { path }                       -> { rootHash, txHash }
//   kv-put-batch  { streamId, entries:[{key,value}] } -> { rootHash, txHash }
//
// Env: OG_PRIVATE_KEY, OG_RPC_URL, OG_INDEXER_URL, OG_FLOW_ADDRESS, OG_CHAIN_ID.

import { readFile } from "node:fs/promises";
import { toUtf8Bytes, Wallet, JsonRpcProvider } from "ethers";
import {
  Batcher,
  FixedPriceFlow__factory,
  Indexer,
  MemData,
} from "@0gfoundation/0g-ts-sdk";

const DEFAULTS = {
  OG_INDEXER_URL: "https://indexer-storage-testnet-turbo.0g.ai",
  OG_FLOW_ADDRESS: "0x22E03a6A89B950F1c82ec5e74F8eCa321a105296",
  OG_RPC_URL: "https://evmrpc-testnet.0g.ai",
  OG_CHAIN_ID: "16602",
};

function env(name) {
  return process.env[name] ?? DEFAULTS[name];
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is unset. See ml/.env.example.`);
  }
  return v;
}

async function buildContext() {
  const provider = new JsonRpcProvider(env("OG_RPC_URL"), Number(env("OG_CHAIN_ID")));
  const signer = new Wallet(requireEnv("OG_PRIVATE_KEY"), provider);
  const indexer = new Indexer(env("OG_INDEXER_URL"));
  return { signer, indexer, rpcUrl: env("OG_RPC_URL"), flowAddress: env("OG_FLOW_ADDRESS") };
}

async function uploadBlob({ path }) {
  if (!path) throw new Error("path is required");
  const ctx = await buildContext();
  const bytes = await readFile(path);
  const file = new MemData(new Uint8Array(bytes));
  const [result, error] = await ctx.indexer.upload(file, ctx.rpcUrl, ctx.signer);
  if (error) throw new Error(`upload failed: ${error.message}`);
  if ("txHashes" in result) {
    return { txHash: result.txHashes[0] ?? "", rootHash: result.rootHashes[0] ?? "" };
  }
  return { txHash: result.txHash, rootHash: result.rootHash };
}

async function kvPutBatch({ streamId, entries }) {
  if (!streamId) throw new Error("streamId is required");
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("entries must be a non-empty array");
  }
  const ctx = await buildContext();
  const [nodes, nodesError] = await ctx.indexer.selectNodes(1);
  if (nodesError) throw new Error(`indexer selectNodes failed: ${nodesError.message}`);

  const flow = FixedPriceFlow__factory.connect(ctx.flowAddress, ctx.signer);
  const batcher = new Batcher(1, nodes, flow, ctx.rpcUrl);
  for (const { key, value } of entries) {
    if (typeof key !== "string") throw new Error("entry.key must be a string");
    const valueStr = typeof value === "string" ? value : JSON.stringify(value);
    batcher.streamDataBuilder.set(streamId, toUtf8Bytes(key), toUtf8Bytes(valueStr));
  }
  const [result, execError] = await batcher.exec();
  if (execError) throw new Error(`batcher exec failed: ${execError.message}`);
  return { txHash: result.txHash, rootHash: result.rootHash };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

async function main() {
  const cmd = process.argv[2];
  const handlers = { "upload-blob": uploadBlob, "kv-put-batch": kvPutBatch };
  const fn = handlers[cmd];
  if (!fn) {
    process.stderr.write(`unknown command: ${cmd}\nusage: og.mjs <upload-blob|kv-put-batch> < args.json\n`);
    process.exit(2);
  }

  // The 0G SDK logs progress to stdout (Indexer.upload, Batcher.exec). The
  // Python wrapper in ml/og_client.py treats stdout as a JSON channel and
  // dies on the first chatter line. Redirect stdout writes to stderr while
  // the SDK runs, then restore for the single result write below.
  const _stdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr);
  // Console.log/info/warn/error all eventually call stdout/stderr.write, so
  // the patch above covers them too — but `console` may be cached against
  // the original streams; replace its bound methods explicitly to be safe.
  console.log = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
  console.info = console.log;
  console.warn = console.log;

  try {
    const args = await readStdin();
    const out = await fn(args);
    _stdoutWrite(JSON.stringify(out));
  } catch (err) {
    process.stderr.write(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
