/**
 * Orchestration — live Upstox data only (no synthetic path exists).
 *
 * Cache rules (Part D.9):
 *  - keyed by token fingerprint + session date + live/historical mode, so a new
 *    token or a new session can never be served the previous context's data;
 *  - invalidated on connect and on disconnect;
 *  - empty/failed results are NOT cached (a transient error cannot pin an empty
 *    dashboard), but a previous good result for the same key is served with
 *    `servingStale: true` instead of being thrown away;
 *  - live TTL 20s, historical TTL 5min.
 */
import { buildScan } from "./engines";
import { discoverUniverse, type UniverseResult } from "./universe";
import { buildLiveFeeds, type LiveBuildResult } from "./live";
import { LIMITATIONS, connectionState, getSession, invalidateMaster } from "./upstox";
import { istDateStr, marketPhase, resolveSessionWindow } from "./math";
import type { FeedFailure, ScanDiagnostics, ScanResult, ScanState, SymbolFeed } from "./types";

interface CacheEntry {
  key: string;
  at: number;
  feeds: SymbolFeed[];
  errors: string[];
  failures: FeedFailure[];
  stats: LiveBuildResult["stats"] | null;
  diag: UniverseResult["diag"] | null;
  discovered: number;
  summary: string;
}

let cache: CacheEntry | null = null;
let inflight: Promise<CacheEntry> | null = null;

function tokenFingerprint(): string {
  const s = getSession();
  if (!s) return "none";
  let h = 7;
  for (let i = 0; i < s.token.length; i++) h = (h * 31 + s.token.charCodeAt(i)) | 0;
  return `${s.validatedAt}:${h}`;
}

function cacheKey(): string {
  const win = resolveSessionWindow();
  return `${tokenFingerprint()}|${win.candidates[0]}|${win.live ? "LIVE" : "HIST"}`;
}

/** Called on token connect and disconnect. */
export function clearScanCache(): void {
  cache = null;
  invalidateMaster();
}

/**
 * A full-universe scan issues ~7 requests per instrument (≈1.6k requests), so
 * the TTL must be longer than one scan cycle: 60s while trading (candles are
 * 5-minute anyway) and 10 minutes outside the session, so repeated tab switches
 * never trigger back-to-back full rescans.
 */
function ttl(): number {
  const phase = marketPhase(Date.now());
  // 30s live: matches the auto-scan cadence. Overlapping scans are prevented by
  // the in-flight guard, so a slow scan is joined rather than duplicated.
  return phase === "OPEN" || phase === "PRE-OPEN" ? 30_000 : 600_000;
}

const EMPTY_STATS: LiveBuildResult["stats"] = {
  spotRequests: 0,
  spotOk: 0,
  quoteRequests: 0,
  quoteOk: 0,
  futuresRequests: 0,
  futuresOk: 0,
  chainRequests: 0,
  chainOk: 0,
  premiumHistoryOk: 0,
  premiumHistoryFailed: 0,
};
void EMPTY_STATS;

async function getFeeds(): Promise<CacheEntry> {
  if (!getSession()) {
    return { key: "none", at: Date.now(), feeds: [], errors: [], failures: [], stats: null, diag: null, discovered: 0, summary: "no session" };
  }
  const key = cacheKey();
  const now = Date.now();
  if (cache && cache.key === key && now - cache.at < ttl()) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const errors: string[] = [];
    const failures: FeedFailure[] = [];
    let discovered = 0;
    let diag: UniverseResult["diag"] | null = null;
    let summary = "";
    let stats: LiveBuildResult["stats"] | null = null;

    try {
      const universe = await discoverUniverse();
      diag = universe.diag;
      errors.push(...universe.errors);
      failures.push(...universe.failures);
      discovered = universe.seeds.length;
      summary = `master NSE=${universe.diag.nseRows} BSE=${universe.diag.bseRows} futures=${universe.diag.futures} options=${universe.diag.options} indices=${universe.diag.indices} eligible=${universe.diag.eligibleUnderlyings} expiredIgnored=${universe.diag.expiredIgnored} NIFTY=${universe.diag.indexKeys.nifty ?? "missing"} SENSEX=${universe.diag.indexKeys.sensex ?? "missing"}`;

      if (!universe.ok) {
        // failure — do not cache an empty result
        return { key, at: now, feeds: [], errors, failures, stats, diag, discovered, summary };
      }

      const t0 = Date.now();
      const res = await buildLiveFeeds(universe.seeds);
      console.info(`[scan] full scan completed in ${res.durationMs}ms (${res.feeds.length} instruments)`);
      stats = res.stats;
      errors.push(...res.errors);
      failures.push(...res.failures);
      for (const f of res.feeds) if (f.notes.length) errors.push(...f.notes.slice(0, 2));

      const entry: CacheEntry = {
        key,
        at: now,
        feeds: res.feeds.filter((f) => f.meta && f.meta.symbol),
        errors,
        failures: failures.slice(0, 40),
        stats,
        diag,
        discovered,
        summary,
      };
      // Only successful (or partially successful) results are cached.
      if (res.feeds.length) cache = entry;
      return entry;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
      failures.push({ endpoint: "scan", status: null, code: "SCAN", message: msg, retryable: true, at: now });
      // transient failure → keep serving the previous good data for this key
      if (cache && cache.key === key) return { ...cache, at: now, errors: [...cache.errors, msg], failures: [...cache.failures, ...failures] };
      return { key, at: now, feeds: [], errors, failures, stats, diag, discovered, summary };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function buildDiagnostics(entry: CacheEntry, analyses: ScanResult["analyses"], dbStatus: { ok: boolean; lastWrite: number | null; error: string | null }): ScanDiagnostics {
  const conn = connectionState();
  const d = entry.diag;
  return {
    connection: {
      connected: conn.connected,
      validatedAt: conn.validatedAt,
      userId: conn.userId,
      sessionAgeMs: conn.validatedAt ? Date.now() - conn.validatedAt : null,
    },
    master: {
      nseRows: d?.nseRows ?? 0,
      bseRows: d?.bseRows ?? 0,
      futures: d?.futures ?? 0,
      options: d?.options ?? 0,
      indices: d?.indices ?? 0,
      eligible: d?.eligibleUnderlyings ?? 0,
      expiredIgnored: d?.expiredIgnored ?? 0,
      niftyKey: d?.indexKeys.nifty ?? null,
      sensexKey: d?.indexKeys.sensex ?? null,
      sources: d?.sources ?? [],
      fetchedAt: d?.fetchedAt ?? null,
    },
    ingestion: {
      spotRequested: entry.stats?.spotRequests ?? 0,
      spotOk: entry.stats?.spotOk ?? 0,
      quoteRequested: entry.stats?.quoteRequests ?? 0,
      quoteOk: entry.stats?.quoteOk ?? 0,
      futuresRequested: entry.stats?.futuresRequests ?? 0,
      futuresOk: entry.stats?.futuresOk ?? 0,
      chainRequested: entry.stats?.chainRequests ?? 0,
      chainOk: entry.stats?.chainOk ?? 0,
      premiumHistoryOk: entry.stats?.premiumHistoryOk ?? 0,
      premiumHistoryFailed: entry.stats?.premiumHistoryFailed ?? 0,
      instrumentsWithCandles: entry.feeds.filter((f) => f.spot5.length > 0).length,
    },
    analysis: {
      discovered: entry.discovered,
      analyzed: analyses.length,
      bullish: analyses.filter((a) => a.scores.bull >= 50 && a.scores.bull > a.scores.bear).length,
      bearish: analyses.filter((a) => a.scores.bear >= 50 && a.scores.bear > a.scores.bull).length,
      incomplete: analyses.filter((a) => a.futures.positioning === "INSUFFICIENT DATA" || a.options.alignment === "unavailable").length,
    },
    database: dbStatus,
    failures: entry.failures,
  };
}

export async function getScan(): Promise<ScanResult> {
  if (!getSession()) {
    const result = buildScan([], Date.now(), LIMITATIONS);
    result.connected = false;
    result.state = "TOKEN_REQUIRED";
    result.mode = "NONE";
    result.sessionDate = null;
    result.notice =
      "No Upstox session is attached. MARKET MASTER never generates, substitutes or fabricates market data — paste a valid Upstox access token above to load live or historical candles, quotes, option chains and open interest.";
    result.sessionLabel = "NO CONNECTION — AWAITING UPSTOX TOKEN";
    result.diagnostics.connection = { connected: false, validatedAt: null, userId: null, sessionAgeMs: null };
    return result;
  }

  const entry = await getFeeds();
  const win = resolveSessionWindow();
  const streaming = win.live;

  const withCandles = entry.feeds.filter((f) => f.spot5.length > 0);
  // Even when NO candles exist, every discovered instrument must remain visible
  // in the Full Universe table with its quote, LTP, Change%, and data-status.
  // The dashboard must NEVER go blank just because candles are unavailable.
  if (!entry.feeds.length) {
    const result = buildScan([], Date.now(), LIMITATIONS);
    result.connected = true;
    result.mode = "NONE";
    result.sessionDate = null;
    result.sessionLabel = "CONNECTED — NO INSTRUMENTS DISCOVERED";
    result.state = entry.diag && entry.diag.failures.length ? "PROVIDER_ERROR" : "DATA_UNAVAILABLE";
    result.notice = entry.diag && entry.diag.failures.length
      ? `Instrument master failed: ${entry.diag.failures.map((f) => `${f.endpoint} → ${f.code} ${f.message}`).join(" | ")}. Diagnostics: ${entry.summary}`
      : `Connected, but no instruments discovered. Diagnostics: ${entry.summary || "no master data"}. ${entry.errors.slice(0, 3).join(" | ")}`;
    result.diagnostics = buildDiagnostics(entry, [], await dbStatus());
    result.limitations = [...result.limitations, entry.summary, ...entry.errors.slice(0, 6)];
    return result;
  }

  // every discovered instrument is analysed: those without candles come through
  // as completeness INVALID (excluded from strict scanners, listed with reasons)
  const result = buildScan(entry.feeds, Date.now(), [...LIMITATIONS, entry.summary]);
  result.connected = true;
  const candleCount = withCandles.length;
  const noCandles = entry.feeds.length - candleCount;
  const firstWithCandles = withCandles[0];
  result.sessionDate = firstWithCandles?.sessionDate ?? entry.feeds.find((f) => f.sessionDate)?.sessionDate ?? win.sessionDate;
  result.mode = streaming ? "LIVE" : "HISTORICAL";
  result.sessionLabel = streaming
    ? `LIVE UPSTOX · session ${result.sessionDate} OPEN · ${candleCount}/${entry.feeds.length} with candles${noCandles ? ` · ${noCandles} quote-only` : ""}`
    : `UPSTOX · HISTORICAL session ${result.sessionDate} · ${candleCount}/${entry.feeds.length} with candles${noCandles ? ` · ${noCandles} quote-only` : ""}`;

  const partial =
    (entry.stats?.futuresRequests ?? 0) > (entry.stats?.futuresOk ?? 0) ||
    (entry.stats?.chainRequests ?? 0) > (entry.stats?.chainOk ?? 0) ||
    (entry.stats?.quoteRequests ?? 0) > (entry.stats?.quoteOk ?? 0);

  result.state = streaming
    ? partial
      ? "PARTIAL_DATA_AVAILABLE"
      : "LIVE_DATA_AVAILABLE"
    : partial
      ? "PARTIAL_DATA_AVAILABLE"
      : "HISTORICAL_DATA_AVAILABLE";

  const db = await dbStatus();
  if (!db.ok) result.state = result.state === "PARTIAL_DATA_AVAILABLE" ? "DATABASE_UNAVAILABLE" : result.state;

  const issues = entry.errors.length ? ` ${entry.errors.length} data issue(s) this scan — see diagnostics.` : "";
  result.notice = streaming
    ? entry.errors.length
      ? issues.trim()
      : null
    : `Market closed — candles, open interest and premium history were read for session ${result.sessionDate} through the V3 historical endpoints. Quotes are last-traded values: real, finalised, labelled HISTORICAL — never streamed, never simulated.${issues}`;
  result.diagnostics = buildDiagnostics(entry, result.analyses, db);
  result.limitations = [...result.limitations, entry.summary];
  if (entry.errors.length) result.limitations.push(...entry.errors.slice(0, 8));

  void persist(result);
  return result;
}

export async function getFeedFor(symbol: string): Promise<SymbolFeed | null> {
  const c = await getFeeds();
  return c.feeds.find((f) => f.meta.symbol === symbol.toUpperCase()) ?? null;
}

/** Feeds used by the historical evaluation (live session candles, truncated per bar). */
export async function getFeedsForBacktest(): Promise<SymbolFeed[]> {
  const c = await getFeeds();
  return c.feeds;
}

export function sourceMode(): "live" | "none" {
  return getSession() ? "live" : "none";
}

/** Session date used by the UI before a scan completes. */
export function currentSessionDate(): string {
  return resolveSessionWindow().candidates[0] ?? istDateStr();
}

async function dbStatus(): Promise<{ ok: boolean; lastWrite: number | null; error: string | null }> {
  try {
    const m = await import("./persist");
    return m.persistenceStatus();
  } catch (e) {
    // Database must never block the market-data pipeline — reported separately.
    return { ok: false, lastWrite: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function persist(result: ScanResult): Promise<void> {
  try {
    const { writeScan } = await import("./persist");
    await writeScan(result);
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[market-master] persistence skipped:", e instanceof Error ? e.message : e);
    }
  }
}

export type { ScanState };
