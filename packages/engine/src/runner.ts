import type {
  AssetClass, AssetDef, BreachEpisode, Client, Difficulty, EventRules, Fill, LogEntry, MandateCheck, Metrics, Order, OrderInput,
  Position, Scenario, Snapshot,
} from './types';
import { generatePath, type PricePath } from './path';
import { evaluateMandate, tightenClient } from './mandate';
import { benchmarkReturn } from './benchmark';
import { computeScore, sortinoFrom } from './scoring';

export interface RunnerOpts {
  scenario: Scenario; seed: string; rules: EventRules; client: Client; difficulty: Difficulty; path?: PricePath;
}

const CLASSES: AssetClass[] = ['equity', 'bond', 'cash', 'fx', 'commodity'];

/**
 * Deterministic session state machine. No timers, no I/O: the UI (or a replay) calls
 * `placeOrder` / `cancelOrder` and then `step()` once per tick.
 */
export class SessionRunner {
  readonly rules: EventRules;
  readonly scenario: Scenario;
  readonly client: Client;
  readonly path: PricePath;
  readonly difficulty: Difficulty;
  readonly assetById: Record<string, AssetDef> = {};
  readonly N: number;

  tick = 0;
  cash: number;
  pos: Record<string, Position> = {};
  orders: Order[] = [];
  fills: Fill[] = [];
  log: LogEntry[] = [];
  equityCurve: Float64Array;
  snapshots: Snapshot[] = [];
  breaches: BreachEpisode[] = [];
  liquidations = 0;
  bust = false;
  finished = false;
  metrics!: Metrics;

  private orderSeq = 0;
  private fillSeq = 0;
  private n = 0; private sumR = 0; private sumDown2 = 0; private peak: number; private maxDD = 0;
  private penalisedTicks = 0;
  private marginCallTicks = 0;
  private breachRun: Record<string, number> = {};
  private openBreach: Record<string, BreachEpisode> = {};

  constructor(o: RunnerOpts) {
    this.rules = o.rules;
    this.scenario = o.scenario;
    this.difficulty = o.difficulty;
    this.client = tightenClient(o.client, o.rules.difficulty[o.difficulty].mandateTightness);
    this.path = o.path ?? generatePath(o.scenario, o.seed, o.rules, o.difficulty);
    this.N = this.path.ticks;
    if (this.rules.practice?.scoring === 'proxy-excess-v1' && benchmarkReturn(this.path.prices, 0, this.rules.practice.benchmarkWeights ?? {}) === null) throw new Error('Course scoring requires all proxy benchmark price series; choose another scenario or the legacy preset.');
    for (const a of o.rules.assets) this.assetById[a.id] = a;
    this.cash = o.rules.startingCapital;
    this.peak = this.cash;
    this.equityCurve = new Float64Array(this.N + 1);
    this.equityCurve[0] = this.cash;
    this.refresh();
  }

  price(id: string, tick = this.tick): number { return this.path.prices[id]?.[tick] ?? 0; }
  qty(id: string): number { return this.pos[id]?.qty ?? 0; }

  equity(): number {
    let e = this.cash;
    for (const id in this.pos) e += this.pos[id].qty * this.price(id);
    return e;
  }
  weights(): { w: Record<string, number>; cashW: number } {
    const e = this.equity();
    const w: Record<string, number> = {};
    if (e <= 0) return { w, cashW: 0 };
    for (const id in this.pos) if (this.pos[id].qty) w[id] = (this.pos[id].qty * this.price(id)) / e;
    return { w, cashW: this.cash / e };
  }
  private marginOf(pos: Record<string, Position | { qty: number }>): { used: number; gross: number } {
    let used = 0, gross = 0;
    for (const id in pos) {
      const v = Math.abs(pos[id].qty * this.price(id));
      gross += v;
      used += v * this.rules.margin.initialRate[this.assetById[id].cls];
    }
    return { used, gross };
  }

  // ── Orders ───────────────────────────────────────────────────────────────
  placeOrder(input: OrderInput, logIt = true): Order {
    const order: Order = { ...input, source: input.source ?? 'user', id: `o${++this.orderSeq}`, tick: this.tick, status: 'working' };
    if (logIt && order.source !== 'liquidation') this.log.push({ tick: this.tick, kind: 'place', input: { ...input } });
    this.orders.push(order);
    const px = this.price(order.assetId);
    const reject = (reason: string) => { order.status = 'rejected'; order.reason = reason; return order; };
    if (this.finished) return reject('Session finished');
    if (this.bust) return reject('Account liquidated');
    if (!this.path.prices[order.assetId]) return reject('Asset not tradable in this session');
    if (!(order.qty > 0) || !Number.isFinite(order.qty)) return reject('Invalid quantity');
    order.qty = Math.floor(order.qty);
    if (order.qty < 1) return reject('Quantity below 1 unit');
    if (!this.rules.orders.types.includes(order.type)) return reject(`${order.type} orders are disabled`);
    if (order.type === 'limit') {
      if (!(order.limitPrice! > 0)) return reject('Invalid limit price');
      const marketable = order.side === 'buy' ? px <= order.limitPrice! : px >= order.limitPrice!;
      if (marketable) this.tryFill(order, px);
    } else this.tryFill(order, px);
    this.refresh();
    return order;
  }

  cancelOrder(orderId: string, logIt = true): boolean {
    const o = this.orders.find((x) => x.id === orderId);
    if (!o || o.status !== 'working') return false;
    o.status = 'cancelled';
    if (logIt) this.log.push({ tick: this.tick, kind: 'cancel', orderId });
    return true;
  }
  cancelAll(): void { for (const o of this.orders) if (o.status === 'working') this.cancelOrder(o.id); }

  /** Market order that closes the whole position in one asset. */
  flatten(assetId: string): Order | null {
    const q = this.qty(assetId);
    if (!q) return null;
    return this.placeOrder({ assetId, side: q > 0 ? 'sell' : 'buy', qty: Math.abs(q), type: 'market' });
  }

  /** Pre-trade check without side effects: would this order be accepted, and what would the mandate look like after? */
  preview(input: OrderInput): { ok: boolean; reason?: string; checks: MandateCheck[]; newBreaches: string[]; weightAfter: number } {
    const px = input.type === 'limit' && input.limitPrice ? input.limitPrice : this.price(input.assetId);
    const dq = (input.side === 'buy' ? 1 : -1) * Math.floor(input.qty || 0);
    const reason = this.checkTrade(input.assetId, dq, px, 0);
    const e = this.equity();
    const { w, cashW } = this.weights();
    const before = evaluateMandate(this.client, w, cashW, this.rules);
    const w2 = { ...w, [input.assetId]: (w[input.assetId] ?? 0) + (e > 0 ? (dq * px) / e : 0) };
    const checks = evaluateMandate(this.client, w2, cashW - (e > 0 ? (dq * px) / e : 0), this.rules);
    const newBreaches = checks.filter((c, i) => !c.ok && before[i].ok).map((c) => c.label);
    return { ok: !reason, reason: reason ?? undefined, checks, newBreaches, weightAfter: w2[input.assetId] };
  }

  private checkTrade(assetId: string, dq: number, px: number, fee: number): string | null {
    const q0 = this.qty(assetId), q1 = q0 + dq;
    if (q1 < 0 && !this.rules.shorting.allowed) return 'Short selling is disabled';
    const cap = this.rules.practice?.maxAssetValue;
    if (cap !== undefined && dq > 0 && q1 * px > cap + 1e-6) return `Asset limit: ${this.rules.baseCurrency} ${cap.toLocaleString('en-US')}`;
    if (this.rules.practice?.scoring === 'proxy-excess-v1' && dq > 0 && this.cash + 1e-6 < dq * px + fee) return 'Insufficient cash; borrowing is disabled';
    const before = this.marginOf(this.pos);
    const after = this.marginOf({ ...this.pos, [assetId]: { qty: q1 } });
    if (after.used > before.used + 1e-6) {
      const eq = this.equity() - fee;
      if (!this.rules.margin.allowed && after.gross > eq + 1e-6) return 'Leverage is disabled (not enough cash)';
      if (after.used > eq) return 'Insufficient margin';
      if (after.gross > eq * this.rules.margin.maxLeverage) return `Exceeds max leverage ${this.rules.margin.maxLeverage}x`;
    }
    return null;
  }

  private tryFill(order: Order, mid: number): void {
    const a = this.assetById[order.assetId];
    const sign = order.side === 'buy' ? 1 : -1;
    const c = this.rules.costs;
    const px = c.enabled ? mid * (1 + (sign * c.spreadBps[a.cls]) / 2 / 1e4) : mid;
    const liq = order.source === 'liquidation';
    const feeBps = (c.enabled ? c.commissionBps : 0) + (liq ? this.rules.margin.liquidationFeeBps : 0);
    const fee = (order.qty * px * feeBps) / 1e4;
    const dq = sign * order.qty;
    if (!liq) {
      const reason = this.checkTrade(order.assetId, dq, px, fee);
      if (reason) { order.status = 'rejected'; order.reason = reason; return; }
      if (this.rules.mandate.hardBlock) {
        const pv = this.preview(order);
        if (pv.newBreaches.length) { order.status = 'rejected'; order.reason = `Mandate: ${pv.newBreaches[0]}`; return; }
      }
    }
    const p = this.pos[order.assetId] ?? { qty: 0, avg: 0 };
    let realized = 0;
    const q1 = p.qty + dq;
    if (p.qty !== 0 && Math.sign(p.qty) !== sign) {
      const closing = Math.min(Math.abs(dq), Math.abs(p.qty));
      realized = closing * (px - p.avg) * Math.sign(p.qty);
      if (Math.sign(q1) === sign) p.avg = px; // crossed through zero
    } else {
      p.avg = (p.avg * Math.abs(p.qty) + px * Math.abs(dq)) / (Math.abs(p.qty) + Math.abs(dq));
    }
    p.qty = q1;
    if (q1 === 0) delete this.pos[order.assetId]; else this.pos[order.assetId] = p;
    this.cash -= dq * px + fee;
    order.status = 'filled';
    this.fills.push({ id: `f${++this.fillSeq}`, orderId: order.id, tick: this.tick, assetId: order.assetId, side: order.side, qty: order.qty, price: px, fee, realizedPnl: realized - fee, source: order.source, ...(order.participantId ? { participantId: order.participantId } : {}) });
  }

  // ── Clock ────────────────────────────────────────────────────────────────
  step(): void {
    if (this.finished) return;
    this.tick++;
    const dt = 1 / this.N;
    const m = this.rules.margin;

    for (const o of this.orders) {
      if (o.status !== 'working') continue;
      const px = this.price(o.assetId);
      if (o.side === 'buy' ? px <= o.limitPrice! : px >= o.limitPrice!) this.tryFill(o, px);
    }

    // Financing: interest on borrowed cash, borrow fee on shorts, yield on idle cash.
    if (this.cash < 0) this.cash += this.cash * m.borrowRate * dt; else this.cash += this.cash * m.cashRate * dt;
    for (const id in this.pos) if (this.pos[id].qty < 0) this.cash += this.pos[id].qty * this.price(id) * this.rules.shorting.borrowRate * dt;

    // Margin call / forced liquidation.
    let eq = this.equity();
    const { used } = this.marginOf(this.pos);
    if (used > 0 && eq < used * m.maintenanceFactor) {
      this.marginCallTicks++;
      if (eq <= 0 || eq < used * m.liquidationFactor || this.marginCallTicks > m.marginCallGraceTicks) {
        this.liquidate(eq, used);
        eq = this.equity();
      }
    } else this.marginCallTicks = 0;

    // Performance stats.
    const prev = this.equityCurve[this.tick - 1];
    const r = prev > 0 ? eq / prev - 1 : 0;
    this.n++; this.sumR += r; if (r < 0) this.sumDown2 += r * r;
    this.peak = Math.max(this.peak, eq);
    this.maxDD = Math.max(this.maxDD, this.peak > 0 ? 1 - eq / this.peak : 0);
    this.equityCurve[this.tick] = eq;

    // Mandate breach tracking.
    const { w, cashW } = this.weights();
    const checks = evaluateMandate(this.client, w, cashW, this.rules);
    let penalised = false;
    for (const c of checks) {
      if (!c.ok) {
        const run = (this.breachRun[c.key] = (this.breachRun[c.key] ?? 0) + 1);
        const ep = (this.openBreach[c.key] ??= (() => { const e = { key: c.key, label: c.label, startTick: this.tick, endTick: this.tick, penalisedTicks: 0 }; this.breaches.push(e); return e; })());
        ep.endTick = this.tick;
        if (run > this.rules.mandate.breachGraceTicks) { penalised = true; ep.penalisedTicks++; }
      } else { this.breachRun[c.key] = 0; delete this.openBreach[c.key]; }
    }
    if (penalised) this.penalisedTicks++;

    if (this.tick >= this.N) {
      this.finished = true;
      for (const o of this.orders) if (o.status === 'working') o.status = 'cancelled';
    }
    this.refresh(checks);
    if (this.tick % this.rules.debrief.snapshotEveryTicks === 0 || this.finished) {
      const positions: Record<string, number> = {};
      for (const id in this.pos) positions[id] = this.pos[id].qty;
      this.snapshots.push({ tick: this.tick, equity: eq, cash: this.cash, positions, score: this.metrics.score.composite });
    }
  }

  private liquidate(eq: number, used: number): void {
    this.liquidations++;
    // Scale every position down until NAV covers initial margin again (with a 10% buffer); wipe out if NAV <= 0.
    const keep = eq <= 0 ? 0 : Math.max(0, Math.min(1, (eq / used) * 0.9));
    for (const id of Object.keys(this.pos)) {
      const q = this.pos[id].qty;
      const cut = eq <= 0 ? Math.abs(q) : Math.ceil(Math.abs(q) * (1 - keep));
      if (cut > 0) {
        const o: Order = { id: `o${++this.orderSeq}`, tick: this.tick, assetId: id, side: q > 0 ? 'sell' : 'buy', qty: Math.min(cut, Math.abs(q)), type: 'market', status: 'working', source: 'liquidation', reason: 'Forced liquidation (margin call)' };
        this.orders.push(o);
        this.tryFill(o, this.price(id));
      }
    }
    this.marginCallTicks = 0;
    if (this.equity() <= 0) { this.bust = true; for (const o of this.orders) if (o.status === 'working') o.status = 'cancelled'; }
  }

  /** Recompute point-in-time metrics (called after every order and every tick). */
  refresh(checks?: MandateCheck[]): void {
    const eq = this.equity();
    const start = this.rules.startingCapital;
    const { used, gross } = this.marginOf(this.pos);
    const exposureByClass = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<AssetClass, number>;
    const fExp: Record<string, number> = {};
    let idioVar = 0;
    for (const id in this.pos) {
      const a = this.assetById[id];
      const v = this.pos[id].qty * this.price(id);
      if (eq > 0) exposureByClass[a.cls] += v / eq;
      for (const f in a.loadings) fExp[f] = (fExp[f] ?? 0) + v * a.loadings[f];
      idioVar += (v * a.idioVol) ** 2;
    }
    if (eq > 0) exposureByClass.cash += this.cash / eq;
    let variance = idioVar;
    for (const f of this.rules.factors) variance += ((fExp[f.id] ?? 0) * f.vol * (this.scenario.regime.volMult ?? 1)) ** 2;
    const var95 = 1.645 * Math.sqrt(variance / this.rules.clock.tradingDaysPerYear);

    if (!checks) { const { w, cashW } = this.weights(); checks = evaluateMandate(this.client, w, cashW, this.rules); }
    for (const c of checks) c.breachTicks = c.ok ? 0 : this.breachRun[c.key] ?? 0;
    const ret = eq / start - 1;
    const benchmark = this.rules.practice?.scoring === 'proxy-excess-v1' ? benchmarkReturn(this.path.prices, this.tick, this.rules.practice.benchmarkWeights ?? {}) : null;
    if (this.rules.practice?.scoring === 'proxy-excess-v1' && benchmark === null) throw new Error('Proxy benchmark data unavailable at this tick');
    const sortino = sortinoFrom(this.n, this.sumR, this.sumDown2, this.rules);
    const peak = Math.max(this.peak, eq);
    const curDD = peak > 0 ? 1 - eq / peak : 0;
    const maxDD = Math.max(this.maxDD, curDD);
    this.metrics = {
      tick: this.tick, equity: eq, cash: this.cash, pnl: eq - start, ret, sortino, maxDD, curDD,
      gross, leverage: eq > 0 ? gross / eq : 0, marginUsed: used, marginAvail: eq - used, maintenance: used * this.rules.margin.maintenanceFactor,
      marginCall: this.marginCallTicks > 0, bust: this.bust, exposureByClass, var95, mandate: checks, penalisedTicks: this.penalisedTicks,
      score: computeScore({ ret: benchmark === null ? ret : ret - benchmark, sortino, maxDD, penalisedFrac: this.penalisedTicks / this.N }, this.rules),
    };
  }
}

/** Turn target weights into opening market orders at the current tick. */
export function ordersFromWeights(runner: SessionRunner, weights: Record<string, number>): OrderInput[] {
  const eq = runner.equity();
  const out: OrderInput[] = [];
  for (const [assetId, w] of Object.entries(weights)) {
    const px = runner.price(assetId);
    if (!w || !px) continue;
    const qty = Math.floor((Math.abs(w) * eq) / px);
    if (qty >= 1) out.push({ assetId, side: w > 0 ? 'buy' : 'sell', qty, type: 'market', source: 'opening' });
  }
  // Sells first so short proceeds / de-risking never block the buys.
  return out.sort((a, b) => (a.side === b.side ? 0 : a.side === 'sell' ? -1 : 1));
}

/** Rebuild a session exactly from its input log (same scenario + seed + rules => same result). */
export function replaySession(opts: RunnerOpts, log: LogEntry[], toTick?: number): SessionRunner {
  const r = new SessionRunner(opts);
  const end = Math.min(toTick ?? r.N, r.N);
  let i = 0;
  const apply = () => {
    while (i < log.length && log[i].tick <= r.tick) {
      const e = log[i++];
      if (e.kind === 'place') r.placeOrder(e.input); else if (e.kind === 'cancel') r.cancelOrder(e.orderId);
    }
  };
  apply();
  while (r.tick < end) { r.step(); if (r.tick < end || toTick !== undefined) apply(); }
  return r;
}
