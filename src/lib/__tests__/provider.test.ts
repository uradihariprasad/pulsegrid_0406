/**
 * API-contract tests against recorded, sanitised provider payload fixtures.
 * Fixtures mirror the documented Upstox response shapes. They are used ONLY
 * here (automated tests) and never as application market data.
 */
import { describe, expect, it } from "vitest";
import {
  buildCandleUrl,
  normaliseMaster,
  normaliseQuote,
  parseChainRows,
  validateCandles,
  type RawCandle,
} from "../upstox";
import { resolveSessionWindow, istDateStr } from "../math";

describe("instrument master normalisation (NSE.json.gz fixture rows)", () => {
  const futFixture = {
    weekly: false,
    segment: "NSE_FO",
    name: "VEDANTA LIMITED",
    exchange: "NSE",
    expiry: 1798568999000, // epoch ms → 2026-12-29 IST
    instrument_type: "FUT",
    asset_symbol: "VEDL",
    underlying_symbol: "VEDL",
    instrument_key: "NSE_FO|59150",
    lot_size: 1150,
    exchange_token: "59150",
    underlying_key: "NSE_EQ|INE205A01025",
    underlying_type: "EQUITY",
    trading_symbol: "VEDL FUT 29 DEC 26",
    strike_price: 0,
    isin: "INE205A01025",
  };

  it("maps fields, preserves instrument_key and converts expiry to IST", () => {
    const row = normaliseMaster(futFixture)!;
    expect(row).not.toBeNull();
    expect(row.instrumentKey).toBe("NSE_FO|59150");
    expect(row.underlyingKey).toBe("NSE_EQ|INE205A01025");
    expect(row.symbol).toBe("VEDL");
    expect(row.lot).toBe(1150);
    expect(row.instrumentType).toBe("FUT");
    expect(row.expiry).toBe("2026-12-29");
  });

  it("accepts string expiries and index rows without expiry", () => {
    const idx = normaliseMaster({
      segment: "BSE_INDEX",
      exchange: "BSE",
      instrument_type: "INDEX",
      instrument_key: "BSE_INDEX|SENSEX",
      trading_symbol: "SENSEX",
      name: "BSE Sensex",
    })!;
    expect(idx.instrumentKey).toBe("BSE_INDEX|SENSEX");
    expect(idx.expiry).toBeNull();
  });

  it("rejects rows without an instrument key", () => {
    expect(normaliseMaster({ segment: "NSE_EQ", symbol: "X" })).toBeNull();
  });
});

describe("market quote normalisation (snake_case fixture)", () => {
  it("reads last_price, ohlc.close as previous close, depth and totals", () => {
    const q = normaliseQuote("NSE_EQ|INE002A01018", {
      instrument_key: "NSE_EQ|INE002A01018",
      last_price: 1377.5,
      net_change: -12.25,
      ohlc: { open: 1390, high: 1395, low: 1372, close: 1389.75 },
      volume: 4_500_000,
      oi: 0,
      depth: {
        buy: [{ price: 1377.4, quantity: 120 }, { price: 1377.2, quantity: 300 }],
        sell: [{ price: 1377.6, quantity: 90 }, { price: 1377.9, quantity: 210 }],
      },
      timestamp: 1795250000,
      last_trade_time: 1795249990,
      total_buy_quantity: 220_000,
      total_sell_quantity: 190_000,
    })!;
    expect(q.ltp).toBe(1377.5);
    expect(q.prevClose).toBe(1389.75);
    expect(q.change).toBeCloseTo(-12.25, 6);
    expect(q.changePct).toBeCloseTo((-12.25 / 1389.75) * 100, 6);
    expect(q.bid).toBe(1377.4);
    expect(q.bidQty).toBe(120);
    expect(q.ask).toBe(1377.6);
    expect(q.askQty).toBe(90);
    expect(q.depthBid).toBe(420);
    expect(q.depthAsk).toBe(300);
    expect(q.totalBuyQty).toBe(220_000);
    expect(q.lastTradeTime).toBe(1795249990);
    expect(q.volume).toBe(4_500_000);
  });

  it("falls back to close_price / prev_close when ohlc is absent", () => {
    const q = normaliseQuote("X", { last_price: 100, prev_close: 95 })!;
    expect(q.prevClose).toBe(95);
    expect(q.changePct).toBeCloseTo((5 / 95) * 100, 6);
  });

  it("returns null instead of a zero quote when no price exists", () => {
    expect(normaliseQuote("X", { instrument_key: "X", total_buy_quantity: 5 })).toBeNull();
  });
});

describe("option chain parsing (nested fixture)", () => {
  const payload = {
    data: [
      {
        strike_price: 1380,
        expiry: "2026-12-29",
        underlying_key: "NSE_EQ|INE002A01018",
        underlying_spot_price: 1377.5,
        call_options: {
          instrument_key: "NSE_FO|90001",
          market_data: { ltp: 12.4, volume: 120_000, oi: 3_400_000, prev_oi: 3_200_000, close_price: 11.9, bid_price: 12.3, bid_qty: 50, ask_price: 12.5, ask_qty: 75 },
          option_greeks: { delta: 0.52, gamma: 0.004, theta: -0.6, vega: 0.11, iv: 14.2, pop: 0.54 },
        },
        put_options: {
          instrument_key: "NSE_FO|90002",
          market_data: { ltp: 9.1, oi: 2_100_000 },
          option_greeks: { delta: -0.47, iv: 15.1 },
        },
      },
      {
        strike_price: 1400,
        expiry: "2026-12-29",
        underlying_key: "NSE_EQ|INE002A01018",
        underlying_spot_price: 1377.5,
        call_options: { instrument_key: "NSE_FO|90003", market_data: { ltp: 6.2, oi: 1_000_000 }, option_greeks: { delta: 0.31, iv: 13.8 } },
        // PE deliberately missing
      },
    ],
  };

  it("parses both legs, preserves keys and handles a missing PE", () => {
    const rows = parseChainRows(payload);
    expect(rows).toHaveLength(2);
    expect(rows[0].strike).toBe(1380);
    expect(rows[0].ce?.instrumentKey).toBe("NSE_FO|90001");
    expect(rows[0].ce?.ltp).toBe(12.4);
    expect(rows[0].ce?.oi).toBe(3_400_000);
    expect(rows[0].ce?.prevOi).toBe(3_200_000);
    expect(rows[0].ce?.greeks.delta).toBe(0.52);
    expect(rows[0].ce?.greeksSource).toBe("provider");
    expect(rows[0].pe?.instrumentKey).toBe("NSE_FO|90002");
    expect(rows[0].pe?.greeks.gamma).toBeNull();
    expect(rows[1].pe).toBeNull();
    expect(rows[0].spot).toBe(1377.5);
    expect(rows[0].expiry).toBe("2026-12-29");
  });

  it("returns [] for an empty or malformed payload", () => {
    expect(parseChainRows({ data: [] })).toEqual([]);
    expect(parseChainRows(null)).toEqual([]);
    expect(parseChainRows({ data: { unexpected: 1 } })).toEqual([]);
  });
});

describe("candle validation", () => {
  const row = (ts: string, o: number, h: number, l: number, c: number, v = 100, oi?: number): RawCandle => ({
    timestamp: ts,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: v,
    oi,
  });

  it("sorts ascending, drops duplicates and invalid rows", () => {
    const { rows, issues } = validateCandles([
      row("2026-11-20T09:20:00+05:30", 100, 101, 99, 100.5),
      row("2026-11-20T09:15:00+05:30", 99, 100, 98, 99.5),
      row("2026-11-20T09:15:00+05:30", 99, 100, 98, 99.5), // duplicate
      row("2026-11-20T09:25:00+05:30", 100, 99, 101, 100.5), // high < open
      row("2026-11-20T09:30:00+05:30", 100, 102, 99, 101, -5), // negative volume
      row("bad-timestamp", 1, 2, 0.5, 1.5),
    ]);
    expect(rows.map((r) => r.timestamp)).toEqual([
      "2026-11-20T09:15:00+05:30",
      "2026-11-20T09:20:00+05:30",
    ]);
    expect(issues.length).toBe(4);
  });

  it("accepts valid candles with OI and keeps OHLC coherent", () => {
    const { rows, issues } = validateCandles([row("2026-11-20T09:15:00+05:30", 100, 104, 99, 102, 500, 1_200_000)]);
    expect(issues).toHaveLength(0);
    expect(rows[0].oi).toBe(1_200_000);
  });
});

describe("V3 request construction", () => {
  it("builds documented intraday, historical-minute and daily URLs", () => {
    expect(buildCandleUrl({ key: "NSE_EQ|INE002A01018", interval: 5, intraday: true })).toBe(
      "https://api.upstox.com/v3/historical-candle/intraday/NSE_EQ%7CINE002A01018/minutes/5",
    );
    expect(buildCandleUrl({ key: "NSE_FO|59150", interval: 5, from: "2026-11-20", to: "2026-11-20" })).toBe(
      "https://api.upstox.com/v3/historical-candle/NSE_FO%7C59150/minutes/5/2026-11-20/2026-11-20",
    );
    expect(buildCandleUrl({ key: "NSE_FO|59150", interval: 15, from: "2026-11-20", to: "2026-11-21" })).toContain("/minutes/15/2026-11-21/2026-11-20");
    expect(buildCandleUrl({ key: "NSE_EQ|INE002A01018", interval: "day", from: "2026-08-24", to: "2026-11-20" })).toContain("/days/1/2026-11-20/2026-08-24");
  });
});

describe("session resolution", () => {
  it("walks backwards from today and excludes weekends", () => {
    const w = resolveSessionWindow(Date.parse("2026-11-21T12:00:00+05:30")); // Saturday
    expect(w.live).toBe(false);
    expect(w.mode).toBe("HISTORICAL");
    expect(w.candidates[0]).toBe("2026-11-20"); // Friday
    expect(w.candidates.some((d) => ["Sat", "Sun"].includes(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }).format(new Date(`${d}T12:00:00+05:30`))))).toBe(false);
    expect(w.candidates.length).toBeGreaterThan(5);
    // holiday on Monday → candidates still contain earlier real sessions
    expect(w.candidates).toContain("2026-11-19");
  });

  it("uses today's session while the exchange is trading", () => {
    const w = resolveSessionWindow(Date.parse("2026-11-20T10:30:00+05:30"));
    expect(w.live).toBe(true);
    expect(w.candidates[0]).toBe("2026-11-20");
    expect(w.sessionDate).toBe(istDateStr(Date.parse("2026-11-20T10:30:00+05:30")));
  });

  it("selects today's completed session after a weekday close", () => {
    const w = resolveSessionWindow(Date.parse("2026-11-20T16:30:00+05:30"));
    expect(w.live).toBe(false);
    expect(w.candidates[0]).toBe("2026-11-20");
  });
});
