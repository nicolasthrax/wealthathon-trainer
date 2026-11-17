'use client';
import { useEffect, useMemo, useState } from 'react';
import { Nav } from '@/components/Nav';
import { LineChart } from '@/components/LineChart';
import { useStore, type DebriefRow, type ScoreRow } from '@/lib/store';
import { CLASS_LABEL } from '@engine/mandate';
import { CAT_LABEL, cls, fmtCompact } from '@/lib/format';

export default function Progress() {
  const { store, ready } = useStore();
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [debriefs, setDebriefs] = useState<DebriefRow[]>([]);
  useEffect(() => {
    if (!ready) return;
    store.listScores().then(setScores).catch(() => {});
    store.listDebriefs().then(setDebriefs).catch(() => {});
  }, [store, ready]);

  const chron = useMemo(() => [...scores].reverse(), [scores]);
  const lines = useMemo(() => {
    if (!chron.length) return [];
    const comp = chron.map((s) => Number(s.composite));
    const ma = comp.map((_, i) => { const w = comp.slice(Math.max(0, i - 4), i + 1); return w.reduce((a, b) => a + b, 0) / w.length; });
    return [{ label: 'Score', color: '#5cc4ff', data: comp, step: 1 }, { label: '5-session avg', color: '#f0b90b', data: ma, step: 1, dashed: true }];
  }, [chron]);
  const fmt1 = useMemo(() => (v: number) => v.toFixed(0), []);
  const xl = useMemo(() => (t: number) => `#${t + 1}`, []);

  const cat = useMemo(() => {
    const agg: Record<string, { events: number; reacted: number; hits: number; misses: number; rt: number[] }> = {};
    for (const d of debriefs) for (const [k, v] of Object.entries(d.report?.byCategory ?? {})) {
      const a = (agg[k] ??= { events: 0, reacted: 0, hits: 0, misses: 0, rt: [] });
      a.events += v.events; a.reacted += v.reacted; a.hits += v.hits; a.misses += v.misses;
      if (v.avgReactionSeconds !== null) a.rt.push(v.avgReactionSeconds);
    }
    return Object.entries(agg).map(([k, a]) => ({ k, ...a, hitRate: a.hits + a.misses ? a.hits / (a.hits + a.misses) : null, react: a.events ? a.reacted / a.events : 0, rtAvg: a.rt.length ? a.rt.reduce((x, y) => x + y, 0) / a.rt.length : null }))
      .sort((x, y) => (x.hitRate ?? 0) * x.react - (y.hitRate ?? 0) * y.react);
  }, [debriefs]);
  const byClass = useMemo(() => {
    const agg: Record<string, { pnl: number; trades: number }> = {};
    for (const d of debriefs) for (const [k, v] of Object.entries(d.report?.byClass ?? {})) { const a = (agg[k] ??= { pnl: 0, trades: 0 }); a.pnl += v.pnl; a.trades += v.trades; }
    return Object.entries(agg).sort((a, b) => a[1].pnl - b[1].pnl);
  }, [debriefs]);
  const byDiff = ['easy', 'medium', 'hard'].map((d) => {
    const s = scores.filter((x) => x.difficulty === d);
    const avg = (f: (x: ScoreRow) => number) => (s.length ? s.reduce((a, x) => a + f(x), 0) / s.length : null);
    return { d, n: s.length, comp: avg((x) => Number(x.composite)), r: avg((x) => Number(x.return_score)), so: avg((x) => Number(x.sortino_score)), dd: avg((x) => Number(x.drawdown_score)), m: avg((x) => Number(x.mandate_score)) };
  });
  const weakest = byDiff.filter((x) => x.n).flatMap((x) => [['Return', x.r], ['Sortino', x.so], ['Drawdown', x.dd], ['Mandate', x.m]] as const).reduce<Record<string, number[]>>((acc, [k, v]) => { (acc[k] ??= []).push(v ?? 0); return acc; }, {});
  const weakComp = Object.entries(weakest).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length] as const).sort((a, b) => a[1] - b[1])[0];

  return (
    <>
      <Nav />
      <main className="page grid">
        <h1>Progress</h1>
        {!scores.length && <p className="dim">Play a few sessions to see trends and weak spots.</p>}
        {lines.length > 0 && <div className="card"><h2>Score trend ({scores.length} sessions)</h2><LineChart lines={lines} height={220} fmt={fmt1} xLabel={xl} /></div>}
        {weakComp && <p className="note">Your weakest score component so far: <b>{weakComp[0]}</b> (avg {weakComp[1].toFixed(0)}/100).{cat[0] && <> Weakest news type: <b>{CAT_LABEL[cat[0].k]}</b>.</>} Focus your next drills there.</p>}
        <div className="grid" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
          <div className="card">
            <h2>Weak spots by news type</h2>
            <table className="t small">
              <thead><tr><th>Type</th><th className="r">Headlines</th><th className="r">Reacted</th><th className="r">Avg reaction</th><th className="r">Hit rate</th></tr></thead>
              <tbody>{cat.map((c) => (
                <tr key={c.k}><td>{CAT_LABEL[c.k] ?? c.k}</td><td className="r num">{c.events}</td><td className="r num">{(c.react * 100).toFixed(0)}%</td>
                  <td className="r num">{c.rtAvg !== null ? `${c.rtAvg.toFixed(1)}s` : '-'}</td>
                  <td className={`r num ${c.hitRate !== null && c.hitRate < 0.5 ? 'down' : 'up'}`}>{c.hitRate !== null ? `${(c.hitRate * 100).toFixed(0)}%` : '-'}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="grid" style={{ alignContent: 'start' }}>
            <div className="card">
              <h2>By asset class (total trade P&amp;L)</h2>
              <table className="t small"><tbody>{byClass.map(([k, v]) => <tr key={k}><td>{CLASS_LABEL[k as keyof typeof CLASS_LABEL]}</td><td className="r num">{v.trades} trades</td><td className={`r num ${cls(v.pnl)}`}>{fmtCompact(v.pnl)}</td></tr>)}</tbody></table>
            </div>
            <div className="card">
              <h2>By difficulty (avg)</h2>
              <table className="t small">
                <thead><tr><th>Level</th><th className="r">n</th><th className="r">Score</th><th className="r">R</th><th className="r">S</th><th className="r">D</th><th className="r">M</th></tr></thead>
                <tbody>{byDiff.map((x) => <tr key={x.d}><td><span className={`tag ${x.d}`}>{x.d}</span></td><td className="r num">{x.n}</td>
                  {[x.comp, x.r, x.so, x.dd, x.m].map((v, i) => <td key={i} className="r num">{v !== null ? v.toFixed(0) : '-'}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
