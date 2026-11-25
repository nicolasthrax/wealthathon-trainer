'use client';
import { useEffect, useState } from 'react';
import { Nav } from '@/components/Nav';
import { supabase, useStore } from '@/lib/store';
import { EVENT_RULES, type RuleOverrides } from '@config/event-rules';

export default function Settings() {
  const { store, ready } = useStore();
  const [o, setO] = useState<RuleOverrides>({});
  const [saved, setSaved] = useState('');
  const [pw, setPw] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  async function changePw() {
    if (!supabase) return;
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwMsg(error ? error.message : 'Password changed.');
    if (!error) setPw('');
  }
  useEffect(() => { if (ready) store.getOverrides().then(setO).catch(() => {}); }, [store, ready]);
  const w = { ...EVENT_RULES.scoring.weights, ...o.weights };
  const sum = w.return + w.sortino + w.drawdown + w.mandate;
  const setW = (k: keyof typeof w, v: number) => setO({ ...o, weights: { ...w, [k]: v } });
  async function save() { await store.saveOverrides(o); setSaved('Saved. New sessions use these values (old sessions keep their own snapshot).'); }
  return (
    <>
      <Nav />
      <main className="page grid" style={{ maxWidth: 820 }}>
        <h1>Settings</h1>
        <p className="note info small">The source of truth is <code>config/event-rules.ts</code> (version <b>{EVENT_RULES.version}</b>). These personal overrides sit on top of it for quick experiments.
          Every session stores a full snapshot of the rules it was played with.</p>
        <div className="card grid">
          <h2>Scoring weights</h2>
          {(['return', 'sortino', 'drawdown', 'mandate'] as const).map((k) => (
            <label key={k} className="row"><span style={{ width: 120, textTransform: 'capitalize' }}>{k}</span>
              <input type="range" min={0} max={100} value={Math.round(w[k] * 100)} onChange={(e) => setW(k, +e.target.value / 100)} style={{ flex: 1 }} />
              <span className="num" style={{ width: 70, textAlign: 'right' }}>{((w[k] / (sum || 1)) * 100).toFixed(0)}%</span></label>
          ))}
          <span className="small dim">Weights are normalised to sum to 100%. File default: {Object.entries(EVENT_RULES.scoring.weights).map(([k, v]) => `${k} ${v * 100}%`).join(', ')}.</span>
        </div>
        <div className="card grid">
          <h2>Event rules</h2>
          <p className="small dim">Practice sessions start with HKD 20,000,000. Previous sessions retain their saved rules.</p>
          <label className="row"><input type="checkbox" checked={o.costsEnabled ?? EVENT_RULES.costs.enabled} onChange={(e) => setO({ ...o, costsEnabled: e.target.checked })} />
            Transaction costs ({EVENT_RULES.costs.commissionBps}bp commission + per-class spreads)</label>
          <label className="f">Briefing phase (seconds) · file default {EVENT_RULES.clock.briefingSeconds}
            <input inputMode="numeric" value={o.briefingSeconds ?? ''} placeholder={String(EVENT_RULES.clock.briefingSeconds)} onChange={(e) => setO({ ...o, briefingSeconds: e.target.value === '' ? undefined : Number(e.target.value.replace(/\D/g, '')) })} /></label>
        </div>
        <div className="card grid">
          <h2>Change password</h2>
          <div className="row">
            <input type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} style={{ flex: 1 }} />
            <button disabled={pw.length < 8} onClick={changePw}>Change</button>
          </div>
          {pwMsg && <span className="small">{pwMsg}</span>}
        </div>
        <div className="row"><button className="primary" onClick={save}>Save</button><button onClick={() => setO({})}>Reset to file defaults</button><span className="small up">{saved}</span></div>
      </main>
    </>
  );
}
