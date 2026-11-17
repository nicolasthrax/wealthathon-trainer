'use client';
import { useEffect, useRef } from 'react';
import { createChart, LineSeries, createSeriesMarkers, type IChartApi, type ISeriesApi, type UTCTimestamp, type SeriesMarker, type Time } from 'lightweight-charts';

export interface LineDef { label: string; color: string; data: number[]; step: number; dashed?: boolean }
export const T0 = 1_700_000_000;
export const tt = (tick: number) => (T0 + tick * 60) as UTCTimestamp;

/** Static multi-line chart (debrief, progress). x = tick index or sequence. */
export function LineChart({ lines, height = 240, fmt, markers, xLabel }: {
  lines: LineDef[]; height?: number; fmt?: (v: number) => string; markers?: { tick: number; text: string; color?: string }[]; xLabel?: (tick: number) => string;
}) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const chart: IChartApi = createChart(el.current, {
      height, autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#7a889c', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: '#141b26' }, horzLines: { color: '#141b26' } },
      rightPriceScale: { borderColor: '#1d2633' },
      timeScale: { borderColor: '#1d2633', tickMarkFormatter: (t: Time) => (xLabel ? xLabel(((t as number) - T0) / 60) : String(((t as number) - T0) / 60)) },
      localization: { priceFormatter: fmt ?? ((v: number) => v.toFixed(2)), timeFormatter: (t: Time) => (xLabel ? xLabel(((t as number) - T0) / 60) : String(((t as number) - T0) / 60)) },
      crosshair: { horzLine: { color: '#4b5869' }, vertLine: { color: '#4b5869' } },
    });
    let first: ISeriesApi<'Line'> | null = null;
    for (const l of lines) {
      const s = chart.addSeries(LineSeries, { color: l.color, lineWidth: 2, lineStyle: l.dashed ? 2 : 0, title: l.label, priceLineVisible: false, lastValueVisible: true });
      s.setData(l.data.map((v, i) => ({ time: tt(i * l.step), value: v })));
      first ??= s;
    }
    if (first && markers?.length) {
      const step = lines[0].step;
      createSeriesMarkers(first, markers.map((m) => ({ time: tt(Math.round(m.tick / step) * step), position: 'aboveBar', shape: 'circle', color: m.color ?? '#ffb454', text: m.text } as SeriesMarker<Time>)));
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [lines, height, fmt, markers, xLabel]);
  return <div ref={el} style={{ height, width: '100%' }} />;
}
