import { EVENT_RULES } from '@config/event-rules';
import type { Scenario } from '@engine/types';
import { validateScenario } from '@engine/validator';
import { proceduralScenario } from '@engine/procedural';
import { SEED_SCENARIOS } from './scenarios';

/** Hand-written scenarios + enough validated procedural ones to reach the configured pool size. */
export function seedPool(rules = EVENT_RULES): Scenario[] {
  const pool: Scenario[] = [...SEED_SCENARIOS];
  const order = ['medium', 'hard', 'easy', 'medium', 'hard', 'medium', 'easy'] as const;
  for (let i = 0; pool.length < rules.pool.minSize && i < 200; i++) {
    const sc = proceduralScenario(`p${(i + 11).toString(36)}${(i * 7919 + 1297).toString(36)}`, order[i % order.length], rules);
    if (validateScenario(sc, rules, { pool, maxSimilarity: 0.8 }).ok) pool.push(sc);
  }
  return pool;
}
