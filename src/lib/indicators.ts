/**
 * Indicator kernel. Pure functions, null-preserving: a missing input yields
 * `null`, never 0, so downstream engines can distinguish "absent" from "flat".
 * Nothing here looks ahead — every series function only uses values at or
 * before the index it is evaluated for.
 */
import type { Candle } from "./types";

export const close = (c: Candle[]) => c.map((x) => x.c);
export const high = (c: Candle[]) => c.map((x) => x.h);
export const low = (c: Candle[]) => c.map((x) => x.l);
export const volume = (c: Candle[]) => c.map((x) => x.v);

export function sma(vals: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i];
    if (i >= period) sum -= vals[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(vals: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  if (vals.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += vals[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < vals.length; i++) {
    prev = vals[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Last defined value of an indicator series. */
export function last(series: (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] !== null) return series[i];
  return null;
}

/** Slope over the last `n` defined points, expressed per bar. */
export function slope(series: (number | null)[], n = 3): number | null {
  const pts: { i: number; v: number }[] = [];
  for (let i = series.length - 1; i >= 0 && pts.length < n; i--) {
    if (series[i] !== null) pts.push({ i, v: series[i] as number });
  }
  if (pts.length < 2) return null;
  const newest = pts[0]; // collected back-to-front
  const oldest = pts[pts.length - 1];
  return (newest.v - oldest.v) / Math.max(1, newest.i - oldest.i);
}

export interface Bollinger {
  mid: (number | null)[];
  up: (number | null)[];
  lo: (number | null)[];
  width: (number | null)[];
}

export function bollinger(vals: number[], period = 20, mult = 2): Bollinger {
  const mid = sma(vals, period);
  const up: (number | null)[] = new Array(vals.length).fill(null);
  const lo: (number | null)[] = new Array(vals.length).fill(null);
  const width: (number | null)[] = new Array(vals.length).fill(null);
  for (let i = period - 1; i < vals.length; i++) {
    const m = mid[i] as number;
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) acc += (vals[j] - m) ** 2;
    const sd = Math.sqrt(acc / period);
    up[i] = m + mult * sd;
    lo[i] = m - mult * sd;
    width[i] = m !== 0 ? ((mult * sd * 2) / m) * 100 : null;
  }
  return { mid, up, lo, width };
}

/** Wilder ATR. */
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return out;
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    tr.push(i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  let acc = 0;
  for (let i = 1; i <= period; i++) acc += tr[i];
  let prev = acc / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** Session VWAP, anchored at the first candle of the array. */
export function vwap(candles: Candle[]): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let pv = 0;
  let vv = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const tp = (c.h + c.l + c.c) / 3;
    pv += tp * c.v;
    vv += c.v;
    out[i] = vv > 0 ? pv / vv : null;
  }
  return out;
}

/** Relative volume: current volume vs mean of the preceding `base` bars (no look-ahead). */
export function relativeVolume(candles: Candle[], base = 20): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = 0; i < candles.length; i++) {
    if (i < base) continue;
    let acc = 0;
    for (let j = i - base; j < i; j++) acc += candles[j].v;
    const mean = acc / base;
    out[i] = mean > 0 ? candles[i].v / mean : null;
  }
  return out;
}

export interface Swing {
  index: number;
  t: number;
  price: number;
  type: "high" | "low";
}

/** Fractal pivots requiring `k` bars on each side — only reported once confirmed. */
export function swings(candles: Candle[], k = 2): Swing[] {
  const out: Swing[] = [];
  for (let i = k; i < candles.length - k; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isHigh = false;
      if (candles[j].l <= candles[i].l) isLow = false;
    }
    if (isHigh) out.push({ index: i, t: candles[i].t, price: candles[i].h, type: "high" });
    if (isLow) out.push({ index: i, t: candles[i].t, price: candles[i].l, type: "low" });
  }
  return out;
}

export interface StructureRead {
  trend: "up" | "down" | "sideways";
  hh: boolean;
  hl: boolean;
  lh: boolean;
  ll: boolean;
  lastSwingHigh: number | null;
  lastSwingLow: number | null;
  lastPrevHigh: number | null;
  lastPrevLow: number | null;
}

export function readStructure(candles: Candle[], k = 2): StructureRead {
  const sw = swings(candles, k);
  const highs = sw.filter((s) => s.type === "high").map((s) => s.price);
  const lows = sw.filter((s) => s.type === "low").map((s) => s.price);
  const h1 = highs.length ? highs[highs.length - 1] : null;
  const h0 = highs.length > 1 ? highs[highs.length - 2] : null;
  const l1 = lows.length ? lows[lows.length - 1] : null;
  const l0 = lows.length > 1 ? lows[lows.length - 2] : null;
  const hh = h1 !== null && h0 !== null ? h1 > h0 : false;
  const lh = h1 !== null && h0 !== null ? h1 < h0 : false;
  const hl = l1 !== null && l0 !== null ? l1 > l0 : false;
  const ll = l1 !== null && l0 !== null ? l1 < l0 : false;
  let trend: StructureRead["trend"] = "sideways";
  if (hh && hl) trend = "up";
  else if (lh && ll) trend = "down";
  return { trend, hh, hl, lh, ll, lastSwingHigh: h1, lastSwingLow: l1, lastPrevHigh: h0, lastPrevLow: l0 };
}

/** Volume-profile over the session: POC plus 70% value area. */
export function volumeProfile(candles: Candle[], bins = 48): {
  poc: number | null;
  vah: number | null;
  val: number | null;
} {
  if (!candles.length) return { poc: null, vah: null, val: null };
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    lo = Math.min(lo, c.l);
    hi = Math.max(hi, c.h);
  }
  if (!isFinite(hi) || hi <= lo) return { poc: null, vah: null, val: null };
  const step = (hi - lo) / bins;
  const hist = new Array<number>(bins).fill(0);
  for (const c of candles) {
    const centre = (c.h + c.l) / 2;
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((centre - lo) / step)));
    hist[idx] += c.v;
  }
  const total = hist.reduce((a, b) => a + b, 0);
  if (total <= 0) return { poc: null, vah: null, val: null };
  let pocIdx = 0;
  for (let i = 1; i < bins; i++) if (hist[i] > hist[pocIdx]) pocIdx = i;
  let loI = pocIdx;
  let hiI = pocIdx;
  let acc = hist[pocIdx];
  while (acc < total * 0.7 && (loI > 0 || hiI < bins - 1)) {
    const down = loI > 0 ? hist[loI - 1] : -1;
    const up = hiI < bins - 1 ? hist[hiI + 1] : -1;
    if (up >= down) {
      hiI++;
      acc += Math.max(0, up);
    } else {
      loI--;
      acc += Math.max(0, down);
    }
  }
  const centreOf = (i: number) => lo + step * (i + 0.5);
  return { poc: centreOf(pocIdx), vah: centreOf(hiI), val: centreOf(loI) };
}

/**
 * Aggregate lower-timeframe candles into higher-timeframe buckets.
 * Bucket boundaries are aligned to the exchange session grid (09:15 IST),
 * so 3×5-minute candles form one 15-minute candle exactly as the exchange does.
 */
export function aggregate(candles: Candle[], factor: number): Candle[] {
  if (factor <= 1) return candles.slice();
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let remaining = factor;
  for (const c of candles) {
    if (!cur) {
      cur = { ...c };
      remaining = factor - 1;
      out.push(cur);
      continue;
    }
    cur.h = Math.max(cur.h, c.h);
    cur.l = Math.min(cur.l, c.l);
    cur.c = c.c;
    cur.v += c.v;
    cur.oi = c.oi ?? cur.oi ?? null;
    if (--remaining === 0) cur = null;
  }
  return out;
}

export function pct(a: number, b: number): number {
  return b === 0 ? 0 : ((a - b) / b) * 100;
}

export function clamp(v: number, lo = 0, hi = 1): number {
  return Math.min(hi, Math.max(lo, v));
}

export function round(v: number | null, d = 2): number | null {
  if (v === null || !isFinite(v)) return null;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
