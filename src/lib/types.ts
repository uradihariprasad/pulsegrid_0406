/**
 * MARKET MASTER — shared data contracts.
 * Every engine consumes and produces these types only. No engine reaches into
 * another engine's internals; the Upstox live adapter normalises into
 * `SymbolFeed` before any analysis runs. No synthetic feed exists in the app.
 */

export type Side = "CE" | "PE";
export type InstrumentKind = "equity" | "index";
/** Market-data provenance. Only live Upstox data is ever produced. */
export type FeedSource = "live";

/** Session timestamp in epoch SECONDS (lightweight-charts convention). */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  /** Open interest reported on that candle when the provider supplies it. */
  oi?: number | null;
}

export interface Quote {
  ltp: number;
  prevClose: number;
  changePct: number;
  /** true when no provider quote could be obtained at all */
  unavailable?: boolean;
  /** where the price reference came from when a live quote is absent */
  source?: "quote" | "historical-close";
  instrumentKey?: string;
  totalBuyQty?: number | null;
  totalSellQty?: number | null;
  bid?: number | null;
  ask?: number | null;
  bidQty?: number | null;
  askQty?: number | null;
  /** Aggregated 5-level depth when the provider exposes it. */
  depthBidQty?: number | null;
  depthAskQty?: number | null;
  oi?: number | null;
  volume?: number | null;
  asOf: number;
  stale: boolean;
}

export interface InstrumentMeta {
  symbol: string;
  name: string;
  sector: string;
  kind: InstrumentKind;
  isin?: string | null;
  exchange: string;
  spotKey: string;
  futKey?: string | null;
  lotSize: number;
  strikeInterval: number;
  expiries: string[];
  /** Where the contract row came from — always the Upstox master contract. */
  origin: "upstox-master";
}

export interface Greeks {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  iv: number | null;
}

export interface OptionContract {
  key: string;
  strike: number;
  side: Side;
  expiry: string;
  lotSize: number;
  /** 5-minute premium candles. */
  candles: Candle[];
  /** Timestamped OI snapshots aligned to candle closes. */
  oi: Candle[];
  quote: Quote;
  greeks: Greeks;
  greeksSource: "provider" | "black-scholes-derived" | "unavailable";
  /**
   * Session OI change supplied directly by the option chain
   * (`market_data.oi - market_data.prev_oi`) — used when no intraday OI history
   * has been fetched, so session ΔOI is never guessed.
   */
  oiSessionChange?: number | null;
}

export interface FuturesContract {
  key: string;
  label: string;
  expiry: string;
  lotSize: number;
  candles: Candle[];
  quote: Quote;
}

/** Provider-normalised input for one underlying. */
/** Structured per-component failure (mirrors the client's ApiFailure). */
export interface FeedFailure {
  endpoint: string;
  status: number | null;
  code: string | null;
  message: string;
  instrument?: string;
  retryable: boolean;
  at: number;
}

export interface SymbolFeed {
  meta: InstrumentMeta;
  source: FeedSource;
  /** Latest observation time (epoch ms). */
  asOf: number;
  /** Actual trading session the candles belong to (YYYY-MM-DD, IST). */
  sessionDate?: string;
  failures?: FeedFailure[];
  /** Strict data-completeness gate (see PART 3). */
  completeness: "COMPLETE" | "PARTIAL" | "INVALID";
  /** Exact components that are missing — never zero-filled. */
  missing: string[];
  prevDay: { high: number; low: number; close: number; volume: number } | null;
  spot5: Candle[];
  spot15: Candle[];
  spot1d: Candle[];
  spotQuote: Quote;
  futures: FuturesContract | null;
  options: OptionContract[];
  depth: { bidQty: number; askQty: number; asOf: number } | null;
  /** Per-symbol data availability notes (never silently zero-filled). */
  notes: string[];
}

export type Positioning =
  | "LONG BUILD-UP"
  | "SHORT BUILD-UP"
  | "SHORT COVERING"
  | "LONG UNWINDING"
  | "INSUFFICIENT DATA";

export type MomentumStage =
  | "STAGE 1: MOMENTUM BUILDING"
  | "STAGE 2: STRONG MOMENTUM"
  | "STAGE 3: MOMENTUM EXHAUSTION"
  | "STAGE 4: REVERSAL DEVELOPING"
  | "UNCLASSIFIED";

export type QualityLabel =
  | "GENUINE BULLISH"
  | "GENUINE BEARISH"
  | "WEAK BULLISH"
  | "WEAK BEARISH"
  | "SHORT-COVERING RALLY"
  | "LONG-UNWINDING DECLINE"
  | "MOMENTUM DIVERGENCE"
  | "FALSE BREAKOUT RISK"
  | "FALSE BREAKDOWN RISK"
  | "MOMENTUM EXHAUSTION"
  | "REVERSAL DEVELOPING"
  | "NEUTRAL / CONFLICTED";

export type OpportunityStatus =
  | "WATCHLIST"
  | "MOMENTUM BUILDING"
  | "ENTRY CONFIRMATION PENDING"
  | "ENTRY ELIGIBLE"
  | "ACTIVE CONTINUATION"
  | "RETEST OPPORTUNITY"
  | "EXHAUSTION WARNING"
  | "EXIT/INVALIDATED"
  | "NO TRADE";

export interface Condition {
  label: string;
  met: boolean | null;
  detail: string;
}

/** Rolling OI window results. `null` means the reference snapshot is absent. */
export interface OiWindow {
  c5: number | null;
  c15: number | null;
  cSession: number | null;
  total: number | null;
  baseline: number | null;
  baselineSource: "first-session-observation" | "unavailable";
  asOf: number | null;
  observations: number;
}

export interface Zone {
  id: string;
  side: "support" | "resistance";
  price: number;
  high: number;
  low: number;
  kind: "structural" | "oi-only" | "confluence";
  /** 0–100 normalised zone strength. */
  strength: number;
  label: string;
  reactions: number;
  lastTestTs: number | null;
  confluence: number;
  sources: string[];
}

export interface ScoreComponent {
  key: string;
  label: string;
  weight: number;
  /** 0–1 direction-aware contribution for the stated direction. */
  bull: number | null;
  bear: number | null;
  conflict: boolean;
  reason: string;
}

export interface MomentumScores {
  bull: number;
  bear: number;
  grade: string;
  band: "NONE" | "WEAK" | "DEVELOPING" | "STRONG" | "HIGH_CONFLUENCE";
  components: ScoreComponent[];
  confirmed: number;
  conflicting: number;
  missing: number;
  freshnessMs: number;
  stale: boolean;
}

export interface UnderlyingAnalysis {
  bias: "bullish" | "bearish" | "neutral";
  last: number;
  changePct: number;
  vwap: number | null;
  ema: { e9: number | null; e21: number | null; e50: number | null; e200: number | null };
  emaSlope: { s9: number | null; s21: number | null };
  bb: { mid: number | null; up: number | null; lo: number | null; width: number | null; expanding: boolean | null };
  atr: number | null;
  atrPct: number | null;
  relVol: number | null;
  volumeTrend: "expanding" | "contracting" | "flat" | null;
  structure: {
    trend: "up" | "down" | "sideways";
    hh: boolean;
    hl: boolean;
    lh: boolean;
    ll: boolean;
    lastSwingHigh: number | null;
    lastSwingLow: number | null;
    breakout: boolean;
    breakdown: boolean;
    retest: boolean;
  };
  conditions: { bullish: Condition[]; bearish: Condition[] };
  volLast: number | null;
  volAvg: number | null;
  bullMet: number;
  bearMet: number;
  bullMissing: number;
  bearMissing: number;
}

export interface FuturesAnalysis {
  positioning: Positioning;
  consistency: "aligned" | "mixed" | "unknown";
  chg5Pct: number | null;
  chg15Pct: number | null;
  chgSessionPct: number | null;
  oiChg5: number | null;
  oiChg15: number | null;
  oiChgSession: number | null;
  oiTotal: number | null;
  relOiPct: number | null;
  relVol: number | null;
  confirmations: string[];
  warnings: string[];
}

export interface StrikeRow {
  strike: number;
  ce: OptionAnalysis | null;
  pe: OptionAnalysis | null;
  atm: boolean;
}

export interface OptionAnalysis {
  contract: OptionContract;
  premium: number;
  changePct: number | null;
  vwap: number | null;
  ema: { e9: number | null; e21: number | null };
  bias: "bullish" | "bearish" | "neutral";
  relVol: number | null;
  spreadPct: number | null;
  oiChg5: number | null;
  oiChg15: number | null;
  oiChgSession: number | null;
  oiTotal: number | null;
  deltaAdjustedExpected: number | null;
  actualResponse: number | null;
  responseQuality: "strong" | "weak" | "abnormal" | "iv-driven" | "unknown";
}

export interface OptionsAnalysis {
  atm: number;
  expiry: string;
  strikes: StrikeRow[];
  ceBias: "bullish" | "bearish" | "neutral";
  peBias: "bullish" | "bearish" | "neutral";
  alignment: "aligned" | "divergent" | "unconfirmed" | "unavailable";
  alignmentNote: string;
  bestCE: StrikeSelection | null;
  bestPE: StrikeSelection | null;
}

export interface StrikeSelection {
  strike: number;
  side: Side;
  expiry: string;
  score: number;
  liquidity: "deep" | "adequate" | "thin" | "illiquid";
  reasons: string[];
  rejects: string[];
  greeks: Greeks;
  premium: number;
}

export interface SRAudit {
  primarySupport: Zone | null;
  primaryResistance: Zone | null;
  secondarySupport: Zone | null;
  secondaryResistance: Zone | null;
  structural: Zone[];
  oiOnly: Zone[];
  volumeProfile: { poc: number | null; vah: number | null; val: number | null };
  notes: string[];
}

export interface FlowAnalysis {
  buyerDominance: number;
  sellerDominance: number;
  buyingPressure: number;
  sellingPressure: number;
  imbalance: number;
  label: "BUYER DOMINANT" | "SELLER DOMINANT" | "BALANCED" | "INSUFFICIENT DATA";
  events: string[];
  confidence: "high" | "moderate" | "low";
  confidenceNote: string;
}

/** Strike-wise OI momentum component (PART 7). */
export interface OiMomentum {
  available: boolean;
  /** 0–100 magnitude of the OI evidence */
  score: number;
  /** −1 bearish OI evidence, +1 bullish, 0 neutral/insufficient */
  direction: -1 | 0 | 1;
  /** normalised 0–1 contributions for the unified score (null = missing) */
  bull: number | null;
  bear: number | null;
  atmStrike: number | null;
  ceSession: number | null;
  peSession: number | null;
  ce5m: number | null;
  pe5m: number | null;
  ce15m: number | null;
  pe15m: number | null;
  strikes: {
    strike: number;
    ceOi5: number | null;
    peOi5: number | null;
    ceOiSession: number | null;
    peOiSession: number | null;
  }[];
  labels: string[];
  bullish: string[];
  bearish: string[];
  windowAgreement: "aligned" | "mixed" | "unknown";
  futuresAgreement: "aligned" | "divergent" | "unknown";
  priceAgreement: "aligned" | "divergent" | "unknown";
  note: string;
}

export interface MomentumAnalysis {
  quality: QualityLabel;
  stage: MomentumStage;
  divergence: string[];
  genuine: string[];
  weak: string[];
  alignment15m: "aligned" | "countertrend" | "neutral";
  alignmentNote: string;
  breakout: {
    state: "none" | "genuine-breakout" | "false-breakout-risk" | "genuine-breakdown" | "false-breakdown-risk";
    level: number | null;
    detail: string;
  };
}

export interface TradeSetup {
  status: OpportunityStatus;
  direction: "LONG" | "SHORT" | "NONE";
  entryZone: [number, number] | null;
  confirmation: string;
  invalidation: number | null;
  target1: number | null;
  target2: number | null;
  riskReward: number | null;
  reasonsFor: string[];
  reasonsAgainst: string[];
  reversalRisk: "low" | "moderate" | "high";
}

export interface SymbolAnalysis {
  meta: InstrumentMeta;
  source: FeedSource;
  /** COMPLETE → eligible for strict scanners; PARTIAL → provisional only. */
  completeness: "COMPLETE" | "PARTIAL" | "INVALID";
  missing: string[];
  /** strike-wise OI momentum (explicit scoring component) */
  oiMomentum: OiMomentum;
  asOf: number;
  freshnessMs: number;
  stale: boolean;
  price: number;
  changePct: number;
  underlying: UnderlyingAnalysis;
  futures: FuturesAnalysis;
  options: OptionsAnalysis;
  sr: SRAudit;
  flow: FlowAnalysis;
  scores: MomentumScores;
  momentum: MomentumAnalysis;
  trade: TradeSetup;
  events: SignalEvent[];
  notes: string[];
}

export interface SignalEvent {
  symbol: string;
  ts: number;
  kind: string;
  severity: "info" | "action" | "warn" | "critical";
  direction: "bull" | "bear" | "neutral";
  title: string;
  detail: string;
  source: FeedSource;
}

export type ScanState =
  | "INITIAL_LOADING"
  | "TOKEN_REQUIRED"
  | "TOKEN_INVALID"
  | "CONNECTION_VALIDATED"
  | "MARKET_DATA_LOADING"
  | "LIVE_DATA_AVAILABLE"
  | "HISTORICAL_DATA_AVAILABLE"
  | "PARTIAL_DATA_AVAILABLE"
  | "DATA_UNAVAILABLE"
  | "PROVIDER_ERROR"
  | "DATABASE_UNAVAILABLE";

/** Data-pipeline diagnostics (Part I). Never contains secrets. */
export interface ScanDiagnostics {
  connection: {
    connected: boolean;
    validatedAt: number | null;
    userId: string | null;
    sessionAgeMs: number | null;
  };
  master: {
    nseRows: number;
    bseRows: number;
    futures: number;
    options: number;
    indices: number;
    eligible: number;
    expiredIgnored: number;
    niftyKey: string | null;
    sensexKey: string | null;
    sources: string[];
    fetchedAt: number | null;
  };
  ingestion: {
    spotRequested: number;
    spotOk: number;
    quoteRequested: number;
    quoteOk: number;
    futuresRequested: number;
    futuresOk: number;
    chainRequested: number;
    chainOk: number;
    premiumHistoryOk: number;
    premiumHistoryFailed: number;
    instrumentsWithCandles: number;
  };
  analysis: {
    discovered: number;
    analyzed: number;
    bullish: number;
    bearish: number;
    incomplete: number;
  };
  database: { ok: boolean; lastWrite: number | null; error: string | null };
  failures: FeedFailure[];
}

export interface ScanResult {
  generatedAt: number;
  source: FeedSource;
  /** Explicit application state for the frontend. */
  state: ScanState;
  /** False when no Upstox credential is attached (no data is generated). */
  connected: boolean;
  /** Operator-facing explanation for an empty scan. */
  notice: string | null;
  sessionLabel: string;
  /** Actual session the displayed candles belong to (IST). */
  sessionDate: string | null;
  mode: "LIVE" | "HISTORICAL" | "NONE";
  diagnostics: ScanDiagnostics;
  /** true when a previous good result is being served after a transient error */
  servingStale: boolean;
  analyses: SymbolAnalysis[];
  overview: {
    nifty: SymbolAnalysis | null;
    sensex: SymbolAnalysis | null;
    advancing: number;
    declining: number;
    unchanged: number;
    bullish: number;
    bearish: number;
    strong: SymbolAnalysis[];
    topBull: SymbolAnalysis[];
    topBear: SymbolAnalysis[];
    avgVolatilityPct: number;
    sentiment: string;
    sectors: { sector: string; avgScore: number; count: number }[];
  };
  opportunities: { analysis: SymbolAnalysis; rank: number }[];
  events: SignalEvent[];
  limitations: string[];
}
