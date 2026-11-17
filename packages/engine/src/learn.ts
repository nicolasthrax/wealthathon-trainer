import type { AssetClass, Client, EventRules, MandateCheck, NewsEvent, Scenario } from './types';
import { evaluateMandate } from './mandate';
import { expectedImpact, makeRng, type PricePath } from './path';
import type { SessionRunner } from './runner';

// ── Lesson content types (authored in config/learn) ─────────────────────────
export type Dir = 1 | -1;

/** A playbook: a named, reusable reaction to one kind of situation. */
export interface Playbook {
  id: string;
  name: string;
  /** Plain-English description of the situation that triggers it. */
  trigger: string;
  kind: 'news' | 'process';
  /** News playbooks: dominant factor + direction that identifies the headline type. */
  match?: { factor: string; sign: Dir }[];
  /** Matches rumours / denials (source = rumour, kind = fakeout | denial). */
  matchRumour?: boolean;
  /** Usual key moves (asset id, direction, 1 = some, 2 = strong). */
  moves: { assetId: string; dir: Dir; strength: 1 | 2 }[];
  why: string;
  size: string;
  exit: string;
  risks: string[];
  lessonId: string;
}

/** A lesson news event: a normal engine event, plus alternate wordings/shocks used on retries. */
export type LessonEvent = NewsEvent & {
  variants?: (Pick<NewsEvent, 'headline' | 'body' | 'factorShocks'> & Partial<Pick<NewsEvent, 'assetShocks' | 'magnitude' | 'source' | 'category' | 'sentiment'>>)[];
};

export interface DecisionExpect {
  /** Trades in the playbook's direction. At least `minHits` of them must be traded (default 1). */
  assets?: { assetId: string; dir: Dir }[];
  minHits?: number;
  /** Wrong-way trades. */
  avoid?: { assetId: string; dir: Dir }[];
  /** Acceptable gross size traded in this decision, as % of NAV (e.g. [1, 10]). */
  sizePctNav?: [number, number];
  /** Doing nothing is an acceptable answer. */
  flatOk?: boolean;
  /** All mandate checks must be OK after the decision (otherwise: just no NEW breach). */
  mandateOkAfter?: boolean;
  /** Exposure (net weight) in these assets or this class must shrink by at least this fraction. */
  reduce?: { assets?: string[]; cls?: AssetClass; minFrac: number };
  /** Net weight in these assets must be at most this (fraction of NAV) after the decision. */
  capAfter?: { assets: string[]; max: number };
}

export interface LessonDecision {
  id: string;
  /** 'start' = before the first tick; otherwise pause the moment this event's headline lands. */
  at: 'start' | { event: string };
  prompt: string;
  playbookId: string;
  expect: DecisionExpect;
  timeLimitSec?: number;
  whyKeywords: string[];
  /** Shown on the results screen: the reasoning a good answer follows. */
  explain: string;
}

export interface AllocationExpect { investedRange: [number, number]; maxPosition: number; minPositions: number; whyKeywords: string[]; explain: string; prompt: string }

export interface Lesson {
  id: string;
  n: number;
  title: string;
  summary: string;
  minutes: number;
  /** Concept card: short paragraphs (supports [[term]] glossary markup). */
  concept: string[];
  example?: { title: string; rows: [string, string][] };
  playbooks: string[];
  takeaways: string[];
  client: Client;
  /** Starting weights, or 'briefing' when choosing the opening allocation IS the lesson. */
  opening: Record<string, number> | 'briefing';
  allocation?: AllocationExpect;
  regime: Scenario['regime'];
  storyline: string;
  events: LessonEvent[];
  decisions: LessonDecision[];
  /** Real minutes of play for the simulated quarter. */
  sessionMinutes: number;
}

// ── Lesson rules & scenario ────────────────────────────────────────────────
/** Lessons simulate one quarter (~63 trading days) in fewer ticks, on Easy reaction speed. */
export function lessonRules(base: EventRules): EventRules {
  const r = structuredClone(base);
  r.clock.totalTicks = 360;
  r.clock.tradingDaysPerYear = 63;
  r.clock.briefingSeconds = 600;
  return r;
}

/** Which variant of each event to use: attempt 1 is the fixed, hand-checked script. */
export function pickVariants(lesson: Lesson, attempt: number, seed: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (attempt <= 1) return out;
  const rng = makeRng(`variants|${lesson.id}|${seed}`);
  for (const e of lesson.events) {
    if (!e.variants?.length) continue;
    // A denial reuses its rumour's wording so the pair stays consistent.
    const linked = e.linkedTo ? out[e.linkedTo] : undefined;
    out[e.id] = linked ? Math.min(linked, e.variants.length) : rng.int(1, e.variants.length);
  }
  return out;
}

export function lessonScenario(lesson: Lesson, variants: Record<string, number> = {}): Scenario {
  const events: NewsEvent[] = lesson.events.map(({ variants: alts, ...e }) => {
    const v = variants[e.id] ? alts?.[variants[e.id] - 1] : undefined;
    return v ? { ...e, ...v, assetShocks: v.assetShocks ?? (v.factorShocks ? undefined : e.assetShocks) } : e;
  });
  return { id: `lesson-${lesson.id}`, title: lesson.title, source: 'synthetic', difficulty: 'easy', storyline: lesson.storyline, regime: lesson.regime, events, generator: 'lesson' };
}

export function decisionTick(d: LessonDecision, path: PricePath): number {
  return d.at === 'start' ? 0 : path.eventTicks[d.at.event];
}

// ── Portfolio snapshots ─────────────────────────────────────────────────────
export interface PortfolioState { tick: number; equity: number; qty: Record<string, number>; px: Record<string, number>; weights: Record<string, number>; checks: MandateCheck[] }

export function captureState(r: SessionRunner): PortfolioState {
  const qty: Record<string, number> = {}, px: Record<string, number> = {};
  for (const id of r.path.assets) { px[id] = r.price(id); if (r.qty(id)) qty[id] = r.qty(id); }
  const { w, cashW } = r.weights();
  return { tick: r.tick, equity: r.equity(), qty, px, weights: w, checks: evaluateMandate(r.client, w, cashW, r.rules) };
}

export interface TradeDelta { assetId: string; dq: number; deltaPct: number }
const NOISE = 0.002; // trades under 0.2% of NAV are ignored

export function tradeDeltas(before: PortfolioState, after: PortfolioState): TradeDelta[] {
  const ids = new Set([...Object.keys(before.qty), ...Object.keys(after.qty)]);
  const out: TradeDelta[] = [];
  for (const id of ids) {
    const dq = (after.qty[id] ?? 0) - (before.qty[id] ?? 0);
    if (!dq || !(before.equity > 0)) continue;
    const deltaPct = (dq * (before.px[id] ?? after.px[id] ?? 0)) / before.equity;
    if (Math.abs(deltaPct) >= NOISE / 4) out.push({ assetId: id, dq, deltaPct });
  }
  return out.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
}

function exposure(s: PortfolioState, sel: { assets?: string[]; cls?: AssetClass }, rules: EventRules): number {
  let e = 0;
  for (const a of rules.assets) if ((sel.assets?.includes(a.id)) || (sel.cls && a.cls === sel.cls)) e += s.weights[a.id] ?? 0;
  return e;
}

// ── Grading (process first) ─────────────────────────────────────────────────
export interface Check { id: string; label: string; pass: boolean; detail: string }
export interface DecisionGrade { checks: Check[]; grade: number; trades: TradeDelta[] }

export function whyCheck(why: string, keywords: string[]): Check {
  const t = why.trim().toLowerCase();
  const hit = keywords.find((k) => t.includes(k.toLowerCase()));
  const pass = t.length >= 10 && !!hit;
  return { id: 'why', label: 'Explained why', pass,
    detail: !t ? 'No explanation written.' : t.length < 10 ? 'Too short to explain anything.' : hit ? `Names the driver ("${hit}").` : `Doesn't name the driver. Try mentioning: ${keywords.slice(0, 4).join(', ')}.` };
}

const pctTxt = (x: number) => `${(x * 100).toFixed(1)}%`;

export function gradeDecision(expect: DecisionExpect, before: PortfolioState, after: PortfolioState, ctx: {
  rules: EventRules; ticker: (id: string) => string; timeLimitSec?: number; actionSec?: number | null; why: string; whyKeywords: string[];
}): DecisionGrade {
  const trades = tradeDeltas(before, after);
  const real = trades.filter((t) => Math.abs(t.deltaPct) >= NOISE);
  const d = (id: string) => real.find((t) => t.assetId === id)?.deltaPct ?? 0;
  const flat = real.length === 0;
  const checks: Check[] = [];
  const tk = ctx.ticker;

  if (expect.assets || expect.avoid) {
    const wrong = [
      ...(expect.avoid ?? []).filter((x) => Math.sign(d(x.assetId)) === x.dir),
      ...(expect.assets ?? []).filter((x) => Math.sign(d(x.assetId)) === -x.dir).map((x) => ({ assetId: x.assetId, dir: -x.dir as Dir })),
    ];
    checks.push({ id: 'direction', label: 'Right direction', pass: wrong.length === 0,
      detail: wrong.length ? `Wrong way: ${wrong.map((x) => `${x.dir > 0 ? 'bought' : 'sold'} ${tk(x.assetId)}`).join(', ')}.` : flat ? 'No wrong-way trades (you stayed flat).' : 'No wrong-way trades.' });
  }
  if (expect.assets) {
    const hits = expect.assets.filter((x) => Math.sign(d(x.assetId)) === x.dir);
    const need = expect.minHits ?? 1;
    const pass = hits.length >= need || (!!expect.flatOk && flat);
    checks.push({ id: 'assets', label: 'Right assets', pass,
      detail: hits.length ? `Traded ${hits.map((x) => `${x.dir > 0 ? 'buy' : 'sell'} ${tk(x.assetId)}`).join(', ')}.`
        : expect.flatOk && flat ? 'Staying flat was acceptable here.' : `None of the playbook trades: ${expect.assets.slice(0, 4).map((x) => `${x.dir > 0 ? 'buy' : 'sell'} ${tk(x.assetId)}`).join(', ')}.` });
  }
  if (expect.sizePctNav) {
    const gross = real.reduce((s, t) => s + Math.abs(t.deltaPct), 0) * 100;
    const [lo, hi] = expect.sizePctNav;
    const pass = (gross >= lo && gross <= hi) || (!!expect.flatOk && flat);
    checks.push({ id: 'size', label: 'Sensible size', pass,
      detail: `Traded ${gross.toFixed(1)}% of NAV in total; the playbook range is ${lo}-${hi}%.${gross > hi ? ' Too big for one headline.' : gross < lo && !flat ? ' Too small to matter.' : ''}` });
  }
  {
    const broken = after.checks.filter((c, i) => !c.ok && (expect.mandateOkAfter || before.checks[i]?.ok));
    checks.push({ id: 'mandate', label: expect.mandateOkAfter ? 'Mandate fixed' : 'No new breach', pass: broken.length === 0,
      detail: broken.length ? `${expect.mandateOkAfter ? 'Still breached' : 'New breach'}: ${broken.map((c) => c.label).join(', ')}.` : expect.mandateOkAfter ? 'Every client limit is OK.' : 'No new mandate breach.' });
  }
  if (expect.reduce) {
    const b = exposure(before, expect.reduce, ctx.rules), a = exposure(after, expect.reduce, ctx.rules);
    const what = expect.reduce.cls ?? expect.reduce.assets!.map(tk).join('/');
    const pass = b <= 0.005 || a <= b * (1 - expect.reduce.minFrac) + 1e-9;
    checks.push({ id: 'reduce', label: 'Cut the risk', pass,
      detail: b <= 0.005 ? `You held no ${what} to cut.` : `${what} exposure ${pctTxt(b)} → ${pctTxt(a)} (needed at least a ${Math.round(expect.reduce.minFrac * 100)}% cut).` });
  }
  if (expect.capAfter) {
    const a = exposure(after, { assets: expect.capAfter.assets }, ctx.rules);
    checks.push({ id: 'cap', label: 'Not caught holding it', pass: a <= expect.capAfter.max + 1e-9,
      detail: `${expect.capAfter.assets.map(tk).join('/')} now ${pctTxt(a)} of NAV (max ${pctTxt(expect.capAfter.max)}).` });
  }
  if (ctx.timeLimitSec) {
    const s = ctx.actionSec;
    const pass = s != null && s <= ctx.timeLimitSec / 2;
    checks.push({ id: 'speed', label: 'Fast enough', pass, detail: s == null ? 'Ran out of time.' : `Acted after ${s.toFixed(0)}s (target: within ${Math.round(ctx.timeLimitSec / 2)}s).` });
  }
  checks.push(whyCheck(ctx.why, ctx.whyKeywords));
  const grade = Math.round((100 * checks.filter((c) => c.pass).length) / checks.length);
  return { checks, grade, trades };
}

export function gradeAllocation(expect: AllocationExpect, weights: Record<string, number>, client: Client, rules: EventRules, why: string, ticker: (id: string) => string): DecisionGrade {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  // "Invested" = outside cash and money-market funds (those are the dry powder).
  const invested = rules.assets.filter((a) => a.cls !== 'cash').reduce((s, a) => s + (weights[a.id] ?? 0), 0);
  const checks: Check[] = [];
  const mc = evaluateMandate(client, weights, 1 - total, rules);
  const bad = mc.filter((c) => !c.ok);
  checks.push({ id: 'mandate', label: 'Mandate-safe', pass: !bad.length, detail: bad.length ? `Breaches: ${bad.map((c) => c.label).join(', ')}.` : 'Every client limit is OK from day one.' });
  const [lo, hi] = expect.investedRange;
  checks.push({ id: 'invested', label: 'Cash buffer', pass: invested >= lo - 1e-9 && invested <= hi + 1e-9,
    detail: `${pctTxt(invested)} invested outside cash and the money-market fund; aim for ${pctTxt(lo)}-${pctTxt(hi)} so you keep dry powder for the news.` });
  const big = Object.entries(weights).filter(([, w]) => Math.abs(w) > expect.maxPosition + 1e-9);
  checks.push({ id: 'concentration', label: 'No giant bet', pass: !big.length,
    detail: big.length ? `Too big: ${big.map(([id, w]) => `${ticker(id)} ${pctTxt(w)}`).join(', ')} (max ${pctTxt(expect.maxPosition)} each).` : `No position above ${pctTxt(expect.maxPosition)}.` });
  const n = Object.values(weights).filter((w) => Math.abs(w) >= 0.02).length;
  checks.push({ id: 'diversified', label: 'Diversified', pass: n >= expect.minPositions, detail: `${n} positions of 2% or more (want at least ${expect.minPositions}).` });
  checks.push(whyCheck(why, expect.whyKeywords));
  const trades = Object.entries(weights).filter(([, w]) => w).map(([assetId, w]) => ({ assetId, dq: 0, deltaPct: w }));
  return { checks, grade: Math.round((100 * checks.filter((c) => c.pass).length) / checks.length), trades };
}

/** P&L of the decision's trades from the decision tick to `t1` (the outcome, shown separately from the grade). */
export function decisionOutcome(path: PricePath, t0: number, t1: number, trades: TradeDelta[]): number {
  let pnl = 0;
  for (const t of trades) { const p = path.prices[t.assetId]; if (p) pnl += t.dq * (p[Math.min(t1, path.ticks)] - p[t0]); }
  return pnl;
}

// ── Playbook matching (hint mode, debrief tags) ─────────────────────────────
/** Which playbook a headline belongs to: rumours first, then the dominant factor shock and its sign. */
export function matchPlaybook<P extends Pick<Playbook, 'id' | 'match' | 'matchRumour'>>(ev: Pick<NewsEvent, 'source' | 'kind' | 'factorShocks'>, rules: EventRules, playbooks: P[]): P | null {
  if (ev.source === 'rumour' || ev.kind === 'fakeout' || ev.kind === 'denial') return playbooks.find((p) => p.matchRumour) ?? null;
  let best: { f: string; s: number; score: number } | null = null;
  for (const f of rules.factors) {
    const s = ev.factorShocks?.[f.id];
    if (!s) continue;
    const score = Math.abs(s) / f.maxShock.moderate;
    if (!best || score > best.score) best = { f: f.id, s, score };
  }
  if (!best || best.score < 0.25) return null;
  const sign = Math.sign(best.s) as Dir;
  return playbooks.find((p) => p.match?.some((m) => m.factor === best!.f && m.sign === sign)) ?? null;
}

/** Signed expected move of an asset for an event (re-exported helper for lesson tests and hints). */
export function expectedMove(ev: Pick<NewsEvent, 'factorShocks' | 'assetShocks'>, assetId: string, rules: EventRules): number {
  return expectedImpact(ev, rules)[assetId] ?? 0;
}
