/**
 * Smoke-test the coach and judge prompts end to end with Claude on a replayed seed session (no DB).
 *   npx tsx worker/ai-smoke.ts
 */
import { z } from 'zod';
import { EVENT_RULES } from '../config/event-rules';
import { SessionRunner, ordersFromWeights } from '../packages/engine/src/runner';
import { buildReport, computeOptimalPath } from '../packages/engine/src/report';
import { SEED_SCENARIOS } from '../seed/scenarios';
import { SEED_CLIENTS } from '../seed/clients';
import { sessionContext } from '../src/lib/context';
import { claudeJson } from './claude';
import { CoachSchema, ScorecardSchema } from './jobs';
import { COACH_SYSTEM, JUDGE_SYSTEM, coachPrompt, judgeQuestionPrompt, judgeScorePrompt } from './prompts';

(async () => {
  const sc = SEED_SCENARIOS[1], client = SEED_CLIENTS[7];
  const r = new SessionRunner({ scenario: sc, seed: 'smoke', rules: EVENT_RULES, client, difficulty: sc.difficulty });
  for (const o of ordersFromWeights(r, { HSI: 0.25, TENCENT: 0.15, SPX: 0.2, UST2: 0.25 })) r.placeOrder(o);
  while (!r.finished) {
    if (r.tick === r.path.eventTicks.e2 + 30) r.flatten('TENCENT');
    if (r.tick === r.path.eventTicks.e5 + 3) r.placeOrder({ assetId: 'HSCEI', side: 'buy', qty: 8000, type: 'market' });
    r.step();
  }
  const rep = buildReport(r, 1.5), opt = computeOptimalPath(r);
  const session = { id: 'smoke', difficulty: sc.difficulty, mode: 'synthetic', session_minutes: 30, rules: EVENT_RULES } as never;
  const ctx = { kind: 'session', title: sc.title, ...sessionContext(r, rep, opt, session) };
  console.log(`context ${(JSON.stringify(ctx).length / 1024).toFixed(1)} KB, return ${(rep.final.ret * 100).toFixed(1)}%`);
  let t = Date.now();
  const coach = await claudeJson(coachPrompt(ctx), (x) => CoachSchema.parse(x), { system: COACH_SYSTEM });
  console.log(`\nCOACH (${((Date.now() - t) / 1000).toFixed(0)}s): ${coach.summary}`);
  coach.mistakes.forEach((m, i) => console.log(` M${i + 1} ${m.title}\n    ${m.mechanism.join(' → ')}`));
  console.log(` Drill: ${coach.drill.title}`);
  const transcript = 'Mr Fung runs a factory in Dongguan so his income already depends on China. I kept equities under 60% and held short Treasuries for stability. When the tariff news hit I cut Tencent and later bought China ETFs on the stimulus rumour because I believed Beijing would act.';
  t = Date.now();
  const q = await claudeJson(judgeQuestionPrompt(ctx, transcript, [], true), (x) => z.object({ action: z.literal('ask'), question: z.string() }).parse(x), { system: JUDGE_SYSTEM });
  console.log(`\nJUDGE Q1 (${((Date.now() - t) / 1000).toFixed(0)}s): ${q.question}`);
  const qa = [{ q: q.question, a: 'I bought because rumours often come true and the upside was large; I kept the size around 8% of NAV.' }];
  t = Date.now();
  const card = await claudeJson(judgeScorePrompt(ctx, transcript, qa, EVENT_RULES.pitch.criteria), (x) => ScorecardSchema.parse(x), { system: JUDGE_SYSTEM });
  console.log(`\nSCORECARD (${((Date.now() - t) / 1000).toFixed(0)}s): ${card.overall}/100 · ${card.verdict}`);
  card.criteria.forEach((c) => console.log(` ${c.label}: ${c.score}/10`));
})().catch((e) => { console.error(e); process.exit(1); });
