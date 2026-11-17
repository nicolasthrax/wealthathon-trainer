import type { Client, Constraint, EventRules, MandateCheck, AssetClass } from './types';

export const CLASS_LABEL: Record<AssetClass, string> = { equity: 'Equities', bond: 'Bonds', cash: 'Cash & MM', fx: 'FX', commodity: 'Commodities' };

export function constraintKey(c: Constraint): string {
  switch (c.type) {
    case 'maxClass': return `maxClass:${c.cls}`;
    case 'minClass': return `minClass:${c.cls}`;
    case 'currencyMin': return `currencyMin:${c.currency}`;
    case 'excludeTag': return `excludeTag:${c.tag}`;
    default: return c.type;
  }
}
const pct = (x: number) => `${Math.round(x * 100)}%`;
export function constraintLabel(c: Constraint): string {
  switch (c.type) {
    case 'maxClass': return `Max ${pct(c.max)} ${CLASS_LABEL[c.cls].toLowerCase()}`;
    case 'minClass': return `Min ${pct(c.min)} ${CLASS_LABEL[c.cls].toLowerCase()}`;
    case 'maxSingleName': return `Max ${pct(c.max)} in one name`;
    case 'noShort': return 'No short selling';
    case 'maxLeverage': return c.max <= 1 ? 'No leverage' : `Max leverage ${c.max.toFixed(2)}x`;
    case 'currencyMin': return `Min ${pct(c.min)} in ${c.currency} assets`;
    case 'excludeTag': return c.label;
  }
}

/**
 * Evaluate a client mandate on portfolio weights (position value / NAV) plus the cash weight.
 * Used by the live session, the order ticket's pre-trade check and the optimal-path solver.
 */
export function evaluateMandate(client: Client, w: Record<string, number>, cashW: number, rules: EventRules): MandateCheck[] {
  const tol = rules.mandate.tolerance;
  const out: MandateCheck[] = [];
  for (const c of client.constraints) {
    let value = 0, limit = 0, ok = true, kind: MandateCheck['kind'] = 'max';
    switch (c.type) {
      case 'maxClass': {
        for (const a of rules.assets) if (a.cls === c.cls) value += Math.abs(w[a.id] ?? 0);
        if (c.cls === 'cash') value += Math.max(0, cashW);
        limit = c.max; ok = value <= limit + tol; break;
      }
      case 'minClass': {
        for (const a of rules.assets) if (a.cls === c.cls) value += w[a.id] ?? 0;
        if (c.cls === 'cash') value += Math.max(0, cashW);
        limit = c.min; kind = 'min'; ok = value >= limit - tol; break;
      }
      case 'maxSingleName': {
        for (const a of rules.assets) if (a.singleName) value = Math.max(value, Math.abs(w[a.id] ?? 0));
        limit = c.max; ok = value <= limit + tol; break;
      }
      case 'noShort': {
        for (const a of rules.assets) if ((w[a.id] ?? 0) < -1e-9) value += -(w[a.id] ?? 0);
        limit = 0; kind = 'flag'; ok = value <= 1e-9; break;
      }
      case 'maxLeverage': {
        for (const a of rules.assets) value += Math.abs(w[a.id] ?? 0);
        limit = c.max; ok = value <= limit + tol; break;
      }
      case 'currencyMin': {
        for (const a of rules.assets) if (a.currency === c.currency) value += Math.max(0, w[a.id] ?? 0);
        if (c.currency === rules.baseCurrency) value += Math.max(0, cashW);
        limit = c.min; kind = 'min'; ok = value >= limit - tol; break;
      }
      case 'excludeTag': {
        for (const a of rules.assets) if (a.tags?.includes(c.tag)) value += Math.abs(w[a.id] ?? 0);
        limit = 0; kind = 'flag'; ok = value <= 1e-9; break;
      }
    }
    const util = kind === 'max' ? (limit > 0 ? value / limit : value > 0 ? 2 : 0) : kind === 'min' ? (limit > 0 ? value / limit : 1) : ok ? 0 : 1;
    out.push({ key: constraintKey(c), label: constraintLabel(c), value, limit, ok, util, kind, breachTicks: 0 });
  }
  return out;
}

/** Total violation size (0 = compliant). Used as a penalty by the optimal-path solver. */
export function mandateViolation(checks: MandateCheck[]): number {
  let v = 0;
  for (const c of checks) if (!c.ok) v += c.kind === 'min' ? c.limit - c.value : c.kind === 'max' ? c.value - c.limit : 0.05 + c.value;
  return v;
}

/** Hard mode tightens numeric caps (config: difficulty.*.mandateTightness). */
export function tightenClient(client: Client, factor: number): Client {
  if (factor >= 1) return client;
  return {
    ...client,
    constraints: client.constraints.map((c) => {
      if (c.type === 'maxClass' || c.type === 'maxSingleName') return { ...c, max: Math.round(c.max * factor * 100) / 100 };
      if (c.type === 'maxLeverage') return { ...c, max: Math.round((1 + (c.max - 1) * factor) * 100) / 100 };
      return c;
    }),
  };
}
