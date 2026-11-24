import { clamp } from "../indicators";
import type { Greeks, OptionAnalysis, StrikeRow, StrikeSelection } from "../types";

export interface StrikeContext {
  direction: "bull" | "bear" | "none";
  /** ATM premium used for IV comparison. */
  atmIv: number | null;
  /** Per-bar ATR of the underlying, for premium-response sanity checks. */
  atrPct: number | null;
}

const W = {
  momentum: 25,
  delta: 20,
  relVol: 15,
  liquidity: 15,
  oi: 10,
  iv: 10,
  theta: 5,
} as const;

function spreadScore(spreadPct: number | null): number | null {
  if (spreadPct === null) return null;
  if (spreadPct <= 0.4) return 1;
  if (spreadPct <= 1.0) return 0.8;
  if (spreadPct <= 2.5) return 0.5;
  if (spreadPct <= 5) return 0.2;
  return 0;
}

function liquidityOf(spreadPct: number | null, qty: number | null): StrikeSelection["liquidity"] {
  if (spreadPct === null) return "illiquid";
  if (spreadPct <= 0.6 && (qty === null || qty >= 100)) return "deep";
  if (spreadPct <= 1.5) return "adequate";
  if (spreadPct <= 4) return "thin";
  return "illiquid";
}

/** Delta suitability: directional trades prefer 0.35–0.60 absolute delta. */
function deltaScore(delta: number | null, dir: "bull" | "bear" | "none"): number | null {
  if (delta === null || dir === "none") return null;
  const d = Math.abs(delta);
  if (d < 0.1) return 0.1;
  if (d <= 0.35) return 0.45 + (d - 0.1) * 1.4;
  if (d <= 0.6) return 1;
  if (d <= 0.8) return 0.75;
  return 0.45;
}

function ivScore(iv: number | null, atmIv: number | null): number | null {
  if (iv === null) return null;
  if (atmIv === null || atmIv <= 0) return 0.6;
  const rel = iv / atmIv;
  if (rel < 0.92) return 0.75; // cheap relative to ATM, but check why
  if (rel <= 1.1) return 1;
  if (rel <= 1.3) return 0.5;
  return 0.15;
}

function thetaScore(g: Greeks, premium: number): number | null {
  if (g.theta === null || premium <= 0) return null;
  const decayPct = (Math.abs(g.theta) / premium) * 100;
  if (decayPct <= 2) return 1;
  if (decayPct <= 4) return 0.7;
  if (decayPct <= 7) return 0.35;
  return 0.1;
}

function oiScore(a: OptionAnalysis, dir: "bull" | "bear" | "none"): number | null {
  if (a.oiChgSession === null) return null;
  if (dir === "none") return 0.5;
  // Long premium buyers want the option's own OI building with premium.
  const build = a.oiChgSession > 0 ? 1 : a.oiChgSession > -200000 ? 0.5 : 0.2;
  const mom = a.changePct === null ? 0.5 : clamp(0.5 + a.changePct / 20, 0, 1);
  return clamp(build * 0.6 + mom * 0.4);
}

function momentumScore(a: OptionAnalysis, dir: "bull" | "bear" | "none"): number | null {
  if (dir === "none") return null;
  const chg = a.changePct;
  if (chg === null) return null;
  const directional = dir === "bull" ? chg : -chg;
  const base = clamp(0.5 + directional / 15, 0, 1);
  const trendBonus = a.bias === "bullish" && dir === "bull" ? 0.15 : a.bias === "bearish" && dir === "bear" ? 0.15 : 0;
  const rvBonus = a.relVol !== null ? clamp((a.relVol - 1) / 2, -0.2, 0.25) : 0;
  return clamp(base + trendBonus + rvBonus);
}

/**
 * MODULE M — Best option strike selection.
 * Weighted 100-point score (momentum 25, delta 20, rel volume 15, liquidity 15,
 * OI 10, IV 10, theta 5). Contracts failing liquidity/risk filters are rejected
 * outright regardless of score; when everything is rejected the engine returns
 * null so the UI can print NO SUITABLE CONTRACT.
 */
export function scoreStrikes(rows: StrikeRow[], ctx: StrikeContext): {
  bestCE: StrikeSelection | null;
  bestPE: StrikeSelection | null;
  rejected: { strike: number; side: "CE" | "PE"; reason: string }[];
} {
  const rejected: { strike: number; side: "CE" | "PE"; reason: string }[] = [];
  const pick = (side: "CE" | "PE"): StrikeSelection | null => {
    const dir: "bull" | "bear" | "none" =
      ctx.direction === "none" ? "none" : side === "CE" ? ctx.direction : ctx.direction === "bull" ? "bear" : "bull";
    let best: StrikeSelection | null = null;
    for (const row of rows) {
      const a = side === "CE" ? row.ce : row.pe;
      if (!a) continue;
      const spread = a.spreadPct;
      const qty = a.contract.quote.askQty ?? null;
      const liq = liquidityOf(spread, qty);
      const reasons: string[] = [];
      const rejects: string[] = [];

      if (liq === "illiquid") rejects.push(`spread ${spread === null ? "unknown" : `${spread.toFixed(2)}%`} exceeds 5% ceiling`);
      if ((a.contract.quote.bid ?? 0) <= 0) rejects.push("no bid");
      if (a.oiTotal !== null && a.oiTotal < 50_000) rejects.push(`low OI (${Math.round(a.oiTotal)} contracts)`);
      if (a.premium < 0.5) rejects.push("premium below tick-efficient minimum");

      const comps = [
        { k: "momentum", w: W.momentum, v: momentumScore(a, dir) },
        { k: "delta", w: W.delta, v: deltaScore(a.contract.greeks.delta, dir) },
        { k: "relVol", w: W.relVol, v: a.relVol === null ? null : clamp(a.relVol / 2, 0, 1) },
        { k: "liquidity", w: W.liquidity, v: spreadScore(spread) },
        { k: "oi", w: W.oi, v: oiScore(a, dir) },
        { k: "iv", w: W.iv, v: ivScore(a.contract.greeks.iv, ctx.atmIv) },
        { k: "theta", w: W.theta, v: thetaScore(a.contract.greeks, a.premium) },
      ];
      const present = comps.filter((c) => c.v !== null);
      const totalW = present.reduce((s, c) => s + c.w, 0);
      const score = totalW ? (present.reduce((s, c) => s + c.w * (c.v as number), 0) / totalW) * 100 : 0;
      if (present.length < 5) rejects.push("insufficient inputs (greeks/liquidity missing)");

      for (const c of present) {
        if (c.k === "momentum" && (c.v as number) >= 0.7) reasons.push("premium momentum aligned with direction");
        if (c.k === "delta" && (c.v as number) >= 0.9) reasons.push(`delta ${a.contract.greeks.delta?.toFixed(2)} inside 0.35–0.60`);
        if (c.k === "liquidity" && (c.v as number) >= 0.8) reasons.push(`tight spread ${spread?.toFixed(2)}%`);
        if (c.k === "oi" && (c.v as number) >= 0.7) reasons.push("option OI building with premium");
        if (c.k === "iv" && (c.v as number) >= 0.9) reasons.push("IV not elevated vs ATM");
        if (c.k === "theta" && (c.v as number) >= 0.7) reasons.push("theta decay within tolerance");
      }

      const fatal = rejects.length > 0;
      if (fatal) {
        rejected.push({ strike: row.strike, side, reason: rejects[0] });
        continue;
      }
      const sel: StrikeSelection = {
        strike: row.strike,
        side,
        expiry: a.contract.expiry,
        score: Math.round(score),
        liquidity: liq,
        reasons,
        rejects,
        greeks: a.contract.greeks,
        premium: a.premium,
      };
      if (!best || sel.score > best.score) best = sel;
    }
    if (!best && rows.length) rejected.push({ strike: rows[0].strike, side, reason: "no contract passed liquidity and risk filters" });
    return best && best.score >= 45 ? best : null;
  };

  return { bestCE: pick("CE"), bestPE: pick("PE"), rejected };
}
