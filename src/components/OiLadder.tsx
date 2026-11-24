"use client";

import type { StrikeRow } from "@/lib/types";
import { fmtCompact, fmtNum } from "@/lib/math";

interface Metric {
  key: string;
  title: string;
  unit: string;
  value: (r: StrikeRow) => number | null;
  diverging: boolean;
}

/**
 * THE LADDER — four stacked CE/PE fields radiating from a live ATM row.
 * Bars diverge from the centre strike column: CE grows left, PE grows right,
 * positive and negative OI changes keep their true sign.
 */
export default function OiLadder({
  rows,
  atm,
  focusedStrike,
  onFocus,
  span = 3,
}: {
  rows: StrikeRow[];
  atm: number;
  focusedStrike?: number | null;
  onFocus?: (strike: number) => void;
  /** strikes on each side of ATM, taken from the instrument's actual spacing */
  span?: number;
}) {
  const spacing = (() => {
    const sorted = rows.map((r) => r.strike).sort((a, b) => a - b);
    if (sorted.length < 2) return 0;
    const diffs = sorted.slice(1).map((s, i) => s - sorted[i]).filter((d) => d > 0);
    if (!diffs.length) return 0;
    return Math.min(...diffs);
  })();
  const window = spacing
    ? rows.filter((r) => Math.abs(r.strike - atm) <= spacing * span + 1e-6)
    : rows;
  const ordered = (window.length ? window : rows).slice().sort((a, b) => a.strike - b.strike);

  const metrics: Metric[] = [
    { key: "c5", title: "01 · 5-MINUTE ΔOI", unit: "contracts", value: (r) => r.ce?.oiChg5 ?? null, diverging: true },
    { key: "c15", title: "02 · 15-MINUTE ΔOI", unit: "contracts", value: (r) => r.ce?.oiChg15 ?? null, diverging: true },
    { key: "cs", title: "03 · SESSION ΔOI", unit: "contracts", value: (r) => r.ce?.oiChgSession ?? null, diverging: true },
    { key: "tot", title: "04 · TOTAL OI", unit: "open contracts", value: (r) => r.ce?.oiTotal ?? null, diverging: false },
  ];

  return (
    <div className="flex flex-col gap-px bg-[var(--color-line)]">
      {metrics.map((m) => {
        const all: number[] = [];
        for (const r of ordered) {
          const ce = m.key === "tot" ? (r.pe?.oiTotal ?? null) : m.key === "c5" ? r.ce?.oiChg5 ?? null : m.key === "c15" ? r.ce?.oiChg15 ?? null : r.ce?.oiChgSession ?? null;
          const pe = m.key === "tot" ? (r.pe?.oiTotal ?? null) : m.key === "c5" ? r.pe?.oiChg5 ?? null : m.key === "c15" ? r.pe?.oiChg15 ?? null : r.pe?.oiChgSession ?? null;
          if (typeof ce === "number") all.push(Math.abs(ce));
          if (typeof pe === "number") all.push(Math.abs(pe));
        }
        const max = Math.max(1, ...all);
        return (
          <div key={m.key} className="bg-[var(--color-panel)]">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-line)] bg-[#0e1115]">
              <span className="lbl">{m.title}</span>
              <span className="lbl text-[9px] opacity-70">{m.unit}</span>
            </div>
            <div className="grid grid-cols-[1fr_88px_1fr] items-stretch text-[11px]">
              <div className="border-r border-[var(--color-line)]">
                <div className="grid grid-cols-[1fr_58px] px-2 py-1 border-b border-[var(--color-line)] text-right">
                  <span className="lbl">CE</span>
                  <span className="lbl">Δ</span>
                </div>
                {ordered.map((r) => {
                  const v = m.key === "tot" ? r.ce?.oiTotal ?? null : m.key === "c5" ? r.ce?.oiChg5 ?? null : m.key === "c15" ? r.ce?.oiChg15 ?? null : r.ce?.oiChgSession ?? null;
                  const pctW = v === null ? 0 : Math.min(100, (Math.abs(v) / max) * 100);
                  const pos = (v ?? 0) >= 0;
                  return (
                    <button
                      key={`ce-${r.strike}`}
                      onClick={() => onFocus?.(r.strike)}
                      className={`w-full grid grid-cols-[1fr_58px] items-center gap-1 px-2 py-[3px] border-b border-[#111418] text-right transition-colors hover:bg-[#14181d] ${focusedStrike === r.strike ? "bg-[#171208]" : ""}`}
                    >
                      <span className="relative h-[13px]">
                        {v === null ? (
                          <span className="absolute right-0 top-0 text-[10px] mute">n/a</span>
                        ) : (
                          <span
                            className="absolute right-0 top-0 h-[13px]"
                            style={{
                              width: `${pctW}%`,
                              background: pos ? "var(--color-amber)" : "rgba(255,92,92,0.75)",
                            }}
                          />
                        )}
                      </span>
                      <span className={`text-[10.5px] ${v === null ? "mute" : pos ? "amber" : "bear"}`}>
                        {m.key === "tot" ? fmtCompact(v) : fmtCompact(v)}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="border-r border-[var(--color-line)] bg-[#0a0c0f]">
                <div className="px-1 py-1 border-b border-[var(--color-line)] text-center">
                  <span className="lbl">STRIKE</span>
                </div>
                {ordered.map((r) => (
                  <button
                    key={`k-${r.strike}`}
                    onClick={() => onFocus?.(r.strike)}
                    className={`w-full py-[3px] border-b border-[#111418] text-center text-[11px] transition-colors ${
                      r.atm
                        ? "bg-[var(--color-amber)] text-[#120c02] font-semibold"
                        : focusedStrike === r.strike
                          ? "text-[var(--color-amber)]"
                          : "text-[#c9c3b6] hover:text-[var(--color-amber)]"
                    }`}
                    title={r.atm ? "ATM" : `${r.strike}`}
                  >
                    {fmtNum(r.strike, 0)}
                    {r.atm ? <span className="ml-1 text-[8px]">ATM</span> : null}
                  </button>
                ))}
              </div>

              <div>
                <div className="grid grid-cols-[58px_1fr] px-2 py-1 border-b border-[var(--color-line)]">
                  <span className="lbl">Δ</span>
                  <span className="lbl">PE</span>
                </div>
                {ordered.map((r) => {
                  const v = m.key === "tot" ? r.pe?.oiTotal ?? null : m.key === "c5" ? r.pe?.oiChg5 ?? null : m.key === "c15" ? r.pe?.oiChg15 ?? null : r.pe?.oiChgSession ?? null;
                  const pctW = v === null ? 0 : Math.min(100, (Math.abs(v) / max) * 100);
                  const pos = (v ?? 0) >= 0;
                  return (
                    <button
                      key={`pe-${r.strike}`}
                      onClick={() => onFocus?.(r.strike)}
                      className={`w-full grid grid-cols-[58px_1fr] items-center gap-1 px-2 py-[3px] border-b border-[#111418] text-left transition-colors hover:bg-[#14181d] ${focusedStrike === r.strike ? "bg-[#171208]" : ""}`}
                    >
                      <span className={`text-[10.5px] ${v === null ? "mute" : pos ? "amber" : "bear"}`}>
                        {fmtCompact(v)}
                      </span>
                      <span className="relative h-[13px]">
                        {v === null ? (
                          <span className="absolute left-0 top-0 text-[10px] mute">n/a</span>
                        ) : (
                          <span
                            className="absolute left-0 top-0 h-[13px]"
                            style={{
                              width: `${pctW}%`,
                              background: pos ? "var(--color-amber)" : "rgba(255,92,92,0.75)",
                            }}
                          />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
      <div className="bg-[var(--color-panel)] px-3 py-2 text-[10.5px] mute leading-snug">
        ATM {fmtNum(atm, 0)} · showing {ordered.length} strikes at the instrument&apos;s actual spacing (±{span}) · amber bar = OI added ·
        red bar = OI shed · left field = CE, right field = PE · N/A = the window was not reported (never converted to zero) · session
        baseline is the first observation of the session (never assumed zero).
      </div>
    </div>
  );
}
