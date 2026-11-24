"use client";

import { fmtAge, fmtNum, fmtPct } from "@/lib/math";
import type { ScanResult } from "@/lib/types";
import { Chip, Field, Section, Stat, Tone } from "../ui";
import { ScanTable } from "../ScanTable";

export default function Overview({ scan, onSelect }: { scan: ScanResult; onSelect: (s: string) => void }) {
  const o = scan.overview;
  const total = o.advancing + o.declining + o.unchanged || 1;
  const indices = [o.nifty, o.sensex].filter(Boolean) as NonNullable<ScanResult["overview"]["nifty"]>[];

  return (
    <Section className="grid gap-3">
      {/* indices */}
      <div className="grid md:grid-cols-2 gap-3">
        {indices.map((a) => (
          <Field
            key={a.meta.symbol}
            title={`${a.meta.name} · ${a.meta.symbol}`}
            ticked
            right={
              <span className="flex gap-2 items-center">
                <Chip tone={a.stale ? "warn" : "live"}>{a.stale ? "STALE" : "LIVE"}</Chip>
                <Chip>{fmtAge(a.freshnessMs)}</Chip>
              </span>
            }
          >
            <button className="w-full text-left" onClick={() => onSelect(a.meta.symbol)}>
              <div className="grid grid-cols-2 md:grid-cols-4">
                <Stat label="Spot" value={fmtNum(a.price)} sub={fmtPct(a.changePct)} tone={a.changePct >= 0 ? "bull" : "bear"} />
                <Stat
                  label="Bull / Bear"
                  value={
                    <span className="flex gap-2">
                      <span className={a.scores.bull >= 65 ? "bull" : "mute"}>{a.scores.bull}</span>
                      <span className="mute">/</span>
                      <span className={a.scores.bear >= 65 ? "bear" : "mute"}>{a.scores.bear}</span>
                    </span>
                  }
                  sub={a.scores.grade}
                />
                <Stat label="Positioning" value={<Tone value={a.futures.positioning} />} sub={`5m↔15m ${a.futures.consistency}`} />
                <Stat label="Stage / Quality" value={<Tone value={a.momentum.quality} />} sub={a.momentum.stage} />
              </div>
              <div className="px-3 py-2 border-t border-[var(--color-line)] grid grid-cols-3 gap-3 text-[11.5px]">
                <span className="mute">
                  S/R <span className="bull">{a.sr.primarySupport ? fmtNum(a.sr.primarySupport.price) : "—"}</span> ·{" "}
                  <span className="bear">{a.sr.primaryResistance ? fmtNum(a.sr.primaryResistance.price) : "—"}</span>
                </span>
                <span className="mute">
                  Control <Tone value={a.flow.label} />
                </span>
                <span className="mute">
                  Opp: <Tone value={a.trade.status} />
                </span>
              </div>
            </button>
          </Field>
        ))}
      </div>

      {/* breadth */}
      <div className="grid md:grid-cols-4 gap-3">
        <Field title="MARKET BREADTH" className="md:col-span-2">
          <div className="p-3 grid gap-3">
            <div className="flex h-[16px] w-full overflow-hidden border border-[var(--color-line)]">
              <div style={{ width: `${(o.advancing / total) * 100}%` }} className="bg-[var(--color-bull)]" />
              <div style={{ width: `${(o.unchanged / total) * 100}%` }} className="bg-[#3a3f47]" />
              <div style={{ width: `${(o.declining / total) * 100}%` }} className="bg-[var(--color-bear)]" />
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="lbl mb-1">ADVANCING</div>
                <div className="text-[18px] bull">{o.advancing}</div>
              </div>
              <div>
                <div className="lbl mb-1">UNCHANGED</div>
                <div className="text-[18px] mute">{o.unchanged}</div>
              </div>
              <div>
                <div className="lbl mb-1">DECLINING</div>
                <div className="text-[18px] bear">{o.declining}</div>
              </div>
            </div>
            <div className="text-[11.5px] font-[var(--font-sans)] text-[#c9c3b6]">
              Breadth is computed from the scanned universe only ({total} instruments), not the full exchange list.
            </div>
          </div>
        </Field>

        <Field title="MOMENTUM BREADTH">
          <div className="grid grid-cols-2">
            <Stat label="Bullish F&O" value={o.bullish} tone="bull" sub="score ≥ 50 and leading" />
            <Stat label="Bearish F&O" value={o.bearish} tone="bear" sub="score ≥ 50 and leading" />
            <Stat label="Strong momentum" value={o.strong.length} tone="amber" sub="STRONG / HIGH CONFLUENCE" />
            <Stat label="Avg volatility" value={`${o.avgVolatilityPct}%`} sub="ATR14 as % of price" />
          </div>
        </Field>

        <Field title="OVERALL SENTIMENT" ticked>
          <div className="p-4 grid gap-3">
            <div className="text-[17px] leading-tight amber font-cond tracking-[0.04em]">{o.sentiment}</div>
            <div className="grid gap-1.5 text-[11.5px]">
              <span className="mute">
                Session: <span className="text-[#c9c3b6]">{scan.sessionLabel}</span>
              </span>
              <span className="mute">
                Generated: <span className="text-[#c9c3b6]">{new Date(scan.generatedAt).toLocaleTimeString("en-IN", { hour12: false })}</span>
              </span>
              <span className="mute">
                Source: <Chip tone={scan.connected ? "live" : "warn"}>{scan.connected ? "UPSTOX LIVE" : "NOT CONNECTED"}</Chip>
              </span>
            </div>
          </div>
        </Field>
      </div>

      {/* sector + strong */}
      <div className="grid md:grid-cols-3 gap-3">
        <Field title="TOP SECTOR MOMENTUM">
          <div className="p-3 grid gap-2">
            {o.sectors.slice(0, 8).map((s) => (
              <div key={s.sector} className="grid grid-cols-[110px_1fr_54px] items-center gap-2 text-[11.5px]">
                <span className="truncate">{s.sector}</span>
                <span className="meter meter--bull">
                  <span
                    style={{
                      width: `${Math.min(100, Math.abs(s.avgScore))}%`,
                      background: s.avgScore >= 0 ? "var(--color-bull)" : "var(--color-bear)",
                    }}
                  />
                </span>
                <span className={`text-right ${s.avgScore >= 0 ? "bull" : "bear"}`}>{s.avgScore}</span>
              </div>
            ))}
          </div>
        </Field>

        <Field title="STRONG MOMENTUM (TOP 8)" className="md:col-span-2" right={<Chip>{o.strong.length} qualified</Chip>}>
          <ScanTable
            analyses={o.strong}
            cols={["symbol", "price", "chg", "bull", "bear", "pos", "quality", "status"]}
            onSelect={onSelect}
            limit={8}
            emptyTitle="NO STRONG MOMENTUM"
            emptyReason="No instrument reached the 65-point confluence band on this scan. Developing candidates remain visible in the scanner and momentum master tabs."
          />
        </Field>
      </div>

      {/* connection status */}
      <Field title="DATA CONNECTION & KNOWN LIMITATIONS" ticked>
        <div className="p-3 grid md:grid-cols-2 gap-3 text-[11.5px]">
          <div className="grid gap-1.5">
            <span className="lbl">CONNECTION</span>
            <span>
              Mode: <Chip tone={scan.connected ? "live" : "warn"}>{scan.connected ? "LIVE UPSTOX" : "NOT CONNECTED"}</Chip>
            </span>
            <span className="mute">
              Instruments analysed: <span className="text-[#c9c3b6]">{scan.analyses.length}</span>
            </span>
            <span className="mute">
              Events emitted: <span className="text-[#c9c3b6]">{scan.events.length}</span>
            </span>
          </div>
          <div className="grid gap-1.5">
            <span className="lbl">LIMITATIONS (REPORTED, NOT FABRICATED)</span>
            <ul className="grid gap-1 mute font-[var(--font-sans)] leading-snug">
              {scan.limitations.slice(0, 5).map((l) => (
                <li key={l}>▸ {l}</li>
              ))}
            </ul>
          </div>
        </div>
      </Field>
    </Section>
  );
}
