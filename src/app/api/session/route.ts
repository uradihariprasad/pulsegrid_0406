import { connectionState, clearSession, validateToken, authorizeFeed, LIMITATIONS } from "@/lib/upstox";
import { clearScanCache } from "@/lib/scan";

export const dynamic = "force-dynamic";

/** Connection status — never returns the token itself. */
export async function GET() {
  return Response.json({
    ...connectionState(),
    mode: connectionState().connected ? "live" : "none",
    limitations: LIMITATIONS,
    serverTime: Date.now(),
  });
}

/** Validate an Upstox access token. The token is kept in process memory only. */
export async function POST(req: Request) {
  let body: { token?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  // Tolerate common paste artefacts: "Bearer …" prefixes, quotes, newlines.
  const token = (body.token ?? "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/^bearer\s+/i, "")
    .replace(/\s+/g, "");
  if (token.length < 20) {
    return Response.json(
      { ok: false, error: "Token looks too short. Paste the full Upstox access token from the OAuth flow." },
      { status: 400 },
    );
  }
  const profile = await validateToken(token);
  if (!profile.ok) {
    return Response.json(
      { ok: false, error: profile.error ?? "Token validation failed", checkedAt: profile.checkedAt },
      { status: 401 },
    );
  }
  // New credential → previous cached feeds must never be served for it.
  clearScanCache();
  const feed = await authorizeFeed();
  return Response.json({
    ok: true,
    profile,
    feed: { authorized: feed.ok, endpoint: feed.ok ? "wss endpoint issued" : null, error: feed.error ?? null },
    tokenStored: "process memory only — not echoed, not logged, not persisted to browser storage",
  });
}

/** Disconnect and clear the session. */
export async function DELETE() {
  clearSession();
  clearScanCache();
  return Response.json({ ...clearSession(), message: "Session cleared. Token and cached market data removed." });
}
