import type { AssetClass, BreachEpisode, EventRules, Fill, ScoreBreakdown } from './types';
import { expectedImpact } from './path';
import type { SessionRunner } from './runner';
import { evaluateMandate, mandateViolation } from './mandate';

export interface EventReport {
  eventId: string; headline: string; category: string; source: string; kind: string; magnitude: string; tick: number;
  topImpacts: { assetId: string; impact: number }[];
  reactionTicks: number | null; reactionSeconds: number | null;
  firstTrade: { assetId: string; side: string; qty: number } | null;
  trades: number; hits: number; misses: number;
}
export interface TradeReport {
  assetId: string; dir: 'long' | 'short'; qty: number; openTick: number; closeTick: number; openPrice: number; closePrice: number; pnl: number; stillOpen: boolean;
}
export interface Report {
  final: { equity: number; ret: number; sortino: number; maxDD: number; score: ScoreBreakdown; penalisedTicks: number; liquidations: number; bust: boolean };
  events: EventReport[];
  avgReactionSeconds: number | null; reactedCount: number; hitRate: number | null; hits: number; misses: number;
  best: TradeReport[]; worst: TradeReport[]; tradeCount: number; turnover: number;
  breaches: BreachEpisode[];
  byCategory: Record<string, { events: number; reacted: number; hits: number; misses: number; avgReactionSeconds: number | null }>;
  byClass: Record<string, { pnl: number; trades: number }>;
  curveStep: number; equity: number[]; drawdown: number[];
}

/** Per-asset impact of an event: the scenario's known shocks, or (historical) the realised move after it. */
export function eventImpact(runner: SessionRunner, eventId: string): Record<string, number> {
  const ev = runner.scenario.events.find((e) => e.id === eventId)!;
  const exp = expectedImpact(ev, runner.rules);
  if (Object.values(exp).some((v) => Math.abs(v) > 1e-9)) return exp;
  const t0 = runner.path.eventTicks[eventId];
  const t1 = Math.min(runner.N, t0 + runner.rules.debrief.hitHorizonTicks);
  const out: Record<string, number> = {};
  for (const id of runner.path.assets) out[id] = runner.price(id, t1) / runner.price(id, t0) - 1;
  return out;
}

/** `participantId` limits the trade-based stats (reaction, hit rate, best/worst, turnover) to one player's own trades. */
export function buildReport(runner: SessionRunner, secondsPerTick: number, participantId?: string): Report {
  const { rules, path, N } = runner;
  const d = rules.debrief;
  const userFills = runner.fills.filter((f) => f.source === 'user' && (participantId === undefined || f.participantId === participantId));
  const events = [...runner.scenario.events].sort((a, b) => path.eventTicks[a.id] - path.eventTicks[b.id]);
  const impacts = events.map((e) => eventImpact(runner, e.id));

  const evReports: EventReport[] = events.map((e, i) => ({
    eventId: e.id, headline: e.headline, category: e.category, source: e.source, kind: e.kind, magnitude: e.magnitude, tick: path.eventTicks[e.id],
    topImpacts: Object.entries(impacts[i]).filter(([id]) => path.prices[id]).map(([assetId, impact]) => ({ assetId, impact }))
      .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 4),
    reactionTicks: null, reactionSeconds: null, firstTrade: null, trades: 0, hits: 0, misses: 0,
  }));

  // Attribute each fill to the most recent headline (within the window) for which the asset is relevant.
  for (const f of userFills) {
    for (let i = events.length - 1; i >= 0; i--) {
      const te = evReports[i].tick;
      if (te > f.tick) continue;
      if (f.tick - te > d.reactionWindowTicks) break;
      if (Math.abs(impacts[i][f.assetId] ?? 0) < d.relevantMove) continue;
      const er = evReports[i];
      if (er.reactionTicks === null) {
        er.reactionTicks = f.tick - te; er.reactionSeconds = (f.tick - te) * secondsPerTick;
        er.firstTrade = { assetId: f.assetId, side: f.side, qty: f.qty };
      }
      const t1 = Math.min(N, f.tick + d.hitHorizonTicks);
      const fwd = (runner.price(f.assetId, t1) / f.price - 1) * (f.side === 'buy' ? 1 : -1);
      er.trades++;
      if (fwd > 0) er.hits++; else er.misses++;
      break;
    }
  }

  // FIFO round trips.
  const trades: TradeReport[] = [];
  const lots: Record<string, { qty: number; price: number; tick: number }[]> = {};
  for (const f of participantId === undefined ? runner.fills : userFills) {
    const q = (lots[f.assetId] ??= []);
    let rem = f.side === 'buy' ? f.qty : -f.qty;
    while (rem !== 0 && q.length && Math.sign(q[0].qty) !== Math.sign(rem)) {
      const lot = q[0];
      const c = Math.min(Math.abs(rem), Math.abs(lot.qty));
      const dir = lot.qty > 0 ? 1 : -1;
      trades.push({ assetId: f.assetId, dir: dir > 0 ? 'long' : 'short', qty: c, openTick: lot.tick, closeTick: f.tick, openPrice: lot.price, closePrice: f.price, pnl: c * (f.price - lot.price) * dir, stillOpen: false });
      lot.qty -= c * dir; rem += c * dir;
      if (lot.qty === 0) q.shift();
    }
    if (rem !== 0) q.push({ qty: rem, price: f.price, tick: f.tick });
  }
  for (const [assetId, q] of Object.entries(lots)) for (const lot of q) {
    const px = runner.price(assetId, runner.tick), dir = lot.qty > 0 ? 1 : -1;
    trades.push({ assetId, dir: dir > 0 ? 'long' : 'short', qty: Math.abs(lot.qty), openTick: lot.tick, closeTick: runner.tick, openPrice: lot.price, closePrice: px, pnl: Math.abs(lot.qty) * (px - lot.price) * dir, stillOpen: true });
  }
  const sorted = [...trades].sort((a, b) => b.pnl - a.pnl);

  const byClass: Report['byClass'] = {};
  for (const t of trades) {
    const c = (byClass[runner.assetById[t.assetId].cls as AssetClass] ??= { pnl: 0, trades: 0 });
    c.pnl += t.pnl; c.trades++;
  }
  const byCategory: Report['byCategory'] = {};
  for (const e of evReports) {
    const c = (byCategory[e.category] ??= { events: 0, reacted: 0, hits: 0, misses: 0, avgReactionSeconds: null });
    c.events++; c.hits += e.hits; c.misses += e.misses;
    if (e.reactionSeconds !== null) { c.avgReactionSeconds = ((c.avgReactionSeconds ?? 0) * c.reacted + e.reactionSeconds) / (c.reacted + 1); c.reacted++; }
  }

  const reacted = evReports.filter((e) => e.reactionSeconds !== null);
  const hits = evReports.reduce((s, e) => s + e.hits, 0), misses = evReports.reduce((s, e) => s + e.misses, 0);
  const step = 4;
  const equity: number[] = [], drawdown: number[] = [];
  let peak = 0, sumEq = 0;
  for (let t = 0; t <= runner.tick; t++) {
    const e = runner.equityCurve[t];
    peak = Math.max(peak, e); sumEq += e;
    if (t % step === 0 || t === runner.tick) { equity.push(Math.round(e)); drawdown.push(peak > 0 ? 1 - e / peak : 0); }
  }
  const traded = userFills.reduce((s, f) => s + f.qty * f.price, 0);
  const m = runner.metrics;
  return {
    final: { equity: m.equity, ret: m.ret, sortino: m.sortino, maxDD: m.maxDD, score: m.score, penalisedTicks: m.penalisedTicks, liquidations: runner.liquidations, bust: runner.bust },
    events: evReports,
    avgReactionSeconds: reacted.length ? reacted.reduce((s, e) => s + e.reactionSeconds!, 0) / reacted.length : null,
    reactedCount: reacted.length, hitRate: hits + misses ? hits / (hits + misses) : null, hits, misses,
    best: sorted.slice(0, 5), worst: sorted.slice(-5).reverse().filter((t) => !sorted.slice(0, 5).includes(t)),
    tradeCount: userFills.length, turnover: sumEq > 0 ? traded / (sumEq / (runner.tick + 1)) : 0,
    breaches: runner.breaches, byCategory, byClass, curveStep: step, equity, drawdown,
  };
}

// ── Optimal path (perfect-foresight, mandate-respecting benchmark) ───────────
export interface OptimalSegment {
  fromTick: number; toTick: number; eventId: string | null; headline: string;
  weights: Record<string, number>; optReturn: number; myReturn: number; gap: number;
}
export interface OptimalResult { curveStep: number; equity: number[]; finalReturn: number; segments: OptimalSegment[]; missed: OptimalSegment[] }

/**
 * Expected return of each asset over [t0, t1] as the benchmark sees it: the known shocks of the headline that
 * opens the segment, plus regime drift and carry. Historical episodes have no shocks, so the realised move over the
 * reaction horizon is used instead. The benchmark rewards reading the news correctly, not foreseeing noise.
 */
export function segmentView(runner: SessionRunner, t0: number, t1: number, eventId: string | null): number[] {
  const { rules, scenario } = runner;
  const ids = runner.path.assets;
  const frac = (t1 - t0) / runner.N;
  if (scenario.historical) {
    const h = Math.min(t1, t0 + rules.debrief.hitHorizonTicks);
    return ids.map((id) => runner.price(id, h) / runner.price(id, t0) - 1);
  }
  const ev = eventId ? scenario.events.find((e) => e.id === eventId) : null;
  const imp = ev ? expectedImpact(ev, rules) : {};
  return ids.map((id) => {
    const a = runner.assetById[id];
    let drift = a.carry;
    for (const f of rules.factors) drift += (a.loadings[f.id] ?? 0) * (f.drift + (scenario.regime.factorDrift?.[f.id] ?? 0));
    return (imp[id] ?? 0) + drift * frac;
  });
}

/**
 * Greedy rebalance at every headline: hill-climb (in `stepWeight` increments) to the allocation with the best
 * expected segment return that satisfies the client mandate and the benchmark limits in config. Deterministic.
 */
export function solveSegment(runner: SessionRunner, t0: number, t1: number, eventId: string | null = null): Record<string, number> {
  const { rules, client } = runner;
  const o = rules.debrief.optimal;
  const ids = runner.path.assets;
  const n = ids.length;
  const r = segmentView(runner, t0, t1, eventId);
  const lev = client.constraints.reduce((m, c) => (c.type === 'maxLeverage' ? Math.min(m, c.max) : m), rules.margin.allowed ? o.maxLeverage : 1);
  const canShort = rules.shorting.allowed && !client.constraints.some((c) => c.type === 'noShort');
  const maxU = Math.round(o.maxAssetWeight / o.stepWeight), minU = canShort ? -Math.round(o.maxShortPerAsset / o.stepWeight) : 0;
  const u = new Int32Array(n); // weights in units of stepWeight
  const wObj: Record<string, number> = {};
  const objective = (): number => {
    let ret = 0, sum = 0, gross = 0;
    for (let i = 0; i < n; i++) { const w = u[i] * o.stepWeight; wObj[ids[i]] = w; ret += w * r[i]; sum += w; gross += Math.abs(w); }
    const viol = mandateViolation(evaluateMandate(client, wObj, 1 - sum, rules)) + Math.max(0, gross - lev);
    return ret - 100 * viol;
  };
  let best = objective();
  for (let iter = 0; iter < 500; iter++) {
    let bi = -1, bj = -1, bv = best + 1e-9;
    // i loses one unit, j gains one unit; index n is cash.
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      if (i === j) continue;
      if (i < n && u[i] - 1 < minU) continue;
      if (j < n && u[j] + 1 > maxU) continue;
      if (i < n) u[i]--; if (j < n) u[j]++;
      const v = objective();
      if (v > bv) { bv = v; bi = i; bj = j; }
      if (i < n) u[i]++; if (j < n) u[j]--;
    }
    if (bi < 0) break;
    if (bi < n) u[bi]--; if (bj < n) u[bj]++;
    best = bv;
  }
  const out: Record<string, number> = {};
  for (let i = 0; i < n; i++) if (u[i]) out[ids[i]] = u[i] * o.stepWeight;
  return out;
}

export function computeOptimalPath(runner: SessionRunner): OptimalResult {
  const N = runner.N;
  const events = [...runner.scenario.events].sort((a, b) => runner.path.eventTicks[a.id] - runner.path.eventTicks[b.id]);
  const bounds: { tick: number; eventId: string | null; headline: string }[] = [{ tick: 0, eventId: null, headline: 'Opening allocation' }];
  for (const e of events) {
    const t = runner.path.eventTicks[e.id];
    if (t > bounds[bounds.length - 1].tick) bounds.push({ tick: t, eventId: e.id, headline: e.headline });
  }
  const step = 4;
  const curve = new Float64Array(N + 1);
  curve[0] = runner.rules.startingCapital;
  const segments: OptimalSegment[] = [];
  for (let s = 0; s < bounds.length; s++) {
    const t0 = bounds[s].tick, t1 = s + 1 < bounds.length ? bounds[s + 1].tick : N;
    const weights = solveSegment(runner, t0, t1, bounds[s].eventId);
    const e0 = curve[t0];
    for (let t = t0 + 1; t <= t1; t++) {
      let g = 0;
      for (const id in weights) g += weights[id] * (runner.price(id, t) / runner.price(id, t0) - 1);
      curve[t] = e0 * (1 + g);
    }
    const optReturn = curve[t1] / e0 - 1;
    const m0 = runner.equityCurve[Math.min(t0, runner.tick)], m1 = runner.equityCurve[Math.min(t1, runner.tick)];
    const myReturn = m0 > 0 ? m1 / m0 - 1 : 0;
    segments.push({ fromTick: t0, toTick: t1, eventId: bounds[s].eventId, headline: bounds[s].headline, weights, optReturn, myReturn, gap: optReturn - myReturn });
  }
  const equity: number[] = [];
  for (let t = 0; t <= N; t++) if (t % step === 0 || t === N) equity.push(Math.round(curve[t]));
  return {
    curveStep: step, equity, finalReturn: curve[N] / curve[0] - 1, segments,
    missed: [...segments].sort((a, b) => b.gap - a.gap).slice(0, 5),
  };
}

export type { Fill };
