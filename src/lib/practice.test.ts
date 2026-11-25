import { describe, expect, it } from 'vitest';
import { EVENT_RULES } from '@config/event-rules';
import { practiceClock, practiceRules, PRACTICE_MINUTES } from './practice';

describe('practice format', () => {
  it('sets the practice capital without mutating the source rules', () => {
    const rules = practiceRules(EVENT_RULES);
    expect(rules.startingCapital).toBe(20_000_000);
    expect(EVENT_RULES.startingCapital).toBe(10_000_000);
    expect(rules.costs).toEqual(EVENT_RULES.costs);
    expect(PRACTICE_MINUTES).toBe(60);
  });
  it('switches at each 15 minute boundary and stops at quarter four', () => {
    expect(practiceClock(0)).toEqual({ quarter: 1, quarterRemaining: 900, totalRemaining: 3600 });
    expect(practiceClock(899)).toEqual({ quarter: 1, quarterRemaining: 1, totalRemaining: 2701 });
    expect(practiceClock(900)).toEqual({ quarter: 2, quarterRemaining: 900, totalRemaining: 2700 });
    expect(practiceClock(1800).quarter).toBe(3);
    expect(practiceClock(2700).quarter).toBe(4);
    expect(practiceClock(3600)).toEqual({ quarter: 4, quarterRemaining: 0, totalRemaining: 0 });
    expect(practiceClock(4000).quarter).toBe(4);
  });
});
