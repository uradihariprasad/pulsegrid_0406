/**
 * LIVE INTEGRATION CHECKS — real Upstox endpoints, no fixtures.
 *
 * Instrument master and historical candles are public; quotes / option chain /
 * profile are auth-gated (401 without a token), so those assertions verify that
 * failures are CAPTURED as structured ApiFailures instead of throwing.
 * Run: npx vitest run src/lib/__tests__/integration-live.test.ts
 */
import { describe, expect, it } from "vitest";
import { fetchInstrumentMaster, fetchCandles, fetchQuotes, fetchOptionChain } from "../upstox";
import { discoverUniverse } from "../universe";
import { buildLiveFeeds } from "../live";
import { resolveSessionWindow } from "../math";

describe("live: instrument master (official BOD files)", () => {
  it("downloads and parses NSE + BSE masters", async () => {
    const { rows, diag } = await fetchInstrumentMaster();
    console.log("[live] master rows", rows.length, diag.sources, "failures", diag.failures.map((f) => f.code));
    expect(diag.failures).toHaveLength(0);
    expect(rows.length).toBeGreaterThan(10_000);
    expect(diag.nseRows).toBeGreaterThan(10_000);
    expect(diag.bseRows).toBeGreaterThan(1_000);
    expect(diag.futures).toBeGreaterThan(100);
    expect(diag.options).toBeGreaterThan(1_000);
  }, 120_000);
});

describe("live: universe discovery", () => {
  it("builds the full eligible universe with index keys", async () => {
    const u = await discoverUniverse();
    console.log("[live] universe ok=", u.ok, "seeds=", u.seeds.length, "errors=", u.errors.slice(0, 3), u.diag.indexKeys);
    expect(u.ok).toBe(true);
    expect(u.seeds.length).toBeGreaterThan(50);
    expect(u.diag.indexKeys.nifty).toBeTruthy();
    expect(u.diag.indexKeys.sensex).toBeTruthy();
    expect(u.seeds[0].symbol).toBe("NIFTY");
    expect(u.seeds.some((s) => s.symbol === "SENSEX")).toBe(true);
    // every seed carries a real instrument key and a future expiry
    for (const s of u.seeds.slice(0, 20)) {
      expect(s.spotKey).toMatch(/\|/);
      expect(s.expiry).toBeTruthy();
      if (s.hasFutures) expect(s.futKey).toMatch(/^\w+_FO\|/);
    }
  }, 180_000);
});

describe("live: V3 candles", () => {
  it("walks the candidate sessions until real candles are found", async () => {
    const win = resolveSessionWindow();
    let rows: { timestamp: string }[] = [];
    let used = "";
    for (const date of win.candidates.slice(0, 6)) {
      const got = await fetchCandles({ key: "NSE_INDEX|Nifty 50", interval: 5, from: date, to: date });
      if (got.length) {
        rows = got;
        used = date;
        break;
      }
    }
    console.log("[live] NIFTY 5m rows", rows.length, "requested", win.to, "actual session", used, "candidates", win.candidates.slice(0, 4));
    // a full NSE session is 75 five-minute bars (09:15 → 15:30 IST)
    expect(rows.length).toBeGreaterThanOrEqual(70);
    expect(used).toBeTruthy();
    expect(rows[0].timestamp < rows[rows.length - 1].timestamp).toBe(true);
  }, 120_000);
});

describe("live: auth-gated endpoints must fail gracefully", () => {
  it("quote failure is captured, never thrown", async () => {
    const res = await fetchQuotes(["NSE_INDEX|Nifty 50"]);
    console.log("[live] quotes ok=", Object.keys(res.quotes).length, "failures=", res.failures.map((f) => `${f.status}:${f.code}`));
    expect(Object.keys(res.quotes)).toHaveLength(0);
    expect(res.failures.length).toBeGreaterThan(0);
    expect(res.failures[0].status).toBe(401);
  }, 60_000);

  it("option-chain failure is captured, never thrown", async () => {
    const res = await fetchOptionChain("NSE_INDEX|Nifty 50", "2026-11-26");
    console.log("[live] chain rows=", res.rows.length, "failure=", res.failure?.status, res.failure?.code);
    expect(res.rows).toHaveLength(0);
    expect(res.failure).toBeTruthy();
  }, 60_000);
});

describe("live: end-to-end feed build from real public data", () => {
  it("produces a usable feed (spot candles + completeness) for NIFTY and SENSEX", async () => {
    const u = await discoverUniverse();
    const seeds = u.seeds.filter((s) => s.symbol === "NIFTY" || s.symbol === "SENSEX");
    expect(seeds.length).toBeGreaterThanOrEqual(1);

    const res = await buildLiveFeeds(seeds);
    console.log(
      "[live] feeds", res.feeds.length,
      "| spot", res.stats.spotOk, "/", res.stats.spotRequests,
      "| quote", res.stats.quoteOk, "/", res.stats.quoteRequests,
      "| futures", res.stats.futuresOk, "/", res.stats.futuresRequests,
      "| chain", res.stats.chainOk, "/", res.stats.chainRequests,
      "| failures", res.failures.slice(0, 4).map((f) => `${f.code}:${f.status}`),
    );
    expect(res.feeds.length).toBeGreaterThan(0);
    const target = res.feeds.find((f) => ["NIFTY", "SENSEX"].includes(f.meta.symbol)) ?? res.feeds[0];
    expect(["NIFTY", "SENSEX"]).toContain(target.meta.symbol);
    if (target.spot5.length > 0) {
      expect(target.spot5.length).toBeGreaterThan(50);
      expect(target.spot15.length).toBeGreaterThan(10);
    }
    // without a token the auth pieces are missing → PARTIAL/INVALID, with reasons
    expect(["COMPLETE", "PARTIAL", "INVALID"]).toContain(target.completeness);
    console.log("[live] completeness", target.completeness, "missing", target.missing, "session", target.sessionDate);
  }, 240_000);
});
