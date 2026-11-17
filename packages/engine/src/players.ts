import type { SessionRunner } from './runner';
import type { BreachEpisode, ScoreBreakdown } from './types';
import { computeScore, sortinoFrom } from './scoring';
import { buildReport } from './report';

/**
 * Individual stats inside a shared (team) portfolio.
 *
 * Attribution is by trade: every fill belongs to the player who placed it, and its contribution at tick t is
 * signed qty x (price(t) - fill price) - fee. Opening-allocation fills (joint decision) and forced liquidations go to
 * the team bucket (`participantId: null`). Because P&L is linear in fills, the buckets plus financing (interest,
 * borrow fees, money-market carry on cash) add up exactly to the team P&L.
 *
 * Each player's contribution path is treated as a portfolio of (starting capital + contribution) and scored with
 * the same formula as the team: return, Sortino, max drawdown and mandate. A mandate breach episode is charged to
 * the player whose fill started it (a fill on the tick it began or the tick before); breaches caused by market
 * drift are charged to nobody.
 */
export interface PlayerStats {
  participantId: string | null;
  fills: number;
  pnl: number;
  ret: number;
  sortino: number;
  maxDD: number;
  breachesCaused: number;
  penalisedTicks: number;
  score: ScoreBreakdown;
  avgReactionSeconds: number | null;
  reacted: number;
  hits: number;
  misses: number;
  hitRate: number | null;
  turnover: number;
  bestTrade: number | null;
  worstTrade: number | null;
  curveStep: number;
  /** Contribution (HKD) every `curveStep` ticks. */
  curve: number[];
}
export interface PlayerBreakdown { players: PlayerStats[]; financing: number; teamPnl: number }

const bucketOf = (f: { source: string; participantId?: string }) => (f.source === 'user' && f.participantId ? f.participantId : null);

/** Current contribution per bucket (cheap enough to call every tick on the trading screen). */
export function liveContribution(runner: SessionRunner): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of runner.fills) {
    const k = bucketOf(f) ?? 'team';
    out[k] = (out[k] ?? 0) + (f.side === 'buy' ? 1 : -1) * f.qty * (runner.price(f.assetId) - f.price) - f.fee;
  }
  return out;
}

export function buildPlayerStats(runner: SessionRunner, secondsPerTick: number, participantIds: string[]): PlayerBreakdown {
  const N = runner.tick;
  const cap = runner.rules.startingCapital;
  const buckets: (string | null)[] = [...participantIds, null];
  const step = 4;
  // Per bucket: running net qty per asset and running cost, so contribution(t) = sum(Q * P(t)) - K.
  const state = new Map(buckets.map((b) => [b, { q: {} as Record<string, number>, k: 0, curve: [] as number[], n: 0, sumR: 0, sumDown2: 0, peak: cap, maxDD: 0, prev: 0, fills: 0 }]));
  const byTick = new Map<number, typeof runner.fills>();
  for (const f of runner.fills) { const a = byTick.get(f.tick) ?? []; a.push(f); byTick.set(f.tick, a); }
  for (let t = 0; t <= N; t++) {
    for (const f of byTick.get(t) ?? []) {
      const st = state.get(bucketOf(f))!;
      const sq = (f.side === 'buy' ? 1 : -1) * f.qty;
      st.q[f.assetId] = (st.q[f.assetId] ?? 0) + sq;
      st.k += sq * f.price + f.fee;
      st.fills++;
    }
    for (const st of state.values()) {
      let c = st.k === 0 ? 0 : -st.k;
      for (const id in st.q) if (st.q[id]) c += st.q[id] * runner.price(id, t);
      if (t > 0) {
        const r = (c - st.prev) / (cap + st.prev);
        st.n++; st.sumR += r; if (r < 0) st.sumDown2 += r * r;
      }
      st.peak = Math.max(st.peak, cap + c);
      st.maxDD = Math.max(st.maxDD, 1 - (cap + c) / st.peak);
      st.prev = c;
      if (t % step === 0 || t === N) st.curve.push(Math.round(c));
    }
  }
  // Charge each mandate breach episode to the player whose fill started it.
  const charged = new Map<string | null, { episodes: number; penalised: number }>();
  for (const b of runner.breaches as BreachEpisode[]) {
    const trigger = runner.fills.filter((f) => f.tick >= b.startTick - 1 && f.tick <= b.startTick).pop();
    const who = trigger ? bucketOf(trigger) : undefined;
    if (who === undefined) continue;
    const c = charged.get(who) ?? { episodes: 0, penalised: 0 };
    c.episodes++; c.penalised += b.penalisedTicks;
    charged.set(who, c);
  }
  let sum = 0;
  const players: PlayerStats[] = buckets.map((b) => {
    const st = state.get(b)!;
    const pnl = st.prev;
    sum += pnl;
    const ret = pnl / cap;
    const sortino = sortinoFrom(st.n, st.sumR, st.sumDown2, runner.rules);
    const ch = charged.get(b) ?? { episodes: 0, penalised: 0 };
    const rep = b ? buildReport(runner, secondsPerTick, b) : null;
    const trades = rep ? [...rep.best, ...rep.worst].map((x) => x.pnl) : [];
    return {
      participantId: b, fills: st.fills, pnl, ret, sortino, maxDD: st.maxDD, breachesCaused: ch.episodes, penalisedTicks: ch.penalised,
      score: computeScore({ ret, sortino, maxDD: st.maxDD, penalisedFrac: ch.penalised / runner.N }, runner.rules),
      avgReactionSeconds: rep?.avgReactionSeconds ?? null, reacted: rep?.reactedCount ?? 0, hits: rep?.hits ?? 0, misses: rep?.misses ?? 0,
      hitRate: rep?.hitRate ?? null, turnover: rep?.turnover ?? 0,
      bestTrade: trades.length ? Math.max(...trades) : null, worstTrade: trades.length ? Math.min(...trades) : null,
      curveStep: step, curve: st.curve,
    };
  });
  const teamPnl = runner.metrics.equity - cap;
  return { players, financing: teamPnl - sum, teamPnl };
}
