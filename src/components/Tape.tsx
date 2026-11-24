"use client";

import { useEffect, useState } from "react";
import type { SignalEvent } from "@/lib/types";

const SEV_COLOR: Record<string, string> = {
  critical: "text-[var(--color-bear)]",
  warn: "text-[var(--color-warn)]",
  action: "text-[var(--color-amber)]",
  info: "text-[var(--color-slate)]",
};

/** Docked alert tape — advances one event at a time, like a session tape. */
export default function Tape({ events, mode }: { events: SignalEvent[]; mode: string }) {
  const [i, setI] = useState(0);
  const [clock, setClock] = useState("");

  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setClock(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(d),
      );
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (events.length === 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const t = setInterval(() => setI((v) => (v + 1) % events.length), 3200);
    return () => clearInterval(t);
  }, [events.length]);

  const ev = events.length ? events[i % events.length] : null;

  return (
    <div className="tape-row fixed bottom-0 left-0 right-0 z-30 h-[30px] text-[11px]">
      <span className="lbl shrink-0 text-[var(--color-amber)]">TAPE</span>
      <span className="shrink-0 text-[var(--color-amber)] blink">●</span>
      <span className="shrink-0 mute">{clock} IST</span>
      <span className="shrink-0 chip chip--amber">{mode}</span>
      <div className="flex-1 overflow-hidden">
        {ev ? (
          <div key={`${ev.ts}-${i}`} className="enter flex gap-3 items-center overflow-hidden">
            <span className="shrink-0 mute">{new Date(ev.ts).toLocaleTimeString("en-GB", { hour12: false })}</span>
            <span className="shrink-0 amber font-semibold">{ev.symbol}</span>
            <span className={`shrink-0 ${SEV_COLOR[ev.severity] ?? ""}`}>{ev.title}</span>
            <span className="truncate text-[#c9c3b6] font-[var(--font-sans)]">{ev.detail}</span>
          </div>
        ) : (
          <span className="mute">Waiting for signal events…</span>
        )}
      </div>
      <span className="shrink-0 mute hidden md:inline">
        {events.length} EVENTS · IDX {events.length ? (i % events.length) + 1 : 0}/{events.length}
      </span>
    </div>
  );
}
