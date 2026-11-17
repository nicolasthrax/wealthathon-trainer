import type { SessionRunner } from '@engine/runner';
import type { OptimalResult, Report } from '@engine/report';
import type { SessionRow } from './store';

/** Compact, self-contained context for the coach job (the worker needs no DB reads). */
export function sessionContext(r: SessionRunner, rep: Report, opt: OptimalResult | null, s: SessionRow) {
  const tk = (id: string) => r.assetById[id]?.ticker ?? id;
  return {
    sessionId: s.id,
    scenario: { title: r.scenario.title, storyline: r.scenario.storyline, regime: r.scenario.regime.name, difficulty: s.difficulty, mode: s.mode },
    client: r.client,
    rules: { startingCapital: s.rules.startingCapital, weights: s.rules.scoring.weights, costs: s.rules.costs.enabled, breachGraceTicks: s.rules.mandate.breachGraceTicks, ticksPerYear: r.N },
    secondsPerTick: (s.session_minutes * 60) / r.N,
    final: rep.final,
    events: rep.events.map((e) => ({ tick: e.tick, headline: r.scenario.events.find((x) => x.id === e.eventId)!.headline, source: e.source, category: e.category, kind: e.kind,
      expected: e.topImpacts.slice(0, 4).map((t) => `${tk(t.assetId)} ${(t.impact * 100).toFixed(1)}%`), reactionSeconds: e.reactionSeconds, firstTrade: e.firstTrade && `${e.firstTrade.side} ${tk(e.firstTrade.assetId)}`, hits: e.hits, misses: e.misses })),
    fills: r.fills.slice(0, 250).map((f) => ({ tick: f.tick, asset: tk(f.assetId), side: f.side, qty: f.qty, price: +f.price.toPrecision(6), source: f.source })),
    summary: { avgReactionSeconds: rep.avgReactionSeconds, hitRate: rep.hitRate, trades: rep.tradeCount, turnover: rep.turnover, breaches: rep.breaches, byClass: rep.byClass,
      best: rep.best.map((t) => `${t.dir} ${tk(t.assetId)} ${Math.round(t.pnl)}`), worst: rep.worst.map((t) => `${t.dir} ${tk(t.assetId)} ${Math.round(t.pnl)}`) },
    allocation: {
      opening: snapshotWeights(r, 0),
      snapshots: r.snapshots.filter((_, i) => i % 10 === 9).map((x) => ({ tick: x.tick, equity: Math.round(x.equity), weights: weightsOf(r, x.positions, x.equity, x.tick) })),
    },
    optimal: opt && { finalReturn: opt.finalReturn, missed: opt.missed.map((m) => ({ headline: m.headline, optReturn: m.optReturn, myReturn: m.myReturn, weights: Object.fromEntries(Object.entries(m.weights).map(([k, v]) => [tk(k), v])) })) },
  };
}

function weightsOf(r: SessionRunner, positions: Record<string, number>, equity: number, tick: number) {
  const out: Record<string, number> = {};
  for (const [id, q] of Object.entries(positions)) out[r.assetById[id]?.ticker ?? id] = +((q * r.price(id, tick)) / equity).toFixed(3);
  return out;
}
function snapshotWeights(r: SessionRunner, tick: number) {
  const pos: Record<string, number> = {};
  for (const f of r.fills) if (f.tick === tick) pos[f.assetId] = (pos[f.assetId] ?? 0) + (f.side === 'buy' ? f.qty : -f.qty);
  return weightsOf(r, pos, r.rules.startingCapital, tick);
}
