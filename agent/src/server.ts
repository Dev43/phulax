import Fastify from "fastify";
import cors from "@fastify/cors";
import type { Address, Hex } from "viem";
import { config } from "./config.js";
import { bus, type DetectionEvent } from "./events.js";
import { detect } from "./detection/detect.js";
import { hydrate, type RawTx } from "./detection/hydrate.js";
import { aggregate, defaultPolicy, type RiskPolicy } from "./risk/aggregator.js";
import { appendIncident, listIncidents, appendFeedback } from "./og/log.js";
import { encodeWithdraw, executeWithdraw } from "./exec/withdraw.js";

/**
 * Long-running guardian server (todo §9).
 *
 *   GET  /stream                    SSE feed of detection events
 *   GET  /incidents/:account        proxy to 0G Storage Log
 *   POST /feedback                  user-marked false-positive
 *   POST /detect-batch              KeeperHub workflow callback
 *
 * No database. State lives on-chain + 0G Storage. The in-process Bus is
 * just SSE fan-out for the UI.
 */

interface DetectBatchBody {
  account: Address;
  adapter: Address;
  policy?: Partial<RiskPolicy>;
  txs: RawTxWire[];
}

interface RawTxWire {
  hash: Hex;
  blockNumber: string;
  from: Address;
  to: Address;
  value: string;
  input: Hex;
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

  // -------- SSE feed --------
  app.get("/stream", async (_req, reply) => {
    reply.raw.setHeader("content-type", "text/event-stream");
    reply.raw.setHeader("cache-control", "no-cache");
    reply.raw.setHeader("connection", "keep-alive");
    reply.raw.flushHeaders();

    const send = (e: DetectionEvent) => {
      reply.raw.write(`event: detection\ndata: ${JSON.stringify(e)}\n\n`);
    };
    const off = bus.onDetection(send);
    const ping = setInterval(() => reply.raw.write(":\n\n"), 15_000);
    reply.raw.on("close", () => {
      off();
      clearInterval(ping);
    });
  });

  // -------- Incidents --------
  app.get<{ Params: { account: Address } }>("/incidents/:account", async (req) => {
    return listIncidents(req.params.account);
  });

  // -------- Feedback --------
  app.post<{ Body: FeedbackBody }>("/feedback", async (req) => {
    await appendFeedback(req.body.account, req.body.txHash, req.body.note ?? "");
    return { ok: true };
  });

  // -------- Detect batch (called by KeeperHub workflow step) --------
  app.post<{ Body: DetectBatchBody }>("/detect-batch", async (req) => {
    const { account, adapter, txs } = req.body;
    const policy: RiskPolicy = { ...defaultPolicy(), ...(req.body.policy ?? {}) };

    const ctxs = await Promise.all(
      txs.map((t) =>
        hydrate(toRaw(t)).catch((err) => {
          app.log.warn({ err: String(err), tx: t.hash }, "hydrate failed");
          return null;
        }),
      ),
    );

    const scores = ctxs
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c) => detect(c));

    const decision = aggregate(scores, policy);
    const winningCtx =
      decision.maxIndex >= 0 ? ctxs.filter((c) => c)[decision.maxIndex] ?? null : null;

    let withdrawCalldata: Hex | undefined;
    let dispatch: { runId: string; dispatchedAt: number } | undefined;
    if (decision.fire) {
      withdrawCalldata = encodeWithdraw(adapter);
      try {
        dispatch = await executeWithdraw(account, adapter, {
          txHash: winningCtx?.txHash,
          score: decision.maxScore?.value,
          reason: decision.maxScore?.signals[0]?.kind,
        });
      } catch (err) {
        app.log.error({ err: String(err) }, "withdraw dispatch failed");
      }
    }

    const event: DetectionEvent = {
      ts: Date.now(),
      account,
      txHash: winningCtx?.txHash ?? ("0x" as Hex),
      blockNumber: winningCtx ? winningCtx.blockNumber.toString() : "0",
      score: decision.maxScore ?? { value: 0, shortCircuited: false, signals: [] },
      receipt: winningCtx?.classifier ?? null,
      outcome: decision.fire ? "fired" : "skipped",
      fired: dispatch,
    };
    bus.emitDetection(event);

    // Durable record (todo §6 + §10): every fire writes a receipt to the
    // 0G Storage Log. We log skips too at debug level — replay tooling
    // wants both classes to compute precision/recall.
    if (decision.fire || (decision.maxScore && decision.maxScore.value > 0.3)) {
      await appendIncident({
        ts: event.ts,
        account,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        score: event.score,
        receipt: event.receipt,
        outcome: event.outcome,
      }).catch((err) => app.log.warn({ err: String(err) }, "log append failed"));
    }

    return {
      fire: decision.fire,
      threshold: decision.threshold,
      maxScore: decision.maxScore,
      withdrawCalldata,
      dispatch,
    };
  });

  return app;
}

function toRaw(t: RawTxWire): RawTx {
  return {
    hash: t.hash,
    blockNumber: BigInt(t.blockNumber),
    from: t.from,
    to: t.to,
    value: BigInt(t.value),
    input: t.input,
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
