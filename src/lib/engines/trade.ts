import type {
  FlowAnalysis,
  FuturesAnalysis,
  MomentumAnalysis,
  MomentumScores,
  OptionsAnalysis,
  SignalEvent,
  SRAudit,
  SymbolFeed,
  TradeSetup,
  UnderlyingAnalysis,
} from "../types";

export interface TradeInput {
  feed: SymbolFeed;
  u: UnderlyingAnalysis;
  f: FuturesAnalysis;
  o: OptionsAnalysis;
  sr: SRAudit;
  flow: FlowAnalysis;
  scores: MomentumScores;
  momentum: MomentumAnalysis;
}

/**
 * MODULE L + N — target / invalidation geometry and opportunity classification.
 * Every level originates from a detected zone or an ATR projection from one;
 * no arbitrary price targets are invented.
 */
export function buildTrade(input: TradeInput): TradeSetup {
  const { u, f, sr, scores, momentum, o } = input;
  const atrRef = u.atr ?? u.last * 0.005;
  const bull = scores.bull;
  const bear = scores.bear;
  const reasonsFor: string[] = [];
  const reasonsAgainst: string[] = [];

  const long = bull >= 60 && bull - bear >= 10;
  const short = bear >= 60 && bear - bull >= 10;
  const direction: TradeSetup["direction"] = long ? "LONG" : short ? "SHORT" : "NONE";

  if (direction === "NONE") {
    reasonsAgainst.push(`Confluence score below entry threshold (bull ${bull} / bear ${bear} — need 60 with a 10-point lead)`);
    if (scores.missing > 0) reasonsAgainst.push(`${scores.missing} scoring inputs missing — no actionable entry with incomplete data`);
    if (momentum.quality === "NEUTRAL / CONFLICTED") reasonsAgainst.push("Classification: neutral / conflicted");
    return {
      status: "NO TRADE",
      direction: "NONE",
      entryZone: null,
      confirmation: "No setup — monitor for stage development.",
      invalidation: null,
      target1: null,
      target2: null,
      riskReward: null,
      reasonsFor,
      reasonsAgainst,
      reversalRisk: "moderate",
    };
  }

  const side = direction === "LONG" ? "bull" : "bear";
  const structural = direction === "LONG" ? momentum.breakout.state === "genuine-breakout" : momentum.breakout.state === "genuine-breakdown";

  // Entry geometry
  let entry: [number, number];
  if (structural && momentum.breakout.level !== null) {
    const lvl = momentum.breakout.level;
    entry = direction === "LONG" ? [lvl, lvl + atrRef * 0.3] : [lvl - atrRef * 0.3, lvl];
  } else {
    entry =
      direction === "LONG"
        ? [round2(u.last - atrRef * 0.45), round2(u.last + atrRef * 0.05)]
        : [round2(u.last - atrRef * 0.05), round2(u.last + atrRef * 0.45)];
  }
  const entryMid = (entry[0] + entry[1]) / 2;

  // Invalidation — anchored to the protecting zone when it is close enough
  const protecting = direction === "LONG" ? sr.primarySupport : sr.primaryResistance;
  let invalidation: number;
  if (protecting && direction === "LONG" && protecting.price < entry[0] && entry[0] - protecting.low < atrRef * 1.6) {
    invalidation = round2(protecting.low - atrRef * 0.3);
  } else if (protecting && direction === "SHORT" && protecting.price > entry[1] && protecting.high - entry[1] < atrRef * 1.6) {
    invalidation = round2(protecting.high + atrRef * 0.3);
  } else {
    invalidation = direction === "LONG" ? round2(entry[0] - atrRef * 0.6) : round2(entry[1] + atrRef * 0.6);
  }

  // Targets — next structural zones first, ATR projection as fallback
  const above = [sr.primaryResistance, sr.secondaryResistance]
    .filter((z): z is NonNullable<typeof z> => !!z && z.price > entryMid + atrRef * 0.3)
    .sort((a, b) => a.price - b.price);
  const below = [sr.primarySupport, sr.secondarySupport]
    .filter((z): z is NonNullable<typeof z> => !!z && z.price < entryMid - atrRef * 0.3)
    .sort((a, b) => b.price - a.price);

  let t1: number;
  let t2: number;
  if (direction === "LONG") {
    t1 = above[0] ? round2(above[0].low) : round2(entryMid + atrRef * 1.2);
    t2 = above[1] ? round2(above[1].low) : round2(entryMid + atrRef * 2.4);
    if (t2 <= t1) t2 = round2(t1 + atrRef * 1.2);
  } else {
    t1 = below[0] ? round2(below[0].high) : round2(entryMid - atrRef * 1.2);
    t2 = below[1] ? round2(below[1].high) : round2(entryMid - atrRef * 2.4);
    if (t2 >= t1) t2 = round2(t1 - atrRef * 1.2);
  }

  const risk = Math.abs(entryMid - invalidation);
  const reward = Math.abs(t1 - entryMid);
  const rr = risk > 0 ? Math.round((reward / risk) * 100) / 100 : null;

  // Reasons
  const comp = (k: string) => scores.components.find((c) => c.key === k);
  if (momentum.genuine.length) reasonsFor.push(...momentum.genuine.slice(0, 4));
  const posC = comp("futures");
  if (posC) reasonsFor.push(`Futures: ${posC.reason}`);
  const optC = comp("options");
  if (optC) reasonsFor.push(`Options: ${optC.reason}`);
  if (sr.primarySupport && direction === "LONG") reasonsFor.push(`Support below at ${sr.primarySupport.price.toFixed(2)} — ${sr.primarySupport.label} (${sr.primarySupport.strength})`);
  if (sr.primaryResistance && direction === "SHORT") reasonsFor.push(`Resistance above at ${sr.primaryResistance.price.toFixed(2)} — ${sr.primaryResistance.label} (${sr.primaryResistance.strength})`);
  if (rr !== null && rr >= 1.5) reasonsFor.push(`Risk/reward ${rr.toFixed(2)} to target 1`);

  if (momentum.weak.length) reasonsAgainst.push(...momentum.weak.slice(0, 3));
  if (momentum.divergence.length) reasonsAgainst.push(...momentum.divergence.slice(0, 2));
  if (momentum.alignment15m === "countertrend") reasonsAgainst.push(momentum.alignmentNote);
  if (f.consistency === "mixed") reasonsAgainst.push("5-minute and 15-minute futures positioning disagree");
  if (o.alignment === "divergent") reasonsAgainst.push("Option premium response diverges from spot direction");
  if (scores.stale) reasonsAgainst.push("Feed stale — no actionable entry generated on stale data");
  if (rr !== null && rr < 1.2) reasonsAgainst.push(`Risk/reward only ${rr.toFixed(2)} to target 1`);
  const bestSel = direction === "LONG" ? o.bestCE : o.bestPE;
  if (!bestSel) reasonsAgainst.push("NO SUITABLE CONTRACT — no CE/PE strike passed liquidity and risk filters");
  else reasonsAgainst.push(`${direction === "LONG" ? "CE" : "PE"} strike ${bestSel.strike} score ${bestSel.score}/100 (${bestSel.liquidity} liquidity)`);

  // Status machine
  let status: TradeSetup["status"];
  if (momentum.stage === "STAGE 4: REVERSAL DEVELOPING") status = "EXIT/INVALIDATED";
  else if (momentum.stage === "STAGE 3: MOMENTUM EXHAUSTION") status = "EXHAUSTION WARNING";
  else if (scores.stale) status = "NO TRADE";
  else if (structural && scores.band === "HIGH_CONFLUENCE") status = "ACTIVE CONTINUATION";
  else if (structural) status = "ENTRY ELIGIBLE";
  else if (u.structure.retest && scores.band !== "WEAK") status = "RETEST OPPORTUNITY";
  else if (scores.band === "HIGH_CONFLUENCE") status = "ENTRY ELIGIBLE";
  else if (scores.band === "STRONG") status = "ENTRY CONFIRMATION PENDING";
  else if (scores.band === "DEVELOPING") status = "MOMENTUM BUILDING";
  else status = "WATCHLIST";

  const reversalRisk: TradeSetup["reversalRisk"] =
    momentum.stage.startsWith("STAGE 4") || momentum.stage.startsWith("STAGE 3")
      ? "high"
      : momentum.divergence.length > 0 || momentum.alignment15m === "countertrend"
        ? "moderate"
        : "low";

  const confirmation =
    `Confirm on a FINALIZED 5-minute close ${direction === "LONG" ? "above" : "below"} ${round2(direction === "LONG" ? entry[1] : entry[0])}` +
    ` with relative volume ≥ 1.15, ${direction === "LONG" ? "CE" : "PE"} premium holding ${direction === "LONG" ? "above" : "below"} its VWAP,` +
    ` and futures ${direction === "LONG" ? "long build-up / confirmed covering" : "short build-up / confirmed unwinding"} maintaining 5m↔15m consistency.`;

  void side;
  return {
    status,
    direction,
    entryZone: [entry[0], entry[1]],
    confirmation,
    invalidation,
    target1: t1,
    target2: t2,
    riskReward: rr,
    reasonsFor,
    reasonsAgainst,
    reversalRisk,
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** MODULE O/12 — alert & signal event derivation. */
export function deriveEvents(input: TradeInput, symbol: string, source: SymbolFeed["source"]): SignalEvent[] {
  const { u, f, sr, scores, momentum, flow, trade } = {
    ...input,
    trade: buildTrade(input),
  };
  const ts = Date.now();
  const out: SignalEvent[] = [];
  const push = (
    kind: string,
    severity: SignalEvent["severity"],
    direction: SignalEvent["direction"],
    title: string,
    detail: string,
  ) => out.push({ symbol, ts, kind, severity, direction, title, detail, source });

  const dir: "bull" | "bear" = scores.bull >= scores.bear ? "bull" : "bear";
  const top = Math.max(scores.bull, scores.bear);

  if (top >= 65)
    push(
      "strong-confirmation",
      "action",
      dir,
      `STRONG ${dir === "bull" ? "BULLISH" : "BEARISH"} CONFIRMATION`,
      `Score ${top}/100, grade ${scores.grade}, ${scores.confirmed} confirmed components, ${scores.conflicting} conflicting.`,
    );
  else if (scores.band === "DEVELOPING")
    push("momentum-building", "info", dir, "MOMENTUM BUILDING", `Score ${top}/100 — developing, ${scores.confirmed} components confirmed.`);

  push(
    "futures-positioning",
    f.positioning === "INSUFFICIENT DATA" ? "info" : "action",
    f.positioning === "LONG BUILD-UP" || f.positioning === "SHORT COVERING" ? "bull" : f.positioning === "SHORT BUILD-UP" || f.positioning === "LONG UNWINDING" ? "bear" : "neutral",
    f.positioning,
    `5m Δ${f.chg5Pct === null ? "—" : `${f.chg5Pct.toFixed(2)}%`}, OI Δ5m ${f.oiChg5 === null ? "—" : f.oiChg5.toLocaleString("en-IN")}, OI Δsession ${f.oiChgSession === null ? "—" : f.oiChgSession.toLocaleString("en-IN")}, consistency ${f.consistency}. ${f.confirmations[0] ?? ""}`,
  );

  if (sr.primarySupport) {
    const l = sr.primarySupport.label;
    push(
      "support-zone",
      l.includes("Breakdown") ? "warn" : l.includes("Strong") || l.includes("Strengthening") ? "info" : "info",
      "bull",
      l.toUpperCase(),
      `${sr.primarySupport.price.toFixed(2)} strength ${sr.primarySupport.strength}/100, sources: ${sr.primarySupport.sources.join(", ")}`,
    );
  }
  if (sr.primaryResistance) {
    const l = sr.primaryResistance.label;
    push("resistance-zone", l.includes("Breakout") ? "warn" : "info", "bear", l.toUpperCase(), `${sr.primaryResistance.price.toFixed(2)} strength ${sr.primaryResistance.strength}/100, sources: ${sr.primaryResistance.sources.join(", ")}`);
  }

  if (momentum.breakout.state === "genuine-breakout")
    push("breakout", "action", "bull", "GENUINE BREAKOUT", momentum.breakout.detail);
  else if (momentum.breakout.state === "genuine-breakdown")
    push("breakdown", "action", "bear", "GENUINE BREAKDOWN", momentum.breakout.detail);
  else if (momentum.breakout.state === "false-breakout-risk")
    push("false-breakout", "warn", "bear", "FALSE BREAKOUT RISK", momentum.breakout.detail);
  else if (momentum.breakout.state === "false-breakdown-risk")
    push("false-breakdown", "warn", "bull", "FALSE BREAKDOWN RISK", momentum.breakout.detail);

  for (const d of momentum.divergence) push("divergence", "warn", dir, "MOMENTUM DIVERGENCE", d);
  if (momentum.stage === "STAGE 3: MOMENTUM EXHAUSTION")
    push("exhaustion", "warn", dir, "MOMENTUM EXHAUSTION", `Momentum persists while participation fades — ${momentum.weak[0] ?? "volume/premium response weakening"}.`);
  if (momentum.stage === "STAGE 4: REVERSAL DEVELOPING")
    push("reversal-warning", "critical", dir, "REVERSAL WARNING", momentum.alignmentNote);
  if (momentum.alignment15m === "countertrend")
    push("countertrend", "warn", dir, `COUNTERTREND ${dir === "bull" ? "BULLISH" : "BEARISH"} SETUP`, momentum.alignmentNote);

  if (trade.status === "ENTRY ELIGIBLE" || trade.status === "ACTIVE CONTINUATION" || trade.status === "RETEST OPPORTUNITY")
    push("entry-confirmation", "action", trade.direction === "LONG" ? "bull" : "bear", `${trade.status}`, `Entry ${trade.entryZone?.map((x) => x.toFixed(2)).join("–")} · invalidation ${trade.invalidation?.toFixed(2)} · T1 ${trade.target1?.toFixed(2)} · R:R ${trade.riskReward ?? "—"}`);
  if (trade.status === "EXIT/INVALIDATED")
    push("trade-invalidation", "critical", dir, "TRADE INVALIDATION", trade.reasonsAgainst[0] ?? "Setup invalidated.");
  if (flow.label !== "BALANCED")
    push("flow", "info", flow.label === "BUYER DOMINANT" ? "bull" : "bear", flow.label, `${flow.buyerDominance}% buyer / ${flow.sellerDominance}% seller control — ${flow.confidence} confidence.`);

  void u;
  return out;
}
