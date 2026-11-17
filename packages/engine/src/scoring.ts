import type { EventRules, ScoreBreakdown } from './types';

const lin = (x: number, zero: number, full: number) => Math.max(0, Math.min(100, ((x - zero) / (full - zero)) * 100));

export interface ScoreInputs { ret: number; sortino: number; maxDD: number; penalisedFrac: number }

export function normaliseWeights(w: EventRules['scoring']['weights']) {
  const s = w.return + w.sortino + w.drawdown + w.mandate || 1;
  return { return: w.return / s, sortino: w.sortino / s, drawdown: w.drawdown / s, mandate: w.mandate / s };
}

export function computeScore(i: ScoreInputs, rules: EventRules): ScoreBreakdown {
  const s = rules.scoring;
  const ret = lin(i.ret, s.returnBounds.zero, s.returnBounds.full);
  const sortino = lin(i.sortino, s.sortinoBounds.zero, s.sortinoBounds.full);
  const drawdown = lin(i.maxDD, s.drawdownZeroAt, 0);
  const mandate = Math.max(0, 100 * (1 - rules.mandate.penaltyMultiplier * i.penalisedFrac));
  const w = normaliseWeights(s.weights);
  const composite = w.return * ret + w.sortino * sortino + w.drawdown * drawdown + w.mandate * mandate;
  return { return: ret, sortino, drawdown, mandate, composite };
}

/** Annualised Sortino (MAR = 0) from running sums of per-tick returns; one session = one year. */
export function sortinoFrom(n: number, sumR: number, sumDown2: number, rules: EventRules): number {
  if (n < rules.scoring.minTicksForSortino) return 0;
  const mean = sumR / n;
  const dd = Math.sqrt(sumDown2 / n);
  if (dd < 1e-12) return mean > 1e-12 ? rules.scoring.sortinoBounds.full : 0;
  return (mean / dd) * Math.sqrt(rules.clock.totalTicks);
}
