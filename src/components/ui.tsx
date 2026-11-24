import React from "react";

export function Field({
  title,
  right,
  children,
  ticked = false,
  className = "",
  bodyClass = "",
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  ticked?: boolean;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`field ${ticked ? "field--ticked" : ""} ${className}`}>
      <header className="field-head">
        <span className="lbl">{title}</span>
        {right ? <span className="flex items-center gap-2">{right}</span> : null}
      </header>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "",
  big = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: string;
  big?: boolean;
}) {
  return (
    <div className="px-3 py-2 border-r border-b border-[var(--color-line)] last:border-r-0">
      <div className="lbl mb-1.5">{label}</div>
      <div className={`${tone} ${big ? "text-[28px] leading-none" : "text-[15px]"} font-semibold`}>{value}</div>
      {sub !== undefined && sub !== null ? <div className="text-[10.5px] mute mt-1 leading-tight">{sub}</div> : null}
    </div>
  );
}

export function Meter({ value, tone = "bull" }: { value: number; tone?: "bull" | "bear" }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`meter meter--${tone}`}>
      <span style={{ width: `${v}%` }} />
    </div>
  );
}

export function Chip({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: "" | "live" | "amber" | "warn";
}) {
  return <span className={`chip ${tone ? `chip--${tone}` : ""}`}>{children}</span>;
}

export function scoreTone(v: number, bull = true): string {
  if (v >= 65) return bull ? "bull" : "bear";
  if (v >= 50) return bull ? "bull" : "bear";
  if (v >= 30) return "warn";
  return "mute";
}

export function Tone({ text, value }: { text?: string; value: string }) {
  const t = (text ?? value).toUpperCase();
  const cls = /BULL|LONG BUILD|GENUINE B|ENTRY ELIGIBLE|BUYER|STRENGTHENING|SUPPORT|BREAKOUT(?! RISK)/.test(t)
    ? "bull"
    : /BEAR|SHORT BUILD|GENUINE S|SELLER|WEAKENING|BREAKDOWN(?! RISK)/.test(t)
      ? "bear"
      : /WARN|RISK|EXHAUST|DIVERGEN|FALSE|INVALIDAT|UNWIND|COVER/.test(t)
        ? "warn"
        : "mute";
  return <span className={cls}>{value}</span>;
}

export function Empty({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="px-5 py-9 text-center">
      <div className="lbl mb-2 text-[var(--color-amber)]">{title}</div>
      <p className="text-[12px] mute max-w-xl mx-auto leading-relaxed font-[var(--font-sans)]">{reason}</p>
    </div>
  );
}

export function Bar({ pct, tone = "amber" }: { pct: number; tone?: string }) {
  return (
    <div className="h-[4px] w-full bg-[#14181d]">
      <div
        className="h-full transition-[width] duration-300"
        style={{
        width: `${Math.max(0, Math.min(100, pct))}%`,
          background:
            tone === "amber"
              ? "var(--color-amber)"
              : tone === "bull"
                ? "var(--color-bull)"
                : tone === "bear"
                  ? "var(--color-bear)"
                  : "var(--color-slate)",
        }}
      />
    </div>
  );
}

export function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`enter ${className}`}>{children}</div>;
}
