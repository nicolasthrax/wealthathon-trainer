'use client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { SessionRunner } from '@engine/runner';
import type { Order, OrderInput, Side, OrderType } from '@engine/types';
import { tickLabel } from '@engine/path';
import { Blotter, NewsFeed, PriceChart, RiskPanel, Watchlist } from './panels';
import { cls, fmtClock, fmtCompact, fmtMoney, fmtPct, fmtPx } from '@/lib/format';

export interface ClockState { elapsedMs: number }

interface Props {
  runner: SessionRunner;
  title: string;
  secondsPerTick: number;
  disguise: boolean;
  initialElapsedMs: number;
  onProgress: (elapsedMs: number) => void;
  onFinish: () => void;
  onAbandon: () => void;
  /** Team mode: shared clock and order routing through the sync layer. */
  team?: TeamProps;
}

export interface TeamProps {
  elapsedMs(): number;
  advance(tick: number): void;
  place(i: OrderInput): Promise<Order | null>;
  cancel(orderId: string): Promise<void>;
  end(): Promise<void>;
  /** participantId -> display name */
  names: Record<string, string>;
  peers: { name: string; role: string; selected?: string }[];
  /** Bumps whenever a team-mate's input changes the portfolio. */
  version: number;
  notice: { id: number; text: string } | null;
  onSelect(assetId: string): void;
}

type Toast = { id: number; text: string; ok?: boolean };

export function Terminal({ runner, title, secondsPerTick, disguise, initialElapsedMs, onProgress, onFinish, onAbandon, team }: Props) {
  const [version, bump] = useReducer((x: number) => x + 1, 0);
  const [selected, setSelected] = useState<string>(() => runner.path.assets.includes('HSI') ? 'HSI' : runner.path.assets[0]);
  const [side, setSide] = useState<Side>('buy');
  const [qty, setQty] = useState<string>('');
  const [type, setType] = useState<OrderType>('market');
  const [limitPx, setLimitPx] = useState<string>('');
  const [paused, setPaused] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const clock = useRef({ elapsed: initialElapsedMs, last: 0, paused: false });
  const clockEl = useRef<HTMLElement>(null);
  const finished = useRef(false);
  const lastMarginCall = useRef(false);
  const toastSeq = useRef(0);
  const pauseAllowed = runner.rules.difficulty[runner.difficulty].pauseAllowed && !team;
  const teamRef = useRef(team);
  teamRef.current = team;
  const N = runner.N;

  const toast = useCallback((text: string, ok = false) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-2), { id, text, ok }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  // ── Clock: wall-time based, so a slow frame or background tab never drifts the session ──
  useEffect(() => {
    clock.current.last = performance.now();
    const iv = setInterval(() => {
      const c = clock.current, now = performance.now(), tm = teamRef.current;
      if (tm) c.elapsed = tm.elapsedMs(); else if (!c.paused) c.elapsed += now - c.last;
      c.last = now;
      const target = Math.min(N, Math.floor(c.elapsed / 1000 / secondsPerTick));
      const before = runner.tick;
      if (tm) tm.advance(target); else while (runner.tick < target && !runner.finished) runner.step();
      const stepped = runner.tick !== before;
      if (clockEl.current) clockEl.current.textContent = fmtClock(N * secondsPerTick - c.elapsed / 1000);
      if (stepped) {
        bump();
        if (runner.metrics.marginCall && !lastMarginCall.current) toast('MARGIN CALL: reduce exposure now or positions will be liquidated');
        lastMarginCall.current = runner.metrics.marginCall;
        if (runner.tick % 10 === 0) onProgress(c.elapsed);
      }
      if (runner.finished && !finished.current) { finished.current = true; onFinish(); }
    }, 100);
    return () => clearInterval(iv);
  }, [runner, secondsPerTick, N, onFinish, onProgress, toast]);

  useEffect(() => { clock.current.paused = paused; }, [paused]);
  useEffect(() => { if (type === 'limit' && !limitPx) setLimitPx(runner.price(selected).toFixed(runner.assetById[selected].decimals)); }, [type, limitPx, selected, runner]);

  const a = runner.assetById[selected];
  const px = runner.price(selected);
  const eq = runner.metrics.equity;
  const qtyNum = Math.floor(Number(qty.replace(/,/g, '')) || 0);
  const lim = Number(limitPx) || px;
  const input: OrderInput = { assetId: selected, side, qty: qtyNum, type, limitPrice: type === 'limit' ? lim : undefined };
  const preview = qtyNum > 0 ? runner.preview(input) : null;

  const send = useCallback(async (inp: OrderInput) => {
    if (!(inp.qty > 0)) { toast('Enter a quantity (1-5 = % of NAV presets)'); return; }
    let o: Order | null;
    try { o = teamRef.current ? await teamRef.current.place(inp) : runner.placeOrder(inp); } catch (e) { toast(`Not sent: ${(e as Error).message}`); return; }
    if (!o) { toast('Order sent, waiting for sync…', true); bump(); return; }
    if (o.status === 'rejected') toast(`Rejected: ${o.reason}`);
    else if (o.status === 'working') toast(`Limit ${o.side} ${fmtMoney(o.qty)} ${runner.assetById[o.assetId].ticker} @ ${fmtPx(o.limitPrice!, runner.assetById[o.assetId].decimals)} working`, true);
    else toast(`${o.side === 'buy' ? 'Bought' : 'Sold'} ${fmtMoney(o.qty)} ${runner.assetById[o.assetId].ticker}`, true);
    bump();
  }, [runner, toast]);

  const flatten = useCallback(async (id: string) => {
    const q = runner.qty(id);
    let o: Order | null = null;
    if (q && teamRef.current) { try { o = await teamRef.current.place({ assetId: id, side: q > 0 ? 'sell' : 'buy', qty: Math.abs(q), type: 'market' }); } catch (e) { toast(`Not sent: ${(e as Error).message}`); return; } }
    else o = runner.flatten(id);
    if (!o) toast(`No position in ${runner.assetById[id].ticker}`); else if (o.status === 'rejected') toast(`Rejected: ${o.reason}`); else toast(`Flattened ${runner.assetById[id].ticker}`, true);
    bump();
  }, [runner, toast]);

  const preset = useCallback((pct: number) => {
    const p = runner.price(selected);
    if (p > 0) setQty(String(Math.floor((pct / 100) * runner.metrics.equity / p)));
  }, [runner, selected]);

  const select = useCallback((id: string) => { setSelected(id); setLimitPx(''); setQty(''); teamRef.current?.onSelect(id); }, []);
  const cancelOne = useCallback(async (orderId: string) => {
    if (teamRef.current) await teamRef.current.cancel(orderId).catch((e) => toast(`Not sent: ${e.message}`)); else runner.cancelOrder(orderId);
    bump();
  }, [runner, toast]);
  const cancelAll = useCallback(() => {
    for (const o of runner.orders) if (o.status === 'working') void cancelOne(o.id);
    toast('All working orders cancelled', true);
  }, [runner, cancelOne, toast]);
  useEffect(() => { if (team?.notice) toast(team.notice.text, true); }, [team?.notice, toast]);

  // ── Hotkeys ──
  const stateRef = useRef({ input, selected });
  stateRef.current = { input, selected };
  useEffect(() => {
    const presets = runner.rules.orders.sizePresetsPctNav;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tgt = e.target as HTMLElement;
      const inInput = tgt.tagName === 'INPUT' || tgt.tagName === 'SELECT' || tgt.tagName === 'TEXTAREA';
      const k = e.key.toLowerCase();
      const { input: inp, selected: sel } = stateRef.current;
      if (k === 'enter') { e.preventDefault(); send(inp); return; }
      if (k === 'escape') { (tgt as HTMLInputElement).blur?.(); setQty(''); return; }
      if (k === 'b') { e.preventDefault(); setSide('buy'); return; }
      if (k === 's') { e.preventDefault(); setSide('sell'); return; }
      if (k === 'f') { e.preventDefault(); flatten(sel); return; }
      if (k === 'x') { e.preventDefault(); cancelAll(); return; }
      if (k === 'l') { e.preventDefault(); setType((t) => (t === 'market' ? 'limit' : 'market')); return; }
      if (inInput) return;
      const n = Number(k);
      if (n >= 1 && n <= presets.length) { e.preventDefault(); preset(presets[n - 1]); return; }
      if (k === 'arrowdown' || k === 'arrowup') {
        e.preventDefault();
        const ids = runner.rules.assets.map((x) => x.id).filter((id) => runner.path.prices[id]);
        const i = ids.indexOf(sel);
        select(ids[(i + (k === 'arrowdown' ? 1 : -1) + ids.length) % ids.length]);
        return;
      }
      if (k === ' ' && pauseAllowed) { e.preventDefault(); setPaused((p) => !p); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runner, send, flatten, preset, select, pauseAllowed, toast, cancelAll]);

  const m = runner.metrics;
  const progress = runner.tick / N;
  const presets = runner.rules.orders.sizePresetsPctNav;
  const notional = qtyNum * (type === 'limit' ? lim : px);
  const posQty = runner.qty(selected);

  return (
    <div className="term">
      <div className="top">
        <span className="ttl" title={title}>{title}</span>
        <div className="stat clock"><span>Time left</span><b ref={clockEl}>{fmtClock(N * secondsPerTick - initialElapsedMs / 1000)}</b></div>
        <div className="stat"><span>Sim date</span><b>{tickLabel(runner.tick, runner.rules, runner.scenario, disguise)}</b></div>
        <div className="prog"><div className="bar"><i style={{ width: `${progress * 100}%` }} /></div></div>
        <div className="stat"><span>NAV (HKD)</span><b>{fmtMoney(m.equity)}</b></div>
        <div className="stat"><span>P&amp;L</span><b className={cls(m.pnl)}>{fmtCompact(m.pnl)}</b></div>
        <div className="stat"><span>Return</span><b className={cls(m.ret)}>{fmtPct(m.ret)}</b></div>
        <div className="stat"><span>Sortino</span><b>{m.sortino.toFixed(2)}</b></div>
        <div className="stat"><span>Max DD</span><b className={m.maxDD > 0.1 ? 'down' : ''}>{fmtPct(-m.maxDD, 1)}</b></div>
        <div className="stat score" title={`Return ${m.score.return.toFixed(0)} · Sortino ${m.score.sortino.toFixed(0)} · Drawdown ${m.score.drawdown.toFixed(0)} · Mandate ${m.score.mandate.toFixed(0)}`}>
          <span>Score</span><b>{m.score.composite.toFixed(1)}</b>
        </div>
        <span className="small dim" style={{ fontSize: 10 }}>R {m.score.return.toFixed(0)} · S {m.score.sortino.toFixed(0)} · D {m.score.drawdown.toFixed(0)} · M {m.score.mandate.toFixed(0)}</span>
        {m.mandate.some((c) => !c.ok) && <span className="banner" style={{ background: '#3d2f0c', color: 'var(--amber)' }}>MANDATE BREACH</span>}
        {m.marginCall && <span className="banner">MARGIN CALL</span>}
        <span style={{ flex: 1 }} />
        {pauseAllowed && <button onClick={() => setPaused((p) => !p)}>{paused ? '▶ Resume' : '❚❚ Pause'}</button>}
        {team && team.peers.map((p) => (
          <span key={p.name} className="small" title={p.role.replace('_', ' ')}><span className="dot on" />{p.name}{p.selected ? <span className="dim"> · {runner.assetById[p.selected]?.ticker}</span> : null}</span>
        ))}
        <button onClick={() => {
          if (!confirm(team ? 'Fast-forward to year end for BOTH players? Current positions are held until the end and then scored.' : 'Fast-forward to year end? Your current positions are held until the end and then scored.')) return;
          if (team) void team.end().catch((e) => toast(e.message)); else { while (!runner.finished) runner.step(); bump(); }
        }}>End &amp; score</button>
        <button className="ghost" onClick={() => { if (confirm(team ? 'Leave this team session? It keeps running for your team-mate.' : 'Abandon this session? It will not be scored.')) onAbandon(); }}>{team ? 'Leave' : 'Abandon'}</button>
      </div>

      <div className="body">
        <div className="col" style={{ gridTemplateRows: 'minmax(0, 1fr)' }}>
          <NewsFeed runner={runner} disguise={disguise} onPick={select} />
        </div>
        <div className="col mid">
          <PriceChart runner={runner} assetId={selected} disguise={disguise} />
          <div className="low">
            <Blotter runner={runner} onSelect={select} onFlatten={flatten} onCancel={cancelOne} names={team?.names} />
            <Watchlist runner={runner} selected={selected} onSelect={select} />
          </div>
        </div>
        <div className="col right">
          <section className="pan">
            <header><b>Order ticket</b><span>{a?.ticker}</span><span className="sp" /><span>Pos <b className={cls(posQty)}>{fmtMoney(posQty)}</b></span></header>
            <div className="ticket">
              <div className="r">
                <button className={`side buy ${side === 'buy' ? 'on' : ''}`} onClick={() => setSide('buy')}>BUY <kbd>B</kbd></button>
                <button className={`side sell ${side === 'sell' ? 'on' : ''}`} onClick={() => setSide('sell')}>SELL <kbd>S</kbd></button>
              </div>
              <div className="r">
                <label>Qty</label>
                <input inputMode="numeric" value={qty} placeholder="units" onChange={(e) => setQty(e.target.value.replace(/[^\d,]/g, ''))} aria-label="Quantity" />
                <span className="seg" style={{ flex: 'none' }}>
                  <button className={type === 'market' ? 'on' : ''} onClick={() => setType('market')} style={{ padding: '2px 8px', fontSize: 11 }}>MKT</button>
                  <button className={type === 'limit' ? 'on' : ''} onClick={() => { setType('limit'); if (!limitPx) setLimitPx(px.toFixed(a.decimals)); }} style={{ padding: '2px 8px', fontSize: 11 }}>LMT <kbd>L</kbd></button>
                </span>
              </div>
              <div className="r">
                {presets.map((p, i) => <button key={p} className="pre" onClick={() => preset(p)} title={`Hotkey ${i + 1}`}>{p}%</button>)}
                {posQty !== 0 && <button className="pre" onClick={() => { setQty(String(Math.abs(posQty))); setSide(posQty > 0 ? 'sell' : 'buy'); }} title="Close position size">Close</button>}
              </div>
              {type === 'limit' && (
                <div className="r"><label>Limit</label><input inputMode="decimal" value={limitPx} onChange={(e) => setLimitPx(e.target.value)} aria-label="Limit price" /></div>
              )}
              <div className="r">
                <button className={`send ${side}`} onClick={() => send(input)}>{side === 'buy' ? 'BUY' : 'SELL'} {qtyNum ? fmtMoney(qtyNum) : ''} {a?.ticker} <kbd>⏎</kbd></button>
                <button onClick={() => flatten(selected)} title="Flatten this asset" style={{ fontSize: 11 }}>Flat <kbd>F</kbd></button>
              </div>
              <div className="info">
                {qtyNum > 0 ? <>≈ HKD {fmtCompact(notional)} · {eq > 0 ? fmtPct(notional / eq, 1, false) : '-'} of NAV · after: {preview ? fmtPct(preview.weightAfter, 1) : ''}</> : <>Last {fmtPx(px, a?.decimals ?? 2)} · presets size by % of NAV</>}
              </div>
              {preview && !preview.ok && <div className="info err">Will be rejected: {preview.reason}</div>}
              {preview?.ok && preview.newBreaches.length > 0 && <div className="info warn">⚠ Would breach mandate: {preview.newBreaches.join(', ')}</div>}
            </div>
          </section>
          <RiskPanel runner={runner} version={version + (team?.version ?? 0) * 1e6} />
          <div />
        </div>
      </div>

      <div className="hint">
        <span><kbd>B</kbd>/<kbd>S</kbd> side</span><span><kbd>1</kbd>-<kbd>{presets.length}</kbd> size {presets.join('/')}% NAV</span><span><kbd>⏎</kbd> send</span>
        <span><kbd>L</kbd> mkt/limit</span><span><kbd>F</kbd> flatten</span><span><kbd>X</kbd> cancel all</span><span><kbd>↑</kbd><kbd>↓</kbd> asset</span>
        {pauseAllowed && <span><kbd>Space</kbd> pause</span>}
        <span style={{ flex: 1 }} />
        <span>{runner.rules.costs.enabled ? 'Costs ON' : 'No transaction costs'} · Shorts {runner.rules.shorting.allowed ? 'on' : 'off'} · Max lev {runner.rules.margin.maxLeverage}x · Rules {runner.rules.version}</span>
      </div>

      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.ok ? 'ok' : ''}`}>{t.text}</div>)}</div>
      {paused && <div style={{ position: 'fixed', inset: '38px 0 20px 0', background: '#000a', display: 'grid', placeItems: 'center', fontSize: 28, fontWeight: 700, color: 'var(--accent)' }} onClick={() => setPaused(false)}>PAUSED · Space to resume</div>}
    </div>
  );
}
