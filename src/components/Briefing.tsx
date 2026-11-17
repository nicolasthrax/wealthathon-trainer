'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionRunner } from '@engine/runner';
import { constraintLabel, evaluateMandate } from '@engine/mandate';
import { tickLabel } from '@engine/path';
import { MandateMeter } from './terminal/panels';
import { fmtClock, fmtMoney, fmtPx, GOAL_LABEL } from '@/lib/format';

const RISK_LABEL = ['', 'Very conservative', 'Conservative', 'Balanced', 'Growth', 'Aggressive'];

export function ClientCard({ client }: { client: SessionRunner['client'] }) {
  return (
    <div className="clientcard">
      <div className="small dim" style={{ letterSpacing: '0.1em' }}>PRIVATE BANKING · CLIENT ONBOARDING</div>
      <div className="nm">{client.name}</div>
      <div className="dim small">{client.occupation}</div>
      <dl>
        <dt>Age</dt><dd>{client.age}</dd>
        <dt>Investable</dt><dd className="num">HKD {fmtMoney(client.wealthHKD)}</dd>
        <dt>Goal</dt><dd><b>{GOAL_LABEL[client.goal]}</b><div className="small dim">{client.goalDetail}</div></dd>
        <dt>Risk profile</dt><dd><b>{client.riskProfile}/5</b> · {RISK_LABEL[client.riskProfile]}</dd>
        <dt>Horizon</dt><dd>{client.horizonYears} years</dd>
      </dl>
      <div className="small" style={{ marginBottom: 8 }}>{client.notes}</div>
      <h3>Hard constraints</h3>
      <ul className="small">{client.constraints.map((c, i) => <li key={i}><b>{constraintLabel(c)}</b></li>)}</ul>
    </div>
  );
}

export function Briefing({ runner, title, storyline, disguise, onStart }: {
  runner: SessionRunner; title: string; storyline: string; disguise: boolean; onStart: (weights: Record<string, number>) => void;
}) {
  const rules = runner.rules;
  const [left, setLeft] = useState(rules.clock.briefingSeconds);
  const [w, setW] = useState<Record<string, string>>({});
  const started = useRef(false);
  const weights = useMemo((): Record<string, number> => Object.fromEntries(Object.entries(w).map(([k, v]) => [k, (Number(v) || 0) / 100]).filter(([, v]) => v)), [w]);
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  const gross = Object.values(weights).reduce((a, b) => a + Math.abs(b), 0);
  const checks = evaluateMandate(runner.client, weights, 1 - sum, rules);
  const start = () => { if (started.current) return; started.current = true; onStart(weights); };
  const startRef = useRef(start); startRef.current = start;

  useEffect(() => {
    if (rules.clock.briefingSeconds <= 0) return;
    const t0 = Date.now();
    const iv = setInterval(() => {
      const l = rules.clock.briefingSeconds - (Date.now() - t0) / 1000;
      setLeft(l);
      if (l <= 0) { clearInterval(iv); startRef.current(); }
    }, 250);
    return () => clearInterval(iv);
  }, [rules.clock.briefingSeconds]);

  let lastGroup = '';
  return (
    <div className="brief">
      <div className="term" style={{ height: 46, display: 'block' }}>
        <div className="top" style={{ height: 46 }}>
          <span className="ttl">BRIEFING · {title}</span>
          <div className="stat clock"><span>Clock starts in</span><b className={left < 30 ? 'amber' : ''}>{fmtClock(left)}</b></div>
          <span className="dim small">Read the client, plan your opening allocation. Unallocated money stays in cash (earns nothing; HKDMM earns the money-market rate).</span>
          <span style={{ flex: 1 }} />
          <button className="primary" onClick={start}>Start the clock now ▶</button>
        </div>
      </div>
      <div className="cols">
        <div><ClientCard client={runner.client} /></div>
        <div>
          <h3>Starting regime</h3>
          <div className="card" style={{ marginBottom: 12 }}>
            <b>{runner.scenario.regime.name}</b>
            <p className="small" style={{ margin: '6px 0 0' }}>{runner.scenario.regime.description}</p>
          </div>
          <h3>Background</h3>
          <p className="small" style={{ marginTop: 0 }}>{storyline}</p>
          <h3>Event rules (from config)</h3>
          <ul className="small" style={{ paddingLeft: 18, marginTop: 0 }}>
            <li>Starting capital <b>HKD {fmtMoney(rules.startingCapital)}</b>. One session = one simulated year ({tickLabel(runner.N, rules, runner.scenario, disguise).split('/')[1] ?? ''} trading days).</li>
            <li>{runner.scenario.events.length} headlines over the year. Prices react over a few ticks after each one.</li>
            <li>Market and limit orders. Shorting {rules.shorting.allowed ? 'allowed' : 'not allowed'}; leverage up to {rules.margin.allowed ? `${rules.margin.maxLeverage}x` : '1x'} (if the client allows it).
              Margin call below {Math.round(rules.margin.maintenanceFactor * 100)}% of initial margin, then forced liquidation after {rules.margin.marginCallGraceTicks} ticks.</li>
            <li>Transaction costs: {rules.costs.enabled ? `ON (${rules.costs.commissionBps}bp commission + spread)` : 'off'}.</li>
            <li>Mandate breaches start costing score after {rules.mandate.breachGraceTicks} ticks.</li>
            <li>Score: {Math.round(rules.scoring.weights.return * 100)}% return · {Math.round(rules.scoring.weights.sortino * 100)}% Sortino · {Math.round(rules.scoring.weights.drawdown * 100)}% max drawdown · {Math.round(rules.scoring.weights.mandate * 100)}% mandate.</li>
          </ul>
          <h3>Factor cheat-sheet</h3>
          <table className="t small">
            <tbody>
              <tr><td>Rates ↑ (hawkish Fed, hot CPI)</td><td>Long bonds ↓↓, HK property ↓, tech ↓, gold ↓, USD ↑, HSBC ↑</td></tr>
              <tr><td>China stimulus</td><td>HSCEI, Tencent, BYD ↑↑, HSI ↑, commodities ↑, CNH can weaken</td></tr>
              <tr><td>Risk-off (crisis, war)</td><td>Equities ↓, HY credit ↓, Treasuries ↑, gold ↑, oil ↓ (unless supply shock)</td></tr>
              <tr><td>Oil supply shock</td><td>Brent ↑↑, equities ↓ a bit, inflation fears</td></tr>
              <tr><td>USD/HKD</td><td>Pegged at 7.75-7.85: barely moves. HIBOR follows US rates.</td></tr>
            </tbody>
          </table>
        </div>
        <div style={{ borderRight: 0 }}>
          <h3>Opening allocation (% of NAV, negative = short)</h3>
          <table className="alloc small">
            <tbody>
              {rules.assets.filter((a) => runner.path.prices[a.id]).map((a) => {
                const rows = [];
                if (a.group !== lastGroup) { lastGroup = a.group; rows.push(<tr key={`g${a.group}`} className="g"><td colSpan={3}>{a.group}</td></tr>); }
                rows.push(
                  <tr key={a.id}>
                    <td><b>{a.ticker}</b> <span className="dim">{a.name}</span>{a.tags?.length ? <span className="tag plain" style={{ marginLeft: 4 }}>{a.tags.join(',')}</span> : null}</td>
                    <td className="num dim" style={{ textAlign: 'right' }}>{fmtPx(runner.price(a.id, 0), a.decimals)}</td>
                    <td style={{ textAlign: 'right' }}><input value={w[a.id] ?? ''} placeholder="0" inputMode="decimal" onChange={(e) => setW({ ...w, [a.id]: e.target.value.replace(/[^\d.-]/g, '') })} aria-label={`${a.ticker} weight`} /></td>
                  </tr>,
                );
                return rows;
              })}
            </tbody>
          </table>
          <div className="row small" style={{ justifyContent: 'space-between', margin: '8px 0' }}>
            <span>Invested <b className="num">{(sum * 100).toFixed(0)}%</b> · Gross <b className="num">{(gross * 100).toFixed(0)}%</b> · Cash <b className="num">{((1 - sum) * 100).toFixed(0)}%</b></span>
            <button onClick={() => setW({})} style={{ padding: '2px 8px', fontSize: 11 }}>Clear</button>
          </div>
          <h3>Mandate check</h3>
          <div style={{ display: 'grid', gap: 5 }}>{checks.map((c) => <MandateMeter key={c.key} c={c} grace={rules.mandate.breachGraceTicks} />)}</div>
          {checks.some((c) => !c.ok) && <p className="note small">Your plan breaches the mandate. Fix it before the clock runs or you will lose mandate score.</p>}
          <button className="primary" style={{ width: '100%', marginTop: 12, padding: 10 }} onClick={start}>Invest &amp; start the clock ▶</button>
        </div>
      </div>
    </div>
  );
}
