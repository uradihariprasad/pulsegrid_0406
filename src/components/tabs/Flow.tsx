"use client";

import type { ScanResult } from "@/lib/types";
import { Chip, Field, Section, Stat, Tone } from "../ui";
import { ScanTable } from "../ScanTable";

export default function Flow({ scan, onSelect }: { scan: ScanResult; onSelect: (s: string) => void }) {
  const buyer = scan.analyses.filter((a) => a.flow.label === "BUYER DOMINANT");
  const seller = scan.analyses.filter((a) => a.flow.label === "SELLER DOMINANT");
  const absorption = scan.analyses.filter((a) => a.flow.events.some((e) => /ABSORPTION/.test(e)));
  const rejection = scan.analyses.filter((a) => a.flow.events.some((e) => /rejection|rejecting|testing resistance/i.test(e)));
  const liveDepth = scan.analyses.filter((a) => a.flow.confidence !== "low").length;

  return (
    <Section className="grid gap-3">
      <Field title="DATA CONFIDENCE & CLASSIFICATION" ticked right={<Chip tone="live">LIVE UPSTOX</Chip>}>
        <div className="p-3 grid md:grid-cols-2 gap-3 text-[11.5px] font-[var(--font-sans)] text-[#c9c3b6]">
          <p>
            Aggressor-side trade prints are <span className="amber">not available</span> from the provider for historical
            candles. Buyer/seller control here is therefore derived from candle-direction volume plus (when supplied) quoted
            depth imbalance, and every panel states its confidence tier. It is never presented as verified executed buy/sell
            volume.
          </p>
          <p>
            {scan.limitations.find((l) => l.includes("Aggressor")) ??
              "Control metrics are updated on every scan and re-evaluated at key zones."}
            <br />
            Instruments with moderate-or-better confidence: <span className="amber">{liveDepth}</span> / {scan.analyses.length}.
          </p>
        </div>
      </Field>

      <div className="grid grid-cols-2 md:grid-cols-5">
        <Stat label="Buyer dominant" value={buyer.length} tone="bull" sub="control ≥ 58%" />
        <Stat label="Seller dominant" value={seller.length} tone="bear" sub="control ≥ 58%" />
        <Stat label="Potential absorption" value={absorption.length} tone="warn" sub="pending price confirmation" />
        <Stat label="Rejection / supply" value={rejection.length} sub="at resistance" />
        <Stat label="Balanced" value={scan.analyses.length - buyer.length - seller.length} sub="no dominant side" />
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <Field title="BUYER-DOMINANT STOCKS" ticked>
          <ScanTable
            analyses={buyer.sort((a, b) => b.flow.buyerDominance - a.flow.buyerDominance)}
            cols={["symbol", "price", "chg", "flow", "bull", "quality", "status"]}
            onSelect={onSelect}
            emptyTitle="NO BUYER-DOMINANT INSTRUMENTS"
            emptyReason="No instrument currently shows buyer-side control above the 58% threshold in this scan."
          />
        </Field>
        <Field title="SELLER-DOMINANT STOCKS" ticked>
          <ScanTable
            analyses={seller.sort((a, b) => b.flow.sellerDominance - a.flow.sellerDominance)}
            cols={["symbol", "price", "chg", "flow", "bear", "quality", "status"]}
            onSelect={onSelect}
            emptyTitle="NO SELLER-DOMINANT INSTRUMENTS"
            emptyReason="No instrument currently shows seller-side control above the 58% threshold in this scan."
          />
        </Field>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <Field title="ORDER-BOOK IMBALANCE & DEPTH" right={<Chip>{liveDepth} with depth</Chip>}>
          <table className="tbl">
            <thead>
              <tr>
                <th className="nosort">SYMBOL</th>
                <th className="nosort">BUY PRES</th>
                <th className="nosort">SELL PRES</th>
                <th className="nosort">IMBALANCE</th>
                <th className="nosort">DOMINANCE</th>
                <th className="nosort">CONFIDENCE</th>
              </tr>
            </thead>
            <tbody>
              {scan.analyses.slice(0, 24).map((a) => (
                <tr key={a.meta.symbol} className="cursor-pointer" onClick={() => onSelect(a.meta.symbol)}>
                  <td>{a.meta.symbol}</td>
                  <td className="bull">{a.flow.buyingPressure}%</td>
                  <td className="bear">{a.flow.sellingPressure}%</td>
                  <td className={a.flow.imbalance >= 0 ? "bull" : "bear"}>{a.flow.imbalance > 0 ? "+" : ""}{a.flow.imbalance}</td>
                  <td className="amber">{a.flow.buyerDominance}</td>
                  <td className="mute">{a.flow.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Field>

        <Field title="ABSORPTION · REJECTION · ZONE RESPONSE">
          <div className="p-3 grid gap-2 text-[11.5px] font-[var(--font-sans)] max-h-[420px] overflow-y-auto">
            {scan.analyses.flatMap((a) =>
              a.flow.events.map((e) => (
                <button
                  key={`${a.meta.symbol}-${e}`}
                  className="text-left border-b border-[var(--color-line)] pb-1.5 hover:text-[var(--color-amber)]"
                  onClick={() => onSelect(a.meta.symbol)}
                >
                  <span className="amber">{a.meta.symbol}</span>{" "}
                  <Tone value={e} />
                </button>
              )),
            )}
            {!scan.analyses.some((a) => a.flow.events.length) ? (
              <span className="mute">No zone-interaction events recorded in this scan window.</span>
            ) : null}
          </div>
        </Field>
      </div>

      <Field title="DEMAND & SUPPLY ZONES (TOP OF BOOK)">
        <div className="grid md:grid-cols-3 gap-px bg-[var(--color-line)]">
          {scan.analyses.slice(0, 12).map((a) => (
            <button key={a.meta.symbol} className="bg-[var(--color-panel)] p-3 text-left hover:bg-[#12161c]" onClick={() => onSelect(a.meta.symbol)}>
              <div className="flex justify-between mb-2">
                <span className="amber text-[12px]">{a.meta.symbol}</span>
                <Tone value={a.flow.label} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <div className="lbl mb-1">DEMAND (SUPPORT)</div>
                  <div className="bull">{a.sr.primarySupport ? a.sr.primarySupport.price.toFixed(2) : "—"}</div>
                </div>
                <div>
                  <div className="lbl mb-1">SUPPLY (RESISTANCE)</div>
                  <div className="bear">{a.sr.primaryResistance ? a.sr.primaryResistance.price.toFixed(2) : "—"}</div>
                </div>
              </div>
              <div className="mt-2 text-[10.5px] mute leading-snug">{a.flow.confidenceNote.split(":")[0]}</div>
            </button>
          ))}
        </div>
      </Field>
    </Section>
  );
}
