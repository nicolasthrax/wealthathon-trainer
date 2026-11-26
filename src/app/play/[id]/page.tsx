'use client';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SessionRunner, ordersFromWeights, replaySession } from '@engine/runner';
import { buildReport } from '@engine/report';
import { buildPlayerStats } from '@engine/players';
import type { Scenario } from '@engine/types';
import { makePracticeRules } from '@/lib/practice';
import { currentRules, useStore, type SessionRow } from '@/lib/store';
import { Briefing } from '@/components/Briefing';
import { Terminal, type TeamProps } from '@/components/terminal/Terminal';
import { TeamSync, type TeamEvent } from '@/lib/team';
import { fmtMoney } from '@/lib/format';
import { HintCard } from '@/components/learn/Playbook';

type Phase = 'loading' | 'briefing' | 'live' | 'saving' | 'error';
const progressKey = (id: string) => `wt:progress:${id}`;

export default function Play({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { store, ready, user } = useStore();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [err, setErr] = useState('');
  const [session, setSession] = useState<SessionRow | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const runnerRef = useRef<SessionRunner | null>(null);
  const elapsedRef = useRef(0);
  // ── Team mode state ──
  const [sync, setSync] = useState<TeamSync | null>(null);
  const [teamVer, setTeamVer] = useState(0);
  const [peers, setPeers] = useState<{ name: string; role: string; selected?: string }[]>([]);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [lastEditBy, setLastEditBy] = useState<string | undefined>();
  const phaseRef = useRef(phase); phaseRef.current = phase;
  useEffect(() => () => sync?.disconnect(), [sync]);

  useEffect(() => {
    if (!ready) return;
    let stop = false;
    (async () => {
      try {
        if (id === 'demo') {
          // Instant practice: a Medium session with a random client, straight onto the trading screen.
          const [list, clients, rules] = await Promise.all([store.listScenarios(), store.listClients(), currentRules(store)]);
          const pool = list.filter((x) => x.source === 'synthetic' && x.difficulty === 'medium');
          const meta = pool[Math.floor(Math.random() * pool.length)];
          const row = await store.createSession({ scenario: meta, client: clients[Math.floor(Math.random() * clients.length)], seed: Math.random().toString(36).slice(2, 10),
            difficulty: 'medium', disguise: false, session_minutes: 60, rules: makePracticeRules(rules, 'course') });
          router.replace(`/play/${row.id}${window.location.search}`);
          return;
        }
        const s = await store.getSession(id);
        if (!s) throw new Error('Session not found (are you signed in on the same account?)');
        if (s.status === 'finished') { router.replace(`/debrief/${id}`); return; }
        const sc = await store.getScenario(s.scenario_id);
        if (stop) return;
        const opts = { scenario: sc, seed: s.seed, rules: s.rules, client: s.client, difficulty: s.difficulty };
        if (s.team_mode && user) {
          // Team session: shared clock + shared input log, synced through Supabase.
          const profiles = await store.listProfiles();
          const nameOf = (uid: string) => profiles.find((p) => p.id === uid)?.display_name ?? 'Team-mate';
          const pnames: Record<string, string> = {};
          for (const p of s.participants ?? []) pnames[p.id] = nameOf(p.user_id);
          const mine = s.participants?.find((p) => p.user_id === user.id);
          const ts = new TeamSync(s, opts, { userId: user.id, participantId: mine?.id ?? null, name: nameOf(user.id), role: mine?.role ?? 'trader' });
          let nseq = 0;
          ts.on((e: TeamEvent) => {
            if (e.type === 'input') {
              runnerRef.current = ts.runner;
              setTeamVer((v) => v + 1);
              if (!e.mine) {
                const who = (e.input.participant_id && pnames[e.input.participant_id]) || 'Team-mate';
                const o = e.input.kind === 'place' ? ts.shared.orderFor(e.input.seq) : undefined;
                const text = e.input.kind === 'end' ? `${who} ended the session` : e.input.kind === 'cancel' ? `${who} cancelled an order`
                  : o ? `${who}: ${o.status === 'rejected' ? 'rejected ' : ''}${o.side === 'buy' ? 'BUY' : 'SELL'} ${fmtMoney(o.qty)} ${ts.runner.assetById[o.assetId]?.ticker}${o.status === 'working' ? ' (limit)' : ''}` : `${who} sent an order`;
                if (e.input.tick > 0) setNotice({ id: ++nseq, text });
              }
            } else if (e.type === 'session') {
              if (e.session.status === 'active' && phaseRef.current === 'briefing') setPhase('live');
            } else if (e.type === 'presence') {
              setPeers(e.peers.filter((p) => p.userId !== user.id));
            } else if (e.type === 'alloc') { setAlloc(e.weights); setLastEditBy(e.from); }
          });
          await ts.connect();
          if (stop) { ts.disconnect(); return; }
          runnerRef.current = ts.runner;
          setNames(pnames);
          setSync(ts);
          setSession(s); setScenario(sc);
          setPhase(ts.session.status === 'active' ? 'live' : 'briefing');
          return;
        }
        // Resume an interrupted session from this browser's saved progress (deterministic replay).
        let saved: { tick: number; log: SessionRow['input_log']; elapsed: number } | null = null;
        try { saved = JSON.parse(localStorage.getItem(progressKey(id)) ?? 'null'); } catch { /* ignore */ }
        if (s.status === 'active' && saved) {
          runnerRef.current = replaySession(opts, saved.log, saved.tick);
          elapsedRef.current = saved.elapsed;
          setPhase('live');
        } else {
          runnerRef.current = new SessionRunner(opts);
          const auto = !s.rules.practice && new URLSearchParams(window.location.search).has('autostart');
          if (auto && s.status === 'briefing') void store.updateSession(id, { status: 'active', started_at: new Date().toISOString() });
          setPhase(s.status === 'active' || auto ? 'live' : 'briefing');
        }
        setSession(s); setScenario(sc);
      } catch (e) { setErr((e as Error).message); setPhase('error'); }
    })();
    return () => { stop = true; };
  }, [ready, store, id, router, user]);

  const title = !session || !scenario ? '' : scenario.historical && session.disguise ? `${scenario.historical.disguisedTitle} (disguised)` : scenario.title;
  const secondsPerTick = session ? (session.session_minutes * 60) / (runnerRef.current?.N ?? 1) : 1;

  const onStart = useCallback((weights: Record<string, number>) => {
    const r = runnerRef.current!;
    if (sync) {
      void sync.claimStart(ordersFromWeights(r, weights)).then((won) => { if (won) setPhase('live'); });
      return;
    }
    for (const o of ordersFromWeights(r, weights)) r.placeOrder(o);
    void store.updateSession(id, { status: 'active', started_at: new Date().toISOString() });
    setPhase('live');
  }, [store, id, sync]);

  const onProgress = useCallback((elapsed: number) => {
    const r = runnerRef.current!;
    elapsedRef.current = elapsed;
    if (sync) return; // team sessions resume from the server's input log
    try { localStorage.setItem(progressKey(id), JSON.stringify({ tick: r.tick, log: r.log, elapsed })); } catch { /* quota */ }
  }, [id, sync]);

  const onFinish = useCallback(async () => {
    const r = sync ? sync.runner : runnerRef.current!, s = session!;
    const isOwner = !s.team_mode || s.owner_id === user?.id;
    setPhase('saving');
    try {
      const report = buildReport(r, secondsPerTick);
      const m = r.metrics;
      // Team mode: also log this player's individual stats (their own trades, attributed by fill).
      const pids = (s.participants ?? []).map((p) => p.id);
      const player = s.team_mode && s.participant_id ? buildPlayerStats(r, secondsPerTick, pids).players.find((p) => p.participantId === s.participant_id) : undefined;
      const playerReport = s.team_mode && s.participant_id ? buildReport(r, secondsPerTick, s.participant_id) : null;
      await store.updateSession(id, { status: 'finished', input_log: r.log, finished_at: new Date().toISOString() });
      await store.saveScore(s, m.score, { ret: m.ret, sortino: m.sortino, maxDD: m.maxDD, equity: m.equity }, player);
      await store.saveDebrief(id, { report, ...(playerReport ? { player_report: playerReport } : {}) });
      // In team mode both screens hold identical state; only the session owner uploads the shared trade log.
      if (isOwner) await Promise.all([store.saveTrades(s, r.orders, r.fills), store.saveSnapshots(s, r.snapshots)]).catch((e) => console.warn('trade log upload failed', e));
      try { localStorage.removeItem(progressKey(id)); } catch { /* ignore */ }
      router.replace(`/debrief/${id}`);
    } catch (e) { setErr(`Could not save the session: ${(e as Error).message}`); setPhase('error'); }
  }, [session, secondsPerTick, store, id, router, sync, user]);

  const onAbandon = useCallback(async () => {
    if (sync) { router.replace('/'); return; } // the session keeps running for the team-mate
    await store.updateSession(id, { status: 'abandoned' }).catch(() => {});
    try { localStorage.removeItem(progressKey(id)); } catch { /* ignore */ }
    router.replace('/');
  }, [store, id, router, sync]);

  const team: TeamProps | undefined = useMemo(() => sync ? {
    elapsedMs: () => sync.elapsedMs(),
    advance: (t: number) => sync.shared.advanceTo(t),
    place: (i) => sync.place(i),
    cancel: (oid) => sync.cancel(oid),
    end: () => sync.end(),
    names, peers, version: teamVer, notice,
    onSelect: (aid) => void sync.track(aid),
  } : undefined, [sync, names, peers, teamVer, notice]);
  const sharedBrief = useMemo(() => sync ? {
    value: alloc,
    onChange: (w: Record<string, string>) => { setAlloc(w); setLastEditBy(undefined); sync.broadcastAlloc(w); },
    autoStart: session?.owner_id === user?.id,
    peers: peers.map((p) => p.name),
    lastEditBy,
  } : undefined, [sync, alloc, session, user, peers, lastEditBy]);

  if (phase === 'loading') return <div className="page dim">Loading session…</div>;
  if (phase === 'error') return <div className="page"><p className="note bad">{err}</p><Link href="/">← Back</Link></div>;
  if (phase === 'saving') return <div className="page dim">Session over. Scoring and building your debrief…</div>;
  const r = runnerRef.current!;
  if (phase === 'briefing') return <Briefing runner={r} title={title} storyline={scenario!.historical && session!.disguise ? scenario!.storyline.replace(/\b(19|20)\d{2}\b/g, '[year]') : scenario!.storyline} disguise={session!.disguise} onStart={onStart} shared={sharedBrief} />;
  return (
    <Terminal runner={r} title={title} secondsPerTick={secondsPerTick} disguise={session!.disguise} initialElapsedMs={elapsedRef.current} practiceQuarters={session!.session_minutes === 60}
      onProgress={onProgress} onFinish={onFinish} onAbandon={onAbandon} team={team}
      hint={session!.hints ? (e) => <HintCard event={e} /> : undefined} />
  );
}
