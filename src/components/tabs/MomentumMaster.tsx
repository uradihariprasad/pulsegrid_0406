"use client";

import type { ScanResult } from "@/lib/types";
import { Chip, Field, Section, Stat } from "../ui";
import { ScanTable } from "../ScanTable";

export default function MomentumMaster({ scan, onSelect }: { scan: ScanResult; onSelect: (s: string) => void }) {
  const o = scan.overview;
  const idx = [o.nifty, o.sensex].filter(Boolean) as NonNullable<ScanResult["overview"]["nifty"]>[];
  // STRICT GATE: only COMPLETE data enters the high-confidence groups
  const strict = scan.analyses.filter((a) => a.completeness === "COMPLETE");
  const provisional = scan.analyses.filter((a) => a.completeness !== "COMPLETE");
  const topBull = strict
    .filter((a) => a.meta.kind === "equity")
    .slice()
    .sort((a, b) => b.scores.bull - a.scores.bull)
    .slice(0, 10);
  const topBear = strict
    .filter((a) => a.meta.kind === "equity")
    .slice()
    .sort((a, b) => b.scores.bear - a.scores.bear)
    .slice(0, 10);

  return (
    <Section className="grid gap-3">
      <div className="grid md:grid-cols-2 gap-3">
        <Field title="A · TOP 10 F&O BULLISH STOCKS" ticked right={<Chip tone="live">ranked by bull score</Chip>}>
          <ScanTable
            analyses={topBull}
            cols={["symbol", "price", "chg", "bull", "stage", "pos", "oiMomentum", "quality", "status"]}
            onSelect={onSelect}
            limit={10}
            defaultSort="bull"
            emptyTitle="NO BULLISH CANDIDATES"
            emptyReason="No COMPLETE-data instrument currently carries a bullish confluence score. The engine does not force a directional label when evidence is mixed — check the provisional watchlist below for incomplete stocks."
          />
        </Field>

        <Field title="B · TOP 10 F&O BEARISH STOCKS" ticked right={<Chip tone="warn">ranked by bear score</Chip>}>
          <ScanTable
            analyses={topBear}
            cols={["symbol", "price", "chg", "bear", "stage", "pos", "oiMomentum", "quality", "status"]}
            onSelect={onSelect}
            limit={10}
            defaultSort="bear"
            emptyTitle="NO BEARISH CANDIDATES"
            emptyReason="No COMPLETE-data instrument currently carries a bearish confluence score on this session."
          />
        </Field>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {idx.map((a) => (
          <Field key={a.meta.symbol} title={`${a.meta.symbol === "NIFTY" ? "C" : "D"} · ${a.meta.name} ANALYSIS`} ticked>
            <button className="w-full text-left" onClick={() => onSelect(a.meta.symbol)}>
              <div className="grid grid-cols-2 md:grid-cols-5">
                <Stat label="Spot" value={a.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })} sub={`${a.changePct.toFixed(2)}%`} tone={a.changePct >= 0 ? "bull" : "bear"} />
                <Stat label="Bull" value={a.scores.bull} tone={a.scores.bull >= 65 ? "bull" : "mute"} sub={a.scores.confirmed + " confirmed"} />
                <Stat label="Bear" value={a.scores.bear} tone={a.scores.bear >= 65 ? "bear" : "mute"} sub={a.scores.conflicting + " conflicting"} />
                <Stat label="Positioning" value={a.futures.positioning.replace(" BUILD-UP", "B").replace(" COVERING", " CVG").replace(" UNWINDING", " UNW")} sub={a.futures.relOiPct === null ? "OI n/a" : `${a.futures.relOiPct.toFixed(2)}% OI`} />
                <Stat label="Stage" value={a.momentum.stage.replace("STAGE ", "")} tone="amber" sub={a.momentum.quality} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-3 py-2 border-t border-[var(--color-line)] text-[11px]">
                <span className="mute">S/R <span className="bull">{a.sr.primarySupport?.price.toFixed(0) ?? "—"}</span> <span className="bear">{a.sr.primaryResistance?.price.toFixed(0) ?? "—"}</span></span>
                <span className="mute">Control <span className={a.flow.label === "BUYER DOMINANT" ? "bull" : a.flow.label === "SELLER DOMINANT" ? "bear" : "mute"}>{a.flow.label}</span></span>
                <span className="mute">Option <span className={a.options.alignment === "aligned" ? "bull" : "warn"}>{a.options.alignment}</span></span>
                <span className="mute">Opp <span className={a.trade.direction === "LONG" ? "bull" : a.trade.direction === "SHORT" ? "bear" : "warn"}>{a.trade.status}</span></span>
              </div>
            </button>
          </Field>
        ))}
        {!idx.length ? (
          <Field title="INDEX ANALYSIS">
            <div className="p-4 text-[12px] mute">
              NIFTY / SENSEX rows are absent from the scan — the universe did not return index instruments. Check the connection
              panel: in live mode this means the index instrument keys were unavailable from the master contract.
            </div>
          </Field>
        ) : null}
      </div>

      <Field
        title="PROVISIONAL WATCHLIST · DATA INCOMPLETE"
        right={<Chip tone={provisional.length ? "warn" : ""}>{provisional.length}</Chip>}
      >
        {provisional.length ? (
          <ScanTable
            analyses={provisional}
            cols={["symbol", "price", "chg", "bull", "bear", "completeness", "missing", "freshness"]}
            onSelect={onSelect}
            emptyTitle="NONE"
            emptyReason="No instrument has incomplete data."
          />
        ) : (
          <div className="px-3 py-3 text-[11.5px] mute font-[var(--font-sans)]">
            Every analysed instrument passed the completeness gate.
          </div>
        )}
        <div className="px-3 py-2 text-[11px] mute border-t border-[var(--color-line)] font-[var(--font-sans)]">
          Provisional stocks are shown for transparency but are excluded from the strict high-confidence groups above; missing
          futures or options evidence is never counted as a confirmation.
        </div>
      </Field>

      <Field title="FULL UNIVERSE · SORTABLE" right={<Chip>{scan.analyses.length} instruments · {strict.length} complete</Chip>}>
        <ScanTable
          analyses={scan.analyses}
          cols={["symbol", "price", "chg", "bull", "bear", "stage", "pos", "rvol", "oiMomentum", "quality", "status", "completeness", "freshness"]}
          onSelect={onSelect}
        />
      </Field>
    </Section>
  );
}
