/**
 * Fetch daily history for the replay episodes from Yahoo Finance (free, no key), build one scenario JSON
 * per episode in public/seed/history/, and (with --push) upsert them into Supabase `scenarios`.
 *
 *   npm run fetch-history            # refresh the JSON files
 *   npm run fetch-history -- --push  # also upload (needs SUPABASE_SERVICE_ROLE_KEY in .env.local)
 *
 * Tickers come from `historyTicker` on each asset in config/event-rules.ts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EVENT_RULES } from '../config/event-rules';
import { EPISODES } from '../seed/history-episodes';
import type { NewsEvent, Scenario } from '../packages/engine/src/types';
import { validateScenario } from '../packages/engine/src/validator';

const OUT = path.resolve(import.meta.dirname, '../public/seed/history');
const day = (d: string) => Math.floor(Date.parse(d + 'T00:00:00Z') / 1000);

async function yahoo(symbol: string, from: string, to: string): Promise<Map<string, number>> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${day(from) - 7 * 86400}&period2=${day(to) + 86400}&interval=1d&events=div%2Csplit`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (res.ok) {
      const r = (await res.json()).chart?.result?.[0];
      const out = new Map<string, number>();
      const ts: number[] = r?.timestamp ?? [];
      const px: (number | null)[] = r?.indicators?.adjclose?.[0]?.adjclose ?? r?.indicators?.quote?.[0]?.close ?? [];
      const gmt = r?.meta?.gmtoffset ?? 0;
      ts.forEach((t, i) => { const p = px[i]; if (p && p > 0) out.set(new Date((t + gmt) * 1000).toISOString().slice(0, 10), p); });
      return out;
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`Yahoo fetch failed for ${symbol}`);
}

async function build(ep: (typeof EPISODES)[number]): Promise<Scenario> {
  const raw: Record<string, Map<string, number>> = {};
  for (const a of EVENT_RULES.assets) {
    if (!a.historyTicker) continue;
    try { raw[a.id] = await yahoo(a.historyTicker, ep.from, ep.to); } catch (e) { console.warn(`  ! ${a.id}: ${(e as Error).message}`); }
  }
  // Calendar: weekdays in range on which at least half the series traded.
  const counts = new Map<string, number>();
  for (const m of Object.values(raw)) for (const d of m.keys()) if (d >= ep.from && d <= ep.to) counts.set(d, (counts.get(d) ?? 0) + 1);
  const dates = [...counts.entries()].filter(([, c]) => c >= Object.keys(raw).length / 2).map(([d]) => d).sort();
  const series: Record<string, number[]> = {};
  const skipped: string[] = [];
  for (const [id, m] of Object.entries(raw)) {
    const have = dates.filter((d) => m.has(d)).length;
    const prior = [...m.keys()].filter((d) => d <= dates[0]).sort().pop();
    if (have < dates.length * 0.85 || !prior) { skipped.push(id); continue; }
    let last = m.get(prior)!;
    series[id] = dates.map((d) => { last = m.get(d) ?? last; return +last.toPrecision(7); });
  }
  const events: NewsEvent[] = ep.events.map(([date, category, source, magnitude, sentiment, headline, altHeadline, body], i) => {
    const idx = Math.max(0, dates.findIndex((d) => d >= date));
    return { id: `h${i + 1}`, t: +(idx / (dates.length - 1)).toFixed(4), date: dates[idx], headline, altHeadline, body, source, category, magnitude, sentiment, kind: 'normal', factorShocks: {} };
  });
  console.log(`  ${ep.id}: ${dates.length} days, ${Object.keys(series).length} assets${skipped.length ? `, not available: ${skipped.join(', ')}` : ''}`);
  return {
    id: ep.id, title: ep.title, source: 'historical', difficulty: ep.difficulty, generator: 'yahoo-finance',
    storyline: ep.storyline, regime: { ...ep.regime, factorDrift: {}, volMult: 1 }, events,
    historical: { episodeId: ep.id, realTitle: ep.title, disguisedTitle: ep.disguisedTitle, dates, series },
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const scenarios: Scenario[] = [];
  for (const ep of EPISODES) {
    console.log(`Fetching ${ep.title} ...`);
    const sc = await build(ep);
    const v = validateScenario(sc, EVENT_RULES);
    if (!v.ok) throw new Error(`${ep.id} invalid: ${v.errors.join('; ')}`);
    writeFileSync(path.join(OUT, `${ep.id}.json`), JSON.stringify(sc));
    scenarios.push(sc);
  }
  writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(scenarios.map((s) => ({ id: s.id, title: s.title, disguisedTitle: s.historical!.disguisedTitle, difficulty: s.difficulty, events: s.events.length }))));
  if (process.argv.includes('--push')) {
    const { pushScenarios } = await import('./seed-db');
    await pushScenarios(scenarios);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
