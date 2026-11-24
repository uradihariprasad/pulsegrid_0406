import { atr, bollinger, close, ema, last, pct, readStructure, relativeVolume, slope, vwap } from "../indicators";
import type { Condition, SymbolFeed, UnderlyingAnalysis } from "../types";

/**
 * MODULE A — Underlying spot momentum.
 * Input: normalised SymbolFeed. Output: UnderlyingAnalysis (typed contract).
 * Every condition reports `met: null` when the input series is too short or the
 * value is unavailable — absence is never recorded as a satisfied test.
 */
export function analyzeUnderlying(feed: SymbolFeed): UnderlyingAnalysis {
  // INVALID / no-candle feeds are still analysed safely so they can be shown in
  // the incomplete-universe tables without crashing the engine stack.
  if (!feed.spot5.length) {
    return {
      bias: "neutral",
      last: feed.spotQuote.ltp || 0,
      changePct: feed.spotQuote.unavailable ? null as never : feed.spotQuote.changePct,
      vwap: null,
      ema: { e9: null, e21: null, e50: null, e200: null },
      emaSlope: { s9: null, s21: null },
      bb: { mid: null, up: null, lo: null, width: null, expanding: null },
      atr: null,
      atrPct: null,
      relVol: null,
      volumeTrend: null,
      structure: {
        trend: "sideways",
        hh: false,
        hl: false,
        lh: false,
        ll: false,
        lastSwingHigh: null,
        lastSwingLow: null,
        breakout: false,
        breakdown: false,
        retest: false,
      },
      conditions: { bullish: [], bearish: [] },
      volLast: null,
      volAvg: null,
      bullMet: 0,
      bearMet: 0,
      bullMissing: 0,
      bearMissing: 0,
    };
  }
  const c5 = feed.spot5;
  const c = close(c5);
  const e9 = ema(c, 9);
  const e21 = ema(c, 21);
  const e50 = ema(c, 50);
  const e200 = ema(c, 200);
  const v = vwap(c5);
  const bb = bollinger(c, 20, 2);
  const a = atr(c5, 14);
  const rv = relativeVolume(c5, 20);
  const struct = readStructure(c5, 2);

  const price = feed.spotQuote.ltp || c[c.length - 1];
  const prevClose = feed.spotQuote.prevClose;
  const changePct = feed.spotQuote.changePct || pct(price, prevClose);
  const vwapNow = last(v);
  const e9n = last(e9);
  const e21n = last(e21);
  const e50n = last(e50);
  const e200n = last(e200);
  const s9 = slope(e9, 3);
  const s21 = slope(e21, 3);
  const atrNow = last(a);
  const relVolNow = last(rv);
  const mid = last(bb.mid);
  const up = last(bb.up);
  const lo = last(bb.lo);
  const widthNow = last(bb.width);
  const widthPrev = bb.width[bb.width.length - 6] ?? null;
  const expanding = widthNow !== null && widthPrev !== null ? widthNow > widthPrev : null;

  const volLast = c5[c5.length - 1]?.v ?? null;
  const volAvg =
    c5.length > 21 ? c5.slice(-21, -1).reduce((x, y) => x + y.v, 0) / (c5.length - 1) : null;
  const volumeTrend: UnderlyingAnalysis["volumeTrend"] =
    relVolNow === null ? null : relVolNow > 1.15 ? "expanding" : relVolNow < 0.85 ? "contracting" : "flat";

  const prevHigh = feed.prevDay?.high ?? null;
  const prevLow = feed.prevDay?.low ?? null;
  const atrRef = atrNow ?? price * 0.005;

  const cond = (label: string, met: boolean | null, detail: string): Condition => ({ label, met, detail });

  const bullish: Condition[] = [
    cond(
      "Spot above session VWAP",
      vwapNow === null ? null : price > vwapNow,
      vwapNow === null ? "VWAP unavailable" : `price ${pct(price, vwapNow).toFixed(2)}% vs VWAP`,
    ),
    cond("EMA 9 above EMA 21", e9n === null || e21n === null ? null : e9n > e21n, e9n === null || e21n === null ? "short series" : `spread ${((e9n - e21n) / price * 100).toFixed(3)}%`),
    cond("EMA 9 slope rising", s9 === null ? null : s9 > 0, s9 === null ? "insufficient bars" : `${s9.toFixed(3)} pts/bar`),
    cond("EMA 21 slope rising", s21 === null ? null : s21 > 0, s21 === null ? "insufficient bars" : `${s21.toFixed(3)} pts/bar`),
    cond("Price above EMA 50", e50n === null ? null : price > e50n, e50n === null ? "EMA50 not formed" : `${pct(price, e50n).toFixed(2)}%`),
    cond("Price above EMA 200", e200n === null ? null : price > e200n, e200n === null ? "EMA200 not formed (needs 200 bars)" : `${pct(price, e200n).toFixed(2)}%`),
    cond("Structure: higher highs", struct.hh, struct.lastSwingHigh === null ? "no confirmed swing" : `last swing high ${struct.lastSwingHigh.toFixed(2)}`),
    cond("Structure: higher lows", struct.hl, struct.lastSwingLow === null ? "no confirmed swing" : `last swing low ${struct.lastSwingLow.toFixed(2)}`),
    cond(
      "Relative volume expansion",
      relVolNow === null ? null : relVolNow > 1.15,
      relVolNow === null ? "volume history < 20 bars" : `${relVolNow.toFixed(2)}× 20-bar mean`,
    ),
    cond("Bollinger expansion with rising mid", expanding === null ? null : expanding && mid !== null && mid > (bb.mid[bb.mid.length - 6] ?? mid), expState(expanding, widthNow)),
    cond(
      "Price above previous-day high",
      prevHigh === null ? null : price > prevHigh,
      prevHigh === null ? "previous session levels unavailable" : `PDH ${prevHigh.toFixed(2)}`,
    ),
  ];

  const bearish: Condition[] = [
    cond("Spot below session VWAP", vwapNow === null ? null : price < vwapNow, vwapNow === null ? "VWAP unavailable" : `${pct(price, vwapNow).toFixed(2)}% vs VWAP`),
    cond("EMA 9 below EMA 21", e9n === null || e21n === null ? null : e9n < e21n, e9n === null || e21n === null ? "short series" : `spread ${((e9n - e21n) / price * 100).toFixed(3)}%`),
    cond("EMA 9 slope falling", s9 === null ? null : s9 < 0, s9 === null ? "insufficient bars" : `${s9.toFixed(3)} pts/bar`),
    cond("EMA 21 slope falling", s21 === null ? null : s21 < 0, s21 === null ? "insufficient bars" : `${s21.toFixed(3)} pts/bar`),
    cond("Price below EMA 50", e50n === null ? null : price < e50n, e50n === null ? "EMA50 not formed" : `${pct(price, e50n).toFixed(2)}%`),
    cond("Price below EMA 200", e200n === null ? null : price < e200n, e200n === null ? "EMA200 not formed" : `${pct(price, e200n).toFixed(2)}%`),
    cond("Structure: lower highs", struct.lh, struct.lastSwingHigh === null ? "no confirmed swing" : `last swing high ${struct.lastSwingHigh.toFixed(2)}`),
    cond("Structure: lower lows", struct.ll, struct.lastSwingLow === null ? "no confirmed swing" : `last swing low ${struct.lastSwingLow.toFixed(2)}`),
    cond(
      "Relative volume expansion on decline",
      relVolNow === null ? null : relVolNow > 1.15,
      relVolNow === null ? "volume history < 20 bars" : `${relVolNow.toFixed(2)}× 20-bar mean`,
    ),
    cond("Bollinger expansion with falling mid", expanding === null ? null : expanding && mid !== null && mid < (bb.mid[bb.mid.length - 6] ?? mid), expState(expanding, widthNow)),
    cond(
      "Price below previous-day low",
      prevLow === null ? null : price < prevLow,
      prevLow === null ? "previous session levels unavailable" : `PDL ${prevLow.toFixed(2)}`,
    ),
  ];

  const bMet = bullish.filter((x) => x.met === true).length;
  const bMiss = bullish.filter((x) => x.met === null).length;
  const sMet = bearish.filter((x) => x.met === true).length;
  const sMiss = bearish.filter((x) => x.met === null).length;

  let bias: UnderlyingAnalysis["bias"] = "neutral";
  if (bMet >= 5 && bMet >= sMet + 2) bias = "bullish";
  else if (sMet >= 5 && sMet >= bMet + 2) bias = "bearish";

  const breakout = prevHigh === null ? false : price > prevHigh && struct.trend !== "down";
  const breakdown = prevLow === null ? false : price < prevLow && struct.trend !== "up";
  const retest =
    (breakout && struct.lastSwingHigh !== null && Math.abs(price - struct.lastSwingHigh) < atrRef * 0.75) ||
    (breakdown && struct.lastSwingLow !== null && Math.abs(price - struct.lastSwingLow) < atrRef * 0.75);

  return {
    bias,
    last: price,
    changePct,
    vwap: vwapNow,
    ema: { e9: e9n, e21: e21n, e50: e50n, e200: e200n },
    emaSlope: { s9, s21 },
    bb: { mid, up, lo, width: widthNow, expanding },
    atr: atrNow,
    atrPct: atrNow === null ? null : (atrNow / price) * 100,
    relVol: relVolNow,
    volumeTrend,
    structure: {
      trend: struct.trend,
      hh: struct.hh,
      hl: struct.hl,
      lh: struct.lh,
      ll: struct.ll,
      lastSwingHigh: struct.lastSwingHigh,
      lastSwingLow: struct.lastSwingLow,
      breakout,
      breakdown,
      retest: retest ?? false,
    },
    conditions: { bullish, bearish },
    volLast,
    volAvg,
    bullMet: bMet,
    bearMet: sMet,
    bullMissing: bMiss,
    bearMissing: sMiss,
  };
}

function expState(expanding: boolean | null, width: number | null): string {
  if (expanding === null || width === null) return "band width unavailable";
  return `${expanding ? "expanding" : "contracting"} @ ${width.toFixed(2)}%`;
}
