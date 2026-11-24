/** Deterministic randomness, Black–Scholes pricing/greeks, number formatting. */

export function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, fully deterministic PRNG (used by unit tests only). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rnd: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Abramowitz & Stegun 7.1.26 error function approximation. */
export function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return s * y;
}

export const ncdf = (x: number) => 0.5 * (1 + erf(x / Math.sqrt(2)));
const npdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

export interface BsResult {
  price: number;
  delta: number;
  gamma: number;
  /** Per-calendar-day theta (rupees). */
  theta: number;
  vega: number;
}

/**
 * Black–Scholes–Merton for European options on a non-dividend underlying.
 * Inputs: spot S, strike K, annualised volatility sigma, years to expiry T,
 * continuous risk-free rate r. Limitations: no dividends, no borrow cost,
 * no discrete-rate term structure, no American-style early exercise.
 */
export function blackScholes(
  S: number,
  K: number,
  T: number,
  sigma: number,
  r: number,
  type: "CE" | "PE",
): BsResult {
  const eps = 1e-8;
  const t = Math.max(T, eps);
  const sig = Math.max(sigma, eps);
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(S / K) + (r + 0.5 * sig * sig) * t) / (sig * sqrtT);
  const d2 = d1 - sig * sqrtT;
  const disc = Math.exp(-r * t);
  if (type === "CE") {
    return {
      price: S * ncdf(d1) - K * disc * ncdf(d2),
      delta: ncdf(d1),
      gamma: npdf(d1) / (S * sig * sqrtT),
      theta: (-(S * npdf(d1) * sig) / (2 * sqrtT) - r * K * disc * ncdf(d2)) / 365,
      vega: (S * npdf(d1) * sqrtT) / 100,
    };
  }
  return {
    price: K * disc * ncdf(-d2) - S * ncdf(-d1),
    delta: ncdf(d1) - 1,
    gamma: npdf(d1) / (S * sig * sqrtT),
    theta: (-(S * npdf(d1) * sig) / (2 * sqrtT) + r * K * disc * ncdf(-d2)) / 365,
    vega: (S * npdf(d1) * sqrtT) / 100,
  };
}

const nf0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtNum = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !isFinite(v)
    ? "—"
    : new Intl.NumberFormat("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);

export const fmtInt = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(v) ? "—" : nf0.format(Math.round(v));

export const fmtPct = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${nf2.format(v)}%`;

export const fmtCompact = (v: number | null | undefined) => {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
  return `${sign}${a.toFixed(0)}`;
};

export const fmtAge = (ms: number) => {
  if (!isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

export const IST = "Asia/Kolkata";

export function istParts(ts: number): { h: number; m: number; date: string; weekday: string } {
  const d = new Date(ts);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    h: Number(parts.hour === "24" ? "0" : parts.hour),
    m: Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: String(parts.weekday),
  };
}

/** Minutes since IST midnight for an epoch ms value. */
export function istMinutes(ts: number): number {
  const p = istParts(ts);
  return p.h * 60 + p.m;
}

/** Epoch ms for today's (or given date's) IST wall-clock time. */
export function istTodayAt(dateStr: string, hh: number, mm: number): number {
  const base = Date.parse(`${dateStr}T00:00:00+05:30`);
  return base + (hh * 60 + mm) * 60000;
}

export function marketPhase(ts = Date.now()): "PRE-OPEN" | "OPEN" | "CLOSED" | "HOLIDAY" {
  const p = istParts(ts);
  if (p.weekday === "Sat" || p.weekday === "Sun") return "HOLIDAY";
  const mins = p.h * 60 + p.m;
  if (mins >= 540 && mins < 555) return "PRE-OPEN";
  if (mins >= 555 && mins <= 930) return "OPEN";
  return "CLOSED";
}

/** Today's calendar date in exchange time (`YYYY-MM-DD`). */
export function istDateStr(ts: number = Date.now()): string {
  return istParts(ts).date;
}

/** Shift a `YYYY-MM-DD` string by whole calendar days, formatted in IST. */
export function shiftISTDate(dateStr: string, days: number): string {
  const base = Date.parse(`${dateStr}T12:00:00+05:30`) + days * 86400000;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(base));
}

/** Most recent weekday strictly before the given IST date (holidays excluded). */
export function previousWeekdayIST(dateStr: string): string {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: IST, weekday: "short" });
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  let ts = Date.parse(`${dateStr}T12:00:00+05:30`);
  let guard = 0;
  do {
    ts -= 86400000;
    guard++;
  } while (["Sat", "Sun"].includes(wd.format(new Date(ts))) && guard < 30);
  return day.format(new Date(ts));
}

export interface SessionWindow {
  /** Requested historical window (`YYYY-MM-DD`). */
  from: string;
  to: string;
  /** The trading session the app expects to display (may be corrected by data). */
  sessionDate: string;
  /** True only while today's session is actually streaming. */
  live: boolean;
  mode: "OPEN" | "HISTORICAL";
  /**
   * Newest-first candidate session dates to request. Weekends are excluded and
   * the list is bounded; the adapter walks it until candles exist, so an
   * exchange holiday is skipped automatically instead of returning no data.
   */
  candidates: string[];
}

/**
 * Which session to read.
 *  - Market open            → today's session, streamed (live).
 *  - Weekend / holiday      → the most recent weekday session, read through
 *                             the documented historical-candle endpoint.
 * The app therefore always has something real to display outside market hours
 * instead of returning nothing — but it is labelled HISTORICAL, never live.
 */
export function resolveSessionWindow(now: number = Date.now(), lookbackDays = 12): SessionWindow {
  const date = istDateStr(now);
  const phase = marketPhase(now);
  const mins = istMinutes(now);
  const live = phase === "OPEN" || phase === "PRE-OPEN";
  const start = live ? date : phase === "CLOSED" && mins >= 930 ? date : previousWeekdayIST(date);

  const wd = new Intl.DateTimeFormat("en-US", { timeZone: IST, weekday: "short" });
  const candidates: string[] = [];
  let cur = start;
  for (let i = 0; i < lookbackDays; i++) {
    const day = wd.format(new Date(Date.parse(`${cur}T12:00:00+05:30`)));
    if (day !== "Sat" && day !== "Sun") candidates.push(cur);
    cur = shiftISTDate(cur, -1);
  }
  const sessionDate = candidates[0] ?? start;
  return { from: sessionDate, to: sessionDate, sessionDate, live, mode: live ? "OPEN" : "HISTORICAL", candidates };
}

/** Next NSE F&O expiry date (Thursday) on or after `from`. */
export function nextExpiry(from = new Date()): string {
  const d = new Date(from.getTime());
  d.setHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  let add = (4 - day + 7) % 7;
  if (add === 0) add = 0;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

export function daysTo(expiry: string, from = new Date()): number {
  return Math.max(0.5, (Date.parse(`${expiry}T15:30:00+05:30`) - from.getTime()) / 86400000);
}
