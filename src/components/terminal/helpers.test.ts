import { describe, expect, it } from 'vitest';
import { accountSummary, candles, commissionEstimate, percentChange, positionRows, sma } from './helpers';
describe('terminal calculations', () => {
  it('joins flat fills and excludes shorts from owned value', () => {
    const fills = [{assetId:'flat', realizedPnl: 8, fee: 2}, {assetId:'long', realizedPnl: -1, fee: 1}];
    const rows = positionRows({long:{qty:2,avg:9}, short:{qty:-1,avg:12}}, fills, () => 10);
    expect(rows.find(r => r.id === 'flat')?.net).toBe(8);
    expect(accountSummary(rows, fills)).toEqual({owned:20, unrealized:4, realized:7, commission:3});
  });
  it('calculates change and optional commission', () => {
    expect(percentChange(110,100)).toBeCloseTo(.1); expect(commissionEstimate(10,100,false,5)).toBe(0); expect(commissionEstimate(10,100,true,5)).toBe(.5);
  });
  it('buckets actual prices and computes a moving average', () => {
    expect(candles([3,1,4,2],3,2)).toEqual([{tick:0,open:3,high:3,low:1,close:1},{tick:2,open:4,high:4,low:2,close:2}]);
    expect(sma([3,1,4],2,2)).toEqual([{tick:1,value:2},{tick:2,value:2.5}]);
  });
});
