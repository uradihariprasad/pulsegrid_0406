"use client";

import { useMemo, useState } from "react";
import { fmtCompact, fmtNum, fmtPct } from "@/lib/math";
import type { SymbolAnalysis } from "@/lib/types";
import { Empty, Meter, Tone } from "./ui";

export interface Col {
  key: string;
  label: string;
  render: (a: SymbolAnalysis) => React.ReactNode;
  sort?: (a: SymbolAnalysis) => number | string;
}

const stageShort = (s: string) => (s.startsWith("UN") ? "—" : s.replace("STAGE ", "").replace("MOMENTUM ", ""));

export const COLS: Record<string, Col> = {
  symbol: {
    key: "symbol",
    label: "SYMBOL",
    render: (a) => (
      <span className="flex flex-col items-start leading-tight">
        <span className="text-[12.5px] text-[var(--color-paper)] font-semibold">{a.meta.symbol}</span>
        <span className="text-[9.5px] mute">{a.meta.sector}</span>
      </span>
    ),
    sort: (a) => a.meta.symbol,
  },
  price: {
    key: "price",
    label: "PRICE",
    render: (a) => (a.completeness === "INVALID" ? <span className="mute">—</span> : fmtNum(a.price)),
    sort: (a) => (a.completeness === "INVALID" ? -1 : a.price),
  },
  chg: {
    key: "chg",
    label: "CHG %",
    render: (a) => <span className={a.changePct >= 0 ? "bull" : "bear"}>{fmtPct(a.changePct)}</span>,
    sort: (a) => a.changePct,
  },
  bull: {
    key: "bull",
    label: "BULL",
    render: (a) => (
      <span className="inline-flex flex-col items-end gap-1 w-[74px]">
        <span className={a.scores.bull >= 65 ? "bull" : a.scores.bull >= 50 ? "warn" : "mute"}>{a.scores.bull}</span>
        <Meter value={a.scores.bull} tone="bull" />
      </span>
    ),
    sort: (a) => a.scores.bull,
  },
  bear: {
    key: "bear",
    label: "BEAR",
    render: (a) => (
      <span className="inline-flex flex-col items-end gap-1 w-[74px]">
        <span className={a.scores.bear >= 65 ? "bear" : a.scores.bear >= 50 ? "warn" : "mute"}>{a.scores.bear}</span>
        <Meter value={a.scores.bear} tone="bear" />
      </span>
    ),
    sort: (a) => a.scores.bear,
  },
  stage: {
    key: "stage",
    label: "STAGE",
    render: (a) => <span className="text-[11px] amber">{stageShort(a.momentum.stage)}</span>,
    sort: (a) => a.momentum.stage,
  },
  pos: {
    key: "pos",
    label: "FUTURES POSITIONING",
    render: (a) => <Tone value={a.futures.positioning} />,
    sort: (a) => a.futures.positioning,
  },
  consistency: {
    key: "consistency",
    label: "5M↔15M",
    render: (a) => (
      <span className={a.futures.consistency === "aligned" ? "bull" : a.futures.consistency === "mixed" ? "warn" : "mute"}>
        {a.futures.consistency}
      </span>
    ),
    sort: (a) => a.futures.consistency,
  },
  oi: {
    key: "oi",
    label: "OI Δ SESSION",
    render: (a) => <span className="amber">{fmtCompact(a.futures.oiChgSession)}</span>,
    sort: (a) => a.futures.oiChgSession ?? -Infinity,
  },
  rvol: {
    key: "rvol",
    label: "REL VOL",
    render: (a) => (
      <span className={a.underlying.relVol === null ? "mute" : a.underlying.relVol > 1.15 ? "bull" : a.underlying.relVol < 0.9 ? "bear" : "mute"}>
        {a.underlying.relVol === null ? "—" : `${a.underlying.relVol.toFixed(2)}×`}
      </span>
    ),
    sort: (a) => a.underlying.relVol ?? -1,
  },
  opt: {
    key: "opt",
    label: "OPTION ALIGNMENT",
    render: (a) => <Tone value={a.options.alignment} />,
    sort: (a) => a.options.alignment,
  },
  sr: {
    key: "sr",
    label: "S / R STATUS",
    render: (a) => (
      <span className="flex gap-2 justify-end text-[11px]">
        <span className="bull">{a.sr.primarySupport ? fmtNum(a.sr.primarySupport.price) : "—"}</span>
        <span className="bear">{a.sr.primaryResistance ? fmtNum(a.sr.primaryResistance.price) : "—"}</span>
      </span>
    ),
    sort: (a) => a.sr.primarySupport?.strength ?? 0,
  },
  quality: {
    key: "quality",
    label: "MOMENTUM QUALITY",
    render: (a) => <Tone value={a.momentum.quality} />,
    sort: (a) => a.momentum.quality,
  },
  flow: {
    key: "flow",
    label: "CONTROL",
    render: (a) => <Tone value={a.flow.label} />,
    sort: (a) => a.flow.buyerDominance,
  },
  status: {
    key: "status",
    label: "OPPORTUNITY",
    render: (a) => <Tone value={a.trade.status} />,
    sort: (a) => a.trade.status,
  },
  rr: {
    key: "rr",
    label: "R:R",
    render: (a) => <span className="amber">{a.trade.riskReward ?? "—"}</span>,
    sort: (a) => a.trade.riskReward ?? -1,
  },
  strike: {
    key: "strike",
    label: "BEST STRIKE",
    render: (a) => {
      const s = a.options.bestCE && a.options.bestPE ? (a.scores.bull >= a.scores.bear ? a.options.bestCE : a.options.bestPE) : (a.options.bestCE ?? a.options.bestPE);
      if (!s) return <span className="warn">NO SUITABLE CONTRACT</span>;
      return (
        <span className="flex gap-2 justify-end">
          <span className="mute">{s.side}</span>
          <span className="amber">{fmtNum(s.strike, 0)}</span>
          <span className="mute">{s.score}/100</span>
        </span>
      );
    },
    sort: (a) => (a.options.bestCE ?? a.options.bestPE)?.score ?? -1,
  },
  completeness: {
    key: "completeness",
    label: "DATA",
    render: (a) =>
      a.completeness === "COMPLETE" ? (
        <span className="bull">COMPLETE</span>
      ) : (
        <span className={a.completeness === "INVALID" ? "bear" : "warn"} title={`Missing: ${a.missing.join(", ")}`}>
          {a.completeness}
          {a.missing.length ? ` (${a.missing.length})` : ""}
        </span>
      ),
    sort: (a) => a.completeness,
  },
  missing: {
    key: "missing",
    label: "MISSING DATA",
    render: (a) => <span className="mute !text-left whitespace-normal">{a.missing.join(", ") || "—"}</span>,
    sort: (a) => a.missing.length,
  },
  oiMomentum: {
    key: "oiMomentum",
    label: "OI MOMENTUM",
    render: (a) => {
      const oi = a.oiMomentum;
      if (!oi || oi.available === false) return <span className="mute">N/A</span>;
      return (
        <span className={oi.direction > 0 ? "bull" : oi.direction < 0 ? "bear" : "mute"}>
          {oi.score} · {oi.direction > 0 ? "BULL" : oi.direction < 0 ? "BEAR" : "FLAT"}
        </span>
      );
    },
    sort: (a) => a.oiMomentum?.score ?? -1,
  },
  freshness: {
    key: "freshness",
    label: "FRESHNESS",
    render: (a) => (
      <span className={a.stale ? "warn" : a.source === "live" ? "bull" : "mute"}>
        {a.stale ? "STALE" : "LIVE"} · {Math.round(a.freshnessMs / 1000)}s
      </span>
    ),
    sort: (a) => a.freshnessMs,
  },
};

export function ScanTable({
  analyses,
  cols,
  onSelect,
  emptyTitle = "NO QUALIFYING OPPORTUNITIES",
  emptyReason = "No instrument satisfied the active filters on this scan. This is a filter result, not a data failure — widen the filter or re-scan.",
  limit,
  defaultSort,
  rowClass,
  selected,
}: {
  analyses: SymbolAnalysis[];
  cols: string[];
  onSelect?: (symbol: string) => void;
  emptyTitle?: string;
  emptyReason?: string;
  limit?: number;
  defaultSort?: string;
  rowClass?: (a: SymbolAnalysis) => string;
  selected?: string | null;
}) {
  const [sort, setSort] = useState<string | null>(defaultSort ?? null);
  const [asc, setAsc] = useState(false);

  const sorted = useMemo(() => {
    let rows = analyses.slice();
    const col = sort ? COLS[sort] : null;
    if (col?.sort) {
      rows.sort((x, y) => {
        const a = col.sort!(x);
        const b = col.sort!(y);
        if (typeof a === "string" || typeof b === "string") return asc ? String(a).localeCompare(String(b)) : String(b).localeCompare(String(a));
        return asc ? a - b : b - a;
      });
    } else {
      rows.sort((x, y) => Math.max(y.scores.bull, y.scores.bear) - Math.max(x.scores.bull, x.scores.bear));
    }
    return limit ? rows.slice(0, limit) : rows;
  }, [analyses, sort, asc, limit]);

  if (!analyses.length) return <Empty title={emptyTitle} reason={emptyReason} />;

  return (
    <div className="tbl-scroll">
      <table className="tbl">
        <thead>
          <tr>
            {cols.map((k) => {
              const c = COLS[k];
              if (!c) return null;
              return (
                <th
                  key={k}
                  onClick={() => {
                    if (sort === k) setAsc((v) => !v);
                    else {
                      setSort(k);
                      setAsc(false);
                    }
                  }}
                >
                  {c.label}
                  {sort === k ? (asc ? " ▲" : " ▼") : ""}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((a) => (
            <tr
              key={a.meta.symbol}
              onClick={() => onSelect?.(a.meta.symbol)}
              className={`${onSelect ? "cursor-pointer" : ""} ${selected === a.meta.symbol ? "selected" : ""} ${rowClass?.(a) ?? ""}`}
            >
              {cols.map((k) => {
                const c = COLS[k];
                if (!c) return null;
                return <td key={k}>{c.render(a)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
