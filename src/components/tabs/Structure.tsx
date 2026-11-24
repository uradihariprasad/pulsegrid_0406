"use client";

import type { ScanResult } from "@/lib/types";
import { fmtNum, fmtPct } from "@/lib/math";
import { Chip, Field, Section, Stat, Tone } from "../ui";
import { ScanTable } from "../ScanTable";

export default function Structure({ scan, onSelect }: { scan: ScanResult; onSelect: (s: string) => void }) {
  const structural = scan.analyses.flatMap((a) => a.sr.structural.map((z) => ({ z, a })));
  const oiOnly = scan.analyses.flatMap((a) => a.sr.oiOnly.map((z) => ({ z, a })));
  const confluence = scan.analyses.flatMap((a) => a.sr.structural.filter((z) => z.kind === "confluence").map((z) => ({ z, a })));

  return (
    <Section className="grid gap-3">
      <Field title="ZONE CLASSIFICATION RULES" ticked>
        <div className="p-3 grid md:grid-cols-3 gap-3 text-[11.5px] font-[var(--font-sans)] text-[#c9c3b6]">
          <div>
            <div className="lbl mb-1.5 text-[var(--color-amber)]">A · STRUCTURAL ZONES</div>
            Derived from price action, volume acceptance and rejection: intraday swings, previous-day high/low/close, opening
            range, session VWAP, volume-profile POC/VAH/VAL. Rendered as <span className="bull">solid</span> levels.
          </div>
          <div>
            <div className="lbl mb-1.5 text-[var(--color-amber)]">B · OI-ONLY ZONES</div>
            Derived from options positioning — concentrated CE OI acts as resistance interest, PE OI as support interest.
            Rendered as <span className="bear">dashed</span> levels and never promoted to price-confirmed support/resistance on
            their own.
          </div>
          <div>
            <div className="lbl mb-1.5 text-[var(--color-amber)]">CONFLUENCE</div>
            When a structural level and an OI level cluster within 0.35 ATR they merge into one zone carrying a confluence
            score; duplicates are removed by that clustering step.
          </div>
        </div>
      </Field>

      <div className="grid grid-cols-2 md:grid-cols-6">
        <Stat label="Structural zones" value={structural.length} tone="bull" sub="price/volume derived" />
        <Stat label="OI-only zones" value={oiOnly.length} tone="bear" sub="positioning derived" />
        <Stat label="Confluence zones" value={confluence.length} tone="amber" sub="both sources overlapping" />
        <Stat label="Strong supports" value={scan.analyses.filter((a) => a.sr.primarySupport?.strength ?? 0 >= 70).length} sub="strength ≥ 70" />
        <Stat label="Strong resistances" value={scan.analyses.filter((a) => a.sr.primaryResistance?.strength ?? 0 >= 70).length} sub="strength ≥ 70" />
        <Stat label="Break risk zones" value={scan.analyses.filter((a) => /Risk/.test(`${a.sr.primarySupport?.label ?? ""}${a.sr.primaryResistance?.label ?? ""}`)).length} tone="warn" sub="price within 0.6 ATR" />
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <Field title="PRIMARY SUPPORT / RESISTANCE BY INSTRUMENT">
          <table className="tbl">
            <thead>
              <tr>
                <th className="nosort">SYMBOL</th>
                <th className="nosort">SPOT</th>
                <th className="nosort">SUPPORT</th>
                <th className="nosort">CLASS</th>
                <th className="nosort">RESISTANCE</th>
                <th className="nosort">CLASS</th>
                <th className="nosort">POC</th>
              </tr>
            </thead>
            <tbody>
              {scan.analyses.map((a) => (
                <tr key={a.meta.symbol} className="cursor-pointer" onClick={() => onSelect(a.meta.symbol)}>
                  <td>{a.meta.symbol}</td>
                  <td>{fmtNum(a.price)}</td>
                  <td className="bull">{a.sr.primarySupport ? fmtNum(a.sr.primarySupport.price) : "—"}</td>
                  <td className="!text-left"><Tone value={a.sr.primarySupport?.label ?? "—"} /></td>
                  <td className="bear">{a.sr.primaryResistance ? fmtNum(a.sr.primaryResistance.price) : "—"}</td>
                  <td className="!text-left"><Tone value={a.sr.primaryResistance?.label ?? "—"} /></td>
                  <td className="mute">{a.sr.volumeProfile.poc ? fmtNum(a.sr.volumeProfile.poc) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Field>

        <Field title="ZONE STRENGTH LEDGER · TOP 20" right={<Chip>normalised 0–100</Chip>}>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="nosort">SYMBOL</th>
                  <th className="nosort">SIDE</th>
                  <th className="nosort">ZONE</th>
                  <th className="nosort">KIND</th>
                  <th className="nosort">STR</th>
                  <th className="nosort">REACT</th>
                  <th className="nosort">CLASSIFICATION</th>
                </tr>
              </thead>
              <tbody>
                {structural
                  .concat(oiOnly)
                  .sort((x, y) => y.z.strength - x.z.strength)
                  .slice(0, 20)
                  .map(({ z, a }, i) => (
                    <tr key={`${z.id}-${i}`} className="cursor-pointer" onClick={() => onSelect(a.meta.symbol)}>
                      <td>{a.meta.symbol}</td>
                      <td className={z.side === "support" ? "bull" : "bear"}>{z.side}</td>
                      <td>{fmtNum(z.price)}</td>
                      <td className="mute">{z.kind}</td>
                      <td className="amber">{z.strength}</td>
                      <td>{z.reactions}</td>
                      <td className="!text-left"><Tone value={z.label} /></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 text-[11px] mute border-t border-[var(--color-line)] font-[var(--font-sans)]">
            Repeated tests do not automatically strengthen a zone — repeated attacks consume resting liquidity, which is why the
            strength model weighs recency, volume share and buyer/seller response, not test count alone.
          </div>
        </Field>
      </div>

      <Field title="BREAKOUT / BREAKDOWN WATCHLIST" right={<Chip>validated, not wick-based</Chip>}>
        <ScanTable
          analyses={scan.analyses.filter((a) => a.momentum.breakout.state !== "none")}
          cols={["symbol", "price", "chg", "quality", "stage", "rvol", "opt", "pos", "sr", "status", "rr"]}
          onSelect={onSelect}
          emptyTitle="NO ACTIVE LEVEL TESTS"
          emptyReason="No instrument has traded through a structural level in the current lookback window, so no breakout or breakdown is under evaluation."
        />
      </Field>

      <Field title="DISTANCE TO LEVELS (ATR UNITS)">
        <div className="grid md:grid-cols-4 gap-px bg-[var(--color-line)]">
          {scan.analyses.slice(0, 16).map((a) => {
            const atr = a.underlying.atr ?? a.price * 0.005;
            const ds = a.sr.primarySupport ? (a.price - a.sr.primarySupport.price) / atr : null;
            const dr = a.sr.primaryResistance ? (a.sr.primaryResistance.price - a.price) / atr : null;
            return (
              <button key={a.meta.symbol} className="bg-[var(--color-panel)] p-2.5 text-left hover:bg-[#12161c]" onClick={() => onSelect(a.meta.symbol)}>
                <div className="flex justify-between text-[11.5px]">
                  <span className="amber">{a.meta.symbol}</span>
                  <span className="mute">{fmtPct(a.changePct)}</span>
                </div>
                <div className="flex justify-between text-[11px] mt-1.5">
                  <span className="bull">S {ds === null ? "—" : `${ds.toFixed(1)} ATR`}</span>
                  <span className="bear">R {dr === null ? "—" : `${dr.toFixed(1)} ATR`}</span>
                </div>
              </button>
            );
          })}
        </div>
      </Field>
    </Section>
  );
}
