import { SessionRunner, type RunnerOpts } from './runner';
import type { Order, OrderInput } from './types';

/** One input in a shared (team) session. `seq` is assigned by the server and breaks ties within a tick. */
export interface SharedInput {
  seq: number;
  tick: number;
  kind: 'place' | 'cancel' | 'end';
  /** place: OrderInput · cancel: { placeSeq } · end: {} */
  payload: Record<string, unknown>;
  user_id: string;
  participant_id: string | null;
}

const before = (a: SharedInput, b: SharedInput) => a.tick - b.tick || a.seq - b.seq;

/**
 * Deterministic lockstep for team sessions. Every client holds the same input list, sorted by (tick, seq), and
 * applies it to its own SessionRunner. If an input arrives that belongs before something already applied (network
 * latency), the runner is rebuilt from scratch and replayed to the current tick. The price path is shared, so a
 * rebuild costs a few milliseconds. All clients converge on identical state.
 */
export class SharedSession {
  runner: SessionRunner;
  readonly inputs: SharedInput[] = [];
  rebuilds = 0;
  private applied = 0;
  private seen = new Set<number>();
  private seqToOrder = new Map<number, string>();
  private orderToSeq = new Map<string, number>();
  private endRequested = false;
  private readonly opts: RunnerOpts;

  constructor(opts: RunnerOpts) {
    this.runner = new SessionRunner(opts);
    this.opts = { ...opts, path: this.runner.path };
  }

  /** Advance the clock to `tick`, applying inputs between steps exactly as a replay would. */
  advanceTo(tick: number): void {
    const r = this.runner;
    this.applyPending();
    while (r.tick < Math.min(tick, r.N) && !r.finished) { r.step(); this.applyPending(); }
    if (this.endRequested && !r.finished) { this.endRequested = false; this.advanceTo(r.N); }
  }

  /** Add an input (local or remote). Returns true if the runner had to be rebuilt. */
  integrate(inp: SharedInput): boolean {
    if (this.seen.has(inp.seq)) return false;
    this.seen.add(inp.seq);
    let i = this.inputs.length;
    while (i > 0 && before(inp, this.inputs[i - 1]) < 0) i--;
    this.inputs.splice(i, 0, inp);
    const now = this.runner.tick;
    if (i < this.applied || inp.tick < now) {
      this.rebuild(now);
      return true;
    }
    if (inp.tick === now) this.applyPending();
    if (this.endRequested) this.advanceTo(this.runner.N);
    return false;
  }

  /** The order created by a `place` input (after it has been applied). */
  orderFor(seq: number): Order | undefined {
    const id = this.seqToOrder.get(seq);
    return id ? this.runner.orders.find((o) => o.id === id) : undefined;
  }
  /** The `place` input that created an order, for cancels. */
  seqForOrder(orderId: string): number | undefined { return this.orderToSeq.get(orderId); }

  private rebuild(toTick: number): void {
    this.rebuilds++;
    this.runner = new SessionRunner(this.opts);
    this.applied = 0;
    this.seqToOrder.clear();
    this.orderToSeq.clear();
    this.endRequested = false;
    this.advanceTo(toTick);
  }

  private applyPending(): void {
    const r = this.runner;
    while (this.applied < this.inputs.length && this.inputs[this.applied].tick <= r.tick) {
      const inp = this.inputs[this.applied++];
      if (inp.kind === 'place') {
        const o = r.placeOrder({ ...(inp.payload as unknown as OrderInput), participantId: inp.participant_id ?? undefined });
        this.seqToOrder.set(inp.seq, o.id);
        this.orderToSeq.set(o.id, inp.seq);
      } else if (inp.kind === 'cancel') {
        const id = this.seqToOrder.get(Number(inp.payload.placeSeq));
        if (id) r.cancelOrder(id);
      } else if (inp.kind === 'end') this.endRequested = true;
    }
  }
}
