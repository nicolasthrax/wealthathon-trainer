'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { replaySession } from '@engine/runner';
import { buildReport } from '@engine/report';
import { useStore } from '@/lib/store';
import { sessionContext } from '@/lib/context';

function NewPitch() {
  const { store, ready } = useStore();
  const router = useRouter();
  const sessionId = useSearchParams().get('session');
  const [err, setErr] = useState('');
  const once = useRef(false);
  useEffect(() => {
    if (!ready || once.current) return;
    once.current = true;
    (async () => {
      try {
        let context: Record<string, unknown>;
        if (sessionId) {
          const s = await store.getSession(sessionId);
          if (!s) throw new Error('Session not found');
          const sc = await store.getScenario(s.scenario_id);
          const r = replaySession({ scenario: sc, seed: s.seed, rules: s.rules, client: s.client, difficulty: s.difficulty }, s.input_log);
          const d = await store.getDebrief(sessionId);
          context = { kind: 'session', title: `${sc.title} · ${s.client.name}`, ...sessionContext(r, buildReport(r, (s.session_minutes * 60) / r.N), d?.optimal ?? null, s) };
        } else {
          const clients = await store.listClients();
          const client = clients[Math.floor(Math.random() * clients.length)];
          context = { kind: 'standalone', title: `Standalone · ${client.name}`, client };
        }
        const p = await store.createPitch(sessionId, context);
        router.replace(`/pitch/${p.id}`);
      } catch (e) { setErr((e as Error).message); }
    })();
  }, [ready, store, sessionId, router]);
  return <div className="page">{err ? <p className="note bad">{err}</p> : <span className="dim">Preparing the judge&apos;s file…</span>}</div>;
}
export default function Page() { return <Suspense><NewPitch /></Suspense>; }
