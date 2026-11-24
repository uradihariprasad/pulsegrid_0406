import { close, ema, last, pct, relativeVolume, vwap } from "../indicators";
import { oiWindows } from "./oi";
import { scoreStrikes } from "./strike";
import type {
  OptionAnalysis,
  OptionsAnalysis,
  StrikeRow,
  SymbolFeed,
  UnderlyingAnalysis,
} from "../types";

/**
 * MODULE C/D — Option premium momentum, alignment and premium efficiency.
 * Greeks come from the provider when present; otherwise they are derived with
 * Black–Scholes–Merton and flagged `black-scholes-derived` so the UI can state
 * the model rather than implying provider greeks.
 */
export function analyzeOptionContract(
  feed: SymbolFeed,
  contractIndex: number,
  spotNow: number,
  spotMovePts: number,
): OptionAnalysis | null {
  const c = feed.options[contractIndex];
  if (!c) return null;
  const cs = c.candles;
  // Chain-only contracts (no premium history yet) are still analysed: the
  // session change and OI change come from the provider chain, while the
  // candle-derived fields (vwap/ema/relVol) stay null instead of being faked.
  const hasHistory = cs.length >= 3;
  const cl = close(cs);
  const e9 = hasHistory ? last(ema(cl, 9)) : null;
  const e21 = hasHistory ? last(ema(cl, 21)) : null;
  const vw = hasHistory ? last(vwap(cs)) : null;
  const rv = hasHistory ? last(relativeVolume(cs, 20)) : null;
  const premium = c.quote.ltp || (hasHistory ? cl[cl.length - 1] : 0);
  const refPremium = hasHistory ? cs[0].o : c.quote.prevClose;
  const changePct = refPremium > 0 ? pct(premium, refPremium) : null;
  const oi = oiWindows(c.oi);
  const bid = c.quote.bid ?? null;
  const ask = c.quote.ask ?? null;
  const spreadPct =
    bid !== null && ask !== null && bid > 0 && ask > 0
      ? ((ask - bid) / ((ask + bid) / 2)) * 100
      : null;

  let bias: OptionAnalysis["bias"] = "neutral";
  const aboveVwap = vw !== null && premium > vw;
  const eAligned = e9 !== null && e21 !== null && e9 > e21;
  const eDown = e9 !== null && e21 !== null && e9 < e21;
  if (hasHistory) {
    // premium-vs-VWAP + EMA alignment when candle history exists
    if (aboveVwap && eAligned) bias = "bullish";
    else if (vw !== null && premium < vw && eDown) bias = "bearish";
  } else if (changePct !== null) {
    // chain-only fallback: session premium change (provider close → ltp)
    if (changePct > 0.15) bias = "bullish";
    else if (changePct < -0.15) bias = "bearish";
  }

  const delta = c.greeks.delta;
  const expected = delta !== null ? delta * spotMovePts : null;
  const actual = refPremium > 0 ? premium - refPremium : null;
  let responseQuality: OptionAnalysis["responseQuality"] = "unknown";
  if (expected !== null && actual !== null) {
    const mag = Math.abs(expected);
    if (mag < 0.05) responseQuality = "unknown";
    else {
      const ratio = actual / expected;
      const residual = actual - expected;
      if (ratio < 0) responseQuality = "weak";
      else if (Math.abs(residual) > 0.6 * mag) responseQuality = "iv-driven";
      else if (ratio > 3) responseQuality = "abnormal";
      else if (ratio >= 1.0) responseQuality = "strong";
      else if (ratio >= 0.5) responseQuality = "weak";
      else responseQuality = "weak";
    }
  }

  return {
    contract: c,
    premium,
    changePct,
    vwap: vw,
    ema: { e9, e21 },
    bias,
    relVol: rv,
    spreadPct,
    oiChg5: oi.c5,
    oiChg15: oi.c15,
    oiChgSession: oi.cSession ?? c.oiSessionChange ?? null,
    oiTotal: oi.total ?? c.quote.oi ?? null,
    deltaAdjustedExpected: expected,
    actualResponse: actual,
    responseQuality,
  };
}

export function analyzeOptions(feed: SymbolFeed, u: UnderlyingAnalysis): OptionsAnalysis {
  const spot = u.last;
  const spotMovePts = spot - feed.spotQuote.prevClose;
  const strikes = Array.from(new Set(feed.options.map((o) => o.strike))).sort((a, b) => a - b);
  const expiry = feed.options[0]?.expiry ?? "";
  const atm = strikes.length
    ? strikes.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best), strikes[0])
    : Math.round(spot / (feed.meta.strikeInterval || 1)) * feed.meta.strikeInterval;

  const rows: StrikeRow[] = strikes.map((strike) => {
    const ceIdx = feed.options.findIndex((o) => o.strike === strike && o.side === "CE");
    const peIdx = feed.options.findIndex((o) => o.strike === strike && o.side === "PE");
    return {
      strike,
      atm: strike === atm,
      ce: ceIdx >= 0 ? analyzeOptionContract(feed, ceIdx, spot, spotMovePts) : null,
      pe: peIdx >= 0 ? analyzeOptionContract(feed, peIdx, spot, spotMovePts) : null,
    };
  });

  const biases = (side: "CE" | "PE") =>
    rows.map((r) => (side === "CE" ? r.ce : r.pe)?.bias).filter(Boolean) as ("bullish" | "bearish" | "neutral")[];
  const ceList = biases("CE");
  const peList = biases("PE");
  const ceBull = ceList.filter((b) => b === "bullish").length;
  const ceBear = ceList.filter((b) => b === "bearish").length;
  const peBull = peList.filter((b) => b === "bullish").length;
  const peBear = peList.filter((b) => b === "bearish").length;

  const ceBias: OptionsAnalysis["ceBias"] = ceBull > ceBear + 1 ? "bullish" : ceBear > ceBull + 1 ? "bearish" : "neutral";
  const peBias: OptionsAnalysis["peBias"] = peBull > peBear + 1 ? "bullish" : peBear > peBull + 1 ? "bearish" : "neutral";

  let alignment: OptionsAnalysis["alignment"] = "unconfirmed";
  let alignmentNote = "Insufficient option series to judge alignment.";
  if (feed.options.length === 0) {
    alignment = "unavailable";
    alignmentNote = "Option contracts unavailable from provider for this underlying.";
  } else if (u.bias === "bullish") {
    alignment = ceBias === "bullish" && peBias === "bearish" ? "aligned" : ceBias === "bearish" ? "divergent" : "unconfirmed";
    alignmentNote =
      alignment === "aligned"
        ? "Spot bullish, CE premiums rising and PE premiums weakening — treated as ONE confirmation (both follow the same spot move)."
        : alignment === "divergent"
          ? "CE premiums weakening while spot is bullish — premium response contradicts price."
          : "Mixed option response; premium confirmation incomplete.";
  } else if (u.bias === "bearish") {
    alignment = peBias === "bullish" && ceBias === "bearish" ? "aligned" : peBias === "bearish" ? "divergent" : "unconfirmed";
    alignmentNote =
      alignment === "aligned"
        ? "Spot bearish, PE premiums rising and CE premiums weakening — treated as ONE confirmation."
        : alignment === "divergent"
          ? "PE premiums weakening while spot is bearish — premium response contradicts price."
          : "Mixed option response; premium confirmation incomplete.";
  } else {
    alignment = "unconfirmed";
    alignmentNote = "Underlying is neutral/consolidating — no premium alignment asserted.";
  }

  const atmRow = rows.find((r) => r.atm) ?? rows[0];
  const atmIv = atmRow?.ce?.contract.greeks.iv ?? atmRow?.pe?.contract.greeks.iv ?? null;
  const dir: "bull" | "bear" | "none" =
    u.bias === "bullish" ? "bull" : u.bias === "bearish" ? "bear" : "none";
  const scored = scoreStrikes(rows, { direction: dir, atmIv, atrPct: u.atrPct });

  return {
    atm,
    expiry,
    strikes: rows,
    ceBias,
    peBias,
    alignment,
    alignmentNote,
    bestCE: scored.bestCE,
    bestPE: scored.bestPE,
  };
}

/** Aggregate CE/PE premium session returns used by the futures confirmations. */
export function optionFlowReturns(feed: SymbolFeed): { ceRet: number | null; peRet: number | null } {
  const ret = (side: "CE" | "PE") => {
    const cs = feed.options.filter((o) => o.side === side);
    if (!cs.length) return null;
    let ref = 0;
    let now = 0;
    for (const c of cs) {
      ref += c.candles[0]?.o ?? 0;
      now += c.quote.ltp;
    }
    return ref > 0 ? pct(now, ref) : null;
  };
  return { ceRet: ret("CE"), peRet: ret("PE") };
}
