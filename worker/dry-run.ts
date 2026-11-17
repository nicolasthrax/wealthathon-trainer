/**
 * Generate one scenario + one client with Claude and run the validator, without touching the database.
 *   npm run worker:dry -- medium
 */
import { z } from 'zod';
import { EVENT_RULES } from '../config/event-rules';
import { ClientSchema, ScenarioSchema, type Difficulty } from '../packages/engine/src/types';
import { validateScenario } from '../packages/engine/src/validator';
import { SEED_SCENARIOS } from '../seed/scenarios';
import { claudeJson } from './claude';
import { clientPrompt, scenarioPrompt, sentimentPrompt } from './prompts';
import { clientSatisfiable } from './jobs';

(async () => {
  const d = (process.argv[2] as Difficulty) || 'medium';
  console.log(`Generating a ${d} scenario…`);
  const t0 = Date.now();
  const raw = await claudeJson(scenarioPrompt(EVENT_RULES, d, SEED_SCENARIOS.map((s) => s.title)), (x) => x as object);
  const sc = ScenarioSchema.parse({ ...raw, id: 'dry-run', source: 'synthetic', difficulty: d, generator: 'claude' });
  const blind = await claudeJson(sentimentPrompt(sc.events), (x) => z.record(z.string(), z.number()).parse(x));
  const v = validateScenario(sc, EVENT_RULES, { pool: SEED_SCENARIOS, blindSentiment: blind });
  console.log(`"${sc.title}" · ${sc.events.length} events · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const e of sc.events) console.log(`  ${e.t.toFixed(2)} [${e.kind}] ${e.headline}  sent=${e.sentiment} blind=${blind[e.id]}`);
  console.log('valid:', v.ok, '\nerrors:', v.errors, '\nmismatches:', v.mismatches, '\nrepairs:', v.repairs.length, 'similarity:', v.similarity.toFixed(2));
  console.log('\nGenerating a client…');
  const c = await claudeJson(clientPrompt([]), (x) => ClientSchema.parse({ ...(x as object), id: 'dry-client' }));
  console.log(c.name, '·', c.goal, '· risk', c.riskProfile, '·', c.constraints.map((k) => k.type).join(', '), '· satisfiable:', clientSatisfiable(c));
})().catch((e) => { console.error(e); process.exit(1); });
