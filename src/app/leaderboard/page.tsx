'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { useStore, type ScoreRow } from '@/lib/store';
import { fmtMoney, fmtPct } from '@/lib/format';

type SortKey = 'composite' | 'ret' | 'sortino' | 'max_dd' | 'created_at';

/** Personal leaderboard. Rows come from `scores`, which already carries team_id for a future team/global board. */
export default function Leaderboard() {
  const { store, ready } = useStore();
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [diff, setDiff] = useState('all');
  const [mode, setMode] = useState('all');
  const [sort, setSort] = useState<SortKey>('composite');
  useEffect(() => { if (ready) store.listScores().then(setRows).catch(() => {}); }, [store, ready]);
  const view = useMemo(() => rows.filter((r) => (diff === 'all' || r.difficulty === diff) && (mode === 'all' || r.mode === mode))
    .sort((a, b) => sort === 'created_at' ? b.created_at.localeCompare(a.created_at) : sort === 'max_dd' ? a.max_dd - b.max_dd : (b[sort] as number) - (a[sort] as number)), [rows, diff, mode, sort]);
  const th = (k: SortKey, label: string) => <th className="r" style={{ cursor: 'pointer', color: sort === k ? 'var(--accent)' : undefined }} onClick={() => setSort(k)}>{label}</th>;
  return (
    <>
      <Nav />
      <main className="page grid">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1>Leaderboard</h1>
          <div className="row">
            <span className="seg">{['all', 'easy', 'medium', 'hard'].map((d) => <button key={d} className={diff === d ? 'on' : ''} onClick={() => setDiff(d)}>{d}</button>)}</span>
            <span className="seg">{['all', 'synthetic', 'historical'].map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m}</button>)}</span>
          </div>
        </div>
        <div className="card">
          <table className="t">
            <thead><tr><th>#</th><th>Scenario</th><th>Client</th><th>Level</th>{th('composite', 'Score')}<th className="r">R / S / D / M</th>{th('ret', 'Return')}{th('sortino', 'Sortino')}{th('max_dd', 'Max DD')}<th className="r">Final NAV</th>{th('created_at', 'Date')}</tr></thead>
            <tbody>
              {view.map((r, i) => (
                <tr key={r.session_id}>
                  <td className="num dim">{i + 1}</td>
                  <td><Link href={`/debrief/${r.session_id}`}>{r.scenario_title}</Link> <span className="dim small">{r.mode === 'historical' ? 'hist' : ''}</span></td>
                  <td className="small">{r.client_name}</td>
                  <td><span className={`tag ${r.difficulty}`}>{r.difficulty}</span></td>
                  <td className="r num" style={{ color: 'var(--accent)', fontWeight: 700 }}>{Number(r.composite).toFixed(1)}</td>
                  <td className="r num small dim">{[r.return_score, r.sortino_score, r.drawdown_score, r.mandate_score].map((x) => Number(x).toFixed(0)).join(' / ')}</td>
                  <td className={`r num ${r.ret >= 0 ? 'up' : 'down'}`}>{fmtPct(Number(r.ret), 1)}</td>
                  <td className="r num">{Number(r.sortino).toFixed(2)}</td>
                  <td className="r num down">{fmtPct(-Number(r.max_dd), 1)}</td>
                  <td className="r num">{fmtMoney(Number(r.final_equity))}</td>
                  <td className="r small dim">{new Date(r.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {!view.length && <tr><td colSpan={11} className="dim">No sessions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
