import { pct } from "../indicators";
import type { FuturesAnalysis, Positioning, SymbolFeed, UnderlyingAnalysis } from "../types";

interface FlowContext {
  ceRet: number | null;
  peRet: number | null;
}

function classify(priceChg: number | null, oiChg: number | null): Positioning {
  if (priceChg === null || oiChg === null) return "INSUFFICIENT DATA";
  const pUp = priceChg > 0.02;
  const pDown = priceChg < -0.02;
  const oiUp = oiChg > 0;
  const oiDown = oiChg < 0;
  if (pUp && oiUp) return "LONG BUILD-UP";
  if (pDown && oiUp) return "SHORT BUILD-UP";
  if (pUp && oiDown) return "SHORT COVERING";
  if (pDown && oiDown) return "LONG UNWINDING";
  return "INSUFFICIENT DATA";
}

/**
 * MODULE B — Futures positioning.
 * Four categories derived strictly from (futures price change, futures OI
 * change) sign pairs. Fresh positioning is never asserted from aggregate OI
 * alone: labels are "candidate"-style and every confirmation is listed.
 */
export function analyzeFutures(
  feed: SymbolFeed,
  u: UnderlyingAnalysis,
  ctx: FlowContext,
): FuturesAnalysis {
  const confirmations: string[] = [];
  const warnings: string[] = [];
  const fut = feed.futures;
  if (!fut || fut.candles.length < 5) {
    return {
      positioning: "INSUFFICIENT DATA",
      consistency: "unknown",
      chg5Pct: null,
      chg15Pct: null,
      chgSessionPct: null,
      oiChg5: null,
      oiChg15: null,
      oiChgSession: null,
      oiTotal: null,
      relOiPct: null,
      relVol: null,
      confirmations,
      warnings: ["Futures contract series unavailable — positioning not computed."],
    };
  }

  const bars = fut.candles;
  const lastBar = bars[bars.length - 1];
  const ref = (deltaSec: number) => {
    const target = lastBar.t - deltaSec;
    for (let i = bars.length - 1; i >= 0; i--) if (bars[i].t <= target) return bars[i];
    return null;
  };
  const ref5 = ref(300);
  const ref15 = ref(900);
  const oiSeries = bars.map((b) => ({ t: b.t, o: 0, h: 0, l: 0, c: 0, v: 0, oi: b.oi ?? null }));

  const chg5Pct = ref5 ? pct(lastBar.c, ref5.c) : null;
  const chg15Pct = ref15 ? pct(lastBar.c, ref15.c) : null;
  // Futures must never be compared against the SPOT previous close — use the
  // futures contract's own previous-session close (from its own quote).
  const futPrevClose = fut.quote.prevClose && fut.quote.prevClose !== feed.spotQuote.prevClose
    ? fut.quote.prevClose
    : fut.quote.prevClose && fut.quote.instrumentKey === fut.key
      ? fut.quote.prevClose
      : null;
  const ownPrevClose =
    futPrevClose && Math.abs(futPrevClose - lastBar.c) / Math.max(1, lastBar.c) < 0.25 ? futPrevClose : null;
  const chgSessionPct = ownPrevClose ? pct(lastBar.c, ownPrevClose) : null;

  const oiAt = (b: typeof lastBar | null) => (b && typeof b.oi === "number" ? b.oi : null);
  const oiLast = oiAt(lastBar);
  const oi5 = oiAt(ref5);
  const oi15 = oiAt(ref15);
  const oiBase = typeof bars[0].oi === "number" ? bars[0].oi : null;

  const oiChg5 = oiLast !== null && oi5 !== null ? oiLast - oi5 : null;
  const oiChg15 = oiLast !== null && oi15 !== null ? oiLast - oi15 : null;
  const oiChgSession = oiLast !== null && oiBase !== null ? oiLast - oiBase : null;
  const relOiPct = oiChgSession !== null && oiBase ? (oiChgSession / oiBase) * 100 : null;

  const vols = bars.slice(-21, -1).map((b) => b.v);
  const volMean = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null;
  const relVol = volMean && volMean > 0 ? lastBar.v / volMean : null;

  const positioning = classify(chg5Pct, oiChg5);
  const p15 = classify(chg15Pct, oiChg15);
  const consistency: FuturesAnalysis["consistency"] =
    positioning === "INSUFFICIENT DATA" || p15 === "INSUFFICIENT DATA"
      ? "unknown"
      : sameSide(positioning, p15)
        ? "aligned"
        : "mixed";

  const aboveVwap = u.vwap !== null && lastBar.c > u.vwap;
  const volumeUp = relVol !== null && relVol > 1.15;

  switch (positioning) {
    case "LONG BUILD-UP":
      confirmations.push("Futures price up with OI up (new long positioning candidate)");
      if (volumeUp) confirmations.push(`Futures volume expanding (${relVol!.toFixed(2)}× mean)`);
      if (u.bias === "bullish") confirmations.push("Spot structure bullish");
      if (aboveVwap) confirmations.push("Price above session VWAP");
      if (ctx.ceRet !== null && ctx.ceRet > 0) confirmations.push(`CE premium responding (${ctx.ceRet.toFixed(1)}%)`);
      if (!volumeUp) warnings.push("Futures volume not expanding");
      break;
    case "SHORT BUILD-UP":
      confirmations.push("Futures price down with OI up (new short positioning candidate)");
      if (volumeUp) confirmations.push(`Futures volume expanding (${relVol!.toFixed(2)}× mean)`);
      if (u.bias === "bearish") confirmations.push("Spot structure bearish");
      if (!aboveVwap) confirmations.push("Price below session VWAP");
      if (ctx.peRet !== null && ctx.peRet > 0) confirmations.push(`PE premium responding (${ctx.peRet.toFixed(1)}%)`);
      if (ctx.ceRet !== null && ctx.ceRet < 0) confirmations.push(`CE premium weakening (${ctx.ceRet.toFixed(1)}%)`);
      if (!volumeUp) warnings.push("Futures volume not expanding");
      break;
    case "SHORT COVERING":
      confirmations.push("Futures price up while OI falls — short-covering rally");
      if (u.structure.breakout) confirmations.push("Structure breakout in progress");
      if (ctx.ceRet !== null && ctx.ceRet > 0) confirmations.push(`CE premium responding (${ctx.ceRet.toFixed(1)}%)`);
      warnings.push("Not fresh long conviction — position closing, continuation differs from new longs");
      if (!volumeUp) warnings.push("Low relative volume weakens the covering move");
      break;
    case "LONG UNWINDING":
      confirmations.push("Futures price down while OI falls — long-unwinding decline");
      if (u.structure.breakdown) confirmations.push("Structure breakdown in progress");
      if (ctx.peRet !== null && ctx.peRet > 0) confirmations.push(`PE premium responding (${ctx.peRet.toFixed(1)}%)`);
      warnings.push("Not fresh short conviction — longs closing, continuation differs from new shorts");
      if (!volumeUp) warnings.push("Low relative volume weakens the unwind");
      break;
    default:
      warnings.push("Price or OI reference unavailable — positioning not classifiable");
  }
  if (consistency === "mixed") warnings.push("5-minute and 15-minute positioning disagree");
  if (oiChg5 === null) warnings.push("5-minute OI reference snapshot missing");
  if (chgSessionPct === null)
    warnings.push(
      "Futures previous-session close unavailable from the futures quote — session change is reported as unavailable instead of using the spot previous close.",
    );

  void oiSeries;

  return {
    positioning,
    consistency,
    chg5Pct,
    chg15Pct,
    chgSessionPct,
    oiChg5,
    oiChg15,
    oiChgSession,
    oiTotal: oiLast,
    relOiPct,
    relVol,
    confirmations,
    warnings,
  };
}

function sameSide(a: Positioning, b: Positioning): boolean {
  const map: Record<string, string> = {
    "LONG BUILD-UP": "bull",
    "SHORT COVERING": "bull",
    "SHORT BUILD-UP": "bear",
    "LONG UNWINDING": "bear",
  };
  return map[a] !== undefined && map[a] === map[b];
}
