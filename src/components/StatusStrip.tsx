"use client";

import { useEffect, useState } from "react";
import { Loader2, Plug, PlugZap, ShieldCheck, X } from "lucide-react";
import { Chip, Field } from "./ui";
import { PulseMark } from "./Rail";

export interface SessionState {
  connected: boolean;
  validatedAt: number | null;
  userId: string | null;
  name: string | null;
  segments: string[];
  lastError: string | null;
  mode: "live" | "none";
  limitations: string[];
}

const PHASE_LABEL: Record<string, string> = {
  OPEN: "MARKET OPEN",
  "PRE-OPEN": "PRE-OPEN",
  CLOSED: "MARKET CLOSED",
  HOLIDAY: "HOLIDAY",
};

function phaseOf(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return "HOLIDAY";
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  if (mins >= 540 && mins < 555) return "PRE-OPEN";
  if (mins >= 555 && mins <= 930) return "OPEN";
  return "CLOSED";
}

export default function StatusStrip({
  session,
  onSession,
  onRefresh,
  source,
  ageMs,
  pending,
  sessionDate = null,
  state = "INITIAL_LOADING",
  lastScanAt = null,
}: {
  session: SessionState | null;
  onSession: (s: SessionState) => void;
  onRefresh: () => void;
  source: "live" | "none";
  ageMs?: number;
  pending: boolean;
  sessionDate?: string | null;
  state?: string;
  lastScanAt?: number | null;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showLimits, setShowLimits] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(now));
  const phase = phaseOf(new Date(now));
  const isWeekend = ["Sat", "Sun"].includes(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }).format(new Date(now)),
  );
  const marketClosed = phase === "CLOSED" || phase === "HOLIDAY";
  const age = ageMs ?? (lastScanAt ? Math.max(0, now - lastScanAt) : 0);
  const stale = source === "live" && !marketClosed && age > 60_000;

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      // token is cleared from component state immediately after submission
      setToken("");
      if (!json.ok) {
        setErr(json.error ?? "Validation failed");
        return;
      }
      const st = await (await fetch("/api/session")).json();
      onSession(st as SessionState);
      onRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    await fetch("/api/session", { method: "DELETE" });
    const st = await (await fetch("/api/session")).json();
    onSession(st as SessionState);
    setBusy(false);
    onRefresh();
  }

  return (
    <header
      className="static md:sticky md:top-0 z-30 border-b border-[var(--color-line2)] bg-[#0a0c0f]/95 md:backdrop-blur-[3px]"
      style={{
        backgroundImage:
          "linear-gradient(92deg, rgba(7,8,10,0.985) 0%, rgba(7,8,10,0.95) 46%, rgba(7,8,10,0.72) 100%), url(images/console.jpg)",
        backgroundSize: "cover",
        backgroundPosition: "center right",
      }}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 sm:px-4 lg:px-5 py-2.5">
        <div className="flex items-center gap-2.5">
          <PulseMark size={22} />
          <span className="headline font-bold text-[16px] sm:text-[18px] text-[var(--color-amber)]">MARKET MASTER</span>
          <span className="lbl border-l border-[var(--color-line2)] pl-2.5">TERMINAL</span>
          <span className="hidden xl:inline lbl opacity-70">MOMENTUM · POSITIONING · STRUCTURE</span>
        </div>

        <div className="flex items-center gap-2 text-[11px] flex-wrap">
          <span className={phase === "OPEN" ? "bull" : "mute"}>
            {isWeekend ? "WEEKEND · MARKET CLOSED" : PHASE_LABEL[phase]}
          </span>
          <span className="text-[var(--color-amber)]">{clock} IST</span>
          <Chip tone={source === "live" ? "live" : "warn"}>
            {source === "live" ? "UPSTOX CONNECTED" : "NO DATA · NOT CONNECTED"}
          </Chip>
          <Chip tone={source !== "live" ? "" : marketClosed ? "amber" : stale ? "warn" : ""}>
            {source !== "live"
              ? "NO FEED"
              : marketClosed
                ? `HISTORICAL SESSION${sessionDate ? ` · ${sessionDate}` : ""}`
                : stale
                  ? `DATA STALE ${Math.round(age / 1000)}s`
                  : `LIVE MARKET · FEED ${Math.round(age / 1000)}s`}
          </Chip>
          {state === "PROVIDER_ERROR" || state === "DATA_UNAVAILABLE" ? <Chip tone="warn">CONNECTION LOST</Chip> : null}
          {state === "PARTIAL_DATA_AVAILABLE" ? <Chip tone="warn">PARTIAL DATA</Chip> : null}
          {state === "DATABASE_UNAVAILABLE" ? <Chip tone="warn">DB DOWN</Chip> : null}
          {lastScanAt ? (
            <span className="mute hidden sm:inline">last scan {Math.round((now - lastScanAt) / 1000)}s ago</span>
          ) : null}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <button className="btn" onClick={onRefresh} disabled={pending}>
            {pending ? <Loader2 size={12} className="inline animate-spin" /> : null}
            {pending ? " SCANNING" : " SCAN NOW"}
          </button>
          {session?.connected ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] bull flex items-center gap-1">
                <PlugZap size={13} /> {session.userId ?? "connected"}
              </span>
              <button className="btn" onClick={disconnect} disabled={busy}>
                <X size={11} className="inline" /> DISCONNECT
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {source !== "live" ? (
        <div className="border-t border-[var(--color-amberdim)] bg-[#151007] px-4 py-1.5 text-[11px] text-[var(--color-amber)] flex flex-wrap items-center gap-3">
          <span className="lbl text-[var(--color-amber)]">NO LIVE FEED</span>
          <span className="font-[var(--font-sans)] text-[#d9cfae]">
            No Upstox credential attached. MARKET MASTER does not generate, substitute or simulate market data — all tabs stay
            empty until a valid access token is validated and live candles, quotes, chains and open interest are fetched.
          </span>
        </div>
      ) : null}

      {!session?.connected ? (
        <div className="border-t border-[var(--color-line)] px-4 py-2.5 flex flex-wrap items-center gap-3 bg-[#0b0d10]">
          <form onSubmit={connect} className="flex items-center gap-2 flex-wrap">
            <label className="lbl flex items-center gap-1.5">
              <Plug size={12} /> UPSTOX ACCESS TOKEN
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="paste OAuth access token — held in server process memory only"
              className="w-[340px] max-w-full"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="btn btn--amber" type="submit" disabled={busy || token.length < 20}>
              {busy ? <Loader2 size={12} className="inline animate-spin" /> : <ShieldCheck size={12} className="inline" />} VALIDATE &amp; CONNECT
            </button>
          </form>
          {err ? <span className="text-[11px] bear">{err}</span> : null}
          <div className="flex-1" />
          <button className="btn" onClick={() => setShowLimits((v) => !v)} type="button">
            {showLimits ? "HIDE" : "SHOW"} DATA LIMITATIONS
          </button>
        </div>
      ) : null}

      {showLimits ? (
        <div className="border-t border-[var(--color-line)] bg-[#0b0d10] px-4 py-3">
          <Field title="Provider limitations — reported, never manufactured">
            <ul className="p-3 grid gap-1.5 text-[11px] text-[#c9c3b6] font-[var(--font-sans)] leading-snug">
              {(session?.limitations ?? []).map((l) => (
                <li key={l} className="flex gap-2">
                  <span className="text-[var(--color-amber)]">▸</span>
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          </Field>
        </div>
      ) : null}
    </header>
  );
}
