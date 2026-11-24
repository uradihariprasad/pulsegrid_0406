import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  doublePrecision,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Instrument master metadata (live Upstox rows or flagged bundled fallback). */
export const instruments = pgTable(
  "instruments",
  {
    symbol: text("symbol").primaryKey(),
    name: text("name").notNull(),
    sector: text("sector").notNull(),
    kind: text("kind").notNull(),
    exchange: text("exchange").notNull(),
    spotKey: text("spot_key").notNull(),
    lotSize: integer("lot_size").notNull(),
    strikeInterval: doublePrecision("strike_interval").notNull(),
    expiries: jsonb("expiries").$type<string[]>().notNull().default([]),
    origin: text("origin").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("instruments_sector_idx").on(t.sector)],
);

/** Finalised candles only — used for point-in-time history and score evolution. */
export const candles = pgTable(
  "candles",
  {
    symbol: text("symbol").notNull(),
    interval: text("interval").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    o: doublePrecision("o").notNull(),
    h: doublePrecision("h").notNull(),
    l: doublePrecision("l").notNull(),
    c: doublePrecision("c").notNull(),
    v: doublePrecision("v").notNull(),
    oi: doublePrecision("oi"),
    source: text("source").notNull(),
  },
  (t) => [uniqueIndex("candles_pk").on(t.symbol, t.interval, t.ts), index("candles_symbol_ts_idx").on(t.symbol, t.ts)],
);

/** Timestamped OI snapshots per option/futures contract. */
export const oiSnapshots = pgTable(
  "oi_snapshots",
  {
    contract: text("contract").notNull(),
    symbol: text("symbol").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    oi: doublePrecision("oi").notNull(),
    ltp: doublePrecision("ltp"),
    source: text("source").notNull(),
  },
  (t) => [
    uniqueIndex("oi_pk").on(t.contract, t.ts),
    index("oi_symbol_ts_idx").on(t.symbol, t.ts),
  ],
);

/** Momentum score history (score evolution per symbol). */
export const momentumScores = pgTable(
  "momentum_scores",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    symbol: text("symbol").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    bull: integer("bull").notNull(),
    bear: integer("bear").notNull(),
    band: text("band").notNull(),
    stage: text("stage").notNull(),
    quality: text("quality").notNull(),
    positioning: text("positioning").notNull(),
    source: text("source").notNull(),
  },
  (t) => [index("scores_symbol_ts_idx").on(t.symbol, t.ts)],
);

/** Signal & alert events emitted by the engines. */
export const signalEvents = pgTable(
  "signal_events",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    symbol: text("symbol").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    kind: text("kind").notNull(),
    severity: text("severity").notNull(),
    direction: text("direction").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    source: text("source").notNull(),
  },
  (t) => [
    index("events_ts_idx").on(t.ts),
    index("events_kind_idx").on(t.kind),
    uniqueIndex("events_dedupe").on(t.symbol, t.kind, t.title, t.ts),
  ],
);

/** Trade opportunity records (module N). */
export const opportunities = pgTable(
  "opportunities",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    symbol: text("symbol").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    direction: text("direction").notNull(),
    status: text("status").notNull(),
    score: integer("score").notNull(),
    entryLow: doublePrecision("entry_low"),
    entryHigh: doublePrecision("entry_high"),
    invalidation: doublePrecision("invalidation"),
    target1: doublePrecision("target1"),
    target2: doublePrecision("target2"),
    riskReward: doublePrecision("risk_reward"),
    source: text("source").notNull(),
  },
  (t) => [index("opps_ts_idx").on(t.ts), index("opps_symbol_idx").on(t.symbol)],
);

/** Key/value application settings (filters, retention, scan options). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
