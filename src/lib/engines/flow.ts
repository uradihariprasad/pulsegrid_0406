import { clamp } from "../indicators";
import type { FlowAnalysis, SRAudit, SymbolFeed, UnderlyingAnalysis } from "../types";

/**
 * MODULE G — Buyer / seller control intelligence.
 *
 * DATA LIMITATION (stated, not hidden): Upstox REST/WebSocket aggregation does
 * not expose per-print aggressor side for historical candles, so executed
 * "buyer volume" cannot be verified. Everything here is derived from candle
 * direction and (when available) quoted depth, and is labelled accordingly with
 * a reduced confidence tier.
 */
export function analyzeFlow(feed: SymbolFeed, u: UnderlyingAnalysis, sr: SRAudit): FlowAnalysis {
  const bars = feed.spot5.slice(-20);
  const events: string[] = [];
  if (bars.length < 5 || feed.spot5.length < 5) {
    return {
      buyerDominance: 0,
      sellerDominance: 0,
      buyingPressure: 0,
      sellingPressure: 0,
      imbalance: 0,
      label: "INSUFFICIENT DATA",
      events: ["Not enough candles to evaluate control."],
      confidence: "low",
      confidenceNote: "Aggressor-side classification unavailable; sample too small.",
    };
  }

  let upVol = 0;
  let downVol = 0;
  let flatVol = 0;
  for (const b of bars) {
    if (b.c > b.o) upVol += b.v;
    else if (b.c < b.o) downVol += b.v;
    else flatVol += b.v;
  }
  const total = upVol + downVol + flatVol || 1;
  const buyingPressure = (upVol / total) * 100;
  const sellingPressure = (downVol / total) * 100;
  const imbalance = buyingPressure - sellingPressure;

  let depthWeight = 0.35;
  let depthNote = "candle-direction inference only";
  let confidence: FlowAnalysis["confidence"] = "low";
  let depthDom = 50;
  if (feed.depth) {
    const db = feed.depth.bidQty;
    const da = feed.depth.askQty;
    const dTotal = db + da || 1;
    const depthImb = ((db - da) / dTotal) * 100;
    depthWeight = 0.6;
    depthNote = `quoted depth imbalance ${depthImb.toFixed(1)}% (5-level)`;
    confidence = feed.source === "live" ? "moderate" : "low";
    depthDom = clamp(50 + depthImb / 2, 0, 100);
    events.push(
      depthImb > 12
        ? "Bid-side depth heavier than offered"
        : depthImb < -12
          ? "Ask-side depth heavier than bid"
          : "Depth balanced",
    );
  }

  const candleDom = 50 + imbalance / 2;
  const buyerDominance = clamp(candleDom * (1 - depthWeight) + depthDom * depthWeight, 0, 100);
  const sellerDominance = clamp(100 - buyerDominance, 0, 100);

  // Zone interaction: absorption / rejection
  const z = sr.primarySupport && sr.primaryResistance
    ? Math.abs(u.last - sr.primarySupport.price) < Math.abs(sr.primaryResistance.price - u.last)
      ? sr.primarySupport
      : sr.primaryResistance
    : sr.primarySupport ?? sr.primaryResistance;

  if (z) {
    const atrRef = u.atr ?? u.last * 0.005;
    const near = Math.abs(u.last - z.price) < atrRef * 0.75;
    if (near) {
      if (z.side === "support") {
        if (u.bias !== "bearish" && sellingPressure > buyingPressure) {
          events.push("POTENTIAL BUYER ABSORPTION at support — awaiting price confirmation");
        } else if (u.bias === "bearish") {
          events.push("Selling pressure pressing into support — absorption not confirmed");
        } else {
          events.push("Support holding with balanced two-sided flow");
        }
      } else {
        if (u.bias !== "bullish" && buyingPressure > sellingPressure) {
          events.push("POTENTIAL SELLER ABSORPTION at resistance — awaiting price confirmation");
        } else if (u.bias === "bullish") {
          events.push("Buying pressure testing resistance — rejection not confirmed");
        } else {
          events.push("Resistance capping with balanced two-side flow");
        }
      }
    }
  }

  if (u.volumeTrend === "expanding") events.push("Volume expanding into the move");
  if (u.volumeTrend === "contracting") events.push("Volume contracting — participation fading");

  const label: FlowAnalysis["label"] =
    buyerDominance >= 58 ? "BUYER DOMINANT" : sellerDominance >= 58 ? "SELLER DOMINANT" : "BALANCED";

  const confidenceNote =
    `Confidence ${confidence.toUpperCase()}: ${depthNote}. ` +
    (feed.source === "live"
      ? "Aggressor-side trade prints are not exposed by the provider for historical candles, so this is inferred, not verified executed buyer/seller volume."
      : "Quoted depth unavailable on this feed — candle-direction inference only.");

  return {
    buyerDominance: Math.round(buyerDominance * 10) / 10,
    sellerDominance: Math.round(sellerDominance * 10) / 10,
    buyingPressure: Math.round(buyingPressure * 10) / 10,
    sellingPressure: Math.round(sellingPressure * 10) / 10,
    imbalance: Math.round(imbalance * 10) / 10,
    label,
    events,
    confidence,
    confidenceNote,
  };
}
