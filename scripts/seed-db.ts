/**
 * Seed Supabase with the hand-written scenarios, procedural pool fillers, historical episodes and clients.
 *   npm run seed            (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local)
 * Safe to re-run: rows are upserted by id.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { Scenario } from '../packages/engine/src/types';
import { seedPool } from '../seed/pool';
import { SEED_CLIENTS } from '../seed/clients';

export function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    const p = path.resolve(import.meta.dirname, '..', f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
export function admin() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  return createClient(url, key, { auth: { persistSession: false } });
}
export const scenarioRow = (s: Scenario, report: unknown = null) => ({
  id: s.id, title: s.title, source: s.source, difficulty: s.difficulty, generator: s.generator ?? null, json: s, validated: true, validation: report,
});
export async function pushScenarios(list: Scenario[]) {
  const db = admin();
  for (const s of list) {
    const { error } = await db.from('scenarios').upsert(scenarioRow(s), { onConflict: 'id' });
    if (error) throw new Error(`${s.id}: ${error.message}`);
  }
  console.log(`Upserted ${list.length} scenarios`);
}

async function main() {
  const db = admin();
  const pool = seedPool();
  const dir = path.resolve(import.meta.dirname, '../public/seed/history');
  const hist: Scenario[] = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith('hist-')).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'))) : [];
  await pushScenarios([...pool, ...hist]);
  const { error } = await db.from('clients').upsert(SEED_CLIENTS.map((c) => ({ id: c.id, json: c, source: 'seed' })), { onConflict: 'id' });
  if (error) throw error;
  console.log(`Upserted ${SEED_CLIENTS.length} clients`);
}
if (process.argv[1]?.endsWith('seed-db.ts')) main().catch((e) => { console.error(e); process.exit(1); });
