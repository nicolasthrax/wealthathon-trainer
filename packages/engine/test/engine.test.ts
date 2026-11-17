import { describe, expect, it } from 'vitest';
import { EVENT_RULES, applyOverrides } from '@config/event-rules';
import {
  SessionRunner, buildReport, computeOptimalPath, computeScore, evaluateMandate, expectedImpact, generatePath, mandateViolation,
  ordersFromWeights, proceduralScenario, replaySession, solveSegment, sortinoFrom, tightenClient, validateScenario, ClientSchema, SharedSession, buildPlayerStats, liveContribution,
  type Scenario, type Client, type EventRules,
} from '@engine';
import { SEED_SCENARIOS } from '@seed/scenarios';
import { SEED_CLIENTS } from '@seed/clients';

const R = EVENT_RULES;
const [easy, medium, hard] = SEED_SCENARIOS;
const free: Client = { ...SEED_CLIENTS[1], constraints: [{ type: 'maxLeverage', max: 4 }] };
const mk = (sc: Scenario = medium, client: Client = free, rules: EventRules = R, seed = 's1') =>
  new SessionRunner({ scenario: sc, seed, rules, client, difficulty: sc.difficulty });
const quiet: Scenario = { ...easy, id: 'quiet', events: [], regime: { name: 'flat', description: 'flat flat flat', factorDrift: {}, volMult: 1 } };

describe('determinism', () => {
  it('same scenario + seed gives identical prices', () => {
    const a = generatePath(medium, 'abc', R), b = generatePath(medium, 'abc', R);
    for (const id of a.assets) expect(Array.from(a.prices[id])).toEqual(Array.from(b.prices[id]));
  });
  it('different seed gives a different path', () => {
    const a = generatePath(medium, 'abc', R), b = generatePath(medium, 'abd', R);
    expect(a.prices.SPX[600]).not.toBe(b.prices.SPX[600]);
  });
  it('replaying the input log reproduces the session exactly', () => {
    const r = mk();
    for (const o of ordersFromWeights(r, { SPX: 0.3, UST20: 0.3, TENCENT: -0.1 })) r.placeOrder(o);
    for (let t = 0; t < R.clock.totalTicks; t++) {
      if (t === 100) r.placeOrder({ assetId: 'GOLD', side: 'buy', qty: 300, type: 'market' });
      if (t === 150) r.placeOrder({ assetId: 'HSI', side: 'buy', qty: 50000, type: 'limit', limitPrice: r.price('HSI') * 0.98 });
      if (t === 400) r.cancelAll();
      if (t === 700) r.flatten('SPX');
      r.step();
    }
    const again = replaySession({ scenario: medium, seed: 's1', rules: R, client: free, difficulty: 'medium' }, r.log);
    expect(again.metrics.equity).toBe(r.metrics.equity);
    expect(again.fills).toEqual(r.fills);
    expect(again.metrics.score).toEqual(r.metrics.score);
    const partial = replaySession({ scenario: medium, seed: 's1', rules: R, client: free, difficulty: 'medium' }, r.log, 500);
    expect(partial.tick).toBe(500);
    expect(partial.equityCurve[500]).toBe(r.equityCurve[500]);
  });
});

describe('factor coherence', () => {
  it('a Fed hike moves bonds, USD, HK property and gold together', () => {
    const i = expectedImpact({ factorShocks: { RATES: 0.0025, USD: 0.008, GEQ: -0.015 } }, R);
    expect(i.UST20).toBeLessThan(i.UST2);
    expect(i.UST2).toBeLessThan(0);
    expect(i.SHKP).toBeLessThan(i.HSI);
    expect(i.GOLD).toBeLessThan(0);
    expect(i.NDX).toBeLessThan(i.SPX);
    expect(i.HSBC).toBeGreaterThan(i.HSI); // banks earn more when rates rise
    expect(i.USDCNH).toBeGreaterThan(0);
  });
  it('risk-off hits equities and credit, lifts treasuries and gold', () => {
    const i = expectedImpact({ factorShocks: { RISKOFF: 0.05, CREDIT: 0.005 } }, R);
    for (const id of ['SPX', 'HSI', 'TENCENT', 'HY', 'BRENT']) expect(i[id]).toBeLessThan(0);
    for (const id of ['UST20', 'GOLD']) expect(i[id]).toBeGreaterThan(0);
  });
  it('news shocks show up in the price path after the headline, not before', () => {
    const sc: Scenario = { ...quiet, id: 'one', events: [{ ...medium.events[1], id: 'x', t: 0.5 }] };
    const base = generatePath({ ...sc, events: [] }, 'k', R, 'medium'), shocked = generatePath(sc, 'k', R, 'medium');
    const te = shocked.eventTicks.x, lag = R.news.impactLagTicks.medium;
    expect(shocked.prices.TENCENT[te]).toBe(base.prices.TENCENT[te]);
    expect(shocked.prices.TENCENT[te + lag] / base.prices.TENCENT[te + lag]).toBeCloseTo(Math.exp(expectedImpact(sc.events[0], R).TENCENT), 6);
  });
  it('USD/HKD never leaves the peg band; money market only accrues', () => {
    for (const sc of SEED_SCENARIOS) {
      const p = generatePath(sc, 'peg', R);
      expect(Math.min(...p.prices.USDHKD)).toBeGreaterThanOrEqual(7.75);
      expect(Math.max(...p.prices.USDHKD)).toBeLessThanOrEqual(7.85);
      for (let t = 1; t <= p.ticks; t++) expect(p.prices.HKDMM[t]).toBeGreaterThan(p.prices.HKDMM[t - 1]);
    }
  });
});

describe('orders and margin', () => {
  it('fills market orders at the tick price with no costs by default', () => {
    const r = mk();
    const o = r.placeOrder({ assetId: 'SPX', side: 'buy', qty: 100, type: 'market' });
    expect(o.status).toBe('filled');
    expect(r.fills[0].price).toBe(r.price('SPX'));
    expect(r.equity()).toBeCloseTo(R.startingCapital, 6);
  });
  it('applies spread and commission when costs are switched on in config', () => {
    const rules = structuredClone(R); rules.costs.enabled = true;
    const r = mk(medium, free, rules);
    r.placeOrder({ assetId: 'SPX', side: 'buy', qty: 100, type: 'market' });
    expect(r.fills[0].price).toBeGreaterThan(r.price('SPX'));
    expect(r.equity()).toBeLessThan(rules.startingCapital);
  });
  it('limit orders rest, then fill only when the price crosses', () => {
    const r = mk();
    const px = r.price('HSI');
    const o = r.placeOrder({ assetId: 'HSI', side: 'buy', qty: 1000, type: 'limit', limitPrice: px * 0.97 });
    expect(o.status).toBe('working');
    while (!r.finished && o.status === 'working') r.step();
    if (o.status === 'filled') expect(r.fills[0].price).toBeLessThanOrEqual(px * 0.97);
  });
  it('allows shorts and leverage but rejects orders beyond margin', () => {
    const r = mk();
    expect(r.placeOrder({ assetId: 'TENCENT', side: 'sell', qty: 2000, type: 'market' }).status).toBe('filled');
    expect(r.qty('TENCENT')).toBe(-2000);
    const big = Math.floor((R.startingCapital * 3.5) / r.price('SPX'));
    const o = r.placeOrder({ assetId: 'SPX', side: 'buy', qty: big, type: 'market' });
    expect(o.status).toBe('rejected');
    expect(o.reason).toMatch(/margin|leverage/i);
    const ok = r.placeOrder({ assetId: 'SPX', side: 'buy', qty: Math.floor((R.startingCapital * 1.8) / r.price('SPX')), type: 'market' });
    expect(ok.status).toBe('filled');
    expect(r.metrics.leverage).toBeGreaterThan(1.5);
    expect(r.cash).toBeLessThan(0);
  });
  it('respects shorting / margin toggles in config', () => {
    const rules = structuredClone(R); rules.shorting.allowed = false; rules.margin.allowed = false;
    const r = mk(medium, free, rules);
    expect(r.placeOrder({ assetId: 'SPX', side: 'sell', qty: 10, type: 'market' }).reason).toMatch(/short/i);
    expect(r.placeOrder({ assetId: 'SPX', side: 'buy', qty: Math.floor((rules.startingCapital * 1.2) / r.price('SPX')), type: 'market' }).reason).toMatch(/leverage/i);
  });
  it('margin call leads to forced liquidation in a crash', () => {
    const crash: Scenario = { ...quiet, id: 'crash', events: [0.1, 0.14, 0.18, 0.22].map((t, i) => ({ ...medium.events[1], id: `c${i}`, t, factorShocks: { GEQ: -0.09, CNHK: -0.11, RISKOFF: 0.1 }, assetShocks: {} })) };
    const r = mk(crash);
    r.placeOrder({ assetId: 'TENCENT', side: 'buy', qty: Math.floor((R.startingCapital * 2.4) / r.price('TENCENT')), type: 'market' });
    const q0 = r.qty('TENCENT');
    while (!r.finished) r.step();
    expect(r.liquidations).toBeGreaterThan(0);
    expect(r.fills.some((f) => f.source === 'liquidation')).toBe(true);
    expect(Math.abs(r.qty('TENCENT'))).toBeLessThan(q0);
  });
  it('charges financing on borrowed cash', () => {
    const r = mk(quiet);
    r.placeOrder({ assetId: 'HKDMM', side: 'buy', qty: Math.floor((R.startingCapital * 2) / 100), type: 'market' });
    const c0 = r.cash;
    r.step();
    expect(r.cash).toBeLessThan(c0);
  });
});

describe('mandate', () => {
  const chan = SEED_CLIENTS[0];
  it('flags each constraint type', () => {
    const c = (w: Record<string, number>, cash: number, cl = chan) => Object.fromEntries(evaluateMandate(cl, w, cash, R).map((x) => [x.key, x.ok]));
    expect(c({ SPX: 0.3, UST20: 0.45 }, 0.25)).toEqual({ 'maxClass:equity': true, 'minClass:bond': true, maxSingleName: true, noShort: true, maxLeverage: true });
    expect(c({ SPX: 0.5, UST20: 0.45 }, 0.05)['maxClass:equity']).toBe(false);
    expect(c({ SPX: 0.3 }, 0.7)['minClass:bond']).toBe(false);
    expect(c({ HSBC: 0.1, UST20: 0.45 }, 0.45).maxSingleName).toBe(false);
    expect(c({ SPX: -0.05, UST20: 0.45 }, 0.6).noShort).toBe(false);
    expect(c({ SPX: 0.3, UST20: 0.9 }, -0.2).maxLeverage).toBe(false);
    expect(c({ SPX: 0.2, HKDMM: 0.2 }, 0.6, SEED_CLIENTS[3])['currencyMin:HKD']).toBe(true);
    expect(c({ SPX: 0.2, UST2: 0.5 }, 0.3, SEED_CLIENTS[3])['currencyMin:HKD']).toBe(false);
    expect(c({ BRENT: 0.02, UST20: 0.2 }, 0.78, SEED_CLIENTS[2])['excludeTag:fossil']).toBe(false);
  });
  it('a breach only costs score after the grace period', () => {
    const r = mk(quiet, chan);
    for (let i = 0; i < R.mandate.breachGraceTicks; i++) r.step(); // all cash: min-bonds breached
    expect(r.metrics.penalisedTicks).toBe(0);
    expect(r.metrics.mandate.find((m) => m.key === 'minClass:bond')!.ok).toBe(false);
    r.step(); r.step();
    expect(r.metrics.penalisedTicks).toBe(2);
    expect(r.metrics.score.mandate).toBeLessThan(100);
    r.placeOrder({ assetId: 'UST2', side: 'buy', qty: 45000, type: 'market' });
    r.step(); r.step();
    expect(r.metrics.penalisedTicks).toBe(2);
    expect(r.breaches[0].penalisedTicks).toBe(2);
  });
  it('hard difficulty tightens caps', () => {
    const t = tightenClient(chan, 0.8);
    expect(t.constraints[0]).toMatchObject({ max: 0.28 });
    expect(tightenClient(SEED_CLIENTS[1], 0.8).constraints[0]).toMatchObject({ max: 1.8 });
  });
  it('every seed client is valid and satisfiable at every difficulty', () => {
    for (const cl of SEED_CLIENTS) {
      expect(ClientSchema.safeParse(cl).success).toBe(true);
      const r = mk(hard, cl);
      const w = solveSegment(r, 0, 100);
      const cash = 1 - Object.values(w).reduce((s, x) => s + x, 0);
      expect(mandateViolation(evaluateMandate(r.client, w, cash, R)), cl.name).toBe(0);
    }
  });
});

describe('scoring', () => {
  it('maps components linearly and applies config weights', () => {
    const s = computeScore({ ret: 0.05, sortino: 1, maxDD: 0.05, penalisedFrac: 0.1 }, R);
    expect(s.return).toBeCloseTo(50); expect(s.sortino).toBeCloseTo(50); expect(s.drawdown).toBeCloseTo(80); expect(s.mandate).toBeCloseTo(70);
    expect(s.composite).toBeCloseTo(0.35 * 50 + 0.3 * 50 + 0.2 * 80 + 0.15 * 70);
    const all = computeScore({ ret: 1, sortino: 9, maxDD: 0, penalisedFrac: 0 }, R);
    expect(all.composite).toBeCloseTo(100);
    expect(computeScore({ ret: -1, sortino: -9, maxDD: 1, penalisedFrac: 1 }, R).composite).toBe(0);
  });
  it('weights and capital can be overridden without touching code', () => {
    const rules = applyOverrides(R, { weights: { return: 1, sortino: 0, drawdown: 0, mandate: 0 }, startingCapital: 5_000_000 });
    expect(computeScore({ ret: 0.05, sortino: 3, maxDD: 0, penalisedFrac: 0 }, rules).composite).toBeCloseTo(50);
    expect(mk(medium, free, rules).equity()).toBe(5_000_000);
    expect(R.startingCapital).toBe(10_000_000);
  });
  it('sortino uses downside deviation only', () => {
    expect(sortinoFrom(100, 0.1, 0, R)).toBe(R.scoring.sortinoBounds.full);
    const s = sortinoFrom(100, 0.05, 0.0004, R);
    expect(s).toBeCloseTo((0.0005 / 0.002) * Math.sqrt(R.clock.totalTicks));
    expect(sortinoFrom(5, 0.05, 0.0004, R)).toBe(0);
  });
  it('an untouched all-cash account keeps return at zero', () => {
    const r = mk(quiet);
    while (!r.finished) r.step();
    expect(r.metrics.ret).toBe(0); expect(r.metrics.maxDD).toBe(0);
  });
  it('changing the asset list in config changes the tradable universe', () => {
    const rules = structuredClone(R); rules.assets = rules.assets.filter((a) => a.id !== 'BRENT');
    const r = mk(medium, free, rules);
    expect(r.path.assets).not.toContain('BRENT');
    expect(r.placeOrder({ assetId: 'BRENT', side: 'buy', qty: 1, type: 'market' }).status).toBe('rejected');
  });
});

describe('scenarios and validator', () => {
  it('all hand-written scenarios validate without errors', () => {
    for (const sc of SEED_SCENARIOS) {
      const v = validateScenario(sc, R);
      expect(v.errors, sc.id).toEqual([]);
      expect(v.mismatches, sc.id).toEqual([]);
    }
  });
  it('procedural scenarios validate at every difficulty', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) for (let i = 0; i < 25; i++) {
      const v = validateScenario(proceduralScenario(`t${i}`, d, R), R);
      expect(v.errors, `${d} ${i}`).toEqual([]);
    }
    expect(proceduralScenario('x', 'hard', R)).toEqual(proceduralScenario('x', 'hard', R));
  });
  it('rejects schema failures, implausible shocks and contradictions; repairs mild ones', () => {
    expect(validateScenario({ ...medium, events: 'nope' }, R).ok).toBe(false);
    const wild = structuredClone(medium); wild.events[0].factorShocks = { GEQ: -0.4 };
    expect(validateScenario(wild, R).errors.join()).toMatch(/implausible/);
    const mild = structuredClone(medium); mild.events[0].factorShocks = { CNHK: -0.02 };
    const v = validateScenario(mild, R);
    expect(v.ok).toBe(true); expect(v.repairs.length).toBeGreaterThan(0);
    expect(Math.abs(v.scenario!.events[0].factorShocks.CNHK)).toBeLessThanOrEqual(0.015);
    const contra = structuredClone(medium);
    for (const e of contra.events.slice(0, 6)) e.sentiment = e.sentiment === 0 ? 0 : -e.sentiment;
    expect(validateScenario(contra, R).errors.join()).toMatch(/contradict/);
    const blind = Object.fromEntries(medium.events.map((e) => [e.id, 1]));
    expect(validateScenario(medium, R, { blindSentiment: blind }).ok).toBe(false);
  });
  it('rejects wrong density and near-duplicates', () => {
    expect(validateScenario({ ...medium, difficulty: 'easy' }, R).errors.join()).toMatch(/events; easy needs/);
    expect(validateScenario({ ...medium, id: 'copy' }, R, { pool: [medium] }).errors.join()).toMatch(/too similar/);
    expect(validateScenario(medium, R, { pool: [easy, hard] }).ok).toBe(true);
  });
});

describe('debrief', () => {
  const play = () => {
    const r = mk(medium, SEED_CLIENTS[7]);
    for (const o of ordersFromWeights(r, { SPX: 0.3, UST2: 0.3, HSI: 0.2 })) r.placeOrder(o);
    const tariff = r.path.eventTicks.e2;
    while (!r.finished) {
      if (r.tick === tariff + 2) { r.flatten('HSI'); r.placeOrder({ assetId: 'GOLD', side: 'buy', qty: 200, type: 'market' }); }
      r.step();
    }
    return r;
  };
  it('measures reaction time and hit rate from the order log', () => {
    const r = play();
    const rep = buildReport(r, 1.5);
    const e2 = rep.events.find((e) => e.eventId === 'e2')!;
    expect(e2.reactionTicks).toBe(2); expect(e2.reactionSeconds).toBe(3);
    expect(e2.hits).toBeGreaterThan(0); // sold HSI right after the tariff headline
    expect(rep.hitRate).toBeGreaterThan(0);
    expect(rep.best.length).toBeGreaterThan(0);
    expect(rep.turnover).toBeGreaterThan(0);
    expect(rep.final.score.composite).toBe(r.metrics.score.composite);
    expect(rep.byCategory.geopolitics.events).toBe(3);
  });
  it('optimal path respects the mandate and beats the played session', () => {
    const r = play();
    const opt = computeOptimalPath(r);
    expect(opt.finalReturn).toBeGreaterThan(r.metrics.ret);
    expect(opt.finalReturn).toBeLessThan(1.5); // a news-reading benchmark, not perfect foresight of noise
    for (const s of opt.segments) {
      const cash = 1 - Object.values(s.weights).reduce((a, b) => a + b, 0);
      expect(mandateViolation(evaluateMandate(r.client, s.weights, cash, R))).toBe(0);
    }
    expect(opt.missed[0].gap).toBeGreaterThan(0);
    expect(computeOptimalPath(r)).toEqual(opt);
  });
});

describe('team sessions (shared lockstep)', () => {
  const base = { scenario: medium, seed: 'team', rules: R, client: free, difficulty: 'medium' as const };
  const mkInputs = () => {
    const ins: import('@engine').SharedInput[] = [];
    let seq = 0;
    const place = (tick: number, user: string, assetId: string, side: 'buy' | 'sell', qty: number, extra: object = {}) =>
      ins.push({ seq: ++seq, tick, kind: 'place', user_id: user, participant_id: user, payload: { assetId, side, qty, type: 'market', ...extra } });
    place(0, 'A', 'SPX', 'buy', 300);
    place(0, 'B', 'UST20', 'buy', 20000);
    place(40, 'A', 'TENCENT', 'sell', 1500);
    place(40, 'B', 'GOLD', 'buy', 200);
    place(90, 'B', 'HSI', 'buy', 50000, { type: 'limit', limitPrice: 1 }); // seq 5: never fills
    ins.push({ seq: ++seq, tick: 120, kind: 'cancel', user_id: 'A', participant_id: 'A', payload: { placeSeq: 5 } });
    place(300, 'A', 'TENCENT', 'buy', 1500);
    ins.push({ seq: ++seq, tick: 700, kind: 'end', user_id: 'B', participant_id: 'B', payload: {} });
    return ins;
  };
  it('two clients receiving inputs late and out of order converge on identical state', () => {
    const ins = mkInputs();
    // Client 1: receives every input exactly on its tick.
    const c1 = new SharedSession(base);
    for (const x of ins) { c1.advanceTo(x.tick); c1.integrate(x); }
    c1.advanceTo(R.clock.totalTicks);
    // Client 2: receives each input 1-3 ticks late, in a shuffled order.
    const c2 = new SharedSession(base);
    const late = ins.map((x, i) => ({ x, at: x.tick + 1 + (i % 3) })).sort((a, b) => a.at - b.at || b.x.seq - a.x.seq);
    for (const { x, at } of late) { c2.advanceTo(at); c2.integrate(x); }
    c2.advanceTo(R.clock.totalTicks);
    expect(c2.rebuilds).toBeGreaterThan(0);
    expect(c1.runner.finished && c2.runner.finished).toBe(true);
    expect(c2.runner.metrics.equity).toBe(c1.runner.metrics.equity);
    expect(c2.runner.fills).toEqual(c1.runner.fills);
    expect(c1.runner.orders.find((o) => o.assetId === 'HSI')!.status).toBe('cancelled');
    expect(c1.runner.orders[0].participantId).toBe('A');
    // The runner's log replays to the same result (this is what the debrief uses).
    const replayed = replaySession(base, c1.runner.log);
    expect(replayed.metrics.equity).toBe(c1.runner.metrics.equity);
  });
  it('an end input fast-forwards both clients to year end', () => {
    const c = new SharedSession(base);
    c.advanceTo(10);
    c.integrate({ seq: 1, tick: 10, kind: 'end', user_id: 'A', participant_id: null, payload: {} });
    expect(c.runner.finished).toBe(true);
    expect(c.runner.tick).toBe(R.clock.totalTicks);
  });
});

describe('individual stats in team sessions', () => {
  const base = { scenario: medium, seed: 'ind', rules: R, client: SEED_CLIENTS[7], difficulty: 'medium' as const };
  const play = () => {
    const c = new SharedSession(base);
    let seq = 0;
    const place = (tick: number, who: string, assetId: string, side: 'buy' | 'sell', qty: number, source?: string) => {
      c.advanceTo(tick);
      c.integrate({ seq: ++seq, tick, kind: 'place', user_id: who, participant_id: who, payload: { assetId, side, qty, type: 'market', ...(source ? { source } : {}) } });
    };
    place(0, 'A', 'SPX', 'buy', 300, 'opening');
    place(0, 'A', 'UST2', 'buy', 30000, 'opening');
    place(50, 'A', 'TENCENT', 'buy', 2500);   // 15% of NAV in one name: A causes a single-name breach (client max 10%)
    place(80, 'B', 'GOLD', 'buy', 300);
    place(200, 'B', 'TENCENT', 'sell', 2500); // B closes A's position: A keeps the P&L up to here, B owns what follows
    place(400, 'A', 'HSCEI', 'sell', 4000);
    c.advanceTo(R.clock.totalTicks);
    return c.runner;
  };
  it('player buckets + team opening + financing add up exactly to the team P&L', () => {
    const r = play();
    const { players, financing, teamPnl } = buildPlayerStats(r, 1.5, ['A', 'B']);
    const total = players.reduce((s, p) => s + p.pnl, 0) + financing;
    expect(total).toBeCloseTo(teamPnl, 4);
    expect(teamPnl).toBeCloseTo(r.metrics.equity - R.startingCapital, 4);
    const [a, b, team] = players;
    expect(team.participantId).toBeNull();
    expect(team.fills).toBe(2);           // opening allocation is a team decision
    expect(a.fills).toBe(2); expect(b.fills).toBe(2);
    expect(a.curve.at(-1)).toBe(Math.round(a.pnl));
    // B's sale closes the Tencent exposure for the team: A and B hold offsetting Tencent books from then on.
    const live = liveContribution(r);
    expect(live.A).toBeCloseTo(a.pnl, 4); expect(live.B).toBeCloseTo(b.pnl, 4);
  });
  it('charges a mandate breach to the player whose trade caused it, and scores each player', () => {
    const r = play();
    const { players: [a, b] } = buildPlayerStats(r, 1.5, ['A', 'B']);
    expect(r.breaches.some((x) => x.key === 'maxSingleName')).toBe(true);
    expect(a.breachesCaused).toBeGreaterThan(0);
    expect(a.penalisedTicks).toBeGreaterThan(0);
    expect(b.breachesCaused).toBe(0);
    expect(b.score.mandate).toBe(100);
    expect(a.score.mandate).toBeLessThan(100);
    for (const p of [a, b]) expect(p.score.composite).toBeGreaterThan(0);
  });
  it('a player who never trades gets a neutral record', () => {
    const r = play();
    const idle = buildPlayerStats(r, 1.5, ['A', 'B', 'C']).players[2];
    expect(idle.fills).toBe(0); expect(idle.pnl).toBe(0); expect(idle.maxDD).toBe(0); expect(idle.hitRate).toBeNull();
  });
});
