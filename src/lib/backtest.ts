import { analyzeSymbol, sliceFeed } from "./engines";
import type { SymbolFeed } from "./types";

export interface BacktestRow {
  symbol: string;
  index: number;
  ts: number;
  direction: "LONG" | "SHORT";
  band: string;
  stage: string;
  score: number;
  entry: number;
  exit: number;
  grossPct: number;
  netPct: number;
  hit: boolean;
}

export interface ScoreBandStats {
  band: string;
  signals: number;
  wins: number;
  winRate: number;
  avgNet: number;
  expectancy: number;
}

export interface BacktestReport {
  symbolCount: number;
  signals: number;
  wins: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdown: number;
  falseBreakoutRate: number;
  falseBreakdownRate: number;
  breakTests: { breakoutCalls: number; breakdownCalls: number };
  byBand: ScoreBandStats[];
  byStage: { stage: string; signals: number; winRate: number }[];
  bullSignals: { signals: number; winRate: number };
  bearSignals: { signals: number; winRate: number };
  calibrate: { period: string; inSample: number; outOfSample: number };
  costs: string;
  note: string;
}

/** Per-side costs in basis points: brokerage, slippage, exchange/STT & levies. */
const COSTS = { brokerageBps: 3, slippageBps: 2, exchangeBps: 1 };
/** One round trip, expressed in percentage points (6 bps × 2 sides = 0.12%). */
const ROUND_TRIP_PCT = ((COSTS.brokerageBps + COSTS.slippageBps + COSTS.exchangeBps) * 2) / 100;

/**
 * Walk-forward evaluation on finalised candles ONLY.
 * - signal decided on the close of bar i (no look-ahead)
 * - entry at the open of bar i+1 (realistic delay)
 * - exit after 6 bars (30 minutes) at that bar's close
 * - flat costs applied per side
 * First 60% of the session = in-sample calibration window, last 40% = held-out.
 * Results are reported as historical trade statistics, never as probabilities.
 */
export function runBacktest(feeds: SymbolFeed[], maxSymbols = 14, lookbackStart = 34): BacktestReport {
  const chosen = feeds.slice(0, maxSymbols);
  const rows: BacktestRow[] = [];

  for (const feed of chosen) {
    const n = feed.spot5.length;
    if (n < 24) continue;
    for (let i = Math.max(20, n - lookbackStart); i < n - 6; i++) {
      const slice = sliceFeed(feed, i + 1);
      const a = analyzeSymbol(slice);
      if (a.trade.direction === "NONE") continue;
      if (a.scores.band === "NONE" || a.scores.band === "WEAK") continue;
      const entryBar = feed.spot5[i + 1];
      const exitBar = feed.spot5[Math.min(n - 1, i + 7)];
      if (!entryBar || !exitBar) continue;
      const gross =
        a.trade.direction === "LONG"
          ? ((exitBar.c - entryBar.o) / entryBar.o) * 100
          : ((entryBar.o - exitBar.c) / entryBar.o) * 100;
      const net = gross - ROUND_TRIP_PCT;
      rows.push({
        symbol: feed.meta.symbol,
        index: i,
        ts: entryBar.t * 1000,
        direction: a.trade.direction,
        band: a.scores.band,
        stage: a.momentum.stage,
        score: Math.max(a.scores.bull, a.scores.bear),
        entry: entryBar.o,
        exit: exitBar.c,
        grossPct: Math.round(gross * 100) / 100,
        netPct: Math.round(net * 100) / 100,
        hit: net > 0,
      });
    }
  }

  const wins = rows.filter((r) => r.hit);
  const losses = rows.filter((r) => !r.hit);
  const grossWin = wins.reduce((s, r) => s + r.netPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r.netPct, 0));
  const profitFactor = grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : grossWin > 0 ? 99.99 : 0;
  const expectancy = rows.length ? Math.round(((grossWin - grossLoss) / rows.length) * 1000) / 1000 : 0;

  // equity curve / max drawdown on cumulative net return
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const r of rows) {
    equity += r.netPct;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  const bands = ["WEAK", "DEVELOPING", "STRONG", "HIGH_CONFLUENCE"];
  const byBand: ScoreBandStats[] = bands.map((band) => {
    const set = rows.filter((r) => r.band === band);
    const w = set.filter((r) => r.hit).length;
    return {
      band,
      signals: set.length,
      wins: w,
      winRate: set.length ? Math.round((w / set.length) * 1000) / 10 : 0,
      avgNet: set.length ? Math.round((set.reduce((s, r) => s + r.netPct, 0) / set.length) * 1000) / 1000 : 0,
      expectancy: set.length ? Math.round((set.reduce((s, r) => s + r.netPct, 0) / set.length) * 1000) / 1000 : 0,
    };
  });

  const stages = Array.from(new Set(rows.map((r) => r.stage)));
  const byStage = stages.map((stage) => {
    const set = rows.filter((r) => r.stage === stage);
    const w = set.filter((r) => r.hit).length;
    return { stage, signals: set.length, winRate: set.length ? Math.round((w / set.length) * 1000) / 10 : 0 };
  });

  const bull = rows.filter((r) => r.direction === "LONG");
  const bear = rows.filter((r) => r.direction === "SHORT");
  const rate = (set: BacktestRow[]) =>
    set.length ? Math.round((set.filter((r) => r.hit).length / set.length) * 1000) / 10 : 0;

  const cut = Math.floor(rows.length * 0.6);
  const inSample = rate(rows.slice(0, cut));
  const outOfSample = rate(rows.slice(cut));

  // Outcome-based false break/breakdown statistics: a genuine-breakout call at
  // bar i is judged against the following 6 bars — if price traded back through
  // the level it did not hold, i.e. the breakout failed.
  let breakoutCalls = 0;
  let falseBreakouts = 0;
  let breakdownCalls = 0;
  let falseBreakdowns = 0;
  for (const feed of chosen) {
    const n = feed.spot5.length;
    for (let i = Math.max(20, n - lookbackStart); i < n - 6; i++) {
      const a = analyzeSymbol(sliceFeed(feed, i + 1));
      const st = a.momentum.breakout.state;
      const level = a.momentum.breakout.level;
      if (level === null) continue;
      if (st === "genuine-breakout") {
        breakoutCalls++;
        const held = feed.spot5.slice(i + 1, i + 7).every((b) => b.l > level);
        if (!held) falseBreakouts++;
      } else if (st === "genuine-breakdown") {
        breakdownCalls++;
        const held = feed.spot5.slice(i + 1, i + 7).every((b) => b.h < level);
        if (!held) falseBreakdowns++;
      }
    }
  }
  const falseBreakoutRate = breakoutCalls ? Math.round((falseBreakouts / breakoutCalls) * 1000) / 10 : 0;
  const falseBreakdownRate = breakdownCalls ? Math.round((falseBreakdowns / breakdownCalls) * 1000) / 10 : 0;

  return {
    symbolCount: chosen.length,
    signals: rows.length,
    wins: wins.length,
    winRate: rate(rows),
    profitFactor,
    expectancy,
    maxDrawdown: Math.round(maxDd * 100) / 100,
    falseBreakoutRate,
    falseBreakdownRate,
    byBand,
    byStage,
    bullSignals: { signals: bull.length, winRate: rate(bull) },
    bearSignals: { signals: bear.length, winRate: rate(bear) },
    calibrate: { period: "first 60% in-sample / last 40% held-out", inSample, outOfSample },
    costs: `round trip ${(ROUND_TRIP_PCT * 100).toFixed(0)} bps (brokerage ${COSTS.brokerageBps} + slippage ${COSTS.slippageBps} + exchange/STT ${COSTS.exchangeBps} bps per side), 30-minute holding, entry at next open`,
    breakTests: { breakoutCalls, breakdownCalls },
    note:
      "Heuristic confluence scores are NOT calibrated probabilities. These figures describe historical behaviour of the current rule set on the analysed session only; they are not a forecast and have not been validated across multiple regimes.",
  };
}
