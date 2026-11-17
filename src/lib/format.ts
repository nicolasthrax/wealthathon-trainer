export const fmtMoney = (x: number, dp = 0) => (x < 0 ? '-' : '') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const fmtCompact = (x: number) => {
  const a = Math.abs(x), s = x < 0 ? '-' : '';
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a.toFixed(0)}`;
};
export const fmtPct = (x: number, dp = 2, sign = true) => `${sign && x > 0 ? '+' : ''}${(x * 100).toFixed(dp)}%`;
export const fmtPx = (x: number, dp: number) => x.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const cls = (x: number) => (x > 1e-12 ? 'up' : x < -1e-12 ? 'down' : '');
export const fmtClock = (s: number) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const GOAL_LABEL: Record<string, string> = { income: 'Income', growth: 'Growth', capital_preservation: 'Capital preservation', liquidity: 'Liquidity (property purchase)' };
export const CAT_LABEL: Record<string, string> = { central_bank: 'Central bank', earnings: 'Earnings', geopolitics: 'Geopolitics', china_policy: 'China policy', macro_data: 'Macro data', commodities: 'Commodities', credit: 'Credit' };
export const SRC_LABEL: Record<string, string> = { wire: 'WIRE', central_bank: 'CENTRAL BANK', filing: 'FILING', rumour: 'RUMOUR' };
