'use client';
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import type { SessionRunner } from '@engine/runner';
import type { NewsEvent, Order, OrderInput, Side, OrderType } from '@engine/types';
import { liveContribution } from '@engine/players';
import { Blotter, NewsFeed, PriceChart, RiskPanel, Watchlist } from './panels';
import { practiceClock, courseClock, proxyBenchmark } from '@/lib/practice';
import { accountSummary, positionRows, commissionEstimate } from './helpers';
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
  /** Guided lessons: the clock stops at `holdAt()` and `onHold` is called while it waits there. */
  lesson?: LessonHooks;
  /** Rendered over the terminal (lesson decision banner). */
  overlay?: ReactNode;
  /** Hint mode: extra content under each headline (playbook card). */
  hint?: (e: NewsEvent) => ReactNode;
  practiceQuarters?: boolean;
  hideEnd?: boolean;
  abandonLabel?: string;
}

export interface LessonHooks { holdAt(): number | null; onHold(tick: number): void }

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

export function Terminal({ runner, title, secondsPerTick, disguise, initialElapsedMs, onProgress, onFinish, onAbandon, team, lesson, overlay, hint, practiceQuarters = false, hideEnd, abandonLabel }: Props) {
  const [version, bump] = useReducer((x: number) => x + 1, 0);
  const [selected, setSelected] = useState<string>(() => runner.path.assets.includes('HSI') ? 'HSI' : runner.path.assets[0]);
  const [side, setSide] = useState<Side>('buy');
  const [qty, setQty] = useState<string>('');
  const [type, setType] = useState<OrderType>('market');
  const [limitPx, setLimitPx] = useState<string>('');
  const [paused, setPaused] = useState(false);
  /** Phone layout only: which section fills the screen. */
  const [mtab, setMtab] = useState<'trade' | 'news' | 'book' | 'risk'>('trade');
  const [seenNews, setSeenNews] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const clock = useRef({ elapsed: initialElapsedMs, last: 0, paused: false });
  const clockEl = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState(() => runner.rules.practice ? courseClock(initialElapsedMs / 1000, runner.rules.practice.quarterSeconds, runner.rules.practice.rebalanceSeconds).phase : 'trading');
  const lastSaved = useRef(0);
  const quarterEl = useRef<HTMLElement>(null);
  const finished = useRef(false);
  const lastMarginCall = useRef(false);
  const toastSeq = useRef(0);
  const pauseAllowed = runner.rules.difficulty[runner.difficulty].pauseAllowed && !team;
  const teamRef = useRef(team);
  teamRef.current = team;
  const lessonRef = useRef(lesson);
  lessonRef.current = lesson;
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
      const format = runner.rules.practice;
      const qc = format ? courseClock(c.elapsed / 1000, format.quarterSeconds, format.rebalanceSeconds) : null;
      let target = qc ? Math.min(N, Math.floor(qc.tradingFraction * N + 1e-9)) : Math.min(N, Math.floor(c.elapsed / 1000 / secondsPerTick));
      if (qc) setPhase(prev => prev === qc.phase ? prev : qc.phase);
      const hold = lessonRef.current?.holdAt() ?? null;
      if (hold !== null && target >= hold) { target = hold; c.elapsed = Math.min(c.elapsed, hold * secondsPerTick * 1000); }
      const before = runner.tick;
      if (tm) tm.advance(target); else while (runner.tick < target && !runner.finished) runner.step();
      const stepped = runner.tick !== before;
      if (clockEl.current) clockEl.current.textContent = fmtClock(qc ? qc.totalRemaining : N * secondsPerTick - c.elapsed / 1000);
      if (quarterEl.current && qc) quarterEl.current.textContent = `Q${qc.quarter} ${qc.phase === 'rebalance' ? 'rebalance' : ''} · ${fmtClock(qc.remaining)}`;
      else if (quarterEl.current && practiceQuarters) { const q = practiceClock(c.elapsed / 1000); quarterEl.current.textContent = `Q${q.quarter} · ${fmtClock(q.quarterRemaining)}`; }
      if (stepped) {
        bump();
        if (runner.metrics.marginCall && !lastMarginCall.current) toast('MARGIN CALL: reduce exposure now or positions will be liquidated');
        lastMarginCall.current = runner.metrics.marginCall;

      }
      if (c.elapsed - lastSaved.current >= 1000) { onProgress(c.elapsed); lastSaved.current = c.elapsed; }
      if (hold !== null && runner.tick === hold) lessonRef.current?.onHold(hold);
      if (runner.finished && !finished.current) { finished.current = true; onFinish(); }
    }, 100);
    return () => clearInterval(iv);
  }, [runner, secondsPerTick, N, onFinish, onProgress, toast, practiceQuarters]);

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
      if (tgt.tagName === 'TEXTAREA' || tgt.closest?.('[data-nohotkeys]')) return;
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
  const summary = accountSummary(positionRows(runner.pos, runner.fills, id => runner.price(id)), runner.fills);
  const presets = runner.rules.orders.sizePresetsPctNav;
  const benchmark = runner.rules.practice?.preset === 'course' ? proxyBenchmark(runner.path.prices, runner.tick) : null;
  const initialClock = runner.rules.practice ? courseClock(initialElapsedMs / 1000, runner.rules.practice.quarterSeconds, runner.rules.practice.rebalanceSeconds) : null;
  const notional = qtyNum * (type === 'limit' ? lim : px);
  const posQty = runner.qty(selected);
  const landedCount = runner.scenario.events.filter((e) => runner.path.eventTicks[e.id] <= runner.tick).length;
  const unread = mtab === 'news' ? 0 : landedCount - seenNews;
  const goTab = (k: typeof mtab) => { if (k === 'news' || mtab === 'news') setSeenNews(landedCount); setMtab(k); };

  return (
    <div className="term" data-mtab={mtab}>
      <div className="top">
        <span className="ttl m-hide" title={title}>{title}</span>
        <div className="stat clock"><span>Session left</span><b ref={clockEl}>{fmtClock(initialClock?.totalRemaining ?? N * secondsPerTick - initialElapsedMs / 1000)}</b></div>
        {(practiceQuarters || initialClock) && <div className="stat clock"><span>Quarter · time left</span><b ref={quarterEl}>{(() => { if (initialClock) return `Q${initialClock.quarter} ${initialClock.phase === 'rebalance' ? 'rebalance' : ''} · ${fmtClock(initialClock.remaining)}`; const q = practiceClock(initialElapsedMs / 1000); return `Q${q.quarter} · ${fmtClock(q.quarterRemaining)}`; })()}</b></div>}
        <div className="stat" title="Long positions only; shorts excluded"><span>Value of shares owned</span><b>{fmtMoney(summary.owned)}</b></div>
        <div className="stat"><span>Margin requirement</span><b>{fmtMoney(m.marginUsed)}</b></div>
        <div className="stat"><span>Realized P+L</span><b className={cls(summary.realized)}>{fmtMoney(summary.realized)}</b></div>
        <div className="stat"><span>Unrealized P+L</span><b className={cls(summary.unrealized)}>{fmtMoney(summary.unrealized)}</b></div>
        <div className="stat"><span>Commission Paid</span><b>{fmtMoney(summary.commission)}</b></div>
        <div className="stat"><span>Available cash</span><b>{fmtMoney(m.cash)}</b></div>
        <div className="stat"><span>Total PnL</span><b className={cls(m.pnl)}>{fmtMoney(m.pnl)}</b></div>
        {runner.rules.practice?.preset === 'course' && <div className="stat" title="Illustrative buy-and-hold proxy: 12.5% each 2800, SPX, NKY, SX5E; 15% each UST20Y, HKGB; 10% each gold, Brent. Not the official benchmark; no FX conversion."><span>Portfolio / proxy / excess</span><b className={benchmark === null ? '' : cls(m.ret - benchmark)}>{benchmark === null ? 'Proxy unavailable' : `${fmtPct(m.ret)} / ${fmtPct(benchmark)} / ${fmtPct(m.ret - benchmark)}`}</b></div>}
        <div className="stat score" title={`Trainer score, not official. Return ${m.score.return.toFixed(0)} · Sortino ${m.score.sortino.toFixed(0)} · Drawdown ${m.score.drawdown.toFixed(0)} · Mandate ${m.score.mandate.toFixed(0)}`}>
          <span>Trainer score</span><b>{m.score.composite.toFixed(1)}</b>
        </div>
        {m.mandate.some((c) => !c.ok) && <span className="banner" style={{ background: '#3d2f0c', color: 'var(--amber)' }}>MANDATE BREACH</span>}
        {m.marginCall && <span className="banner">MARGIN CALL</span>}
        <span className="m-hide" style={{ flex: 1 }} />
        {pauseAllowed && <button onClick={() => setPaused((p) => !p)}>{paused ? '▶ Resume' : '❚❚ Pause'}</button>}
        {team && (() => {
          const c = liveContribution(runner);
          const parts = Object.entries(team.names).map(([pid, n]) => [n, c[pid] ?? 0] as const);
          return <span className="small team" title="Each player's P&L from their own trades (opening allocation counted as team)">
            {parts.map(([n, v]) => <span key={n}>{n} <b className={`num ${cls(v)}`}>{fmtCompact(v)}</b></span>)}
            <span className="dim">Team open <b className={`num ${cls(c.team ?? 0)}`}>{fmtCompact(c.team ?? 0)}</b></span>
          </span>;
        })()}
        {team && team.peers.map((p) => (
          <span key={p.name} className="small" title={p.role.replace('_', ' ')}><span className="dot on" />{p.name}{p.selected ? <span className="dim"> · {runner.assetById[p.selected]?.ticker}</span> : null}</span>
        ))}
        {!hideEnd && <button onClick={() => {
          if (!confirm(team ? 'Fast-forward to year end for BOTH players? Current positions are held until the end and then scored.' : 'Fast-forward to year end? Your current positions are held until the end and then scored.')) return;
          if (team) void team.end().catch((e) => toast(e.message)); else { while (!runner.finished) runner.step(); bump(); }
        }}>End &amp; score</button>}
        <button className="ghost" onClick={() => { if (confirm(team ? 'Leave this team session? It keeps running for your team-mate.' : abandonLabel ? `${abandonLabel}? Progress in this attempt is lost.` : 'Abandon this session? It will not be scored.')) onAbandon(); }}>{team ? 'Leave' : abandonLabel ?? 'Abandon'}</button>
      </div>

      <div className="body">
        <div className="col" style={{ gridTemplateRows: 'minmax(0, 1fr)' }}>
          <NewsFeed runner={runner} disguise={disguise} hint={hint} onPick={(id) => { select(id); if (mtab === 'news') goTab('trade'); }} />
        </div>
        <div className="col mid">
          <PriceChart runner={runner} assetId={selected} disguise={disguise} secondsPerTick={secondsPerTick} />
          <div className="low">
            <Blotter runner={runner} onSelect={select} onFlatten={flatten} onCancel={cancelOne} names={team?.names} />
            <Watchlist runner={runner} selected={selected} onSelect={select} />
          </div>
        </div>
        <div className="col right">
          <section className="pan p-ticket">
            <header><b>EXCHANGE</b><span>{a?.ticker}</span><span className="sp" /><span>Pos <b className={cls(posQty)}>{fmtMoney(posQty)}</b></span></header>
            <div className="ticket">
              {phase === 'rebalance' && <div className="rebalance-info"><b>REBALANCING · prices frozen</b><div>Trading remains open. Compare current weights with initial proxy targets below. Proxy uses 2800, SPX, NKY, SX5E, UST20Y, HKGB, gold and Brent; no currency conversion. Trainer mandates and score are assumptions.</div><table className="q"><thead><tr><th>Class</th><th>Current</th><th>Proxy target</th></tr></thead><tbody>{([['equity', 0.5], ['bond', 0.3], ['commodity', 0.2], ['fx', 0]] as const).map(([key, target]) => <tr key={key}><td>{key}</td><td>{fmtPct(m.exposureByClass[key], 1, false)}</td><td>{fmtPct(target, 1, false)}</td></tr>)}</tbody></table></div>}
              <input aria-label="Selected ticker" value={a?.ticker ?? ''} readOnly />
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
              <div className="r exchange-buttons">
                <button className={`side sell ${side === 'sell' ? 'on' : ''}`} onClick={() => { setSide('sell'); void send({ ...input, side: 'sell' }); }}>BID · SELL {runner.rules.costs.enabled ? '' : fmtPx(px, a.decimals)}</button>
                <button className={`side buy ${side === 'buy' ? 'on' : ''}`} onClick={() => { setSide('buy'); void send({ ...input, side: 'buy' }); }}>OFFER · BUY {runner.rules.costs.enabled ? '' : fmtPx(px, a.decimals)}</button>
              </div>
              {runner.rules.costs.enabled && <div className="info warn">Execution prices include the engine spread; quotes are unavailable here.</div>}
              {type === 'limit' && <div className="info">Tick price shown is indicative; limit orders may fill on a later tick.</div>}
              <div className="exchange-value">PRICE <b>{fmtMoney(notional)}</b></div>
              <div className="exchange-value">COMMISSION <b>{fmtMoney(commissionEstimate(qtyNum, type === 'limit' ? lim : px, runner.rules.costs.enabled, runner.rules.costs.commissionBps))}</b></div>
              <div className="r"><button onClick={() => flatten(selected)} title="Flatten this asset">Flat <kbd>F</kbd></button><span className="dim">Enter sends selected {side} side · {type === 'limit' ? 'limit order' : 'market order'}</span></div>
              <div className="info">
                {qtyNum > 0 ? <>≈ {runner.rules.baseCurrency} {fmtCompact(notional)} · {eq > 0 ? fmtPct(notional / eq, 1, false) : '-'} of NAV · after: {preview ? fmtPct(preview.weightAfter, 1) : ''}</> : <>Last {fmtPx(px, a?.decimals ?? 2)} · presets size by % of NAV</>}
              </div>
              {preview && !preview.ok && <div className="info err">Will be rejected: {preview.reason}</div>}
              {preview?.ok && preview.newBreaches.length > 0 && <div className="info warn">⚠ Would breach mandate: {preview.newBreaches.join(', ')}</div>}
            </div>
          </section>
          <RiskPanel runner={runner} version={version + (team?.version ?? 0) * 1e6} />
          <div />
        </div>
      </div>

      <nav className="mtabs" aria-label="Terminal sections">
        {([['trade', 'Trade'], ['news', 'News'], ['book', 'Positions'], ['risk', 'Risk']] as const).map(([k, l]) => (
          <button key={k} className={mtab === k ? 'on' : ''} onClick={() => goTab(k)}>
            {l}{k === 'news' && unread > 0 ? <span className="badge">{unread}</span> : null}
            {k === 'risk' && (m.marginCall || m.mandate.some((c) => !c.ok)) ? <span className="badge">!</span> : null}
          </button>
        ))}
      </nav>

      <div className="hint">
        <span><kbd>B</kbd>/<kbd>S</kbd> side</span><span><kbd>1</kbd>-<kbd>{presets.length}</kbd> size {presets.join('/')}% NAV</span><span><kbd>⏎</kbd> send</span>
        <span><kbd>L</kbd> mkt/limit</span><span><kbd>F</kbd> flatten</span><span><kbd>X</kbd> cancel all</span><span><kbd>↑</kbd><kbd>↓</kbd> asset</span>
        {pauseAllowed && <span><kbd>Space</kbd> pause</span>}
        <span style={{ flex: 1 }} />
        <span>{runner.rules.costs.enabled ? 'Costs ON' : 'No transaction costs'} · Shorts {runner.rules.shorting.allowed ? 'on' : 'off'} · Max lev {runner.rules.margin.maxLeverage}x · Rules {runner.rules.version}</span>
      </div>

      {overlay}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.ok ? 'ok' : ''}`}>{t.text}</div>)}</div>
      {paused && <div style={{ position: 'fixed', inset: '38px 0 20px 0', background: '#000a', display: 'grid', placeItems: 'center', fontSize: 28, fontWeight: 700, color: 'var(--accent)' }} onClick={() => setPaused(false)}>PAUSED · Space to resume</div>}
    </div>
  );
}
