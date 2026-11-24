"use client";

import { useState } from "react";
import type { ScanResult, SymbolAnalysis } from "@/lib/types";
import { fmtCompact, fmtNum, fmtPct } from "@/lib/math";
import { Chip, Field, Section, Stat, Tone } from "../ui";
import { ScanTable } from "../ScanTable";

export default function OptionsIntel({ scan, onSelect }: { scan: ScanResult; onSelect: (s: string) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const target: SymbolAnalysis | null =
    scan.analyses.find((a) => a.meta.symbol === sel) ??
    scan.analyses.slice().sort((a, b) => Math.max(b.scores.bull, b.scores.bear) - Math.max(a.scores.bull, a.scores.bear))[0] ??
    null;

  return (
    <Section className="grid gap-3">
      <Field title="OPTION ALIGNMENT ACROSS THE UNIVERSE" right={<Chip>{scan.analyses.length} underlyings</Chip>}>
        <div className="grid grid-cols-2 md:grid-cols-4">
          <Stat label="Aligned" value={scan.analyses.filter((a) => a.options.alignment === "aligned").length} tone="bull" sub="spot + CE + PE agree (1 confirmation)" />
          <Stat label="Divergent" value={scan.analyses.filter((a) => a.options.alignment === "divergent").length} tone="bear" sub="premium contradicts spot" />
          <Stat label="Unconfirmed" value={scan.analyses.filter((a) => a.options.alignment === "unconfirmed").length} tone="warn" sub="mixed premium response" />
          <Stat label="Unavailable" value={scan.analyses.filter((a) => a.options.alignment === "unavailable").length} sub="no option series returned" />
        </div>
        <div className="px-3 py-2 text-[11.5px] mute border-t border-[var(--color-line)] font-[var(--font-sans)]">
          CE rising while PE falls is counted as <span className="text-[#c9c3b6]">one</span> confirmation, not two — both are
          consequences of the same underlying move.
        </div>
      </Field>

      <Field title="RANKED CONTRACT SELECTION · ALL UNDERLYINGS">
        <ScanTable
          analyses={scan.analyses}
          cols={["symbol", "price", "chg", "opt", "strike", "rvol", "bull", "bear", "quality", "status"]}
          onSelect={(s) => {
            setSel(s);
            onSelect(s);
          }}
        />
      </Field>

      {target ? (
        <Field
          title={`CONTRACT DETAIL · ${target.meta.symbol} · ATM ${target.options.atm} · EXPIRY ${target.options.expiry}`}
          right={
            <span className="flex gap-2">
              <Chip tone={target.options.alignment === "aligned" ? "live" : "warn"}>{target.options.alignment}</Chip>
              <button className="btn !py-1 !px-2" onClick={() => onSelect(target.meta.symbol)}>
                OPEN FULL ANALYSIS
              </button>
            </span>
          }
          ticked
        >
          <div className="grid grid-cols-2 md:grid-cols-4 border-b border-[var(--color-line)]">
            <Stat label="Best CE" value={target.options.bestCE ? fmtNum(target.options.bestCE.strike, 0) : "NO SUITABLE"} sub={target.options.bestCE ? `score ${target.options.bestCE.score}/100 · ${target.options.bestCE.liquidity}` : "no strike passed filters"} tone={target.options.bestCE ? "bull" : "bear"} />
            <Stat label="Best PE" value={target.options.bestPE ? fmtNum(target.options.bestPE.strike, 0) : "NO SUITABLE"} sub={target.options.bestPE ? `score ${target.options.bestPE.score}/100 · ${target.options.bestPE.liquidity}` : "no strike passed filters"} tone={target.options.bestPE ? "bull" : "bear"} />
            <Stat label="CE bias" value={<Tone value={target.options.ceBias} />} sub="premium + EMA + VWAP" />
            <Stat label="PE bias" value={<Tone value={target.options.peBias} />} sub="premium + EMA + VWAP" />
          </div>

          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="nosort">STRIKE</th>
                  <th className="nosort">CE ₹</th>
                  <th className="nosort">CE Δ%</th>
                  <th className="nosort">BIAS</th>
                  <th className="nosort">DELTA</th>
                  <th className="nosort">GAMMA</th>
                  <th className="nosort">THETA</th>
                  <th className="nosort">VEGA</th>
                  <th className="nosort">IV</th>
                  <th className="nosort">SPREAD</th>
                  <th className="nosort">OI SESSION</th>
                  <th className="nosort">RESPONSE</th>
                  <th className="nosort">PE ₹</th>
                  <th className="nosort">PE Δ%</th>
                  <th className="nosort">BIAS</th>
                  <th className="nosort">DELTA</th>
                  <th className="nosort">IV</th>
                  <th className="nosort">SPREAD</th>
                  <th className="nosort">OI SESSION</th>
                </tr>
              </thead>
              <tbody>
                {target.options.strikes.map((r) => (
                  <tr key={r.strike} className={r.atm ? "selected" : ""}>
                    <td className={r.atm ? "amber font-semibold" : ""}>{fmtNum(r.strike, 0)}{r.atm ? " · ATM" : ""}</td>
                    <td>{fmtNum(r.ce?.premium)}</td>
                    <td className={(r.ce?.changePct ?? 0) >= 0 ? "bull" : "bear"}>{fmtPct(r.ce?.changePct ?? null)}</td>
                    <td><Tone value={r.ce?.bias ?? "—"} /></td>
                    <td>{r.ce?.contract.greeks.delta?.toFixed(3) ?? "—"}</td>
                    <td>{r.ce?.contract.greeks.gamma?.toFixed(4) ?? "—"}</td>
                    <td>{r.ce?.contract.greeks.theta?.toFixed(2) ?? "—"}</td>
                    <td>{r.ce?.contract.greeks.vega?.toFixed(3) ?? "—"}</td>
                    <td>{r.ce?.contract.greeks.iv ? `${(r.ce.contract.greeks.iv * 100).toFixed(1)}%` : "—"}</td>
                    <td className={(r.ce?.spreadPct ?? 99) > 3 ? "warn" : "mute"}>{r.ce?.spreadPct?.toFixed(2) ?? "—"}%</td>
                    <td className="amber">{fmtCompact(r.ce?.oiChgSession ?? null)}</td>
                    <td className="mute">{r.ce?.responseQuality ?? "—"}</td>
                    <td>{fmtNum(r.pe?.premium)}</td>
                    <td className={(r.pe?.changePct ?? 0) >= 0 ? "bull" : "bear"}>{fmtPct(r.pe?.changePct ?? null)}</td>
                    <td><Tone value={r.pe?.bias ?? "—"} /></td>
                    <td>{r.pe?.contract.greeks.delta?.toFixed(3) ?? "—"}</td>
                    <td>{r.pe?.contract.greeks.iv ? `${(r.pe.contract.greeks.iv * 100).toFixed(1)}%` : "—"}</td>
                    <td className={(r.pe?.spreadPct ?? 99) > 3 ? "warn" : "mute"}>{r.pe?.spreadPct?.toFixed(2) ?? "—"}%</td>
                    <td className="amber">{fmtCompact(r.pe?.oiChgSession ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-3 py-2 text-[11px] mute grid gap-1 border-t border-[var(--color-line)] font-[var(--font-sans)]">
            <span>▸ {target.options.alignmentNote}</span>
            <span>
              ▸ Greeks:{" "}
              {target.options.strikes.some((s) => s.ce?.contract.greeksSource === "provider")
                ? "provider-supplied"
                : "Black–Scholes–Merton derived (r = 6.5%, no dividends, European exercise)"}
            </span>
            <span>▸ Premium response compares actual Δ premium against delta-adjusted expected Δ for the same window.</span>
          </div>
        </Field>
      ) : null}
    </Section>
  );
}
