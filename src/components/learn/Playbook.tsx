'use client';
import Link from 'next/link';
import { EVENT_RULES } from '@config/event-rules';
import type { Playbook } from '@engine/learn';
import { expectedImpact } from '@engine/path';
import type { NewsEvent } from '@engine/types';
import { Rich } from './Rich';
import { playbookFor } from '@/lib/learn';

const ticker = (id: string) => EVENT_RULES.assets.find((a) => a.id === id)?.ticker ?? id;
const arrow = (dir: number, strength = 1) => (dir > 0 ? '↑' : '↓').repeat(strength);

export function Moves({ moves }: { moves: Playbook['moves'] }) {
  if (!moves.length) return null;
  return <span className="pb-moves">{moves.map((m) => <span key={m.assetId} className={`pb-move ${m.dir > 0 ? 'u' : 'd'}`}>{ticker(m.assetId)} {arrow(m.dir, m.strength)}</span>)}</span>;
}

export function PlaybookDetail({ p }: { p: Playbook }) {
  return (
    <div className="grid" style={{ gap: 10 }}>
      <div><h3>When</h3><div><Rich text={p.trigger} /></div></div>
      {p.moves.length > 0 && <div><h3>What usually moves</h3><Moves moves={p.moves} /></div>}
      <div><h3>Why</h3><div className="small"><Rich text={p.why} /></div></div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
        <div><h3>Size</h3><div className="small"><Rich text={p.size} /></div></div>
        <div><h3>Exit</h3><div className="small"><Rich text={p.exit} /></div></div>
      </div>
      <div><h3>Watch out</h3><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{p.risks.map((r, i) => <li key={i}><Rich text={r} /></li>)}</ul></div>
    </div>
  );
}

/** Hint-mode card under a headline: playbook name + its usual key moves (never a size or an order). */
export function HintCard({ event }: { event: NewsEvent }) {
  const p = playbookFor(event, EVENT_RULES);
  if (!p) return null;
  return (
    <div className="hintcard" onClick={(e) => e.stopPropagation()}>
      <b>Hint: {p.name}.</b> {p.moves.length ? p.moves.map((m) => `${ticker(m.assetId)} ${arrow(m.dir, m.strength)}`).join(' · ') : p.size}{' '}
      <Link href={`/learn/playbooks/${p.id}`} target="_blank">playbook ↗</Link>
    </div>
  );
}

/** Small tag linking a headline to its playbook (debrief). */
export function PlaybookTag({ event }: { event: Pick<NewsEvent, 'source' | 'kind' | 'factorShocks'> }) {
  const p = playbookFor(event, EVENT_RULES);
  return p ? <Link href={`/learn/playbooks/${p.id}`} className="tag plain" style={{ marginLeft: 4, color: 'var(--purple)' }}>{p.name}</Link> : null;
}

// ── Driver map (cheat sheet): computed from the factor loadings, so it never drifts from the engine ──
const DRIVER_LABEL: Record<string, string> = { GEQ: 'Global growth ↑', CNHK: 'China / HK growth ↑', RATES: 'US rates ↑ (hawkish)', USD: 'US dollar ↑', CREDIT: 'Credit stress ↑', CMDTY: 'Oil & commodities ↑', RISKOFF: 'Fear ↑ (risk-off)' };
export function driverMap() {
  return EVENT_RULES.factors.map((f) => {
    const imp = expectedImpact({ factorShocks: { [f.id]: f.maxShock.moderate } }, EVENT_RULES);
    const ranked = Object.entries(imp).filter(([, v]) => Math.abs(v) >= 0.004).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6);
    const top = Math.abs(ranked[0]?.[1] ?? 1);
    return { id: f.id, label: DRIVER_LABEL[f.id] ?? f.name, moves: ranked.map(([assetId, v]) => ({ assetId, dir: (v > 0 ? 1 : -1) as 1 | -1, strength: (Math.abs(v) >= top * 0.6 ? 2 : 1) as 1 | 2 })) };
  });
}
