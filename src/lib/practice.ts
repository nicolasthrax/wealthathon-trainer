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
