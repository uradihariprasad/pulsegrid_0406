"use client";

import { useEffect, useMemo, useState } from "react";
import { bollinger, close, ema, vwap } from "@/lib/indicators";
import { fmtAge, fmtCompact, fmtNum, fmtPct } from "@/lib/math";
import type { Candle, SymbolAnalysis, Zone } from "@/lib/types";
import PriceChart, { ScoreChart, type ChartMarker, type ChartOverlay } from "./PriceChart";
import OiLadder from "./OiLadder";
import { Bar, Chip, Empty, Field, Meter, Stat, Tone } from "./ui";

interface DetailResponse {
  ok: boolean;
  error?: string;
  analysis: SymbolAnalysis;
  candles: { m5: Candle[]; m15: Candle[]; d1: Candle[]; futures: Candle[] };
  options: {
    strike: number;
    side: "CE" | "PE";
    premium: number;
    bid: number | null;
    ask: number | null;
    oi: number | null;
    iv: number | null;
    delta: number | null;
    premiumSeries: { t: number; c: number }[];
    oiSeries: { t: number; oi: number | null }[];
  }[];
  scoreSeries: { ts: string; bull: number; bear: number }[];
  notes: string[];
}

function Answer({ q, a, tone = "" }: { q: string; a: string; tone?: string }) {
  return (
    <div className="px-3 py-2.5 border-b border-[var(--color-line)]">
      <div className="lbl mb-1.5 text-[var(--color-amber)]">{q}</div>
      <p className={`text-[12px] leading-relaxed font-[var(--font-sans)] ${tone || "text-[#c9c3b6]"}`}>{a}</p>
    </div>
  );
}

/** Shared detail cache + in-flight de-duplication across drawer opens. */
const detailCache = new Map<string, DetailResponse>();
const detailInflight = new Map<string, Promise<DetailResponse>>();

async function fetchDetail(symbol: string): Promise<DetailResponse> {
  const hit = detailCache.get(symbol);
  if (hit) return hit;
  const pending = detailInflight.get(symbol);
  if (pending) return pending;
  const p = fetch(`/api/symbol/${encodeURIComponent(symbol)}`)
    .then(async (r) => {
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? "Failed to load chart data");
      const detail = j as DetailResponse;
      detailCache.set(symbol, detail);
      return detail;
    })
    .finally(() => detailInflight.delete(symbol));
  detailInflight.set(symbol, p);
  return p;
}

export function invalidateDetailCache() {
  detailCache.clear();
}

const RANGES = ["1D", "5D", "1M", "3M", "6M", "1Y"] as const;
const INTERVALS = [
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
  { value: "60", label: "1H" },
  { value: "day", label: "D" },
  { value: "week", label: "W" },
] as const;

export default function StockDrawer({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [data, setData] = useState<DetailResponse | null>(() => detailCache.get(symbol) ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [range, setRange] = useState<string>("1M");
  const [interval, setInterval] = useState<string>("5");
  const [chartCandles, setChartCandles] = useState<Candle[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartMeta, setChartMeta] = useState<{ total: number; first: string | null; last: string | null; ms: number; cached: boolean; segments: { from: string; to: string; count: number; status: string }[] } | null>(null);
  const [toggles, setToggles] = useState({ ema: true, bb: true, vwap: true, zones: true, vol: true });
  const [focus, setFocus] = useState<number | null>(null);

  // Load analysis data
  useEffect(() => {
    const controller = new AbortController();
    const req: Promise<DetailResponse> = detailCache.get(symbol) ? Promise.resolve(detailCache.get(symbol)!) : fetchDetail(symbol);
    req
      .then((detail) => { if (!controller.signal.aborted) setData(detail); })
      .catch((e) => { if (!controller.signal.aborted) setErr(e instanceof Error ? e.message : String(e)); });
    return () => controller.abort();
  }, [symbol]);

  // Load chart candles (separate from analysis — chart loads independently)
  useEffect(() => {
    const controller = new AbortController();
    // deferred to avoid synchronous setState inside the effect body
    const start = setTimeout(() => {
      if (controller.signal.aborted) return;
      setChartLoading(true);
    }, 0);
    fetch(`/api/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`, { signal: controller.signal })
      .then(async (r) => {
        const text = await r.text();
        try {
          const j = JSON.parse(text);
          if (!controller.signal.aborted) {
            if (j.ok && j.candles?.length) {
              setChartCandles(j.candles);
              setChartMeta({ total: j.totalCandles, first: j.firstDate, last: j.lastDate, ms: j.durationMs, cached: j.fromCache, segments: j.segments ?? [] });
            } else {
              // Fallback to scan candles if chart API returned empty
              const scan = data?.candles;
              if (scan?.m5?.length) setChartCandles(scan.m5);
              setChartMeta(null);
            }
          }
        } catch {
          // Non-JSON response — use scan candles
          if (!controller.signal.aborted && data?.candles?.m5?.length) setChartCandles(data.candles.m5);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && data?.candles?.m5?.length) setChartCandles(data.candles.m5);
      })
      .finally(() => { if (!controller.signal.aborted) setChartLoading(false); });
    return () => { controller.abort(); clearTimeout(start); };
  }, [symbol, range, interval, data]);

  const a = data?.analysis;
  const candles = chartCandles;

  const overlay: ChartOverlay = useMemo(() => {
    const cl = close(candles);
    const bb = bollinger(cl, 20, 2);
    return {
      ema9: ema(cl, 9),
      ema21: ema(cl, 21),
      ema50: ema(cl, 50),
      ema200: ema(cl, 200),
      vwap: vwap(candles),
      bbUp: bb.up,
      bbLo: bb.lo,
    };
  }, [candles]);

  const markers: ChartMarker[] = useMemo(() => {
    if (!a || !candles.length) return [];
    const last = candles[candles.length - 1];
    const out: ChartMarker[] = [];
    if (a.momentum.breakout.state !== "none" && a.momentum.breakout.level !== null) {
      out.push({
        time: last.t,
        position: a.momentum.breakout.state.includes("breakout") ? "aboveBar" : "belowBar",
        color: a.momentum.breakout.state.startsWith("genuine") ? "#ffb020" : "#ff5c5c",
        shape: a.momentum.breakout.state.includes("breakout") ? "arrowUp" : "arrowDown",
        text: a.momentum.breakout.state.replace(/-/g, " ").toUpperCase(),
      });
    }
    if (a.trade.entryZone && a.trade.direction !== "NONE") {
      out.push({
        time: last.t,
        position: a.trade.direction === "LONG" ? "belowBar" : "aboveBar",
        color: "#26d07c",
        shape: "circle",
        text: `ENTRY ${a.trade.entryZone[0].toFixed(2)}–${a.trade.entryZone[1].toFixed(2)}`,
      });
    }
    if (a.trade.target1) {
      out.push({
        time: last.t,
        position: "aboveBar",
        color: "#5aa9e6",
        shape: "square",
        text: `T1 ${a.trade.target1.toFixed(2)}`,
      });
    }
    return out;
  }, [a, candles]);

  const scoreSeries = useMemo(
    () =>
      (data?.scoreSeries ?? []).map((s) => ({ t: Math.floor(new Date(s.ts).getTime() / 1000), bull: s.bull, bear: s.bear })),
    [data],
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" role="dialog" aria-label={`${symbol} analysis`}>
      <button className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <aside className="relative w-full max-w-full md:max-w-[1180px] h-full overflow-y-auto overscroll-contain bg-[var(--color-ink)] border-l-0 md:border-l border-[var(--color-line2)] shadow-2xl">
        <div className="sticky top-0 z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-4 px-3 sm:px-4 py-2 sm:py-3 border-b border-[var(--color-line)] bg-[#0a0c0f]">
          <div className="flex items-baseline gap-2 sm:gap-3 flex-wrap min-w-0">
            <span className="text-[16px] sm:text-[18px] font-semibold amber">{a?.meta.symbol ?? symbol}</span>
            <span className="lbl truncate max-w-[140px] sm:max-w-none">{a?.meta.name}</span>
            {a?.stale ? <Chip tone="warn">STALE</Chip> : <Chip tone="live">LIVE</Chip>}
          </div>
          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-between sm:justify-end">
            {a ? (
              <span className="text-[16px] sm:text-[20px] font-semibold">
                {fmtNum(a.price)} <span className={a.changePct >= 0 ? "bull" : "bear"}>{fmtPct(a.changePct)}</span>
              </span>
            ) : null}
            <button className="btn !min-h-[40px] sm:!min-h-0" onClick={onClose}>
              ✕ CLOSE
            </button>
          </div>
        </div>

        {err ? <Empty title="DATA UNAVAILABLE" reason={err} /> : null}
        {!data && !err ? (
          <div className="p-4 grid gap-3" aria-busy="true" aria-live="polite">
            <div className="lbl">LOADING {symbol} — CHART SKELETON</div>
            <div className="field p-3 grid gap-2">
              <div className="h-[240px] md:h-[360px] w-full bg-[#0d1014] flex items-end gap-[3px] px-2 pb-2">
                {Array.from({ length: 42 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-[#171b21]"
                    style={{ height: `${28 + ((i * 37) % 60)}%`, animation: `pulseBar 1.1s ease-in-out ${i * 18}ms infinite alternate` }}
                  />
                ))}
              </div>
              <div className="h-[6px] w-1/3 bg-[#171b21]" />
              <div className="h-[6px] w-1/2 bg-[#14181d]" />
            </div>
            <style>{`@keyframes pulseBar{from{opacity:.35}to{opacity:.9}}`}</style>
          </div>
        ) : null}

        {a && data ? (
          <div className="p-3 grid gap-3">
            {/* headline scores */}
            <div className="grid grid-cols-2 md:grid-cols-6">
              <Stat label="Bull score" value={a.scores.bull} tone={a.scores.bull >= 65 ? "bull" : "warn"} sub={<Meter value={a.scores.bull} tone="bull" />} />
              <Stat label="Bear score" value={a.scores.bear} tone={a.scores.bear >= 65 ? "bear" : "warn"} sub={<Meter value={a.scores.bear} tone="bear" />} />
              <Stat label="Confidence grade" value={a.scores.grade.split("—")[0].trim()} sub={a.scores.grade.split("—")[1]?.trim()} />
              <Stat label="Momentum stage" value={a.momentum.stage.replace("STAGE ", "").split(":")[0]} tone="amber" sub={a.momentum.stage.split(": ")[1]} />
              <Stat label="Futures positioning" value={<Tone value={a.futures.positioning} />} sub={`5m↔15m ${a.futures.consistency}`} />
              <Stat
                label="Data freshness"
                value={fmtAge(a.freshnessMs)}
                tone={a.stale ? "warn" : "bull"}
                sub={a.stale ? "STALE — no live confirmation" : "fresh"}
              />
            </div>

            {/* chart */}
            <Field
              title="PRICE CHART · HISTORICAL + LIVE"
              right={
                <span className="flex gap-1.5 flex-wrap items-center">
                  {/* ── Range selector ── */}
                  {RANGES.map((r) => (
                    <button
                      key={r}
                      className="btn !py-1 !px-2"
                      style={range === r ? { color: "var(--color-amber)", borderColor: "var(--color-amberdim)" } : undefined}
                      onClick={() => setRange(r)}
                    >
                      {r}
                    </button>
                  ))}
                  <span className="w-px h-4 bg-[var(--color-line2)] mx-1" />
                  {/* ── Interval selector ── */}
                  {INTERVALS.map((iv) => (
                    <button
                      key={iv.value}
                      className="btn !py-1 !px-2"
                      style={interval === iv.value ? { color: "var(--color-amber)", borderColor: "var(--color-amberdim)" } : undefined}
                      onClick={() => setInterval(iv.value)}
                    >
                      {iv.label}
                    </button>
                  ))}
                  {(["ema", "bb", "vwap", "zones", "vol"] as const).map((k) => (
                    <button
                      key={k}
                      className="btn !py-1 !px-2"
                      style={toggles[k] ? { color: "var(--color-amber)", borderColor: "var(--color-amberdim)" } : undefined}
                      onClick={() => setToggles((t) => ({ ...t, [k]: !t[k] }))}
                    >
                      {k.toUpperCase()}
                    </button>
                  ))}
                </span>
              }
            >
              <PriceChart
                candles={candles}
                overlay={overlay}
                zones={a.sr.structural.concat(a.sr.oiOnly)}
                markers={markers}
                showVolume={toggles.vol}
                showEma={toggles.ema}
                showBb={toggles.bb}
                showVwap={toggles.vwap}
                showZones={toggles.zones}
                fitKey={`${symbol}-${range}-${interval}`}
              />
              {/* chart metadata */}
              <div className="px-3 py-2 border-t border-[var(--color-line)] flex flex-wrap items-center gap-3 text-[10.5px] mute font-[var(--font-sans)]">
                {chartLoading ? (
                  <span className="amber">Loading {range} · {interval === "day" ? "daily" : interval === "week" ? "weekly" : `${interval}m`} candles…</span>
                ) : chartMeta ? (
                  <>
                    <span>{chartMeta.total.toLocaleString()} candles</span>
                    <span>·</span>
                    <span>{chartMeta.first?.slice(0, 10)} → {chartMeta.last?.slice(0, 10)}</span>
                    <span>·</span>
                    <span>{chartMeta.ms}ms{chartMeta.cached ? " (cached)" : ""}</span>
                    {chartMeta.segments.length > 1 ? (
                      <span>· {chartMeta.segments.filter((s) => s.status === "ok").length}/{chartMeta.segments.length} segments loaded</span>
                    ) : null}
                    {chartMeta.segments.some((s) => s.status === "failed") ? (
                      <span className="warn">· {chartMeta.segments.filter((s) => s.status === "failed").length} segment(s) failed</span>
                    ) : null}
                  </>
                ) : (
                  <span>{candles.length} candles (scan data)</span>
                )}
              </div>
            </Field>

            {/* explanation */}
            <div className="grid md:grid-cols-2 gap-3">
              <Field title={`WHY IS ${a.meta.symbol} ${a.underlying.bias.toUpperCase()}?`} ticked>
                <Answer
                  q="UNDERLYING EVIDENCE"
                  a={`${a.underlying.bullMet}/${a.underlying.conditions.bullish.length} bullish and ${a.underlying.bearMet}/${a.underlying.conditions.bearish.length} bearish conditions met. Structure: ${a.underlying.structure.trend} (${a.underlying.structure.hh ? "HH " : ""}${a.underlying.structure.hl ? "HL " : ""}${a.underlying.structure.lh ? "LH " : ""}${a.underlying.structure.ll ? "LL" : ""}). VWAP ${a.underlying.vwap === null ? "n/a" : fmtNum(a.underlying.vwap)}, ATR ${a.underlying.atrPct === null ? "n/a" : `${a.underlying.atrPct.toFixed(2)}%`}, relative volume ${a.underlying.relVol === null ? "n/a" : `${a.underlying.relVol.toFixed(2)}×`}.`}
                />
                <Answer
                  q="WHY IS THE MOMENTUM GENUINE OR WEAK?"
                  a={
                    (a.momentum.genuine.length ? `GENUINE — ${a.momentum.genuine.join("; ")}. ` : "") +
                    (a.momentum.weak.length ? `WEAK — ${a.momentum.weak.join("; ")}.` : "") +
                    (!a.momentum.genuine.length && !a.momentum.weak.length ? "Neither column has evidence yet — classification pending more bars." : "")
                  }
                  tone={a.momentum.genuine.length > a.momentum.weak.length ? "bull" : "warn"}
                />
                <Answer
                  q="WHAT IS THE FUTURES POSITIONING?"
                  a={`${a.futures.positioning}. ${a.futures.confirmations.join("; ") || "No confirmations."} ${
                    a.futures.warnings.length ? `Warnings: ${a.futures.warnings.join("; ")}.` : ""
                  } OI session Δ ${fmtCompact(a.futures.oiChgSession)} (${a.futures.relOiPct === null ? "n/a" : `${a.futures.relOiPct.toFixed(2)}%`}).`}
                />
                <Answer
                  q="WHERE IS THE NEXT SUPPORT / RESISTANCE?"
                  a={`Support ${a.sr.primarySupport ? `${fmtNum(a.sr.primarySupport.price)} (${a.sr.primarySupport.label}, strength ${a.sr.primarySupport.strength})` : "none detected"} · Resistance ${
                    a.sr.primaryResistance ? `${fmtNum(a.sr.primaryResistance.price)} (${a.sr.primaryResistance.label}, strength ${a.sr.primaryResistance.strength})` : "none detected"
                  }. Volume profile POC ${a.sr.volumeProfile.poc === null ? "n/a" : fmtNum(a.sr.volumeProfile.poc)}, VAH ${
                    a.sr.volumeProfile.vah === null ? "n/a" : fmtNum(a.sr.volumeProfile.vah)
                  }, VAL ${a.sr.volumeProfile.val === null ? "n/a" : fmtNum(a.sr.volumeProfile.val)}.`}
                />
                <Answer
                  q="WHICH OPTION STRIKE IS MOST SUITABLE?"
                  a={
                    (a.options.bestCE
                      ? `BEST CE ${a.options.bestCE.strike} (score ${a.options.bestCE.score}/100, ${a.options.bestCE.liquidity} liquidity, Δ ${a.options.bestCE.greeks.delta?.toFixed(2) ?? "n/a"}, IV ${(a.options.bestCE.greeks.iv ?? 0).toFixed(1)}). ${a.options.bestCE.reasons.join("; ")}.`
                      : "NO SUITABLE CONTRACT for CE — no strike passed liquidity and risk filters.") +
                    " │ " +
                    (a.options.bestPE
                      ? `BEST PE ${a.options.bestPE.strike} (score ${a.options.bestPE.score}/100, ${a.options.bestPE.liquidity} liquidity).`
                      : "NO SUITABLE CONTRACT for PE.")
                  }
                />
                <Answer
                  q="WHAT INVALIDATES THIS SETUP?"
                  a={
                    a.trade.invalidation
                      ? `A finalized 5-minute close ${a.trade.direction === "LONG" ? "below" : "above"} ${fmtNum(
                          a.trade.invalidation,
                        )}. ${a.trade.confirmation} Reversal risk: ${a.trade.reversalRisk.toUpperCase()}.`
                      : "No entry setup — nothing to invalidate while the classification is NO TRADE."
                  }
                  tone="warn"
                />
                {a.momentum.divergence.length || a.momentum.alignment15m === "countertrend" ? (
                  <Answer
                    q="CONFLICTS & WARNINGS"
                    a={[...a.momentum.divergence, a.momentum.alignment15m === "countertrend" ? a.momentum.alignmentNote : ""].filter(Boolean).join(" · ")}
                    tone="warn"
                  />
                ) : null}
              </Field>

              <div className="grid gap-3 content-start">
                <Field title="FUTURES POSITIONING · CONFIRMATIONS" right={<Chip>{a.futures.relVol === null ? "RVOL n/a" : `${a.futures.relVol.toFixed(2)}×`}</Chip>}>
                  <div className="p-3 grid gap-2 text-[12px]">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <div className="lbl mb-1">Δ 5m</div>
                        <div className={a.futures.chg5Pct !== null && a.futures.chg5Pct >= 0 ? "bull" : "bear"}>{fmtPct(a.futures.chg5Pct)}</div>
                      </div>
                      <div>
                        <div className="lbl mb-1">Δ 15m</div>
                        <div className={a.futures.chg15Pct !== null && a.futures.chg15Pct >= 0 ? "bull" : "bear"}>{fmtPct(a.futures.chg15Pct)}</div>
                      </div>
                      <div>
                        <div className="lbl mb-1">OI Δ 5m</div>
                        <div className="amber">{fmtCompact(a.futures.oiChg5)}</div>
                      </div>
                    </div>
                    <ul className="grid gap-1 text-[11.5px] font-[var(--font-sans)] text-[#c9c3b6]">
                      {a.futures.confirmations.map((c) => (
                        <li key={c} className="flex gap-2">
                          <span className="bull">+</span> {c}
                        </li>
                      ))}
                      {a.futures.warnings.map((c) => (
                        <li key={c} className="flex gap-2 warn">
                          <span>!</span> {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                </Field>

                <Field
                  title="STRIKE-WISE OI MOMENTUM"
                  right={
                    <Chip tone={a.oiMomentum.available ? (a.oiMomentum.direction > 0 ? "live" : a.oiMomentum.direction < 0 ? "warn" : "") : "warn"}>
                      {a.oiMomentum.available
                        ? `${a.oiMomentum.score}/100 · ${a.oiMomentum.direction > 0 ? "BULLISH OI" : a.oiMomentum.direction < 0 ? "BEARISH OI" : "NEUTRAL"}`
                        : "N/A"}
                    </Chip>
                  }
                >
                  <div className="p-3 grid gap-2.5 text-[11.5px]">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div>
                        <div className="lbl mb-1">ATM CE OI · SESSION</div>
                        <div className="amber">{a.oiMomentum.ceSession?.toLocaleString("en-IN") ?? "N/A"}</div>
                        <div className="mute">5m {a.oiMomentum.ce5m?.toLocaleString("en-IN") ?? "N/A"} · 15m {a.oiMomentum.ce15m?.toLocaleString("en-IN") ?? "N/A"}</div>
                      </div>
                      <div>
                        <div className="lbl mb-1">ATM PE OI · SESSION</div>
                        <div className="amber">{a.oiMomentum.peSession?.toLocaleString("en-IN") ?? "N/A"}</div>
                        <div className="mute">5m {a.oiMomentum.pe5m?.toLocaleString("en-IN") ?? "N/A"} · 15m {a.oiMomentum.pe15m?.toLocaleString("en-IN") ?? "N/A"}</div>
                      </div>
                      <div>
                        <div className="lbl mb-1">AGREEMENT</div>
                        <div className="mute">windows {a.oiMomentum.windowAgreement}</div>
                        <div className="mute">futures {a.oiMomentum.futuresAgreement}</div>
                        <div className="mute">price {a.oiMomentum.priceAgreement}</div>
                      </div>
                      <div>
                        <div className="lbl mb-1">ATM STRIKE</div>
                        <div>{a.oiMomentum.atmStrike !== null ? a.oiMomentum.atmStrike.toFixed(0) : "N/A"}</div>
                        <div className="mute">{a.oiMomentum.labels.length} pattern(s)</div>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-2">
                      <div>
                        <div className="lbl mb-1">BULLISH OI EVIDENCE</div>
                        <ul className="bull grid gap-1 font-[var(--font-sans)]">
                          {a.oiMomentum.bullish.length ? a.oiMomentum.bullish.map((x) => <li key={x}>+ {x}</li>) : <li className="mute">none</li>}
                        </ul>
                      </div>
                      <div>
                        <div className="lbl mb-1">BEARISH OI EVIDENCE</div>
                        <ul className="bear grid gap-1 font-[var(--font-sans)]">
                          {a.oiMomentum.bearish.length ? a.oiMomentum.bearish.map((x) => <li key={x}>− {x}</li>) : <li className="mute">none</li>}
                        </ul>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 border-t border-[var(--color-line)] pt-2">
                      <div>
                        <div className="lbl mb-1">OI SCORE</div>
                        <Bar pct={a.oiMomentum.score} tone={a.oiMomentum.direction >= 0 ? "bull" : "bear"} />
                      </div>
                      <div className="text-[10.5px] mute col-span-2 font-[var(--font-sans)]">{a.oiMomentum.note}</div>
                    </div>

                    {a.oiMomentum.futuresAgreement === "divergent" || a.oiMomentum.priceAgreement === "divergent" ? (
                      <div className="warn text-[11px] font-[var(--font-sans)]">
                        ⚠ OI evidence diverges from {a.oiMomentum.priceAgreement === "divergent" ? "price action" : "futures positioning"} —
                        treated as a contradiction penalty in the score, not as confirmation.
                      </div>
                    ) : null}
                  </div>
                </Field>

                <Field title="BUYER / SELLER CONTROL" right={<Chip>{a.flow.confidence} confidence</Chip>}>
                  <div className="p-3 grid gap-2">
                    <div className="flex justify-between text-[12px]">
                      <span className="bull">BUYERS {a.flow.buyerDominance}%</span>
                      <span className="bear">SELLERS {a.flow.sellerDominance}%</span>
                    </div>
                    <div className="meter meter--bull">
                      <span style={{ width: `${a.flow.buyerDominance}%` }} />
                    </div>
                    <div className="text-[11.5px] font-[var(--font-sans)] text-[#c9c3b6] leading-snug">{a.flow.confidenceNote}</div>
                    <ul className="text-[11.5px] grid gap-1">
                      {a.flow.events.map((e) => (
                        <li key={e} className="mute">
                          ▸ {e}
                        </li>
                      ))}
                    </ul>
                  </div>
                </Field>

                <Field title="TRADE SETUP" right={<Chip tone={a.trade.direction === "NONE" ? "" : "warn"}>{a.trade.status}</Chip>}>
                  <div className="p-3 grid gap-2 text-[12px]">
                    {a.trade.direction === "NONE" ? (
                      <div className="bear">NO TRADE — {a.trade.reasonsAgainst.join(" · ")}</div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <div>
                            <div className="lbl mb-1">DIRECTION</div>
                            <div className={a.trade.direction === "LONG" ? "bull" : "bear"}>{a.trade.direction}</div>
                          </div>
                          <div>
                            <div className="lbl mb-1">ENTRY ZONE</div>
                            <div>{a.trade.entryZone ? `${fmtNum(a.trade.entryZone[0])}–${fmtNum(a.trade.entryZone[1])}` : "—"}</div>
                          </div>
                          <div>
                            <div className="lbl mb-1">INVALIDATION</div>
                            <div className="warn">{a.trade.invalidation ? fmtNum(a.trade.invalidation) : "—"}</div>
                          </div>
                          <div>
                            <div className="lbl mb-1">R : R</div>
                            <div className="amber">{a.trade.riskReward ?? "—"}</div>
                          </div>
                          <div>
                            <div className="lbl mb-1">TARGET 1</div>
                            <div className="bull">{a.trade.target1 ? fmtNum(a.trade.target1) : "—"}</div>
                          </div>
                          <div>
                            <div className="lbl mb-1">TARGET 2</div>
                            <div className="bull">{a.trade.target2 ? fmtNum(a.trade.target2) : "—"}</div>
                          </div>
                          <div className="col-span-2">
                            <div className="lbl mb-1">REVERSAL RISK</div>
                            <div className={a.trade.reversalRisk === "high" ? "bear" : a.trade.reversalRisk === "moderate" ? "warn" : "bull"}>
                              {a.trade.reversalRisk.toUpperCase()}
                            </div>
                          </div>
                        </div>
                        <div className="text-[11.5px] font-[var(--font-sans)]">
                          <div className="lbl mb-1">REASONS FOR</div>
                          <ul className="grid gap-1 bull">
                            {a.trade.reasonsFor.map((r) => (
                              <li key={r}>+ {r}</li>
                            ))}
                          </ul>
                          <div className="lbl mt-2 mb-1">REASONS AGAINST</div>
                          <ul className="grid gap-1 warn">
                            {a.trade.reasonsAgainst.map((r) => (
                              <li key={r}>− {r}</li>
                            ))}
                          </ul>
                        </div>
                      </>
                    )}
                  </div>
                </Field>
              </div>
            </div>

            {/* six-strike comparison */}
            <Field title={`SIX-STRIKE COMPARISON · ATM ${a.options.atm} · EXPIRY ${a.options.expiry}`} right={<Chip>{a.options.alignment.toUpperCase()}</Chip>}>
              <div className="tbl-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="nosort">STRIKE</th>
                      <th className="nosort">CE ₹</th>
                      <th className="nosort">CE Δ%</th>
                      <th className="nosort">CE Δ</th>
                      <th className="nosort">CE IV</th>
                      <th className="nosort">CE OI 5m</th>
                      <th className="nosort">CE SPRD</th>
                      <th className="nosort">PE ₹</th>
                      <th className="nosort">PE Δ%</th>
                      <th className="nosort">PE Δ</th>
                      <th className="nosort">PE IV</th>
                      <th className="nosort">PE OI 5m</th>
                      <th className="nosort">PE SPRD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.options.strikes.map((r) => (
                      <tr key={r.strike} className={r.atm ? "selected" : ""}>
                        <td className={r.atm ? "amber font-semibold" : ""}>
                          {fmtNum(r.strike, 0)}
                          {r.atm ? " · ATM" : ""}
                        </td>
                        <td>{fmtNum(r.ce?.premium)}</td>
                        <td className={(r.ce?.changePct ?? 0) >= 0 ? "bull" : "bear"}>{fmtPct(r.ce?.changePct ?? null)}</td>
                        <td>{r.ce?.contract.greeks.delta?.toFixed(2) ?? "—"}</td>
                        <td>{r.ce?.contract.greeks.iv ? `${(r.ce.contract.greeks.iv * 100).toFixed(1)}%` : "—"}</td>
                        <td className="amber">{fmtCompact(r.ce?.oiChg5 ?? null)}</td>
                        <td className={(r.ce?.spreadPct ?? 99) > 3 ? "warn" : "mute"}>{r.ce?.spreadPct?.toFixed(2) ?? "—"}%</td>
                        <td>{fmtNum(r.pe?.premium)}</td>
                        <td className={(r.pe?.changePct ?? 0) >= 0 ? "bull" : "bear"}>{fmtPct(r.pe?.changePct ?? null)}</td>
                        <td>{r.pe?.contract.greeks.delta?.toFixed(2) ?? "—"}</td>
                        <td>{r.pe?.contract.greeks.iv ? `${(r.pe.contract.greeks.iv * 100).toFixed(1)}%` : "—"}</td>
                        <td className="amber">{fmtCompact(r.pe?.oiChg5 ?? null)}</td>
                        <td className={(r.pe?.spreadPct ?? 99) > 3 ? "warn" : "mute"}>{r.pe?.spreadPct?.toFixed(2) ?? "—"}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-3 py-2 text-[11px] mute border-t border-[var(--color-line)]">
                Greeks source: {data.options[0] ? "see per-contract flag" : "n/a"} · {a.options.alignmentNote}
              </div>
            </Field>

            {/* OI ladder */}
            <Field title="OI STRIKE INTELLIGENCE · FOUR WINDOWS" ticked>
              <OiLadder rows={a.options.strikes} atm={a.options.atm} focusedStrike={focus} onFocus={setFocus} />
            </Field>

            {/* S/R */}
            <div className="grid md:grid-cols-2 gap-3">
              <Field title="DYNAMIC SUPPORT / RESISTANCE">
                <div className="p-3 grid gap-2 text-[12px]">
                  <ZoneRow zone={a.sr.primarySupport} label="PRIMARY SUPPORT" />
                  <ZoneRow zone={a.sr.primaryResistance} label="PRIMARY RESISTANCE" />
                  <ZoneRow zone={a.sr.secondarySupport} label="SECONDARY SUPPORT" />
                  <ZoneRow zone={a.sr.secondaryResistance} label="SECONDARY RESISTANCE" />
                  <div className="lbl mt-1">STRUCTURAL ZONES ({a.sr.structural.length})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {a.sr.structural.slice(0, 8).map((z) => (
                      <span key={z.id} className="chip">
                        {z.side === "support" ? "S" : "R"} {fmtNum(z.price)} · {z.strength}
                      </span>
                    ))}
                  </div>
                  <div className="lbl mt-1">OI-ONLY ZONES ({a.sr.oiOnly.length}) — dashed, not price-confirmed</div>
                  <div className="flex flex-wrap gap-1.5">
                    {a.sr.oiOnly.map((z) => (
                      <span key={z.id} className="chip" style={{ borderStyle: "dashed" }}>
                        {z.side === "support" ? "S" : "R"} {fmtNum(z.price)} · {z.strength}
                      </span>
                    ))}
                  </div>
                  {a.sr.notes.map((n) => (
                    <div key={n} className="text-[11px] warn">
                      ! {n}
                    </div>
                  ))}
                </div>
              </Field>

              <Field title="MOMENTUM QUALITY & STAGE">
                <div className="p-3 grid gap-2 text-[12px]">
                  <div className="flex items-center gap-2">
                    <Chip tone="warn">{a.momentum.quality}</Chip>
                    <Chip>{a.momentum.stage}</Chip>
                  </div>
                  <div className="grid gap-1">
                    <span className="lbl">GENUINE EVIDENCE</span>
                    <ul className="bull grid gap-1 font-[var(--font-sans)]">
                      {a.momentum.genuine.length ? a.momentum.genuine.map((g) => <li key={g}>+ {g}</li>) : <li className="mute">none</li>}
                    </ul>
                    <span className="lbl mt-1">WEAK / RISK EVIDENCE</span>
                    <ul className="warn grid gap-1 font-[var(--font-sans)]">
                      {a.momentum.weak.length ? a.momentum.weak.map((g) => <li key={g}>− {g}</li>) : <li className="mute">none</li>}
                    </ul>
                    <span className="lbl mt-1">DIVERGENCES</span>
                    <ul className="bear grid gap-1 font-[var(--font-sans)]">
                      {a.momentum.divergence.length ? a.momentum.divergence.map((g) => <li key={g}>! {g}</li>) : <li className="mute">none</li>}
                    </ul>
                  </div>
                  <div className="text-[11.5px] mute font-[var(--font-sans)]">{a.momentum.alignmentNote}</div>
                </div>
              </Field>
            </div>

            {/* score components + history */}
            <div className="grid md:grid-cols-2 gap-3">
              <Field title="UNIFIED SCORE BREAKDOWN · WEIGHTS SUM 100" right={<Chip>heuristic, not probability</Chip>}>
                <div className="p-3 grid gap-2.5">
                  {a.scores.components.map((c) => (
                    <div key={c.key}>
                      <div className="flex justify-between text-[11.5px] gap-3">
                        <span>{c.label}</span>
                        <span className="mute">w{c.weight}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 items-center mt-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] bull w-6">B</span>
                          <Bar pct={(c.bull ?? 0) * 100} tone="bull" />
                          <span className="text-[10px] w-7 text-right">{c.bull === null ? "—" : Math.round(c.bull * 100)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] bear w-6">S</span>
                          <Bar pct={(c.bear ?? 0) * 100} tone="bear" />
                          <span className="text-[10px] w-7 text-right">{c.bear === null ? "—" : Math.round(c.bear * 100)}</span>
                        </div>
                      </div>
                      <div className="text-[10.5px] mute mt-1 leading-snug font-[var(--font-sans)]">{c.reason}</div>
                    </div>
                  ))}
                  <div className="text-[11px] mute border-t border-[var(--color-line)] pt-2">
                    confirmed {a.scores.confirmed} · conflicting {a.scores.conflicting} · missing {a.scores.missing} · freshness{" "}
                    {fmtAge(a.scores.freshnessMs)}
                  </div>
                </div>
              </Field>

              <Field title="MOMENTUM SCORE HISTORY" right={<Chip>persisted in postgres</Chip>}>
                {scoreSeries.length > 1 ? (
                  <ScoreChart data={scoreSeries} />
                ) : (
                  <Empty title="NO SCORE HISTORY YET" reason="The first scan seeds the score history table; re-scan to accumulate evolution points." />
                )}
                <div className="px-3 py-2 text-[11px] mute border-t border-[var(--color-line)] grid gap-1">
                  {data.notes.map((n) => (
                    <span key={n}>▸ {n}</span>
                  ))}
                </div>
              </Field>
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function ZoneRow({ zone, label }: { zone: Zone | null; label: string }) {
  if (!zone)
    return (
      <div className="flex justify-between">
        <span className="lbl">{label}</span>
        <span className="mute">none detected</span>
      </div>
    );
  return (
    <div className="flex justify-between gap-3 border-b border-[#111418] pb-1.5">
      <span className="lbl">{label}</span>
      <span className="flex items-center gap-2">
        <span className="amber">{fmtNum(zone.price)}</span>
        <span className={zone.side === "support" ? "bull" : "bear"}>{zone.label}</span>
        <span className="mute">{zone.strength}/100</span>
        <span className="mute">{zone.kind}</span>
      </span>
    </div>
  );
}
