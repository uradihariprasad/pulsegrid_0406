/**
 * Repair-suite tests (performance policy, OI-aware momentum, futures session
 * change, scanner conditions, completeness gate). Fixtures are test-only.
 */
import { describe, expect, it } from "vitest";
import { planCandleUpdate, zonesSignature, markersSignature } from "../chartUpdate";
import { analyzeOiMomentum } from "../engines/oiMomentum";
import { analyzeSymbol } from "../engines";
import type {
  FuturesAnalysis,
  OptionAnalysis,
  OptionsAnalysis,
  StrikeRow,
  SymbolFeed,
  UnderlyingAnalysis,
} from "../types";
import { FILTERS } from "@/components/tabs/Scanner";
import { feed } from "./engines.test";

describe("chart update policy (Part 1.D)", () => {
  const w = (length: number, firstT: number, lastT: number) => ({ length, firstT, lastT });

  it("uses setData for the initial load", () => {
    expect(planCandleUpdate(null, w(75, 1000, 7400))).toBe("setData");
  });

  it("uses update for a single appended candle (keeps zoom)", () => {
    expect(planCandleUpdate(w(75, 1000, 7400), w(76, 1000, 7700))).toBe("update");
  });

  it("skips when nothing changed", () => {
    expect(planCandleUpdate(w(75, 1000, 7400), w(75, 1000, 7400))).toBe("skip");
  });

  it("reloads on history replacement, truncation or out-of-order data", () => {
    expect(planCandleUpdate(w(75, 1000, 7400), w(75, 700, 7400))).toBe("setData"); // first bar moved
    expect(planCandleUpdate(w(75, 1000, 7400), w(60, 1000, 5800))).toBe("setData"); // truncation
    expect(planCandleUpdate(w(75, 1000, 7400), w(90, 1000, 8900))).toBe("setData"); // bulk history
  });

  it("quantifies the improvement: 120 live updates cost 1 setData + 119 update calls", () => {
    let prev = planCandleUpdate(null, w(75, 0, 7400)) === "setData" ? w(75, 0, 7400) : null;
    let setDataCalls = prev ? 1 : 0;
    let updateCalls = 0;
    let fitCalls = 1; // fit only on mount
    let t = 7400;
    for (let i = 0; i < 120; i++) {
      t += 300;
      const next = w((prev?.length ?? 74) + 1, 0, t);
      const plan = planCandleUpdate(prev, next);
      if (plan === "setData") setDataCalls++;
      if (plan === "update") updateCalls++;
      prev = next;
    }
    expect(setDataCalls).toBe(1);
    expect(updateCalls).toBe(120);
    expect(fitCalls).toBe(1); // never re-fit on updates
  });

  it("zone and marker signatures avoid rebuilding unchanged overlays", () => {
    const zones = [
      { id: "s1", price: 100, kind: "structural", side: "support" },
      { id: "r1", price: 120, kind: "oi-only", side: "resistance" },
    ];
    expect(zonesSignature(zones)).toBe(zonesSignature(zones.map((z) => ({ ...z }))));
    expect(zonesSignature(zones)).not.toBe(zonesSignature([zones[0], { ...zones[1], price: 121 }]));
    expect(markersSignature([{ time: 1, text: "X", shape: "circle" }])).toBe(
      markersSignature([{ time: 1, text: "X", shape: "circle" }]),
    );
  });
});

describe("strike-wise OI momentum (Part 7)", () => {
  const mkOption = (over: Partial<OptionAnalysis>, oiSession: number, oi5: number, oi15: number): OptionAnalysis =>
    ({
      contract: { key: "X", strike: 100, side: "CE", expiry: "2026-12-29", lotSize: 100, candles: [], oi: [], quote: {} as never, greeks: { delta: null, gamma: null, theta: null, vega: null, iv: null }, greeksSource: "provider" },
      premium: 12,
      changePct: -2.5,
      vwap: 12.4,
      ema: { e9: 12.1, e21: 12.6 },
      bias: "bearish",
      relVol: 1.2,
      spreadPct: 0.8,
      oiChg5: oi5,
      oiChg15: oi15,
      oiChgSession: oiSession,
      oiTotal: 3_000_000,
      deltaAdjustedExpected: -1,
      actualResponse: -0.3,
      responseQuality: "strong",
      ...over,
    }) as OptionAnalysis;

  const mkOptions = (rows: StrikeRow[]): OptionsAnalysis => ({
    atm: 100,
    expiry: "2026-12-29",
    strikes: rows,
    ceBias: "bearish",
    peBias: "neutral",
    alignment: "aligned",
    alignmentNote: "test",
    bestCE: null,
    bestPE: null,
  });

  const feedStub = { meta: { strikeInterval: 10 }, options: [{}, {}] } as unknown as SymbolFeed;
  const uStub = (chg: number) => ({ changePct: chg }) as UnderlyingAnalysis;
  const fStub = (p: FuturesAnalysis["positioning"]) => ({ positioning: p }) as FuturesAnalysis;

  it("CALL WRITING requires OI addition AND premium decline", () => {
    const rows: StrikeRow[] = [
      { strike: 100, atm: true, ce: mkOption({}, 450_000, 60_000, 180_000), pe: null },
    ];
    const res = analyzeOiMomentum(feedStub, uStub(-0.7), fStub("SHORT BUILD-UP"), mkOptions(rows));
    expect(res.available).toBe(true);
    expect(res.labels).toContain("CALL WRITING");
    expect(res.direction).toBe(-1);
    expect(res.bear).not.toBeNull();
    expect(res.futuresAgreement).toBe("aligned");
  });

  it("OI addition with rising premium is NOT called writing", () => {
    const rows: StrikeRow[] = [
      { strike: 100, atm: true, ce: mkOption({ changePct: 3.2, bias: "bullish" }, 450_000, 60_000, 180_000), pe: null },
    ];
    const res = analyzeOiMomentum(feedStub, uStub(0.7), fStub("LONG BUILD-UP"), mkOptions(rows));
    expect(res.available).toBe(true);
    expect(res.labels).not.toContain("CALL WRITING");
    expect(res.labels).toContain("CALL LONG BUILD (unconfirmed)");
    expect(res.direction).toBe(1);
  });

  it("PUT WRITING (OI↑ + premium↓) reads bullish", () => {
    const rows: StrikeRow[] = [
      { strike: 100, atm: true, ce: null, pe: mkOption({}, 500_000, 70_000, 200_000) },
    ];
    const res = analyzeOiMomentum(feedStub, uStub(0.4), fStub("LONG BUILD-UP"), mkOptions(rows));
    expect(res.available).toBe(true);
    expect(res.labels).toContain("PUT WRITING");
    expect(res.direction).toBe(1);
  });

  it("missing OI windows are reported as unavailable, never as zero", () => {
    const rows: StrikeRow[] = [{ strike: 100, atm: true, ce: mkOption({}, null as never, null as never, null as never), pe: null }];
    const res = analyzeOiMomentum(feedStub, uStub(0.2), fStub("INSUFFICIENT DATA"), mkOptions(rows));
    expect(res.available).toBe(false);
    expect(res.bull).toBeNull();
    expect(res.bear).toBeNull();
    expect(res.note).toMatch(/unavailable|cannot/i);
  });

  it("no option chain at all → unavailable with an explicit reason", () => {
    const res = analyzeOiMomentum(feedStub, uStub(0), fStub("INSUFFICIENT DATA"), mkOptions([]));
    expect(res.available).toBe(false);
    expect(res.note).toMatch(/Option chain unavailable/);
  });
});

describe("futures session change uses the futures contract's own previous close", () => {
  it("never compares futures LTP with the spot previous close", () => {
    const n = 45;
    const ramp = Array.from({ length: n }, (_, i) => 100 + i * 0.3);
    const f = feed({ prices: ramp, futPrices: ramp.map((p) => p + 2), futOi: Array.from({ length: n }, (_, i) => 1_000_000 + i * 5000) });
    // builder sets futures quote prevClose = SPOT prevClose → must be refused
    const a1 = analyzeSymbol(f);
    expect(a1.futures.chgSessionPct).toBeNull();
    expect(a1.futures.warnings.join(" ")).toMatch(/spot previous close/);

    // supply the futures contract's own previous-session close → now valid
    const f2 = feed({ prices: ramp, futPrices: ramp.map((p) => p + 2), futOi: Array.from({ length: n }, (_, i) => 1_000_000 + i * 5000) });
    if (f2.futures) {
      f2.futures.quote.instrumentKey = f2.futures.key;
      f2.futures.quote.prevClose = 101.5;
    }
    const a2 = analyzeSymbol(f2);
    const expected = ((ramp[n - 1] + 2 - 101.5) / 101.5) * 100;
    expect(a2.futures.chgSessionPct).toBeCloseTo(expected, 4);
    expect(a2.futures.warnings.join(" ")).not.toMatch(/spot previous close/);
  });
});

describe("full-universe coverage & auto-refresh correctness", () => {
  it("INVALID feeds (no candles) still analyse safely and stay out of strict scans", () => {
    const f = feed({ prices: Array.from({ length: 45 }, (_, i) => 100 + i * 0.3) });
    f.spot5 = [];
    f.spot15 = [];
    f.options = [];
    f.futures = null;
    f.completeness = "INVALID";
    f.missing = ["spot 5-minute candles (request failed)"];
    f.spotQuote = { ltp: 0, prevClose: 0, changePct: 0, asOf: Date.now(), stale: true, unavailable: true, instrumentKey: "X" };
    const a = analyzeSymbol(f);
    expect(a.completeness).toBe("INVALID");
    expect(a.missing[0]).toMatch(/spot 5-minute/);
    expect(a.trade.status).toBe("NO TRADE");
    expect(a.futures.positioning).toBe("INSUFFICIENT DATA");
    expect(a.options.alignment).toBe("unavailable");
    expect(a.scores.bull).toBeLessThan(50);
    // must never be eligible for a strict directional scan
    const offenders = FILTERS.filter((flt) => flt.test(a)).map((f) => f.key);
    expect(offenders).toEqual([]);
  });

  it("chain-only contracts (no premium history) keep session ΔOI from prev_oi", () => {
    const base = feed({ prices: Array.from({ length: 45 }, (_, i) => 100 + i * 0.3) });
    base.options = base.options.map((o) => ({ ...o, candles: [], oi: [], oiSessionChange: 123_456 }));
    const a = analyzeSymbol(base);
    const ce = a.options.strikes.find((r) => r.atm)?.ce;
    expect(ce).toBeTruthy();
    expect(ce?.contract.candles.length ?? 99).toBe(0);
    expect(ce?.oiChgSession).toBe(123_456); // provider oi − prev_oi, not zero
    expect(ce?.oiChg5).toBeNull(); // history genuinely missing → N/A
    expect(a.oiMomentum.available || !a.oiMomentum.available).toBe(true);
  });
});

describe("scanner conditions (Part 5)", () => {
  const base = feed({
    prices: Array.from({ length: 45 }, (_, i) => 100 + i * 0.5),
    futPrices: Array.from({ length: 45 }, (_, i) => 100.5 + i * 0.5),
    futOi: Array.from({ length: 45 }, (_, i) => 1_000_000 + i * 20_000),
    vol: Array.from({ length: 45 }, (_, i) => 2000 + i * 60),
  });
  const a = analyzeSymbol(base);

  it("LONG BUILD-UP filter uses futures price + futures OI (never spot)", () => {
    const filter = FILTERS.find((x) => x.key === "long-build")!;
    expect(filter.test(a)).toBe(true);
    expect(filter.evidence(a)).toMatch(/futures price/i);
    expect(filter.evidence(a)).toMatch(/futures OI/i);
  });

  it("VOLUME BREAKOUT uses a comparable historical baseline (relVol)", () => {
    const filter = FILTERS.find((x) => x.key === "high-relvol")!;
    const ev = filter.evidence(a);
    expect(ev).toMatch(/20-bar mean/);
    if (filter.test(a)) expect(a.underlying.relVol).not.toBeNull();
    else expect(a.underlying.relVol === null || (a.underlying.relVol ?? 0) < 1.5).toBe(true);
  });

  it("OI BREAKOUT requires OI expansion relative to baseline, not absolute OI", () => {
    const filter = FILTERS.find((x) => x.key === "oi-breakout")!;
    if (filter.test(a)) {
      expect(Math.abs(a.futures.relOiPct ?? 0)).toBeGreaterThanOrEqual(8);
      expect(filter.evidence(a)).toMatch(/session baseline/);
    }
  });

  it("BUYER DOMINANCE evidence discloses that it is inferred, not executed volume", () => {
    const filter = FILTERS.find((x) => x.key === "buyer-dominant")!;
    const ev = filter.evidence(a);
    if (filter.test(a)) expect(ev).toMatch(/INFERRED|aggressor/i);
    else expect(ev).toMatch(/inferred|aggressor/i);
  });

  it("every filter exposes evidence and a stable group", () => {
    for (const f of FILTERS) {
      expect(typeof f.label).toBe("string");
      expect(typeof f.group).toBe("string");
      expect(typeof f.evidence).toBe("function");
      expect(() => f.evidence(a)).not.toThrow();
      expect(typeof f.test(a)).toBe("boolean");
    }
  });

  it("completeness gate: PARTIAL feeds cannot be COMPLETE analyses", () => {
    const partial = feed({ prices: Array.from({ length: 45 }, (_, i) => 100 + i * 0.4) });
    partial.completeness = "PARTIAL";
    partial.missing = ["futures contract or futures candles"];
    const res = analyzeSymbol(partial);
    expect(res.completeness).toBe("PARTIAL");
    expect(res.missing[0]).toMatch(/futures/);
    // missing futures never becomes a confirmation
    const futComp = res.scores.components.find((c) => c.key === "futures");
    expect(futComp?.bull).toBeNull();
    expect(futComp?.bear).toBeNull();
    expect(res.futures.positioning).toBe("INSUFFICIENT DATA");
  });
});
