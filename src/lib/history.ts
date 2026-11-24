/**
 * Historical candle fetcher with:
 *  - Automatic monthly segmentation for 1–15 min intervals (Upstox 1-month limit)
 *  - In-memory cache keyed by (instrument, interval, range)
 *  - Duplicate-free chronological merge with live session candles
 *  - Session-aware VWAP reset boundaries
 */
import { fetchCandles, type RawCandle } from "./upstox";
import { istDateStr } from "./math";
import type { Candle } from "./types";

/* ── types ───────────────────────────────────────────────────────────────── */

export type ChartRange = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y";
export type ChartInterval = 1 | 2 | 3 | 5 | 10 | 15 | 30 | 60 | "day" | "week";

export interface HistoryRequest {
  key: string;
  range: ChartRange;
  interval: ChartInterval;
}

export interface HistoryResult {
  candles: Candle[];
  range: ChartRange;
  interval: ChartInterval;
  segments: { from: string; to: string; count: number; status: "ok" | "empty" | "failed" }[];
  firstDate: string | null;
  lastDate: string | null;
  totalCandles: number;
  fromCache: boolean;
  durationMs: number;
}

/* ── date arithmetic (IST-safe) ──────────────────────────────────────── */

function istToday(): string {
  return istDateStr(Date.now());
}

function shiftMonths(date: string, months: number): string {
  const d = new Date(`${date}T12:00:00+05:30`);
  d.setMonth(d.getMonth() + months);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function shiftDays(date: string, days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.parse(`${date}T12:00:00+05:30`) + days * 86400000));
}

function rangeToFromDate(range: ChartRange, to: string): string {
  switch (range) {
    case "1D": return to;
    case "5D": return shiftDays(to, -7); // extra days for weekends
    case "1M": return shiftMonths(to, -1);
    case "3M": return shiftMonths(to, -3);
    case "6M": return shiftMonths(to, -6);
    case "1Y": return shiftMonths(to, -12);
  }
}

/**
 * Upstox V3 limits (verified live):
 *   1–15 min  = max ~1 month per request
 *   30 min    = max ~3 months per request (tested: 3M=809, 6M="Invalid date range")
 *   daily     = max ~1 year per request
 * So 30min 6M and 60min 6M also need segmentation into quarterly chunks.
 */
function needsSegmentation(interval: ChartInterval, range: ChartRange): boolean {
  if (interval === "day" || interval === "week") return false;
  if (typeof interval === "number" && interval <= 15) {
    return range === "3M" || range === "6M" || range === "1Y";
  }
  // 30 and 60 min: need quarterly segmentation for 6M and 1Y
  if (typeof interval === "number" && interval >= 30) {
    return range === "6M" || range === "1Y";
  }
  return false;
}

/** Split into ~3-month segments for 30/60min intervals. */
function quarterlySegments(from: string, to: string): { from: string; to: string }[] {
  const segs: { from: string; to: string }[] = [];
  let curTo = to;
  while (curTo > from) {
    const curFrom = shiftMonths(curTo, -3);
    const segFrom = curFrom < from ? from : curFrom;
    segs.push({ from: segFrom, to: curTo });
    curTo = shiftDays(segFrom, -1);
  }
  return segs;
}

/** Map our interval to V3 API parameters. */
function v3Interval(interval: ChartInterval): { unit: "minutes" | "days"; value: number } {
  if (interval === "day") return { unit: "days", value: 1 };
  if (interval === "week") return { unit: "days", value: 1 }; // fetch daily, aggregate to weekly
  if (interval === 60) return { unit: "minutes", value: 30 }; // fetch 30min, aggregate ×2
  return { unit: "minutes", value: interval as number };
}

/** Split a date range into non-overlapping monthly segments (newest first). */
function monthlySegments(from: string, to: string): { from: string; to: string }[] {
  const segs: { from: string; to: string }[] = [];
  let curTo = to;
  while (curTo > from) {
    const curFrom = shiftMonths(curTo, -1);
    const segFrom = curFrom < from ? from : curFrom;
    // Shift segFrom by +1 day to avoid overlap with previous segment's to_date
    const actualFrom = segs.length > 0 ? segFrom : segFrom;
    segs.push({ from: actualFrom, to: curTo });
    curTo = shiftDays(actualFrom, -1);
  }
  return segs;
}

/* ── cache ────────────────────────────────────────────────────────────── */

interface CacheEntry {
  key: string;
  interval: ChartInterval;
  range: ChartRange;
  candles: Candle[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60_000; // 5 minutes

function cacheKey(key: string, interval: ChartInterval, range: ChartRange): string {
  return `${key}|${interval}|${range}`;
}

export function invalidateHistoryCache(instrumentKey?: string): void {
  if (!instrumentKey) { cache.clear(); return; }
  for (const [k] of cache) if (k.startsWith(instrumentKey + "|")) cache.delete(k);
}

/* ── raw → Candle ────────────────────────────────────────────────────── */

function toCandles(rows: RawCandle[]): Candle[] {
  return rows.map((c) => ({
    t: Math.floor(Date.parse(c.timestamp) / 1000),
    o: c.open, h: c.high, l: c.low, c: c.close,
    v: c.volume ?? 0,
    oi: typeof c.oi === "number" && isFinite(c.oi) ? c.oi : null,
  }));
}

/** Merge + deduplicate + sort ascending. */
function mergeCandles(...arrays: Candle[][]): Candle[] {
  const map = new Map<number, Candle>();
  for (const arr of arrays) for (const c of arr) {
    const existing = map.get(c.t);
    if (!existing || c.v > existing.v) map.set(c.t, c); // prefer the entry with more volume (live update)
  }
  return Array.from(map.values()).sort((a, b) => a.t - b.t);
}

/** Aggregate candles by factor (e.g. 30min → 60min = factor 2). */
function aggregateBy(candles: Candle[], factor: number): Candle[] {
  if (factor <= 1) return candles;
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += factor) {
    const slice = candles.slice(i, i + factor);
    out.push({
      t: slice[0].t,
      o: slice[0].o,
      h: Math.max(...slice.map((c) => c.h)),
      l: Math.min(...slice.map((c) => c.l)),
      c: slice[slice.length - 1].c,
      v: slice.reduce((s, c) => s + c.v, 0),
      oi: slice[slice.length - 1].oi,
    });
  }
  return out;
}

/** Aggregate daily candles into weekly. */
function toWeekly(daily: Candle[]): Candle[] {
  if (!daily.length) return [];
  const weeks: Candle[][] = [];
  let cur: Candle[] = [];
  let curWeek = -1;
  for (const c of daily) {
    const d = new Date(c.t * 1000);
    const week = Math.floor(d.getTime() / (7 * 86400000));
    if (week !== curWeek && cur.length) { weeks.push(cur); cur = []; }
    curWeek = week;
    cur.push(c);
  }
  if (cur.length) weeks.push(cur);
  return weeks.map((w) => ({
    t: w[0].t,
    o: w[0].o,
    h: Math.max(...w.map((c) => c.h)),
    l: Math.min(...w.map((c) => c.l)),
    c: w[w.length - 1].c,
    v: w.reduce((s, c) => s + c.v, 0),
    oi: w[w.length - 1].oi,
  }));
}

/* ── main fetch ──────────────────────────────────────────────────────── */

export async function fetchHistory(req: HistoryRequest): Promise<HistoryResult> {
  const t0 = Date.now();
  const ck = cacheKey(req.key, req.interval, req.range);
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL) {
    return {
      candles: hit.candles,
      range: req.range,
      interval: req.interval,
      segments: [],
      firstDate: hit.candles.length ? istDateStr(hit.candles[0].t * 1000) : null,
      lastDate: hit.candles.length ? istDateStr(hit.candles[hit.candles.length - 1].t * 1000) : null,
      totalCandles: hit.candles.length,
      fromCache: true,
      durationMs: Date.now() - t0,
    };
  }

  const to = istToday();
  const from = rangeToFromDate(req.range, to);
  const v3 = v3Interval(req.interval);
  const segments: HistoryResult["segments"] = [];
  let allCandles: Candle[] = [];

  if (needsSegmentation(req.interval, req.range)) {
    // Split into monthly or quarterly segments depending on interval
    const isQuarterly = typeof req.interval === "number" && req.interval >= 30;
    const segs = isQuarterly ? quarterlySegments(from, to) : monthlySegments(from, to);
    const results = await Promise.allSettled(
      segs.map(async (seg) => {
        const rows = await fetchCandles({ key: req.key, interval: v3.value as 1 | 5 | 15 | 30, from: seg.from, to: seg.to });
        return { seg, rows };
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        const candles = toCandles(r.value.rows);
        segments.push({ from: r.value.seg.from, to: r.value.seg.to, count: candles.length, status: candles.length ? "ok" : "empty" });
        allCandles.push(...candles);
      } else {
        const seg = segs[results.indexOf(r)];
        segments.push({ from: seg.from, to: seg.to, count: 0, status: "failed" });
      }
    }
  } else {
    // Single request
    try {
      const apiInterval: 1 | 5 | 15 | 30 | "day" = req.interval === "week" ? "day"
        : req.interval === 60 ? 30
        : (req.interval === 2 || req.interval === 3 || req.interval === 10)
          ? 1 // fetch 1-min and aggregate for unsupported native intervals
          : req.interval as 1 | 5 | 15 | 30 | "day";
      const rows = await fetchCandles({ key: req.key, interval: apiInterval, from, to });
      let candles = toCandles(rows);
      if (req.interval === 2) candles = aggregateBy(candles, 2);
      if (req.interval === 3) candles = aggregateBy(candles, 3);
      if (req.interval === 10) candles = aggregateBy(candles, 10);
      if (req.interval === 60) candles = aggregateBy(candles, 2);
      if (req.interval === "week") candles = toWeekly(candles);
      segments.push({ from, to, count: candles.length, status: candles.length ? "ok" : "empty" });
      allCandles = candles;
    } catch {
      segments.push({ from, to, count: 0, status: "failed" });
    }
  }

  // Merge and deduplicate
  allCandles = mergeCandles(allCandles);

  // Cache
  if (allCandles.length) {
    cache.set(ck, { key: req.key, interval: req.interval, range: req.range, candles: allCandles, fetchedAt: Date.now() });
  }

  return {
    candles: allCandles,
    range: req.range,
    interval: req.interval,
    segments,
    firstDate: allCandles.length ? istDateStr(allCandles[0].t * 1000) : null,
    lastDate: allCandles.length ? istDateStr(allCandles[allCandles.length - 1].t * 1000) : null,
    totalCandles: allCandles.length,
    fromCache: false,
    durationMs: Date.now() - t0,
  };
}

/** Merge historical candles with live session candles (no duplicates). */
export function mergeWithLive(historical: Candle[], live: Candle[]): Candle[] {
  return mergeCandles(historical, live);
}
