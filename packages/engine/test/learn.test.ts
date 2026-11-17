import { describe, expect, it } from 'vitest';
import { EVENT_RULES } from '@config/event-rules';
import { LESSONS } from '@config/learn/lessons';
import { PLAYBOOKS, PLAYBOOK_BY_ID } from '@config/learn/playbooks';
import { GLOSSARY } from '@config/learn/glossary';
import { SessionRunner, ordersFromWeights } from '../src/runner';
import { validateScenario } from '../src/validator';
import { evaluateMandate } from '../src/mandate';
import {
  captureState, decisionTick, expectedMove, gradeAllocation, gradeDecision, lessonRules, lessonScenario, matchPlaybook, pickVariants,
  type Lesson, type LessonDecision,
} from '../src/learn';
import type { OrderInput } from '../src/types';

const rules = lessonRules(EVENT_RULES);
const DENSITY = /needs \d|ticks apart|fake-out|similar/;
const tk = (id: string) => rules.assets.find((a) => a.id === id)?.ticker ?? id;

/** Model allocation for the briefing lesson (also used to drive the session in tests). */
const MODEL_ALLOC: Record<string, Record<string, number>> = {
  opening: { UST2: 0.15, HKGB: 0.15, IG: 0.1, HSI: 0.12, HSBC: 0.06, SPX: 0.1, HKDMM: 0.2 },
};
/** Model answers that need more than the generic rule. */
const MODEL_WEIGHTS: Record<string, Record<string, number>> = {
  'pressure/d1': { HSI: 0.15, SPX: 0.12, NDX: 0.08, TENCENT: 0.12, AIA: 0.08, UST2: 0.2, HKDMM: 0.2 },
};

function runnerFor(lesson: Lesson, variant: Record<string, number> = {}) {
  const r = new SessionRunner({ scenario: lessonScenario(lesson, variant), seed: 'fixed', rules, client: lesson.client, difficulty: 'easy' });
  const w = lesson.opening === 'briefing' ? MODEL_ALLOC[lesson.id] : lesson.opening;
  for (const o of ordersFromWeights(r, w)) r.placeOrder(o);
  return r;
}
function stepTo(r: SessionRunner, t: number) { while (r.tick < t && !r.finished) r.step(); }

/** Trades a sensible player following the playbook would place. */
function modelOrders(r: SessionRunner, lesson: Lesson, d: LessonDecision, opposite = false): OrderInput[] {
  const key = `${lesson.id}/${d.id}`;
  const e = d.expect;
  const eq = r.equity();
  const mk = (assetId: string, dir: number, frac: number): OrderInput | null => {
    const qty = Math.floor((frac * eq) / r.price(assetId));
    return qty >= 1 ? { assetId, side: dir > 0 ? 'buy' : 'sell', qty, type: 'market' } : null;
  };
  if (MODEL_WEIGHTS[key] && !opposite) {
    const target = MODEL_WEIGHTS[key];
    const { w } = r.weights();
    const out: OrderInput[] = [];
    for (const id of new Set([...Object.keys(w), ...Object.keys(target)])) { const o = mk(id, Math.sign((target[id] ?? 0) - (w[id] ?? 0)), Math.abs((target[id] ?? 0) - (w[id] ?? 0))); if (o) out.push(o); }
    return out.sort((a, b) => (a.side === 'sell' ? -1 : 1) - (b.side === 'sell' ? -1 : 1));
  }
  if (opposite) {
    const wrong = e.avoid?.[0] ?? (e.assets?.[0] ? { ...e.assets[0], dir: -e.assets[0].dir } : null);
    if (wrong) return [mk(wrong.assetId, wrong.dir, 0.15)].filter(Boolean) as OrderInput[];
    return [mk('HSI', 1, 0.15)].filter(Boolean) as OrderInput[];
  }
  if (e.reduce) {
    const ids = rules.assets.filter((a) => e.reduce!.assets?.includes(a.id) || a.cls === e.reduce!.cls).map((a) => a.id);
    return ids.filter((id) => r.qty(id) > 0).map((id) => ({ assetId: id, side: 'sell' as const, qty: Math.ceil(r.qty(id) * Math.min(1, e.reduce!.minFrac + 0.15)), type: 'market' as const }));
  }
  if (e.capAfter) return e.capAfter.assets.filter((id) => r.qty(id) > 0).map((id) => ({ assetId: id, side: 'sell' as const, qty: r.qty(id), type: 'market' as const }));
  if (e.flatOk && (e.sizePctNav?.[1] ?? 0) <= 3 && !e.assets) return [];
  const out: OrderInput[] = [];
  const per = Math.min(0.03, ((e.sizePctNav?.[1] ?? 10) / 100) / 2.2);
  for (const a of e.assets ?? []) {
    if (out.length >= 2) break;
    if (a.dir < 0 && r.qty(a.assetId) <= 0 && r.client.constraints.some((c) => c.type === 'noShort')) continue;
    const o = mk(a.assetId, a.dir, a.dir < 0 && r.qty(a.assetId) > 0 ? Math.min(per, (r.qty(a.assetId) * r.price(a.assetId)) / eq) : per);
    if (o && !r.preview(o).newBreaches.length) out.push(o);
  }
  return out;
}

describe('learn content', () => {
  it('has 10 lessons with unique ids and valid playbook / glossary references', () => {
    expect(LESSONS).toHaveLength(10);
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(10);
    const terms = new Set(Object.keys(GLOSSARY));
    const refs = (s: string) => [...s.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map((m) => m[1]);
    for (const l of LESSONS) {
      for (const p of l.playbooks) expect(PLAYBOOK_BY_ID[p], `${l.id}: playbook ${p}`).toBeTruthy();
      for (const d of l.decisions) expect(PLAYBOOK_BY_ID[d.playbookId], `${l.id}/${d.id}`).toBeTruthy();
      for (const c of l.concept) for (const t of refs(c)) expect(terms.has(t), `${l.id}: glossary ${t}`).toBe(true);
    }
    for (const p of PLAYBOOKS) {
      expect(LESSONS.some((l) => l.id === p.lessonId), `${p.id}: lesson ${p.lessonId}`).toBe(true);
      for (const t of refs([p.why, p.size, p.exit, p.trigger].join(' '))) expect(terms.has(t), `${p.id}: glossary ${t}`).toBe(true);
    }
  });

  for (const lesson of LESSONS) {
    describe(`lesson ${lesson.n}: ${lesson.title}`, () => {
      const variantSets: Record<string, number>[] = [{}];
      const maxV = Math.max(0, ...lesson.events.map((e) => e.variants?.length ?? 0));
      for (let v = 1; v <= maxV; v++) variantSets.push(Object.fromEntries(lesson.events.filter((e) => e.variants?.length).map((e) => [e.id, Math.min(v, e.variants!.length)])));

      it('every variant passes the scenario validator with no repairs', () => {
        for (const vs of variantSets) {
          const res = validateScenario(lessonScenario(lesson, vs), rules);
          const errs = res.errors.filter((e) => !DENSITY.test(e));
          expect(errs, JSON.stringify(vs)).toEqual([]);
          expect(res.repairs, JSON.stringify(vs)).toEqual([]);
          expect(res.mismatches, JSON.stringify(vs)).toEqual([]);
        }
      });

      it('expected directions agree with the engine for every variant', () => {
        for (const vs of variantSets) {
          const sc = lessonScenario(lesson, vs);
          for (const d of lesson.decisions) {
            if (d.at === 'start') continue;
            const event = sc.events.find((e) => e.id === (d.at as { event: string }).event)!;
            expect(event, `${d.id}`).toBeTruthy();
            for (const a of d.expect.assets ?? []) {
              const m = expectedMove(event, a.assetId, rules);
              expect(Math.sign(m), `${d.id} ${a.assetId} (${(m * 100).toFixed(2)}%) ${JSON.stringify(vs)}`).toBe(a.dir);
              expect(Math.abs(m), `${d.id} ${a.assetId} too small ${JSON.stringify(vs)}`).toBeGreaterThan(0.003);
            }
            for (const a of d.expect.avoid ?? []) expect(Math.sign(expectedMove(event, a.assetId, rules)), `${d.id} avoid ${a.assetId}`).not.toBe(a.dir);
          }
        }
      });

      it('opening allocation is mandate-safe (except the inherited-breach lesson)', () => {
        const w = lesson.opening === 'briefing' ? MODEL_ALLOC[lesson.id] : lesson.opening;
        const cash = 1 - Object.values(w).reduce((a, b) => a + b, 0);
        const bad = evaluateMandate(lesson.client, w, cash, rules).filter((c) => !c.ok);
        if (lesson.id === 'pressure') expect(bad.length).toBe(3); else expect(bad.map((c) => c.label)).toEqual([]);
      });

      it('following the playbook scores 100%, the wrong way scores under 50%', () => {
        for (const opposite of [false, true]) {
          const r = runnerFor(lesson);
          if (lesson.allocation && !opposite) {
            const g = gradeAllocation(lesson.allocation, MODEL_ALLOC[lesson.id], lesson.client, rules, `Bonds first to meet the minimum, equity under the cap`, tk);
            expect(g.grade, JSON.stringify(g.checks)).toBe(100);
          }
          for (const d of lesson.decisions) {
            stepTo(r, decisionTick(d, r.path));
            const before = captureState(r);
            for (const o of modelOrders(r, lesson, d, opposite)) r.placeOrder(o);
            const after = captureState(r);
            const g = gradeDecision(d.expect, before, after, { rules, ticker: tk, timeLimitSec: d.timeLimitSec, actionSec: opposite ? null : 3,
              why: opposite ? '' : `Because ${d.whyKeywords[0]} matters here`, whyKeywords: d.whyKeywords });
            if (opposite) expect(g.grade, `${d.id} opposite ${JSON.stringify(g.checks)}`).toBeLessThan(50);
            else expect(g.grade, `${d.id} ${JSON.stringify(g.checks.filter((c) => !c.pass))}`).toBe(100);
          }
        }
      });
    });
  }
});

describe('learn engine', () => {
  it('first attempt uses the fixed script; retries pick variants, denials follow their rumour', () => {
    const l = LESSONS.find((x) => x.id === 'rumours')!;
    expect(pickVariants(l, 1, 'abc')).toEqual({});
    let changed = false;
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const v = pickVariants(l, 2, seed);
      expect(v.u2).toBe(v.u1);
      if (Object.values(v).some((x) => x > 0)) changed = true;
    }
    expect(changed).toBe(true);
  });

  it('matches headlines to playbooks (rumours first, then the dominant driver)', () => {
    const m = (ev: Parameters<typeof matchPlaybook>[0]) => matchPlaybook(ev, rules, PLAYBOOKS)?.id;
    expect(m({ source: 'rumour', kind: 'fakeout', factorShocks: { CNHK: 0.02 } })).toBe('rumour-fade');
    expect(m({ source: 'wire', kind: 'denial', factorShocks: { CNHK: -0.02 } })).toBe('rumour-fade');
    expect(m({ source: 'central_bank', kind: 'normal', factorShocks: { RATES: 0.0025, USD: 0.008, GEQ: -0.01 } })).toBe('hawkish-surprise');
    expect(m({ source: 'wire', kind: 'normal', factorShocks: { RATES: -0.002, GEQ: 0.01 } })).toBe('dovish-surprise');
    expect(m({ source: 'wire', kind: 'normal', factorShocks: { CNHK: 0.04, GEQ: 0.005 } })).toBe('china-stimulus');
    expect(m({ source: 'wire', kind: 'normal', factorShocks: { RISKOFF: 0.04, GEQ: -0.02 } })).toBe('risk-off');
    expect(m({ source: 'wire', kind: 'normal', factorShocks: { CMDTY: 0.05 } })).toBe('oil-supply-shock');
    expect(m({ source: 'wire', kind: 'normal', factorShocks: { CREDIT: 0.004, RISKOFF: 0.01 } })).toBe('credit-stress');
    expect(m({ source: 'wire', kind: 'normal', factorShocks: { GEQ: 0.001 } })).toBeUndefined();
  });

  it('grades a flat answer as correct only where flat is allowed', () => {
    const l = LESSONS.find((x) => x.id === 'drivers')!;
    const r = runnerFor(l);
    const d = l.decisions[0];
    stepTo(r, decisionTick(d, r.path));
    const s = captureState(r);
    const g = gradeDecision(d.expect, s, s, { rules, ticker: tk, why: 'rates up', whyKeywords: d.whyKeywords });
    expect(g.checks.find((c) => c.id === 'assets')!.pass).toBe(false);
    const flat = LESSONS[0].decisions[0];
    const g2 = gradeDecision(flat.expect, s, s, { rules, ticker: tk, why: 'just noise, nothing to do', whyKeywords: flat.whyKeywords });
    expect(g2.grade).toBe(100);
  });
});
