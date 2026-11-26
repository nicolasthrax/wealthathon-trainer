'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { currentRules, useStore, type Profile, type ScenarioMeta, type ScoreRow, type SessionRow } from '@/lib/store';
import { EVENT_RULES } from '@config/event-rules';
import type { Difficulty } from '@engine/types';
import { fmtPct } from '@/lib/format';
import { makePracticeRules, type PracticePreset } from '@/lib/practice';
import { usePresence } from '@/lib/presence';

const DIFFS: Difficulty[] = ['easy', 'medium', 'hard'];

export default function Home() {
  const { store, ready, user } = useStore();
  const router = useRouter();
  const [scenarios, setScenarios] = useState<ScenarioMeta[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [mode, setMode] = useState<'synthetic' | 'historical'>('synthetic');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [scenarioId, setScenarioId] = useState<string>('random');
  const [disguise, setDisguise] = useState(true);
  const [preset, setPreset] = useState<PracticePreset>('course');
  const [shortened, setShortened] = useState(false);
  const [hints, setHints] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [invites, setInvites] = useState<SessionRow[]>([]);

  useEffect(() => {
    if (!ready) return;
    store.listScenarios().then(setScenarios).catch((e) => setErr(String(e.message ?? e)));
    store.listScores().then(setScores).catch(() => {});
    store.listProfiles().then(setProfiles).catch(() => {});
    const loadInvites = () => store.listTeamSessions().then(setInvites).catch(() => {});
    loadInvites();
    const iv = setInterval(loadInvites, 8000);
    return () => clearInterval(iv);
  }, [store, ready]);

  const options = useMemo(() => scenarios.filter((s) => s.source === mode && (mode === 'historical' || s.difficulty === difficulty)), [scenarios, mode, difficulty]);
  const poolCount = (d: Difficulty) => scenarios.filter((s) => s.source === 'synthetic' && s.difficulty === d && s.used_count === 0).length;

  async function start(quick = false, team = false) {
    setBusy(true); setErr(null);
    try {
      const m = quick ? 'synthetic' : mode, d: Difficulty = quick ? 'medium' : difficulty;
      const pool = scenarios.filter((s) => s.source === m && (m === 'historical' || s.difficulty === d));
      if (!pool.length) throw new Error('No scenarios available for this choice.');
      let sc = !quick && scenarioId !== 'random' ? pool.find((s) => s.id === scenarioId) : undefined;
      if (!sc) {
        const minUsed = Math.min(...pool.map((s) => s.used_count));
        const fresh = pool.filter((s) => s.used_count === minUsed);
        sc = fresh[Math.floor(Math.random() * fresh.length)];
      }
      const clients = await store.listClients();
      const client = clients[Math.floor(Math.random() * clients.length)];
      const rules = makePracticeRules(await currentRules(store), preset, shortened);
      const seed = Math.random().toString(36).slice(2, 10);
      const row = await store.createSession({
        scenario: sc, client, seed, difficulty: m === 'historical' ? (quick ? 'medium' : difficulty) : sc.difficulty,
        disguise: m === 'historical' ? disguise : false, session_minutes: rules.practice!.quarterSeconds * 4 / 60, rules, team, hints: !quick && hints,
      });
      router.push(`/play/${row.id}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  const partners = profiles.filter((p) => p.id !== user?.id);
  const onlineNow = usePresence();
  const partnersOnline = partners.filter((p) => onlineNow.some((u) => u.userId === p.id));
  const myTeamSessions = invites.filter((x) => x.status === 'briefing' || x.status === 'active');
  const best = scores.length ? Math.max(...scores.map((s) => s.composite)) : null;
  const avg5 = scores.length ? scores.slice(0, 5).reduce((a, s) => a + s.composite, 0) / Math.min(5, scores.length) : null;

  return (
    <>
      <Nav />
      <main className="page grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
        <section className="grid">
          <div className="card">
            <h1>Practice session</h1>
            <p className="dim" style={{ marginTop: 0 }}>
              Choose the course-based USD 20M long-only preset or the legacy HKD 20M rules. Set an opening allocation, then trade the news.
              Score = {Math.round(EVENT_RULES.scoring.weights.return * 100)}% return, {Math.round(EVENT_RULES.scoring.weights.sortino * 100)}% Sortino,{' '}
              {Math.round(EVENT_RULES.scoring.weights.drawdown * 100)}% drawdown, {Math.round(EVENT_RULES.scoring.weights.mandate * 100)}% mandate compliance.
            </p>
            <div className="row" style={{ marginBottom: 16 }}>
              <button className="primary" disabled={busy || !scenarios.length} onClick={() => start(true)} style={{ padding: '10px 18px', fontSize: 15 }}>
                ▶ Quick start: Medium, random client
              </button>
              <span className="small dim">{preset === 'course' ? 'USD 20M · long-only · rebalancing between quarters' : 'HKD 20M · legacy rules'}.</span>
            </div>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="f" role="group" aria-label="Mode">Mode
                <span className="seg">
                  <button className={mode === 'synthetic' ? 'on' : ''} onClick={() => { setMode('synthetic'); setScenarioId('random'); }}>Synthetic</button>
                  <button className={mode === 'historical' ? 'on' : ''} onClick={() => { setMode('historical'); setScenarioId('random'); }}>Historical replay</button>
                </span>
              </div>
              <div className="f" role="group" aria-label="Difficulty">Difficulty
                <span className="seg">
                  {DIFFS.map((d) => <button key={d} className={difficulty === d ? 'on' : ''} onClick={() => { setDifficulty(d); setScenarioId('random'); }}>{EVENT_RULES.difficulty[d].label}</button>)}
                </span>
              </div>
              <label className="f">Scenario
                <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
                  <option value="random">Random (least played first)</option>
                  {options.map((s) => <option key={s.id} value={s.id}>{mode === 'historical' && disguise ? s.disguisedTitle ?? 'Hidden episode' : s.title}{s.used_count ? ` · played ${s.used_count}×` : ''}</option>)}
                </select>
              </label>
              <label className="f">Rules preset<select value={preset} onChange={e => setPreset(e.target.value as PracticePreset)}><option value="course">Course-based · USD 20M · long-only</option><option value="legacy">Legacy · HKD 20M</option></select></label>
              <label className="row small"><input type="checkbox" checked={shortened} onChange={e => setShortened(e.target.checked)} /> Shortened practice: 5-minute quarters{preset === 'course' ? ' and rebalancing windows' : ''}</label>
              <div className="small dim" style={{gridColumn:'1 / -1'}}>{shortened ? '4 × 5 min' : '4 × 15 min'} trading{preset === 'course' ? shortened ? ' + 3 × 5 min frozen-price rebalancing.' : ' + 3 × 15 min frozen-price rebalancing.' : '; no rebalancing windows.'} The benchmark uses a trainer-asset proxy without currency conversion. Trainer instruments, mandates, leverage and scoring are not confirmed course or event rules.</div>
              {mode === 'historical' && (
                <label className="row small" style={{ gridColumn: '1 / 3' }}>
                  <input type="checkbox" checked={disguise} onChange={(e) => setDisguise(e.target.checked)} />
                  Disguise: hide dates and the episode name, and anonymise headlines, so you can&apos;t trade on hindsight.
                </label>
              )}
              <label className="row small" style={{ gridColumn: '1 / 3' }} title="Learning mode: kept off the leaderboard and separated in Progress">
                <input type="checkbox" checked={hints} onChange={(e) => setHints(e.target.checked)} />
                Hints (learning mode): when a headline lands, show which <Link href="/learn/playbooks">playbook</Link> it matches and what usually moves. Hinted sessions stay off the leaderboard.
              </label>
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="primary" disabled={busy || !options.length} onClick={() => start(false)}>Start session</button>
              <button disabled={busy || !options.length || partners.length === 0} onClick={() => start(false, true)} title="Shared portfolio, same news, both of you can trade">👥 Team session with {partners.map((p) => p.display_name).join(', ') || 'team-mate'}</button>
              {partners.length > 0 && (
                <span className="small dim"><span className={`dot ${partnersOnline.length ? 'on' : ''}`} />{partnersOnline.length ? `${partnersOnline.map((p) => p.display_name).join(', ')} online` : `${partners.map((p) => p.display_name).join(', ')} offline`}</span>
              )}
              <span className="small dim">
                {EVENT_RULES.difficulty[difficulty].label}: {EVENT_RULES.difficulty[difficulty].events.join('-')} headlines
                {EVENT_RULES.difficulty[difficulty].pauseAllowed ? ', pause allowed' : ''}{difficulty === 'hard' ? ', fake-outs, tighter client limits' : ''}.
              </span>
            </div>
            {err && <p className="note bad">{err}</p>}
          </div>

          <div className="card">
            <h2>How to win the Preliminary Round</h2>
            <ol className="steps small">
              <li><b>Briefing first.</b> Read the client constraints before anything else. A mandate breach costs score only after {EVENT_RULES.mandate.breachGraceTicks} ticks, so fix breaches fast.</li>
              <li><b>Headline → factor → assets.</b> Ask: does this move rates, the dollar, China growth, oil or fear? Then which assets load on that factor.</li>
              <li><b>Size small, react fast.</b> Prices adjust over a few ticks after a headline. Use hotkeys: <kbd>B</kbd>/<kbd>S</kbd>, <kbd>1</kbd>-<kbd>5</kbd> size, <kbd>Enter</kbd> send.</li>
              <li><b>Rumours get denied.</b> Fade unconfirmed &quot;sources say&quot; headlines or keep them small.</li>
              <li><b>Protect the downside.</b> Sortino and drawdown together are half the score. Avoid big losers rather than chasing big winners.</li>
            </ol>
          </div>
        </section>

        <aside className="grid" style={{ alignContent: 'start' }}>
          {myTeamSessions.length > 0 && (
            <div className="card" style={{ borderColor: 'var(--accent)' }}>
              <h2>👥 Team sessions</h2>
              {myTeamSessions.map((x) => (
                <div key={x.id} className="row small" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
                  <span><span className={`tag ${x.difficulty}`}>{x.difficulty}</span> {x.mode === 'historical' && x.disguise ? 'Historical replay (disguised)' : x.scenario_title}
                    <span className="dim"> · {x.status === 'briefing' ? 'in briefing' : 'live now'}{x.owner_id !== user?.id ? ` · started by ${profiles.find((p) => p.id === x.owner_id)?.display_name ?? 'team-mate'}` : ''}</span></span>
                  <Link href={`/play/${x.id}`}><button className="primary">Join</button></Link>
                </div>
              ))}
            </div>
          )}
          <div className="card">
            <h2>Your record</h2>
            <div className="row" style={{ gap: 28 }}>
              <div className="kpi"><b>{scores.length}</b><span>Sessions</span></div>
              <div className="kpi"><b>{best !== null ? best.toFixed(1) : '-'}</b><span>Best score</span></div>
              <div className="kpi"><b>{avg5 !== null ? avg5.toFixed(1) : '-'}</b><span>Last-5 avg</span></div>
            </div>
            {scores.slice(0, 6).map((s) => (
              <div key={s.session_id} className="row small" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line)', padding: '6px 0', marginTop: 6 }}>
                <span><span className={`tag ${s.difficulty}`}>{s.difficulty}</span> <Link href={`/debrief/${s.session_id}`}>{s.scenario_title}</Link></span>
                <span className="num">{s.composite.toFixed(1)} <span className={s.ret >= 0 ? 'up' : 'down'}>{fmtPct(s.ret, 1)}</span></span>
              </div>
            ))}
            {!scores.length && <p className="small dim">No sessions yet. Hit Quick start.</p>}
          </div>
          <div className="card small">
            <h2>Scenario pool</h2>
            <div className="row" style={{ gap: 20 }}>
              {DIFFS.map((d) => <div key={d} className="kpi"><b>{poolCount(d)}</b><span>Unplayed {d}</span></div>)}
              <div className="kpi"><b>{scenarios.filter((s) => s.source === 'historical').length}</b><span>Historical</span></div>
            </div>
            <p className="dim">The pool never waits on AI. When your Mac worker is online it tops the pool up with new Claude-written scenarios.</p>
          </div>
        </aside>
      </main>
    </>
  );
}
