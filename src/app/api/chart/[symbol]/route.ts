import { getFeedFor } from "@/lib/scan";
import { fetchHistory, mergeWithLive, type ChartRange, type ChartInterval } from "@/lib/history";
import { fetchInstrumentMaster } from "@/lib/upstox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VALID_RANGES = new Set(["1D", "5D", "1M", "3M", "6M", "1Y"]);
const VALID_INTERVALS = new Set([1, 2, 3, 5, 10, 15, 30, 60, "day", "week"]);

/** Well-known index keys that work without a scan. */
const INDEX_KEYS: Record<string, string> = {
  NIFTY: "NSE_INDEX|Nifty 50",
  "NIFTY 50": "NSE_INDEX|Nifty 50",
  SENSEX: "BSE_INDEX|SENSEX",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  "NIFTY BANK": "NSE_INDEX|Nifty Bank",
};

async function resolveKey(sym: string): Promise<string | null> {
  // 1) from the scan cache
  const feed = await getFeedFor(sym);
  if (feed?.meta.spotKey) return feed.meta.spotKey;
  // 2) well-known indices
  if (INDEX_KEYS[sym]) return INDEX_KEYS[sym];
  // 3) search the instrument master
  try {
    const { rows } = await fetchInstrumentMaster();
    const match = rows.find((r) => r.symbol === sym && (r.segment === "NSE_EQ" || r.segment.endsWith("_INDEX")));
    if (match) return match.instrumentKey;
    const fuzzy = rows.find((r) => r.symbol === sym);
    if (fuzzy) return fuzzy.instrumentKey;
  } catch { /* master unavailable */ }
  return null;
}

export async function GET(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await ctx.params;
    const url = new URL(req.url);
    const range = (url.searchParams.get("range") ?? "1M").toUpperCase() as ChartRange;
    const rawInterval = url.searchParams.get("interval") ?? "5";
    const interval: ChartInterval = rawInterval === "day" ? "day" : rawInterval === "week" ? "week" : Number(rawInterval) as ChartInterval;

    if (!VALID_RANGES.has(range)) return Response.json({ ok: false, error: `Invalid range: ${range}` }, { status: 400 });
    if (!VALID_INTERVALS.has(interval)) return Response.json({ ok: false, error: `Invalid interval: ${interval}` }, { status: 400 });

    const sym = decodeURIComponent(symbol).toUpperCase();
    const feed = await getFeedFor(sym);
    const instrumentKey = feed?.meta.spotKey ?? await resolveKey(sym);
    if (!instrumentKey) {
      return Response.json({ ok: false, error: `Instrument key not found for ${sym}. Connect Upstox and run a scan first.` }, { status: 404 });
    }

    const result = await fetchHistory({ key: instrumentKey, range, interval });

    // Merge with live session candles if available
    const liveCandles = feed?.spot5 ?? [];
    const merged = result.candles.length && liveCandles.length
      ? mergeWithLive(result.candles, liveCandles)
      : result.candles.length ? result.candles : liveCandles;

    return Response.json({
      ok: true,
      symbol: sym,
      instrumentKey,
      range,
      interval,
      candles: merged,
      segments: result.segments,
      firstDate: merged.length ? new Date(merged[0].t * 1000).toISOString() : null,
      lastDate: merged.length ? new Date(merged[merged.length - 1].t * 1000).toISOString() : null,
      totalCandles: merged.length,
      fromCache: result.fromCache,
      durationMs: result.durationMs,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
