import Fastify from "fastify";
import cors from "@fastify/cors";
import type { Address, Hex } from "viem";
import { encodeFunctionData } from "viem";
import { fakeLendingPoolAbi } from "./abis/FakeLendingPool.js";
import { config } from "./config.js";
import { detect } from "./detection/detect.js";
import { hydrate, type RawTx } from "./detection/hydrate.js";
import type {
  ClassifierReceipt,
  Score,
  SignalKind,
} from "./detection/types.js";
import {
  aggregate,
  defaultPolicy,
  type RiskPolicy,
} from "./risk/aggregator.js";
import { appendIncident, listIncidents, appendFeedback } from "./og/log.js";

/**
 * Stateless detection HTTP service. KeeperHub owns the per-block loop and
 * signs the withdraw; this service only exposes pure detection over HTTP.
 *
 *   GET  /health
 *   POST /detect-features         tier 1/2/3 only — returns rule score +
 *                                 the body to forward to inference.
 *   POST /decide                  combine rule score + classifier output;
 *                                 return final fire decision.
 *   POST /feedback                user-marked false-positive
 *   GET  /incidents/:account      proxy to 0G Storage Log
 *
 * No SSE, no chain subscription, no signing surface. The container holds
 * no private keys.
 */

interface QueryTx {
  hash: Hex;
  blockNumber: number | string;
  from: Address;
  value: number | string;
  functionName: string | null;
  args: readonly unknown[];
}

// KH `web3/query-events` shape. The pool's `Withdraw(address indexed
// reserve, address indexed user, address indexed to, uint256 amount)` event
// gives us everything needed to reconstruct a withdraw tx without falling
// back to the indexer-lagged `query-transactions` step (0G chainscan trails
// chain head by ~3 min, missing per-block triggers entirely).
interface QueryEvent {
  transactionHash: Hex;
  blockNumber: number | string;
  logIndex?: number;
  args: Record<string, unknown> | unknown[];
}

interface DetectFeaturesBody {
  account: Address;
  adapter: Address;
  txs?: QueryTx[];
  events?: QueryEvent[];
}

interface ClassifierInput {
  selector: Hex;
  function_name: string | null;
  args: unknown[];
  value: string;
}

interface Candidate {
  txHash: Hex;
  blockNumber: string;
  account: Address;
  adapter: Address;
  ruleScore: Score;
  classifierInput: ClassifierInput;
}

interface DecideBody {
  account: Address;
  adapter: Address;
  txHash: Hex;
  ruleScore: Score;
  classifier: ClassifierReceipt | null;
  policy?: Partial<RiskPolicy>;
}

interface FeedbackBody {
  account: Address;
  txHash: Hex;
  note?: string;
}

export async function buildServer() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));

  app.get<{ Params: { account: Address } }>(
    "/incidents/:account",
    async (req) => listIncidents(req.params.account),
  );

  app.post<{ Body: FeedbackBody }>("/feedback", async (req) => {
    await appendFeedback(req.body.account, req.body.txHash, req.body.note ?? "");
    return { ok: true };
  });

  // Tier 1/2/3 over a block's pool txs. Picks the highest-rule-score tx
  // and returns the inference body so the workflow can route it to /classify.
  app.post<{ Body: DetectFeaturesBody }>("/detect-features", async (req) => {
    const { account, adapter } = req.body;

    // Accept either query-transactions output (txs[]) or query-events
    // output (events[], from the pool's Withdraw event). Events are the
    // path that works on 0G — the indexer behind query-transactions lags.
    const txs: QueryTx[] = Array.isArray(req.body.txs) && req.body.txs.length
      ? req.body.txs
      : Array.isArray(req.body.events)
        ? req.body.events.map(eventToTx)
        : [];

    if (txs.length === 0) {
      return { hasCandidate: false, candidate: null };
    }

    const raws = txs
      .map((t) => toRaw(t))
      .filter((r): r is RawTx => r !== null);

    const ctxs = await Promise.all(
      raws.map((r) =>
        hydrate(r, { skipClassifier: true }).catch((err) => {
          app.log.warn({ err: String(err), tx: r.hash }, "hydrate failed");
          return null;
        }),
      ),
    );

    let best: { idx: number; score: Score } | null = null;
    for (let i = 0; i < ctxs.length; i++) {
      const c = ctxs[i];
      if (!c) continue;
      const s = detect(c);
      if (!best || s.value > best.score.value) {
        best = { idx: i, score: s };
      }
    }

    if (!best) {
      return { hasCandidate: false, candidate: null };
    }

    const ctx = ctxs[best.idx]!;
    const candidate: Candidate = {
      txHash: ctx.txHash,
      blockNumber: ctx.blockNumber.toString(),
      account,
      adapter,
      ruleScore: best.score,
      classifierInput: {
        selector: ctx.selector,
        function_name: ctx.functionName,
        args: ctx.args.map((a) => (typeof a === "bigint" ? a.toString() : a)),
        value: ctx.value.toString(),
      },
    };
    return { hasCandidate: true, candidate };
  });

  // Combine rule score + classifier into a final decision.
  app.post<{ Body: DecideBody }>("/decide", async (req) => {
    const { account, adapter, txHash, ruleScore, classifier } = req.body;
    const policy: RiskPolicy = { ...defaultPolicy(), ...(req.body.policy ?? {}) };

    const merged: Score = mergeClassifierIntoScore(ruleScore, classifier);
    const decision = aggregate([merged], policy);
    const reason: SignalKind | null =
      merged.signals.length > 0 ? merged.signals[0]!.kind : null;

    // Best-effort durable record of the decision (fire or skip-with-signal).
    if (decision.fire || merged.value > 0.3) {
      await appendIncident({
        ts: Date.now(),
        account,
        txHash,
        blockNumber: "0",
        score: merged,
        receipt: classifier,
        outcome: decision.fire ? "fired" : "skipped",
      }).catch((err) => app.log.warn({ err: String(err) }, "log append failed"));
    }

    return {
      fire: decision.fire,
      threshold: decision.threshold,
      account,
      adapter,
      txHash,
      score: merged,
      reason,
    };
  });

  return app;
}

// Map a `web3/query-events` Withdraw event into the QueryTx shape so the
// rest of the pipeline doesn't have to care which KH primitive sourced the
// data. The pool emits `Withdraw(reserve, user, to, amount)`.
function eventToTx(e: QueryEvent): QueryTx {
  const a = e.args ?? {};
  // KH's decoded args may come as an object keyed by event-arg name OR as
  // a positional array — accept both.
  const get = (key: string, idx: number): unknown => {
    if (Array.isArray(a)) return a[idx];
    return (a as Record<string, unknown>)[key];
  };
  const reserve = get("reserve", 0);
  const user = get("user", 1);
  const to = get("to", 2);
  const amount = get("amount", 3);
  return {
    hash: e.transactionHash,
    blockNumber: e.blockNumber,
    from: (typeof user === "string" ? user : "0x0000000000000000000000000000000000000000") as Address,
    value: "0",
    functionName: "withdraw",
    args: [
      reserve,
      typeof amount === "bigint" ? amount.toString() : String(amount ?? "0"),
      to,
    ],
  };
}

function toRaw(t: QueryTx): RawTx | null {
  if (!t.functionName) return null;
  let input: Hex;
  try {
    input = encodeFunctionData({
      abi: fakeLendingPoolAbi,
      // biome-ignore lint/suspicious/noExplicitAny: viem's typed encodeFunctionData
      // requires a literal function name; KH supplies it as a string at runtime.
      functionName: t.functionName as any,
      // biome-ignore lint/suspicious/noExplicitAny: same — args shape is per-fn.
      args: t.args as any,
    });
  } catch {
    return null;
  }
  return {
    hash: t.hash,
    blockNumber: BigInt(t.blockNumber),
    from: t.from,
    to: config().pool,
    value: BigInt(t.value),
    input,
  };
}

function mergeClassifierIntoScore(
  rule: Score,
  classifier: ClassifierReceipt | null,
): Score {
  if (!classifier) return rule;
  // Mirrors checkClassifier delta from agent/src/detection/classifier.ts:
  // p_nefarious >= 0.5 contributes to the score.
  const delta = classifier.pNefarious >= 0.5 ? classifier.pNefarious * 0.4 : 0;
  if (delta === 0) return rule;
  const signals = [
    ...rule.signals,
    {
      kind: "classifier.nefarious" as const,
      delta,
      detail: `p_nefarious=${classifier.pNefarious.toFixed(3)}`,
    },
  ];
  const sum = signals.reduce((acc, s) => acc + s.delta, 0);
  return {
    value: Math.max(0, Math.min(1, sum)),
    shortCircuited: rule.shortCircuited,
    signals,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = config().serverPort;
  buildServer().then((app) =>
    app.listen({ port, host: "0.0.0.0" }).then(() => {
      app.log.info(`phulax agent listening on :${port}`);
    }),
  );
}
