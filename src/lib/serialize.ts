import type { ScanResult, SymbolAnalysis } from "./types";

/** Deep-clone an analysis without the per-contract candle/oi arrays. */
export function stripAnalysis<T extends SymbolAnalysis>(a: T): SymbolAnalysis {
  return {
    ...a,
    events: [],
    options: {
      ...a.options,
      strikes: a.options.strikes.map((r) => ({
        ...r,
        ce: r.ce ? { ...r.ce, contract: lightContract(r.ce.contract) } : null,
        pe: r.pe ? { ...r.pe, contract: lightContract(r.pe.contract) } : null,
      })),
      bestCE: a.options.bestCE,
      bestPE: a.options.bestPE,
    },
  };
}

function lightContract<T extends { candles: unknown[]; oi: unknown[] }>(c: T): T {
  return { ...c, candles: [], oi: [] } as T;
}

/**
 * Wire format: analyses without per-contract candle arrays and without the
 * per-analysis event copies (the top-level `events` array is authoritative).
 * Derived collections (index rows, top lists, opportunity rows) are dropped
 * here and rebuilt client-side by `hydrateScan` — they are pure duplicates of
 * `analyses` and would otherwise double the payload.
 */
export function lightScan(scan: ScanResult): ScanResult {
  return {
    ...scan,
    analyses: scan.analyses.map(stripAnalysis),
    opportunities: [],
    overview: {
      ...scan.overview,
      strong: [],
      topBull: [],
      topBear: [],
      nifty: null,
      sensex: null,
    },
  };
}

/** Rebuild the derived collections from `analyses` (client side, no extra bytes). */
export function hydrateScan(scan: ScanResult): ScanResult {
  const byBull = scan.analyses.slice().sort((a, b) => b.scores.bull - a.scores.bull);
  const byBear = scan.analyses.slice().sort((a, b) => b.scores.bear - a.scores.bear);
  return {
    ...scan,
    overview: {
      ...scan.overview,
      topBull: byBull.slice(0, 10),
      topBear: byBear.slice(0, 10),
      strong: scan.analyses
        .filter((a) => a.scores.band === "STRONG" || a.scores.band === "HIGH_CONFLUENCE")
        .sort((a, b) => Math.max(b.scores.bull, b.scores.bear) - Math.max(a.scores.bull, a.scores.bear)),
      nifty: scan.analyses.find((a) => a.meta.symbol === "NIFTY") ?? null,
      sensex: scan.analyses.find((a) => a.meta.symbol === "SENSEX") ?? null,
    },
    opportunities: scan.analyses
      .filter(
        (a) =>
          ["ENTRY ELIGIBLE", "ACTIVE CONTINUATION", "RETEST OPPORTUNITY", "ENTRY CONFIRMATION PENDING", "MOMENTUM BUILDING", "EXHAUSTION WARNING"].includes(
            a.trade.status,
          ) && a.trade.direction !== "NONE",
      )
      .sort((a, b) => Math.max(b.scores.bull, b.scores.bear) - Math.max(a.scores.bull, a.scores.bear))
      .slice(0, 10)
      .map((analysis, i) => ({ analysis, rank: i + 1 })),
  };
}
