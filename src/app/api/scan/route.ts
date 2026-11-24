import { getScan } from "@/lib/scan";
import { lightScan } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    const started = Date.now();
    const scan = await getScan();
    return Response.json({ ok: true, tookMs: Date.now() - started, scan: lightScan(scan) });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
