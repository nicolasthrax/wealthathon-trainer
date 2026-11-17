import type { EventRules, Scenario, Difficulty } from './types';

// ── Deterministic RNG ────────────────────────────────────────────────────────
export function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function makeRng(seed: string) {
  const u = mulberry32(hashSeed(seed));
  return {
    uniform: u,
    normal: () => {
      const a = Math.max(u(), 1e-12), b = u();
      return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
    },
    int: (lo: number, hi: number) => lo + Math.floor(u() * (hi - lo + 1)),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(u() * arr.length)],
  };
}
export type Rng = ReturnType<typeof makeRng>;

// ── Price path ───────────────────────────────────────────────────────────────
export interface PricePath {
  ticks: number;
  /** Tradable asset ids in this session (historical episodes may lack some). */
  assets: string[];
  prices: Record<string, Float64Array>;
  /** Tick at which each news event lands. */
  eventTicks: Record<string, number>;
}

export function eventTick(t: number, totalTicks: number): number {
  return Math.min(totalTicks - 2, Math.max(1, Math.round(t * totalTicks)));
}

/** Expected fractional move of every asset from one event's shocks (factor loadings x shocks). */
export function expectedImpact(ev: { factorShocks?: Record<string, number>; assetShocks?: Record<string, number> }, rules: EventRules): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of rules.assets) {
    let m = 0;
    for (const [f, s] of Object.entries(ev.factorShocks ?? {})) m += (a.loadings[f] ?? 0) * s;
    m += ev.assetShocks?.[a.id] ?? 0;
    out[a.id] = m;
  }
  return out;
}

export function generatePath(scenario: Scenario, seed: string, rules: EventRules, difficulty: Difficulty = scenario.difficulty): PricePath {
  return scenario.source === 'historical' && scenario.historical
    ? historicalPath(scenario, seed, rules)
    : syntheticPath(scenario, seed, rules, difficulty);
}

function syntheticPath(scenario: Scenario, seed: string, rules: EventRules, difficulty: Difficulty): PricePath {
  const N = rules.clock.totalTicks;
  const dt = 1 / N;
  const sq = Math.sqrt(dt);
  const rng = makeRng(`${scenario.id}|${seed}`);
  const factors = rules.factors;
  const assets = rules.assets;
  const lag = Math.max(1, rules.news.impactLagTicks[difficulty]);

  // Shock schedules: additive log-return per tick, per factor and per asset.
  const fShock: Record<string, Float64Array> = {};
  for (const f of factors) fShock[f.id] = new Float64Array(N + 1);
  const aShock: Record<string, Float64Array> = {};
  for (const a of assets) aShock[a.id] = new Float64Array(N + 1);
  const eventTicks: Record<string, number> = {};
  for (const ev of scenario.events) {
    const te = eventTick(ev.t, N);
    eventTicks[ev.id] = te;
    const span = ev.kind === 'slow_burn' ? rules.news.slowBurnTicks : lag;
    const spread = (arr: Float64Array | undefined, size: number) => {
      if (!arr || !size) return;
      for (let k = 1; k <= span; k++) { const i = te + k; if (i <= N) arr[i] += size / span; }
    };
    for (const [f, s] of Object.entries(ev.factorShocks ?? {})) spread(fShock[f], s);
    for (const [a, s] of Object.entries(ev.assetShocks ?? {})) spread(aShock[a], s);
  }

  const prices: Record<string, Float64Array> = {};
  for (const a of assets) { prices[a.id] = new Float64Array(N + 1); prices[a.id][0] = a.startPrice; }
  const volMult = scenario.regime.volMult ?? 1;
  const fr = new Float64Array(factors.length);
  for (let t = 1; t <= N; t++) {
    for (let k = 0; k < factors.length; k++) {
      const f = factors[k];
      const drift = (f.drift + (scenario.regime.factorDrift?.[f.id] ?? 0)) * dt;
      fr[k] = drift + f.vol * volMult * sq * rng.normal() + fShock[f.id][t];
    }
    for (const a of assets) {
      let r = a.carry * dt + aShock[a.id][t];
      for (let k = 0; k < factors.length; k++) r += (a.loadings[factors[k].id] ?? 0) * fr[k];
      const z = rng.normal(); // always drawn, so the stream is stable across config tweaks to idioVol
      r += a.idioVol * sq * z;
      let p = prices[a.id][t - 1] * Math.exp(r);
      if (a.band) p = Math.min(a.band[1], Math.max(a.band[0], p));
      prices[a.id][t] = p;
    }
  }
  return { ticks: N, assets: assets.map((a) => a.id), prices, eventTicks };
}

function historicalPath(scenario: Scenario, seed: string, rules: EventRules): PricePath {
  const N = rules.clock.totalTicks;
  const h = scenario.historical!;
  const D = h.dates.length;
  const rng = makeRng(`${scenario.id}|${seed}`);
  const prices: Record<string, Float64Array> = {};
  const ids: string[] = [];
  for (const a of rules.assets) {
    const s = h.series[a.id];
    const out = new Float64Array(N + 1);
    if (a.cls === 'cash' && !s) {
      for (let t = 0; t <= N; t++) out[t] = a.startPrice * Math.exp((a.carry * t) / N);
    } else if (s && s.length === D && s[0] > 0) {
      const base = a.rawHistory ? 1 : a.startPrice / s[0];
      for (let t = 0; t <= N; t++) {
        const x = (t / N) * (D - 1);
        const i = Math.min(D - 2, Math.floor(x));
        const fr = x - i;
        // Log-linear interpolation between daily closes + a small intraday bridge that vanishes at closes.
        const lp = Math.log(s[i]) * (1 - fr) + Math.log(s[i + 1]) * fr;
        const wiggle = rng.normal() * a.idioVol * 0.004 * Math.sqrt(fr * (1 - fr));
        let p = Math.exp(lp + wiggle) * base;
        if (a.band) p = Math.min(a.band[1], Math.max(a.band[0], p));
        out[t] = p;
      }
    } else continue;
    prices[a.id] = out;
    ids.push(a.id);
  }
  const eventTicks: Record<string, number> = {};
  for (const ev of scenario.events) eventTicks[ev.id] = eventTick(ev.t, N);
  return { ticks: N, assets: ids, prices, eventTicks };
}

/** Simulated calendar label for a tick. Historical + undisguised shows the real date. */
export function tickLabel(tick: number, rules: EventRules, scenario?: Scenario, disguise = true): string {
  const N = rules.clock.totalTicks;
  if (scenario?.historical && !disguise) {
    const d = scenario.historical.dates;
    return d[Math.min(d.length - 1, Math.round((tick / N) * (d.length - 1)))];
  }
  const days = scenario?.historical ? scenario.historical.dates.length : rules.clock.tradingDaysPerYear;
  const day = Math.min(days, Math.floor((tick / N) * days) + 1);
  return `Day ${day}/${days}`;
}
