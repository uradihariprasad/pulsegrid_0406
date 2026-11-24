/**
 * Chart update policy — pure decision function so the lifecycle rules are
 * unit-testable instead of buried in effects.
 *
 * Rules:
 *  - initial load / full correction / out-of-order data  → `setData` (authoritative)
 *  - exactly one genuinely new, in-order candle appended  → `update`  (cheap, keeps zoom)
 *  - nothing changed                                       → `skip`
 *
 * `update()` never resets the visible range, so the user's pan/zoom survives a
 * live candle refresh; `fitContent()` is deliberately NOT called from here.
 */
export type CandlePlan = "setData" | "update" | "skip";

export interface CandleWindow {
  length: number;
  firstT: number;
  lastT: number;
}

export function planCandleUpdate(prev: CandleWindow | null, next: CandleWindow): CandlePlan {
  if (!prev) return "setData";
  if (next.length === 0) return "skip";
  // history replaced, truncated, reordered or corrected → full reload
  if (next.firstT !== prev.firstT) return "setData";
  if (next.length === prev.length) {
    return next.lastT === prev.lastT ? "skip" : "setData";
  }
  if (next.length === prev.length + 1 && next.lastT > prev.lastT) return "update";
  if (next.length > prev.length + 1) return "setData";
  // shorter than before: correction/truncation → authoritative reload
  if (next.length < prev.length) return "setData";
  return "setData";
}

/** Stable signature so unchanged S/R zones are not rebuilt. */
export function zonesSignature(zones: { id: string; price: number; kind: string; side: string }[]): string {
  let s = "";
  for (const z of zones) s += `${z.id}|${z.price}|${z.kind}|${z.side};`;
  return s;
}

export function markersSignature(markers: { time: number; text: string; shape: string }[]): string {
  let s = "";
  for (const m of markers) s += `${m.time}|${m.text}|${m.shape};`;
  return s;
}
