/**
 * LIVE ADAPTER — fast, phased market-data ingestion.
 *
 * Architecture (measured: 8 parallel candle requests = 157ms):
 *   Phase 1: instrument master (cached 6h)         ~200ms
 *   Phase 2: batch quotes (all keys in 10-key chunks, parallel)  ~2s for 228 stocks
 *   Phase 3: spot 5m candles (30 parallel workers)  ~3s for 228 stocks
 *   Phase 4: futures 5m candles (30 parallel)       ~3s
 *   Phase 5: option chains (20 parallel)            ~4s
 *   TOTAL first scan: ~12s instead of ~230s
 *
 * Daily candles and premium history are fetched ON DEMAND when a stock is opened
 * in the detail view — they are never part of the scan path.
 */
import { aggregate } from "./indicators";
import { blackScholes, daysTo, istDateStr, resolveSessionWindow, type SessionWindow } from "./math";
import type { Candle, FuturesContract, OptionContract, Quote, SymbolFeed } from "./types";
import type { ContractSeed } from "./universe";
import {
  authorizeFeed,
  fetchCandles,
  fetchOptionChain,
  fetchQuotes,
  type ApiFailure,
  type ChainRow,
  type NormalisedQuote,
  type RawCandle,
} from "./upstox";

export interface LiveBuildResult {
  feeds: SymbolFeed[];
  errors: string[];
  failures: ApiFailure[];
  stats: {
    spotRequests: number;
    spotOk: number;
    quoteRequests: number;
    quoteOk: number;
    futuresRequests: number;
    futuresOk: number;
    chainRequests: number;
    chainOk: number;
    premiumHistoryOk: number;
    premiumHistoryFailed: number;
  };
  durationMs: number;
}

interface Budget { spent: number; cap: number; }

const SPOT_CONCURRENCY = 30;
const FUTURES_CONCURRENCY = 30;
const CHAIN_CONCURRENCY = 20;
const QUOTE_CHUNK = 15;

/* ── helpers ─────────────────────────────────────────────────────────────── */

async function poolSettled<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>,
  fallback: (t: T, e: unknown) => R,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    while (idx < items.length) {
      const i = idx++;
      try { out[i] = await fn(items[i]); }
      catch (e) { out[i] = fallback(items[i], e); }
    }
  });
  await Promise.all(workers);
  return out;
}

function shiftDays(date: string, days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.parse(`${date}T12:00:00+05:30`) + days * 86400000));
}

function istDateOfRows(rows: RawCandle[]): string | null {
  return rows.length ? istDateStr(Date.parse(rows[0].timestamp)) : null;
}

function toCandles(rows: RawCandle[]): Candle[] {
  return rows.map((c) => ({
    t: Math.floor(Date.parse(c.timestamp) / 1000),
    o: c.open, h: c.high, l: c.low, c: c.close,
    v: c.volume ?? 0,
    oi: typeof c.oi === "number" && isFinite(c.oi) ? c.oi : null,
  }));
}

function previousSessionDaily(d1: Candle[], sessionDate: string): Candle | null {
  if (!d1.length) return null;
  const last = d1[d1.length - 1];
  return istDateStr(last.t * 1000) === sessionDate ? (d1.length > 1 ? d1[d1.length - 2] : null) : last;
}

function quoteFrom(q: NormalisedQuote | undefined, key: string, asOf: number, live: boolean): Quote {
  if (!q || q.ltp === null) return { ltp: 0, prevClose: 0, changePct: 0, asOf, stale: true, unavailable: true, instrumentKey: key };
  return {
    ltp: q.ltp,
    prevClose: q.prevClose ?? q.ltp,
    changePct: q.changePct ?? (q.change !== null && q.prevClose ? (q.change / q.prevClose) * 100 : 0),
    bid: q.bid, ask: q.ask, bidQty: q.bidQty, askQty: q.askQty,
    depthBidQty: q.depthBid || null, depthAskQty: q.depthAsk || null,
    oi: q.oi, volume: q.volume,
    asOf: q.lastTradeTime && q.lastTradeTime > 1e9 ? q.lastTradeTime : q.timestamp && q.timestamp > 1e9 ? q.timestamp : asOf,
    stale: !live, unavailable: false, instrumentKey: q.instrumentKey,
    totalBuyQty: q.totalBuyQty, totalSellQty: q.totalSellQty,
  };
}

/* ── candle fetcher with intraday → historical → 1m fallback ─────────── */

async function fetchSessionCandles(
  key: string,
  interval: 5 | 15,
  win: SessionWindow,
  failures: ApiFailure[],
): Promise<{ candles: Candle[]; sessionDate: string; via: string }> {
  // 1) V3 intraday (live sessions only)
  if (win.live) {
    try {
      const rows = await fetchCandles({ key, interval, intraday: true });
      if (rows.length) return { candles: toCandles(rows), sessionDate: istDateOfRows(rows) ?? win.sessionDate, via: `intraday/${interval}` };
    } catch { /* fall through */ }
  }
  // 2) V3 historical — walk candidate dates
  for (const date of win.candidates.slice(0, 8)) {
    try {
      const rows = await fetchCandles({ key, interval, from: date, to: date });
      if (rows.length) return { candles: toCandles(rows), sessionDate: istDateOfRows(rows) ?? date, via: `hist/${interval}` };
    } catch (e) {
      const f = (e as { failure?: ApiFailure }).failure;
      if (f) failures.push({ ...f, instrument: key });
      break;
    }
  }
  // 3) 1-minute aggregation fallback
  if (win.live) {
    try {
      const rows = await fetchCandles({ key, interval: 1, intraday: true });
      if (rows.length) return { candles: aggregate(toCandles(rows), interval === 5 ? 5 : 3), sessionDate: istDateOfRows(rows) ?? win.sessionDate, via: "intraday/1→agg" };
    } catch { /* fall through */ }
  }
  for (const date of win.candidates.slice(0, 4)) {
    try {
      const rows = await fetchCandles({ key, interval: 1, from: date, to: date });
      if (rows.length) return { candles: aggregate(toCandles(rows), interval === 5 ? 5 : 3), sessionDate: istDateOfRows(rows) ?? date, via: "hist/1→agg" };
    } catch { break; }
  }
  return { candles: [], sessionDate: win.sessionDate, via: "none" };
}

/* ── option chain builder (chain-only, no premium history) ───────────── */

function buildOptionsFromChain(
  seed: ContractSeed, expiry: string, spotLast: number, chain: { rows: ChainRow[] },
): OptionContract[] {
  const rows = chain.rows;
  const strikes = rows.map((r) => r.strike);
  const atm = strikes.length ? strikes.reduce((b, s) => Math.abs(s - spotLast) < Math.abs(b - spotLast) ? s : b, strikes[0]) : null;
  if (atm === null) return [];
  const step = seed.strikeStep || 1;
  const wanted = [-3, -2, -1, 0, 1, 2, 3].map((k) => atm + k * step);
  const chosen = rows.filter((r) => wanted.some((w) => Math.abs(w - r.strike) < step / 2));
  const contracts: OptionContract[] = [];
  for (const row of chosen) {
    for (const side of ["CE", "PE"] as const) {
      const leg = side === "CE" ? row.ce : row.pe;
      if (!leg) continue;
      const ltp = leg.ltp ?? leg.close ?? 0;
      const prev = leg.close ?? ltp;
      const iv = leg.greeks.iv !== null && leg.greeks.iv > 1.5 ? leg.greeks.iv / 100 : leg.greeks.iv;
      const hasGreeks = leg.greeks.delta !== null || leg.greeks.gamma !== null;
      const derived = hasGreeks ? null : blackScholes(spotLast, row.strike, daysTo(row.expiry ?? expiry) / 365, iv ?? 0.22, 0.065, side);
      contracts.push({
        key: leg.instrumentKey, strike: row.strike, side, expiry: row.expiry ?? expiry, lotSize: seed.lot,
        candles: [], oi: [],
        quote: { ltp, prevClose: prev, changePct: prev ? ((ltp - prev) / prev) * 100 : 0, bid: leg.bid, ask: leg.ask, bidQty: leg.bidQty, askQty: leg.askQty, oi: leg.oi, volume: leg.volume, asOf: Date.now(), stale: false, instrumentKey: leg.instrumentKey },
        greeks: { delta: leg.greeks.delta ?? derived?.delta ?? null, gamma: leg.greeks.gamma ?? derived?.gamma ?? null, theta: leg.greeks.theta ?? derived?.theta ?? null, vega: leg.greeks.vega ?? derived?.vega ?? null, iv: iv ?? null },
        greeksSource: hasGreeks ? "provider" : "black-scholes-derived",
        oiSessionChange: leg.oi !== null && leg.prevOi !== null ? leg.oi - leg.prevOi : null,
      });
    }
  }
  return contracts;
}

/* ── on-demand enrichment for the stock inspector ────────────────────── */

export async function enrichFeedOptions(feed: SymbolFeed, cap = 12): Promise<SymbolFeed> {
  if (!feed.options.length || feed.options.some((o) => o.candles.length > 0)) return feed;
  const win = resolveSessionWindow();
  const expiry = feed.meta.expiries[0] ?? win.candidates[0];
  if (!expiry) return feed;
  const failures: ApiFailure[] = [];
  const budget: Budget = { spent: 0, cap };
  const enriched: OptionContract[] = [];
  for (const opt of feed.options) {
    if (budget.spent >= budget.cap) { enriched.push(opt); continue; }
    budget.spent++;
    try {
      const hist = await fetchSessionCandles(opt.key, 5, win, failures);
      enriched.push({ ...opt, candles: hist.candles, oi: hist.candles.filter((c) => typeof c.oi === "number").map((c) => ({ ...c, c: 0, o: 0, h: 0, l: 0, v: 0 })) });
    } catch { enriched.push(opt); }
  }
  return { ...feed, options: enriched, failures: [...(feed.failures ?? []), ...failures] };
}

export async function fetchExtendedHistory(feed: SymbolFeed, lookbackDays = 30): Promise<{
  spot5: Candle[]; spot15: Candle[]; spot1d: Candle[]; futures: Candle[];
}> {
  const win = resolveSessionWindow();
  const to = feed.sessionDate ?? win.candidates[0] ?? istDateStr();
  const from = shiftDays(to, -lookbackDays);
  const [m5, m15, d1, fut] = await Promise.allSettled([
    fetchCandles({ key: feed.meta.spotKey, interval: 5, from, to }),
    fetchCandles({ key: feed.meta.spotKey, interval: 15, from, to }),
    fetchCandles({ key: feed.meta.spotKey, interval: "day", from: shiftDays(to, -180), to }),
    feed.meta.futKey ? fetchCandles({ key: feed.meta.futKey, interval: 5, from, to }) : Promise.resolve([]),
  ]);
  return {
    spot5: m5.status === "fulfilled" && m5.value.length ? toCandles(m5.value) : feed.spot5,
    spot15: m15.status === "fulfilled" && m15.value.length ? toCandles(m15.value) : feed.spot15,
    spot1d: d1.status === "fulfilled" && d1.value.length ? toCandles(d1.value) : feed.spot1d,
    futures: fut.status === "fulfilled" && fut.value.length ? toCandles(fut.value) : feed.futures?.candles ?? [],
  };
}

/* ── MAIN: phased full-universe scan ─────────────────────────────────── */

export async function buildLiveFeeds(seeds: ContractSeed[]): Promise<LiveBuildResult> {
  const t0 = Date.now();
  const errors: string[] = [];
  const failures: ApiFailure[] = [];
  const stats: LiveBuildResult["stats"] = {
    spotRequests: 0, spotOk: 0, quoteRequests: 0, quoteOk: 0,
    futuresRequests: 0, futuresOk: 0, chainRequests: 0, chainOk: 0,
    premiumHistoryOk: 0, premiumHistoryFailed: 0,
  };

  const auth = await authorizeFeed();
  if (!auth.ok) failures.push({ endpoint: "/v3/feed/authorize", status: null, code: "FEED_AUTH", message: auth.error ?? "failed", retryable: true, at: Date.now() });

  const win = resolveSessionWindow();

  // ── PHASE 2: batch quotes (all instruments at once) ─────────────────
  const allSpotKeys = seeds.map((s) => s.spotKey);
  const allFutKeys = seeds.map((s) => s.futKey).filter((k): k is string => !!k);
  const allKeys = [...new Set([...allSpotKeys, ...allFutKeys])];
  stats.quoteRequests = allKeys.length;
  const quoteResult = await fetchQuotes(allKeys, QUOTE_CHUNK);
  stats.quoteOk = Object.keys(quoteResult.quotes).length;
  failures.push(...quoteResult.failures.slice(0, 20));
  const quotes = quoteResult.quotes;

  // ── PHASE 3: spot 5m candles (high parallelism) ─────────────────────
  const spotResults = await poolSettled(seeds, SPOT_CONCURRENCY, async (seed) => {
    stats.spotRequests++;
    const res = await fetchSessionCandles(seed.spotKey, 5, win, failures);
    if (res.candles.length) stats.spotOk++;
    return res;
  }, (_seed, _e) => ({ candles: [] as Candle[], sessionDate: win.sessionDate, via: "failed" }));

  // ── PHASE 4: futures 5m candles (high parallelism) ──────────────────
  const futResults = await poolSettled(seeds, FUTURES_CONCURRENCY, async (seed) => {
    if (!seed.futKey || !seed.expiry) return null;
    stats.futuresRequests++;
    const res = await fetchSessionCandles(seed.futKey, 5, win, failures);
    if (res.candles.length) stats.futuresOk++;
    const q = quotes[seed.futKey];
    const last = res.candles[res.candles.length - 1];
    const futAsOf = last ? last.t * 1000 : Date.now();
    return {
      key: seed.futKey, label: `${seed.symbol} ${seed.expiry} FUT`, expiry: seed.expiry, lotSize: seed.lot,
      candles: res.candles, quote: quoteFrom(q, seed.futKey, futAsOf, win.live),
    } satisfies FuturesContract;
  }, () => null);

  // ── PHASE 5: option chains (moderate parallelism) ───────────────────
  const chainResults = await poolSettled(seeds, CHAIN_CONCURRENCY, async (seed) => {
    const expiry = seed.expiry ?? win.candidates[0];
    if (!expiry) return [] as OptionContract[];
    stats.chainRequests++;
    try {
      const chain = await fetchOptionChain(seed.spotKey, expiry);
      if (chain.failure) { failures.push(chain.failure); return []; }
      const spotRef = quotes[seed.spotKey]?.ltp ?? spotResults[seeds.indexOf(seed)]?.candles[spotResults[seeds.indexOf(seed)]?.candles.length - 1]?.c ?? 0;
      stats.chainOk++;
      return buildOptionsFromChain(seed, expiry, spotRef, chain);
    } catch { return []; }
  }, () => [] as OptionContract[]);

  // ── ASSEMBLE FEEDS ──────────────────────────────────────────────────
  const feeds: SymbolFeed[] = seeds.map((seed, i) => {
    const spot5 = spotResults[i]?.candles ?? [];
    const sessionDate = spotResults[i]?.sessionDate ?? win.sessionDate;
    const spot15 = spot5.length ? aggregate(spot5, 3) : [];
    const lastBar = spot5[spot5.length - 1] ?? null;
    const sessionAsOf = lastBar ? lastBar.t * 1000 : Date.now();
    const expiry = seed.expiry ?? win.candidates[0];
    const q = quotes[seed.spotKey];
    const fut = futResults[i] ?? null;
    const options = chainResults[i] ?? [];

    // Build quote with correct Change%
    let quote: Quote;
    if (q && q.ltp !== null) {
      quote = quoteFrom(q, seed.spotKey, sessionAsOf, win.live);
      // Only recompute when provider genuinely didn't supply prevClose
      if (quote.prevClose === null || quote.prevClose === undefined || quote.prevClose === 0 || !Number.isFinite(quote.changePct)) {
        if (lastBar && lastBar.o > 0) {
          quote.prevClose = lastBar.o;
          quote.changePct = ((quote.ltp - lastBar.o) / lastBar.o) * 100;
        }
      }
    } else if (lastBar) {
      quote = { ltp: lastBar.c, prevClose: lastBar.o, changePct: lastBar.o ? ((lastBar.c - lastBar.o) / lastBar.o) * 100 : 0, asOf: lastBar.t * 1000, stale: true, unavailable: false, instrumentKey: seed.spotKey, source: "historical-close" };
    } else {
      quote = { ltp: 0, prevClose: 0, changePct: 0, asOf: sessionAsOf, stale: true, unavailable: true, instrumentKey: seed.spotKey };
    }

    const notes: string[] = [];
    if (!spot5.length) notes.push(`${seed.symbol}: no 5-minute candles available`);
    if (!fut && seed.futKey) notes.push(`${seed.symbol}: futures candles unavailable`);
    if (!options.length && expiry) notes.push(`${seed.symbol}: option chain unavailable`);

    const missing: string[] = [];
    if (spot5.length < 5) missing.push(`spot candles (${spot5.length})`);
    if (!fut) missing.push("futures");
    if (!options.length) missing.push("options");

    return {
      meta: {
        symbol: seed.symbol, name: seed.name, sector: seed.sector, kind: seed.kind,
        isin: seed.isin, exchange: seed.exchange, spotKey: seed.spotKey, futKey: seed.futKey,
        lotSize: seed.lot, strikeInterval: seed.strikeStep, expiries: expiry ? [expiry] : [],
        origin: "upstox-master" as const,
      },
      completeness: spot5.length === 0 ? "INVALID" : missing.length ? "PARTIAL" : "COMPLETE",
      missing,
      source: "live",
      asOf: sessionAsOf,
      sessionDate,
      prevDay: null, // daily candles fetched on demand in detail view
      spot5, spot15, spot1d: [],
      spotQuote: quote,
      futures: fut,
      options,
      depth: (quote.depthBidQty != null && quote.depthAskQty != null)
        ? { bidQty: quote.depthBidQty, askQty: quote.depthAskQty, asOf: quote.asOf }
        : null,
      notes,
      failures: [],
    };
  });

  const durationMs = Date.now() - t0;
  console.info(`[scan] ${feeds.length} instruments in ${durationMs}ms · spot ${stats.spotOk}/${stats.spotRequests} · fut ${stats.futuresOk}/${stats.futuresRequests} · chain ${stats.chainOk}/${stats.chainRequests} · quotes ${stats.quoteOk}/${stats.quoteRequests}`);

  return { feeds, errors, failures, stats, durationMs };
}
