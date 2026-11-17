'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { Recorder } from '@/components/Recorder';
import { ClientCard } from '@/components/Briefing';
import { useJob, useStore, type PitchRow } from '@/lib/store';
import { EVENT_RULES } from '@config/event-rules';
import type { Client } from '@engine/types';
import { fmtPct } from '@/lib/format';

const jobKey = (id: string) => `wt:pitchjob:${id}`;

export default function PitchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { store, ready } = useStore();
  const [p, setP] = useState<PitchRow | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const { job, workerOnline } = useJob(store, jobId);

  const load = useCallback(async () => { const row = await store.getPitch(id); if (row) setP(row); return row; }, [store, id]);
  useEffect(() => {
    if (!ready) return;
    void load();
    try { setJobId(localStorage.getItem(jobKey(id))); } catch { /* ignore */ }
  }, [ready, load, id]);
  // While a judge job is in flight, refresh the pitch when it finishes.
  useEffect(() => { if (job?.status === 'done' || job?.status === 'failed') void load(); }, [job?.status, load]);

  const lastQ = p?.qa[p.qa.length - 1];
  const waiting = !!p && p.status !== 'scored' && (p.status === 'pitched' || p.status === 'scoring' || (p.status === 'qa' && !!lastQ?.a));
  const ask = useCallback((text: string) => { try { const u = new SpeechSynthesisUtterance(text); u.lang = 'en-GB'; u.rate = 1; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* no TTS */ } }, []);
  useEffect(() => { if (p?.status === 'qa' && lastQ && !lastQ.a) ask(lastQ.q); }, [p?.status, lastQ, ask]);

  async function enqueue() {
    const j = await store.enqueueJob('judge', { pitchId: id });
    setJobId(j.id);
    try { localStorage.setItem(jobKey(id), j.id); } catch { /* ignore */ }
  }
  async function submitPitch({ blob, transcript }: { blob: Blob; transcript: string }) {
    setBusy('Uploading your pitch…'); setErr('');
    try {
      const path = await store.uploadAudio(id, `pitch.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`, blob);
      await store.updatePitch(id, { audio_path: path, transcript: transcript || null, status: 'pitched' });
      await enqueue(); await load();
    } catch (e) { setErr((e as Error).message); }
    setBusy('');
  }
  async function submitAnswer({ blob, transcript }: { blob: Blob; transcript: string }) {
    if (!p) return;
    setBusy('Uploading your answer…'); setErr('');
    try {
      const n = p.qa.length;
      const path = await store.uploadAudio(id, `answer-${n}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`, blob);
      const qa = p.qa.map((x, i) => (i === n - 1 ? { ...x, a: transcript || '[transcribing…]', audio_path: path } : x));
      await store.updatePitch(id, { qa });
      await enqueue(); await load();
    } catch (e) { setErr((e as Error).message); }
    setBusy('');
  }

  if (!p) return <><Nav /><div className="page dim">Loading…</div></>;
  const ctx = p.context as { title?: string; kind?: string; client?: Client; final?: { ret: number; maxDD: number; score: { composite: number } }; scenario?: { title: string; storyline: string } } | null;
  const cfg = EVENT_RULES.pitch;

  return (
    <>
      <Nav />
      <main className="page grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)' }}>
        <section className="grid" style={{ alignContent: 'start' }}>
          <h1>Defend your strategy</h1>
          <div className="small dim">{ctx?.title}</div>

          {p.status === 'draft' && (
            <div className="card grid">
              <h2>Your {cfg.pitchSeconds / 60}-minute pitch</h2>
              <p className="small">You are presenting to a BOCHK senior wealth-management judge. A good structure:</p>
              <ol className="steps small">
                <li><b>Client first:</b> who they are, goal, risk profile, constraints.</li>
                <li><b>Strategy:</b> your allocation and why it suits this client (not just why it makes money).</li>
                <li><b>Key decisions:</b> 2-3 headlines you traded and the reasoning (factor → assets).</li>
                <li><b>Risk management:</b> drawdown control, position sizing, how you stayed in mandate.</li>
                <li><b>Rebalancing discipline and lessons:</b> what you would do differently.</li>
              </ol>
              {ctx?.kind === 'standalone' && <p className="note small">Standalone: propose and defend an allocation across the trainer&apos;s asset universe for this client and the current macro backdrop.</p>}
              <Recorder seconds={cfg.pitchSeconds} label="Start pitch" onDone={submitPitch} />
            </div>
          )}

          {p.transcript && (
            <details className="card" open={p.status === 'pitched'}>
              <summary><b>Your pitch transcript</b></summary>
              <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{p.transcript}</p>
            </details>
          )}

          {p.qa.map((x, i) => (
            <div key={i} className="card grid" style={{ gap: 6 }}>
              <div><span className="tag central_bank">Judge · Q{i + 1}</span> <b>{x.q}</b> <button className="ghost small" onClick={() => ask(x.q)} title="Read aloud">🔊</button></div>
              {x.a ? <div className="small"><span className="dim">Your answer:</span> {x.a}</div>
                : <Recorder key={`a${i}`} seconds={cfg.answerSeconds} label="Answer (2 min)" onDone={submitAnswer} />}
            </div>
          ))}

          {waiting && (
            <div className="card row">
              <span className={`tag ${job?.status === 'running' ? 'medium' : job?.status === 'failed' ? 'hard' : 'plain'}`}>{job?.status ?? 'queued'}</span>
              {job?.status === 'failed' ? <span className="small down">{job.error} <button onClick={enqueue}>Retry</button></span>
                : <span className="small">{job?.status === 'running' ? 'The judge is reviewing…' : workerOnline === false ? 'Your Mac worker is offline. The judge will respond as soon as it comes online (npm run worker).' : 'Waiting for the judge…'}</span>}
              {!jobId && <button onClick={enqueue}>Send to judge</button>}
            </div>
          )}
          {busy && <p className="small dim">{busy}</p>}
          {err && <p className="note bad">{err}</p>}

          {p.scorecard && (
            <div className="card grid">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>Scorecard</h2>
                <b className="num" style={{ fontSize: 28, color: 'var(--accent)' }}>{p.scorecard.overall.toFixed(0)}/100</b>
              </div>
              <p style={{ margin: 0 }}>{p.scorecard.verdict}</p>
              {p.scorecard.criteria.map((c) => (
                <div key={c.id} className="card" style={{ background: 'var(--panel2)' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}><b>{c.label}</b><b className="num">{c.score}/10</b></div>
                  <div className="bar ok" style={{ margin: '6px 0' }}><i style={{ width: `${c.score * 10}%` }} /></div>
                  <p className="small" style={{ margin: '4px 0' }}>{c.justification}</p>
                  <p className="small" style={{ margin: 0 }}><b className="blue">Improve:</b> {c.improvement}</p>
                </div>
              ))}
              <Link href="/pitch"><button>Back to pitch mode</button></Link>
            </div>
          )}
        </section>
        <aside className="grid" style={{ alignContent: 'start' }}>
          {ctx?.client && <ClientCard client={ctx.client} />}
          {ctx?.final && (
            <div className="card small">
              <h3>What you actually did</h3>
              <div>{ctx.scenario?.title}</div>
              <div>Return <b className={ctx.final.ret >= 0 ? 'up' : 'down'}>{fmtPct(ctx.final.ret, 1)}</b> · Max DD <b className="down">{fmtPct(-ctx.final.maxDD, 1)}</b> · Score <b>{ctx.final.score.composite.toFixed(1)}</b></div>
              <p className="dim">The judge has your full trade log and will check your story against it.</p>
            </div>
          )}
        </aside>
      </main>
    </>
  );
}
