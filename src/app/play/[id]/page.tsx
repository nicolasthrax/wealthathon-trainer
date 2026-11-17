'use client';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SessionRunner, ordersFromWeights, replaySession } from '@engine/runner';
import { buildReport } from '@engine/report';
import type { Scenario } from '@engine/types';
import { useStore, type SessionRow } from '@/lib/store';
import { Briefing } from '@/components/Briefing';
import { Terminal } from '@/components/terminal/Terminal';

type Phase = 'loading' | 'briefing' | 'live' | 'saving' | 'error';
const progressKey = (id: string) => `wt:progress:${id}`;

export default function Play({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { store, ready } = useStore();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [err, setErr] = useState('');
  const [session, setSession] = useState<SessionRow | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const runnerRef = useRef<SessionRunner | null>(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    if (!ready) return;
    let stop = false;
    (async () => {
      try {
        const s = await store.getSession(id);
        if (!s) throw new Error('Session not found (are you signed in on the same account?)');
        if (s.status === 'finished') { router.replace(`/debrief/${id}`); return; }
        const sc = await store.getScenario(s.scenario_id);
        if (stop) return;
        const opts = { scenario: sc, seed: s.seed, rules: s.rules, client: s.client, difficulty: s.difficulty };
        // Resume an interrupted session from this browser's saved progress (deterministic replay).
        let saved: { tick: number; log: SessionRow['input_log']; elapsed: number } | null = null;
        try { saved = JSON.parse(localStorage.getItem(progressKey(id)) ?? 'null'); } catch { /* ignore */ }
        if (s.status === 'active' && saved) {
          runnerRef.current = replaySession(opts, saved.log, saved.tick);
          elapsedRef.current = saved.elapsed;
          setPhase('live');
        } else {
          runnerRef.current = new SessionRunner(opts);
          setPhase(s.status === 'active' ? 'live' : 'briefing');
        }
        setSession(s); setScenario(sc);
      } catch (e) { setErr((e as Error).message); setPhase('error'); }
    })();
    return () => { stop = true; };
  }, [ready, store, id, router]);

  const title = !session || !scenario ? '' : scenario.historical && session.disguise ? `${scenario.historical.disguisedTitle} (disguised)` : scenario.title;
  const secondsPerTick = session ? (session.session_minutes * 60) / (runnerRef.current?.N ?? 1) : 1;

  const onStart = useCallback((weights: Record<string, number>) => {
    const r = runnerRef.current!;
    for (const o of ordersFromWeights(r, weights)) r.placeOrder(o);
    void store.updateSession(id, { status: 'active', started_at: new Date().toISOString() });
    setPhase('live');
  }, [store, id]);

  const onProgress = useCallback((elapsed: number) => {
    const r = runnerRef.current!;
    elapsedRef.current = elapsed;
    try { localStorage.setItem(progressKey(id), JSON.stringify({ tick: r.tick, log: r.log, elapsed })); } catch { /* quota */ }
  }, [id]);

  const onFinish = useCallback(async () => {
    const r = runnerRef.current!, s = session!;
    setPhase('saving');
    try {
      const report = buildReport(r, secondsPerTick);
      const m = r.metrics;
      await store.updateSession(id, { status: 'finished', input_log: r.log, finished_at: new Date().toISOString() });
      await store.saveScore(s, m.score, { ret: m.ret, sortino: m.sortino, maxDD: m.maxDD, equity: m.equity });
      await store.saveDebrief(id, { report });
      await Promise.all([store.saveTrades(s, r.orders, r.fills), store.saveSnapshots(s, r.snapshots)]).catch((e) => console.warn('trade log upload failed', e));
      try { localStorage.removeItem(progressKey(id)); } catch { /* ignore */ }
      router.replace(`/debrief/${id}`);
    } catch (e) { setErr(`Could not save the session: ${(e as Error).message}`); setPhase('error'); }
  }, [session, secondsPerTick, store, id, router]);

  const onAbandon = useCallback(async () => {
    await store.updateSession(id, { status: 'abandoned' }).catch(() => {});
    try { localStorage.removeItem(progressKey(id)); } catch { /* ignore */ }
    router.replace('/');
  }, [store, id, router]);

  if (phase === 'loading') return <div className="page dim">Loading session…</div>;
  if (phase === 'error') return <div className="page"><p className="note bad">{err}</p><Link href="/">← Back</Link></div>;
  if (phase === 'saving') return <div className="page dim">Session over. Scoring and building your debrief…</div>;
  const r = runnerRef.current!;
  if (phase === 'briefing') return <Briefing runner={r} title={title} storyline={scenario!.historical && session!.disguise ? scenario!.storyline.replace(/\b(19|20)\d{2}\b/g, '[year]') : scenario!.storyline} disguise={session!.disguise} onStart={onStart} />;
  return (
    <Terminal runner={r} title={title} secondsPerTick={secondsPerTick} disguise={session!.disguise} initialElapsedMs={elapsedRef.current}
      onProgress={onProgress} onFinish={onFinish} onAbandon={onAbandon} />
  );
}
