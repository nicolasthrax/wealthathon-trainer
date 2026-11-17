'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { CHEATSHEET_KEY, LESSONS, PASS_MARK, PLAYBOOKS, PRELIM_DATE, daysToEvent, lessonStats, weeklyPlan } from '@/lib/learn';
import { useStore, type LessonAttemptRow, type Profile, type ScoreRow } from '@/lib/store';

export default function Learn() {
  const { store, ready, user } = useStore();
  const [attempts, setAttempts] = useState<LessonAttemptRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!ready) return;
    store.listLessonAttempts().then(setAttempts).catch(() => {});
    store.listScores().then(setScores).catch(() => {});
    store.listProfiles().then(setProfiles).catch(() => {});
    try { setSeen(!!localStorage.getItem(CHEATSHEET_KEY)); } catch { /* private mode */ }
  }, [store, ready]);

  const me = user?.id ?? null;
  // Players to show: me first, then my team-mate. Local mode: just "You".
  const players = useMemo(() => {
    if (!me) return [{ id: null as string | null, name: 'You' }];
    const others = profiles.filter((p) => p.id !== me).map((p) => ({ id: p.id as string | null, name: p.display_name ?? 'Team-mate' }));
    return [{ id: me as string | null, name: profiles.find((p) => p.id === me)?.display_name ?? 'You' }, ...others];
  }, [me, profiles]);
  const stats = useMemo(() => Object.fromEntries(players.map((p) => [p.id ?? 'local', lessonStats(attempts, p.id)])), [players, attempts]);
  const plan = useMemo(() => weeklyPlan(attempts, me, scores, seen), [attempts, me, scores, seen]);
  const mine = stats[me ?? 'local'] ?? {};
  const nextLesson = LESSONS.find((l) => !mine[l.id]) ?? LESSONS.find((l) => (mine[l.id]?.best ?? 0) < PASS_MARK);
  const days = daysToEvent();

  return (
    <>
      <Nav />
      <main className="page grid">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1>Learn</h1>
            <div className="small dim">Ten guided lessons and the playbooks behind them. Real-market skills that carry over to the event, practised in the real trading screen.</div>
          </div>
          <div className="row">
            <span className="small dim">{days > 0 ? `${days} days to the Preliminary Round (${PRELIM_DATE})` : 'Preliminary Round: good luck!'}</span>
            {nextLesson && <Link href={`/learn/${nextLesson.id}`}><button className="primary">{mine[nextLesson.id] ? 'Retry' : 'Continue'}: Lesson {nextLesson.n} ▶</button></Link>}
          </div>
        </div>

        <section className="card">
          <h2>3-week plan</h2>
          <div className="plan">
            {plan.map((w) => (
              <div key={w.n} className={`wk${w.current ? ' now' : ''}`}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b>Week {w.n}</b><span className="small dim">{w.from.slice(5)} → {w.to.slice(5)}{w.current ? ' · this week' : ''}</span>
                </div>
                <ul>
                  {w.items.map((it) => (
                    <li key={it.id}>
                      <span className={`ck${it.done ? ' on' : ''}`} aria-label={it.done ? 'done' : 'to do'}>{it.done ? '✓' : ''}</span>
                      <span>{it.href ? <Link href={it.href} style={{ color: it.done ? 'var(--dim)' : 'var(--text)' }}>{it.label}</Link> : it.label}
                        {it.progress && <span className="small dim"> · {it.progress}</span>}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="small dim" style={{ margin: '10px 0 0' }}>Items tick themselves when you finish a lesson or a practice session that matches (difficulty, hints on/off, team). Turn hints on from the Practice page.</p>
        </section>

        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)' }}>
          <section className="card">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>Lessons</h2>
              <span className="small dim">Best grade · pass {PASS_MARK}%</span>
            </div>
            <div className="lessons">
              {LESSONS.map((l) => (
                <Link key={l.id} href={`/learn/${l.id}`} className="lesson-row">
                  <span className="no">{l.n}</span>
                  <span>
                    <b>{l.title}</b> <span className="small dim">· {l.minutes} min{l.decisions.some((d) => d.timeLimitSec) ? ` · ${l.decisions.find((d) => d.timeLimitSec)!.timeLimitSec}s timer` : ''}</span>
                    <div className="small dim">{l.summary}</div>
                  </span>
                  <span className="who">
                    {players.map((p) => {
                      const s = stats[p.id ?? 'local']?.[l.id];
                      return <span key={p.id ?? 'local'} title={s ? `${p.name}: best ${s.best}% in ${s.tries} attempt(s), last ${s.last.slice(0, 10)}` : `${p.name}: not tried yet`}>
                        <span className="dim">{p.name}</span> <span className={`grade ${!s ? 'none' : s.best >= PASS_MARK ? 'pass' : 'fail'}`}>{s ? `${s.best}%` : '–'}</span>
                      </span>;
                    })}
                  </span>
                </Link>
              ))}
            </div>
          </section>
          <section className="grid" style={{ alignContent: 'start' }}>
            <div className="card">
              <h2>Playbooks</h2>
              <p className="small dim" style={{ marginTop: 0 }}>Named plays: what triggers them, what moves, how big, when to get out.</p>
              <div className="pb-moves">
                {PLAYBOOKS.map((p) => <Link key={p.id} href={`/learn/playbooks/${p.id}`} className="pb-move">{p.name}</Link>)}
              </div>
              <div className="row" style={{ marginTop: 10 }}><Link href="/learn/playbooks">All playbooks →</Link></div>
            </div>
            <div className="card">
              <h2>Cheat sheet</h2>
              <p className="small dim" style={{ marginTop: 0 }}>Every playbook, the driver map and the scoring rules on one page. Prints on A4: read it the day before.</p>
              <Link href="/learn/cheatsheet"><button>Open the cheat sheet</button></Link>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
