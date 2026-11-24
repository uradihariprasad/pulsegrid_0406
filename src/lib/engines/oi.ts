import type { Candle, OiWindow } from "../types";

/**
 * MODULE E helpers — rolling open-interest windows.
 *
 * Definitions (fixed by spec):
 *   5-minute change  = OI now − OI at ≈5 minutes ago
 *   15-minute change = OI now − OI at ≈15 minutes ago
 *   Session change   = OI now − valid session baseline (earliest observation)
 *   Total            = latest reported OI (changes are NEVER added back to it)
 *
 * If a reference snapshot does not exist the result is `null`, not 0.
 */
export function oiWindows(snaps: Candle[], toleranceSec = 180): OiWindow {
  const withOi = snaps.filter((s) => typeof s.oi === "number" && isFinite(s.oi as number));
  if (!withOi.length) {
    return {
      c5: null,
      c15: null,
      cSession: null,
      total: null,
      baseline: null,
      baselineSource: "unavailable",
      asOf: null,
      observations: 0,
    };
  }
  const sorted = withOi.slice().sort((a, b) => a.t - b.t);
  const lastS = sorted[sorted.length - 1];
  const total = lastS.oi ?? null;
  const baseline = sorted[0].oi ?? null;

  const at = (deltaSec: number): number | null => {
    const target = lastS.t - deltaSec;
    let exact: number | null = null;
    let nearest: number | null = null;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const s = sorted[i];
      if (s.t > target) continue;
      const age = target - s.t;
      if (exact === null && age <= toleranceSec) exact = s.oi ?? null;
      if (nearest === null) nearest = s.oi ?? null;
      break;
    }
    if (exact !== null) return exact;
    // nearest earlier snapshot when the strict window is empty (first bars)
    return nearest;
  };

  const ref5 = at(300);
  const ref15 = at(900);
  return {
    c5: ref5 === null || total === null ? null : total - ref5,
    c15: ref15 === null || total === null ? null : total - ref15,
    cSession: baseline === null || total === null ? null : total - baseline,
    total,
    baseline,
    baselineSource: baseline === null ? "unavailable" : "first-session-observation",
    asOf: lastS.t * 1000,
    observations: sorted.length,
  };
}
