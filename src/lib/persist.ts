import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { candles, instruments, momentumScores, oiSnapshots, opportunities, settings, signalEvents } from "@/db/schema";
import type { ScanResult } from "./types";

const CHUNK = 500;

let lastWriteAt: number | null = null;
let lastDbError: string | null = null;
let dbOk = true;

/** Reported by the diagnostics panel; never blocks market-data responses. */
export function persistenceStatus(): { ok: boolean; lastWrite: number | null; error: string | null } {
  return { ok: dbOk && lastDbError === null, lastWrite: lastWriteAt, error: lastDbError };
}

async function safe<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
  try {
    const out = await fn();
    dbOk = true;
    lastDbError = null;
    lastWriteAt = Date.now();
    return out;
  } catch (e) {
    dbOk = false;
    lastDbError = `${label}: ${e instanceof Error ? e.message : String(e)}`;
    console.warn(`[market-master:${label}]`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function shouldWriteCandles(sessionKey: string): Promise<boolean> {
  const rows = await db.select().from(settings).where(eq(settings.key, "candles.session"));
  const cur = rows[0]?.value as string | undefined;
  if (cur === sessionKey) return false;
  try {
    await db
      .insert(settings)
      .values({ key: "candles.session", value: sessionKey })
      .onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value`, updatedAt: new Date() } });
  } catch (e) {
    console.warn("[market-master:settings]", e instanceof Error ? e.message : e);
  }
  return true;
}

export async function writeScan(result: ScanResult): Promise<void> {
  const ts = new Date(result.generatedAt);
  const sessionKey = `${result.sessionLabel}:${new Date().toISOString().slice(0, 10)}`;

  await safe(async () => {
    await db
      .insert(instruments)
      .values(
        result.analyses.map((a) => ({
          symbol: a.meta.symbol,
          name: a.meta.name,
          sector: a.meta.sector,
          kind: a.meta.kind,
          exchange: a.meta.exchange,
          spotKey: a.meta.spotKey,
          lotSize: a.meta.lotSize,
          strikeInterval: a.meta.strikeInterval,
          expiries: a.meta.expiries,
          origin: a.meta.origin,
        })),
      )
      .onConflictDoUpdate({
        target: instruments.symbol,
        set: {
          name: sql`excluded.name`,
          sector: sql`excluded.sector`,
          lotSize: sql`excluded.lot_size`,
          strikeInterval: sql`excluded.strike_interval`,
          origin: sql`excluded.origin`,
          updatedAt: new Date(),
        },
      });
  }, "instruments");

  await safe(async () => {
    const write = await shouldWriteCandles(sessionKey);
    if (!write) return;
    const { getFeedFor } = await import("./scan");
    const feeds = await Promise.all(result.analyses.map((a) => getFeedFor(a.meta.symbol)));
    const candleRows = [];
    const oiRows = [];
    for (const f of feeds) {
      if (!f) continue;
      for (const c of f.spot5) {
        candleRows.push({
          symbol: f.meta.symbol,
          interval: "5m",
          ts: new Date(c.t * 1000),
          o: c.o,
          h: c.h,
          l: c.l,
          c: c.c,
          v: c.v,
          oi: c.oi ?? null,
          source: f.source,
        });
      }
      for (const o of f.options) {
        for (const s of o.oi) {
          if (typeof s.oi !== "number") continue;
          oiRows.push({
            contract: o.key,
            symbol: f.meta.symbol,
            ts: new Date(s.t * 1000),
            oi: s.oi,
            ltp: null,
            source: f.source,
          });
        }
      }
    }
    for (let i = 0; i < candleRows.length; i += CHUNK) {
      await db.insert(candles).values(candleRows.slice(i, i + CHUNK)).onConflictDoNothing();
    }
    for (let i = 0; i < oiRows.length; i += CHUNK) {
      await db.insert(oiSnapshots).values(oiRows.slice(i, i + CHUNK)).onConflictDoNothing();
    }
  }, "candles");

  await safe(async () => {
    await db.insert(momentumScores).values(
      result.analyses.map((a) => ({
        symbol: a.meta.symbol,
        ts,
        bull: a.scores.bull,
        bear: a.scores.bear,
        band: a.scores.band,
        stage: a.momentum.stage,
        quality: a.momentum.quality,
        positioning: a.futures.positioning,
        source: a.source,
      })),
    );
  }, "scores");

  await safe(async () => {
    const top = result.events.slice(0, 400);
    if (!top.length) return;
    await db
      .insert(signalEvents)
      .values(
        top.map((e) => ({
          symbol: e.symbol,
          ts: new Date(e.ts),
          kind: e.kind,
          severity: e.severity,
          direction: e.direction,
          title: e.title,
          detail: e.detail,
          source: e.source,
        })),
      )
      .onConflictDoNothing();
  }, "events");

  await safe(async () => {
    if (!result.opportunities.length) return;
    await db.insert(opportunities).values(
      result.opportunities.map((o) => ({
        symbol: o.analysis.meta.symbol,
        ts,
        direction: o.analysis.trade.direction,
        status: o.analysis.trade.status,
        score: Math.max(o.analysis.scores.bull, o.analysis.scores.bear),
        entryLow: o.analysis.trade.entryZone?.[0] ?? null,
        entryHigh: o.analysis.trade.entryZone?.[1] ?? null,
        invalidation: o.analysis.trade.invalidation,
        target1: o.analysis.trade.target1,
        target2: o.analysis.trade.target2,
        riskReward: o.analysis.trade.riskReward,
        source: o.analysis.source,
      })),
    );
  }, "opportunities");
}

export async function readHistory(limit = 400) {
  const scores = await db
    .select()
    .from(momentumScores)
    .orderBy(desc(momentumScores.ts))
    .limit(limit);
  const events = await db
    .select()
    .from(signalEvents)
    .orderBy(desc(signalEvents.ts))
    .limit(limit);
  const opps = await db
    .select()
    .from(opportunities)
    .orderBy(desc(opportunities.ts))
    .limit(limit);
  return { scores, events, opportunities: opps };
}

export async function readScoreSeries(symbol: string, limit = 120) {
  return db
    .select()
    .from(momentumScores)
    .where(eq(momentumScores.symbol, symbol))
    .orderBy(momentumScores.ts)
    .limit(limit);
}

export async function readStats(sinceIso: string) {
  const rows = await db
    .select({
      band: momentumScores.band,
      bull: momentumScores.bull,
      bear: momentumScores.bear,
      ts: momentumScores.ts,
    })
    .from(momentumScores)
    .where(gte(momentumScores.ts, new Date(sinceIso)))
    .limit(5000);
  return rows;
}

export async function readEventsFor(symbols: string[]) {
  if (!symbols.length) return [];
  return db
    .select()
    .from(signalEvents)
    .where(inArray(signalEvents.symbol, symbols))
    .orderBy(desc(signalEvents.ts))
    .limit(300);
}

export async function healthSnapshot() {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(momentumScores)
    .where(
      and(
        gte(momentumScores.ts, new Date(Date.now() - 24 * 3600 * 1000)),
      ),
    );
  return { signals24h: rows[0]?.n ?? 0 };
}
