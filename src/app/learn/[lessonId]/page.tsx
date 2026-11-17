'use client';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EVENT_RULES } from '@config/event-rules';
import { SessionRunner, ordersFromWeights } from '@engine/runner';
import {
  captureState, decisionOutcome, decisionTick, gradeAllocation, gradeDecision, lessonRules, lessonScenario, pickVariants,
  type Lesson, type PortfolioState,
} from '@engine/learn';
import { Nav } from '@/components/Nav';
import { Terminal } from '@/components/terminal/Terminal';
import { Briefing } from '@/components/Briefing';
import { DecisionBanner } from '@/components/learn/DecisionBanner';
import { Rich } from '@/components/learn/Rich';
import { LineChart } from '@/components/LineChart';
import { LESSONS, PASS_MARK, PLAYBOOK_BY_ID } from '@/lib/learn';
import { useJob, useStore, type LessonAttemptRow, type LessonDecisionRecord } from '@/lib/store';
import { cls, fmtCompact, fmtPct } from '@/lib/format';

type Phase = 'loading' | 'intro' | 'briefing' | 'why-alloc' | 'live' | 'saving' | 'results' | 'error';
interface Setup { lesson: Lesson; attempt: number; seed: string; variants: Record<string, number>; runner: SessionRunner }

const rules = lessonRules(EVENT_RULES);
const OUTCOME_TICKS = 40;

function newSetup(lesson: Lesson, attempt: number): Setup {
  const seed = attempt <= 1 ? 'fixed' : Math.random().toString(36).slice(2, 10);
  const variants = pickVariants(lesson, attempt, seed);
  const runner = new SessionRunner({ scenario: lessonScenario(lesson, variants), seed, rules, client: lesson.client, difficulty: 'easy' });
  return { lesson, attempt, seed, variants, runner };
}

export default function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = use(params);
  const lesson = LESSONS.find((l) => l.id === lessonId);
  const { store, ready, user } = useStore();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [err, setErr] = useState('');
  const [active, setActive] = useState<{ idx: number; startedAt: number } | null>(null);
  const [allDone, setAllDone] = useState(false);
  const [saved, setSaved] = useState<LessonAttemptRow | null>(null);
  const records = useRef<LessonDecisionRecord[]>([]);
  const resolved = useRef(0);
  const before = useRef<PortfolioState | null>(null);
  const firstTrade = useRef<number | null>(null);
  const baseline = useRef(0);
  const pendingAlloc = useRef<Record<string, number>>({});
  const prevAttempts = useRef(0);

  useEffect(() => {
    if (!ready || !lesson) return;
    store.listLessonAttempts().then((all) => {
      prevAttempts.current = all.filter((a) => a.lesson_id === lesson.id && (!user || a.user_id === user.id || a.user_id === 'local')).length;
      setSetup(newSetup(lesson, prevAttempts.current + 1)); setPhase('intro');
    }).catch((e) => { setErr((e as Error).message); setPhase('error'); });
  }, [ready, store, lesson, user]);

  const runner = setup?.runner ?? null;
  const decisions = useMemo(() => (setup && runner ? [...setup.lesson.decisions].sort((a, b) => decisionTick(a, runner.path) - decisionTick(b, runner.path)) : []), [setup, runner]);
  const N = runner?.N ?? 1;
  const secondsPerTick = setup ? (setup.lesson.sessionMinutes * 60) / N : 1;
  const ticker = useCallback((id: string) => runner?.assetById[id]?.ticker ?? id, [runner]);

  const restart = () => {
    if (!lesson) return;
    records.current = []; resolved.current = 0; setActive(null); setAllDone(false); setSaved(null);
    prevAttempts.current += 1;
    setSetup(newSetup(lesson, prevAttempts.current + 1)); setPhase('intro');
    window.scrollTo(0, 0);
  };

  const start = () => {
    if (!setup) return;
    if (setup.lesson.opening === 'briefing') { setPhase('briefing'); return; }
    for (const o of ordersFromWeights(setup.runner, setup.lesson.opening)) setup.runner.placeOrder(o);
    setPhase('live');
  };

  const commitAllocation = (why: string) => {
    if (!setup?.lesson.allocation) return;
    const w = pendingAlloc.current;
    const g = gradeAllocation(setup.lesson.allocation, w, setup.runner.client, rules, why, ticker);
    for (const o of ordersFromWeights(setup.runner, w)) setup.runner.placeOrder(o);
    const trades = Object.keys(w).map((id) => ({ assetId: id, dq: setup.runner.qty(id), deltaPct: w[id] }));
    records.current.push({ id: 'alloc', playbookId: 'mandate-safe-opening', grade: g.grade, checks: g.checks, trades, outcome: 0, why, actionSec: null, tick: 0 });
    setPhase('live');
  };

  // ── Lesson hooks for the terminal clock ──
  const lessonHooks = useMemo(() => ({
    holdAt: () => (runner && resolved.current < decisions.length ? decisionTick(decisions[resolved.current], runner.path) : null),
    onHold: () => {
      if (!runner) return;
      setActive((cur) => {
        if (cur) return cur;
        before.current = captureState(runner);
        firstTrade.current = null;
        baseline.current = runner.orders.length;
        return { idx: resolved.current, startedAt: performance.now() };
      });
    },
  }), [runner, decisions]);

  // Note the first trade time while a decision is open (speed check).
  useEffect(() => {
    if (!active || !runner) return;
    const iv = setInterval(() => {
      if (firstTrade.current === null && runner.orders.slice(baseline.current).some((o) => o.source === 'user' && o.status !== 'rejected')) firstTrade.current = (performance.now() - active.startedAt) / 1000;
    }, 200);
    return () => clearInterval(iv);
  }, [active, runner]);

  const resolveDecision = (why: string) => {
    if (!active || !runner || !before.current) return;
    const d = decisions[active.idx];
    const doneSec = (performance.now() - active.startedAt) / 1000;
    const after = captureState(runner);
    const traded = runner.orders.slice(baseline.current).some((o) => o.source === 'user' && o.status !== 'rejected');
    if (firstTrade.current === null && traded) firstTrade.current = doneSec;
    const timedOut = !!d.timeLimitSec && doneSec >= d.timeLimitSec - 0.3;
    const actionSec = firstTrade.current ?? (timedOut ? null : doneSec);
    const g = gradeDecision(d.expect, before.current, after, { rules, ticker, timeLimitSec: d.timeLimitSec, actionSec, why, whyKeywords: d.whyKeywords });
    records.current.push({ id: d.id, playbookId: d.playbookId, grade: g.grade, checks: g.checks, trades: g.trades, outcome: 0, why, actionSec, tick: before.current.tick });
    resolved.current += 1;
    if (resolved.current >= decisions.length) setAllDone(true);
    setActive(null);
  };

  const onFinish = useCallback(async () => {
    if (!setup || !runner) return;
    setPhase('saving');
    const ticks = records.current.map((r) => r.tick);
    for (const [i, r] of records.current.entries()) {
      const t1 = r.id === 'alloc' ? N : Math.min(N, r.tick + OUTCOME_TICKS, ...ticks.slice(i + 1).filter((t) => t > r.tick));
      r.outcome = decisionOutcome(runner.path, r.tick, t1, r.trades);
    }
    const grade = Math.round(records.current.reduce((s, r) => s + r.grade, 0) / Math.max(1, records.current.length));
    try {
      const row = await store.saveLessonAttempt({ lesson_id: setup.lesson.id, attempt: setup.attempt, seed: setup.seed, variant: setup.variants, decisions: records.current,
        input_log: runner.log, grade, passed: grade >= PASS_MARK });
      setSaved(row);
      setPhase('results');
      // AI feedback on the "why" answers, only when the Mac worker is online. Lessons never wait for it.
      if (store.kind === 'cloud' && records.current.some((r) => r.why.trim()) && await store.workerOnline().catch(() => false)) {
        const payload = {
          attemptId: row.id, lesson: setup.lesson.title,
          decisions: records.current.map((r) => {
            const d = setup.lesson.decisions.find((x) => x.id === r.id);
            const ev = d && d.at !== 'start' ? runner.scenario.events.find((e) => e.id === (d.at as { event: string }).event) : null;
            return { id: r.id, headline: ev?.headline ?? (r.id === 'alloc' ? 'Opening allocation' : 'Start of session'), prompt: d?.prompt ?? setup.lesson.allocation?.prompt, playbook: PLAYBOOK_BY_ID[r.playbookId]?.name,
              modelAnswer: d?.explain ?? setup.lesson.allocation?.explain, why: r.why, grade: r.grade, trades: r.trades.map((t) => `${t.deltaPct > 0 ? 'buy' : 'sell'} ${ticker(t.assetId)} ${Math.abs(t.deltaPct * 100).toFixed(1)}% NAV`) };
          }),
        };
        const j = await store.enqueueJob('lesson_why', payload).catch(() => null);
        if (j) { await store.updateLessonAttempt(row.id, { ai_job_id: j.id }).catch(() => {}); setSaved((s) => (s ? { ...s, ai_job_id: j.id } : s)); }
      }
    } catch (e) { setErr((e as Error).message); setPhase('error'); }
  }, [setup, runner, N, store, ticker]);

  const skipToEnd = () => { if (runner) { while (!runner.finished) runner.step(); } };

  if (!lesson) return <><Nav /><main className="page"><p className="note bad">Unknown lesson. <Link href="/learn">Back to Learn</Link></p></main></>;
  if (phase === 'error') return <><Nav /><main className="page"><p className="note bad">{err}</p><Link href="/learn">Back to Learn</Link></main></>;
  if (phase === 'loading' || !setup || !runner) return <><Nav /><main className="page dim">Loading…</main></>;

  if (phase === 'intro') return <><Nav /><Intro setup={setup} onStart={start} /></>;

  if (phase === 'briefing' || phase === 'why-alloc') {
    return (
      <>
        <Briefing runner={runner} title={`Lesson ${lesson.n} · ${lesson.allocation?.prompt ?? ''}`} storyline={lesson.storyline} disguise={false}
          onStart={(w) => { pendingAlloc.current = w; setPhase('why-alloc'); }} />
        {phase === 'why-alloc' && <DecisionBanner index={0} total={decisions.length + 1} prompt="Before the clock starts: **why** this allocation? Name the client limits you built around." startedAt={performance.now()} onDone={commitAllocation} />}
      </>
    );
  }

  if (phase === 'live' || phase === 'saving') {
    const d = active ? decisions[active.idx] : null;
    const offset = lesson.allocation ? 1 : 0;
    return (
      <Terminal runner={runner} title={`Lesson ${lesson.n} · ${lesson.title}`} secondsPerTick={secondsPerTick} disguise={false} initialElapsedMs={0}
        onProgress={() => {}} onFinish={onFinish} onAbandon={() => router.push('/learn')} lesson={lessonHooks} hideEnd abandonLabel="Exit lesson"
        overlay={d && active ? <DecisionBanner key={d.id} index={active.idx + offset} total={decisions.length + offset} prompt={d.prompt} timeLimitSec={d.timeLimitSec} startedAt={active.startedAt} onDone={resolveDecision} />
          : allDone && phase === 'live' ? <div className="lesson-banner" style={{ width: 'auto', padding: '8px 12px' }}><div className="row"><span className="small">All decisions done. Watch how it plays out, or</span><button className="primary" onClick={skipToEnd}>See results ▶</button></div></div>
          : phase === 'saving' ? <div className="lesson-banner" style={{ width: 'auto' }}>Grading…</div> : null} />
    );
  }

  return <><Nav /><Results setup={setup} records={records.current} saved={saved} onRetry={restart} /></>;
}

// ── Intro: the concept card ──────────────────────────────────────────────────
function Intro({ setup, onStart }: { setup: Setup; onStart: () => void }) {
  const l = setup.lesson;
  const timed = l.decisions.filter((d) => d.timeLimitSec);
  return (
    <main className="page grid" style={{ maxWidth: 820 }}>
      <div className="small"><Link href="/learn">← Learn</Link></div>
      <div className="card concept">
        <div className="small dim">LESSON {l.n} OF {LESSONS.length} · ~{l.minutes} MIN</div>
        <h1 style={{ margin: '4px 0 12px' }}>{l.title}</h1>
        {l.concept.map((p, i) => <p key={i}><Rich text={p} /></p>)}
        {l.example && (
          <div className="card" style={{ background: 'var(--panel2)', marginTop: 6 }}>
            <h3>{l.example.title}</h3>
            <table className="t"><tbody>{l.example.rows.map(([a, b], i) => <tr key={i}><td>{a}</td><td className="dim">{b}</td></tr>)}</tbody></table>
          </div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <span className="small dim">Playbooks:</span>
          {l.playbooks.map((p) => <Link key={p} href={`/learn/playbooks/${p}`} className="tag plain" style={{ fontSize: 11 }}>{PLAYBOOK_BY_ID[p]?.name}</Link>)}
        </div>
      </div>
      <div className="card">
        <h2>How this lesson works</h2>
        <ol className="steps small">
          <li>A short market (one simulated quarter, about {l.sessionMinutes} minutes) runs in the real trading screen{l.opening === 'briefing' ? ', after you build the opening allocation' : ' with a starting portfolio already in place'}.</li>
          <li>At {l.decisions.length + (l.allocation ? 1 : 0)} key moments the clock <b>stops</b>. Trade with the normal ticket (or hotkeys), write one line on <b>why</b>, then continue.</li>
          <li>{timed.length ? <>Decisions have a <b>{timed[0].timeLimitSec}s timer</b>: when it runs out, the clock resumes and whatever you did is graded.</> : 'No timer in this lesson: take your time.'}</li>
          <li>Grading looks at <b>process</b> (direction, assets, size, mandate{timed.length ? ', speed' : ''}, your why), not luck. What the trade earned is shown separately. Pass mark: {PASS_MARK}%.</li>
        </ol>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" onClick={onStart}>{setup.attempt > 1 ? `Start attempt ${setup.attempt} ▶` : 'Start lesson ▶'}</button>
          {setup.attempt > 1 && <span className="small dim">Retry: new market and different headlines of the same type, so you can&apos;t just memorise the answers.</span>}
        </div>
      </div>
    </main>
  );
}

// ── Results ─────────────────────────────────────────────────────────────────
function Results({ setup, records, saved, onRetry }: { setup: Setup; records: LessonDecisionRecord[]; saved: LessonAttemptRow | null; onRetry: () => void }) {
  const { store } = useStore();
  const l = setup.lesson;
  const r = setup.runner;
  const { job } = useJob(store, saved?.ai_feedback ? null : saved?.ai_job_id);
  const ai = saved?.ai_feedback ?? (job?.status === 'done' ? (job.result as { summary?: string; comments: Record<string, string> }) : null);
  const grade = saved ? Number(saved.grade) : 0;
  const next = LESSONS.find((x) => x.n === l.n + 1);
  const tk = (id: string) => r.assetById[id]?.ticker ?? id;
  return (
    <main className="page grid" style={{ maxWidth: 980 }}>
      <div className="small"><Link href="/learn">← Learn</Link></div>
      <div className="card row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="small dim">LESSON {l.n} · ATTEMPT {setup.attempt}</div>
          <h1>{l.title}</h1>
          <div className="small dim">Quarter result: <span className={cls(r.metrics.pnl)}>{fmtCompact(r.metrics.pnl)} HKD ({fmtPct(r.metrics.ret)})</span>. That&apos;s the outcome, not the grade.</div>
        </div>
        <div className="kpi" style={{ alignItems: 'flex-end' }}>
          <b style={{ fontSize: 34 }} className={grade >= PASS_MARK ? 'up' : 'amber'}>{grade}%</b>
          <span>{grade >= PASS_MARK ? 'Passed' : `Below ${PASS_MARK}%: try again`}</span>
        </div>
      </div>
      {ai?.summary && <div className="note info"><b>AI coach:</b> {ai.summary}</div>}
      {saved?.ai_job_id && !ai && job?.status !== 'failed' && <div className="small dim">AI feedback on your answers is being written on the Mac worker…</div>}

      {records.map((rec, i) => {
        const d = l.decisions.find((x) => x.id === rec.id);
        const ev = d && d.at !== 'start' ? r.scenario.events.find((e) => e.id === (d.at as { event: string }).event) : null;
        const pb = PLAYBOOK_BY_ID[rec.playbookId];
        const watch = rec.id === 'alloc' ? [] : [...new Set([...(d?.expect.assets ?? []).map((a) => a.assetId), ...rec.trades.map((t) => t.assetId), ...(d?.expect.reduce?.assets ?? [])])].filter((id) => r.path.prices[id]).slice(0, 3);
        return (
          <div key={rec.id} className="card grid" style={{ gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>{i + 1}. {rec.id === 'alloc' ? 'Opening allocation' : ev?.headline ?? 'Start of the session'}</h2>
              <span className={`grade ${rec.grade >= PASS_MARK ? 'pass' : 'fail'}`} style={{ fontSize: 18 }}>{rec.grade}%</span>
            </div>
            {ev && <div className="small dim"><span className={`tag ${ev.source}`}>{ev.source.replace('_', ' ')}</span> {ev.body}</div>}
            <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
              <div>
                <h3>What you did</h3>
                <div className="pb-moves">
                  {rec.trades.length ? rec.trades.filter((t) => Math.abs(t.deltaPct) >= 0.001).map((t) => <span key={t.assetId} className={`pb-move ${t.deltaPct > 0 ? 'u' : 'd'}`}>{rec.id === 'alloc' ? '' : t.deltaPct > 0 ? 'BUY ' : 'SELL '}{tk(t.assetId)} {fmtPct(Math.abs(t.deltaPct), 1, false)}</span>) : <span className="small dim">No trades</span>}
                </div>
                {rec.why ? <p className="small" style={{ margin: '8px 0 0' }}><span className="dim">Your why:</span> &ldquo;{rec.why}&rdquo;</p> : <p className="small dim" style={{ margin: '8px 0 0' }}>No why written.</p>}
                {ai?.comments?.[rec.id] && <p className="note info small" style={{ marginTop: 8 }}>{ai.comments[rec.id]}</p>}
                <h3 style={{ marginTop: 10 }}>Process checks</h3>
                {rec.checks.map((c) => <div key={c.id} className={`check ${c.pass ? 'ok' : 'no'}`}><span className="ic">{c.pass ? '✓' : '✗'}</span><span><b>{c.label}.</b> <span className="dim">{c.detail}</span></span></div>)}
              </div>
              <div>
                <h3>The playbook</h3>
                <p className="small" style={{ marginTop: 0 }}><Rich text={d?.explain ?? l.allocation?.explain ?? ''} /></p>
                {pb && <p className="small"><Link href={`/learn/playbooks/${pb.id}`}>{pb.name} →</Link></p>}
                {pb?.moves.length ? <div className="pb-moves" style={{ marginBottom: 8 }}>{pb.moves.map((m) => <span key={m.assetId} className={`pb-move ${m.dir > 0 ? 'u' : 'd'}`}>{tk(m.assetId)} {m.dir > 0 ? '↑' : '↓'}{m.strength === 2 ? (m.dir > 0 ? '↑' : '↓') : ''}</span>)}</div> : null}
                {rec.id !== 'alloc' && (
                  <>
                    <h3>What happened this time</h3>
                    <div className="small">Your trades made <b className={cls(rec.outcome)}>{rec.trades.length ? `${fmtCompact(rec.outcome)} HKD` : 'nothing (no trades)'}</b> over the next {OUTCOME_TICKS} ticks. Markets are noisy, so this isn&apos;t part of the grade.</div>
                    {watch.length > 0 && <MiniChart runner={r} tick={rec.tick} ids={watch} />}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}

      <div className="card">
        <h2>Takeaways</h2>
        <ul className="small">{l.takeaways.map((t, i) => <li key={i}><Rich text={t} /></li>)}</ul>
        <div className="row" style={{ marginTop: 10 }}>
          <button onClick={onRetry}>↻ Retry (new market)</button>
          {next && <Link href={`/learn/${next.id}`}><button className="primary">Next: Lesson {next.n} ▶</button></Link>}
          <Link href="/learn"><button className="ghost">Back to Learn</button></Link>
        </div>
      </div>
    </main>
  );
}

const COLORS = ['#5cc4ff', '#ffb454', '#c79bf0'];
function MiniChart({ runner, tick, ids }: { runner: SessionRunner; tick: number; ids: string[] }) {
  const pre = 15, post = 50;
  const t0 = Math.max(0, tick - pre), t1 = Math.min(runner.N, tick + post);
  const lines = useMemo(() => ids.map((id, i) => {
    const p = runner.path.prices[id];
    const base = p[tick];
    const data: number[] = [];
    for (let t = t0; t <= t1; t++) data.push((p[t] / base - 1) * 100);
    return { label: runner.assetById[id].ticker, color: COLORS[i], data, step: 1 };
  }), [runner, ids, tick, t0, t1]);
  const markers = useMemo(() => [{ tick: tick - t0, text: 'news' }], [tick, t0]);
  const fmt = useCallback((v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`, []);
  const xl = useCallback((x: number) => { const d = x - (tick - t0); return d === 0 ? 'news' : `${d > 0 ? '+' : ''}${d}`; }, [tick, t0]);
  return <LineChart lines={lines} height={150} fmt={fmt} markers={markers} xLabel={xl} />;
}
