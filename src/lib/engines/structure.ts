import { clamp, volumeProfile } from "../indicators";
import type { SRAudit, SymbolFeed, UnderlyingAnalysis, Zone } from "../types";

interface Level {
  price: number;
  source: string;
  kind: "structural" | "oi-only";
  weight: number;
  ts?: number;
  reactions?: number;
}

const TOL_FACTOR = 0.35; // cluster levels within 0.35 ATR

/**
 * MODULE F — Unified dynamic support & resistance.
 * Structural zones (price/volume acceptance) and OI-only zones (options
 * positioning) are built from one pipeline and kept separately classified;
 * only genuine overlap produces a `confluence` zone with a confluence score.
 */
export function buildSRLayers(
  feed: SymbolFeed,
  u: UnderlyingAnalysis,
): SRAudit {
  // No price history → no zones. Levels derived without a current price would
  // be meaningless, so the layers are reported as absent instead of invented.
  if (feed.spot5.length < 10) {
    return {
      primarySupport: null,
      primaryResistance: null,
      secondarySupport: null,
      secondaryResistance: null,
      structural: [],
      oiOnly: [],
      volumeProfile: { poc: null, vah: null, val: null },
      notes: ["No usable price history — support/resistance not constructed."],
    };
  }
  const price = u.last;
  const atrRef = u.atr ?? price * 0.005;
  const notes: string[] = [];
  const structural: Level[] = [];
  const oiOnly: Level[] = [];

  const c5 = feed.spot5;
  // Swing points
  for (let i = 2; i < c5.length - 2; i++) {
    const b = c5[i];
    const isHigh =
      b.h > c5[i - 1].h && b.h > c5[i - 2].h && b.h > c5[i + 1].h && b.h > c5[i + 2].h;
    const isLow = b.l < c5[i - 1].l && b.l < c5[i - 2].l && b.l < c5[i + 1].l && b.l < c5[i + 2].l;
    if (isHigh) structural.push({ price: b.h, source: "intraday swing high", kind: "structural", weight: 14, ts: b.t, reactions: 1 });
    if (isLow) structural.push({ price: b.l, source: "intraday swing low", kind: "structural", weight: 14, ts: b.t, reactions: 1 });
  }

  const pd = feed.prevDay;
  if (pd) {
    structural.push({ price: pd.high, source: "previous-day high", kind: "structural", weight: 18 });
    structural.push({ price: pd.low, source: "previous-day low", kind: "structural", weight: 18 });
    structural.push({ price: pd.close, source: "previous-day close", kind: "structural", weight: 12 });
  } else {
    notes.push("Previous-session OHLC unavailable — PDH/PDL/PDC levels excluded.");
  }

  const orBars = c5.slice(0, 3);
  if (orBars.length) {
    structural.push({ price: Math.max(...orBars.map((b) => b.h)), source: "opening range high", kind: "structural", weight: 13 });
    structural.push({ price: Math.min(...orBars.map((b) => b.l)), source: "opening range low", kind: "structural", weight: 13 });
  }
  if (u.vwap !== null) structural.push({ price: u.vwap, source: "session VWAP", kind: "structural", weight: 16 });

  const vp = volumeProfile(c5, 48);
  if (vp.poc !== null) structural.push({ price: vp.poc, source: "volume profile POC", kind: "structural", weight: 15 });
  if (vp.vah !== null) structural.push({ price: vp.vah, source: "volume profile VAH", kind: "structural", weight: 11 });
  if (vp.val !== null) structural.push({ price: vp.val, source: "volume profile VAL", kind: "structural", weight: 11 });
  if (vp.poc === null) notes.push("Volume profile unavailable (no volume in series).");

  // Options OI concentrations → OI-only levels
  const ceOi = feed.options.filter((o) => o.side === "CE" && typeof o.quote.oi === "number");
  const peOi = feed.options.filter((o) => o.side === "PE" && typeof o.quote.oi === "number");
  const topOi = (arr: typeof ceOi, n: number) =>
    arr
      .slice()
      .sort((a, b) => (b.quote.oi ?? 0) - (a.quote.oi ?? 0))
      .slice(0, n);
  for (const o of topOi(ceOi, 3)) oiOnly.push({ price: o.strike, source: `CE OI ${Math.round((o.quote.oi ?? 0) / 1000)}K @${o.strike}`, kind: "oi-only", weight: 10 });
  for (const o of topOi(peOi, 3)) oiOnly.push({ price: o.strike, source: `PE OI ${Math.round((o.quote.oi ?? 0) / 1000)}K @${o.strike}`, kind: "oi-only", weight: 10 });
  if (!ceOi.length && !peOi.length) notes.push("Option OI unavailable — OI-only layers not constructed.");

  const zones = clusterLevels([...structural, ...oiOnly], atrRef, c5, u);

  const supports = zones.filter((z) => z.side === "support").sort((a, b) => b.price - a.price);
  const resistances = zones.filter((z) => z.side === "resistance").sort((a, b) => a.price - b.price);

  const primarySupport = supports[0] ?? null;
  const secondarySupport = supports[1] ?? null;
  const primaryResistance = resistances[0] ?? null;
  const secondaryResistance = resistances[1] ?? null;

  return {
    primarySupport,
    primaryResistance,
    secondarySupport,
    secondaryResistance,
    structural: zones.filter((z) => z.kind !== "oi-only"),
    oiOnly: zones.filter((z) => z.kind === "oi-only"),
    volumeProfile: vp,
    notes,
  };
}

function clusterLevels(levels: Level[], atrRef: number, c5: SymbolFeed["spot5"], u: UnderlyingAnalysis): Zone[] {
  if (!levels.length) return [];
  const sorted = levels.slice().sort((a, b) => a.price - b.price);
  const tol = Math.max(atrRef * TOL_FACTOR, u.last * 0.0015);
  const groups: Level[][] = [];
  for (const lv of sorted) {
    const g = groups[groups.length - 1];
    if (g && lv.price - g[g.length - 1].price <= tol) g.push(lv);
    else groups.push([lv]);
  }
  const totalVol = c5.reduce((s, b) => s + b.v, 0) || 1;

  return groups.map((g, i) => {
    const price = g.reduce((s, l) => s + l.price * l.weight, 0) / g.reduce((s, l) => s + l.weight, 0);
    const low = Math.min(...g.map((l) => l.price));
    const high = Math.max(...g.map((l) => l.price));
    const sources = Array.from(new Set(g.map((l) => l.source)));
    const structuralSources = sources.filter((s) => !s.includes("OI "));
    const oiSources = sources.filter((s) => s.includes("OI "));
    const kind: Zone["kind"] =
      structuralSources.length && oiSources.length ? "confluence" : oiSources.length ? "oi-only" : "structural";

    const reactions = g.reduce((s, l) => s + (l.reactions ?? 1), 0);
    const lastTs = g.reduce<number | null>((m, l) => (l.ts ? Math.max(m ?? 0, l.ts) : m), null);

    const zoneVol = c5
      .filter((b) => b.c >= low && b.c <= high)
      .reduce((s, b) => s + b.v, 0);
    const volShare = zoneVol / totalVol;
    const recent = lastTs !== null && c5.length ? (c5[c5.length - 1].t - lastTs) / 300 < 15 : false;
    const recencyScore = lastTs === null ? 6 : recent ? 15 : 8;
    const retest = g.filter((l) => l.source.includes("swing")).length >= 2 ? 10 : 4;
    const confluence = Math.min(3, structuralSources.length ? 1 : 0 + (oiSources.length ? 1 : 0) + (g.length > 1 ? 1 : 0));

    let strength =
      Math.min(32, reactions * 6) +
      recencyScore +
      clamp(volShare * 6, 0, 18) +
      Math.min(24, sources.length * 8) +
      retest +
      (kind === "confluence" ? 10 : kind === "oi-only" ? 0 : 4);
    strength = Math.round(clamp(strength, 0, 100));

    const side: Zone["side"] = price <= u.last ? "support" : "resistance";
    const label = classifyZone(side, strength, price, u);

    return {
      id: `${side}-${i}-${Math.round(price * 100)}`,
      side,
      price: Math.round(price * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      kind,
      strength,
      label,
      reactions,
      lastTestTs: lastTs ? lastTs * 1000 : null,
      confluence,
      sources,
    };
  });
}

function classifyZone(side: Zone["side"], strength: number, price: number, u: UnderlyingAnalysis): string {
  const atrRef = u.atr ?? price * 0.005;
  const distance = side === "support" ? u.last - price : price - u.last;
  const near = distance <= atrRef * 0.6;
  const momentumPush = side === "support" ? u.bias === "bearish" : u.bias === "bullish";
  if (near && momentumPush && strength >= 55)
    return side === "support" ? "Support Breakdown Risk" : "Resistance Breakout Risk";
  if (strength >= 70) return side === "support" ? "Strong Support" : "Strong Resistance";
  if (strength >= 55)
    return side === "support"
      ? momentumPush ? "Support Weakening" : "Support Strengthening"
      : momentumPush ? "Resistance Strengthening" : "Resistance Weakening";
  if (strength >= 40) return side === "support" ? "Weak Support" : "Weak Resistance";
  return side === "support" ? "Weak Support" : "Weak Resistance";
}
