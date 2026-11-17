'use client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { SharedSession, type SharedInput } from '@engine/team';
import type { RunnerOpts } from '@engine/runner';
import type { Order, OrderInput } from '@engine/types';
import { supabase, type SessionRow } from './store';

export interface PeerState { userId: string; name: string; role: string; selected?: string; online_at: string }
export type TeamEvent =
  | { type: 'input'; input: SharedInput; mine: boolean; rebuilt: boolean }
  | { type: 'session'; session: Partial<SessionRow> }
  | { type: 'presence'; peers: PeerState[] }
  | { type: 'alloc'; weights: Record<string, string>; from: string };

const INPUT_COLS = 'seq,tick,kind,payload,user_id,participant_id';

/**
 * Supabase transport for a team session. Inputs are written to `session_inputs` (the server assigns `seq`, which
 * fixes one global order), fanned out with Realtime, and applied by SharedSession on every client. The clock is
 * derived from the server's time and `sessions.started_at`, so both players are on the same tick.
 */
export class TeamSync {
  shared: SharedSession;
  offsetMs = 0;
  startedAt: number | null;
  private channel: RealtimeChannel | null = null;
  private listeners = new Set<(e: TeamEvent) => void>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(public session: SessionRow, opts: RunnerOpts, public me: { userId: string; participantId: string | null; name: string; role: string }) {
    this.shared = new SharedSession(opts);
    this.startedAt = session.started_at ? Date.parse(session.started_at) : null;
  }

  on(fn: (e: TeamEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: TeamEvent) { for (const fn of this.listeners) fn(e); }

  get runner() { return this.shared.runner; }
  serverNow() { return Date.now() + this.offsetMs; }
  elapsedMs() { return this.startedAt === null ? 0 : Math.max(0, this.serverNow() - this.startedAt); }

  async connect() {
    const db = supabase!;
    // Server clock offset (round-trip midpoint).
    const t0 = Date.now();
    const { data: now } = await db.rpc('server_now');
    const t1 = Date.now();
    if (now) this.offsetMs = Date.parse(now as string) - (t0 + t1) / 2;

    const sid = this.session.id;
    this.channel = db.channel(`team-${sid}`, { config: { presence: { key: this.me.userId }, broadcast: { self: false } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'session_inputs', filter: `session_id=eq.${sid}` }, (p) => this.receive(p.new as SharedInput))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sid}` }, (p) => this.sessionUpdate(p.new as Partial<SessionRow>))
      .on('presence', { event: 'sync' }, () => this.emitPresence())
      .on('broadcast', { event: 'alloc' }, (p) => this.emit({ type: 'alloc', weights: p.payload.weights, from: p.payload.from }));
    await new Promise<void>((resolve) => this.channel!.subscribe((status) => { if (status === 'SUBSCRIBED') resolve(); }));
    await this.track();
    await this.catchUp();
    // Fallback if a Realtime message is ever missed.
    this.pollTimer = setInterval(() => void this.catchUp(), 5000);
  }

  disconnect() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.channel) void supabase?.removeChannel(this.channel);
  }

  async track(selected?: string) {
    await this.channel?.track({ userId: this.me.userId, name: this.me.name, role: this.me.role, selected, online_at: new Date().toISOString() } satisfies PeerState);
  }
  private emitPresence() {
    const state = this.channel?.presenceState<PeerState>() ?? {};
    this.emit({ type: 'presence', peers: Object.values(state).map((v) => v[0]).filter(Boolean) });
  }
  broadcastAlloc(weights: Record<string, string>) {
    void this.channel?.send({ type: 'broadcast', event: 'alloc', payload: { weights, from: this.me.name } });
  }

  private lastSeq = 0;
  async catchUp() {
    const { data } = await supabase!.from('session_inputs').select(INPUT_COLS).eq('session_id', this.session.id).gt('seq', this.lastSeq).order('seq');
    for (const inp of (data ?? []) as SharedInput[]) this.receive(inp);
    const { data: s } = await supabase!.from('sessions').select('status,started_at').eq('id', this.session.id).maybeSingle();
    if (s && (s.status !== this.session.status || (s.started_at && Date.parse(s.started_at) !== this.startedAt))) this.sessionUpdate(s as Partial<SessionRow>);
  }

  private receive(inp: SharedInput) {
    inp = { ...inp, seq: Number(inp.seq) };
    this.lastSeq = Math.max(this.lastSeq, inp.seq);
    const rebuilt = this.shared.integrate(inp);
    this.emit({ type: 'input', input: inp, mine: inp.user_id === this.me.userId, rebuilt });
  }

  private sessionUpdate(s: Partial<SessionRow>) {
    this.session = { ...this.session, ...s };
    if (s.started_at) this.startedAt = Date.parse(s.started_at);
    this.emit({ type: 'session', session: s });
  }

  private async send(kind: SharedInput['kind'], payload: Record<string, unknown>, tick = this.runner.tick): Promise<SharedInput> {
    const { data, error } = await supabase!.from('session_inputs')
      .insert({ session_id: this.session.id, participant_id: this.me.participantId, tick, kind, payload }).select(INPUT_COLS).single();
    if (error) throw new Error(error.message);
    this.receive(data as SharedInput);
    return data as SharedInput;
  }

  async place(input: OrderInput, tick?: number): Promise<Order | null> {
    const { participantId: _drop, source, ...rest } = input;
    const inp = await this.send('place', { ...rest, ...(source ? { source } : {}) }, tick);
    return this.shared.orderFor(inp.seq) ?? null;
  }
  async cancel(orderId: string) {
    const placeSeq = this.shared.seqForOrder(orderId);
    if (placeSeq !== undefined) await this.send('cancel', { placeSeq });
  }
  async end() { await this.send('end', {}); }

  /**
   * Start the clock. A conditional update makes sure only one player wins if both press Start; the winner writes
   * the opening allocation as tick-0 inputs. The clock starts a few seconds later so both screens switch together.
   */
  async claimStart(opening: OrderInput[], leadMs = 3000): Promise<boolean> {
    const started_at = new Date(this.serverNow() + leadMs).toISOString();
    const { data } = await supabase!.from('sessions').update({ status: 'active', started_at }).eq('id', this.session.id).eq('status', 'briefing').select('id');
    if (!data?.length) return false;
    for (const o of opening) await this.place(o, 0);
    this.sessionUpdate({ status: 'active', started_at });
    return true;
  }
}
