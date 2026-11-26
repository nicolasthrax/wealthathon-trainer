import type { EventRules } from '@config/event-rules';

/** Practice is one continuous simulated year, divided into four equal quarters. */
export const PRACTICE_CAPITAL = 20_000_000;
export const QUARTER_SECONDS = 15 * 60;
export const PRACTICE_MINUTES = 4 * QUARTER_SECONDS / 60;

/** Preserve all other user rules and do not mutate the shared configuration. */
export function practiceRules(rules: EventRules): EventRules {
  return { ...rules, startingCapital: PRACTICE_CAPITAL };
}

export function practiceClock(elapsedSeconds: number) {
  const elapsed = Math.max(0, Math.min(elapsedSeconds, QUARTER_SECONDS * 4));
  const quarter = Math.min(4, Math.floor(elapsed / QUARTER_SECONDS) + 1);
  return { quarter, quarterRemaining: Math.max(0, quarter * QUARTER_SECONDS - elapsed), totalRemaining: QUARTER_SECONDS * 4 - elapsed };
}

/** Course-based proxy; individual instruments differ from the course universe. */
export const PROXY_BENCHMARK: Record<string, number> = {
  HSI: 0.125, SPX: 0.125, NKY: 0.125, SX5E: 0.125,
  UST20: 0.15, HKGB: 0.15, GOLD: 0.10, BRENT: 0.10,
};
export type PracticePreset = 'course' | 'legacy';
export function makePracticeRules(rules: EventRules, preset: PracticePreset, shortened = false): EventRules {
  return { ...rules, startingCapital: PRACTICE_CAPITAL, baseCurrency: preset === 'course' ? 'USD' : 'HKD',
    shorting: preset === 'course' ? { ...rules.shorting, allowed: false } : { ...rules.shorting },
    practice: { preset, quarterSeconds: shortened ? 300 : 900, rebalanceSeconds: preset === 'course' ? (shortened ? 300 : 900) : 0 } };
}
/** Convert wall-clock session time to trading time. Rebalancing is between quarters only. */
export function courseClock(elapsed: number, quarterSeconds: number, rebalanceSeconds: number) {
  const total = 4 * quarterSeconds + 3 * rebalanceSeconds;
  const t = Math.max(0, Math.min(elapsed, total));
  if (t >= total) return { quarter: 4, phase: 'finished' as const, remaining: 0, totalRemaining: 0, tradingFraction: 1 };
  const span = quarterSeconds + rebalanceSeconds;
  const index = Math.min(3, Math.floor(t / span));
  const within = t - index * span;
  const rebalancing = index < 3 && within >= quarterSeconds;
  return { quarter: index + 1, phase: rebalancing ? 'rebalance' as const : 'trading' as const,
    remaining: rebalancing ? span - within : quarterSeconds - within,
    totalRemaining: total - t, tradingFraction: (index + Math.min(within / quarterSeconds, 1)) / 4 };
}
/** Buy-and-hold proxy based only on actual price paths; missing components make it unavailable. */
export function proxyBenchmark(prices: Record<string, ArrayLike<number>>, tick: number): number | null {
  let ret = 0;
  for (const [id, weight] of Object.entries(PROXY_BENCHMARK)) {
    const p = prices[id];
    if (!p || !(p[0] > 0) || !Number.isFinite(p[tick])) return null;
    ret += weight * (p[tick] / p[0] - 1);
  }
  return ret;
}
