"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Binoculars,
  CandlestickChart,
  Compass,
  Gauge,
  LayoutGrid,
  LineChart,
  ScrollText,
  Target,
  Waves,
} from "lucide-react";

export interface TabDef {
  id: string;
  idx: string;
  name: string;
  short: string;
  icon: React.ComponentType<{ size?: number | string; strokeWidth?: number }>;
}

export const TABS: TabDef[] = [
  { id: "overview", idx: "01", name: "Market Overview", short: "OVERVIEW", icon: LayoutGrid },
  { id: "scanner", idx: "02", name: "F&O Momentum Scanner", short: "SCANNER", icon: ScanIcon },
  { id: "master", idx: "03", name: "Momentum Master", short: "MASTER", icon: Gauge },
  { id: "bullish", idx: "04", name: "Bullish Momentum", short: "BULLISH", icon: CandlestickChart },
  { id: "bearish", idx: "05", name: "Bearish Momentum", short: "BEARISH", icon: CandlestickChart },
  { id: "futures", idx: "06", name: "Futures Positioning", short: "FUTURES", icon: Waves },
  { id: "options", idx: "07", name: "Options Intelligence", short: "OPTIONS", icon: LineChart },
  { id: "oi", idx: "08", name: "OI Strike Intelligence", short: "OI LADDER", icon: BarChart3 },
  { id: "structure", idx: "09", name: "Dynamic Support & Resistance", short: "S/R MAP", icon: Compass },
  { id: "flow", idx: "10", name: "Buyer vs Seller Intelligence", short: "FLOW", icon: Activity },
  { id: "trade", idx: "11", name: "Trade Finder", short: "TRADE", icon: Target },
  { id: "alerts", idx: "12", name: "Alerts", short: "ALERTS", icon: AlertTriangle },
  { id: "analytics", idx: "13", name: "Historical Analytics", short: "HISTORY", icon: ScrollText },
];

function ScanIcon({ size = 15 }: { size?: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 6h18M3 12h12M3 18h7" />
      <circle cx="19" cy="17" r="3" />
      <path d="M21.5 19.5 24 22" />
    </svg>
  );
}

/** MARKET MASTER monogram — hand-drawn vector mark, not a generated image. */
export function PulseMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="mark" aria-hidden="true">
      <defs>
        <linearGradient id="pgA" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffd07a" />
          <stop offset="100%" stopColor="#ffb020" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="29" height="29" fill="none" stroke="#3a2a0d" strokeWidth="1" />
      <g fill="url(#pgA)">
        <rect x="5" y="5" width="4" height="4" opacity="0.55" />
        <rect x="5" y="14" width="4" height="4" opacity="0.35" />
        <rect x="5" y="23" width="4" height="4" opacity="0.55" />
        <rect x="23" y="5" width="4" height="4" opacity="0.35" />
        <rect x="23" y="14" width="4" height="4" opacity="0.55" />
        <rect x="23" y="23" width="4" height="4" opacity="0.35" />
      </g>
      <path
        d="M3 16 H10 L12.5 9.5 L15.5 22.5 L18.5 14 L20.5 16 H29"
        fill="none"
        stroke="url(#pgA)"
        strokeWidth="1.9"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export default function Rail({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  return (
    <nav
      aria-label="Function rail"
      className="hidden md:flex fixed left-0 top-0 bottom-[30px] z-40 w-[76px] bg-[#0a0c0f] border-r border-[var(--color-line)] flex-col"
    >
      <div className="h-[52px] items-center justify-center border-b border-[var(--color-line)] flex">
        <PulseMark size={24} />
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              className={`rail-btn ${active === t.id ? "active" : ""}`}
              onClick={() => onSelect(t.id)}
              title={t.name}
              aria-current={active === t.id}
            >
              <span className="idx">{t.idx}</span>
              <Icon size={15} />
              <span className="nm">{t.short}</span>
            </button>
          );
        })}
      </div>
      <div className="px-1 py-2 border-t border-[var(--color-line)] text-center">
        <span className="lbl text-[8px] leading-tight block">NSE F&amp;O</span>
      </div>
    </nav>
  );
}
