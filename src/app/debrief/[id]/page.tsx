'use client';
import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { replaySession, type SessionRunner } from '@engine/runner';
import { buildReport, computeOptimalPath, type OptimalResult, type Report } from '@engine/report';
import { tickLabel } from '@engine/path';
import { CLASS_LABEL } from '@engine/mandate';
import { normaliseWeights } from '@engine/scoring';
import { Nav } from '@/components/Nav';
import { LineChart } from '@/components/LineChart';
import { ClientCard } from '@/components/Briefing';
import { headlineOf } from '@/components/terminal/panels';
import { useJob, useStore, type CoachResult, type DebriefRow, type SessionRow } from '@/lib/store';
import { CAT_LABEL, cls, fmtCompact, fmtMoney, fmtPct, SRC_LABEL } from '@/lib/format';

export default function Debrief({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { store, ready } = useStore();
  const [session, setSession] = useState<SessionRow | null>(null);
  const [runner, setRunner] = useState<SessionRunner | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [optimal, setOptimal] = useState<OptimalResult | null>(null);
  const [debrief, setDebrief] = useState<DebriefRow | null>(null);
  const [err, setErr] = useState('');
  const [coachErr, setCoachErr] = useState('');

  useEffect(() => {
    if (!ready) return;
    (async () => {
      try {
        const s = await store.getSession(id);
        if (!s) throw new Error('Session not found.');
        const sc = await store.getScenario(s.scenario_id);
        // Deterministic: the same scenario + seed + rules + order log rebuilds the whole session exactly.
        const r = replaySession({ scenario: sc, seed: s.seed, rules: s.rules, client: s.client, difficulty: s.difficulty }, s.input_log);
        const spt = (s.session_minutes * 60) / r.N;
        const rep = buildReport(r, spt);
        setSession(s); setRunner(r); setReport(rep);
        const d = await store.getDebrief(id);
        setDebrief(d);
        setTimeout(() => {
          const opt = d?.optimal ?? computeOptimalPath(r);
          setOptimal(opt);
          if (!d?.optimal && store.kind === 'cloud') void store.saveDebrief(id, { optimal: opt, report: rep });
        }, 30);
      } catch (e) { setErr((e as Error).message); }
    })();
  }, [ready, store, id]);

  const { job, workerOnline } = useJob(store, debrief?.coach ? null : debrief?.coach_job_id);
  const coach: CoachResult | null = debrief?.coach ?? (job?.status === 'done' ? (job.result as CoachResult) : null);

  async function requestCoach() {
    if (!runner || !report || !session) return;
    setCoachErr('');
    try {
      const payload = coachPayload(runner, report, optimal, session);
      const j = await store.enqueueJob('coach', payload);
      await store.saveDebrief(id, { coach_job_id: j.id });
      setDebrief((d) => ({ ...(d ?? { session_id: id, report, optimal, coach: null }), coach_job_id: j.id }));
    } catch (e) { setCoachErr((e as Error).message); }
  }

  const fmtNav = useMemo(() => (v: number) => fmtCompact(v), []);
  const fmtDD = useMemo(() => (v: number) => `${(v * 100).toFixed(1)}%`, []);
  const xLabel = useMemo(() => (runner ? (t: number) => tickLabel(t, runner.rules, runner.scenario, session?.disguise ?? true) : undefined), [runner, session]);
  const eqLines = useMemo(() => report ? [
    { label: 'You', color: '#5cc4ff', data: report.equity, step: report.curveStep },
    ...(optimal ? [{ label: 'Optimal (mandate-respecting)', color: '#f0b90b', data: optimal.equity, step: optimal.curveStep, dashed: true }] : []),
  ] : [], [report, optimal]);
  const ddLines = useMemo(() => report ? [{ label: 'Drawdown', color: '#ff5c74', data: report.drawdown.map((d) => -d), step: report.curveStep }] : [], [report]);
  const markers = useMemo(() => report?.events.map((e) => ({ tick: e.tick, text: '', color: e.reactionTicks === null ? '#4b5869' : '#ffb454' })), [report]);

  if (err) return <><Nav /><div className="page"><p className="note bad">{err}</p></div></>;
  if (!report || !runner || !session) return <><Nav /><div className="page dim">Rebuilding your session from the order log…</div></>;

  const f = report.final;
  const w = normaliseWeights(session.rules.scoring.weights);
  const name = (aid: string) => runner.assetById[aid]?.ticker ?? aid;
  const disguise = session.disguise;
  const title = runner.scenario.historical && disguise ? `${runner.scenario.historical.disguisedTitle} → ${runner.scenario.title}` : runner.scenario.title;

  return (
    <>
      <Nav />
      <main className="page grid">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1>Debrief · {title}</h1>
            <div className="small dim"><span className={`tag ${session.difficulty}`}>{session.difficulty}</span> {session.mode} · client {session.client.name} · seed {session.seed} · rules {session.rules.version}</div>
          </div>
          <div className="row">
            <Link href={`/pitch/new?session=${id}`}><button>🎤 Defend your strategy</button></Link>
            <Link href="/"><button className="primary">Next session ▶</button></Link>
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
          <div className="card kpi"><b style={{ color: 'var(--accent)', fontSize: 30 }}>{f.score.composite.toFixed(1)}</b><span>Composite score</span></div>
          {([['Return', f.score.return, w.return, fmtPct(f.ret)], ['Sortino', f.score.sortino, w.sortino, f.sortino.toFixed(2)], ['Drawdown', f.score.drawdown, w.drawdown, fmtPct(-f.maxDD, 1)], ['Mandate', f.score.mandate, w.mandate, `${f.penalisedTicks} penalty ticks`]] as const).map(([l, s, wt, raw]) => (
            <div key={l} className="card kpi"><b>{s.toFixed(0)}<span className="dim" style={{ fontSize: 12 }}> /100 × {(wt * 100).toFixed(0)}%</span></b><span>{l}: {raw}</span>
              <div className="bar ok" style={{ marginTop: 6 }}><i style={{ width: `${s}%` }} /></div></div>
          ))}
          <div className="card kpi"><b>{fmtMoney(f.equity)}</b><span>Final NAV (HKD){f.liquidations ? ` · ${f.liquidations} liquidation(s)` : ''}</span></div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
          <div className="card">
            <h2>Equity curve vs optimal path {optimal && <span className="dim small">· optimal {fmtPct(optimal.finalReturn, 1)} vs you {fmtPct(f.ret, 1)}</span>}</h2>
            <LineChart lines={eqLines} height={260} fmt={fmtNav} markers={markers} xLabel={xLabel} />
            <p className="small dim">Dots = headlines (amber = you traded within {session.rules.debrief.reactionWindowTicks} ticks, grey = no reaction). The optimal path knows the future and rebalances at each headline within the client mandate and the limits in config (max {session.rules.debrief.optimal.maxAssetWeight * 100}% per asset, {session.rules.debrief.optimal.maxLeverage}x). It is an upper bound to learn from, not a target.</p>
            <LineChart lines={ddLines} height={120} fmt={fmtDD} xLabel={xLabel} />
          </div>
          <div className="card">
            <h2>At a glance</h2>
            <table className="t small"><tbody>
              <tr><td>Avg reaction time</td><td className="r num">{report.avgReactionSeconds !== null ? `${report.avgReactionSeconds.toFixed(1)} s` : '-'}</td></tr>
              <tr><td>Headlines you reacted to</td><td className="r num">{report.reactedCount}/{report.events.length}</td></tr>
              <tr><td>Hit rate (right direction after news)</td><td className="r num">{report.hitRate !== null ? `${(report.hitRate * 100).toFixed(0)}% (${report.hits}/${report.hits + report.misses})` : '-'}</td></tr>
              <tr><td>Trades</td><td className="r num">{report.tradeCount}</td></tr>
              <tr><td>Turnover (traded / avg NAV)</td><td className="r num">{report.turnover.toFixed(1)}×</td></tr>
              <tr><td>Mandate breach episodes</td><td className="r num">{report.breaches.length}</td></tr>
              <tr><td>Max drawdown</td><td className="r num down">{fmtPct(-f.maxDD, 1)}</td></tr>
            </tbody></table>
            <h3 style={{ marginTop: 14 }}>P&amp;L by asset class</h3>
            <table className="t small"><tbody>
              {Object.entries(report.byClass).map(([c, v]) => <tr key={c}><td>{CLASS_LABEL[c as keyof typeof CLASS_LABEL]}</td><td className="r num">{v.trades} trades</td><td className={`r num ${cls(v.pnl)}`}>{fmtCompact(v.pnl)}</td></tr>)}
            </tbody></table>
          </div>
        </div>

        <div className="card">
          <h2>AI coach</h2>
          {coach ? <CoachView c={coach} /> : debrief?.coach_job_id ? (
            <div className="row">
              <span className={`tag ${job?.status === 'running' ? 'medium' : job?.status === 'failed' ? 'hard' : 'plain'}`}>{job?.status ?? 'queued'}</span>
              {job?.status === 'failed' ? <span className="down small">{job.error} <button onClick={requestCoach}>Retry</button></span>
                : job?.status === 'running' ? <span className="small">Claude is reviewing your session on your Mac… usually 1-3 minutes.</span>
                : <span className="small">{workerOnline === false ? 'Your Mac worker is offline. The critique will run as soon as it comes online (npm run worker). You can leave this page.' : 'Waiting for the worker to pick it up…'}</span>}
            </div>
          ) : (
            <div className="row">
              <button className="primary" onClick={requestCoach} disabled={store.kind === 'local'}>Ask the coach for a critique</button>
              <span className="small dim">{store.kind === 'local' ? 'Sign in to use the AI coach.' : '3 biggest mistakes, 3 things you did well, the market mechanism behind each mistake, and one drill. Runs on your Mac worker.'}</span>
            </div>
          )}
          {coachErr && <p className="note bad">{coachErr}</p>}
        </div>

        <div className="card">
          <h2>Headline by headline</h2>
          <table className="t small">
            <thead><tr><th>When</th><th>Source</th><th>Headline</th><th>Biggest expected movers</th><th className="r">Reaction</th><th>First trade</th><th className="r">Hits</th></tr></thead>
            <tbody>
              {report.events.map((e) => {
                const ev = runner.scenario.events.find((x) => x.id === e.eventId)!;
                return (
                  <tr key={e.eventId}>
                    <td className="num dim">{tickLabel(e.tick, runner.rules, runner.scenario, false)}</td>
                    <td><span className={`tag ${e.source}`}>{SRC_LABEL[e.source]}</span>{e.kind !== 'normal' && <div className="small amber">{e.kind.replace('_', ' ')}</div>}</td>
                    <td>{headlineOf(ev, false)}</td>
                    <td className="num">{e.topImpacts.slice(0, 3).map((t) => <span key={t.assetId} className={cls(t.impact)} style={{ marginRight: 8 }}>{name(t.assetId)} {fmtPct(t.impact, 1)}</span>)}</td>
                    <td className="r num">{e.reactionSeconds !== null ? `${e.reactionSeconds.toFixed(1)}s` : <span className="dim">none</span>}</td>
                    <td className="num">{e.firstTrade ? <span className={e.firstTrade.side === 'buy' ? 'up' : 'down'}>{e.firstTrade.side.toUpperCase()} {name(e.firstTrade.assetId)}</span> : ''}</td>
                    <td className="r num">{e.trades ? `${e.hits}/${e.trades}` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="card">
            <h2>Biggest missed opportunities</h2>
            {!optimal && <p className="dim small">Computing optimal path…</p>}
            <table className="t small"><tbody>
              {optimal?.missed.map((s) => (
                <tr key={s.fromTick}>
                  <td style={{ width: '45%' }}>{s.headline}<div className="dim">{tickLabel(s.fromTick, runner.rules, runner.scenario, false)} → {tickLabel(s.toTick, runner.rules, runner.scenario, false)}</div></td>
                  <td className="num">{Object.entries(s.weights).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4).map(([k, v]) => <div key={k} className={v > 0 ? 'up' : 'down'}>{name(k)} {(v * 100).toFixed(0)}%</div>)}</td>
                  <td className="r num">opt {fmtPct(s.optReturn, 1)}<div>you {fmtPct(s.myReturn, 1)}</div><b className="amber">gap {fmtPct(s.gap, 1)}</b></td>
                </tr>
              ))}
            </tbody></table>
          </div>
          <div className="card">
            <h2>Best &amp; worst trades</h2>
            <TradeTable title="Best 5" rows={report.best} name={name} r={runner} />
            <TradeTable title="Worst 5" rows={report.worst} name={name} r={runner} />
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="card">
            <h2>Mandate breaches</h2>
            {!report.breaches.length && <p className="small up">No breaches. Clean mandate.</p>}
            <table className="t small"><tbody>
              {report.breaches.map((b, i) => <tr key={i}><td>{b.label}</td><td className="num dim">{tickLabel(b.startTick, runner.rules)} → {tickLabel(b.endTick, runner.rules)}</td><td className="r num">{b.endTick - b.startTick + 1} ticks</td><td className={`r num ${b.penalisedTicks ? 'down' : ''}`}>{b.penalisedTicks} penalised</td></tr>)}
            </tbody></table>
          </div>
          <div><ClientCard client={runner.client} /></div>
        </div>
      </main>
    </>
  );
}

function TradeTable({ title, rows, name, r }: { title: string; rows: Report['best']; name: (id: string) => string; r: SessionRunner }) {
  return (
    <>
      <h3 style={{ marginTop: 8 }}>{title}</h3>
      <table className="t small"><tbody>
        {rows.map((t, i) => (
          <tr key={i}><td>{t.dir === 'long' ? 'Long' : 'Short'} {name(t.assetId)}</td><td className="num dim">{tickLabel(t.openTick, r.rules)} → {t.stillOpen ? 'end' : tickLabel(t.closeTick, r.rules)}</td>
            <td className="r num">{fmtMoney(t.qty)}</td><td className={`r num ${cls(t.pnl)}`}>{fmtCompact(t.pnl)}</td></tr>
        ))}
        {!rows.length && <tr><td className="dim">No trades.</td></tr>}
      </tbody></table>
    </>
  );
}

function CoachView({ c }: { c: CoachResult }) {
  return (
    <div className="grid" style={{ gap: 12 }}>
      <p style={{ margin: 0 }}>{c.summary}</p>
      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="grid" style={{ gap: 10 }}>
          <h3>3 biggest mistakes</h3>
          {c.mistakes.map((m, i) => (
            <div key={i} className="card" style={{ background: 'var(--panel2)' }}>
              <b className="down">{i + 1}. {m.title}</b>
              <p className="small" style={{ margin: '4px 0' }}>{m.whatHappened}</p>
              <div className="small dim">Why, step by step:</div>
              <ol className="steps small">{m.mechanism.map((s, j) => <li key={j}>{s}</li>)}</ol>
              <div className="small"><b>Next time:</b> {m.fix}</div>
            </div>
          ))}
        </div>
        <div className="grid" style={{ gap: 10, alignContent: 'start' }}>
          <h3>3 things you did well</h3>
          {c.strengths.map((s, i) => <div key={i} className="card" style={{ background: 'var(--panel2)' }}><b className="up">{s.title}</b><p className="small" style={{ margin: '4px 0 0' }}>{s.detail}</p></div>)}
          <h3>Your drill</h3>
          <div className="note info"><b>{c.drill.title}</b><ol className="steps small">{c.drill.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></div>
        </div>
      </div>
    </div>
  );
}

/** Compact, self-contained context for the coach job (the worker needs no DB reads). */
function coachPayload(r: SessionRunner, rep: Report, opt: OptimalResult | null, s: SessionRow) {
  const tk = (id: string) => r.assetById[id]?.ticker ?? id;
  return {
    sessionId: s.id,
    scenario: { title: r.scenario.title, storyline: r.scenario.storyline, regime: r.scenario.regime.name, difficulty: s.difficulty, mode: s.mode },
    client: r.client,
    rules: { startingCapital: s.rules.startingCapital, weights: s.rules.scoring.weights, costs: s.rules.costs.enabled, breachGraceTicks: s.rules.mandate.breachGraceTicks, ticksPerYear: r.N },
    secondsPerTick: (s.session_minutes * 60) / r.N,
    final: rep.final,
    events: rep.events.map((e) => ({ tick: e.tick, headline: r.scenario.events.find((x) => x.id === e.eventId)!.headline, source: e.source, category: e.category, kind: e.kind,
      expected: e.topImpacts.slice(0, 4).map((t) => `${tk(t.assetId)} ${(t.impact * 100).toFixed(1)}%`), reactionSeconds: e.reactionSeconds, firstTrade: e.firstTrade && `${e.firstTrade.side} ${tk(e.firstTrade.assetId)}`, hits: e.hits, misses: e.misses })),
    fills: r.fills.slice(0, 250).map((f) => ({ tick: f.tick, asset: tk(f.assetId), side: f.side, qty: f.qty, price: +f.price.toPrecision(6), source: f.source })),
    summary: { avgReactionSeconds: rep.avgReactionSeconds, hitRate: rep.hitRate, trades: rep.tradeCount, turnover: rep.turnover, breaches: rep.breaches, byClass: rep.byClass,
      best: rep.best.map((t) => `${t.dir} ${tk(t.assetId)} ${Math.round(t.pnl)}`), worst: rep.worst.map((t) => `${t.dir} ${tk(t.assetId)} ${Math.round(t.pnl)}`) },
    optimal: opt && { finalReturn: opt.finalReturn, missed: opt.missed.map((m) => ({ headline: m.headline, optReturn: m.optReturn, myReturn: m.myReturn, weights: Object.fromEntries(Object.entries(m.weights).map(([k, v]) => [tk(k), v])) })) },
  };
}
