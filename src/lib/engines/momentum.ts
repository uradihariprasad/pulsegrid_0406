import { ema, close, last, pct, relativeVolume } from "../indicators";
import type {
  FlowAnalysis,
  FuturesAnalysis,
  MomentumAnalysis,
  OptionsAnalysis,
  QualityLabel,
  SRAudit,
  SymbolFeed,
  UnderlyingAnalysis,
} from "../types";

export interface QualityInput {
  feed: SymbolFeed;
  u: UnderlyingAnalysis;
  f: FuturesAnalysis;
  o: OptionsAnalysis;
  sr: SRAudit;
  flow: FlowAnalysis;
  bull: number;
  bear: number;
}

const BULL_POS = ["LONG BUILD-UP", "SHORT COVERING"];
const BEAR_POS = ["SHORT BUILD-UP", "LONG UNWINDING"];

/** 15-minute trend context (secondary confirmation timeframe). */
export function read15m(feed: SymbolFeed): { bias: "bullish" | "bearish" | "neutral"; chgPct: number | null } {
  const c = feed.spot15;
  if (c.length < 3) return { bias: "neutral", chgPct: null };
  const cl = close(c);
  const e9 = last(ema(cl, 9));
  const e21 = last(ema(cl, 21));
  const chg = pct(c[c.length - 1].c, feed.spotQuote.prevClose);
  let bias: "bullish" | "bearish" | "neutral" = "neutral";
  if (e9 !== null && e21 !== null) {
    if (e9 > e21 && chg > 0.15) bias = "bullish";
    else if (e9 < e21 && chg < -0.15) bias = "bearish";
  }
  return { bias, chgPct: chg };
}

/**
 * MODULE H + J + K — genuine vs weak momentum, momentum stage, and
 * breakout/breakdown validation. Every label carries explicit reasons.
 */
export function assessQuality(input: QualityInput): MomentumAnalysis {
  const { feed, u, f, o, sr, flow, bull, bear } = input;
  const t15 = read15m(feed);
  const divergence: string[] = [];
  const genuine: string[] = [];
  const weak: string[] = [];

  const dir: "bull" | "bear" | null = bull >= bear + 8 ? "bull" : bear >= bull + 8 ? "bear" : null;

  // --- 15m alignment
  let alignment15m: MomentumAnalysis["alignment15m"] = "neutral";
  if (dir === "bull" && t15.bias === "bearish") alignment15m = "countertrend";
  else if (dir === "bear" && t15.bias === "bullish") alignment15m = "countertrend";
  else if ((dir === "bull" && t15.bias === "bullish") || (dir === "bear" && t15.bias === "bearish")) alignment15m = "aligned";
  const alignmentNote =
    alignment15m === "countertrend"
      ? `${dir === "bull" ? "BULLISH" : "BEARISH"} 5-minute signal against a ${t15.bias.toUpperCase()} 15-minute trend — COUNTERTREND ${dir === "bull" ? "BULLISH" : "BEARISH"} SETUP (additional risk, weaker trend alignment; not suppressed).`
      : alignment15m === "aligned"
        ? `5-minute and 15-minute trends agree (${t15.bias}).`
        : "15-minute context neutral — no trend confirmation or conflict.";

  // --- divergence detection (warnings, never auto-reversal calls)
  const futBull = f.positioning === "LONG BUILD-UP" || f.positioning === "SHORT COVERING";
  if (u.changePct > 0.25 && f.oiChgSession !== null && f.oiChgSession < 0)
    divergence.push("Price rising while futures OI falls — positioning not supporting the advance");
  if (u.changePct < -0.25 && f.oiChgSession !== null && f.oiChgSession < 0)
    divergence.push("Price falling while futures OI falls — decline driven by long liquidation");
  if (u.bias === "bullish" && o.ceBias === "bearish")
    divergence.push("Spot bullish but CE premiums weakening — premium response diverging");
  if (u.bias === "bearish" && o.peBias === "bearish")
    divergence.push("Spot bearish but PE premiums weakening — premium response diverging");
  if (u.relVol !== null && u.relVol < 1 && Math.abs(u.changePct) > 0.4)
    divergence.push(`Price moving ${u.changePct.toFixed(2)}% on below-average volume (${u.relVol.toFixed(2)}×)`);
  if (flow.label === "SELLER DOMINANT" && u.changePct > 0.4)
    divergence.push("Price advancing while seller-side control metrics dominate");
  if (flow.label === "BUYER DOMINANT" && u.changePct < -0.4)
    divergence.push("Price declining while buyer-side control metrics dominate");

  // --- genuine evidence
  if (dir === "bull") {
    if (u.bias === "bullish") genuine.push("Spot structure, EMA alignment and VWAP all bullish");
    if (BULL_POS.includes(f.positioning)) genuine.push(`Futures ${f.positioning.toLowerCase()} supports the move`);
    if (u.relVol !== null && u.relVol > 1.15) genuine.push(`Volume expanding (${u.relVol.toFixed(2)}× mean)`);
    if (o.alignment === "aligned") genuine.push("Option premiums aligned with direction (single confirmation)");
    if (sr.primaryResistance && sr.primaryResistance.label.includes("Weakening")) genuine.push("Primary resistance weakening");
    if (u.structure.breakout) genuine.push("Structural breakout in progress");
    if (alignment15m === "aligned") genuine.push("15-minute trend confirms");

    if (u.relVol === null || u.relVol < 1.05) weak.push("Relative volume not confirming participation");
    if (!BULL_POS.includes(f.positioning)) weak.push(`Futures positioning (${f.positioning}) does not support continuation`);
    if (o.ceBias !== "bullish") weak.push("CE premium response weak");
    if (sr.primaryResistance && sr.primaryResistance.label.includes("Strong")) weak.push("Primary resistance is strong — breakout unconfirmed");
    if (flow.label === "SELLER DOMINANT") weak.push("Seller-side control metrics dominate");
  } else if (dir === "bear") {
    if (u.bias === "bearish") genuine.push("Spot structure, EMA alignment and VWAP all bearish");
    if (BEAR_POS.includes(f.positioning)) genuine.push(`Futures ${f.positioning.toLowerCase()} supports the move`);
    if (u.relVol !== null && u.relVol > 1.15) genuine.push(`Volume expanding (${u.relVol.toFixed(2)}× mean)`);
    if (o.alignment === "aligned") genuine.push("Option premiums aligned with direction (single confirmation)");
    if (sr.primarySupport && sr.primarySupport.label.includes("Weakening")) genuine.push("Primary support weakening");
    if (u.structure.breakdown) genuine.push("Structural breakdown in progress");
    if (alignment15m === "aligned") genuine.push("15-minute trend confirms");

    if (u.relVol === null || u.relVol < 1.05) weak.push("Relative volume not confirming participation");
    if (!BEAR_POS.includes(f.positioning)) weak.push(`Futures positioning (${f.positioning}) does not support continuation`);
    if (o.peBias !== "bullish") weak.push("PE premium response weak");
    if (sr.primarySupport && sr.primarySupport.label.includes("Strong")) weak.push("Primary support is strong — breakdown unconfirmed");
    if (flow.label === "BUYER DOMINANT") weak.push("Buyer-side control metrics dominate");
  }

  // --- breakout / breakdown validation
  const breakout = validateBreakdown(input, dir);
  if (breakout.state === "false-breakout-risk") divergence.push("False breakout risk: cross not sustained / volume or premium not confirming");
  if (breakout.state === "false-breakdown-risk") divergence.push("False breakdown risk: cross not sustained / volume or premium not confirming");

  // --- stage
  const stage = stageOf({ dir, bull, bear, u, f, o, breakout, divergence, alignment15m, sr });

  let quality: QualityLabel;
  if (stage === "STAGE 4: REVERSAL DEVELOPING") quality = "REVERSAL DEVELOPING";
  else if (stage === "STAGE 3: MOMENTUM EXHAUSTION") quality = "MOMENTUM EXHAUSTION";
  else if (breakout.state === "false-breakout-risk") quality = "FALSE BREAKOUT RISK";
  else if (breakout.state === "false-breakdown-risk") quality = "FALSE BREAKDOWN RISK";
  else if (dir === "bull" && divergence.length >= 2 && genuine.length <= 2) quality = "MOMENTUM DIVERGENCE";
  else if (dir === "bear" && divergence.length >= 2 && genuine.length <= 2) quality = "MOMENTUM DIVERGENCE";
  else if (f.positioning === "SHORT COVERING" && dir === "bull" && bull >= 50) quality = "SHORT-COVERING RALLY";
  else if (f.positioning === "LONG UNWINDING" && dir === "bear" && bear >= 50) quality = "LONG-UNWINDING DECLINE";
  else if (dir === "bull" && bull >= 65 && weak.length <= 1) quality = "GENUINE BULLISH";
  else if (dir === "bear" && bear >= 65 && weak.length <= 1) quality = "GENUINE BEARISH";
  else if (dir === "bull" && bull >= 30) quality = "WEAK BULLISH";
  else if (dir === "bear" && bear >= 30) quality = "WEAK BEARISH";
  else quality = "NEUTRAL / CONFLICTED";

  return {
    quality,
    stage,
    divergence,
    genuine,
    weak,
    alignment15m,
    alignmentNote,
    breakout,
  };
}

function validateBreakdown(
  input: QualityInput,
  dir: "bull" | "bear" | null,
): MomentumAnalysis["breakout"] {
  const { feed, u, f, o, sr } = input;
  const price = u.last;
  if (dir === null)
    return {
      state: "none",
      level: null,
      detail: "No directional confluence — breakout/breakdown is not evaluated without a leading side.",
    };
  const level = dir === "bull" ? sr.primaryResistance?.price : sr.primarySupport?.price;
  const levelLabel = dir === "bull" ? "resistance" : "support";
  if (level === undefined || level === null)
    return { state: "none", level: null, detail: "No structural level available to test." };

  const bars = feed.spot5;
  const lookback = bars.slice(-6);
  const crossed = dir === "bull" ? Math.max(...lookback.map((b) => b.h)) > level : Math.min(...lookback.map((b) => b.l)) < level;
  if (!crossed) return { state: "none", level, detail: `Price has not traded through the ${levelLabel} at ${level.toFixed(2)}.` };

  const held =
    dir === "bull" ? price > level : price < level;
  const volOk = u.relVol !== null && u.relVol > 1.15;
  const posOk = dir === "bull" ? f.positioning === "LONG BUILD-UP" || f.positioning === "SHORT COVERING" : f.positioning === "SHORT BUILD-UP" || f.positioning === "LONG UNWINDING";
  const premOk = dir === "bull" ? o.ceBias === "bullish" : o.peBias === "bullish";
  const zoneWeak =
    dir === "bull"
      ? sr.primaryResistance?.label.includes("Weakening") || sr.primaryResistance?.label.includes("Breakout")
      : sr.primarySupport?.label.includes("Weakening") || sr.primarySupport?.label.includes("Breakdown");

  const score = [held, volOk, posOk, premOk, !!zoneWeak].filter(Boolean).length;
  if (score >= 4)
    return {
      state: dir === "bull" ? "genuine-breakout" : "genuine-breakdown",
      level,
      detail: `Held beyond ${levelLabel}, volume ${volOk ? "confirmed" : "not confirmed"}, futures ${posOk ? "aligned" : "not aligned"}, premium ${premOk ? "responding" : "flat"}, zone ${zoneWeak ? "weakened" : "intact"}.`,
    };
  if (score <= 2)
    return {
      state: dir === "bull" ? "false-breakout-risk" : "false-breakdown-risk",
      level,
      detail: `Cross of ${levelLabel} ${level.toFixed(2)} lacks ${[
        held ? null : "a close beyond the level",
        volOk ? null : "relative volume",
        posOk ? null : "futures positioning",
        premOk ? null : "premium response",
      ]
        .filter(Boolean)
        .join(", ")}. A single wick is not a confirmed breakout.`,
    };
  return { state: "none", level, detail: `Partial confirmation only (${score}/5) — awaiting a finalized candle beyond ${level}.` };
}

function stageOf(args: {
  dir: "bull" | "bear" | null;
  bull: number;
  bear: number;
  u: UnderlyingAnalysis;
  f: FuturesAnalysis;
  o: OptionsAnalysis;
  breakout: MomentumAnalysis["breakout"];
  divergence: string[];
  alignment15m: MomentumAnalysis["alignment15m"];
  sr: SRAudit;
}): MomentumAnalysis["stage"] {
  const { dir, u, f, o, breakout, divergence, alignment15m } = args;
  const score = Math.max(args.bull, args.bear);
  const volumeFading = u.volumeTrend === "contracting";
  const posAligned =
    dir === "bull"
      ? f.positioning === "LONG BUILD-UP" || f.positioning === "SHORT COVERING"
      : f.positioning === "SHORT BUILD-UP" || f.positioning === "LONG UNWINDING";

  if (alignment15m === "countertrend" && divergence.length >= 1 && score >= 50 && !posAligned)
    return "STAGE 4: REVERSAL DEVELOPING";
  if (dir && score >= 65 && breakout.state.startsWith("genuine") && alignment15m === "aligned")
    return "STAGE 2: STRONG MOMENTUM";
  if (dir && score >= 60 && posAligned && alignment15m !== "countertrend")
    return "STAGE 2: STRONG MOMENTUM";
  if (dir && score >= 60 && (volumeFading || divergence.length >= 2 || o.alignment === "divergent"))
    return "STAGE 3: MOMENTUM EXHAUSTION";
  if (dir && score >= 45 && divergence.length >= 2 && !posAligned) return "STAGE 3: MOMENTUM EXHAUSTION";
  if (dir && score >= 30 && score < 60 && u.structure.trend !== "sideways") return "STAGE 1: MOMENTUM BUILDING";
  if (dir && score >= 30) return "STAGE 1: MOMENTUM BUILDING";
  return "UNCLASSIFIED";
}

/** Session-relative volume check used by the scanner filters. */
export function relativeVolumeOf(feed: SymbolFeed): number | null {
  return last(relativeVolume(feed.spot5, 20));
}
