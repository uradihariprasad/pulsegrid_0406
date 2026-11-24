"use client";

import { useMemo, useState } from "react";
import type { Positioning, ScanResult, SymbolAnalysis } from "@/lib/types";
import { fmtCompact, fmtPct } from "@/lib/math";
import { Chip, Empty, Field, Section, Stat, Tone } from "../ui";
import { ScanTable } from "../ScanTable";

const GROUPS: { key: Positioning; title: string; blurb: string; interpret: string }[] = [
  {
    key: "LONG BUILD-UP",
    title: "01 · LONG BUILD-UP",
    blurb: "futures price up + OI up",
    interpret: "New long positioning is potentially developing. Labelled CANDIDATE — aggregate OI alone does not prove intent.",
  },
  {
    key: "SHORT BUILD-UP",
    title: "02 · SHORT BUILD-UP",
    blurb: "futures price down + OI up",
    interpret: "New short positioning is potentially developing, with volume and bearish spot structure used as confirmation.",
  },
  {
    key: "SHORT COVERING",
    title: "03 · SHORT COVERING",
    blurb: "futures price up + OI down",
    interpret: "Existing shorts closing — a SHORT-COVERING RALLY. Never treated as fresh long conviction.",
  },
  {
    key: "LONG UNWINDING",
    title: "04 · LONG UNWINDING",
    blurb: "futures price down + OI down",
    interpret: "Existing longs closing — a LONG-UNWINDING DECLINE. Never treated as fresh short conviction.",
  },
];

export default function Futures({ scan, onSelect }: { scan: ScanResult; onSelect: (s: string) => void }) {
  const [search, setSearch] = useState("");
  const universe = scan.analyses;
  const withFut = universe.filter((a) => a.futures.positioning !== "INSUFFICIENT DATA");
  const missing = universe.length - withFut.length;
  const counts = useMemo(() => {
    const c: Record<string, number> = {
      "LONG BUILD-UP": 0,
      "SHORT BUILD-UP": 0,
      "SHORT COVERING": 0,
      "LONG UNWINDING": 0,
      unclassified: 0,
    };
    for (const a of universe) {
      const p = a.futures.positioning;
      if (p === "INSUFFICIENT DATA") c.unclassified++;
      else c[p] = (c[p] ?? 0) + 1;
    }
    return c;
  }, [universe]);

  const q = search.trim().toUpperCase();
  const match = (a: SymbolAnalysis) => !q || a.meta.symbol.includes(q) || a.meta.name.toUpperCase().includes(q);
  const ledgerRows = universe.filter((a) => match(a)).slice(0, 60);
  const unclassified = universe.filter((a) => a.futures.positioning === "INSUFFICIENT DATA" && match(a));

  const searchBox = (
    <input
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      placeholder="SEARCH STOCK"
      className="!py-1.5 w-[160px]"
      aria-label="Search stock"
    />
  );

  return (
    <div className="grid gap-3">
      <div className="band grid-cols-2 sm:grid-cols-3 lg:grid-cols-7">
        <Stat label="F&O universe" value={universe.length} sub="eligible underlyings" />
        <Stat label="Futures available" value={withFut.length} tone="bull" sub="positionable" />
        <Stat label="Futures missing" value={missing} tone={missing ? "warn" : ""} sub="excluded from positioning" />
        <Stat label="Long buildup" value={counts["LONG BUILD-UP"]} tone="bull" sub="price↑ OI↑" />
        <Stat label="Short buildup" value={counts["SHORT BUILD-UP"]} tone="bear" sub="price↓ OI↑" />
        <Stat label="Short covering" value={counts["SHORT COVERING"]} tone="amber" sub="price↑ OI↓" />
        <Stat label="Long unwinding" value={counts["LONG UNWINDING"]} tone="warn" sub="price↓ OI↓" />
      </div>
    <Section className="grid gap-3">
      <Field title="POSITIONING METHOD" ticked right={<Chip>{withFut.length} classified</Chip>}>
        <div className="p-3 grid md:grid-cols-2 gap-3 text-[11.5px] font-[var(--font-sans)] text-[#c9c3b6]">
          <p>
            Classification uses the sign pair (Δ futures price, Δ futures OI) at the 5-minute window, cross-checked at 15 minutes
            and against the session baseline. Windows are computed from timestamped OI snapshots: a missing reference snapshot
            yields <span className="amber">no classification</span>, never a zero change.
          </p>
          <p>
            Session OI Δ and relative OI Δ are reported alongside volume and 5m↔15m consistency. Rollover or expiry transitions
            are not treated as ordinary OI changes; contracts of different expiries are never compared without an explicit
            expiry label. {missing > 0 ? <span className="warn">{missing} instrument(s) have no usable futures series.</span> : null}
          </p>
        </div>
      </Field>

      <div className="grid md:grid-cols-2 gap-3">
        {GROUPS.map((g) => {
          const rows = scan.analyses.filter((a) => a.futures.positioning === g.key);
          return (
            <Field key={g.key} title={g.title} right={<Chip tone={g.key.includes("LONG B") || g.key.includes("COVER") ? "live" : "warn"}>{rows.length}</Chip>}>
              <div className="px-3 py-2 text-[11px] mute border-b border-[var(--color-line)]">
                <span className="text-[#c9c3b6]">{g.blurb}</span> — {g.interpret}
              </div>
              {rows.length ? (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="nosort">SYMBOL</th>
                      <th className="nosort">Δ5M</th>
                      <th className="nosort">Δ15M</th>
                      <th className="nosort">OI Δ5M</th>
                      <th className="nosort">OI Δ SESSION</th>
                      <th className="nosort">OI Δ%</th>
                      <th className="nosort">RVOL</th>
                      <th className="nosort">5M↔15M</th>
                      <th className="nosort">SCORE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => (
                      <tr key={a.meta.symbol} className="cursor-pointer" onClick={() => onSelect(a.meta.symbol)}>
                        <td>{a.meta.symbol}</td>
                        <td className={a.futures.chg5Pct !== null && a.futures.chg5Pct >= 0 ? "bull" : "bear"}>{fmtPct(a.futures.chg5Pct)}</td>
                        <td className={a.futures.chg15Pct !== null && a.futures.chg15Pct >= 0 ? "bull" : "bear"}>{fmtPct(a.futures.chg15Pct)}</td>
                        <td className="amber">{fmtCompact(a.futures.oiChg5)}</td>
                        <td className="amber">{fmtCompact(a.futures.oiChgSession)}</td>
                        <td className={a.futures.relOiPct !== null && a.futures.relOiPct >= 0 ? "bull" : "bear"}>
                          {a.futures.relOiPct === null ? "—" : `${a.futures.relOiPct.toFixed(2)}%`}
                        </td>
                        <td>{a.futures.relVol === null ? "—" : `${a.futures.relVol.toFixed(2)}×`}</td>
                        <td className={a.futures.consistency === "aligned" ? "bull" : a.futures.consistency === "mixed" ? "warn" : "mute"}>
                          {a.futures.consistency}
                        </td>
                        <td>{Math.max(a.scores.bull, a.scores.bear)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty
                  title="NO INSTRUMENTS IN THIS CATEGORY"
                  reason={`No underlying produced the (price, OI) sign pair required for ${g.key} on this scan. Categories are mutually exclusive by construction.`}
                />
              )}
            </Field>
          );
        })}
      </div>

      <Field
        title="UNCLASSIFIED / INSUFFICIENT DATA"
        right={
          <span className="flex gap-2 items-center">
            <Chip tone={missing ? "warn" : ""}>{missing}</Chip>
            {searchBox}
          </span>
        }
      >
        <ScanTable
          analyses={unclassified}
          cols={["symbol", "price", "chg", "missing", "freshness"]}
          onSelect={onSelect}
          emptyTitle="ALL INSTRUMENTS CLASSIFIED"
          emptyReason="Every scanned underlying produced a usable futures price/OI reference pair for all four positioning windows. Unclassified stocks are never hidden — they appear here with the exact missing component."
        />
        <div className="px-3 py-2 text-[11px] mute border-t border-[var(--color-line)] font-[var(--font-sans)]">
          Unclassified stocks remain inspectable; their missing futures/OI component is shown verbatim and they are excluded from
          positioning counts (missing data is never treated as neutral confirmation).
        </div>
      </Field>

      <Field title="POSITIONING CONFIRMATION LEDGER" right={<span className="flex gap-2 items-center"><Chip>per instrument</Chip>{searchBox}</span>}>
        <div className="tbl-scroll max-h-[320px]">
          <table className="tbl">
            <thead>
              <tr>
                <th className="nosort">SYMBOL</th>
                <th className="nosort">POSITIONING</th>
                <th className="nosort">CONFIRMATIONS</th>
                <th className="nosort">WARNINGS</th>
              </tr>
            </thead>
            <tbody>
              {ledgerRows.map((a) => (
                <tr key={a.meta.symbol} className="cursor-pointer" onClick={() => onSelect(a.meta.symbol)}>
                  <td>{a.meta.symbol}</td>
                  <td>
                    <Tone value={a.futures.positioning} />
                  </td>
                  <td className="!text-left whitespace-normal font-[var(--font-sans)] text-[11px] bull">{a.futures.confirmations.join(" · ") || "—"}</td>
                  <td className="!text-left whitespace-normal font-[var(--font-sans)] text-[11px] warn">{a.futures.warnings.join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Field>
      </Section>
    </div>
  );
}

export function positioningCounts(analyses: SymbolAnalysis[]) {
  const out: Record<string, number> = {};
  for (const a of analyses) out[a.futures.positioning] = (out[a.futures.positioning] ?? 0) + 1;
  return out;
}
