"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { ScanResult, SymbolAnalysis } from "@/lib/types";
import { hydrateScan } from "@/lib/serialize";
import Rail, { TABS } from "./Rail";
import StatusStrip, { type SessionState } from "./StatusStrip";
import Tape from "./Tape";
import StockDrawer from "./StockDrawer";
import { Chip, Empty, Field, Section, Stat } from "./ui";
import { PulseMark } from "./Rail";
import Overview from "./tabs/Overview";
import Scanner from "./tabs/Scanner";
import MomentumMaster from "./tabs/MomentumMaster";
import Futures from "./tabs/Futures";
import OptionsIntel from "./tabs/OptionsIntel";
import OiIntel from "./tabs/OiIntel";
import Structure from "./tabs/Structure";
import Flow from "./tabs/Flow";
import TradeFinder from "./tabs/TradeFinder";
import Alerts from "./tabs/Alerts";
import Analytics from "./tabs/Analytics";

const BULL_PRESET = [
  "strong-bull",
  "bull",
  "long-build",
  "long-build-cand",
  "short-cover",
  "res-weakening",
  "genuine-bo",
  "ce-strong",
  "genuine-mom",
  "eligible",
  "divergence",
  "exhaustion",
];
const BEAR_PRESET = [
  "strong-bear",
  "bear",
  "short-build",
  "sup-weakening",
  "genuine-bd",
  "pe-strong",
  "genuine-mom",
  "long-unwind",
  "eligible",
  "divergence",
  "exhaustion",
  "reversal",
];

export default function Dashboard() {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [tab, setTab] = useState("overview");
  const [sel, setSel] = useState<string | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [countdown, setCountdown] = useState(30);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setPending(true);
    setCountdown(30);
    try {
      const res = await fetch("/api/scan", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "scan failed");
      setScan(hydrateScan(json.scan as ScanResult));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }, []);

  // Auto-scan every 30 seconds with a visible countdown
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    intervalRef.current = setInterval(() => void load(), 30_000);
    const tick = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => {
      clearTimeout(first);
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearInterval(tick);
    };
  }, [load]);

  /** Manual scan — resets the 30s auto-scan timer so it doesn't double-fire. */
  const manualScan = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    void load();
    intervalRef.current = setInterval(() => void load(), 30_000);
  }, [load]);

  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then(setSession)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSel(null);
      const n = Number(e.key);
      if (!Number.isNaN(n) && e.altKey) {
        const idx = n === 0 ? 9 : n - 1;
        if (TABS[idx]) setTab(TABS[idx].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onSelect = useCallback((symbol: string) => setSel(symbol), []);

  const body = () => {
    if (!scan) {
      return error ? (
        <Field title="SCAN FAILED" ticked>
          <Empty title="MARKET DATA UNAVAILABLE" reason={`The scan request failed: ${error}. Use RE-SCAN once the Upstox session or database is reachable.`} />
        </Field>
      ) : (
        <Field title="INITIALISING MARKET MASTER" ticked>
          <Empty title="RUNNING ENGINES" reason="Connecting to the Upstox API, discovering the instrument master, aggregating candles…" />
        </Field>
      );
    }
    if (!scan.connected && !!session && !session.connected && !!session.lastError) {
      return (
        <Field title="TOKEN INVALID" ticked right={<Chip tone="warn">CONNECTION FAILED</Chip>}>
          <Empty
            title="UPSTOX TOKEN VALIDATION FAILED"
            reason={`${session.lastError}. No market-data request was started and the application is not presented as connected.`}
          />
        </Field>
      );
    }
    if (!scan.connected) {
      return (
        <Field title="AWAITING UPSTOX CONNECTION" ticked right={<Chip tone="warn">NO MARKET DATA</Chip>}>
          <div
            className="relative p-5 sm:p-7 grid gap-3 max-w-4xl"
            style={{
              backgroundImage:
                "linear-gradient(100deg, rgba(11,13,16,0.97) 0%, rgba(11,13,16,0.92) 52%, rgba(11,13,16,0.62) 100%), url(images/desk.jpg)",
              backgroundSize: "cover",
              backgroundPosition: "center right",
            }}
          >
            <div className="text-[15px] amber font-cond uppercase tracking-[0.12em]">Live data only</div>
            <p className="text-[12.5px] leading-relaxed text-[#c9c3b6] font-[var(--font-sans)]">
              {scan.notice ??
                "Connect an Upstox access token to load live market data. No synthetic or simulated prices are ever generated."}
            </p>
            <ol className="grid gap-1.5 text-[12px] text-[#c9c3b6] font-[var(--font-sans)] list-decimal ml-5">
              <li>
                Paste your Upstox OAuth access token into the <span className="amber">UPSTOX ACCESS TOKEN</span> field above and
                press <span className="amber">VALIDATE &amp; CONNECT</span>.
              </li>
              <li>The server validates it against <code className="amber">/v2/user/profile</code> and keeps it in process memory only.</li>
              <li>
                The instrument universe is downloaded from the official Upstox master files
                (<code className="amber">assets.upstox.com …/NSE.json.gz</code> and <code className="amber">BSE.json.gz</code>) — never
                from a bundled list.
              </li>
              <li>Candles come from the documented V3 endpoints; outside market hours the latest completed session is read as HISTORICAL data.</li>
            </ol>
            {scan.sessionLabel ? <p className="text-[11px] mute">Session: {scan.sessionLabel}</p> : null}
            {scan.limitations.length ? (
              <div className="border-t border-[var(--color-line)] pt-3">
                <div className="lbl mb-2">KNOWN PROVIDER LIMITATIONS</div>
                <ul className="grid gap-1.5 text-[11.5px] text-[#c9c3b6] font-[var(--font-sans)] leading-snug">
                  {scan.limitations.slice(0, 6).map((l) => (
                    <li key={l} className="flex gap-2">
                      <span className="amber">▸</span>
                      <span>{l}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex gap-2 pt-1">
              <button
                className="btn btn--amber"
                type="button"
                onClick={() => document.querySelector<HTMLInputElement>("input[type=password]")?.focus()}
              >
                FOCUS TOKEN FIELD
              </button>
              <button className="btn" type="button" onClick={manualScan}>
                RE-SCAN
              </button>
            </div>
          </div>
        </Field>
      );
    }
    if (!scan.analyses.length) {
      return (
        <Field
          title={scan.state === "PROVIDER_ERROR" ? "PROVIDER ERROR" : "MARKET DATA UNAVAILABLE"}
          ticked
          right={<Chip tone="warn">{scan.state}</Chip>}
        >
          <div className="p-5 grid gap-3 max-w-4xl">
            <div className="text-[15px] amber font-cond uppercase tracking-[0.12em]">Connected — no candles returned</div>
            <p className="text-[12.5px] leading-relaxed text-[#c9c3b6] font-[var(--font-sans)]">{scan.notice}</p>
            <div>
              <div className="lbl mb-1.5">FAILED STAGE · API · HTTP · PROVIDER MESSAGE</div>
              <ul className="grid gap-1.5 text-[11.5px] font-[var(--font-sans)]">
                {scan.diagnostics.failures.slice(0, 8).map((f, i) => (
                  <li key={`${f.at}-${i}`} className="flex gap-2 flex-wrap items-baseline">
                    <span className="amber">{f.code ?? "ERR"}</span>
                    <span className="mute">{f.status ? `HTTP ${f.status}` : "network"}</span>
                    <span className="text-[#c9c3b6]">{f.endpoint.replace(/^https?:\/\/[^/]+/, "").slice(0, 88)}</span>
                    {f.instrument ? <span className="amber">{f.instrument}</span> : null}
                    <span className="mute">{f.retryable ? "retryable" : "permanent"}</span>
                    <span className="text-[#c9c3b6]">{f.message.slice(0, 120)}</span>
                  </li>
                ))}
                {!scan.diagnostics.failures.length ? <li className="mute">{scan.sessionLabel}</li> : null}
              </ul>
            </div>
            <div className="flex gap-2">
              <button className="btn btn--amber" type="button" onClick={manualScan}>
                RETRY SCAN
              </button>
            </div>
          </div>
        </Field>
      );
    }
    switch (tab) {
      case "scanner":
        return <Scanner scan={scan} onSelect={onSelect} />;
      case "master":
        return <MomentumMaster scan={scan} onSelect={onSelect} />;
      case "bullish":
        return (
          <Scanner
            scan={scan}
            onSelect={onSelect}
            preset={BULL_PRESET}
            logic="or"
            title="BULLISH MOMENTUM · LONG BUILD / SHORT COVERING / RESISTANCE WEAKENING / CE STRENGTH"
            require={(a: SymbolAnalysis) => a.scores.bull >= a.scores.bear || a.futures.positioning === "LONG BUILD-UP"}
          />
        );
      case "bearish":
        return (
          <Scanner
            scan={scan}
            onSelect={onSelect}
            preset={BEAR_PRESET}
            logic="or"
            title="BEARISH MOMENTUM · SHORT BUILD / LONG UNWINDING / SUPPORT WEAKENING / PE STRENGTH"
            require={(a: SymbolAnalysis) => a.scores.bear >= a.scores.bull || a.futures.positioning === "SHORT BUILD-UP"}
          />
        );
      case "futures":
        return <Futures scan={scan} onSelect={onSelect} />;
      case "options":
        return <OptionsIntel scan={scan} onSelect={onSelect} />;
      case "oi":
        return <OiIntel scan={scan} onSelect={onSelect} />;
      case "structure":
        return <Structure scan={scan} onSelect={onSelect} />;
      case "flow":
        return <Flow scan={scan} onSelect={onSelect} />;
      case "trade":
        return <TradeFinder scan={scan} onSelect={onSelect} />;
      case "alerts":
        return <Alerts scan={scan} onSelect={onSelect} />;
      case "analytics":
        return <Analytics />;
      default:
        return <Overview scan={scan} onSelect={onSelect} />;
    }
  };

  const activeTab = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="min-h-screen bg-[var(--color-ink)]">
      <Rail active={tab} onSelect={setTab} />
      <div className="md:pl-[76px] pb-[64px] md:pb-[44px]">
        <StatusStrip
          session={session}
          onSession={setSession}
          onRefresh={manualScan}
          source={scan?.connected ? "live" : "none"}
          pending={pending}
          sessionDate={scan?.sessionDate ?? null}
          state={scan?.state ?? "INITIAL_LOADING"}
          lastScanAt={scan?.generatedAt ?? null}
        />

        {/* horizontal function strip — the rail on small screens */}
        <nav
          className="md:hidden sticky top-0 z-20 border-b border-[var(--color-line)] bg-[#0a0c0f] shadow-[0_10px_18px_-16px_rgba(0,0,0,0.95)]"
          aria-label="Function strip"
        >
          <div className="navscroll flex gap-1.5 items-center px-2.5 py-2 overflow-x-auto min-w-max">
            <span className="pr-1.5 shrink-0">
              <PulseMark size={18} />
            </span>
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`chip !py-1.5 shrink-0 ${tab === t.id ? "text-[var(--color-amber)]" : ""}`}
                style={
                  tab === t.id
                    ? { borderColor: "var(--color-amber)", background: "#171208" }
                    : { cursor: "pointer" }
                }
                aria-current={tab === t.id}
              >
                <span className="opacity-60">{t.idx}</span> {t.short}
              </button>
            ))}
          </div>
        </nav>

        <main className="px-3 sm:px-4 lg:px-5 pt-3 sm:pt-4">
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <div className="flex items-baseline gap-3">
              <span className="text-[var(--color-amber)] text-[12px] tracking-[0.2em]">{activeTab.idx}</span>
              <h1 className="font-cond font-semibold uppercase tracking-[0.12em] text-[15px] md:text-[17px]">
                {activeTab.name}
              </h1>
            </div>
            <div className="flex items-center gap-3 text-[11px] mute">
              {scan ? (
                <>
                  <span>
                    {scan.analyses.length} instruments · {scan.events.length} events
                  </span>
                  <span>·</span>
                  <span>
                    scan {new Date(scan.generatedAt).toLocaleTimeString("en-IN", { hour12: false })} IST
                  </span>
                  <span>·</span>
                  <span className={scan.connected ? "bull" : "warn"}>
                    {scan.connected
                      ? scan.sessionLabel.includes("HISTORICAL")
                        ? "HISTORICAL SESSION · UPSTOX"
                        : "LIVE UPSTOX FEED"
                      : "NOT CONNECTED"}
                  </span>
                </>
              ) : (
                <span className={pending ? "amber" : ""}>
                  {pending
                    ? scan
                      ? "REFRESHING…"
                      : "SCANNING — first scan 20–60s"
                    : `next scan ${countdown}s`}
                </span>
              )}
            </div>
          </div>

          {scan?.connected && scan.analyses.length ? (
            <div className="band grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 mb-3">
              <Stat label="Session" value={scan.sessionLabel.includes("HISTORICAL") ? "HISTORICAL" : "LIVE"} tone="amber" sub={scan.sessionLabel.split("·")[1]?.trim() ?? scan.sessionLabel} />
              <Stat label="Breadth" value={`${scan.overview.advancing} / ${scan.overview.declining}`} sub="advancing / declining" tone={scan.overview.advancing >= scan.overview.declining ? "bull" : "bear"} />
              <Stat label="Bullish / Bearish" value={`${scan.overview.bullish} / ${scan.overview.bearish}`} sub="score ≥ 50 and leading" />
              <Stat label="Strong momentum" value={scan.overview.strong.length} tone="amber" sub="STRONG / HIGH CONFLUENCE" />
              <Stat label="Avg ATR" value={`${scan.overview.avgVolatilityPct}%`} sub={scan.overview.sentiment} />
              <Stat
                label="Top movers"
                value={
                  <span className="flex gap-2 text-[13px]">
                    <span className="bull">{scan.overview.topBull[0]?.meta.symbol ?? "—"}</span>
                    <span className="mute">/</span>
                    <span className="bear">{scan.overview.topBear[0]?.meta.symbol ?? "—"}</span>
                  </span>
                }
                sub="bull / bear score leaders"
              />
            </div>
          ) : null}

          {body()}

          <footer className="mt-4 mb-3 border-t border-[var(--color-line)] pt-3 text-[11px] mute font-[var(--font-sans)] leading-relaxed">
            MARKET MASTER — spot determines direction · futures reveal positioning · options validate premium response and
            contract suitability · volume validates participation · support and resistance define location · buyer/seller
            intelligence evaluates control · the unified momentum engine assesses quality, continuation and reversal risk.
            Scores are heuristic confluence measures, not probabilities. Alt+1…Alt+0 switches tabs; Esc closes the inspector.
          </footer>
        </main>
      </div>

      {/* ── floating SCAN button — always accessible ───────────────────── */}
      <button
        className={`scan-fab ${pending ? "scanning" : ""}`}
        onClick={manualScan}
        disabled={pending}
        title={pending ? "Scanning…" : `Scan now (auto in ${countdown}s)`}
        aria-label="Scan market data"
      >
        <RefreshCw size={20} className={pending ? "animate-spin" : ""} strokeWidth={2.5} />
      </button>

      <Tape
        events={scan?.events ?? []}
        mode={
          scan?.connected
            ? scan.sessionLabel.includes("HISTORICAL")
              ? "HISTORICAL SESSION"
              : "LIVE UPSTOX"
            : "NO FEED"
        }
      />
      {sel ? <StockDrawer key={sel} symbol={sel} onClose={() => setSel(null)} /> : null}
      <Section className="sr-only">MARKET MASTER market intelligence terminal</Section>
    </div>
  );
}
