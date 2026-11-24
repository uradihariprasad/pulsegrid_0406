/**
 * Unit + scenario tests for the MARKET MASTER engines.
 * Synthetic series are used strictly here, in a test environment — they never
 * reach the dashboard (the dashboard only ever renders live or labelled replay
 * session data).
 */
import { describe, expect, it } from "vitest";
import { bollinger, ema, relativeVolume, sma, vwap, atr } from "../indicators";
import { analyzeSymbol } from "../engines";
import { oiWindows } from "../engines/oi";
import { scoreStrikes } from "../engines/strike";
import { blackScholes } from "../math";
import type { Candle, OptionAnalysis, OptionContract, SymbolFeed } from "../types";

const baseTime = Date.UTC(2026, 0, 5, 3, 45) / 1000; // 09:15 IST

function candles(prices: number[], vol = 1000, oi?: number[]): Candle[] {
  return prices.map((c, i) => ({
    t: baseTime + i * 300,
    o: i === 0 ? prices[0] : prices[i - 1],
    h: Math.max(c, i === 0 ? c : prices[i - 1]) + 0.4,
    l: Math.min(c, i === 0 ? c : prices[i - 1]) - 0.4,
    c,
    v: vol,
    oi: oi ? oi[i] : null,
  }));
}

function makeOption(strike: number, side: "CE" | "PE", prem: number[], oiSeries: number[], spreadPct: number): OptionContract {
  const mid = prem[prem.length - 1];
  const half = (mid * spreadPct) / 200;
  const cs = prem.map((p, i) => ({ t: baseTime + i * 300, o: p, h: p + 0.1, l: p - 0.1, c: p, v: 500, oi: null }));
  const oi = oiSeries.map((v, i) => ({ t: baseTime + i * 300, o: 0, h: 0, l: 0, c: 0, v: 0, oi: v }));
  const bs = blackScholes(100, strike, 0.02, 0.25, 0.065, side);
  return {
    key: `${strike}${side}`,
    strike,
    side,
    expiry: "2026-01-08",
    lotSize: 100,
    candles: cs,
    oi,
    quote: {
      ltp: mid,
      prevClose: prem[0],
      changePct: ((mid - prem[0]) / prem[0]) * 100,
      bid: mid - half,
      ask: mid + half,
      bidQty: 500,
      askQty: 500,
      oi: oiSeries[oiSeries.length - 1],
      volume: 1000,
      asOf: Date.now(),
      stale: false,
    },
    greeks: { delta: bs.delta, gamma: bs.gamma, theta: bs.theta, vega: bs.vega, iv: 0.25 },
    greeksSource: "black-scholes-derived",
  };
}

/** Synthetic feed builder used only by these tests (never application data). */
export function feed(opts: {
  prices: number[];
  futPrices?: number[];
  futOi?: number[];
  vol?: number[];
  depth?: { bidQty: number; askQty: number };
}): SymbolFeed {
  const n = opts.prices.length;
  const vol = opts.vol ?? new Array(n).fill(1000);
  const spot5 = opts.prices.map((c, i) => ({
    t: baseTime + i * 300,
    o: i === 0 ? opts.prices[0] : opts.prices[i - 1],
    h: Math.max(c, i === 0 ? c : opts.prices[i - 1]) + 0.5,
    l: Math.min(c, i === 0 ? c : opts.prices[i - 1]) - 0.5,
    c,
    v: vol[i],
    oi: null,
  }));
  const prevClose = opts.prices[0] * 0.99;
  const last = opts.prices[n - 1];
  const futPrices = opts.futPrices ?? opts.prices;
  const futOi = opts.futOi ?? new Array(n).fill(1_000_000);
  const futCandles = spot5.map((b, i) => ({ ...b, c: futPrices[i], o: i ? futPrices[i - 1] : futPrices[i], oi: futOi[i] }));
  const atm = Math.round(last);
  const strikes = [atm - 10, atm, atm + 10];
  const options: OptionContract[] = [];
  for (const k of strikes) {
    const rising = k === atm ? opts.prices : opts.prices.map((p) => p * 0.98);
    options.push(
      makeOption(k, "CE", rising.map((p) => Math.max(0.5, p - k + 12)), new Array(n).fill(500_000), 0.8),
      makeOption(k, "PE", rising.map((p) => Math.max(0.5, k - p + 8)), new Array(n).fill(400_000), 0.9),
    );
  }
  return {
    meta: {
      symbol: "TESTCO",
      name: "Test Co",
      sector: "Test",
      kind: "equity",
      exchange: "NSE",
      spotKey: "NSE_EQ|TEST",
      lotSize: 100,
      strikeInterval: 10,
      expiries: ["2026-01-08"],
      origin: "upstox-master",
    },
    source: "live",
    completeness: "COMPLETE",
    missing: [],
    asOf: Date.now(),
    prevDay: { high: opts.prices[0] * 1.01, low: opts.prices[0] * 0.97, close: prevClose, volume: 100000 },
    spot5,
    spot15: spot5.filter((_, i) => i % 3 === 0),
    spot1d: [],
    spotQuote: { ltp: last, prevClose, changePct: ((last - prevClose) / prevClose) * 100, asOf: Date.now(), stale: false },
    futures: {
      key: "TEST_FUT",
      label: "TESTCO FUT",
      expiry: "2026-01-08",
      lotSize: 100,
      candles: futCandles,
      quote: { ltp: futPrices[n - 1], prevClose, changePct: ((futPrices[n - 1] - prevClose) / prevClose) * 100, oi: futOi[n - 1], asOf: Date.now(), stale: false },
    },
    options,
    depth: opts.depth ? { ...opts.depth, asOf: Date.now() } : null,
    notes: ["test feed"],
  };
}

const ramp = (n: number, from: number, to: number) =>
  Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

describe("indicator kernel", () => {
  it("computes SMA over the trailing window only", () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBeCloseTo(2, 6);
    expect(out[4]).toBeCloseTo(4, 6);
  });

  it("seeds EMA with an SMA and smooths afterwards", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[2]).toBeCloseTo(2, 6);
    expect(out[3]).toBeCloseTo(3, 6);
    expect(out[4]).toBeCloseTo(4, 6);
  });

  it("collapses Bollinger bands on a constant series", () => {
    const b = bollinger(new Array(30).fill(100), 20, 2);
    expect(b.up[29]).toBeCloseTo(100, 6);
    expect(b.lo[29]).toBeCloseTo(100, 6);
  });

  it("VWAP equals price when volume is uniform and price flat", () => {
    const c = candles(new Array(10).fill(250));
    const v = vwap(c);
    expect(v[9]).toBeCloseTo(250, 1);
  });

  it("relative volume never uses the current bar as its own baseline (no look-ahead)", () => {
    const c = candles(new Array(30).fill(100), 1000);
    c[20].v = 10_000;
    const rv = relativeVolume(c, 20);
    expect(rv[20]).toBeCloseTo(10, 6); // baseline is bars 0..19 (flat 1000)
    expect(rv[19]).toBeNull(); // insufficient history, not zero
  });

  it("ATR stays positive and null before the period is formed", () => {
    const c = candles(ramp(30, 100, 130));
    const a = atr(c, 14);
    expect(a[5]).toBeNull();
    expect(a[29] as number).toBeGreaterThan(0);
  });
});

describe("OI windows (module E)", () => {
  it("computes 5m, 15m and session deltas against the correct references", () => {
    const snaps: Candle[] = Array.from({ length: 20 }, (_, i) => ({
      t: baseTime + i * 300,
      o: 0,
      h: 0,
      l: 0,
      c: 0,
      v: 0,
      oi: 1_000_000 + i * 1000,
    }));
    const w = oiWindows(snaps);
    expect(w.total).toBe(1_019_000);
    expect(w.c5).toBe(1_000); // one 5-minute bar earlier
    expect(w.c15).toBe(3_000); // three 5-minute bars earlier
    expect(w.cSession).toBe(19_000);
    expect(w.baselineSource).toBe("first-session-observation");
  });

  it("returns null (not zero) when the reference snapshot is missing", () => {
    const snaps: Candle[] = [
      { t: baseTime, o: 0, h: 0, l: 0, c: 0, v: 0, oi: 500 },
      { t: baseTime + 300, o: 0, h: 0, l: 0, c: 0, v: 0, oi: 700 },
    ];
    const w = oiWindows(snaps);
    expect(w.c15).toBeNull();
    expect(w.c5).toBe(200);
    expect(w.total).toBe(700);
  });

  it("reports unavailable baseline when no OI exists", () => {
    const w = oiWindows([{ t: baseTime, o: 0, h: 0, l: 0, c: 0, v: 0, oi: null }]);
    expect(w.total).toBeNull();
    expect(w.baselineSource).toBe("unavailable");
    expect(w.cSession).toBeNull();
  });
});

describe("futures positioning classification (module B)", () => {
  const cases: [string, number, number][] = [
    ["LONG BUILD-UP", 1.2, 20_000],
    ["SHORT BUILD-UP", -1.2, 20_000],
    ["SHORT COVERING", 1.2, -20_000],
    ["LONG UNWINDING", -1.2, -20_000],
  ];
  for (const [label, movePct, oiMove] of cases) {
    it(`labels ${label} from the (price, OI) sign pair`, () => {
      const n = 30;
      const flat = new Array(n).fill(100);
      const futPrices = flat.map((p, i) => (i < n - 1 ? p : p * (1 + movePct / 100)));
      const oi = new Array(n).fill(1_000_000);
      oi[n - 1] = 1_000_000 + oiMove;
      const a = analyzeSymbol(feed({ prices: flat, futPrices, futOi: oi }));
      expect(a.futures.positioning).toBe(label);
    });
  }

  it("reports INSUFFICIENT DATA when futures are absent instead of guessing", () => {
    const f = feed({ prices: ramp(30, 100, 110) });
    f.futures = null;
    const a = analyzeSymbol(f);
    expect(a.futures.positioning).toBe("INSUFFICIENT DATA");
    expect(a.futures.warnings.join(" ")).toMatch(/unavailable/i);
  });
});

describe("unified scoring (module I)", () => {
  it("scores a sustained advance well above a sustained decline", () => {
    const bull = analyzeSymbol(feed({ prices: ramp(40, 100, 118), futPrices: ramp(40, 100, 119), futOi: ramp(40, 1_000_000, 1_250_000), vol: new Array(40).fill(2500) }));
    const bear = analyzeSymbol(feed({ prices: ramp(40, 118, 100), futPrices: ramp(40, 118, 99), futOi: ramp(40, 1_000_000, 1_250_000) }));
    expect(bull.scores.bull).toBeGreaterThan(bull.scores.bear);
    expect(bear.scores.bear).toBeGreaterThan(bear.scores.bull);
    expect(bull.scores.bull).toBeGreaterThan(bear.scores.bull);
  });

  it("does not award points for a component whose input is missing", () => {
    const f = feed({ prices: ramp(40, 100, 118), futPrices: ramp(40, 100, 119), futOi: ramp(40, 1_000_000, 1_250_000) });
    f.options = [];
    const a = analyzeSymbol(f);
    const opt = a.scores.components.find((c) => c.key === "options");
    expect(opt?.bull).toBeNull();
    expect(a.scores.missing).toBeGreaterThan(0);
    expect(a.options.alignment).toBe("unavailable");
    // denominator excludes the missing weight, so the score stays within 0..100
    expect(a.scores.bull).toBeGreaterThanOrEqual(0);
    expect(a.scores.bull).toBeLessThanOrEqual(100);
  });

  it("bands scores into the documented heuristic ranges", () => {
    const a = analyzeSymbol(feed({ prices: ramp(40, 100, 118), futPrices: ramp(40, 100, 119), futOi: ramp(40, 1_000_000, 1_250_000), vol: new Array(40).fill(3000) }));
    expect(["WEAK", "DEVELOPING", "STRONG", "HIGH_CONFLUENCE", "NONE"]).toContain(a.scores.band);
    expect(a.scores.grade).toMatch(/[A-E] —/);
  });
});

function analysis(contract: OptionContract, over: Record<string, unknown>): OptionAnalysis {
  return {
    contract,
    premium: contract.quote.ltp,
    changePct: 10,
    vwap: contract.quote.ltp,
    ema: { e9: contract.quote.ltp, e21: contract.quote.ltp * 0.98 },
    bias: "bullish",
    relVol: 1.5,
    spreadPct: 1,
    oiChg5: 1_000,
    oiChg15: 5_000,
    oiChgSession: 30_000,
    oiTotal: 400_000,
    deltaAdjustedExpected: 2,
    actualResponse: 2,
    responseQuality: "strong",
    ...over,
  } as OptionAnalysis;
}

describe("strike selection (module M)", () => {
  it("rejects an illiquid contract regardless of its momentum", () => {
    const illiquid = makeOption(100, "CE", [12, 13, 14, 16], [100_000, 110_000, 120_000, 130_000], 7.5);
    const liquid = makeOption(110, "CE", [6, 6.2, 6.4, 6.9], [400_000, 410_000, 420_000, 430_000], 0.6);
    const rows = [
      { strike: 100, atm: true, ce: analysis(illiquid, { spreadPct: 7.5, changePct: 33, relVol: 2.1 }), pe: null },
      { strike: 110, atm: false, ce: analysis(liquid, { spreadPct: 0.6, changePct: 15, relVol: 1.4 }), pe: null },
    ];
    const res = scoreStrikes(rows, { direction: "bull", atmIv: 0.25, atrPct: 1.2 });
    expect(res.rejected.some((r) => r.reason.includes("spread"))).toBe(true);
    expect(res.bestCE?.strike).toBe(110);
    expect(res.bestCE?.liquidity).not.toBe("illiquid");
  });

  it("returns null (NO SUITABLE CONTRACT) when every contract fails", () => {
    const bad = makeOption(100, "CE", [12, 13, 14, 16], [10_000, 11_000, 12_000, 13_000], 9);
    const rows = [
      {
        strike: 100,
        atm: true,
        ce: analysis(bad, { spreadPct: 9, changePct: 40, relVol: 3, oiTotal: 13_000, oiChgSession: 3_000 }),
        pe: null,
      },
    ];
    const res = scoreStrikes(rows, { direction: "bull", atmIv: 0.25, atrPct: 1.2 });
    expect(res.bestCE).toBeNull();
  });
});

describe("genuine vs weak momentum & stages (modules H, J)", () => {
  it("calls a volume + OI + structure advance genuine bullish", () => {
    const n = 60;
    const vol = Array.from({ length: n }, (_, i) => 1500 + i * 140);
    const a = analyzeSymbol(
      feed({ prices: ramp(n, 100, 124), futPrices: ramp(n, 100, 125), futOi: ramp(n, 1_000_000, 1_350_000), vol }),
    );
    expect(a.underlying.bias).toBe("bullish");
    expect(a.options.alignment).toBe("aligned");
    expect(a.futures.positioning).toBe("LONG BUILD-UP");
    expect(a.scores.bull).toBeGreaterThan(a.scores.bear + 20);
    expect(a.momentum.quality).toBe("GENUINE BULLISH");
    expect(a.momentum.genuine.join(" ")).toMatch(/Spot structure/);
    expect(a.momentum.stage).toBe("STAGE 2: STRONG MOMENTUM");
    expect(a.trade.direction).toBe("LONG");
  });

  it("keeps a flat-volume advance in the WEAK bucket instead of over-claiming", () => {
    const n = 45;
    const a = analyzeSymbol(
      feed({ prices: ramp(n, 100, 122), futPrices: ramp(n, 100, 123), futOi: ramp(n, 1_000_000, 1_350_000), vol: new Array(n).fill(4000) }),
    );
    expect(a.momentum.weak.join(" ")).toMatch(/volume/i);
    expect(a.momentum.quality).not.toBe("GENUINE BULLISH");
  });

  it("labels a short-covering rally instead of fresh long conviction", () => {
    const n = 45;
    const oi = new Array(n).fill(1_000_000);
    oi[n - 1] = 900_000;
    const a = analyzeSymbol(
      feed({ prices: ramp(n, 100, 115), futPrices: ramp(n, 100, 116), futOi: oi, vol: new Array(n).fill(3000) }),
    );
    expect(a.futures.positioning).toBe("SHORT COVERING");
    expect(a.futures.warnings.join(" ")).toMatch(/fresh long conviction/i);
  });

  it("flags divergence when price rises while futures OI falls", () => {
    const n = 45;
    const oi = new Array(n).fill(1_000_000);
    oi[n - 1] = 850_000;
    const a = analyzeSymbol(feed({ prices: ramp(n, 100, 116), futPrices: ramp(n, 100, 117), futOi: oi }));
    expect(a.momentum.divergence.join(" ")).toMatch(/OI falls/i);
  });
});

describe("trade geometry (modules L, N)", () => {
  it("keeps invalidation beyond the entry and targets above it for a long", () => {
    const a = analyzeSymbol(
      feed({ prices: ramp(45, 100, 122), futPrices: ramp(45, 100, 123), futOi: ramp(45, 1_000_000, 1_350_000), vol: new Array(45).fill(4000) }),
    );
    if (a.trade.direction === "LONG") {
      expect(a.trade.entryZone).not.toBeNull();
      expect(a.trade.invalidation).toBeLessThan(a.trade.entryZone![0]);
      expect(a.trade.target1!).toBeGreaterThan(a.trade.entryZone![1]);
      expect(a.trade.target2!).toBeGreaterThan(a.trade.target1!);
      expect(a.trade.riskReward!).toBeGreaterThan(0);
    } else {
      expect(a.trade.status).toBe("NO TRADE");
    }
  });

  it("emits NO TRADE with reasons when nothing qualifies", () => {
    const n = 45;
    const flat = new Array(n).fill(100).map((p, i) => p + Math.sin(i) * 0.15);
    const a = analyzeSymbol(feed({ prices: flat }));
    expect(["NO TRADE", "WATCHLIST", "MOMENTUM BUILDING"]).toContain(a.trade.status);
    if (a.trade.status === "NO TRADE") expect(a.trade.reasonsAgainst.length).toBeGreaterThan(0);
  });
});

describe("support & resistance (module F)", () => {
  it("keeps structural and OI-only layers separately classified", () => {
    const a = analyzeSymbol(feed({ prices: ramp(45, 100, 115) }));
    expect(a.sr.structural.length).toBeGreaterThan(0);
    expect(a.sr.oiOnly.length).toBeGreaterThan(0);
    const kinds = new Set([...a.sr.structural, ...a.sr.oiOnly].map((z) => z.kind));
    expect(kinds.has("confluence") || kinds.has("structural") || kinds.has("oi-only")).toBe(true);
    for (const z of [...a.sr.structural, ...a.sr.oiOnly]) {
      expect(z.strength).toBeGreaterThanOrEqual(0);
      expect(z.strength).toBeLessThanOrEqual(100);
      expect(z.sources.length).toBeGreaterThan(0);
    }
  });

  it("places support below price and resistance above it", () => {
    const a = analyzeSymbol(feed({ prices: ramp(45, 100, 115) }));
    if (a.sr.primarySupport) expect(a.sr.primarySupport.price).toBeLessThanOrEqual(a.price * 1.001);
    if (a.sr.primaryResistance) expect(a.sr.primaryResistance.price).toBeGreaterThanOrEqual(a.price * 0.999);
  });
});
