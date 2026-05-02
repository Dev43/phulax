import { describe, it, expect } from "vitest";
import { detect } from "../src/detection/detect.js";
import { aggregate, defaultPolicy } from "../src/risk/aggregator.js";
import { fixtures, type FixtureKey } from "./fixtures/exploits.js";
import { setConfig } from "../src/config.js";

setConfig({
  rpcUrl: "http://localhost",
  chainId: 1,
  pool: "0x0000000000000000000000000000000000000000",
  defaultThreshold: 0.7,
  classifierUrl: "http://localhost/classify",
  ogStorageUrl: "http://localhost",
  ogStorageAuth: undefined,
  keeperHubUrl: "http://localhost",
  keeperHubKey: undefined,
  keeperHubWebhookUrl: "",
  serverPort: 8787,
});

const policy = defaultPolicy();

describe("detect() exploit replays", () => {
  for (const key of Object.keys(fixtures) as FixtureKey[]) {
    const f = fixtures[key];
    it(`${f.label}: ${key}`, () => {
      const score = detect(f.ctx);
      const decision = aggregate([score], policy);
      if (f.label === "nefarious") {
        expect(decision.fire, `${key} should fire (score=${score.value})`).toBe(true);
        expect(score.value).toBeGreaterThan(0.7);
      } else {
        expect(decision.fire, `${key} should NOT fire (score=${score.value})`).toBe(false);
        expect(score.value).toBeLessThanOrEqual(0.7);
      }
    });
  }
});

describe("detect() purity", () => {
  it("same input yields same output across repeated calls", () => {
    const ctx = fixtures.mango_oracleManipulation.ctx;
    const a = detect(ctx);
    const b = detect(ctx);
    const c = detect(ctx);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("invariant violation short-circuits and forces score >= 0.6", () => {
    const score = detect(fixtures.adminSweep_rug.ctx);
    expect(score.shortCircuited).toBe(true);
    expect(score.value).toBeGreaterThanOrEqual(0.6);
  });
});
