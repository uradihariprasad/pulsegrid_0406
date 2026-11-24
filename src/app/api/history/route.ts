import { readHistory } from "@/lib/persist";
import { getFeedsForBacktest } from "@/lib/scan";
import { runBacktest } from "@/lib/backtest";
import { getSession, LIMITATIONS } from "@/lib/upstox";

export const dynamic = "force-dynamic";

export async function GET() {
  let history: { scores: unknown[]; events: unknown[]; opportunities: unknown[] } = {
    scores: [],
    events: [],
    opportunities: [],
  };
  let dbError: string | null = null;
  try {
    const h = await readHistory(500);
    history = {
      scores: h.scores.map((s) => ({ ...s, ts: s.ts.toISOString() })),
      events: h.events.map((e) => ({ ...e, ts: e.ts.toISOString() })),
      opportunities: h.opportunities.map((o) => ({ ...o, ts: o.ts.toISOString() })),
    };
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  let backtest: Awaited<ReturnType<typeof runBacktest>> | null = null;
  let backtestError: string | null = null;
  try {
    const feeds = await getFeedsForBacktest();
    const usable = feeds.filter((f) => f.spot5.length > 30);
    if (usable.length < 3) {
      backtestError = getSession()
        ? "Fewer than three live instruments with a full candle series are available in this session — the walk-forward evaluation needs live history before it can report anything."
        : "No live market data: connect an Upstox token and run a scan. Nothing is evaluated without real candles.";
    } else {
      backtest = runBacktest(usable.slice(0, 12), 12, 34);
    }
  } catch (e) {
    backtestError = e instanceof Error ? e.message : String(e);
  }

  return Response.json({
    ok: true,
    mode: getSession() ? "live" : "none",
    history,
    dbError,
    backtest,
    backtestError,
    limitations: LIMITATIONS,
  });
}
