"use client";

import { useMemo, useRef, useState } from "react";
import type { ScanResult, SymbolAnalysis } from "@/lib/types";
import { fmtNum } from "@/lib/math";
import { Chip, Empty, Field, Section, Stat } from "../ui";
import OiLadder from "../OiLadder";

/**
 * OI INTELLIGENCE — searchable selector over the FULL OI-enabled universe.
 * Keyboard: ↑/↓ move, Enter selects, Esc clears. Selection survives a scan
 * refresh as long as the stock still exists; if it disappears the exact reason
 * is shown instead of silently substituting another stock.
 */
export default function OiIntel({ scan, onSelect }: { scan: ScanResult; onSelect: (s: string) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const withOi = useMemo(
    () =>
      scan.analyses
        .filter((a) => a.options.strikes.length > 0)
        .sort((a, b) => a.meta.symbol.localeCompare(b.meta.symbol)),
    [scan.analyses],
  );
  const incompleteOi = useMemo(
    () => scan.analyses.filter((a) => a.options.strikes.length === 0),
    [scan.analyses],
  );

  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return withOi;
    return withOi.filter((a) => a.meta.symbol.includes(q) || a.meta.name.toUpperCase().includes(q));
  }, [withOi, query]);

  const selected: SymbolAnalysis | null = sel ? (scan.analyses.find((a) => a.meta.symbol === sel) ?? null) : null;
  const selectedHasOi = !!selected && selected.options.strikes.length > 0;
  const removedReason = sel && !selected ? `Stock ${sel} is no longer in the scan universe (instrument master or fetch change).` : null;
  const noOiReason = sel && selected && !selectedHasOi ? `${sel} has no option-chain data: ${selected.missing.join(", ") || "chain unavailable for the selected expiry"}.` : null;

  const step = selected ? selected.meta.strikeInterval || 10 : 10;
  const ladderRows = selectedHasOi
    ? selected!.options.strikes.filter((r) => Math.abs(r.strike - selected!.options.atm) <= step * 3 + 1e-6)
    : [];

  const pick = (symbol: string) => {
    setSel(symbol);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setCursor((c) => Math.min(matches.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (matches[cursor]) pick(matches[cursor].meta.symbol);
    } else if (e.key === "Escape") {
      setSel(null);
      setQuery("");
      setOpen(false);
    }
  };

  return (
    <Section className="grid gap-3">
      <Field
        title="SELECT UNDERLYING · SEARCHABLE"
        right={
          <span className="flex gap-2 items-center flex-wrap justify-end">
            <Chip>{withOi.length} OI-enabled</Chip>
            <Chip tone={incompleteOi.length ? "warn" : ""}>{incompleteOi.length} without OI</Chip>
          </span>
        }
      >
        <div className="p-3 grid gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="lbl" htmlFor="oi-search">
              SEARCH STOCK
            </label>
            <div className="relative">
              <input
                id="oi-search"
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOpen(true);
                  setCursor(0);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={onKey}
                placeholder="SYMBOL OR NAME — e.g. RELIANCE"
                className="w-[260px] pr-8"
                autoComplete="off"
                role="combobox"
                aria-expanded={open}
                aria-controls="oi-listbox"
              />
              {query ? (
                <button
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-[11px] mute px-1.5"
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                  type="button"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              ) : null}
              {open && query ? (
                <ul
                  id="oi-listbox"
                  role="listbox"
                  className="absolute z-30 mt-1 left-0 w-full max-h-[260px] overflow-auto border border-[var(--color-line2)] bg-[#0b0d10] shadow-xl"
                >
                  {matches.slice(0, 60).map((a, i) => (
                    <li key={a.meta.symbol} role="option" aria-selected={i === cursor}>
                      <button
                        type="button"
                        className={`w-full text-left px-2.5 py-2 text-[12px] ${i === cursor ? "bg-[#171208] text-[var(--color-amber)]" : "hover:bg-[#12161c]"}`}
                        onMouseEnter={() => setCursor(i)}
                        onClick={() => pick(a.meta.symbol)}
                      >
                        <span className="font-semibold">{a.meta.symbol}</span>
                        <span className="mute ml-2 text-[11px]">{a.meta.name}</span>
                        <span className="mute ml-2 text-[10px]">{a.options.strikes.length} strikes</span>
                      </button>
                    </li>
                  ))}
                  {!matches.length ? (
                    <li className="px-2.5 py-2 text-[11.5px] mute">No OI-enabled stock matches “{query}”.</li>
                  ) : null}
                </ul>
              ) : null}
            </div>
            <button
              className="btn !py-1.5"
              type="button"
              onClick={() => {
                setSel(null);
                setQuery("");
                setOpen(false);
              }}
            >
              CLEAR SELECTION
            </button>
            {selected ? <Chip tone="live">SELECTED · {selected.meta.symbol}</Chip> : null}
          </div>

          {removedReason ? (
            <p className="text-[11.5px] warn font-[var(--font-sans)]">{removedReason}</p>
          ) : null}
          {noOiReason ? <p className="text-[11.5px] warn font-[var(--font-sans)]">{noOiReason}</p> : null}
          {!sel && !removedReason ? (
            <p className="text-[11px] mute font-[var(--font-sans)]">
              Search by symbol or name (↑/↓ to move, Enter to open, Esc to clear). All {withOi.length} OI-enabled instruments are
              searchable — not just the top N.
            </p>
          ) : null}
        </div>

        {incompleteOi.length ? (
          <div className="border-t border-[var(--color-line)] px-3 py-2 flex flex-wrap gap-1.5 items-center">
            <span className="lbl mr-1">NO OI DATA:</span>
            {incompleteOi.slice(0, 40).map((a) => (
              <button
                key={a.meta.symbol}
                className="chip !py-1"
                style={{ cursor: "pointer" }}
                title={a.missing.join(", ")}
                onClick={() => onSelect(a.meta.symbol)}
                type="button"
              >
                {a.meta.symbol}
              </button>
            ))}
          </div>
        ) : null}
      </Field>

      {selected && selectedHasOi ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5">
            <Stat label="Instrument" value={selected.meta.symbol} sub={selected.meta.name} />
            <Stat label="Spot" value={fmtNum(selected.price)} sub={`${selected.changePct.toFixed(2)}%`} tone={selected.changePct >= 0 ? "bull" : "bear"} />
            <Stat label="ATM strike" value={fmtNum(selected.options.atm, 0)} tone="amber" sub={`step ${selected.meta.strikeInterval}`} />
            <Stat label="Expiry" value={selected.options.expiry} sub={`${ladderRows.length} strikes within ATM ±3`} />
            <Stat
              label="CE / PE bias"
              value={`${selected.options.ceBias.slice(0, 3).toUpperCase()} / ${selected.options.peBias.slice(0, 3).toUpperCase()}`}
              sub={selected.options.alignment}
            />
          </div>

          <Field
            title={`FOUR OI WINDOWS · ${selected.meta.symbol} · ATM ${selected.options.atm} · ±3 STRIKES`}
            ticked
            right={
              <span className="flex gap-2">
                <Chip tone="live">LIVE UPSTOX</Chip>
                <button className="btn !py-1 !px-2" type="button" onClick={() => onSelect(selected.meta.symbol)}>
                  OPEN DETAIL
                </button>
              </span>
            }
          >
            <OiLadder rows={ladderRows} atm={selected.options.atm} span={3} />
          </Field>

          <Field title="CALCULATION DEFINITIONS" ticked>
            <ul className="p-3 grid gap-2 text-[11.5px] font-[var(--font-sans)] text-[#c9c3b6] leading-snug">
              <li>
                <span className="amber">5-minute ΔOI</span> = OI now − OI ≈5 minutes earlier (180s tolerance).{" "}
                <span className="amber">15-minute ΔOI</span> uses ≈15 minutes.
              </li>
              <li>
                <span className="amber">Session ΔOI</span> = current OI − earliest session observation; if that baseline is absent the value is
                reported as unavailable — never as zero.
              </li>
              <li>
                <span className="amber">Total OI</span> = latest reported OI. Session change is never added back on top of it (double-count guard).
              </li>
              <li className="warn">Missing windows render as N/A; strike spacing is taken from the actual listed strikes of this instrument.</li>
            </ul>
          </Field>
        </>
      ) : (
        <Field title="OI STRIKE LADDER">
          <Empty
            title="SELECT AN UNDERLYING"
            reason="Use the searchable selector above to open a stock's four-window OI ladder (5-minute, 15-minute, session and total OI for CE and PE at ATM ±3)."
          />
        </Field>
      )}
    </Section>
  );
}
