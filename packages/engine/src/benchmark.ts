/** Buy-and-hold benchmark: missing prices must never silently become a zero return. */
export function benchmarkReturn(prices: Record<string, ArrayLike<number>>, tick: number, weights: Record<string, number>): number | null {
  let sum = 0, total = 0;
  for (const [id, weight] of Object.entries(weights)) {
    const p = prices[id];
    if (!Number.isFinite(weight) || weight < 0 || !p || !(p[0] > 0) || !(p[tick] > 0) || !Number.isFinite(p[tick])) return null;
    total += weight;
    sum += weight * (p[tick] / p[0] - 1);
  }
  return Math.abs(total - 1) < 1e-9 ? sum : null;
}
