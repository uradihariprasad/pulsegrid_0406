import { clamp } from "../indicators";
import type { OiMomentum, StrikeRow, SymbolFeed, UnderlyingAnalysis, FuturesAnalysis, OptionsAnalysis } from "../types";

/**
 * MODULE E+ — strike-wise OI momentum (PART 7).
 *
 * Interprets rolling CE/PE OI changes WITH premium movement, because an OI
 * increase on its own is not proof of writing:
 *
 *   CE OI↑ + CE premium↓ → CALL WRITING      (bearish: resistance being written)
 *   CE OI↓ + CE premium↑ → CALL UNWINDING    (bullish: resistance removed)
 *   CE OI↑ + CE premium↑ → CALL LONG BUILD   (bullish, unconfirmed)
 *   CE OI↓ + CE premium↓ → CALL LONG OUT     (bearish)
 *   PE OI↑ + PE premium↓ → PUT WRITING       (bullish: support being written)
 *   PE OI↓ + PE premium↑ → PUT UNWINDING     (bearish: support removed)
 *   PE OI↑ + PE premium↑ → PUT LONG BUILD    (bearish, unconfirmed)
 *   PE OI↓ + PE premium↓ → PUT LONG OUT      (bullish)
 *
 * Missing OI or missing premium ⇒ no contribution at all (never zero-filled).
 * 5-minute and 15-minute windows must agree with the session change to earn
 * full confidence; disagreement is down-weighted and reported.
 */
export function analyzeOiMomentum(
  feed: SymbolFeed,
  u: UnderlyingAnalysis,
  f: FuturesAnalysis,
  o: OptionsAnalysis,
): OiMomentum {
  const rows: StrikeRow[] = o.strikes;
  const empty = (note: string): OiMomentum => ({
    available: false,
    score: 0,
    direction: 0,
    bull: null,
    bear: null,
    atmStrike: o.atm || null,
    ceSession: null,
    peSession: null,
    ce5m: null,
    pe5m: null,
    ce15m: null,
    pe15m: null,
    strikes: [],
    labels: [],
    bullish: [],
    bearish: [],
    windowAgreement: "unknown",
    futuresAgreement: "unknown",
    priceAgreement: "unknown",
    note,
  });

  if (!rows.length || feed.options.length === 0) {
    return empty("Option chain unavailable — strike-wise OI momentum cannot be evaluated.");
  }

  const step = feed.meta.strikeInterval || 1;
  const span = step * 3;
  const near = rows.filter((r) => Math.abs(r.strike - o.atm) <= span + 1e-6);
  if (!near.length) return empty("No strikes within ATM ±3 — OI momentum unavailable.");

  let bull = 0;
  let bear = 0;
  let weight = 0;
  const labels = new Set<string>();
  const bullish: string[] = [];
  const bearish: string[] = [];
  const strikeRows: OiMomentum["strikes"] = [];
  let agreeCount = 0;
  let counted = 0;

  for (const r of near) {
    const proximity = 1 - Math.abs(r.strike - o.atm) / (span + step);
    const w = clamp(0.35 + proximity * 0.65, 0.2, 1) * (r.atm ? 1.35 : 1);
    strikeRows.push({
      strike: r.strike,
      ceOi5: r.ce?.oiChg5 ?? null,
      peOi5: r.pe?.oiChg5 ?? null,
      ceOiSession: r.ce?.oiChgSession ?? null,
      peOiSession: r.pe?.oiChgSession ?? null,
    });

    for (const side of ["CE", "PE"] as const) {
      const a = side === "CE" ? r.ce : r.pe;
      if (!a) continue;
      const oiS = a.oiChgSession;
      const prem = a.changePct;
      if (oiS === null || prem === null) continue; // missing → skip, never 0
      const oiUp = oiS > 0;
      const oiDn = oiS < 0;
      const premUp = prem > 0.05;
      const premDn = prem < -0.05;
      if (!oiUp && !oiDn) continue;
      if (!premUp && !premDn) continue;

      let ev: "bull" | "bear" | null = null;
      let label = "";
      if (side === "CE") {
        if (oiUp && premDn) {
          ev = "bear";
          label = "CALL WRITING";
        } else if (oiDn && premUp) {
          ev = "bull";
          label = "CALL UNWINDING";
        } else if (oiUp && premUp) {
          ev = "bull";
          label = "CALL LONG BUILD (unconfirmed)";
        } else if (oiDn && premDn) {
          ev = "bear";
          label = "CALL LONG UNWINDING";
        }
      } else {
        if (oiUp && premDn) {
          ev = "bull";
          label = "PUT WRITING";
        } else if (oiDn && premUp) {
          ev = "bear";
          label = "PUT UNWINDING";
        } else if (oiUp && premUp) {
          ev = "bear";
          label = "PUT LONG BUILD (unconfirmed)";
        } else if (oiDn && premDn) {
          ev = "bull";
          label = "PUT LONG UNWINDING";
        }
      }
      if (!ev || !label) continue;

      // window agreement: 5m and 15m OI changes must point the same way
      const w5 = a.oiChg5;
      const w15 = a.oiChg15;
      let agree = true;
      counted++;
      if (w5 !== null && w15 !== null) {
        agree = (w5 >= 0) === (w5 === 0 || w15 >= 0) && Math.sign(w5) === Math.sign(w15) || (w5 === 0 && w15 === 0);
        agree = (w5 > 0) === (w15 > 0) && Math.sign(oiS) === Math.sign(w15 || oiS);
        if (agree) agreeCount++;
      }
      const conf = w * (agree ? 1.25 : 0.7) * (Math.min(1, Math.abs(oiS) / 250_000) * 0.5 + 0.75);

      if (ev === "bull") {
        bull += conf;
        bullish.push(`${r.strike} ${label}`);
      } else {
        bear += conf;
        bearish.push(`${r.strike} ${label}`);
      }
      weight += conf;
      labels.add(label);
    }
  }

  if (weight === 0) {
    return empty("No strike combined OI change with premium movement — OI activity reported as unavailable rather than assumed.");
  }

  const net = (bull - bear) / weight;
  const direction: -1 | 0 | 1 = net > 0.15 ? 1 : net < -0.15 ? -1 : 0;
  const windowAgreement: OiMomentum["windowAgreement"] =
    counted === 0 ? "unknown" : agreeCount / counted >= 0.6 ? "aligned" : "mixed";

  const atmRow = near.find((r) => r.atm) ?? near[Math.floor(near.length / 2)];
  const futBull = f.positioning === "LONG BUILD-UP" || f.positioning === "SHORT COVERING";
  const futBear = f.positioning === "SHORT BUILD-UP" || f.positioning === "LONG UNWINDING";
  const futuresAgreement: OiMomentum["futuresAgreement"] =
    direction === 0 || (f.positioning === "INSUFFICIENT DATA")
      ? "unknown"
      : (direction > 0 && futBull) || (direction < 0 && futBear)
        ? "aligned"
        : "divergent";
  const priceAgreement: OiMomentum["priceAgreement"] =
    direction === 0 || Math.abs(u.changePct) < 0.05
      ? "unknown"
      : (direction > 0 && u.changePct > 0) || (direction < 0 && u.changePct < 0)
        ? "aligned"
        : "divergent";

  return {
    available: true,
    score: Math.round(Math.abs(net) * 100),
    direction,
    bull: clamp(bull / weight),
    bear: clamp(bear / weight),
    atmStrike: atmRow?.strike ?? o.atm ?? null,
    ceSession: atmRow?.ce?.oiChgSession ?? null,
    peSession: atmRow?.pe?.oiChgSession ?? null,
    ce5m: atmRow?.ce?.oiChg5 ?? null,
    pe5m: atmRow?.pe?.oiChg5 ?? null,
    ce15m: atmRow?.ce?.oiChg15 ?? null,
    pe15m: atmRow?.pe?.oiChg15 ?? null,
    strikes: strikeRows,
    labels: Array.from(labels),
    bullish: Array.from(new Set(bullish)).slice(0, 8),
    bearish: Array.from(new Set(bearish)).slice(0, 8),
    windowAgreement,
    futuresAgreement,
    priceAgreement,
    note:
      "OI ADDITION alone is never treated as writing: writing/unwinding is only claimed when OI change and premium move in opposite directions. " +
      `Windows: ${windowAgreement}; futures: ${futuresAgreement}; price: ${priceAgreement}.`,
  };
}
