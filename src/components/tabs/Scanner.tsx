"use client";

import { useMemo, useState } from "react";
import type { ScanResult, SymbolAnalysis, StrikeRow } from "@/lib/types";
import { Chip, Empty, Field, Section } from "../ui";
import { ScanTable } from "../ScanTable";

export interface FilterDef {
  key: string;
  label: string;
  group: string;
  test: (a: SymbolAnalysis) => boolean;
  /** plain-language proof of why the stock qualified */
  evidence: (a: SymbolAnalysis) => string;
}

const atmRow = (a: SymbolAnalysis): StrikeRow | null =>
  a.options.strikes.find((r) => r.atm) ?? (a.options.strikes.length ? a.options.strikes[Math.floor(a.options.strikes.length / 2)] : null);

const f = (a: SymbolAnalysis) => a.futures;
const oi = (a: SymbolAnalysis) => a.oiMomentum;
const rel = (v: number | null, d = 2) => (v === null ? "n/a" : `${v.toFixed(d)}`);

export const FILTERS: FilterDef[] = [
  // ── price / directional ────────────────────────────────────────────────
  {
    key: "strong-bull",
    label: "STRONG BULLISH",
    group: "Direction",
    test: (a) => a.scores.bull >= 65 && a.scores.bull > a.scores.bear,
    evidence: (a) => `bull ${a.scores.bull} vs bear ${a.scores.bear} · ${a.scores.grade} · ${a.momentum.quality}`,
  },
  {
    key: "bull",
    label: "BULLISH MOMENTUM",
    group: "Direction",
    test: (a) => a.scores.bull >= 50 && a.scores.bull > a.scores.bear,
    evidence: (a) => `bull ${a.scores.bull} > bear ${a.scores.bear} · structure ${a.underlying.structure.trend} · VWAP ${a.underlying.vwap !== null && a.price > a.underlying.vwap ? "above" : "below"}`,
  },
  {
    key: "strong-bear",
    label: "STRONG BEARISH",
    group: "Direction",
    test: (a) => a.scores.bear >= 65 && a.scores.bear > a.scores.bull,
    evidence: (a) => `bear ${a.scores.bear} vs bull ${a.scores.bull} · ${a.scores.grade} · ${a.momentum.quality}`,
  },
  {
    key: "bear",
    label: "BEARISH MOMENTUM",
    group: "Direction",
    test: (a) => a.scores.bear >= 50 && a.scores.bear > a.scores.bull,
    evidence: (a) => `bear ${a.scores.bear} > bull ${a.scores.bull} · structure ${a.underlying.structure.trend} · VWAP ${a.underlying.vwap !== null && a.price < a.underlying.vwap ? "below" : "above"}`,
  },
  // ── futures positioning (futures price Δ + futures OI Δ only) ──────────
  {
    key: "long-build",
    label: "LONG BUILD-UP",
    group: "Futures",
    test: (a) => f(a).positioning === "LONG BUILD-UP",
    evidence: (a) =>
      `futures price Δ5m ${fmtPct(f(a).chg5Pct)} with futures OI Δ5m ${fmtCompact(f(a).oiChg5)} (session ${fmtCompact(f(a).oiChgSession)}) — ${f(a).confirmations[0] ?? ""}`,
  },
  {
    key: "short-build",
    label: "SHORT BUILD-UP",
    group: "Futures",
    test: (a) => f(a).positioning === "SHORT BUILD-UP",
    evidence: (a) =>
      `futures price Δ5m ${fmtPct(f(a).chg5Pct)} with futures OI Δ5m ${fmtCompact(f(a).oiChg5)} — ${f(a).confirmations[0] ?? ""}`,
  },
  {
    key: "short-cover",
    label: "SHORT COVERING",
    group: "Futures",
    test: (a) => f(a).positioning === "SHORT COVERING",
    evidence: (a) =>
      `futures price up ${fmtPct(f(a).chg5Pct)} while OI down ${fmtCompact(f(a).oiChg5)} — position closing, not fresh longs (${f(a).warnings[0] ?? "no warning"})`,
  },
  {
    key: "long-unwind",
    label: "LONG UNWINDING",
    group: "Futures",
    test: (a) => f(a).positioning === "LONG UNWINDING",
    evidence: (a) =>
      `futures price down ${fmtPct(f(a).chg5Pct)} while OI down ${fmtCompact(f(a).oiChg5)} — longs closing, not fresh shorts`,
  },
  // ── breakout ───────────────────────────────────────────────────────────
  {
    key: "volume-breakout",
    label: "VOLUME BREAKOUT",
    group: "Breakout",
    test: (a) => a.underlying.relVol !== null && a.underlying.relVol >= 1.5 && (a.underlying.structure.breakout || Math.abs(a.changePct) >= 0.5),
    evidence: (a) =>
      `volume ${rel(a.underlying.relVol)}× the 20-bar mean (comparable baseline, current bar excluded) with price ${fmtPct(a.changePct)} and breakout=${a.underlying.structure.breakout}`,
  },
  {
    key: "oi-breakout",
    label: "OI BREAKOUT",
    group: "Breakout",
    test: (a) => {
      const fr = f(a);
      return (
        fr.relOiPct !== null &&
        Math.abs(fr.relOiPct) >= 8 &&
        fr.chgSessionPct !== null &&
        Math.abs(fr.chgSessionPct) >= 0.4
      );
    },
    evidence: (a) =>
      `OI EXPANSION ${f(a).relOiPct?.toFixed(2)}% of session baseline (not absolute OI) with futures price ${fmtPct(f(a).chgSessionPct)} — total OI ${fmtCompact(f(a).oiTotal)}`,
  },
  {
    key: "genuine-bo",
    label: "BULLISH BREAKOUT",
    group: "Breakout",
    test: (a) => a.momentum.breakout.state === "genuine-breakout",
    evidence: (a) => a.momentum.breakout.detail,
  },
  {
    key: "genuine-bd",
    label: "BEARISH BREAKDOWN",
    group: "Breakout",
    test: (a) => a.momentum.breakout.state === "genuine-breakdown",
    evidence: (a) => a.momentum.breakout.detail,
  },
  {
    key: "fake-bo",
    label: "FAKE BREAKOUT RISK",
    group: "Breakout",
    test: (a) => a.momentum.breakout.state === "false-breakout-risk",
    evidence: (a) => a.momentum.breakout.detail,
  },
  {
    key: "fake-bd",
    label: "FAKE BREAKDOWN RISK",
    group: "Breakout",
    test: (a) => a.momentum.breakout.state === "false-breakdown-risk",
    evidence: (a) => a.momentum.breakout.detail,
  },
  // ── participation / control ────────────────────────────────────────────
  {
    key: "buyer-dominant",
    label: "BUYER DOMINANT",
    group: "Participation",
    test: (a) => a.flow.label === "BUYER DOMINANT",
    evidence: (a) =>
      `buyers ${a.flow.buyerDominance}% vs sellers ${a.flow.sellerDominance}% (${a.flow.confidence} confidence — ${a.flow.confidenceNote.split(":")[0]}; aggressor prints unavailable, so this is INFERRED, not executed buy volume)`,
  },
  {
    key: "seller-dominant",
    label: "SELLER DOMINANT",
    group: "Participation",
    test: (a) => a.flow.label === "SELLER DOMINANT",
    evidence: (a) =>
      `sellers ${a.flow.sellerDominance}% vs buyers ${a.flow.buyerDominance}% (${a.flow.confidence} confidence — inferred from candle direction/depth, not aggressor prints)`,
  },
  {
    key: "genuine-mom",
    label: "GENUINE MOMENTUM",
    group: "Participation",
    test: (a) => /^GENUINE/.test(a.momentum.quality),
    evidence: (a) => `${a.momentum.quality} — ${a.momentum.genuine.join("; ")}`,
  },
  {
    key: "high-relvol",
    label: "HIGH RELATIVE VOLUME",
    group: "Participation",
    test: (a) => a.underlying.relVol !== null && a.underlying.relVol >= 1.5,
    evidence: (a) => `${rel(a.underlying.relVol)}× 20-bar mean (current bar excluded from baseline) · volume trend ${a.underlying.volumeTrend ?? "n/a"}`,
  },
  // ── options / OI (writing only when premium confirms) ──────────────────
  {
    key: "call-writing",
    label: "CALL WRITING",
    group: "Options OI",
    test: (a) => {
      const r = atmRow(a);
      return !!r?.ce && (r.ce.oiChgSession ?? 0) > 0 && (r.ce.changePct ?? 0) < -0.05;
    },
    evidence: (a) => {
      const r = atmRow(a);
      return `ATM ${r?.strike} CE OI ${fmtCompact(r?.ce?.oiChgSession ?? null)} with CE premium ${fmtPct(r?.ce?.changePct ?? null)} — OI↑ + premium↓ = writing (OI↑ alone would only be OI ADDITION)`;
    },
  },
  {
    key: "call-unwinding",
    label: "CALL UNWINDING",
    group: "Options OI",
    test: (a) => {
      const r = atmRow(a);
      return !!r?.ce && (r.ce.oiChgSession ?? 0) < 0 && (r.ce.changePct ?? 0) > 0.05;
    },
    evidence: (a) => {
      const r = atmRow(a);
      return `ATM ${r?.strike} CE OI ${fmtCompact(r?.ce?.oiChgSession ?? null)} with CE premium ${fmtPct(r?.ce?.changePct ?? null)} — OI↓ + premium↑ = short covering of calls`;
    },
  },
  {
    key: "put-writing",
    label: "PUT WRITING",
    group: "Options OI",
    test: (a) => {
      const r = atmRow(a);
      return !!r?.pe && (r.pe.oiChgSession ?? 0) > 0 && (r.pe.changePct ?? 0) < -0.05;
    },
    evidence: (a) => {
      const r = atmRow(a);
      return `ATM ${r?.strike} PE OI ${fmtCompact(r?.pe?.oiChgSession ?? null)} with PE premium ${fmtPct(r?.pe?.changePct ?? null)} — OI↑ + premium↓ = put writing (support being written)`;
    },
  },
  {
    key: "put-unwinding",
    label: "PUT UNWINDING",
    group: "Options OI",
    test: (a) => {
      const r = atmRow(a);
      return !!r?.pe && (r.pe.oiChgSession ?? 0) < 0 && (r.pe.changePct ?? 0) > 0.05;
    },
    evidence: (a) => {
      const r = atmRow(a);
      return `ATM ${r?.strike} PE OI ${fmtCompact(r?.pe?.oiChgSession ?? null)} with PE premium ${fmtPct(r?.pe?.changePct ?? null)} — OI↓ + premium↑ = support being unwound`;
    },
  },
  {
    key: "oi-bull",
    label: "OI BULLISH EVIDENCE",
    group: "Options OI",
    test: (a) => oi(a).available && oi(a).direction > 0,
    evidence: (a) => `${oi(a).labels.join(", ")} — ${oi(a).bullish.join(" | ")} · ${oi(a).note}`,
  },
  {
    key: "oi-bear",
    label: "OI BEARISH EVIDENCE",
    group: "Options OI",
    test: (a) => oi(a).available && oi(a).direction < 0,
    evidence: (a) => `${oi(a).labels.join(", ")} — ${oi(a).bearish.join(" | ")} · ${oi(a).note}`,
  },
  // ── structure zones ────────────────────────────────────────────────────
  {
    key: "sup-strengthening",
    label: "SUPPORT STRENGTHENING",
    group: "Structure",
    test: (a) => !!a.sr.primarySupport && /Strengthening|Strong Support/.test(a.sr.primarySupport.label),
    evidence: (a) => `support ${a.sr.primarySupport?.price} · ${a.sr.primarySupport?.label} · strength ${a.sr.primarySupport?.strength}/100 · sources ${a.sr.primarySupport?.sources.join(", ")}`,
  },
  {
    key: "sup-weakening",
    label: "SUPPORT WEAKENING",
    group: "Structure",
    test: (a) => !!a.sr.primarySupport && /Weakening|Breakdown Risk|Weak Support/.test(a.sr.primarySupport.label),
    evidence: (a) => `support ${a.sr.primarySupport?.price} · ${a.sr.primarySupport?.label} · strength ${a.sr.primarySupport?.strength}/100`,
  },
  {
    key: "res-strengthening",
    label: "RESISTANCE STRENGTHENING",
    group: "Structure",
    test: (a) => !!a.sr.primaryResistance && /Strengthening|Strong Resistance/.test(a.sr.primaryResistance.label),
    evidence: (a) => `resistance ${a.sr.primaryResistance?.price} · ${a.sr.primaryResistance?.label} · strength ${a.sr.primaryResistance?.strength}/100`,
  },
  {
    key: "res-weakening",
    label: "RESISTANCE WEAKENING",
    group: "Structure",
    test: (a) => !!a.sr.primaryResistance && /Weakening|Breakout Risk|Weak Resistance/.test(a.sr.primaryResistance.label),
    evidence: (a) => `resistance ${a.sr.primaryResistance?.price} · ${a.sr.primaryResistance?.label} · strength ${a.sr.primaryResistance?.strength}/100`,
  },
  // ── quality / risk ─────────────────────────────────────────────────────
  {
    key: "divergence",
    label: "MOMENTUM DIVERGENCE",
    group: "Quality",
    test: (a) => a.momentum.divergence.length > 0,
    evidence: (a) => a.momentum.divergence.join(" | "),
  },
  {
    key: "exhaustion",
    label: "EXHAUSTION",
    group: "Quality",
    test: (a) => a.momentum.stage.startsWith("STAGE 3"),
    evidence: (a) => `${a.momentum.stage} — ${a.momentum.weak.join("; ") || "momentum persisting while participation fades"}`,
  },
  {
    key: "reversal",
    label: "REVERSAL DEVELOPING",
    group: "Quality",
    test: (a) => a.momentum.stage.startsWith("STAGE 4"),
    evidence: (a) => `${a.momentum.stage} — ${a.momentum.alignmentNote}`,
  },
  {
    key: "countertrend",
    label: "COUNTERTREND SETUP",
    group: "Quality",
    test: (a) => a.momentum.alignment15m === "countertrend",
    evidence: (a) => a.momentum.alignmentNote,
  },
  {
    key: "eligible",
    label: "ENTRY ELIGIBLE",
    group: "Trade",
    test: (a) => a.trade.status === "ENTRY ELIGIBLE" || a.trade.status === "ACTIVE CONTINUATION",
    evidence: (a) => `${a.trade.status} · ${a.trade.direction} · entry ${a.trade.entryZone?.map((x) => x.toFixed(2)).join("–")} · invalidation ${a.trade.invalidation?.toFixed(2)} · R:R ${a.trade.riskReward ?? "n/a"}`,
  },
];

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "n/a";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function fmtCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "n/a";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
  return `${sign}${a.toFixed(0)}`;
}

export default function Scanner({
  scan,
  onSelect,
  preset,
  title,
  logic = "and",
  require: requireFn,
}: {
  scan: ScanResult;
  onSelect: (s: string) => void;
  preset?: string[];
  title?: string;
  logic?: "and" | "or";
  require?: (a: SymbolAnalysis) => void;
}) {
  const [active, setActive] = useState<string[]>(preset ?? []);
  const [query, setQuery] = useState("");
  const visible = preset ? FILTERS.filter((f2) => preset.includes(f2.key)) : FILTERS;

  const { rows, incomplete } = useMemo(() => {
    const all = scan.analyses;
    // STRICT GATE: only COMPLETE data may enter a qualified directional scan
    const complete = all.filter((a) => a.completeness === "COMPLETE");
    const partial = all.filter((a) => a.completeness !== "COMPLETE");
    let base = active.length || requireFn ? complete : complete;
    if (requireFn) base = base.filter(requireFn);
    if (active.length) {
      const tests = FILTERS.filter((f2) => active.includes(f2.key));
      base = base.filter((a) => (logic === "or" ? tests.some((t) => t.test(a)) : tests.every((t) => t.test(a))));
    }
    const q = query.trim().toUpperCase();
    const filtered = q
      ? base.filter((a) => a.meta.symbol.includes(q) || a.meta.name.toUpperCase().includes(q))
      : base;
    return { rows: filtered, incomplete: q ? partial.filter((a) => a.meta.symbol.includes(q) || a.meta.name.toUpperCase().includes(q)) : partial };
  }, [scan.analyses, active, logic, requireFn, query]);

  const single = active.length === 1 ? FILTERS.find((x) => x.key === active[0]) : null;
  const groups = Array.from(new Set(visible.map((v) => v.group)));
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of scan.analyses) if (a.completeness === "COMPLETE") for (const t of FILTERS) if (t.test(a)) m.set(t.key, (m.get(t.key) ?? 0) + 1);
    return m;
  }, [scan.analyses]);

  const colset = [
    "symbol",
    "price",
    "chg",
    "bull",
    "bear",
    "stage",
    "pos",
    "rvol",
    "oiMomentum",
    "quality",
    "status",
    "completeness",
  ];

  return (
    <Section className="grid gap-3">
      <Field
        title={title ?? "F&O MOMENTUM SCANNER · COMPLETE DATA ONLY"}
        right={
          <span className="flex gap-2 items-center flex-wrap justify-end">
            <Chip>{rows.length} qualified</Chip>
            <Chip tone={incomplete.length ? "warn" : ""}>{incomplete.length} incomplete</Chip>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="SEARCH SYMBOL / NAME"
              className="!py-1.5 w-[170px]"
              aria-label="Search stock"
            />
            <button className="btn !py-1 !px-2" onClick={() => setActive([])} type="button">
              RESET
            </button>
          </span>
        }
      >
        <div className="p-2.5 grid gap-2.5">
          {groups.map((g) => (
            <div key={g} className="flex flex-wrap items-center gap-1.5">
              <span className="lbl w-[86px] shrink-0">{g}</span>
              {visible
                .filter((v) => v.group === g)
                .map((f2) => {
                  const on = active.includes(f2.key);
                  return (
                    <button
                      key={f2.key}
                      onClick={() => setActive((v) => (on ? v.filter((x) => x !== f2.key) : [...v, f2.key]))}
                      className="chip !py-1"
                      style={
                        on
                          ? { borderColor: "var(--color-amber)", color: "var(--color-amber)", background: "#171208" }
                          : { cursor: "pointer" }
                      }
                      title={`${counts.get(f2.key) ?? 0} COMPLETE stocks match`}
                    >
                      {f2.label} <span className="opacity-70">{counts.get(f2.key) ?? 0}</span>
                    </button>
                  );
                })}
            </div>
          ))}
          <p className="text-[11px] mute font-[var(--font-sans)]">
            {active.length
              ? `Filters ${logic === "or" ? "combine with OR" : "combine with AND"} · only COMPLETE-data stocks are eligible · correlated evidence (futures OI, option premium, strike OI) is not double-counted in scores.`
              : "Showing the complete-data universe. PARTIAL stocks are listed separately below with their exact missing components."}
          </p>
        </div>

        {single ? (
          <div className="border-t border-[var(--color-line)] px-3 py-2.5 grid gap-1.5 max-h-[220px] overflow-auto">
            <div className="lbl">WHY THESE STOCKS QUALIFIED · {single.label}</div>
            {rows.slice(0, 30).map((a) => (
              <div key={a.meta.symbol} className="text-[11.5px] font-[var(--font-sans)] flex gap-2">
                <button className="amber shrink-0" onClick={() => onSelect(a.meta.symbol)} type="button">
                  {a.meta.symbol}
                </button>
                <span className="text-[#c9c3b6]">{single.evidence(a)}</span>
              </div>
            ))}
            {!rows.length ? <span className="mute text-[11.5px]">No COMPLETE stock satisfies this condition right now.</span> : null}
          </div>
        ) : null}

        <ScanTable
          analyses={rows}
          cols={colset}
          onSelect={onSelect}
          emptyTitle="NO QUALIFYING OPPORTUNITIES"
          emptyReason="No COMPLETE-data instrument satisfied the active filters on this scan. Filters evaluate the current snapshot only; PARTIAL stocks cannot qualify by design — see the DATA INCOMPLETE section for exactly what is missing."
        />
      </Field>

      <Field
        title="DATA INCOMPLETE · NOT ELIGIBLE FOR QUALIFIED SCANS"
        right={<Chip tone={incomplete.length ? "warn" : ""}>{incomplete.length}</Chip>}
      >
        {incomplete.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th className="nosort">SYMBOL</th>
                <th className="nosort">STATE</th>
                <th className="nosort">MISSING COMPONENTS</th>
                <th className="nosort">PRICE</th>
                <th className="nosort">BULL</th>
                <th className="nosort">BEAR</th>
              </tr>
            </thead>
            <tbody>
              {incomplete.map((a) => (
                <tr key={a.meta.symbol} className="cursor-pointer" onClick={() => onSelect(a.meta.symbol)}>
                  <td>{a.meta.symbol}</td>
                  <td className="!text-left">
                    <span className={a.completeness === "INVALID" ? "bear" : "warn"}>{a.completeness}</span>
                  </td>
                  <td className="!text-left whitespace-normal font-[var(--font-sans)] text-[11px] mute">{a.missing.join(", ")}</td>
                  <td>{a.price ? a.price.toFixed(2) : "—"}</td>
                  <td className="mute">{a.scores.bull}</td>
                  <td className="mute">{a.scores.bear}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="ALL STOCKS COMPLETE" reason="Every analysed instrument passed the mandatory spot + futures + option-chain completeness gate." />
        )}
        <div className="px-3 py-2 text-[11px] mute border-t border-[var(--color-line)] font-[var(--font-sans)]">
          Missing components are reported verbatim — never zero-filled and never converted into a neutral confirmation.
        </div>
      </Field>
    </Section>
  );
}
