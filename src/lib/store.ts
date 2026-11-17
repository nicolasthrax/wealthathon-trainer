'use client';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { EVENT_RULES, applyOverrides, type EventRules, type RuleOverrides } from '@config/event-rules';
import type { Client, Difficulty, Fill, LogEntry, Order, Scenario, Snapshot, ScoreBreakdown } from '@engine/types';
import type { OptimalResult, Report } from '@engine/report';
import { SEED_CLIENTS } from '@seed/clients';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const supabase: SupabaseClient | null = URL_ && KEY ? createClient(URL_, KEY) : null;

// ── Row types ────────────────────────────────────────────────────────────────
export interface ScenarioMeta { id: string; title: string; source: 'synthetic' | 'historical'; difficulty: Difficulty; generator: string | null; used_count: number; disguisedTitle?: string | null }
export interface SessionRow {
  id: string; scenario_id: string; scenario_title: string; client: Client; seed: string; difficulty: Difficulty; mode: 'synthetic' | 'historical';
  disguise: boolean; session_minutes: number; rules: EventRules; input_log: LogEntry[]; status: 'briefing' | 'active' | 'finished' | 'abandoned';
  created_at: string; finished_at?: string | null; participant_id?: string | null;
}
export interface ScoreRow {
  session_id: string; scenario_id: string; scenario_title: string; client_name: string | null; difficulty: Difficulty; mode: 'synthetic' | 'historical';
  composite: number; return_score: number; sortino_score: number; drawdown_score: number; mandate_score: number;
  ret: number; sortino: number; max_dd: number; final_equity: number; created_at: string;
}
export interface DebriefRow { session_id: string; report: Report | null; optimal: OptimalResult | null; coach: CoachResult | null; coach_job_id: string | null }
export interface JobRow { id: string; type: string; status: 'queued' | 'running' | 'done' | 'failed'; result: unknown; error: string | null; created_at: string }
export interface CoachResult {
  summary: string;
  mistakes: { title: string; whatHappened: string; mechanism: string[]; fix: string }[];
  strengths: { title: string; detail: string }[];
  drill: { title: string; steps: string[] };
}
export interface QA { q: string; a: string; audio_path?: string | null }
export interface Scorecard { overall: number; verdict: string; criteria: { id: string; label: string; score: number; justification: string; improvement: string }[] }
export interface PitchRow {
  id: string; session_id: string | null; status: 'draft' | 'pitched' | 'qa' | 'scoring' | 'scored'; audio_path: string | null; transcript: string | null;
  qa: QA[]; scorecard: Scorecard | null; context: Record<string, unknown> | null; created_at: string;
}
export interface NewSession { scenario: ScenarioMeta; client: Client; seed: string; difficulty: Difficulty; disguise: boolean; session_minutes: number; rules: EventRules }

export interface Store {
  kind: 'cloud' | 'local';
  listScenarios(): Promise<ScenarioMeta[]>;
  getScenario(id: string): Promise<Scenario>;
  listClients(): Promise<Client[]>;
  createSession(n: NewSession): Promise<SessionRow>;
  getSession(id: string): Promise<SessionRow | null>;
  updateSession(id: string, patch: Partial<Pick<SessionRow, 'status' | 'input_log'>> & { started_at?: string; finished_at?: string }): Promise<void>;
  saveTrades(s: SessionRow, orders: Order[], fills: Fill[]): Promise<void>;
  saveSnapshots(s: SessionRow, snaps: Snapshot[]): Promise<void>;
  saveScore(s: SessionRow, score: ScoreBreakdown, m: { ret: number; sortino: number; maxDD: number; equity: number }): Promise<void>;
  listScores(): Promise<ScoreRow[]>;
  getDebrief(sessionId: string): Promise<DebriefRow | null>;
  saveDebrief(sessionId: string, patch: Partial<Omit<DebriefRow, 'session_id'>>): Promise<void>;
  listDebriefs(): Promise<DebriefRow[]>;
  enqueueJob(type: string, payload: unknown): Promise<JobRow>;
  getJob(id: string): Promise<JobRow | null>;
  workerOnline(): Promise<boolean>;
  getOverrides(): Promise<RuleOverrides>;
  saveOverrides(o: RuleOverrides): Promise<void>;
  createPitch(sessionId: string | null, context: Record<string, unknown>): Promise<PitchRow>;
  getPitch(id: string): Promise<PitchRow | null>;
  listPitches(): Promise<PitchRow[]>;
  updatePitch(id: string, patch: Partial<Omit<PitchRow, 'id'>>): Promise<void>;
  uploadAudio(pitchId: string, name: string, blob: Blob): Promise<string>;
}

// ── Local (guest) store: everything in this browser, no AI features ──────────
const ls = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(`wt:${k}`); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(`wt:${k}`, JSON.stringify(v)); } catch { /* quota */ } },
};
let poolCache: Scenario[] | null = null;
/** Bundled offline pool, loaded only when Supabase is unreachable (keeps the main bundle and CPU light). */
const loadSeedPool = async () => (poolCache ??= (await import('@seed/pool')).seedPool());
const histCache = new Map<string, Scenario>();
const AI_GUEST = 'Sign in to use AI features (coach, pitch judge). They run on your Mac worker through Supabase.';

const localStore: Store = {
  kind: 'local',
  async listScenarios() {
    // Prefer the shared Supabase pool (readable by guests); fall back to bundled seeds when offline.
    if (supabase) {
      const { data } = await supabase.from('scenarios').select('id,title,source,difficulty,generator,used_count,disguisedTitle:json->historical->>disguisedTitle').eq('validated', true);
      if (data?.length) {
        const used = ls.get<Record<string, number>>('used', {});
        return (data as unknown as ScenarioMeta[]).map((m) => ({ ...m, used_count: used[m.id] ?? 0 }));
      }
    }
    await loadSeedPool();
    const hist: ScenarioMeta[] = await fetch('/seed/history/index.json').then((r) => (r.ok ? r.json() : [])).then((a: { id: string; title: string; disguisedTitle: string; difficulty: Difficulty }[]) =>
      a.map((h) => ({ id: h.id, title: h.title, source: 'historical' as const, difficulty: h.difficulty, generator: 'yahoo-finance', used_count: 0, disguisedTitle: h.disguisedTitle }))).catch(() => []);
    const used = ls.get<Record<string, number>>('used', {});
    return [...poolCache!.map((s) => ({ id: s.id, title: s.title, source: s.source, difficulty: s.difficulty, generator: s.generator ?? null, used_count: 0 })), ...hist].map((m) => ({ ...m, used_count: used[m.id] ?? 0 }));
  },
  async getScenario(id) {
    const cached = histCache.get(id);
    if (cached) return cached;
    if (supabase) {
      const { data } = await supabase.from('scenarios').select('json').eq('id', id).maybeSingle();
      if (data) { histCache.set(id, data.json as Scenario); return data.json as Scenario; }
    }
    const s = (await loadSeedPool()).find((x) => x.id === id);
    if (s) return s;
    const res = await fetch(`/seed/history/${id}.json`);
    if (!res.ok) throw new Error(`Scenario ${id} not found`);
    const sc = (await res.json()) as Scenario;
    histCache.set(id, sc);
    return sc;
  },
  async listClients() {
    const { data } = supabase ? await supabase.from('clients').select('json') : { data: null };
    return data?.length ? (data as { json: Client }[]).map((r) => r.json) : SEED_CLIENTS;
  },
  async createSession(n) {
    const row: SessionRow = { id: crypto.randomUUID(), scenario_id: n.scenario.id, scenario_title: n.scenario.title, client: n.client, seed: n.seed, difficulty: n.difficulty,
      mode: n.scenario.source, disguise: n.disguise, session_minutes: n.session_minutes, rules: n.rules, input_log: [], status: 'briefing', created_at: new Date().toISOString() };
    ls.set(`session:${row.id}`, row);
    const used = ls.get<Record<string, number>>('used', {}); used[row.scenario_id] = (used[row.scenario_id] ?? 0) + 1; ls.set('used', used);
    return row;
  },
  async getSession(id) { return ls.get<SessionRow | null>(`session:${id}`, null); },
  async updateSession(id, patch) { const s = ls.get<SessionRow | null>(`session:${id}`, null); if (s) ls.set(`session:${id}`, { ...s, ...patch }); },
  async saveTrades() {},
  async saveSnapshots() {},
  async saveScore(s, sc, m) {
    const rows = ls.get<ScoreRow[]>('scores', []).filter((r) => r.session_id !== s.id);
    rows.unshift({ session_id: s.id, scenario_id: s.scenario_id, scenario_title: s.scenario_title, client_name: s.client.name, difficulty: s.difficulty, mode: s.mode, composite: sc.composite,
      return_score: sc.return, sortino_score: sc.sortino, drawdown_score: sc.drawdown, mandate_score: sc.mandate, ret: m.ret, sortino: m.sortino, max_dd: m.maxDD, final_equity: m.equity, created_at: new Date().toISOString() });
    ls.set('scores', rows);
  },
  async listScores() { return ls.get<ScoreRow[]>('scores', []); },
  async getDebrief(id) { return ls.get<DebriefRow | null>(`debrief:${id}`, null); },
  async saveDebrief(id, patch) {
    const cur = ls.get<DebriefRow>(`debrief:${id}`, { session_id: id, report: null, optimal: null, coach: null, coach_job_id: null });
    // Keep only the compact report locally (curves are recomputed from the replay).
    ls.set(`debrief:${id}`, { ...cur, ...patch, optimal: null });
    const idx = ls.get<string[]>('debriefs', []); if (!idx.includes(id)) ls.set('debriefs', [id, ...idx]);
  },
  async listDebriefs() { return ls.get<string[]>('debriefs', []).map((id) => ls.get<DebriefRow | null>(`debrief:${id}`, null)).filter((d): d is DebriefRow => !!d); },
  async enqueueJob() { throw new Error(AI_GUEST); },
  async getJob() { return null; },
  async workerOnline() {
    if (!supabase) return false;
    const { data } = await supabase.from('worker_heartbeats').select('last_seen').order('last_seen', { ascending: false }).limit(1);
    return !!data?.[0] && Date.now() - Date.parse(data[0].last_seen) < EVENT_RULES.pool.workerOfflineAfterSeconds * 1000;
  },
  async getOverrides() { return ls.get<RuleOverrides>('overrides', {}); },
  async saveOverrides(o) { ls.set('overrides', o); },
  async createPitch() { throw new Error(AI_GUEST); },
  async getPitch() { return null; },
  async listPitches() { return []; },
  async updatePitch() {},
  async uploadAudio() { throw new Error(AI_GUEST); },
};

// ── Cloud store (Supabase, RLS-scoped to the signed-in user) ─────────────────
function cloudStore(db: SupabaseClient, user: User): Store {
  const ok = <T,>(r: { data: T | null; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data as T; };
  const SESSION_COLS = 'id,scenario_id,scenario_title,client,seed,difficulty,mode,disguise,session_minutes,rules,input_log,status,created_at,finished_at';
  return {
    kind: 'cloud',
    async listScenarios() {
      return ok(await db.from('scenarios').select('id,title,source,difficulty,generator,used_count,disguisedTitle:json->historical->>disguisedTitle').eq('validated', true)) as unknown as ScenarioMeta[];
    },
    async getScenario(id) { return (ok(await db.from('scenarios').select('json').eq('id', id).single()) as { json: Scenario }).json; },
    async listClients() {
      const rows = ok(await db.from('clients').select('json')) as { json: Client }[];
      return rows.length ? rows.map((r) => r.json) : SEED_CLIENTS;
    },
    async createSession(n) {
      const row = ok(await db.from('sessions').insert({ scenario_id: n.scenario.id, scenario_title: n.scenario.title, client_id: n.client.id, client: n.client, seed: n.seed, difficulty: n.difficulty,
        mode: n.scenario.source, disguise: n.disguise, session_minutes: n.session_minutes, rules: n.rules }).select(SESSION_COLS).single()) as SessionRow;
      const p = await db.from('participants').insert({ session_id: row.id, role: 'solo' }).select('id').single();
      void db.rpc('bump_scenario_used', { sid: n.scenario.id }).then(() => {});
      return { ...row, participant_id: p.data?.id ?? null };
    },
    async getSession(id) {
      const { data } = await db.from('sessions').select(`${SESSION_COLS},participants(id,user_id)`).eq('id', id).maybeSingle();
      if (!data) return null;
      const { participants, ...row } = data as unknown as SessionRow & { participants: { id: string; user_id: string }[] };
      return { ...row, participant_id: participants?.find((p) => p.user_id === user.id)?.id ?? null };
    },
    async updateSession(id, patch) { ok(await db.from('sessions').update(patch).eq('id', id).select('id')); },
    async saveTrades(s, orders, fills) {
      if (orders.length) ok(await db.from('orders').upsert(orders.map((o) => ({ session_id: s.id, participant_id: s.participant_id, client_order_id: o.id, tick: o.tick, asset_id: o.assetId, side: o.side,
        qty: o.qty, type: o.type, limit_price: o.limitPrice ?? null, status: o.status, reason: o.reason ?? null, source: o.source })), { onConflict: 'session_id,client_order_id' }).select('id'));
      if (fills.length) ok(await db.from('fills').upsert(fills.map((f) => ({ session_id: s.id, participant_id: s.participant_id, client_fill_id: f.id, client_order_id: f.orderId, tick: f.tick, asset_id: f.assetId,
        side: f.side, qty: f.qty, price: f.price, fee: f.fee, realized_pnl: f.realizedPnl, source: f.source })), { onConflict: 'session_id,client_fill_id' }).select('id'));
    },
    async saveSnapshots(s, snaps) {
      if (snaps.length) ok(await db.from('snapshots').upsert(snaps.map((x) => ({ session_id: s.id, participant_id: s.participant_id, tick: x.tick, equity: x.equity, cash: x.cash, positions: x.positions, score: x.score })), { onConflict: 'session_id,tick' }).select('id'));
    },
    async saveScore(s, sc, m) {
      ok(await db.from('scores').upsert({ session_id: s.id, participant_id: s.participant_id, scenario_id: s.scenario_id, scenario_title: s.scenario_title, client_name: s.client.name, difficulty: s.difficulty, mode: s.mode,
        composite: sc.composite, return_score: sc.return, sortino_score: sc.sortino, drawdown_score: sc.drawdown, mandate_score: sc.mandate, ret: m.ret, sortino: m.sortino, max_dd: m.maxDD, final_equity: m.equity },
        { onConflict: 'session_id,user_id' }).select('id'));
    },
    async listScores() { return ok(await db.from('scores').select('*').order('created_at', { ascending: false }).limit(500)) as ScoreRow[]; },
    async getDebrief(id) { return (await db.from('debriefs').select('session_id,report,optimal,coach,coach_job_id').eq('session_id', id).maybeSingle()).data as DebriefRow | null; },
    async saveDebrief(id, patch) { ok(await db.from('debriefs').upsert({ session_id: id, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'session_id' }).select('session_id')); },
    async listDebriefs() { return ok(await db.from('debriefs').select('session_id,report,coach,coach_job_id').order('created_at', { ascending: false }).limit(200)) as DebriefRow[]; },
    async enqueueJob(type, payload) { return ok(await db.from('ai_jobs').insert({ type, payload }).select('id,type,status,result,error,created_at').single()) as JobRow; },
    async getJob(id) { return (await db.from('ai_jobs').select('id,type,status,result,error,created_at').eq('id', id).maybeSingle()).data as JobRow | null; },
    async workerOnline() {
      const { data } = await db.from('worker_heartbeats').select('last_seen').order('last_seen', { ascending: false }).limit(1);
      const seen = data?.[0]?.last_seen;
      return !!seen && Date.now() - Date.parse(seen) < EVENT_RULES.pool.workerOfflineAfterSeconds * 1000;
    },
    async getOverrides() { return ((await db.from('profiles').select('settings').eq('id', user.id).maybeSingle()).data?.settings?.overrides ?? {}) as RuleOverrides; },
    async saveOverrides(o) { ok(await db.from('profiles').upsert({ id: user.id, settings: { overrides: o } }).select('id')); },
    async createPitch(sessionId, context) { return ok(await db.from('pitches').insert({ session_id: sessionId, context }).select('*').single()) as PitchRow; },
    async getPitch(id) { return (await db.from('pitches').select('*').eq('id', id).maybeSingle()).data as PitchRow | null; },
    async listPitches() { return ok(await db.from('pitches').select('*').order('created_at', { ascending: false }).limit(50)) as PitchRow[]; },
    async updatePitch(id, patch) { ok(await db.from('pitches').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('id')); },
    async uploadAudio(pitchId, name, blob) {
      const p = `${user.id}/${pitchId}/${name}`;
      const { error } = await db.storage.from('pitch-audio').upload(p, blob, { upsert: true, contentType: blob.type || 'audio/webm' });
      if (error) throw new Error(error.message);
      return p;
    },
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export interface StoreState { store: Store; user: User | null; ready: boolean }
let cached: { uid: string; store: Store } | null = null;

export function useStore(): StoreState {
  const [state, setState] = useState<StoreState>({ store: localStore, user: null, ready: !supabase });
  useEffect(() => {
    if (!supabase) return;
    const apply = (user: User | null) => {
      if (!user) { cached = null; setState({ store: localStore, user: null, ready: true }); return; }
      if (cached?.uid !== user.id) cached = { uid: user.id, store: cloudStore(supabase!, user) };
      setState((s) => (s.ready && s.user?.id === user.id ? s : { store: cached!.store, user, ready: true }));
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => apply(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);
  return state;
}

/** Poll a job until it finishes (Realtime is used when available; polling is the fallback). */
export function useJob(store: Store, jobId: string | null | undefined): { job: JobRow | null; workerOnline: boolean | null } {
  const [job, setJob] = useState<JobRow | null>(null);
  const [workerOnline, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    setJob(null);
    if (!jobId) return;
    let stop = false;
    const load = async () => {
      const j = await store.getJob(jobId).catch(() => null);
      if (stop) return;
      if (j) setJob(j);
      if (!j || j.status === 'queued') store.workerOnline().then((o) => !stop && setOnline(o)).catch(() => {});
    };
    load();
    const iv = setInterval(() => { setJob((cur) => { if (!cur || (cur.status !== 'done' && cur.status !== 'failed')) void load(); return cur; }); }, 4000);
    const ch = supabase?.channel(`job-${jobId}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ai_jobs', filter: `id=eq.${jobId}` }, (p) => setJob(p.new as JobRow)).subscribe();
    return () => { stop = true; clearInterval(iv); if (ch) void supabase?.removeChannel(ch); };
  }, [store, jobId]);
  return { job, workerOnline };
}

export async function currentRules(store: Store): Promise<EventRules> {
  return applyOverrides(EVENT_RULES, await store.getOverrides().catch(() => ({})));
}
