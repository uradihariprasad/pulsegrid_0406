"use client";

import { useMemo, useState } from "react";
import type { ScanResult } from "@/lib/types";
import { fmtAge, fmtNum, fmtPct } from "@/lib/math";
import { Chip, Empty, Field, Section, Stat, Tone } from "../ui";

const ELIGIBLE = new Set(["ENTRY ELIGIBLE", "ACTIVE CONTINUATION", "RETEST OPPORTUNITY"]);
const WATCH = new Set(["ENTRY CONFIRMATION PENDING", "MOMENTUM BUILDING", "EXHAUSTION WARNING"]);

export default function TradeFinder({ scan, onSelect }: { scan: ScanResult; onSelect: (s: string) => void }) {
  const [dir, setDir] = useState<"ALL" | "LONG" | "SHORT">("ALL");

  const { eligible, rejected } = useMemo(() => {
    const e = scan.analyses.filter((a) => ELIGIBLE.has(a.trade.status) && a.trade.direction !== "NONE");
    const w = scan.analyses.filter((a) => WATCH.has(a.trade.status) && a.trade.direction !== "NONE");
    const r = scan.analyses
      .filter((a) => !e.includes(a) && !w.includes(a))
      .map((a) => ({
        a,
        why:
          a.trade.direction === "NONE"
            ? `Confluence below threshold (bull ${a.scores.bull} / bear ${a.scores.bear}) — ${a.trade.reasonsAgainst[0] ?? "no directional edge"}`
            : a.trade.reasonsAgainst[0] ?? "held back",
      }));
    const filtered = (list: typeof e) => (dir === "ALL" ? list : list.filter((x) => x.trade.direction === dir));
    return { eligible: filtered([...e, ...w]).sort((a, b) => Math.max(b.scores.bull, b.scores.bear) - Math.max(a.scores.bull, a.scores.bear)), rejected: r };
  }, [scan, dir]);

  const top = eligible.slice(0, 10);

  return (
    <Section className="grid gap-3">
      <div className="grid grid-cols-2 md:grid-cols-5">
        <Stat label="Entry eligible" value={scan.analyses.filter((a) => ELIGIBLE.has(a.trade.status)).length} tone="bull" sub="confirmation satisfied" />
        <Stat label="Pending / building" value={scan.analyses.filter((a) => WATCH.has(a.trade.status)).length} tone="warn" sub="not yet actionable" />
        <Stat label="Exhaustion warnings" value={scan.analyses.filter((a) => a.trade.status === "EXHAUSTION WARNING").length} tone="bear" sub="stage 3" />
        <Stat label="Invalidated" value={scan.analyses.filter((a) => a.trade.status === "EXIT/INVALIDATED").length} sub="stage 4 / broken" />
        <Stat label="No trade" value={scan.analyses.filter((a) => a.trade.status === "NO TRADE").length} sub="score or data gate" />
      </div>

      <Field
        title="TOP 10 ACTIONABLE OPPORTUNITIES · EXPLICIT RANKING"
        ticked
        right={
          <span className="flex gap-1.5">
            {(["ALL", "LONG", "SHORT"] as const).map((d) => (
              <button
                key={d}
                className="btn !py-1 !px-2"
                style={dir === d ? { color: "var(--color-amber)", borderColor: "var(--color-amberdim)" } : undefined}
                onClick={() => setDir(d)}
              >
                {d}
              </button>
            ))}
          </span>
        }
      >
        {top.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th className="nosort">#</th>
                <th className="nosort">SYMBOL</th>
                <th className="nosort">DIR</th>
                <th className="nosort">SCORE</th>
                <th className="nosort">STAGE</th>
                <th className="nosort">POSITIONING</th>
                <th className="nosort">BEST CONTRACT</th>
                <th className="nosort">ENTRY</th>
                <th className="nosort">INVALIDATION</th>
                <th className="nosort">T1</th>
                <th className="nosort">T2</th>
                <th className="nosort">R:R</th>
                <th className="nosort">STATUS</th>
                <th className="nosort">FRESH</th>
              </tr>
            </thead>
            <tbody>
              {top.map((a, i) => {
                const strike = a.trade.direction === "LONG" ? a.options.bestCE : a.options.bestPE;
                return (
                  <tr key={a.meta.symbol} className="cursor-pointer" onClick={() => onSelect(a.meta.symbol)}>
                    <td className="amber">{String(i + 1).padStart(2, "0")}</td>
                    <td>{a.meta.symbol}</td>
                    <td className={a.trade.direction === "LONG" ? "bull" : "bear"}>{a.trade.direction}</td>
                    <td>{Math.max(a.scores.bull, a.scores.bear)}</td>
                    <td className="mute">{a.momentum.stage.replace("STAGE ", "")}</td>
                    <td><Tone value={a.futures.positioning} /></td>
                    <td className="!text-left">{strike ? `${strike.side} ${fmtNum(strike.strike, 0)} (${strike.score})` : <span className="warn">NO SUITABLE CONTRACT</span>}</td>
                    <td>{a.trade.entryZone ? `${fmtNum(a.trade.entryZone[0])}–${fmtNum(a.trade.entryZone[1])}` : "—"}</td>
                    <td className="warn">{a.trade.invalidation ? fmtNum(a.trade.invalidation) : "—"}</td>
                    <td className="bull">{a.trade.target1 ? fmtNum(a.trade.target1) : "—"}</td>
                    <td className="bull">{a.trade.target2 ? fmtNum(a.trade.target2) : "—"}</td>
                    <td className="amber">{a.trade.riskReward ?? "—"}</td>
                    <td className="!text-left"><Tone value={a.trade.status} /></td>
                    <td className={a.stale ? "warn" : "mute"}>{fmtAge(a.freshnessMs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty
            title="NO QUALIFYING OPPORTUNITIES"
            reason="No instrument reached ENTRY ELIGIBLE / RETEST / BUILDING status with a valid direction on this scan. The engine deliberately emits nothing when critical inputs are missing or stale — see the rejection ledger for the exact reason per symbol."
          />
        )}
        <div className="px-3 py-2 border-t border-[var(--color-line)] text-[11px] mute font-[var(--font-sans)]">
          Ranking = leading confluence score, tie-broken by futures consistency, then contract strike score. Targets originate
          only from detected zones or ATR projections from them.
        </div>
      </Field>

      <Field title="REJECTION LEDGER · WHY SYMBOLS WERE NOT LISTED" right={<Chip>{rejected.length} gated</Chip>}>
        <div className="tbl-scroll max-h-[420px]">
          <table className="tbl">
            <thead>
              <tr>
                <th className="nosort">SYMBOL</th>
                <th className="nosort">BULL</th>
                <th className="nosort">BEAR</th>
                <th className="nosort">STATUS</th>
                <th className="nosort">REASON</th>
              </tr>
            </thead>
            <tbody>
              {rejected.slice(0, 60).map(({ a, why }) => (
                <tr key={a.meta.symbol} className="cursor-pointer" onClick={() => onSelect(a.meta.symbol)}>
                  <td>{a.meta.symbol}</td>
                  <td className={a.scores.bull >= 65 ? "bull" : "mute"}>{a.scores.bull}</td>
                  <td className={a.scores.bear >= 65 ? "bear" : "mute"}>{a.scores.bear}</td>
                  <td className="!text-left"><Tone value={a.trade.status} /></td>
                  <td className="!text-left whitespace-normal font-[var(--font-sans)] text-[11px] mute">{why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Field>

      <Field title="SETUP CHECKLIST (PER OPPORTUNITY)">
        <div className="grid md:grid-cols-2 gap-px bg-[var(--color-line)]">
          {top.slice(0, 6).map((a) => (
            <div key={a.meta.symbol} className="bg-[var(--color-panel)] p-3 grid gap-1.5 text-[11.5px] font-[var(--font-sans)]">
              <div className="flex justify-between">
                <span className="amber text-[12.5px]">{a.meta.symbol}</span>
                <Tone value={a.trade.status} />
              </div>
              <div className="text-[#c9c3b6] leading-snug">{a.trade.confirmation}</div>
              <div className="bull leading-snug">{a.trade.reasonsFor.slice(0, 3).map((r) => `+ ${r}`).join(" · ")}</div>
              <div className="warn leading-snug">{a.trade.reasonsAgainst.slice(0, 3).map((r) => `− ${r}`).join(" · ")}</div>
              <div className="mute">
                Reversal risk {a.trade.reversalRisk} · {a.flow.label} · {a.options.alignment}
              </div>
            </div>
          ))}
        </div>
      </Field>

      <p className="text-[11px] mute font-[var(--font-sans)]">
        Universe examined: {scan.analyses.length} instruments · {fmtPct(scan.overview.avgVolatilityPct, 2)} average ATR ·
        opportunities carry a directional heuristic score, not a calibrated probability of success.
      </p>
    </Section>
  );
}
