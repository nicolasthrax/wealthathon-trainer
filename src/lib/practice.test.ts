import { describe, expect, it } from 'vitest';
import { EVENT_RULES } from '@config/event-rules';
import { practiceClock, practiceRules, PRACTICE_MINUTES } from './practice';

describe('practice format', () => {
  it('sets the practice capital without mutating the source rules', () => {
    const rules = practiceRules(EVENT_RULES);
    expect(rules.startingCapital).toBe(20_000_000);
    expect(EVENT_RULES.startingCapital).toBe(10_000_000);
    expect(rules.costs).toEqual(EVENT_RULES.costs);
    expect(PRACTICE_MINUTES).toBe(60);
  });
  it('switches at each 15 minute boundary and stops at quarter four', () => {
    expect(practiceClock(0)).toEqual({ quarter: 1, quarterRemaining: 900, totalRemaining: 3600 });
    expect(practiceClock(899)).toEqual({ quarter: 1, quarterRemaining: 1, totalRemaining: 2701 });
    expect(practiceClock(900)).toEqual({ quarter: 2, quarterRemaining: 900, totalRemaining: 2700 });
    expect(practiceClock(1800).quarter).toBe(3);
    expect(practiceClock(2700).quarter).toBe(4);
    expect(practiceClock(3600)).toEqual({ quarter: 4, quarterRemaining: 0, totalRemaining: 0 });
    expect(practiceClock(4000).quarter).toBe(4);
  });
});

import { courseClock, makePracticeRules, proxyBenchmark, PROXY_BENCHMARK } from './practice';
import { SessionRunner } from '@engine/runner';
import { SharedSession } from '@engine/team';
import { SEED_SCENARIOS } from '@seed/scenarios';
import { SEED_CLIENTS } from '@seed/clients';

describe('course-inspired practice', () => {
  it('snapshots distinct full and shortened presets, preserving legacy shorting', () => {
    const course = makePracticeRules(EVENT_RULES, 'course');
    const legacy = makePracticeRules(EVENT_RULES, 'legacy');
    expect(course.baseCurrency).toBe('USD'); expect(course.startingCapital).toBe(20_000_000);
    expect(course.shorting.allowed).toBe(false); expect(legacy.shorting.allowed).toBe(EVENT_RULES.shorting.allowed);
    expect(legacy.baseCurrency).toBe('HKD');
    expect(course.practice).toEqual({preset:'course', quarterSeconds:900, rebalanceSeconds:900});
    expect(makePracticeRules(EVENT_RULES, 'course', true).practice?.quarterSeconds).toBe(300);
    expect(EVENT_RULES.shorting.allowed).toBe(true);
  });
  it('freezes trading time during each window, resumes, and finishes after 105 minutes', () => {
    for (let i=0;i<3;i++) {
      const start = 900 + i * 1800;
      expect(courseClock(start,900,900)).toMatchObject({quarter:i+1,phase:'rebalance',tradingFraction:(i+1)/4,remaining:900});
      expect(courseClock(start+899,900,900).tradingFraction).toBe((i+1)/4);
      expect(courseClock(start+900,900,900)).toMatchObject({quarter:i+2,phase:'trading',tradingFraction:(i+1)/4});
    }
    expect(courseClock(6300,900,900)).toMatchObject({phase:'finished',quarter:4,tradingFraction:1});
    expect(courseClock(2100,300,300).phase).toBe('finished');
  });
  it('rejects short sales but allows selling owned shares in the course preset', () => {
    const rules = makePracticeRules(EVENT_RULES, 'course');
    const r = new SessionRunner({rules,scenario:SEED_SCENARIOS[1],seed:'test',client:SEED_CLIENTS[1],difficulty:'medium'});
    expect(r.placeOrder({assetId:'SPX', side:'sell',qty:1,type:'market'}).reason).toMatch(/short/i);
    expect(r.placeOrder({assetId:'SPX', side:'buy',qty:2,type:'market'}).status).toBe('filled');
    expect(r.placeOrder({assetId:'SPX', side:'sell',qty:2,type:'market'}).status).toBe('filled');
    expect(r.placeOrder({assetId:'SPX', side:'sell',qty:1,type:'market'}).status).toBe('rejected');
  });
  it('allows trades at a frozen tick and converges in two shared sessions', () => {
    const rules = makePracticeRules(EVENT_RULES, 'course');
    const opts = {rules,scenario:SEED_SCENARIOS[1],seed:'test',client:SEED_CLIENTS[1],difficulty:'medium' as const};
    const a = new SharedSession(opts), b = new SharedSession(opts);
    const tick = Math.floor(courseClock(900,900,900).tradingFraction * a.runner.N);
    a.advanceTo(tick); b.advanceTo(tick);
    const input = {seq:1,tick,kind:'place' as const,payload:{assetId:'SPX',side:'buy',qty:2,type:'market'},user_id:'a',participant_id:'a'};
    a.integrate(input); b.integrate(input);
    expect(a.runner.fills[0].price).toBe(a.runner.price('SPX',tick));
    expect(a.runner.tick).toBe(tick);
    expect(courseClock(1799,900,900).tradingFraction * a.runner.N).toBe(tick);
    a.advanceTo(tick+1); b.advanceTo(tick+1);
    expect(a.runner.metrics.equity).toBe(b.runner.metrics.equity);
  });
  it('computes a weighted buy-and-hold proxy and refuses missing data', () => {
    const prices = Object.fromEntries(Object.keys(PROXY_BENCHMARK).map(id => [id,[100,110]]));
    expect(proxyBenchmark(prices,1)).toBeCloseTo(.1);
    delete prices.SPX;
    expect(proxyBenchmark(prices,1)).toBeNull();
  });
});
