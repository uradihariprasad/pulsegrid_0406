import { clamp } from "../indicators";
import { marketPhase } from "../math";
import type {
  FlowAnalysis,
  FuturesAnalysis,
  MomentumScores,
  OptionsAnalysis,
  OiMomentum,
  SRAudit,
  ScoreComponent,
  SymbolFeed,
  UnderlyingAnalysis,
} from "../types";

export interface ScoreInput {
  feed: SymbolFeed;
  u: UnderlyingAnalysis;
  f: FuturesAnalysis;
  o: OptionsAnalysis;
  sr: SRAudit;
  flow: FlowAnalysis;
  oi: OiMomentum;
}

/**
 * Weights (PART 7.E — initial design values, explicitly NOT calibrated
 * probabilities): structure 20 · futures 15 · relative volume 10 · options
 * premium 10 · strike-wise OI momentum 15 · S/R 15 · persistence 15 = 100.
 */
const W = {
  structure: 20,
  futures: 15,
  relVol: 10,
  options: 10,
  oi: 15,
  sr: 15,
  persistence: 15,
} as const;

/**
 * MODULE I — Unified momentum scoring.
 *
 * Weights: structure 20, futures positioning 20, relative volume 15, options
 * premium 15, S/R confirmation 15, volatility & persistence 15 (=100).
 * Missing components contribute NOTHING: the denominator only counts weights
 * whose inputs were actually observed, and the missing count is reported.
 * Scores are heuristic confluence scores — they are not calibrated
 * probabilities and are labelled as such throughout the UI.
 */
export function scoreMomentum(input: ScoreInput): MomentumScores {
  const { feed, u, f, o, sr, flow } = input;

  // 1. Underlying structure & trend
  const totalBull = u.conditions.bullish.length;
  const totalBear = u.conditions.bearish.length;
  const sBull = clamp((u.bullMet + (u.structure.trend === "up" ? 1.5 : 0)) / (totalBull + 1.5));
  const sBear = clamp((u.bearMet + (u.structure.trend === "down" ? 1.5 : 0)) / (totalBear + 1.5));

  // 2. Futures positioning
  let sFutBull: number | null = null;
  let sFutBear: number | null = null;
  let futReason = "";
  switch (f.positioning) {
    case "LONG BUILD-UP":
      sFutBull = 0.9;
      sFutBear = 0.1;
      futReason = "price up + OI up";
      break;
    case "SHORT COVERING":
      sFutBull = 0.6;
      sFutBear = 0.25;
      futReason = "price up + OI down (position closing, weaker continuation)";
      break;
    case "SHORT BUILD-UP":
      sFutBull = 0.1;
      sFutBear = 0.9;
      futReason = "price down + OI up";
      break;
    case "LONG UNWINDING":
      sFutBull = 0.25;
      sFutBear = 0.6;
      futReason = "price down + OI down (position closing, weaker continuation)";
      break;
    default:
      sFutBull = null;
      sFutBear = null;
      futReason = "futures price/OI reference unavailable";
  }
  if (sFutBull !== null && sFutBear !== null) {
    const adj = f.consistency === "aligned" ? 0.08 : f.consistency === "mixed" ? -0.15 : 0;
    sFutBull = clamp(sFutBull + adj);
    sFutBear = clamp(sFutBear + adj);
  }

  // 3. Relative volume
  const sRelVol =
    u.relVol === null ? null : clamp((u.relVol - 0.55) / 1.15);
  const rvReason = u.relVol === null ? "volume history < 20 bars" : `${u.relVol.toFixed(2)}× 20-bar mean`;

  // 4. Options premium confirmation
  let sOptBull: number | null = null;
  let sOptBear: number | null = null;
  let optReason = o.alignmentNote;
  if (o.alignment === "unavailable") {
    sOptBull = null;
    sOptBear = null;
    optReason = "option contracts unavailable";
  } else {
    const strikeAdj = (side: "CE" | "PE") => {
      const sel = side === "CE" ? o.bestCE : o.bestPE;
      return sel ? clamp(sel.score / 100) : null;
    };
    const ceS = strikeAdj("CE");
    const peS = strikeAdj("PE");
    if (o.alignment === "aligned") {
      sOptBull = u.bias === "bullish" ? clamp(0.75 * (ceS ?? 0.6)) : clamp(0.75 * (peS ?? 0.6));
      sOptBear = u.bias === "bearish" ? clamp(0.75 * (peS ?? 0.6)) : clamp(0.75 * (ceS ?? 0.6));
    } else if (o.alignment === "divergent") {
      sOptBull = u.bias === "bullish" ? 0.12 : 0.55;
      sOptBear = u.bias === "bearish" ? 0.12 : 0.55;
      optReason = `${o.alignmentNote} (weight applied to the opposing side)`;
    } else {
      sOptBull = u.bias === "bullish" ? 0.4 : 0.45;
      sOptBear = u.bias === "bearish" ? 0.4 : 0.45;
    }
  }

  // 5. S/R confirmation
  const sSr = srScore(sr, u);
  const sSrBull = sSr.bull;
  const sSrBear = sSr.bear;

  // 6. Volatility & momentum persistence
  const slopeOkBull = u.emaSlope.s9 !== null && u.emaSlope.s9 > 0 ? 1 : 0;
  const slopeOkBear = u.emaSlope.s9 !== null && u.emaSlope.s9 < 0 ? 1 : 0;
  const volTrendBull = u.volumeTrend === "expanding" ? 1 : u.volumeTrend === "flat" ? 0.5 : u.volumeTrend === "contracting" ? 0.2 : null;
  const aligned15 = f.chg15Pct !== null;
  const persBull = clamp(
    0.45 * slopeOkBull +
      0.25 * (volTrendBull ?? 0.4) +
      0.15 * (aligned15 && (f.chg15Pct as number) > 0 ? 1 : 0) +
      0.15 * (u.bb.expanding ? 1 : 0.4),
  );
  const persBear = clamp(
    0.45 * slopeOkBear +
      0.25 * (volTrendBull === null ? 0.4 : 1 - volTrendBull) +
      0.15 * (aligned15 && (f.chg15Pct as number) < 0 ? 1 : 0) +
      0.15 * (u.bb.expanding ? 1 : 0.4),
  );

  const components: ScoreComponent[] = [
    {
      key: "structure",
      label: "Underlying price structure & trend",
      weight: W.structure,
      bull: sBull,
      bear: sBear,
      conflict: sBull < 0.35 && sBear > 0.6,
      reason: `${u.bullMet}/${totalBull} bullish and ${u.bearMet}/${totalBear} bearish conditions met; structure ${u.structure.trend}`,
    },
    {
      key: "futures",
      label: "Futures positioning",
      weight: W.futures,
      bull: sFutBull,
      bear: sFutBear,
      conflict: sFutBull !== null && sFutBear !== null && Math.abs(sFutBull - sFutBear) < 0.15,
      reason: `${f.positioning} (${futReason}), 5m/15m ${f.consistency}`,
    },
    {
      key: "relVol",
      label: "Relative volume",
      weight: W.relVol,
      bull: sRelVol,
      bear: sRelVol,
      conflict: false,
      reason: rvReason,
    },
    {
      key: "options",
      label: "Options premium confirmation",
      weight: W.options,
      bull: sOptBull,
      bear: sOptBear,
      conflict: o.alignment === "divergent",
      reason: optReason,
    },
    {
      key: "oi",
      label: "Strike-wise OI momentum",
      weight: W.oi,
      bull: input.oi.bull,
      bear: input.oi.bear,
      conflict: input.oi.futuresAgreement === "divergent" || input.oi.priceAgreement === "divergent",
      reason: input.oi.available
        ? `${input.oi.labels.join(", ") || "no confirmed OI pattern"} — windows ${input.oi.windowAgreement}, futures ${input.oi.futuresAgreement}, price ${input.oi.priceAgreement}`
        : `unavailable: ${input.oi.note}`,
    },
    {
      key: "sr",
      label: "Support / resistance confirmation",
      weight: W.sr,
      bull: sSrBull,
      bear: sSrBear,
      conflict: false,
      reason: sSr.reason,
    },
    {
      key: "persistence",
      label: "Volatility & momentum persistence",
      weight: W.persistence,
      bull: persBull,
      bear: persBear,
      conflict: false,
      reason: `ATR ${u.atrPct === null ? "n/a" : `${u.atrPct.toFixed(2)}%`}, EMA9 slope ${u.emaSlope.s9 === null ? "n/a" : u.emaSlope.s9.toFixed(2)}, volume ${u.volumeTrend ?? "n/a"}, BB ${u.bb.expanding ? "expanding" : "contracting"}`,
    },
  ];

  const compute = (side: "bull" | "bear") => {
    let wSum = 0;
    let acc = 0;
    let missing = 0;
    let confirmed = 0;
    let conflicting = 0;
    for (const c of components) {
      const v = c[side];
      if (v === null) {
        missing++;
        continue;
      }
      wSum += c.weight;
      acc += c.weight * v;
      const other = c[side === "bull" ? "bear" : "bull"];
      if (v >= 0.6 && (other === null || v >= other)) confirmed++;
      if (other !== null && other - v >= 0.25) conflicting++;
      if (c.conflict && v < 0.5) conflicting++;
    }
    const score = wSum ? Math.round((acc / wSum) * 100) : 0;
    return { score, confirmed, conflicting, missing };
  };

  const b = compute("bull");
  const bear = compute("bear");
  const top = Math.max(b.score, bear.score);
  const band: MomentumScores["band"] =
    top >= 80 ? "HIGH_CONFLUENCE" : top >= 65 ? "STRONG" : top >= 50 ? "DEVELOPING" : top >= 30 ? "WEAK" : "NONE";
  const grade =
    band === "HIGH_CONFLUENCE"
      ? "A — high confluence"
      : band === "STRONG"
        ? "B — strong candidate"
        : band === "DEVELOPING"
          ? "C — developing"
          : band === "WEAK"
            ? "D — weak / conflicting"
            : "E — no confirmed momentum";

  const freshnessMs = Math.max(0, Date.now() - feed.asOf);
  // Data is only "stale" while the exchange is actually trading. Outside
  // session hours the latest completed session is the freshest available data
  // and is labelled HISTORICAL upstream rather than flagged stale.
  const phase = marketPhase(Date.now());
  const streaming = phase === "OPEN" || phase === "PRE-OPEN";
  const stale = feed.source === "live" && streaming && freshnessMs > 60_000;

  return {
    bull: b.score,
    bear: bear.score,
    grade,
    band,
    components,
    confirmed: b.score >= bear.score ? b.confirmed : bear.confirmed,
    conflicting: b.score >= bear.score ? b.conflicting : bear.conflicting,
    missing: b.missing + bear.missing,
    freshnessMs,
    stale,
  };
}

function srScore(sr: SRAudit, u: UnderlyingAnalysis): { bull: number; bear: number; reason: string } {
  const ps = sr.primarySupport;
  const pr = sr.primaryResistance;
  if (!ps && !pr) return { bull: 0.45, bear: 0.45, reason: "no S/R zones constructed" };
  const atrRef = u.atr ?? u.last * 0.005;

  let bull = 0.45;
  let bear = 0.45;
  const parts: string[] = [];

  if (pr) {
    const dist = pr.price - u.last;
    if (dist < atrRef * 0.5) {
      const breakoutRisk = pr.label.includes("Breakout Risk");
      const weakening = pr.label.includes("Weakening");
      bull = breakoutRisk || weakening ? 0.72 : 0.35;
      bear = breakoutRisk ? 0.3 : 0.6;
      parts.push(`at resistance ${pr.price.toFixed(2)} (${pr.label}, ${pr.strength})`);
    } else if (dist > atrRef * 2.5) {
      bull = 0.7;
      parts.push(`cleared resistance room (${pr.label})`);
    }
  }
  if (ps) {
    const dist = u.last - ps.price;
    if (dist < atrRef * 0.5) {
      const breakdownRisk = ps.label.includes("Breakdown Risk");
      const strengthening = ps.label.includes("Strengthening") || ps.label.includes("Strong");
      bear = breakdownRisk ? 0.72 : 0.35;
      bull = breakdownRisk ? 0.3 : strengthening ? 0.68 : 0.5;
      parts.push(`at support ${ps.price.toFixed(2)} (${ps.label}, ${ps.strength})`);
    } else if (dist > atrRef * 2.5) {
      bear = 0.7;
      parts.push(`above support with room (${ps.label})`);
    }
  }
  return { bull: clamp(bull), bear: clamp(bear), reason: parts.join("; ") || "balanced location" };
}
