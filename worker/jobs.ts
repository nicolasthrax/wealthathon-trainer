import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EVENT_RULES } from '../config/event-rules';
import { ClientSchema, ScenarioSchema, type Client, type Difficulty, type Scenario } from '../packages/engine/src/types';
import { validateScenario } from '../packages/engine/src/validator';
import { SessionRunner } from '../packages/engine/src/runner';
import { solveSegment } from '../packages/engine/src/report';
import { evaluateMandate, mandateViolation } from '../packages/engine/src/mandate';
import { SEED_SCENARIOS } from '../seed/scenarios';
import { claudeJson } from './claude';
import { COACH_SYSTEM, JUDGE_SYSTEM, LESSON_WHY_SYSTEM, clientPrompt, coachPrompt, judgeQuestionPrompt, judgeScorePrompt, lessonWhyPrompt, scenarioPrompt, sentimentPrompt } from './prompts';

export interface Job { id: string; user_id: string | null; type: string; payload: Record<string, unknown> }
type Db = SupabaseClient;
const rules = EVENT_RULES;
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ── Scenario generation ─────────────────────────────────────────────────────
export async function generateScenario(db: Db, job: Job) {
  const difficulty = (job.payload.difficulty as Difficulty) ?? 'medium';
  const { data: poolRows } = await db.from('scenarios').select('id,title,json').eq('source', 'synthetic').eq('validated', true);
  const pool = (poolRows ?? []).map((r) => r.json as Scenario);
  let feedback: string | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const raw = await claudeJson(scenarioPrompt(rules, difficulty, pool.map((p) => p.title), feedback), (x) => x as Record<string, unknown>);
    const candidate = { ...raw, id: `ai-${difficulty}-${Date.now().toString(36)}`, source: 'synthetic', difficulty, generator: 'claude' };
    const parsed = ScenarioSchema.safeParse(candidate);
    if (!parsed.success) { feedback = parsed.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'); log(`  attempt ${attempt}: schema`, feedback); continue; }
    // Second, blind pass: classify sentiment from the text alone and compare with the shock directions.
    const blind = await claudeJson(sentimentPrompt(parsed.data.events), (x) => z.record(z.string(), z.number()).parse(x));
    const v = validateScenario(parsed.data, rules, { pool, blindSentiment: blind });
    if (v.ok) {
      const { error } = await db.from('scenarios').insert({ id: v.scenario!.id, title: v.scenario!.title, source: 'synthetic', difficulty, generator: 'claude', json: v.scenario, validated: true,
        validation: { repairs: v.repairs, mismatches: v.mismatches, similarity: v.similarity, attempts: attempt } });
      if (error) throw new Error(error.message);
      log(`  + scenario "${v.scenario!.title}" (${difficulty}, ${v.scenario!.events.length} events, ${v.repairs.length} repairs)`);
      return { scenarioId: v.scenario!.id, title: v.scenario!.title, repairs: v.repairs.length, attempts: attempt };
    }
    feedback = [...v.errors, ...v.mismatches].slice(0, 15).join('\n');
    log(`  attempt ${attempt} rejected:`, feedback.split('\n').slice(0, 4).join(' | '));
  }
  throw new Error(`scenario rejected after 3 attempts: ${feedback?.slice(0, 500)}`);
}

// ── Client generation ───────────────────────────────────────────────────────
export function clientSatisfiable(c: Client): boolean {
  const r = new SessionRunner({ scenario: SEED_SCENARIOS[0], seed: 'check', rules, client: c, difficulty: 'hard' });
  const w = solveSegment(r, 0, 100);
  const cash = 1 - Object.values(w).reduce((a, b) => a + b, 0);
  return mandateViolation(evaluateMandate(r.client, w, cash, rules)) === 0;
}
export async function generateClient(db: Db) {
  const { data } = await db.from('clients').select('json');
  const names = (data ?? []).map((r) => (r.json as Client).name);
  const c = await claudeJson(clientPrompt(names), (x) => {
    const cl = ClientSchema.parse({ ...(x as object), id: `ai-client-${Date.now().toString(36)}` });
    if (!clientSatisfiable(cl)) throw new Error('constraints cannot all be satisfied at once (also under 20% tighter caps); loosen them');
    return cl;
  });
  const { error } = await db.from('clients').insert({ id: c.id, json: c, source: 'claude' });
  if (error) throw new Error(error.message);
  log(`  + client ${c.name}`);
  return { clientId: c.id, name: c.name };
}

// ── Coach ───────────────────────────────────────────────────────────────────
export const CoachSchema = z.object({
  summary: z.string(),
  mistakes: z.array(z.object({ title: z.string(), whatHappened: z.string(), mechanism: z.array(z.string()).min(2), fix: z.string() })).min(1).max(4),
  strengths: z.array(z.object({ title: z.string(), detail: z.string() })).min(1).max(4),
  drill: z.object({ title: z.string(), steps: z.array(z.string()).min(1) }),
});
export async function coach(db: Db, job: Job) {
  const result = await claudeJson(coachPrompt(job.payload), (x) => CoachSchema.parse(x), { system: COACH_SYSTEM });
  const sid = job.payload.sessionId as string | undefined;
  if (sid && job.user_id) await db.from('debriefs').update({ coach: result, updated_at: new Date().toISOString() }).eq('session_id', sid).eq('user_id', job.user_id);
  return result;
}

// ── Transcription (fallback when the browser had no live transcript) ────────
const exec = promisify(execFile);
export async function transcribe(db: Db, audioPath: string): Promise<string | null> {
  const model = process.env.WHISPER_MODEL;
  const bin = process.env.WHISPER_BIN || 'whisper-cli';
  if (!model || !existsSync(model)) { log('  (no WHISPER_MODEL set; skipping transcription)'); return null; }
  const { data, error } = await db.storage.from('pitch-audio').download(audioPath);
  if (error || !data) throw new Error(`audio download failed: ${error?.message}`);
  const dir = mkdtempSync(path.join(tmpdir(), 'wt-'));
  try {
    const src = path.join(dir, 'in' + path.extname(audioPath)), wav = path.join(dir, 'in.wav');
    writeFileSync(src, Buffer.from(await data.arrayBuffer()));
    await exec(process.env.FFMPEG_BIN || 'ffmpeg', ['-y', '-i', src, '-ar', '16000', '-ac', '1', wav]);
    await exec(bin, ['-m', model, '-f', wav, '-otxt', '-of', path.join(dir, 'out'), '-l', 'en'], { maxBuffer: 32 * 1024 * 1024 });
    return readFileSync(path.join(dir, 'out.txt'), 'utf8').trim();
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ── Pitch judge ─────────────────────────────────────────────────────────────
export const ScorecardSchema = z.object({
  overall: z.number().min(0).max(100),
  verdict: z.string(),
  criteria: z.array(z.object({ id: z.string(), label: z.string(), score: z.number().min(0).max(10), justification: z.string(), improvement: z.string() })).min(3),
});
type QA = { q: string; a: string; audio_path?: string | null };
const PENDING = '[transcribing…]';

export async function judge(db: Db, job: Job) {
  const pitchId = job.payload.pitchId as string;
  const { data: p, error } = await db.from('pitches').select('*').eq('id', pitchId).single();
  if (error || !p) throw new Error(`pitch not found: ${error?.message}`);
  if (job.user_id && p.user_id !== job.user_id) throw new Error('pitch belongs to another user');
  let transcript: string = p.transcript ?? '';
  const qa: QA[] = p.qa ?? [];
  if (!transcript && p.audio_path) transcript = (await transcribe(db, p.audio_path)) ?? '';
  for (const x of qa) if ((!x.a || x.a === PENDING) && x.audio_path) x.a = (await transcribe(db, x.audio_path)) ?? '[answer recorded, no transcript]';
  await db.from('pitches').update({ transcript: transcript || null, qa, updated_at: new Date().toISOString() }).eq('id', pitchId);

  const answered = qa.filter((x) => x.a).length;
  const [minQ, maxQ] = rules.pitch.followUps;
  if (qa.length && !qa[qa.length - 1].a) return { action: 'waiting' };
  let action: 'ask' | 'score' = answered < minQ ? 'ask' : answered >= maxQ ? 'score' : 'ask';
  let question = '';
  if (action === 'ask') {
    const r = await claudeJson(judgeQuestionPrompt(p.context, transcript, qa, answered < minQ),
      (x) => z.object({ action: z.enum(['ask', 'score']), question: z.string().optional() }).parse(x), { system: JUDGE_SYSTEM });
    if (r.action === 'score' && answered >= minQ) action = 'score';
    else if (r.question) question = r.question;
    else throw new Error('judge returned no question');
  }
  if (action === 'ask') {
    const next = [...qa, { q: question, a: '' }];
    await db.from('pitches').update({ qa: next, status: 'qa', updated_at: new Date().toISOString() }).eq('id', pitchId);
    log(`  judge Q${next.length}: ${question}`);
    return { action, question };
  }
  await db.from('pitches').update({ status: 'scoring' }).eq('id', pitchId);
  const card = await claudeJson(judgeScorePrompt(p.context, transcript, qa, rules.pitch.criteria), (x) => ScorecardSchema.parse(x), { system: JUDGE_SYSTEM });
  await db.from('pitches').update({ scorecard: card, status: 'scored', updated_at: new Date().toISOString() }).eq('id', pitchId);
  log(`  judge scored ${card.overall}/100`);
  return { action, scorecard: card };
}

// ── Lesson "why" feedback ───────────────────────────────────────────────────
export const LessonWhySchema = z.object({ summary: z.string(), comments: z.record(z.string(), z.string()) });
export async function lessonWhy(db: Db, job: Job) {
  const result = await claudeJson(lessonWhyPrompt(job.payload), (x) => LessonWhySchema.parse(x), { system: LESSON_WHY_SYSTEM });
  const id = job.payload.attemptId as string | undefined;
  if (id && job.user_id) await db.from('lesson_attempts').update({ ai_feedback: result }).eq('id', id).eq('user_id', job.user_id);
  return result;
}

export const HANDLERS: Record<string, (db: Db, job: Job) => Promise<unknown>> = {
  lesson_why: lessonWhy,
  generate_scenario: generateScenario,
  generate_client: (db) => generateClient(db),
  coach,
  judge,
};
/** User-facing jobs run before background pool top-ups. */
export const PRIORITY: Record<string, number> = { judge: 0, coach: 1, lesson_why: 2, generate_client: 5, generate_scenario: 5 };
