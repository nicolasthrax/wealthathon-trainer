/** UI-only calculations. Realised P&L is already net of fill fees. */
export function positionRows(pos: Record<string, { qty: number; avg: number }>, fills: { assetId: string; realizedPnl: number }[], price: (id: string) => number) {
  const realized: Record<string, number> = {};
  for (const f of fills) realized[f.assetId] = (realized[f.assetId] ?? 0) + f.realizedPnl;
  return [...new Set([...Object.keys(pos), ...Object.keys(realized)])].filter(id => pos[id]?.qty || realized[id]).map(id => {
    const p = pos[id] ?? { qty: 0, avg: 0 };
    const value = p.qty * price(id), unrealized = (price(id) - p.avg) * p.qty, real = realized[id] ?? 0;
    return { id, ...p, value, unrealized, realized: real, net: unrealized + real };
  });
}
export const percentChange = (price: number, start: number) => start ? price / start - 1 : 0;
export const commissionEstimate = (qty: number, price: number, enabled: boolean, bps: number) => enabled ? qty * price * bps / 10000 : 0;
export function accountSummary(rows: ReturnType<typeof positionRows>, fills: { fee: number; realizedPnl: number }[]) {
  return { owned: rows.reduce((s, r) => s + (r.qty > 0 ? r.value : 0), 0), unrealized: rows.reduce((s, r) => s + r.unrealized, 0), realized: fills.reduce((s, f) => s + f.realizedPnl, 0), commission: fills.reduce((s, f) => s + f.fee, 0) };
}
export function candles(prices: ArrayLike<number>, end: number, bucket: number) {
  const result: { tick: number; open: number; high: number; low: number; close: number }[] = [];
  for (let i = 0; i <= end; i += bucket) {
    const values = Array.from({length: Math.min(bucket, end - i + 1)}, (_, j) => prices[i+j]);
    result.push({ tick: i, open: values[0], high: Math.max(...values), low: Math.min(...values), close: values[values.length - 1] });
  }
  return result;
}
export function sma(prices: ArrayLike<number>, end: number, period: number) {
  const out: {tick: number; value: number}[] = []; let sum = 0;
  for (let i = 0; i <= end; i++) { sum += prices[i]; if (i >= period) sum -= prices[i-period]; if (i >= period-1) out.push({tick:i, value:sum/period}); }
  return out;
}
