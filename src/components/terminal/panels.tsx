'use client';
import { memo, useEffect, useRef, useState } from 'react';
import { createChart, AreaSeries, createSeriesMarkers, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { SessionRunner } from '@engine/runner';
import type { AssetDef, MandateCheck, NewsEvent } from '@engine/types';
import { tickLabel } from '@engine/path';
import { CLASS_LABEL } from '@engine/mandate';
import { Sparkline } from '../Sparkline';
import { cls, fmtCompact, fmtMoney, fmtPct, fmtPx, SRC_LABEL, CAT_LABEL } from '@/lib/format';

const T0 = 1_700_000_000;
const tt = (tick: number) => (T0 + tick * 60) as UTCTimestamp;
const SRC_COLOR: Record<string, string> = { wire: '#5cc4ff', central_bank: '#ffb454', filing: '#2bd685', rumour: '#ff8ad0' };

export function headlineOf(e: NewsEvent, disguise: boolean) { return disguise && e.altHeadline ? e.altHeadline : e.headline; }

// ── News feed ────────────────────────────────────────────────────────────────
export function NewsFeed({ runner, disguise, onPick }: { runner: SessionRunner; disguise: boolean; onPick?: (assetId: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const tick = runner.tick;
  const landed = runner.scenario.events.filter((e) => runner.path.eventTicks[e.id] <= tick).sort((a, b) => runner.path.eventTicks[b.id] - runner.path.eventTicks[a.id]);
  const total = runner.scenario.events.length;
  return (
    <section className="pan">
      <header><b>News</b><span>{landed.length}/{total}</span><span className="sp" /><span>newest first</span></header>
      <div className="sc">
        {!landed.length && <div className="news dim">Waiting for the first headline… Watch this feed: it flashes when news lands.</div>}
        {landed.map((e, i) => {
          const t = runner.path.eventTicks[e.id];
          const fresh = tick - t <= 2;
          const expanded = open === e.id || (i === 0 && open === null);
          const linked = e.linkedTo ? runner.scenario.events.find((x) => x.id === e.linkedTo) : null;
          return (
            <div key={e.id} className={`news${fresh ? ' fresh' : ''}`} onClick={() => setOpen(open === e.id ? '' : e.id)}>
              <div className="meta">
                <span className={`tag ${e.source}`}>{SRC_LABEL[e.source]}</span>
                <span>{CAT_LABEL[e.category]}</span>
                <span className="sp" style={{ flex: 1 }} />
                <span className="num">{tickLabel(t, runner.rules, runner.scenario, disguise)}</span>
              </div>
              <div className="hl">{headlineOf(e, disguise)}</div>
              {expanded && (
                <div className="bd">
                  {e.body}
                  {linked && <div className="small dim" style={{ marginTop: 3 }}>Re: &ldquo;{headlineOf(linked, disguise)}&rdquo;</div>}
                  {e.assetShocks && onPick && (
                    <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {Object.keys(e.assetShocks).filter((a) => runner.path.prices[a]).map((a) => (
                        <button key={a} className="small" style={{ padding: '0 6px', fontSize: 10 }} onClick={(ev) => { ev.stopPropagation(); onPick(a); }}>{runner.assetById[a].ticker}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Watchlist ────────────────────────────────────────────────────────────────
export function Watchlist({ runner, selected, onSelect }: { runner: SessionRunner; selected: string; onSelect: (id: string) => void }) {
  const t = runner.tick;
  let lastGroup = '';
  const rows: React.ReactNode[] = [];
  for (const a of runner.rules.assets) {
    if (!runner.path.prices[a.id]) continue;
    if (a.group !== lastGroup) { lastGroup = a.group; rows.push(<tr key={`g${a.group}`} className="g"><td colSpan={5}>{a.group}</td></tr>); }
    const p = runner.path.prices[a.id];
    const chg = p[t] / p[0] - 1;
    const d1 = t >= 5 ? p[t] / p[t - 5] - 1 : 0;
    const q = runner.qty(a.id);
    rows.push(
      <tr key={a.id} className={`a${selected === a.id ? ' sel' : ''}`} onClick={() => onSelect(a.id)} title={a.name}>
        <td><span className="tk">{a.ticker}</span>{q !== 0 && <span className={q > 0 ? 'up' : 'down'} style={{ marginLeft: 4 }}>{q > 0 ? '▲' : '▼'}</span>}</td>
        <td>{fmtPx(p[t], a.decimals)}</td>
        <td className={cls(d1)}>{d1 ? fmtPct(d1, 2) : ''}</td>
        <td className={cls(chg)}>{fmtPct(chg, 1)}</td>
        <td><Sparkline data={p} from={Math.max(0, t - 150)} to={t} /></td>
      </tr>,
    );
  }
  return (
    <section className="pan">
      <header><b>Quotes</b><span className="sp" /><span><kbd>↑</kbd><kbd>↓</kbd> select</span></header>
      <div className="sc">
        <table className="q">
          <thead><tr><th>Asset</th><th>Last</th><th>Δ5</th><th>Chg</th><th>Trend</th></tr></thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </section>
  );
}

// ── Main chart ───────────────────────────────────────────────────────────────
export function PriceChart({ runner, assetId, disguise }: { runner: SessionRunner; assetId: string; disguise: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const shown = useRef({ asset: '', tick: -1, events: -1, fills: -1 });
  const a = runner.assetById[assetId];

  useEffect(() => {
    if (!el.current) return;
    const lbl = (t: Time) => tickLabel(((t as number) - T0) / 60, runner.rules, runner.scenario, disguise);
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#7a889c', fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: '#111823' }, horzLines: { color: '#111823' } },
      rightPriceScale: { borderColor: '#1d2633' },
      timeScale: { borderColor: '#1d2633', tickMarkFormatter: lbl, rightOffset: 6 },
      localization: { timeFormatter: lbl },
      crosshair: { horzLine: { color: '#4b5869' }, vertLine: { color: '#4b5869' } },
    });
    const series = chart.addSeries(AreaSeries, { lineColor: '#5cc4ff', topColor: 'rgba(92,196,255,0.25)', bottomColor: 'rgba(92,196,255,0)', lineWidth: 2, priceLineColor: '#5cc4ff' });
    chartRef.current = chart; seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);
    shown.current = { asset: '', tick: -1, events: -1, fills: -1 };
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, [runner, disguise]);

  // Incremental update on each tick (series.update) — full setData only when the asset changes.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !a) return;
    const p = runner.path.prices[assetId];
    const t = runner.tick, sh = shown.current;
    s.applyOptions({ priceFormat: { type: 'price', precision: a.decimals, minMove: 1 / 10 ** a.decimals } });
    if (sh.asset !== assetId || t < sh.tick) {
      const data = new Array(t + 1);
      for (let i = 0; i <= t; i++) data[i] = { time: tt(i), value: p[i] };
      s.setData(data);
      chartRef.current?.timeScale().fitContent();
      sh.asset = assetId; sh.events = -1; sh.fills = -1;
    } else for (let i = sh.tick + 1; i <= t; i++) s.update({ time: tt(i), value: p[i] });
    sh.tick = t;
    const landed = runner.scenario.events.filter((e) => runner.path.eventTicks[e.id] <= t);
    const fills = runner.fills.filter((f) => f.assetId === assetId);
    if (landed.length !== sh.events || fills.length !== sh.fills) {
      sh.events = landed.length; sh.fills = fills.length;
      const ms: SeriesMarker<Time>[] = [
        ...landed.map((e) => ({ time: tt(runner.path.eventTicks[e.id]) as Time, position: 'aboveBar' as const, shape: 'circle' as const, color: SRC_COLOR[e.source], size: 0.6, id: e.id })),
        ...fills.map((f) => ({ time: tt(f.tick) as Time, position: f.side === 'buy' ? 'belowBar' as const : 'aboveBar' as const, shape: f.side === 'buy' ? 'arrowUp' as const : 'arrowDown' as const, color: f.side === 'buy' ? '#2bd685' : '#ff5c74', text: f.source === 'liquidation' ? 'LIQ' : '' })),
      ].sort((x, y) => (x.time as number) - (y.time as number));
      markersRef.current?.setMarkers(ms);
    }
  });

  const p = runner.path.prices[assetId];
  const chg = p ? p[runner.tick] / p[0] - 1 : 0;
  return (
    <section className="pan" style={{ minHeight: 0 }}>
      <header>
        <b>{a?.ticker}</b><span style={{ textTransform: 'none', letterSpacing: 0 }}>{a?.name}</span>
        <span className="num" style={{ color: 'var(--text)' }}>{p && fmtPx(p[runner.tick], a.decimals)}</span>
        <span className={`num ${cls(chg)}`}>{fmtPct(chg)}</span>
        <span className="sp" />
        <span style={{ textTransform: 'none', letterSpacing: 0 }}>
          {Object.entries(a?.loadings ?? {}).filter(([, v]) => Math.abs(v) >= 0.3).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(' · ')}
        </span>
      </header>
      <div ref={el} style={{ flex: 1, minHeight: 0 }} />
    </section>
  );
}

// ── Positions / orders / fills ───────────────────────────────────────────────
export function Blotter({ runner, onSelect, onFlatten, onChange }: { runner: SessionRunner; onSelect: (id: string) => void; onFlatten: (id: string) => void; onChange: () => void }) {
  const [tab, setTab] = useState<'pos' | 'ord' | 'fill'>('pos');
  const eq = runner.metrics.equity;
  const working = runner.orders.filter((o) => o.status === 'working');
  const ids = Object.keys(runner.pos);
  const unreal = ids.reduce((s, id) => s + runner.pos[id].qty * (runner.price(id) - runner.pos[id].avg), 0);
  return (
    <section className="pan">
      <header>
        <button className={tab === 'pos' ? 'on' : ''} onClick={() => setTab('pos')}>Positions {ids.length}</button>
        <button className={tab === 'ord' ? 'on' : ''} onClick={() => setTab('ord')}>Working {working.length}</button>
        <button className={tab === 'fill' ? 'on' : ''} onClick={() => setTab('fill')}>Fills {runner.fills.length}</button>
        <span className="sp" />
        <span>Unrl <b className={cls(unreal)}>{fmtCompact(unreal)}</b></span>
      </header>
      <div className="sc">
        {tab === 'pos' && (
          <table className="q">
            <thead><tr><th>Asset</th><th>Qty</th><th>Avg</th><th>Last</th><th>Value</th><th>%NAV</th><th>P&amp;L</th><th></th></tr></thead>
            <tbody>
              {ids.map((id) => {
                const a = runner.assetById[id], p = runner.pos[id], px = runner.price(id), v = p.qty * px, pnl = p.qty * (px - p.avg);
                return (
                  <tr key={id} className="a" onClick={() => onSelect(id)}>
                    <td className="tk">{a.ticker}</td><td className={p.qty > 0 ? 'up' : 'down'}>{fmtMoney(p.qty)}</td>
                    <td>{fmtPx(p.avg, a.decimals)}</td><td>{fmtPx(px, a.decimals)}</td><td>{fmtCompact(v)}</td>
                    <td>{eq > 0 ? fmtPct(v / eq, 1, false) : '-'}</td><td className={cls(pnl)}>{fmtCompact(pnl)}</td>
                    <td><button onClick={(e) => { e.stopPropagation(); onFlatten(id); }} title="Flatten (F)">Flat</button></td>
                  </tr>
                );
              })}
              <tr><td className="dim">Cash</td><td colSpan={3}></td><td className={cls(runner.cash)}>{fmtCompact(runner.cash)}</td><td>{eq > 0 ? fmtPct(runner.cash / eq, 1, false) : '-'}</td><td colSpan={2}></td></tr>
            </tbody>
          </table>
        )}
        {tab === 'ord' && (
          <table className="q">
            <thead><tr><th>Asset</th><th>Side</th><th>Qty</th><th>Limit</th><th>Last</th><th></th></tr></thead>
            <tbody>
              {working.map((o) => (
                <tr key={o.id}><td className="tk">{runner.assetById[o.assetId].ticker}</td><td className={o.side === 'buy' ? 'up' : 'down'}>{o.side.toUpperCase()}</td>
                  <td>{fmtMoney(o.qty)}</td><td>{fmtPx(o.limitPrice!, runner.assetById[o.assetId].decimals)}</td><td>{fmtPx(runner.price(o.assetId), runner.assetById[o.assetId].decimals)}</td>
                  <td><button onClick={() => { runner.cancelOrder(o.id); onChange(); }}>Cancel</button></td></tr>
              ))}
              {!working.length && <tr><td colSpan={6} className="dim" style={{ textAlign: 'left' }}>No working limit orders. <kbd>X</kbd> cancels all.</td></tr>}
            </tbody>
          </table>
        )}
        {tab === 'fill' && (
          <table className="q">
            <thead><tr><th>Day</th><th>Asset</th><th>Side</th><th>Qty</th><th>Price</th><th>Real. P&amp;L</th></tr></thead>
            <tbody>
              {[...runner.fills].reverse().slice(0, 80).map((f) => (
                <tr key={f.id}><td>{tickLabel(f.tick, runner.rules).replace('Day ', '').split('/')[0]}</td><td className="tk">{runner.assetById[f.assetId].ticker}</td>
                  <td className={f.side === 'buy' ? 'up' : 'down'}>{f.source === 'liquidation' ? 'LIQ ' : ''}{f.side.toUpperCase()}</td><td>{fmtMoney(f.qty)}</td>
                  <td>{fmtPx(f.price, runner.assetById[f.assetId].decimals)}</td><td className={cls(f.realizedPnl)}>{f.realizedPnl ? fmtCompact(f.realizedPnl) : ''}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

// ── Risk panel ───────────────────────────────────────────────────────────────
export function MandateMeter({ c, grace }: { c: MandateCheck; grace: number }) {
  const pctTxt = (x: number) => `${(x * 100).toFixed(0)}%`;
  const fill = c.kind === 'flag' ? (c.ok ? 0 : 100) : Math.min(100, c.util * 100);
  const state = !c.ok ? 'bad' : c.kind === 'max' && c.util > 0.9 ? 'warn' : 'ok';
  const val = c.kind === 'flag' ? (c.ok ? 'OK' : `${pctTxt(c.value)}`) : c.key === 'maxLeverage' ? `${c.value.toFixed(2)}/${c.limit.toFixed(2)}x` : `${pctTxt(c.value)}/${pctTxt(c.limit)}`;
  return (
    <div className={`meter ${c.ok ? '' : 'bad'}`} title={!c.ok ? `Breached for ${c.breachTicks} ticks (penalty after ${grace})` : ''}>
      <span className="l">{c.label}{!c.ok && <> · {c.breachTicks > grace ? 'PENALTY' : `${grace - c.breachTicks}t grace`}</>}</span>
      <span className={`v ${c.ok ? '' : 'down'}`}>{val}</span>
      <div className={`bar ${state}`}><i style={{ width: `${c.kind === 'min' ? Math.min(100, c.util * 100) : fill}%` }} /></div>
    </div>
  );
}

export const RiskPanel = memo(function RiskPanel({ runner }: { runner: SessionRunner; version: number }) {
  const m = runner.metrics;
  const grace = runner.rules.mandate.breachGraceTicks;
  return (
    <section className="pan">
      <header><b>Risk</b><span className="sp" />{m.marginCall && <span className="banner">MARGIN CALL</span>}</header>
      <div className="risk">
        <div className="kv">
          <div><span>Sortino</span><b className={cls(m.sortino)}>{m.sortino.toFixed(2)}</b></div>
          <div><span>Max DD</span><b className={m.maxDD > 0.1 ? 'down' : ''}>{fmtPct(-m.maxDD, 1)}</b></div>
          <div><span>VaR 95% 1d</span><b>{fmtCompact(m.var95)}</b></div>
          <div><span>Leverage</span><b className={m.leverage > 1.5 ? 'amber' : ''}>{m.leverage.toFixed(2)}x</b></div>
          <div><span>Margin used</span><b>{fmtCompact(m.marginUsed)}</b></div>
          <div><span>Margin free</span><b className={m.marginAvail < 0 ? 'down' : ''}>{fmtCompact(m.marginAvail)}</b></div>
        </div>
        <h3 style={{ margin: '2px 0 0' }}>Mandate · {runner.client.name}</h3>
        {m.mandate.map((c) => <MandateMeter key={c.key} c={c} grace={grace} />)}
      </div>
      <div className="expo">
        {(Object.keys(m.exposureByClass) as (keyof typeof m.exposureByClass)[]).map((k) => {
          const v = m.exposureByClass[k];
          return [
            <span key={`${k}l`} className="dim">{CLASS_LABEL[k]}</span>,
            <div key={`${k}b`} className="bar"><i style={{ width: `${Math.min(100, Math.abs(v) * 100)}%`, background: v < 0 ? 'var(--down)' : undefined }} /></div>,
            <span key={`${k}v`} className="num" style={{ textAlign: 'right' }}>{(v * 100).toFixed(0)}%</span>,
          ];
        })}
      </div>
    </section>
  );
}, (a, b) => a.version === b.version && a.runner === b.runner);

export type { AssetDef };
