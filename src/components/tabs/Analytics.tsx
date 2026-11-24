"use client";

import { useEffect, useState } from "react";
import type { BacktestReport } from "@/lib/backtest";
import { Chip, Empty, Field, Section, Stat } from "../ui";

interface HistoryPayload {
  ok: boolean;
  mode: string;
  history: {
    scores: { id: number; symbol: string; ts: string; bull: number; bear: number; band: string; stage: string; quality: string; positioning: string }[];
    events: { id: number; symbol: string; ts: string; kind: string; severity: string; title: string; detail: string }[];
    opportunities: { id: number; symbol: string; ts: string; direction: string; status: string; score: number; riskReward: number | null }[];
  };
  dbError: string | null;
  backtest: BacktestReport | null;
  backtestError: string | null;
  limitations: string[];
}

export default function Analytics() {
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"perf" | "signals" | "scores" | "opps">("perf");

  useEffect(() => {
    let alive = true;
    fetch("/api/history")
      .then((r) => r.json())
      .then((j: HistoryPayload) => alive && setData(j))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, []);

  if (err) return <Empty title="HISTORY UNAVAILABLE" reason={err} />;
  if (!data) return <Empty title="LOADING HISTORICAL ANALYTICS" reason="Reading signal history and running walk-forward evaluation…" />;

  const bt = data.backtest;

  return (
    <Section className="grid gap-3">
      <Field title="WALK-FORWARD EVALUATION · NO LOOK-AHEAD" ticked right={<Chip tone={data.mode === "live" ? "live" : "warn"}>{data.mode === "live" ? "LIVE SESSION" : "NOT CONNECTED"}</Chip>}>
        {bt ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-6">
              <Stat label="Signals" value={bt.signals} sub={`${bt.symbolCount} instruments`} />
              <Stat label="Win rate" value={`${bt.winRate}%`} tone={bt.winRate >= 55 ? "bull" : bt.winRate >= 45 ? "warn" : "bear"} sub={`${bt.wins} winners`} />
              <Stat label="Profit factor" value={bt.profitFactor} tone={bt.profitFactor >= 1.2 ? "bull" : "warn"} sub="gross win / gross loss" />
              <Stat label="Expectancy" value={`${bt.expectancy}%`} tone={bt.expectancy > 0 ? "bull" : "bear"} sub="per signal, net" />
              <Stat label="Max drawdown" value={`${bt.maxDrawdown}%`} tone="bear" sub="equity curve, net" />
              <Stat label="In / out sample" value={`${bt.calibrate.inSample}% / ${bt.calibrate.outOfSample}%`} tone="warn" sub={bt.calibrate.period} />
            </div>
            <div className="px-3 py-2 border-t border-[var(--color-line)] grid gap-1 text-[11.5px] font-[var(--font-sans)] text-[#c9c3b6]">
              <span>▸ Costs: {bt.costs}</span>
              <span>▸ Method: decision on close of bar i, entry at open of bar i+1, exit after 6 bars; finalised candles only.</span>
              <span className="warn">▸ {bt.note}</span>
            </div>

            <div className="grid md:grid-cols-3 gap-px bg-[var(--color-line)] border-t border-[var(--color-line)]">
              <div className="bg-[var(--color-panel)] p-3">
                <div className="lbl mb-2">PERFORMANCE BY SCORE BAND</div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="nosort">BAND</th>
                      <th className="nosort">N</th>
                      <th className="nosort">WIN%</th>
                      <th className="nosort">AVG NET</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bt.byBand.map((b) => (
                      <tr key={b.band}>
                        <td className="!text-left">{b.band}</td>
                        <td>{b.signals}</td>
                        <td className={b.winRate >= 55 ? "bull" : b.winRate >= 45 ? "warn" : "bear"}>{b.winRate}%</td>
                        <td className={b.avgNet >= 0 ? "bull" : "bear"}>{b.avgNet}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-[var(--color-panel)] p-3">
                <div className="lbl mb-2">PERFORMANCE BY MOMENTUM STAGE</div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="nosort">STAGE</th>
                      <th className="nosort">N</th>
                      <th className="nosort">WIN%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bt.byStage.map((s) => (
                      <tr key={s.stage}>
                        <td className="!text-left whitespace-normal">{s.stage}</td>
                        <td>{s.signals}</td>
                        <td className={s.winRate >= 55 ? "bull" : s.winRate >= 45 ? "warn" : "bear"}>{s.winRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-[var(--color-panel)] p-3 grid gap-3 content-start">
                <div>
                  <div className="lbl mb-2">BULLISH VS BEARISH</div>
                  <div className="flex justify-between text-[12px]">
                    <span className="bull">LONG · {bt.bullSignals.signals} · {bt.bullSignals.winRate}%</span>
                    <span className="bear">SHORT · {bt.bearSignals.signals} · {bt.bearSignals.winRate}%</span>
                  </div>
                </div>
                <div>
                  <div className="lbl mb-2">FALSE BREAK / BREAKDOWN RATE (OUTCOME-BASED)</div>
                  <div className="text-[12px] grid gap-1">
                    <span className={bt.falseBreakoutRate >= 40 ? "bear" : "warn"}>
                      Breakouts failing within 30 min: {bt.falseBreakoutRate}% of {bt.breakTests.breakoutCalls} calls
                    </span>
                    <span className={bt.falseBreakdownRate >= 40 ? "bear" : "warn"}>
                      Breakdowns failing within 30 min: {bt.falseBreakdownRate}% of {bt.breakTests.breakdownCalls} calls
                    </span>
                    <span className="mute">
                      Judged by whether price traded back through the level within six bars of the call.
                    </span>
                  </div>
                </div>
                <div>
                  <div className="lbl mb-2">STRIKE SELECTION PERFORMANCE</div>
                  <div className="text-[12px] mute">
                    Contract-level outcome attribution requires option premium history per entry; recorded in{" "}
                    <code className="text-[var(--color-amber)]">opportunities</code> alongside the chosen strike score.
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <Empty title="EVALUATION UNAVAILABLE" reason={data.backtestError ?? "The walk-forward run did not return results."} />
        )}
      </Field>

      <Field
        title="RECORDED HISTORY"
        right={
          <span className="flex gap-1.5">
            {([["perf", "EVALUATION"], ["signals", "SIGNAL HISTORY"], ["scores", "SCORE EVOLUTION"], ["opps", "OPPORTUNITIES"]] as const).map(
              ([k, label]) => (
                <button
                  key={k}
                  className="btn !py-1 !px-2"
                  style={tab === k ? { color: "var(--color-amber)", borderColor: "var(--color-amberdim)" } : undefined}
                  onClick={() => setTab(k)}
                >
                  {label}
                </button>
              ),
            )}
          </span>
        }
      >
        {data.dbError ? (
          <Empty title="DATABASE NOT REACHABLE" reason={`Recorded history could not be read: ${data.dbError}. Live engine output is unaffected.`} />
        ) : tab === "signals" ? (
          data.history.events.length ? (
            <div className="tbl-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="nosort">TIME</th>
                    <th className="nosort">SYMBOL</th>
                    <th className="nosort">KIND</th>
                    <th className="nosort">SEV</th>
                    <th className="nosort">TITLE</th>
                    <th className="nosort">DETAIL</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.events.map((e) => (
                    <tr key={e.id}>
                      <td className="!text-left">{new Date(e.ts).toLocaleString("en-GB", { hour12: false })}</td>
                      <td className="!text-left amber">{e.symbol}</td>
                      <td className="!text-left mute">{e.kind}</td>
                      <td className="!text-left">{e.severity}</td>
                      <td className="!text-left">{e.title}</td>
                      <td className="!text-left whitespace-normal font-[var(--font-sans)] text-[11px] mute">{e.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="NO RECORDED SIGNALS YET" reason="Signals persist on each scan. Run a scan (RE-SCAN) and this table will populate." />
          )
        ) : tab === "scores" ? (
          data.history.scores.length ? (
            <div className="tbl-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="nosort">TIME</th>
                    <th className="nosort">SYMBOL</th>
                    <th className="nosort">BULL</th>
                    <th className="nosort">BEAR</th>
                    <th className="nosort">BAND</th>
                    <th className="nosort">STAGE</th>
                    <th className="nosort">QUALITY</th>
                    <th className="nosort">POSITIONING</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.scores.map((s) => (
                    <tr key={s.id}>
                      <td className="!text-left">{new Date(s.ts).toLocaleString("en-GB", { hour12: false })}</td>
                      <td className="!text-left amber">{s.symbol}</td>
                      <td className="bull">{s.bull}</td>
                      <td className="bear">{s.bear}</td>
                      <td className="!text-left mute">{s.band}</td>
                      <td className="!text-left mute">{s.stage}</td>
                      <td className="!text-left">{s.quality}</td>
                      <td className="!text-left mute">{s.positioning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="NO SCORE HISTORY YET" reason="Score evolution is written on every scan; the first scan seeds the series." />
          )
        ) : data.history.opportunities.length ? (
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="nosort">TIME</th>
                  <th className="nosort">SYMBOL</th>
                  <th className="nosort">DIR</th>
                  <th className="nosort">STATUS</th>
                  <th className="nosort">SCORE</th>
                  <th className="nosort">R:R</th>
                </tr>
              </thead>
              <tbody>
                {data.history.opportunities.map((o) => (
                  <tr key={o.id}>
                    <td className="!text-left">{new Date(o.ts).toLocaleString("en-GB", { hour12: false })}</td>
                    <td className="!text-left amber">{o.symbol}</td>
                    <td className={o.direction === "LONG" ? "bull" : "bear"}>{o.direction}</td>
                    <td className="!text-left">{o.status}</td>
                    <td>{o.score}</td>
                    <td>{o.riskReward ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="NO OPPORTUNITIES RECORDED" reason="Trade setups persist on each scan once they pass the direction gate." />
        )}
      </Field>

      <Field title="CALIBRATION & LIMITATIONS">
        <ul className="p-3 grid gap-1.5 text-[11.5px] font-[var(--font-sans)] text-[#c9c3b6]">
          <li className="warn">▸ Confluence scores are heuristic. They are never displayed as probabilities until calibrated against an out-of-sample population.</li>
          <li className="warn">▸ {data.backtest?.note ?? "Evaluation pending."}</li>
          {data.limitations.slice(0, 5).map((l) => (
            <li key={l}>▸ {l}</li>
          ))}
        </ul>
      </Field>
    </Section>
  );
}
