"use client";

import { useEffect, useRef } from "react";
import {
  ColorType,
  CrosshairMode,
  createChart,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { markersSignature, planCandleUpdate, zonesSignature, type CandleWindow } from "@/lib/chartUpdate";
import type { Candle, Zone } from "@/lib/types";

export interface ChartOverlay {
  ema9?: (number | null)[];
  ema21?: (number | null)[];
  ema50?: (number | null)[];
  ema200?: (number | null)[];
  vwap?: (number | null)[];
  bbUp?: (number | null)[];
  bbLo?: (number | null)[];
}

export interface ChartMarker {
  time: number;
  position: "aboveBar" | "belowBar" | "inBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  text: string;
}

interface Props {
  candles: Candle[];
  overlay?: ChartOverlay;
  zones?: Zone[];
  markers?: ChartMarker[];
  showVolume?: boolean;
  showEma?: boolean;
  showBb?: boolean;
  showVwap?: boolean;
  showZones?: boolean;
  /** change this to re-fit (initial load / symbol switch only) */
  fitKey?: string;
}

const UP = "#26d07c";
const DOWN = "#ff5c5c";

const toWindow = (c: Candle[]): CandleWindow => ({
  length: c.length,
  firstT: c.length ? c[0].t : 0,
  lastT: c.length ? c[c.length - 1].t : 0,
});

/**
 * Chart lifecycle: the instance and its series are created ONCE per mount.
 * Data, indicators, zones, markers and fitting are five independent effects so
 * a new candle never rebuilds the chart, never recreates price lines and never
 * resets the user's zoom.
 */
export default function PriceChart({
  candles,
  overlay = {},
  zones = [],
  markers = [],
  showVolume = true,
  showEma = true,
  showBb = true,
  showVwap = true,
  showZones = true,
  fitKey = "",
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lineRefs = useRef<ISeriesApi<"Line">[]>([]);
  const priceLinesRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[]>([]);
  const winRef = useRef<CandleWindow | null>(null);
  const zonesSigRef = useRef<string>("");
  const markersSigRef = useRef<string>("");

  // 1) create the chart and every series exactly once
  useEffect(() => {
    if (!host.current || chartRef.current) return;
    const chart = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0a0c0f" },
        textColor: "#9a958a",
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: 10,
      },
      grid: { vertLines: { color: "#12161b" }, horzLines: { color: "#12161b" } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#ffb020", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#7a5410" },
        horzLine: { color: "#ffb020", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#7a5410" },
      },
      rightPriceScale: { borderColor: "#1b1f25", scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: "#1b1f25", timeVisible: true, secondsVisible: false, rightOffset: 4 },
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    const candlesSeries = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceFormat: { type: "price", precision: 2, minMove: 0.05 },
    });
    const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", color: "#2b3038" });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const mk = (color: string, width: 1 | 2 | 3 | 4, style = LineStyle.Solid) =>
      chart.addLineSeries({
        color,
        lineWidth: width,
        lineStyle: style,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

    lineRefs.current = [
      mk("#ffb020", 1), // ema9
      mk("#5aa9e6", 1), // ema21
      mk("#c86ce0", 1), // ema50
      mk("#6b7280", 2), // ema200
      mk("#e8e4da", 1, LineStyle.Dashed), // vwap
      mk("#3d4450", 1), // bb up
      mk("#3d4450", 1), // bb lo
    ];
    candleRef.current = candlesSeries;
    volRef.current = vol;
    winRef.current = null;
    zonesSigRef.current = "";
    markersSigRef.current = "";

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      lineRefs.current = [];
      priceLinesRef.current = [];
      winRef.current = null;
    };
  }, []);

  // 2) volume visibility toggles the existing series instead of rebuilding
  useEffect(() => {
    volRef.current?.applyOptions({ visible: showVolume });
  }, [showVolume]);

  // 3) candle data — incremental append when safe, authoritative setData otherwise
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    const t0 = performance.now();
    const next = toWindow(candles);
    const plan = planCandleUpdate(winRef.current, next);
    if (plan === "skip") return;

    if (plan === "setData" || !candles.length) {
      series.setData(
        candles.map((c) => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })),
      );
      volRef.current?.setData(
        showVolume
          ? candles.map((c) => ({
              time: c.t as UTCTimestamp,
              value: c.v,
              color: c.c >= c.o ? "rgba(38,208,124,0.35)" : "rgba(255,92,92,0.35)",
            }))
          : [],
      );
    } else {
      const c = candles[candles.length - 1];
      series.update({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c });
      volRef.current?.update({
        time: c.t as UTCTimestamp,
        value: c.v,
        color: c.c >= c.o ? "rgba(38,208,124,0.35)" : "rgba(255,92,92,0.35)",
      });
    }
    winRef.current = next;
    const ms = Math.round(performance.now() - t0);
    if (host.current) host.current.dataset.renderMs = String(ms);
    if (plan === "setData" && candles.length > 1) {
      console.info(`[chart] full setData ${candles.length} bars in ${ms}ms`);
    }
  }, [candles, showVolume]);

  // 4) indicators update independently of candles
  useEffect(() => {
    const lines = lineRefs.current;
    if (lines.length !== 7) return;
    const put = (i: number, arr: (number | null)[] | undefined, visible: boolean) => {
      const line = lines[i];
      if (!line) return;
      if (!visible || !arr) {
        line.setData([]);
        return;
      }
      line.setData(
        arr.flatMap((v, k) =>
          v === null || !candles[k] ? [] : [{ time: candles[k].t as UTCTimestamp, value: v }],
        ),
      );
    };
    put(0, overlay.ema9, showEma);
    put(1, overlay.ema21, showEma);
    put(2, overlay.ema50, showEma);
    put(3, overlay.ema200, showEma);
    put(4, overlay.vwap, showVwap);
    put(5, overlay.bbUp, showBb);
    put(6, overlay.bbLo, showBb);
  }, [candles, overlay, showEma, showBb, showVwap]);

  // 5) S/R price lines rebuilt only when the zone set actually changed
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    const sig = showZones ? zonesSignature(zones) : "";
    if (sig === zonesSigRef.current) return;
    for (const pl of priceLinesRef.current) series.removePriceLine(pl);
    priceLinesRef.current = [];
    if (!showZones) {
      zonesSigRef.current = sig;
      return;
    }
    for (const z of zones) {
      const isOi = z.kind === "oi-only";
      priceLinesRef.current.push(
        series.createPriceLine({
          price: z.price,
          color: z.side === "support" ? (isOi ? "#2f7d5b" : UP) : isOi ? "#8a4b4b" : DOWN,
          lineWidth: z.strength >= 70 ? 2 : 1,
          lineStyle: isOi ? LineStyle.Dashed : LineStyle.Solid,
          axisLabelVisible: true,
          title: `${z.side === "support" ? "S" : "R"} ${z.strength}${isOi ? "·OI" : ""}`,
        }),
      );
    }
    zonesSigRef.current = sig;
  }, [zones, showZones]);

  // 6) markers only when they change
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    const sig = markersSignature(markers);
    if (sig === markersSigRef.current) return;
    series.setMarkers(
      markers.slice().sort((a, b) => a.time - b.time).map((m) => ({ ...m, time: m.time as UTCTimestamp })),
    );
    markersSigRef.current = sig;
  }, [markers]);

  // 7) fit only on initial load / symbol or timeframe switch — zoom is preserved
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !candles.length) return;
    chart.timeScale().fitContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return <div ref={host} className="w-full h-[280px] sm:h-[340px] md:h-[440px] touch-manipulation" />;
}

export function ScoreChart({ data }: { data: { t: number; bull: number; bear: number }[] }) {
  const host = useRef<HTMLDivElement>(null);
  const dataSig = useRef("");
  useEffect(() => {
    if (!host.current) return;
    const chart = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0a0c0f" },
        textColor: "#9a958a",
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: 10,
      },
      grid: { vertLines: { color: "#12161b" }, horzLines: { color: "#12161b" } },
      rightPriceScale: { borderColor: "#1b1f25" },
      timeScale: { borderColor: "#1b1f25", timeVisible: true },
      crosshair: { mode: CrosshairMode.Magnet },
    });
    const bull = chart.addLineSeries({ color: UP, lineWidth: 2, priceLineVisible: false, title: "BULL" });
    const bear = chart.addLineSeries({ color: DOWN, lineWidth: 2, priceLineVisible: false, title: "BEAR" });
    const apply = () => {
      bull.setData(data.filter((d) => d.bull !== null).map((d) => ({ time: d.t as UTCTimestamp, value: d.bull })));
      bear.setData(data.filter((d) => d.bear !== null).map((d) => ({ time: d.t as UTCTimestamp, value: d.bear })));
      chart.timeScale().fitContent();
      dataSig.current = JSON.stringify(data.map((d) => d.t));
    };
    apply();
    dataSig.current = JSON.stringify(data.map((d) => `${d.t}:${d.bull}:${d.bear}`));
    return () => {
      chart.remove();
      dataSig.current = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={host} className="w-full h-[130px] md:h-[150px]" />;
}
