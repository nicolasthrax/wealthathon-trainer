import { ScenarioSchema, type Scenario, type EventRules, type NewsEvent } from './types';
import { eventTick, expectedImpact } from './path';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  /** Automatic fixes that were applied (shock clamps, re-sorting, id fixes). */
  repairs: string[];
  /** Events whose shock direction disagrees with a sentiment label. */
  mismatches: string[];
  scenario: Scenario | null;
  similarity: number;
}
export interface ValidateOpts {
  /** Existing pool scenarios, for the near-duplicate check. */
  pool?: Pick<Scenario, 'id' | 'title' | 'events'>[];
  /** Blind sentiment per event id from a second, independent pass (-1 / 0 / +1). */
  blindSentiment?: Record<string, number>;
  maxSimilarity?: number;
}

const STOP = new Set('the a an and or of to in on for with from by at as is are was be its it this that after amid over into than more most says said will new report reports data'.split(' '));
export function keywords(s: Pick<Scenario, 'title' | 'events'>): Set<string> {
  const text = [s.title, ...s.events.map((e) => e.headline)].join(' ').toLowerCase();
  return new Set(text.split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w)));
}
export function similarity(a: Pick<Scenario, 'title' | 'events'>, b: Pick<Scenario, 'title' | 'events'>): number {
  const A = keywords(a), B = keywords(b);
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(1, A.size + B.size - inter);
}

/** Mean expected move across equity assets: the scenario's own "risk sentiment" for an event. */
export function equityImpact(ev: Pick<NewsEvent, 'factorShocks' | 'assetShocks'>, rules: EventRules): number {
  const imp = expectedImpact(ev, rules);
  const eq = rules.assets.filter((a) => a.cls === 'equity');
  return eq.reduce((s, a) => s + imp[a.id], 0) / Math.max(1, eq.length);
}

/**
 * Code-only validator for scenarios (synthetic ones in particular). Repairs what can be repaired safely
 * (ordering, ids, oversized shocks within reason) and rejects the rest.
 */
export function validateScenario(raw: unknown, rules: EventRules, opts: ValidateOpts = {}): ValidationResult {
  const res: ValidationResult = { ok: false, errors: [], repairs: [], mismatches: [], scenario: null, similarity: 0 };
  const parsed = ScenarioSchema.safeParse(raw);
  if (!parsed.success) {
    res.errors = parsed.error.issues.slice(0, 12).map((i) => `schema: ${i.path.join('.')} ${i.message}`);
    return res;
  }
  const sc: Scenario = structuredClone(parsed.data);
  const v = rules.validation;
  const N = rules.clock.totalTicks;
  const factorIds = new Set(rules.factors.map((f) => f.id));
  const assetIds = new Set(rules.assets.map((a) => a.id));
  const historical = sc.source === 'historical';

  // Ids unique, events sorted by time.
  const seen = new Set<string>();
  sc.events.forEach((e, i) => { if (seen.has(e.id)) { const old = e.id; e.id = `${e.id}_${i}`; res.repairs.push(`duplicate id ${old} renamed`); } seen.add(e.id); });
  const sortedCopy = [...sc.events].sort((a, b) => a.t - b.t);
  if (sortedCopy.some((e, i) => e !== sc.events[i])) { sc.events = sortedCopy; res.repairs.push('events re-sorted by time'); }

  for (const e of sc.events) {
    if (e.t < v.eventWindow[0] || e.t > v.eventWindow[1]) {
      if (historical) continue;
      res.errors.push(`${e.id}: time ${e.t} outside ${v.eventWindow.join('-')}`);
    }
    for (const f of Object.keys(e.factorShocks)) if (!factorIds.has(f)) { delete e.factorShocks[f]; res.repairs.push(`${e.id}: unknown factor ${f} dropped`); }
    for (const a of Object.keys(e.assetShocks ?? {})) if (!assetIds.has(a)) { delete e.assetShocks![a]; res.repairs.push(`${e.id}: unknown asset ${a} dropped`); }
    if (historical) continue;

    // Plausibility: per-factor caps, then the implied move of every asset.
    for (const f of rules.factors) {
      const s = e.factorShocks[f.id];
      if (s === undefined) continue;
      const cap = f.maxShock[e.magnitude];
      if (Math.abs(s) > cap * v.rejectAboveMultiple) res.errors.push(`${e.id}: ${f.id} shock ${s} implausible for a ${e.magnitude} headline (cap ${cap})`);
      else if (Math.abs(s) > cap) { e.factorShocks[f.id] = Math.sign(s) * cap; res.repairs.push(`${e.id}: ${f.id} shock clamped to ${cap}`); }
    }
    const moveCap = v.maxAssetMove[e.magnitude];
    for (const [a, s] of Object.entries(e.assetShocks ?? {})) {
      if (Math.abs(s) > moveCap * v.rejectAboveMultiple) res.errors.push(`${e.id}: ${a} shock ${s} implausible for a ${e.magnitude} headline`);
      else if (Math.abs(s) > moveCap) { e.assetShocks![a] = Math.sign(s) * moveCap; res.repairs.push(`${e.id}: ${a} shock clamped`); }
    }
    const imp = expectedImpact(e, rules);
    const worst = Math.max(...Object.values(imp).map(Math.abs));
    if (worst > moveCap * v.rejectAboveMultiple) res.errors.push(`${e.id}: implies a ${(worst * 100).toFixed(1)}% move from a ${e.magnitude} headline`);
    else if (worst > moveCap) {
      const k = moveCap / worst;
      for (const f in e.factorShocks) e.factorShocks[f] *= k;
      for (const a in e.assetShocks ?? {}) e.assetShocks![a] *= k;
      res.repairs.push(`${e.id}: shocks scaled by ${k.toFixed(2)} to keep the largest move under ${(moveCap * 100).toFixed(0)}%`);
    }
    if (worst < 1e-5) res.errors.push(`${e.id}: has no market impact`);

    // Direction vs sentiment (author's label, and the blind second pass if supplied).
    const eq = equityImpact(e, rules);
    if (Math.abs(eq) >= v.sentimentMinMove && e.kind !== 'conflicting') {
      const blind = opts.blindSentiment?.[e.id];
      if (e.sentiment !== 0 && Math.sign(eq) !== e.sentiment) res.mismatches.push(`${e.id}: labelled ${e.sentiment > 0 ? 'bullish' : 'bearish'} but shocks move equities ${(eq * 100).toFixed(2)}%`);
      else if (blind !== undefined && blind !== 0 && Math.sign(eq) !== Math.sign(blind)) res.mismatches.push(`${e.id}: blind read is ${blind > 0 ? 'bullish' : 'bearish'} but shocks move equities ${(eq * 100).toFixed(2)}%`);
    }
    if (e.kind === 'denial') {
      const src = sc.events.find((x) => x.id === e.linkedTo);
      if (!src || src.kind !== 'fakeout' || src.t >= e.t) res.errors.push(`${e.id}: denial must link to an earlier fakeout event`);
    }
  }

  if (!historical) {
    const maxMis = Math.floor(sc.events.length * v.maxSentimentMismatchFrac);
    if (res.mismatches.length > maxMis) res.errors.push(`${res.mismatches.length} events contradict their sentiment (max ${maxMis})`);

    // Density must match the difficulty.
    const d = rules.difficulty[sc.difficulty];
    const count = (k: string) => sc.events.filter((e) => e.kind === k).length;
    const inRange = (n: number, [lo, hi]: [number, number]) => n >= lo && n <= hi;
    if (!inRange(sc.events.length, d.events)) res.errors.push(`${sc.events.length} events; ${sc.difficulty} needs ${d.events.join('-')}`);
    if (!inRange(count('fakeout'), d.fakeouts)) res.errors.push(`${count('fakeout')} fake-outs; ${sc.difficulty} needs ${d.fakeouts.join('-')}`);
    if (!inRange(count('conflicting'), d.conflicting)) res.errors.push(`${count('conflicting')} conflicting signals; ${sc.difficulty} needs ${d.conflicting.join('-')}`);
    if (count('fakeout') !== count('denial')) res.errors.push('every fake-out needs exactly one denial');
    const ticks = sc.events.map((e) => eventTick(e.t, N));
    for (let i = 1; i < ticks.length; i++) if (ticks[i] - ticks[i - 1] < d.minEventGapTicks) { res.errors.push(`events ${sc.events[i - 1].id} and ${sc.events[i].id} are only ${ticks[i] - ticks[i - 1]} ticks apart (min ${d.minEventGapTicks})`); break; }
    for (const f of Object.keys(sc.regime.factorDrift)) if (!factorIds.has(f)) { delete sc.regime.factorDrift[f]; res.repairs.push(`regime: unknown factor ${f} dropped`); }
    for (const [f, dr] of Object.entries(sc.regime.factorDrift)) {
      const vol = rules.factors.find((x) => x.id === f)!.vol;
      if (Math.abs(dr) > vol * 2) { sc.regime.factorDrift[f] = Math.sign(dr) * vol * 2; res.repairs.push(`regime drift for ${f} clamped`); }
    }

    // Near-duplicate of something already in the pool?
    for (const p of opts.pool ?? []) if (p.id !== sc.id) res.similarity = Math.max(res.similarity, similarity(sc, p));
    const maxSim = opts.maxSimilarity ?? v.maxSimilarity;
    if (res.similarity > maxSim) res.errors.push(`too similar to an existing pool scenario (${res.similarity.toFixed(2)} > ${maxSim})`);
  } else if (!sc.historical) res.errors.push('historical scenario has no price data');

  res.ok = res.errors.length === 0;
  res.scenario = res.ok ? sc : null;
  return res;
}
