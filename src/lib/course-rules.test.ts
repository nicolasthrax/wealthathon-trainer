import { describe, expect, it } from 'vitest';
import { EVENT_RULES } from '@config/event-rules';
import { SEED_SCENARIOS } from '@seed/scenarios';
import { SEED_CLIENTS } from '@seed/clients';
import { SessionRunner, replaySession } from '@engine/runner';
import { benchmarkReturn } from '@engine/benchmark';
import { computeScore } from '@engine/scoring';
import { makePracticeRules } from './practice';

const rules = () => makePracticeRules(EVENT_RULES, 'course', true, true);
const opts = () => ({ rules: rules(), scenario: SEED_SCENARIOS[1], client: SEED_CLIENTS[1], difficulty: 'medium' as const, seed: 'relative-score' });
describe('course score and execution limits', () => {
  it('scores excess return against its saved benchmark and reproduces it on replay', () => {
    const o = opts(), r = new SessionRunner(o);
    r.placeOrder({ assetId: 'SPX', side: 'buy', qty: 100, type: 'market' });
    for (let t=0; t<100; t++) r.step();
    const bm = benchmarkReturn(r.path.prices, r.tick, o.rules.practice!.benchmarkWeights!)!;
    const m = r.metrics;
    expect(m.score).toEqual(computeScore({ret:m.ret-bm,sortino:m.sortino,maxDD:m.maxDD,penalisedFrac:m.penalisedTicks/r.N},o.rules));
    expect(bm).not.toBe(0);
    expect(m.score.return).not.toBe(computeScore({ret:m.ret,sortino:m.sortino,maxDD:m.maxDD,penalisedFrac:m.penalisedTicks/r.N},o.rules).return);
    expect(replaySession(o, r.log, r.tick).metrics.score).toEqual(m.score);
  });
  it('keeps earlier snapshots on absolute scoring', () => {
    const o=opts(); delete o.rules.practice!.scoring;
    const r = new SessionRunner(o); for (let t=0;t<50;t++) r.step(); const m=r.metrics;
    expect(m.score).toEqual(computeScore({ret:m.ret,sortino:m.sortino,maxDD:m.maxDD,penalisedFrac:m.penalisedTicks/r.N},o.rules));
  });
  it('enforces 5M per asset and cash without blocking risk-reducing sales', () => {
    const r = new SessionRunner(opts());
    expect(r.preview({assetId:'SPX',side:'buy',qty:1000,type:'market'}).reason).toMatch(/asset limit/i);
    expect(r.placeOrder({assetId:'SPX',side:'buy',qty:1000,type:'market'}).status).toBe('rejected');
    expect(r.placeOrder({assetId:'SPX',side:'buy',qty:700,type:'market'}).status).toBe('filled');
    expect(r.placeOrder({assetId:'SPX',side:'sell',qty:1,type:'market'}).status).toBe('filled');
    r.cash = 1;
    expect(r.placeOrder({assetId:'NKY',side:'buy',qty:1,type:'market'}).reason).toMatch(/cash/i);
  });
  it('does not silently score an incomplete benchmark', () => {
    const o=opts(); o.rules.practice!.benchmarkWeights = { MISSING: 1 };
    expect(() => new SessionRunner(o)).toThrow(/benchmark/i);
  });
});
