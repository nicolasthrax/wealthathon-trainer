'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { EVENT_RULES } from '@config/event-rules';
import { Nav } from '@/components/Nav';
import { Moves, driverMap } from '@/components/learn/Playbook';
import { inlineTerm } from '@/components/learn/Rich';
import { CHEATSHEET_KEY, LESSONS, PLAYBOOKS } from '@/lib/learn';

const strip = (s: string) => s.replace(/\*\*/g, '').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, (_, id: string) => inlineTerm(id));

export default function CheatSheet() {
  useEffect(() => { try { localStorage.setItem(CHEATSHEET_KEY, new Date().toISOString()); } catch { /* private mode */ } }, []);
  const w = EVENT_RULES.scoring.weights;
  const news = PLAYBOOKS.filter((p) => p.kind === 'news' || p.id === 'hibor-spike');
  const process = PLAYBOOKS.filter((p) => p.kind === 'process' && p.id !== 'hibor-spike');
  return (
    <>
      <Nav />
      <main className="page cheat grid" style={{ gap: 10 }}>
        <div className="row noprint" style={{ justifyContent: 'space-between' }}>
          <Link href="/learn" className="small">← Learn</Link>
          <button onClick={() => window.print()}>🖨 Print (A4)</button>
        </div>
        <h1>Wealthathon cheat sheet</h1>
        <div className="card">
          <h2>Scoring rules of thumb</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Score = {Math.round(w.return * 100)}% return · {Math.round(w.sortino * 100)}% Sortino · {Math.round(w.drawdown * 100)}% max drawdown · {Math.round(w.mandate * 100)}% mandate. <b>65% is about risk.</b></li>
            <li>Noise isn&apos;t a trade: every losing tick hurts Sortino.</li>
            <li>Big shock against you: cut first. Drawdown is remembered all session.</li>
            <li>Breach: fix within {EVENT_RULES.mandate.breachGraceTicks} ticks. Single names → classes → minimums, plus 1-2 points of margin.</li>
            <li>Size: 2-5% of NAV per idea, add on confirmation, cut when the reason breaks. Rumours: 0-2%.</li>
          </ul>
        </div>
        <div className="card">
          <h2>News playbooks: trigger → what moves → size → exit</h2>
          <table className="t">
            <tbody>
              {news.map((p) => (
                <tr key={p.id}>
                  <td style={{ width: '16%' }}><b>{p.name}</b></td>
                  <td style={{ width: '24%' }} className="dim">{strip(p.trigger)}</td>
                  <td style={{ width: '24%' }}><Moves moves={p.moves} /></td>
                  <td>{strip(p.size)}</td>
                  <td style={{ width: '18%' }} className="dim">{strip(p.exit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid cheat-cols" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
          <div className="card">
            <h2>Driver map: when this goes up…</h2>
            <table className="t"><tbody>{driverMap().map((d) => <tr key={d.id}><td style={{ width: '38%' }}><b>{d.label}</b></td><td><Moves moves={d.moves} /></td></tr>)}</tbody></table>
            <div className="small dim" style={{ marginTop: 4 }}>USD/HKD is pegged at 7.75-7.85: HK rates (HIBOR) follow US rates.</div>
          </div>
          <div className="card">
            <h2>Process playbooks</h2>
            <table className="t"><tbody>{process.map((p) => <tr key={p.id}><td style={{ width: '32%' }}><b>{p.name}</b></td><td>{strip(p.size)}</td></tr>)}</tbody></table>
            <h2>Before every trade</h2>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li>Which driver did the headline move? Is it confirmed or a rumour?</li>
              <li>Which assets follow it, and which way?</li>
              <li>Mandate room: class caps, single names, shorting, currency.</li>
              <li>Size: 2-5% of NAV. Exit plan: when does the reason break?</li>
            </ol>
          </div>
        </div>
        <div className="small dim cheat-extra">Takeaways: {LESSONS.map((l) => `${l.n}. ${l.takeaways[0]}`).join(' ')}</div>
      </main>
    </>
  );
}
