import { analyzeSymbol, sliceFeed } from "@/lib/engines";
import { getFeedFor } from "@/lib/scan";
import { stripAnalysis } from "@/lib/serialize";
import { readScoreSeries } from "@/lib/persist";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await ctx.params;
    let feed = await getFeedFor(decodeURIComponent(symbol).toUpperCase());
    if (!feed || !feed.spot5.length) {
      return Response.json(
        { ok: false, error: `No market data for ${symbol}. Connect Upstox or check the symbol.` },
        { status: 404 },
      );
    }
    // detail view pulls ATM±2 premium history and extended chart history for
    // this ONE instrument only, so the chart can show previous sessions + the
    // current session without paying that cost for the whole universe scan.
    let chart = { m5: feed.spot5, m15: feed.spot15, d1: feed.spot1d, futures: feed.futures?.candles ?? [] };
    try {
      const { enrichFeedOptions, fetchExtendedHistory } = await import("@/lib/live");
      feed = await enrichFeedOptions(feed, 12);
      const hist = await fetchExtendedHistory(feed, 30);
      chart = { m5: hist.spot5, m15: hist.spot15, d1: hist.spot1d, futures: hist.futures };
    } catch {
      /* enrichment/history are optional — base scan data still renders */
    }
    const analysis = analyzeSymbol(feed);
    let scoreSeries: { ts: string; bull: number; bear: number }[] = [];
    try {
      const rows = await readScoreSeries(feed.meta.symbol, 120);
      scoreSeries = rows.map((r) => ({ ts: r.ts.toISOString(), bull: r.bull, bear: r.bear }));
    } catch {
      scoreSeries = [];
    }
    return Response.json({
      ok: true,
      analysis: stripAnalysis(analysis),
      candles: chart,
      options: feed.options.map((o) => ({
        strike: o.strike,
        side: o.side,
        expiry: o.expiry,
        premium: o.quote.ltp,
        bid: o.quote.bid ?? null,
        ask: o.quote.ask ?? null,
        oi: o.quote.oi ?? null,
        iv: o.greeks.iv,
        delta: o.greeks.delta,
        premiumSeries: o.candles.map((c) => ({ t: c.t, c: c.c, v: c.v })),
        oiSeries: o.oi.map((c) => ({ t: c.t, oi: c.oi ?? null })),
      })),
      scoreSeries,
      source: feed.source,
      notes: feed.notes,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  // Re-analyse a truncated feed for point-in-time inspection (no look-ahead).
  const { symbol } = await ctx.params;
  const feed = await getFeedFor(decodeURIComponent(symbol).toUpperCase());
  if (!feed) return Response.json({ ok: false, error: "unknown symbol" }, { status: 404 });
  return Response.json({ ok: true, default: sliceFeed(feed, feed.spot5.length).source });
}
