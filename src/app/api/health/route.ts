import { db } from "@/db";
import { sql } from "drizzle-orm";
import { connectionState, LIMITATIONS } from "@/lib/upstox";

export const dynamic = "force-dynamic";

export async function GET() {
  let dbOk = false;
  let signals24h: number | null = null;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
    try {
      const res = (await db.execute(
        sql`select count(*)::int as n from momentum_scores where ts > now() - interval '24 hours'`,
      )) as unknown as { rows?: { n?: number }[] };
      signals24h = Number(res.rows?.[0]?.n ?? 0);
    } catch {
      signals24h = null;
    }
  } catch {
    dbOk = false;
  }

  const state = connectionState();
  const ok = dbOk;
  return Response.json(
    {
      ok,
      db: dbOk ? "up" : "down",
      mode: state.connected ? "live" : "none",
      connected: state.connected,
      signals24h,
      limitations: LIMITATIONS.slice(0, 3),
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
