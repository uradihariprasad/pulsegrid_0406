"use client";

import { useMemo, useState } from "react";
import type { ScanResult, SignalEvent } from "@/lib/types";
import { Chip, Empty, Field, Section, Stat, Tone } from "../ui";

const KINDS = [
  "strong-confirmation",
  "momentum-building",
  "futures-positioning",
  "support-zone",
  "resistance-zone",
  "breakout",
  "breakdown",
  "false-breakout",
  "false-breakdown",
  "divergence",
  "exhaustion",
  "reversal-warning",
  "countertrend",
  "entry-confirmation",
  "trade-invalidation",
  "flow",
];

const SEV: { key: SignalEvent["severity"] | "all"; label: string }[] = [
  { key: "all", label: "ALL" },
  { key: "critical", label: "CRITICAL" },
  { key: "warn", label: "WARNING" },
  { key: "action", label: "ACTION" },
  { key: "info", label: "INFO" },
];

export default function Alerts({ scan, onSelect }: { scan: ScanResult; onSelect: (s: string) => void }) {
  const [sev, setSev] = useState<string>("all");
  const [kind, setKind] = useState<string>("all");

  const events = useMemo(
    () =>
      scan.events
        .filter((e) => (sev === "all" ? true : e.severity === sev))
        .filter((e) => (kind === "all" ? true : e.kind === kind)),
    [scan.events, sev, kind],
  );

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of scan.events) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return m;
  }, [scan.events]);

  return (
    <Section className="grid gap-3">
      <div className="grid grid-cols-2 md:grid-cols-5">
        <Stat label="Events this scan" value={scan.events.length} tone="amber" sub={scan.sessionLabel} />
        <Stat label="Critical" value={scan.events.filter((e) => e.severity === "critical").length} tone="bear" sub="reversal / invalidation" />
        <Stat label="Actionable" value={scan.events.filter((e) => e.severity === "action").length} tone="bull" sub="confirmation / entry" />
        <Stat label="Warnings" value={scan.events.filter((e) => e.severity === "warn").length} sub="divergence / false break" />
        <Stat label="Informational" value={scan.events.filter((e) => e.severity === "info").length} sub="context updates" />
      </div>

      <Field title="FILTER" right={<Chip>{events.length} matching</Chip>}>
        <div className="p-2.5 flex flex-wrap gap-1.5 items-center">
          {SEV.map((s) => (
            <button
              key={s.key}
              className="chip !py-1"
              style={sev === s.key ? { borderColor: "var(--color-amber)", color: "var(--color-amber)", background: "#171208" } : { cursor: "pointer" }}
              onClick={() => setSev(s.key)}
            >
              {s.label}
            </button>
          ))}
          <span className="mx-2 w-px h-4 bg-[var(--color-line2)]" />
          <button
            className="chip !py-1"
            style={kind === "all" ? { borderColor: "var(--color-amber)", color: "var(--color-amber)", background: "#171208" } : { cursor: "pointer" }}
            onClick={() => setKind("all")}
          >
            ALL TYPES
          </button>
          {KINDS.filter((k) => counts.get(k)).map((k) => (
            <button
              key={k}
              className="chip !py-1"
              style={kind === k ? { borderColor: "var(--color-amber)", color: "var(--color-amber)", background: "#171208" } : { cursor: "pointer" }}
              onClick={() => setKind(k)}
            >
              {k} <span className="opacity-70">{counts.get(k)}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field title="ALERT STREAM · DERIVED FROM ENGINE OUTPUT" ticked>
        {events.length ? (
          <div className="max-h-[62vh] overflow-y-auto">
            {events.map((e, i) => (
              <button
                key={`${e.symbol}-${e.ts}-${i}`}
                onClick={() => onSelect(e.symbol)}
                className="w-full text-left grid grid-cols-[74px_74px_118px_1fr] gap-3 px-3 py-2 border-b border-[var(--color-line)] hover:bg-[#12161c] items-baseline"
              >
                <span className="text-[11px] mute">
                  {new Date(e.ts).toLocaleTimeString("en-GB", { hour12: false })}
                </span>
                <span className="text-[12px] amber font-semibold">{e.symbol}</span>
                <span className="text-[10px] uppercase tracking-[0.1em]">
                  <Tone value={e.severity === "critical" ? "BEAR" : e.severity === "action" ? "BULL" : e.severity === "warn" ? "WARN" : "NEUTRAL"} />
                </span>
                <span>
                  <span className="text-[12px]">
                    <Tone value={e.title} />
                  </span>
                  <span className="block text-[11px] mute font-[var(--font-sans)] leading-snug mt-0.5">{e.detail}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <Empty
            title="NO ALERTS MATCH THIS FILTER"
            reason="Alerts are emitted only when an engine produces a state change (positioning, zone classification, breakout validation, stage transition or trade status). An empty stream means no such state was reached on this scan — not that the pipeline is idle."
          />
        )}
      </Field>

      <p className="text-[11px] mute font-[var(--font-sans)]">
        Events persist to the <code className="text-[var(--color-amber)]">signal_events</code> table with a dedupe key of
        (symbol, kind, title, ts) so repeated scans do not flood history. Open tab 13 for recorded signal history and score
        evolution.
      </p>
    </Section>
  );
}
