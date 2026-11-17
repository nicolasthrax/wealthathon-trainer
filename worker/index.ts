/**
 * Wealthathon Trainer — local AI worker (runs on your Mac).
 *
 *   npm run worker
 *
 * - Subscribes to the Supabase `ai_jobs` table via Realtime (polling as a fallback) and runs each job through the
 *   local Claude Code CLI (`claude -p`, your subscription; no Anthropic API key).
 * - Keeps the scenario pool topped up: at least `pool.minSize` unplayed, validated synthetic scenarios
 *   (split by `pool.mix`) and `pool.minClients` client briefs. See config/event-rules.ts.
 * - Writes a heartbeat so the web app can show "AI worker online".
 */
import os from 'node:os';
import { createClient } from '@supabase/supabase-js';
import { EVENT_RULES } from '../config/event-rules';
import type { Difficulty } from '../packages/engine/src/types';
import { loadEnv } from '../scripts/seed-db';
import { HANDLERS, PRIORITY, type Job } from './jobs';

loadEnv();
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (see worker/README.md)'); process.exit(1); }
const db = createClient(URL_, KEY, { auth: { persistSession: false } });
const WORKER_ID = `${os.hostname()}-${process.pid}`;
const POLL_MS = 15_000, TOPUP_MS = 5 * 60_000, MAX_ATTEMPTS = 3;
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

let busy = false, wakeRequested = false, stopping = false, current: string | null = null;

async function heartbeat() {
  await db.from('worker_heartbeats').upsert({ id: os.hostname(), last_seen: new Date().toISOString(), info: { pid: process.pid, current, version: EVENT_RULES.version } });
}

/** Re-queue jobs left "running" by a worker that died. */
async function recoverStale() {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data } = await db.from('ai_jobs').update({ status: 'queued' }).eq('status', 'running').lt('started_at', cutoff).select('id');
  if (data?.length) log(`re-queued ${data.length} stale job(s)`);
}

async function claimNext(): Promise<(Job & { attempts: number }) | null> {
  const { data } = await db.from('ai_jobs').select('id,user_id,type,payload,attempts,created_at').eq('status', 'queued').order('created_at').limit(50);
  const queue = (data ?? []).sort((a, b) => (PRIORITY[a.type] ?? 9) - (PRIORITY[b.type] ?? 9) || a.created_at.localeCompare(b.created_at));
  for (const j of queue) {
    const { data: claimed } = await db.from('ai_jobs').update({ status: 'running', started_at: new Date().toISOString(), attempts: j.attempts + 1 })
      .eq('id', j.id).eq('status', 'queued').select('id');
    if (claimed?.length) return { ...j, attempts: j.attempts + 1 } as Job & { attempts: number };
  }
  return null;
}

async function drain() {
  if (busy) { wakeRequested = true; return; }
  busy = true;
  try {
    for (;;) {
      wakeRequested = false;
      const job = await claimNext();
      if (!job) break;
      current = `${job.type}:${job.id.slice(0, 8)}`;
      log(`▶ ${job.type} ${job.id.slice(0, 8)} (attempt ${job.attempts})`);
      const t0 = Date.now();
      try {
        const handler = HANDLERS[job.type];
        if (!handler) throw new Error(`unknown job type ${job.type}`);
        const result = await handler(db, job);
        await db.from('ai_jobs').update({ status: 'done', result: result ?? null, error: null, finished_at: new Date().toISOString() }).eq('id', job.id);
        log(`✓ ${job.type} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        const retry = job.attempts < MAX_ATTEMPTS && !/unknown job type|not found|another user/.test(msg);
        await db.from('ai_jobs').update({ status: retry ? 'queued' : 'failed', error: msg.slice(0, 2000), finished_at: retry ? null : new Date().toISOString() }).eq('id', job.id);
        log(`✗ ${job.type}: ${msg.slice(0, 300)}${retry ? ' (will retry)' : ''}`);
      }
      current = null;
      if (stopping) break;
    }
  } finally { busy = false; }
  if (wakeRequested && !stopping) void drain();
}

/** Queue generation jobs so the pool always holds enough unplayed scenarios (per difficulty) and clients. */
async function topUp() {
  const { data: rows } = await db.from('scenarios').select('difficulty,used_count').eq('source', 'synthetic').eq('validated', true);
  const { data: pending } = await db.from('ai_jobs').select('type,payload').in('status', ['queued', 'running']).in('type', ['generate_scenario', 'generate_client']);
  const jobs: { type: string; payload: Record<string, unknown> }[] = [];
  for (const d of ['easy', 'medium', 'hard'] as Difficulty[]) {
    const want = Math.ceil(EVENT_RULES.pool.minSize * EVENT_RULES.pool.mix[d]);
    const have = (rows ?? []).filter((r) => r.difficulty === d && r.used_count === 0).length;
    const queued = (pending ?? []).filter((p) => p.type === 'generate_scenario' && (p.payload as { difficulty?: string })?.difficulty === d).length;
    for (let i = have + queued; i < want; i++) jobs.push({ type: 'generate_scenario', payload: { difficulty: d } });
  }
  const { count } = await db.from('clients').select('id', { count: 'exact', head: true });
  const queuedClients = (pending ?? []).filter((p) => p.type === 'generate_client').length;
  for (let i = (count ?? 0) + queuedClients; i < EVENT_RULES.pool.minClients; i++) jobs.push({ type: 'generate_client', payload: {} });
  if (jobs.length) {
    await db.from('ai_jobs').insert(jobs.slice(0, 6).map((j) => ({ ...j, user_id: null })));
    log(`pool top-up: queued ${Math.min(6, jobs.length)} job(s) (${jobs.length} needed)`);
    void drain();
  }
}

async function main() {
  log(`Wealthathon worker ${WORKER_ID} starting (rules ${EVENT_RULES.version})`);
  await heartbeat();
  await recoverStale();
  setInterval(() => void heartbeat().catch(() => {}), EVENT_RULES.pool.workerHeartbeatSeconds * 1000);
  setInterval(() => void drain(), POLL_MS);
  setInterval(() => void topUp().catch((e) => log('top-up failed', e.message)), TOPUP_MS);
  db.channel('ai-jobs').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ai_jobs' }, (p) => {
    log(`realtime: new ${(p.new as { type: string }).type} job`);
    void drain();
  }).subscribe((status) => log(`realtime: ${status}`));
  await drain();
  await topUp();
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => {
  stopping = true;
  log(`stopping${current ? ` after ${current}` : ''}…`);
  void db.from('worker_heartbeats').delete().eq('id', os.hostname()).then(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
});

main().catch((e) => { console.error(e); process.exit(1); });
