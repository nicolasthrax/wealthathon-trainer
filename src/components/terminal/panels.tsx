'use client';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { createChart, LineSeries, CandlestickSeries, LineStyle, createSeriesMarkers, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { SessionRunner } from '@engine/runner';
import type { AssetDef, MandateCheck, NewsEvent } from '@engine/types';
import { tickLabel } from '@engine/path';
import { CLASS_LABEL } from '@engine/mandate';
import { percentChange, positionRows, candles, sma } from './helpers';
import { cls, fmtCompact, fmtMoney, fmtPct, fmtPx, SRC_LABEL, CAT_LABEL } from '@/lib/format';

const T0 = 1_700_000_000;
const tt = (tick: number) => (T0 + tick * 60) as UTCTimestamp;
const SRC_COLOR: Record<string, string> = { wire: '#5cc4ff', central_bank: '#ffb454', filing: '#2bd685', rumour: '#ff8ad0' };

export function headlineOf(e: NewsEvent, disguise: boolean) { return disguise && e.altHeadline ? e.altHeadline : e.headline; }

// ── News feed ────────────────────────────────────────────────────────────────
export function NewsFeed({ runner, disguise, onPick, hint }: { runner: SessionRunner; disguise: boolean; onPick?: (assetId: string) => void; hint?: (e: NewsEvent) => ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const tick = runner.tick;
  const landed = runner.scenario.events.filter((e) => runner.path.eventTicks[e.id] <= tick).sort((a, b) => runner.path.eventTicks[b.id] - runner.path.eventTicks[a.id]);
  const total = runner.scenario.events.length;
  return (
    <section className="pan p-news">
      <header><b>News</b><span>{landed.length}/{total}</span><span className="sp" /><span>newest first</span></header>
      <input data-nohotkeys aria-label="Search news" placeholder="Search keywords" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="sc">
        {!landed.length && <div className="news dim">Waiting for the first headline… Watch this feed: it flashes when news lands.</div>}
        {landed.filter(e => `${headlineOf(e, disguise)} ${e.body} ${Object.keys(e.assetShocks ?? {}).map(id => runner.assetById[id]?.ticker ?? id).join(' ')}`.toLowerCase().includes(query.toLowerCase())).map((e, i) => {
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
              {hint?.(e)}
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
  const [tab, setTab] = useState<'equity' | 'bond' | 'fx' | 'commodity' | 'cash'>('equity');
  const tabs = [['equity','1. EQUITY'],['bond','2. BOND'],['fx','3. FX'],['commodity','4. CMDTY'],['cash','CASH']] as const;
  return <section className="pan p-watch"><header>{tabs.map(([id,label]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}</header><div className="sc"><table className="q"><thead><tr><th>Ticker</th><th>Ref price</th><th>% Chg</th><th>Type</th></tr></thead><tbody>
    {runner.rules.assets.filter(a => a.cls === tab && runner.path.prices[a.id]).map(a => { const p = runner.price(a.id), change = percentChange(p, a.startPrice); return <tr key={a.id} className={`a${selected === a.id ? ' sel' : ''}`} onClick={() => onSelect(a.id)} title={a.name}><td className="tk">{a.ticker}</td><td>{fmtPx(p,a.decimals)}</td><td className={cls(change)}>{fmtPct(change,2)}</td><td>{CLASS_LABEL[a.cls]}</td></tr>; })}
  </tbody></table></div></section>;
}

// ── Main chart ───────────────────────────────────────────────────────────────
export function PriceChart({ runner, assetId, disguise, secondsPerTick }: { runner: SessionRunner; assetId: string; disguise: boolean; secondsPerTick: number }) {
  const el = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'line' | 'candle'>('line');
  const [average, setAverage] = useState(false);
  const [windowMinutes, setWindowMinutes] = useState<number | null>(null);
  const a = runner.assetById[assetId];
  useEffect(() => {
    if (!el.current || !a) return;
    const lbl = (t: Time) => tickLabel(((t as number) - T0) / 60, runner.rules, runner.scenario, disguise);
    const chart = createChart(el.current, { autoSize: true, layout: { background: { color: 'transparent' }, textColor: '#91aabd', fontSize: 10, attributionLogo: false }, grid: { vertLines: { color: '#17354a' }, horzLines: { color: '#17354a' } }, timeScale: { tickMarkFormatter: lbl }, localization: { timeFormatter: lbl } });
    const p = runner.path.prices[assetId], t = runner.tick;
    const bucket = mode === 'candle' ? Math.max(1, Math.ceil((windowMinutes ? windowMinutes * 60 / secondsPerTick : t + 1) / 100)) : 1;
    const opts = { priceFormat: { type: 'price' as const, precision: a.decimals, minMove: 1 / 10 ** a.decimals } };
    const series = mode === 'line' ? chart.addSeries(LineSeries, { ...opts, color: '#eabf50', lineWidth: 2 }) : chart.addSeries(CandlestickSeries, { ...opts, upColor: '#2bd685', downColor: '#ff5c74', borderVisible: false, wickUpColor: '#2bd685', wickDownColor: '#ff5c74' });
    if (mode === 'line') (series as ISeriesApi<'Line'>).setData(Array.from({length:t+1}, (_,i) => ({time:tt(i),value:p[i]})));
    else (series as ISeriesApi<'Candlestick'>).setData(candles(p,t,bucket).map(c => ({time:tt(c.tick),open:c.open,high:c.high,low:c.low,close:c.close})));
    const actual = Array.from(p.slice(0,t+1));
    for (const [label, value] of [['Session high', Math.max(...actual)], ['Session low', Math.min(...actual)]] as const) series.createPriceLine({price:value,color:'#70869b',lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:true,title:label});
    if (average) chart.addSeries(LineSeries, {color:'#70c3f3',lineWidth:1,priceLineVisible:false}).setData(sma(p,t,20).map(x => ({time:tt(x.tick),value:x.value})));
    const markers: SeriesMarker<Time>[] = [
      ...runner.scenario.events.filter(e => runner.path.eventTicks[e.id] <= t).map(e => ({time:tt(Math.floor(runner.path.eventTicks[e.id]/bucket)*bucket) as Time,position:'aboveBar' as const,shape:'circle' as const,color:SRC_COLOR[e.source],size:0.6,id:e.id})),
      ...runner.fills.filter(f => f.assetId === assetId && f.tick <= t).map(f => ({time:tt(Math.floor(f.tick/bucket)*bucket) as Time,position:f.side === 'buy' ? 'belowBar' as const : 'aboveBar' as const,shape:f.side === 'buy' ? 'arrowUp' as const : 'arrowDown' as const,color:f.side === 'buy' ? '#2bd685' : '#ff5c74',text:f.source === 'liquidation' ? 'LIQ' : ''}))
    ].sort((x,y) => (x.time as number)-(y.time as number));
    createSeriesMarkers(series, markers);
    if (windowMinutes && t > 0) chart.timeScale().setVisibleRange({from:tt(Math.max(0,t-Math.ceil(windowMinutes*60/secondsPerTick))),to:tt(t)}); else chart.timeScale().fitContent();
    return () => chart.remove();
  }, [runner, runner.tick, runner.fills.length, assetId, disguise, mode, average, windowMinutes, secondsPerTick, a]);
  return <section className="pan p-chart"><header><b>{a?.ticker}</b><span>PRICE</span><button className={mode === 'line' ? 'on' : ''} onClick={() => setMode('line')}>Line</button><button className={mode === 'candle' ? 'on' : ''} onClick={() => setMode('candle')}>Candlestick</button><button className={average ? 'on' : ''} onClick={() => setAverage(!average)}>SMA</button><span className="sp" />{[5,15,30,60,null].map(n => <button key={n ?? 'all'} className={windowMinutes === n ? 'on' : ''} onClick={() => setWindowMinutes(n)}>{n ? `${n}min` : 'All'}</button>)}</header><div ref={el} style={{flex:1,minHeight:0}} /></section>;
}

// ── Positions / orders / fills ───────────────────────────────────────────────
export function Blotter({ runner, onSelect, onFlatten, onCancel, names }: { runner: SessionRunner; onSelect: (id: string) => void; onFlatten: (id: string) => void; onCancel: (orderId: string) => void; names?: Record<string, string> }) {
  const who = (orderId: string) => { const pid = runner.orders.find((o) => o.id === orderId)?.participantId; return pid && names ? names[pid] ?? '' : ''; };
  const [tab, setTab] = useState<'pos' | 'trade'>('pos');
  const working = runner.orders.filter((o) => o.status === 'working');
  const rows = positionRows(runner.pos, runner.fills, id => runner.price(id));
  const unreal = rows.reduce((s, row) => s + row.unrealized, 0);
  return (
    <section className="pan p-book">
      <header>
        <button className={tab === 'pos' ? 'on' : ''} onClick={() => setTab('pos')}>POSITIONS {rows.length}</button>
        <button className={tab === 'trade' ? 'on' : ''} onClick={() => setTab('trade')}>TRADE BLOTTER</button>
        <span className="sp" />
        <span>Unrl <b className={cls(unreal)}>{fmtCompact(unreal)}</b></span>
      </header>
      <div className="sc">
        {tab === 'pos' && (
          <table className="q"><thead><tr><th>Security</th><th>Net pos</th><th>Avg price</th><th>Pos. value ($)</th><th>Unrealised P/L</th><th>Realised P/L</th><th>Net P/L</th><th></th></tr></thead><tbody>
            {rows.map(r => { const a = runner.assetById[r.id]; return <tr key={r.id} className="a" onClick={() => onSelect(r.id)}><td className="tk">{a.ticker}</td><td>{fmtMoney(r.qty)}</td><td>{fmtPx(r.avg,a.decimals)}</td><td>{fmtCompact(r.value)}</td><td className={cls(r.unrealized)}>{fmtCompact(r.unrealized)}</td><td className={cls(r.realized)}>{fmtCompact(r.realized)}</td><td className={cls(r.net)}>{fmtCompact(r.net)}</td><td>{r.qty !== 0 && <button onClick={e => {e.stopPropagation(); onFlatten(r.id);}}>Flat</button>}</td></tr>; })}
          </tbody></table>
        )}
        {tab === 'trade' && (<><h3>Working orders</h3>
          <table className="q">
            <thead><tr>{names && <th>Who</th>}<th>Asset</th><th>Side</th><th>Qty</th><th>Limit</th><th>Last</th><th></th></tr></thead>
            <tbody>
              {working.map((o) => (
                <tr key={o.id}>{names && <td>{o.participantId ? names[o.participantId] ?? '' : ''}</td>}<td className="tk">{runner.assetById[o.assetId].ticker}</td><td className={o.side === 'buy' ? 'up' : 'down'}>{o.side.toUpperCase()}</td>
                  <td>{fmtMoney(o.qty)}</td><td>{fmtPx(o.limitPrice!, runner.assetById[o.assetId].decimals)}</td><td>{fmtPx(runner.price(o.assetId), runner.assetById[o.assetId].decimals)}</td>
                  <td><button onClick={() => onCancel(o.id)}>Cancel</button></td></tr>
              ))}
              {!working.length && <tr><td colSpan={6} className="dim" style={{ textAlign: 'left' }}>No working limit orders. <kbd>X</kbd> cancels all.</td></tr>}
            </tbody>
          </table>
          <h3>Fills</h3>
          <table className="q">
            <thead><tr><th>Day</th>{names && <th>Who</th>}<th>Asset</th><th>Side</th><th>Qty</th><th>Price</th><th>Real. P&amp;L</th></tr></thead>
            <tbody>
              {[...runner.fills].reverse().slice(0, 80).map((f) => (
                <tr key={f.id}><td>{tickLabel(f.tick, runner.rules).replace('Day ', '').split('/')[0]}</td>{names && <td className="dim">{who(f.orderId)}</td>}<td className="tk">{runner.assetById[f.assetId].ticker}</td>
                  <td className={f.side === 'buy' ? 'up' : 'down'}>{f.source === 'liquidation' ? 'LIQ ' : ''}{f.side.toUpperCase()}</td><td>{fmtMoney(f.qty)}</td>
                  <td>{fmtPx(f.price, runner.assetById[f.assetId].decimals)}</td><td className={cls(f.realizedPnl)}>{f.realizedPnl ? fmtCompact(f.realizedPnl) : ''}</td></tr>
              ))}
            </tbody>
          </table></>
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
    <section className="pan p-risk">
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
