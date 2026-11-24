import { aggregate } from "../indicators";
import { marketPhase } from "../math";
import { analyzeFutures } from "./futures";
import { analyzeOptions, optionFlowReturns } from "./options";
import { assessQuality } from "./momentum";
import { analyzeFlow } from "./flow";
import { analyzeOiMomentum } from "./oiMomentum";
import { scoreMomentum } from "./scoring";
import { buildSRLayers } from "./structure";
import { analyzeUnderlying } from "./underlying";
import { buildTrade, deriveEvents } from "./trade";
import type { ScanResult, SymbolAnalysis, SymbolFeed } from "../types";

/**
 * Unified decision pipeline. Order matters and is fixed:
 *   spot → options → futures (needs premium response) → S/R → flow →
 *   scoring → quality/stage → trade geometry → events.
 * Each stage is an independently testable function with a typed contract.
 */
export function analyzeSymbol(feed: SymbolFeed): SymbolAnalysis {
  const u = analyzeUnderlying(feed);
  const o = analyzeOptions(feed, u);
  const { ceRet, peRet } = optionFlowReturns(feed);
  const f = analyzeFutures(feed, u, { ceRet, peRet });
  const sr = buildSRLayers(feed, u);
  const flow = analyzeFlow(feed, u, sr);
  const oiMomentum = analyzeOiMomentum(feed, u, f, o);
  const scores = scoreMomentum({ feed, u, f, o, sr, flow, oi: oiMomentum });
  const momentum = assessQuality({ feed, u, f, o, sr, flow, bull: scores.bull, bear: scores.bear });
  const trade = buildTrade({ feed, u, f, o, sr, flow, scores, momentum });
  const events = deriveEvents({ feed, u, f, o, sr, flow, scores, momentum }, feed.meta.symbol, feed.source);

  return {
    meta: feed.meta,
    source: feed.source,
    completeness: feed.completeness,
    missing: feed.missing,
    oiMomentum,
    asOf: feed.asOf,
    freshnessMs: Math.max(0, Date.now() - feed.asOf),
    stale: scores.stale,
    price: u.last,
    changePct: u.changePct,
    underlying: u,
    futures: f,
    options: o,
    sr,
    flow,
    scores,
    momentum,
    trade,
    events,
    notes: feed.notes,
  };
}

const ACTIONABLE = new Set([
  "ENTRY ELIGIBLE",
  "ACTIVE CONTINUATION",
  "RETEST OPPORTUNITY",
  "ENTRY CONFIRMATION PENDING",
  "MOMENTUM BUILDING",
  "EXHAUSTION WARNING",
]);

export function buildScan(
  feeds: SymbolFeed[],
  generatedAt = Date.now(),
  limitations: string[] = [],
): ScanResult {
  const analyses = feeds.map(analyzeSymbol);
  const nifty = analyses.find((a) => a.meta.symbol === "NIFTY") ?? null;
  const sensex = analyses.find((a) => a.meta.symbol === "SENSEX") ?? null;
  // breadth excludes instruments with no data (INVALID) so counts stay honest
  const stocks = analyses.filter((a) => a.meta.kind === "equity" && a.completeness !== "INVALID");

  const advancing = stocks.filter((a) => a.changePct > 0.05).length;
  const declining = stocks.filter((a) => a.changePct < -0.05).length;
  const unchanged = Math.max(0, stocks.length - advancing - declining);
  const bullish = analyses.filter((a) => a.scores.bull >= 50 && a.scores.bull > a.scores.bear).length;
  const bearish = analyses.filter((a) => a.scores.bear >= 50 && a.scores.bear > a.scores.bull).length;
  const strong = analyses
    .filter((a) => a.scores.band === "STRONG" || a.scores.band === "HIGH_CONFLUENCE")
    .sort((a, b) => Math.max(b.scores.bull, b.scores.bear) - Math.max(a.scores.bull, a.scores.bear));

  const topBull = analyses
    .slice()
    .sort((a, b) => b.scores.bull - a.scores.bull)
    .slice(0, 10);
  const topBear = analyses
    .slice()
    .sort((a, b) => b.scores.bear - a.scores.bear)
    .slice(0, 10);

  const sectorMap = new Map<string, { sum: number; count: number }>();
  for (const a of analyses) {
    const s = sectorMap.get(a.meta.sector) ?? { sum: 0, count: 0 };
    s.sum += Math.max(a.scores.bull, a.scores.bear) * (a.scores.bull >= a.scores.bear ? 1 : -1);
    s.count++;
    sectorMap.set(a.meta.sector, s);
  }
  const sectors = Array.from(sectorMap.entries())
    .map(([sector, v]) => ({ sector, avgScore: Math.round(v.sum / v.count), count: v.count }))
    .sort((a, b) => b.avgScore - a.avgScore);

  const avgVolatilityPct =
    analyses.length > 0
      ? analyses.reduce((s, a) => s + (a.underlying.atrPct ?? 0), 0) / analyses.length
      : 0;

  const sentiment =
    bullish > bearish * 1.4 && bullish > 0
      ? "RISK-ON — bullish momentum broad"
      : bearish > bullish * 1.4 && bearish > 0
        ? "RISK-OFF — bearish momentum broad"
        : Math.abs(bullish - bearish) <= Math.max(2, analyses.length * 0.1)
          ? "BALANCED — two-sided, no breadth edge"
          : bullish > bearish
            ? "MILD RISK-ON"
            : "MILD RISK-OFF";

  const opportunities = analyses
    .filter((a) => ACTIONABLE.has(a.trade.status) && a.trade.direction !== "NONE")
    .sort((a, b) => Math.max(b.scores.bull, b.scores.bear) - Math.max(a.scores.bull, a.scores.bear))
    .slice(0, 10)
    .map((analysis, i) => ({ analysis, rank: i + 1 }));

  const events = analyses
    .flatMap((a) => a.events)
    .sort((a, b) => b.ts - a.ts);

  const noteSet = new Set<string>(limitations);
  for (const a of analyses) for (const n of a.notes) noteSet.add(n);

  const phase = marketPhase(Date.now());
  const streaming = phase === "OPEN" || phase === "PRE-OPEN";
  const first = feeds[0];
  return {
    generatedAt,
    source: "live",
    state: feeds.length ? (streaming ? "LIVE_DATA_AVAILABLE" : "HISTORICAL_DATA_AVAILABLE") : "DATA_UNAVAILABLE",
    connected: false,
    notice: null,
    sessionLabel: "",
    sessionDate: first?.sessionDate ?? null,
    mode: feeds.length ? (streaming ? "LIVE" : "HISTORICAL") : "NONE",
    servingStale: false,
    diagnostics: {
      connection: { connected: false, validatedAt: null, userId: null, sessionAgeMs: null },
      master: { nseRows: 0, bseRows: 0, futures: 0, options: 0, indices: 0, eligible: 0, expiredIgnored: 0, niftyKey: null, sensexKey: null, sources: [], fetchedAt: null },
      ingestion: {
        spotRequested: 0,
        spotOk: 0,
        quoteRequested: 0,
        quoteOk: 0,
        futuresRequested: 0,
        futuresOk: 0,
        chainRequested: 0,
        chainOk: 0,
        premiumHistoryOk: 0,
        premiumHistoryFailed: 0,
        instrumentsWithCandles: 0,
      },
      analysis: { discovered: 0, analyzed: 0, bullish: 0, bearish: 0, incomplete: 0 },
      database: { ok: true, lastWrite: null, error: null },
      failures: [],
    },
    analyses,
    overview: {
      nifty,
      sensex,
      advancing,
      declining,
      unchanged,
      bullish,
      bearish,
      strong,
      topBull,
      topBear,
      avgVolatilityPct: Math.round(avgVolatilityPct * 100) / 100,
      sentiment,
      sectors,
    },
    opportunities,
    events,
    limitations: Array.from(noteSet),
  };
}

/** Truncate a feed to the first `count` 5-minute bars (point-in-time, no look-ahead). */
export function sliceFeed(feed: SymbolFeed, count: number): SymbolFeed {
  const spot5 = feed.spot5.slice(0, count);
  const lastT = spot5[spot5.length - 1]?.t ?? 0;
  return {
    ...feed,
    spot5,
    spot15: aggregate(spot5, 3),
    spot1d: feed.spot1d.filter((d) => d.t <= lastT),
    prevDay: feed.prevDay,
    spotQuote: {
      ...feed.spotQuote,
      ltp: spot5[spot5.length - 1]?.c ?? feed.spotQuote.ltp,
      changePct: feed.spotQuote.prevClose
        ? ((spot5[spot5.length - 1]?.c ?? 0) - feed.spotQuote.prevClose) / feed.spotQuote.prevClose * 100
        : 0,
      asOf: lastT * 1000,
    },
    asOf: lastT * 1000,
    futures: feed.futures
      ? {
          ...feed.futures,
          candles: feed.futures.candles.slice(0, count),
          quote: { ...feed.futures.quote, asOf: lastT * 1000 },
        }
      : null,
    options: feed.options.map((o) => ({
      ...o,
      candles: o.candles.slice(0, count),
      oi: o.oi.filter((x) => x.t <= lastT),
      quote: {
        ...o.quote,
        ltp: o.candles.slice(0, count)[o.candles.slice(0, count).length - 1]?.c ?? o.quote.ltp,
        asOf: lastT * 1000,
      },
    })),
    depth: feed.depth ? { ...feed.depth, asOf: lastT * 1000 } : null,
  };
}
