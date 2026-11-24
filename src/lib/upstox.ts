/**
 * Upstox API client — the ONLY market-data provider.
 *
 * Verified against the live API (2026-11):
 *   - Instrument master  : GET https://assets.upstox.com/market-quote/instruments/exchange/{NSE,BSE}.json.gz
 *                          (public, gzipped JSON array — NSE 96,615 rows / BSE 30,974 rows)
 *   - Candles            : GET https://api.upstox.com/v3/historical-candle/{key}/minutes/{1|5|15|30}/{to}/{from}
 *                          GET https://api.upstox.com/v3/historical-candle/intraday/{key}/minutes/{1|5|15|30}
 *                          GET https://api.upstox.com/v3/historical-candle/{key}/days/1/{to}/{from}
 *   - Quotes             : GET /v2/market-quote/quotes?instrument_key=A,B   (snake_case response)
 *   - Option chain       : GET /v2/option/chain?instrument_key=…&expiry_date=YYYY-MM-DD
 *                          (rows: strike_price, call_options{instrument_key,market_data,option_greeks}, put_options{…})
 *   - Profile            : GET /v2/user/profile
 *   - Feed authorize     : GET /v2/feed/market-data-feed/authorize
 *
 * Every failure is recorded as a structured `ApiFailure` (endpoint, status,
 * provider error code, message, retryability, instrument) so the diagnostics
 * panel can show exactly which stage broke. Tokens live in process memory only.
 */
import { gunzipSync } from "zlib";

export const UPSTOX_BASE = "https://api.upstox.com/v2";
export const UPSTOX_V3 = "https://api.upstox.com/v3";
export const MASTER_FILES = [
  { code: "NSE", url: "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz" },
  { code: "BSE", url: "https://assets.upstox.com/market-quote/instruments/exchange/BSE.json.gz" },
] as const;

export interface TokenSession {
  token: string;
  validatedAt: number;
  profile: { userId: string; name: string; email: string; pan?: string; segment: string[] };
}

interface Store {
  session: TokenSession | null;
  feedUrl: string | null;
  lastError: string | null;
  connectedAt: number | null;
}

const g = globalThis as typeof globalThis & { __marketMasterStore?: Store };
export const store: Store = g.__marketMasterStore ?? {
  session: null,
  feedUrl: null,
  lastError: null,
  connectedAt: null,
};
g.__marketMasterStore = store;

export const getSession = (): TokenSession | null => store.session;

export const maskToken = (v: string): string => `len=${v.length}`;

/* ── structured failures & retry policy ─────────────────────────────────── */

export interface ApiFailure {
  endpoint: string;
  status: number | null;
  code: string | null;
  message: string;
  instrument?: string;
  retryable: boolean;
  at: number;
}

export class UpstoxApiError extends Error {
  constructor(
    readonly failure: ApiFailure,
  ) {
    super(`${failure.endpoint} → ${failure.status ?? "network"}: ${failure.code ? `${failure.code} ` : ""}${failure.message}`);
  }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 522, 524]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Global request gate: bounded concurrency + in-flight sharing + short-TTL dedupe. */
const MAX_INFLIGHT = 10;
let inflight = 0;
const waiters: (() => void)[] = [];
const shared = new Map<string, { at: number; promise: Promise<unknown> }>();

/** Keep the dedupe map bounded (entries older than 60s are pruned on write). */
function pruneShared(): void {
  if (shared.size < 512) return;
  const cutoff = Date.now() - 60_000;
  for (const [k, v] of shared) if (v.at < cutoff) shared.delete(k);
}

async function acquire(): Promise<void> {
  if (inflight < MAX_INFLIGHT) {
    inflight++;
    return;
  }
  await new Promise<void>((r) => waiters.push(r));
  inflight++;
}
function release(): void {
  inflight--;
  const next = waiters.shift();
  if (next) next();
}

async function once<T>(url: string, init: RequestInit, timeoutMs: number, instrument?: string): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const dedupeKey = `${method} ${url}`;
  if (method === "GET") {
    const hit = shared.get(dedupeKey);
    if (hit && Date.now() - hit.at < 5000) return hit.promise as Promise<T>;
  }
  const run = (async () => {
    await acquire();
    try {
      return await gatedFetch<T>(url, init, timeoutMs, instrument);
    } finally {
      release();
    }
  })();
  if (method === "GET") {
    pruneShared();
    shared.set(dedupeKey, { at: Date.now(), promise: run });
  }
  try {
    return (await run) as T;
  } catch (e) {
    if (method === "GET") shared.delete(dedupeKey);
    throw e;
  }
}

async function gatedFetch<T>(url: string, init: RequestInit, timeoutMs: number, instrument?: string): Promise<T> {
  const token = store.session?.token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new UpstoxApiError({
        endpoint: url,
        status: res.status,
        code: "INVALID_JSON",
        message: text.slice(0, 180),
        instrument,
        retryable: RETRYABLE_STATUS.has(res.status),
        at: Date.now(),
      });
    }
    if (!res.ok) {
      const payload = json as { errors?: { errorCode?: string; message?: string }[]; message?: string; error_code?: string };
      const first = Array.isArray(payload?.errors) ? payload.errors[0] : undefined;
      throw new UpstoxApiError({
        endpoint: url,
        status: res.status,
        code: first?.errorCode ?? payload?.error_code ?? String(res.status),
        message: first?.message ?? payload?.message ?? res.statusText,
        instrument,
        retryable: RETRYABLE_STATUS.has(res.status),
        at: Date.now(),
      });
    }
    return json as T;
  } catch (e) {
    if (e instanceof UpstoxApiError) throw e;
    const aborted = (e as Error)?.name === "AbortError";
    throw new UpstoxApiError({
      endpoint: url,
      status: null,
      code: aborted ? "TIMEOUT" : "NETWORK",
      message: aborted ? `timed out after ${timeoutMs}ms` : String((e as Error)?.message ?? e),
      instrument,
      retryable: true,
      at: Date.now(),
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Bounded retries with exponential backoff + jitter. 4xx (except 429) never retried. */
async function call<T>(
  path: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number; instrument?: string; retries?: number; base?: string } = {},
): Promise<T> {
  const { timeoutMs = 20000, instrument, retries = 2, base = UPSTOX_BASE } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await once<T>(`${base}${path}`, init, timeoutMs, instrument);
    } catch (e) {
      lastErr = e;
      const fail = e instanceof UpstoxApiError ? e.failure : null;
      if (!fail?.retryable || attempt === retries) throw e;
      const backoff = Math.min(4000, 300 * 2 ** attempt) + Math.random() * 200;
      await sleep(fail.status === 429 ? Math.max(backoff, 1200) : backoff);
    }
  }
  throw lastErr;
}

/* ── auth ───────────────────────────────────────────────────────────────── */

export interface ProfileResult {
  ok: boolean;
  userId?: string;
  name?: string;
  email?: string;
  segments?: string[];
  error?: string;
  checkedAt?: number;
}

export async function validateToken(token: string): Promise<ProfileResult> {
  store.session = { token, validatedAt: Date.now(), profile: { userId: "", name: "", email: "", segment: [] } };
  try {
    const res = await call<{ data?: { userId?: string; name?: string; email?: string; pan?: string } }>("/user/profile", {}, { retries: 0 });
    const d = res.data ?? {};
    store.session = {
      token,
      validatedAt: Date.now(),
      profile: {
        userId: d.userId ?? "unknown",
        name: d.name ?? "Upstox user",
        email: d.email ?? "",
        pan: d.pan,
        segment: ["market data", "F&O (account dependent)"],
      },
    };
    store.connectedAt = Date.now();
    store.lastError = null;
    return { ok: true, userId: d.userId, name: d.name, email: d.email, segments: store.session.profile.segment, checkedAt: Date.now() };
  } catch (e) {
    const fail = e instanceof UpstoxApiError ? e.failure : null;
    store.session = null;
    store.connectedAt = null;
    store.lastError = fail ? `${fail.status ?? "network"} ${fail.code ?? ""} ${fail.message}`.trim() : String(e);
    return { ok: false, error: store.lastError, checkedAt: Date.now() };
  }
}

export function clearSession(): { ok: true; clearedAt: number } {
  store.session = null;
  store.feedUrl = null;
  store.connectedAt = null;
  store.lastError = null;
  return { ok: true, clearedAt: Date.now() };
}

/**
 * V3 Market Data Feed authorization.
 * Endpoint: GET /v3/feed/market-data-feed/authorize
 * Response: { data: { authorized_redirect_uri: "wss://..." } }
 *
 * The V2 endpoint (/v2/feed/...) returns HTTP 410 UDAPI1153 and must never be
 * called. This function uses the V3 base exclusively.
 */
export async function authorizeFeed(): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const res = await call<{ data?: { authorized_redirect_uri?: string; authorized?: boolean; url?: string } }>(
      "/feed/market-data-feed/authorize",
      {},
      { retries: 0, base: UPSTOX_V3 },
    );
    const url = res?.data?.authorized_redirect_uri ?? res?.data?.url;
    if (url && url.startsWith("wss")) {
      store.feedUrl = url;
      return { ok: true, url };
    }
    return { ok: false, error: `V3 feed authorize returned no valid wss endpoint. Response: ${JSON.stringify(res?.data ?? {}).slice(0, 200)}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    store.lastError = msg;
    return { ok: false, error: msg };
  }
}

export function connectionState() {
  const s = store.session;
  return {
    connected: !!s,
    validatedAt: s?.validatedAt ?? null,
    connectedAt: store.connectedAt,
    userId: s?.profile.userId ?? null,
    name: s?.profile.name ?? null,
    segments: s?.profile.segment ?? [],
    feedUrl: store.feedUrl,
    lastError: store.lastError,
    /** fingerprint only — the token itself is never returned */
    tokenFingerprint: null as string | null,
  };
}

/* ── instrument master (official BOD files) ─────────────────────────────── */

export interface MasterRow {
  segment: string;
  exchange: string;
  instrumentType: string;
  instrumentKey: string;
  /** underlying / asset symbol, e.g. RELIANCE, NIFTY, SENSEX */
  symbol: string;
  name: string;
  isin: string | null;
  /** `YYYY-MM-DD` in Asia/Kolkata */
  expiry: string | null;
  strike: number | null;
  lot: number | null;
  underlyingKey: string | null;
  underlyingSymbol: string | null;
  tradingSymbol: string | null;
}

export interface MasterDiagnostics {
  nseRows: number;
  bseRows: number;
  nseFo: number;
  bseFo: number;
  futures: number;
  options: number;
  indices: number;
  expired: number;
  invalid: number;
  fetchedAt: number;
  sources: string[];
  failures: ApiFailure[];
}

interface MasterCache {
  at: number;
  day: string;
  rows: MasterRow[];
  diag: MasterDiagnostics;
}

const globalMaster = globalThis as typeof globalThis & { __mmMaster?: MasterCache };
const MASTER_TTL = 6 * 3600_000;

const istDateOf = (ms: number): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

export function normaliseMaster(r: Record<string, unknown>): MasterRow | null {
  const key = typeof r.instrument_key === "string" ? r.instrument_key : null;
  if (!key) return null;
  const expiryMs = typeof r.expiry === "number" && isFinite(r.expiry) ? r.expiry : null;
  const expiry =
    expiryMs !== null
      ? istDateOf(expiryMs)
      : typeof r.expiry === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.expiry)
        ? r.expiry.slice(0, 10)
        : null;
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : null);
  return {
    segment: String(r.segment ?? ""),
    exchange: String(r.exchange ?? ""),
    instrumentType: String(r.instrument_type ?? "").toUpperCase(),
    instrumentKey: key,
    symbol: String(r.underlying_symbol ?? r.asset_symbol ?? r.trading_symbol ?? ""),
    name: String(r.name ?? r.trading_symbol ?? ""),
    isin: typeof r.isin === "string" && r.isin ? r.isin : null,
    expiry,
    strike: num(r.strike_price),
    lot: num(r.lot_size),
    underlyingKey: typeof r.underlying_key === "string" ? r.underlying_key : typeof r.asset_key === "string" ? r.asset_key : null,
    underlyingSymbol: typeof r.underlying_symbol === "string" ? r.underlying_symbol : typeof r.asset_symbol === "string" ? r.asset_symbol : null,
    tradingSymbol: typeof r.trading_symbol === "string" ? r.trading_symbol : null,
  };
}

export const RELEVANT_SEGMENTS = new Set([
  "NSE_EQ",
  "NSE_INDEX",
  "NSE_FO",
  "BSE_EQ",
  "BSE_INDEX",
  "BSE_FO",
]);

/**
 * Downloads the official gzipped instrument masters, decompresses them in
 * Node, and normalises the array-of-objects payload. Cached in process memory
 * for 6h and invalidated whenever the IST calendar day changes.
 */
export async function fetchInstrumentMaster(): Promise<{ rows: MasterRow[]; diag: MasterDiagnostics }> {
  const today = istDateOf(Date.now());
  const cached = globalMaster.__mmMaster;
  if (cached && cached.day === today && Date.now() - cached.at < MASTER_TTL) {
    return { rows: cached.rows, diag: cached.diag };
  }

  const rows: MasterRow[] = [];
  const sources: string[] = [];
  const failures: ApiFailure[] = [];
  let nseRows = 0;
  let bseRows = 0;

  for (const file of MASTER_FILES) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      let buf: ArrayBuffer | Buffer;
      try {
        const res = await fetch(file.url, { signal: controller.signal, cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buf = Buffer.from(await res.arrayBuffer());
      } finally {
        clearTimeout(timer);
      }
      const json = JSON.parse(gunzipSync(buf).toString("utf8")) as unknown;
      const arr = Array.isArray(json) ? json : Array.isArray((json as { data?: unknown[] })?.data) ? (json as { data: unknown[] }).data : null;
      if (!arr) throw new Error("instrument file is not a JSON array");
      const mapped: MasterRow[] = [];
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const row = normaliseMaster(item as Record<string, unknown>);
        if (!row) continue;
        if (!RELEVANT_SEGMENTS.has(row.segment)) continue;
        mapped.push(row);
      }
      if (!mapped.length) throw new Error("no relevant instruments parsed");
      if (file.code === "NSE") nseRows = mapped.length;
      else bseRows = mapped.length;
      rows.push(...mapped);
      sources.push(`${file.code} master OK (${arr.length} raw → ${mapped.length} relevant)`);
    } catch (e) {
      failures.push({
        endpoint: file.url,
        status: null,
        code: "MASTER_DOWNLOAD",
        message: e instanceof Error ? e.message : String(e),
        retryable: true,
        at: Date.now(),
      });
    }
  }

  const now = Date.now();
  const todayStr = istDateOf(now);
  const futures = rows.filter((r) => r.instrumentType.startsWith("FUT"));
  const options = rows.filter((r) => r.instrumentType === "CE" || r.instrumentType === "PE");
  const indices = rows.filter((r) => r.segment.endsWith("_INDEX"));
  const diag: MasterDiagnostics = {
    nseRows,
    bseRows,
    nseFo: rows.filter((r) => r.segment === "NSE_FO").length,
    bseFo: rows.filter((r) => r.segment === "BSE_FO").length,
    futures: futures.length,
    options: options.length,
    indices: indices.length,
    expired: futures.filter((r) => r.expiry !== null && r.expiry < todayStr).length,
    invalid: rows.filter((r) => !r.instrumentKey).length,
    fetchedAt: now,
    sources,
    failures,
  };

  if (rows.length) globalMaster.__mmMaster = { at: now, day: today, rows, diag };
  return { rows, diag };
}

export function invalidateMaster(): void {
  globalMaster.__mmMaster = undefined;
}

/* ── candles (V3) ───────────────────────────────────────────────────────── */

export interface RawCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;
}

export interface CandleIssue {
  index: number;
  reason: string;
}

/**
 * Normalise + validate candle rows: chronological ascending, no duplicates,
 * finite OHLC, high ≥ max(open, close), low ≤ min(open, close), volume ≥ 0,
 * valid IST timestamp. Invalid rows are dropped and reported, never invented.
 */
export function validateCandles(raw: RawCandle[]): { rows: RawCandle[]; issues: CandleIssue[] } {
  const issues: CandleIssue[] = [];
  const seen = new Set<string>();
  const out: RawCandle[] = [];
  const parsed = raw
    .map((c, i) => ({ c, i, t: Date.parse(c.timestamp) }))
    .filter((x) => {
      if (Number.isNaN(x.t)) {
        issues.push({ index: x.i, reason: `bad timestamp ${x.c.timestamp}` });
        return false;
      }
      return true;
    })
    .sort((a, b) => a.t - b.t);

  for (const { c, i, t } of parsed) {
    const finite = [c.open, c.high, c.low, c.close].every((v) => typeof v === "number" && isFinite(v));
    if (!finite) {
      issues.push({ index: i, reason: "non-finite OHLC" });
      continue;
    }
    if (c.high < Math.max(c.open, c.close) - 1e-9) {
      issues.push({ index: i, reason: "high < open/close" });
      continue;
    }
    if (c.low > Math.min(c.open, c.close) + 1e-9) {
      issues.push({ index: i, reason: "low > open/close" });
      continue;
    }
    if (!(c.volume >= 0)) {
      issues.push({ index: i, reason: "negative volume" });
      continue;
    }
    const stamp = c.timestamp;
    if (seen.has(stamp)) {
      issues.push({ index: i, reason: "duplicate timestamp" });
      continue;
    }
    seen.add(stamp);
    out.push(c);
  }
  return { rows: out, issues };
}

function parseRow(row: unknown): RawCandle | null {
  if (Array.isArray(row)) {
    const [ts, o, h, l, c, v, oi] = row as (string | number)[];
    if (typeof ts !== "string") return null;
    return {
      timestamp: ts,
      open: Number(o),
      high: Number(h),
      low: Number(l),
      close: Number(c),
      volume: Number(v ?? 0),
      oi: oi === undefined || oi === null ? undefined : Number(oi),
    };
  }
  if (row && typeof row === "object") {
    const r = row as Record<string, unknown>;
    const ts = r.timestamp ?? r.time;
    if (typeof ts !== "string") return null;
    return {
      timestamp: ts,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume ?? 0),
      oi: r.oi === undefined || r.oi === null ? undefined : Number(r.oi),
    };
  }
  return null;
}

export type MinuteInterval = 1 | 5 | 15 | 30;

export interface CandleRequest {
  key: string;
  interval: MinuteInterval | "day";
  /** `YYYY-MM-DD`; omitted → intraday (current session) request */
  from?: string;
  to?: string;
  intraday?: boolean;
}

/** Builds the documented V3 URL (exported for unit tests). */
export function buildCandleUrl(req: CandleRequest): string {
  const key = encodeURIComponent(req.key);
  if (req.intraday) return `${UPSTOX_V3}/historical-candle/intraday/${key}/minutes/${req.interval === "day" ? 1 : req.interval}`;
  if (req.interval === "day") return `${UPSTOX_V3}/historical-candle/${key}/days/1/${req.to}/${req.from}`;
  return `${UPSTOX_V3}/historical-candle/${key}/minutes/${req.interval}/${req.to}/${req.from}`;
}

export async function fetchCandles(req: CandleRequest): Promise<RawCandle[]> {
  const url = buildCandleUrl(req);
  const res = await call<{ data?: { candles?: unknown[] } }>(
    url.replace(UPSTOX_V3, ""),
    { headers: { Accept: "application/json" } },
    { base: UPSTOX_V3, timeoutMs: 25000, instrument: req.key, retries: req.intraday ? 1 : 2 },
  );
  const raw = (res?.data?.candles ?? []).map(parseRow).filter((x): x is RawCandle => x !== null);
  const out = validateCandles(raw);
  if (out.rows.length === 0) {
    // observable failure instead of a silent empty series
    console.warn(
      `[upstox] no usable candles · key=${req.key} iv=${req.interval} ${req.from}→${req.to} · raw=${raw.length} issues=${out.issues.length} · payload=${JSON.stringify(res).slice(0, 220)}`,
    );
  }
  return out.rows;
}

/* ── quotes ─────────────────────────────────────────────────────────────── */

export interface NormalisedQuote {
  instrumentKey: string;
  ltp: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  oi: number | null;
  bid: number | null;
  bidQty: number | null;
  ask: number | null;
  askQty: number | null;
  totalBuyQty: number | null;
  totalSellQty: number | null;
  depthBid: number;
  depthAsk: number;
  timestamp: number | null;
  lastTradeTime: number | null;
}

const n = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : null);

/** Normalises one provider quote entry (snake_case + legacy camelCase shapes). */
export function normaliseQuote(key: string, raw: Record<string, unknown>): NormalisedQuote | null {
  if (!raw || typeof raw !== "object") return null;
  const ohlc = (raw.ohlc ?? {}) as Record<string, unknown>;
  const depth = (raw.depth ?? {}) as Record<string, unknown>;
  const buy = Array.isArray(depth.buy) ? (depth.buy as Record<string, unknown>[]) : [];
  const sell = Array.isArray(depth.sell) ? (depth.sell as Record<string, unknown>[]) : [];

  const ltp = n(raw.last_price) ?? n(raw.lastPrice) ?? n(raw.ltp);
  const prevClose =
    n(raw.prev_close) ??
    n(raw.prevClose) ??
    n(ohlc.close) ??
    n(raw.close_price) ??
    n(raw.closePrice);
  const change = n(raw.net_change) ?? n(raw.netChange) ?? (ltp !== null && prevClose !== null ? ltp - prevClose : null);
  const changePct =
    n(raw.net_change_percent) ??
    (change !== null && prevClose ? (change / prevClose) * 100 : null);

  const bid = n(raw.bid_price) ?? n(raw.bidPrice) ?? n(buy[0]?.price);
  const bidQty = n(raw.bid_qty) ?? n(raw.bidQty) ?? n(buy[0]?.quantity) ?? n(buy[0]?.size);
  const ask = n(raw.ask_price) ?? n(raw.askPrice) ?? n(sell[0]?.price);
  const askQty = n(raw.ask_qty) ?? n(raw.askQty) ?? n(sell[0]?.quantity) ?? n(sell[0]?.size);

  if (ltp === null && prevClose === null && bid === null && ask === null) return null;

  return {
    instrumentKey: key,
    ltp,
    prevClose,
    change,
    changePct,
    open: n(ohlc.open) ?? n(raw.open_price) ?? n(raw.openPrice),
    high: n(ohlc.high) ?? n(raw.high_price) ?? n(raw.highPrice),
    low: n(ohlc.low) ?? n(raw.low_price) ?? n(raw.lowPrice),
    volume: n(raw.volume) ?? n(raw.traded_volume),
    oi: n(raw.oi) ?? n(raw.open_interest),
    bid,
    bidQty,
    ask,
    askQty,
    totalBuyQty: n(raw.total_buy_quantity) ?? n(raw.totalBuyQuantity),
    totalSellQty: n(raw.total_sell_quantity) ?? n(raw.totalSellQuantity),
    depthBid: buy.reduce((s, b) => s + (n(b.quantity) ?? n(b.size) ?? 0), 0),
    depthAsk: sell.reduce((s, b) => s + (n(b.quantity) ?? n(b.size) ?? 0), 0),
    timestamp: n(raw.timestamp),
    lastTradeTime: n(raw.last_trade_time) ?? n(raw.lastTradeTime),
  };
}

/** GET /v2/market-quote/quotes?instrument_key=… (comma separated, chunked). */
export async function fetchQuotes(keys: string[], chunkSize = 10): Promise<{
  quotes: Record<string, NormalisedQuote>;
  failures: ApiFailure[];
}> {
  const quotes: Record<string, NormalisedQuote> = {};
  const failures: ApiFailure[] = [];
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += chunkSize) chunks.push(keys.slice(i, i + chunkSize));

  for (const chunk of chunks) {
    const path = `/market-quote/quotes?instrument_key=${chunk.map((k) => encodeURIComponent(k)).join(",")}`;
    try {
      const res = await call<{ data?: Record<string, Record<string, unknown>> }>(path, {}, { timeoutMs: 20000 });
      const data = res?.data ?? {};
      const normalised = Object.entries(data).map(([responseKey, value]) => {
        const raw = value as Record<string, unknown>;
        const aliases = new Set<string>([
          responseKey,
          String(raw.instrument_key ?? ""),
          String(raw.instrumentKey ?? ""),
          String(raw.instrument_token ?? ""),
          String(raw.instrumentToken ?? ""),
        ].filter(Boolean));
        const q = normaliseQuote(String(raw.instrument_key ?? raw.instrumentKey ?? responseKey), raw);
        return { aliases, q };
      });

      for (const k of chunk) {
        const entry = normalised.find((r) => r.aliases.has(k));
        if (!entry || !entry.q) {
          failures.push({ endpoint: path, status: 200, code: "MISSING_QUOTE", message: `no quote returned for ${k}`, instrument: k, retryable: false, at: Date.now() });
          continue;
        }
        quotes[k] = { ...entry.q, instrumentKey: k };
      }
    } catch (e) {
      const fail = e instanceof UpstoxApiError ? e.failure : { endpoint: path, status: null, code: "UNKNOWN", message: String(e), retryable: true, at: Date.now() };
      failures.push(...chunk.map((k) => ({ ...fail, instrument: k })));
    }
  }
  return { quotes, failures };
}

/* ── option chain ───────────────────────────────────────────────────────── */

export interface ChainOptionLeg {
  instrumentKey: string;
  ltp: number | null;
  close: number | null;
  volume: number | null;
  oi: number | null;
  prevOi: number | null;
  bid: number | null;
  bidQty: number | null;
  ask: number | null;
  askQty: number | null;
  greeks: {
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
    iv: number | null;
    pop: number | null;
  };
  greeksSource: "provider";
}

export interface ChainRow {
  strike: number;
  expiry: string | null;
  underlyingKey: string | null;
  spot: number | null;
  ce: ChainOptionLeg | null;
  pe: ChainOptionLeg | null;
}

function legFrom(raw: unknown): ChainOptionLeg | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const md = (o.market_data ?? {}) as Record<string, unknown>;
  const gx = (o.option_greeks ?? {}) as Record<string, unknown>;
  const instrumentKey = typeof o.instrument_key === "string" ? o.instrument_key : null;
  if (!instrumentKey) return null;
  return {
    instrumentKey,
    ltp: n(md.ltp) ?? n(md.last_price),
    close: n(md.close_price) ?? n(md.close),
    volume: n(md.volume),
    oi: n(md.oi),
    prevOi: n(md.prev_oi),
    bid: n(md.bid_price),
    bidQty: n(md.bid_qty),
    ask: n(md.ask_price),
    askQty: n(md.ask_qty),
    greeks: {
      delta: n(gx.delta),
      gamma: n(gx.gamma),
      theta: n(gx.theta),
      vega: n(gx.vega),
      iv: n(gx.iv),
      pop: n(gx.pop),
    },
    greeksSource: "provider",
  };
}

/**
 * Normalises the documented chain payload:
 * data[] = { strike_price, expiry, underlying_key, underlying_spot_price,
 *            call_options{instrument_key, market_data, option_greeks},
 *            put_options{…} }
 * CE and PE are handled independently; a missing leg stays null.
 */
export function parseChainRows(payload: unknown): ChainRow[] {
  const arr = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data)
      ? (payload as { data: unknown[] }).data
      : [];
  const rows: ChainRow[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const strike = n(r.strike_price);
    if (strike === null) continue;
    const expiry = typeof r.expiry === "string" ? r.expiry.slice(0, 10) : typeof r.expiry === "number" ? istDateOf(r.expiry) : null;
    rows.push({
      strike,
      expiry,
      underlyingKey: typeof r.underlying_key === "string" ? r.underlying_key : null,
      spot: n(r.underlying_spot_price),
      ce: legFrom(r.call_options),
      pe: legFrom(r.put_options),
    });
  }
  rows.sort((a, b) => a.strike - b.strike);
  return rows;
}

/** GET /v2/option/chain?instrument_key=…&expiry_date=… → normalised rows. */
export async function fetchOptionChain(instrumentKey: string, expiryDate: string): Promise<{
  rows: ChainRow[];
  path: string;
  failure?: ApiFailure;
}> {
  const path = `/option/chain?instrument_key=${encodeURIComponent(instrumentKey)}&expiry_date=${encodeURIComponent(expiryDate)}`;
  try {
    const res = await call<{ data?: unknown }>(path, {}, { timeoutMs: 25000, instrument: instrumentKey });
    const rows = parseChainRows(res?.data);
    if (!rows.length) {
      return { rows: [], path, failure: { endpoint: path, status: 200, code: "EMPTY_CHAIN", message: `no chain rows for ${instrumentKey} @ ${expiryDate}`, instrument: instrumentKey, retryable: false, at: Date.now() } };
    }
    return { rows, path };
  } catch (e) {
    const fail = e instanceof UpstoxApiError ? e.failure : { endpoint: path, status: null, code: "CHAIN", message: String(e), instrument: instrumentKey, retryable: true, at: Date.now() };
    return { rows: [], path, failure: fail };
  }
}

/* ── historical OI (optional, v2) ────────────────────────────────────────── */

export interface HistoricalOiRow {
  timestamp: number;
  oi: number | null;
}

/**
 * GET /v2/market/oi?instrument_key=…&expiry=…&date=… — used where available.
 * Failures are surfaced as `unavailable`, never back-filled.
 */
export async function fetchHistoricalOi(instrumentKey: string, expiry: string, date: string): Promise<{
  rows: HistoricalOiRow[];
  failure?: ApiFailure;
}> {
  const path = `/market/oi?instrument_key=${encodeURIComponent(instrumentKey)}&expiry=${encodeURIComponent(expiry)}&date=${encodeURIComponent(date)}`;
  try {
    const res = await call<{ data?: unknown }>(path, {}, { timeoutMs: 20000, instrument: instrumentKey, retries: 1 });
    const payload = res?.data;
    const arr = Array.isArray(payload) ? payload : payload && typeof payload === "object" ? ((payload as { data?: unknown[] }).data ?? []) : [];
    const rows: HistoricalOiRow[] = [];
    for (const item of arr as Record<string, unknown>[]) {
      if (!item || typeof item !== "object") continue;
      const ts = n(item.timestamp) ?? n(item.time);
      const oi = n(item.oi) ?? n(item.open_interest);
      if (ts !== null) rows.push({ timestamp: ts, oi });
    }
    rows.sort((a, b) => a.timestamp - b.timestamp);
    return { rows };
  } catch (e) {
    const fail = e instanceof UpstoxApiError ? e.failure : { endpoint: path, status: null, code: "OI", message: String(e), instrument: instrumentKey, retryable: true, at: Date.now() };
    return { rows: [], failure: fail };
  }
}

export const LIMITATIONS: string[] = [
  "Instrument universe comes from the official Upstox BOD files (assets.upstox.com …/NSE.json.gz and BSE.json.gz) — never a bundled symbol list. Keys, lots, strikes and expiries are used exactly as published.",
  "Candles come from the documented V3 endpoints with native 1/5/15/30-minute intervals; when a request returns no rows the session search walks backwards (bounded, weekends skipped) until a real session is found.",
  "Aggressor-side (taker) trade classification is not exposed for historical candles — buyer/seller control is inferred from candle direction and quoted depth, never presented as verified executed buy/sell volume.",
  "Historical option OI and intraday strike-wise OI are only shown when the provider returns them; otherwise the UI states UNAVAILABLE instead of synthesising 5/15-minute OI changes.",
  "Historical option greeks are not served by the provider for past sessions; when the chain supplies no greeks they are derived with Black–Scholes–Merton and labelled `black-scholes-derived`.",
  "Aggregate open interest cannot prove institutional intent — positioning labels are candidate-style with explicit confirmations and warnings.",
];
