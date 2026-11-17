import type { Difficulty, EventRules, NewsEvent, Scenario } from './types';
import { makeRng } from './path';

/**
 * Offline scenario generator (no AI). Composes a seeded scenario from a library of news templates so the
 * pool is never empty, even before the AI worker has ever run. AI-written scenarios are richer; these keep
 * practice available when the Mac is off.
 */
type Shocks = Record<string, number>;
type T = [cat: NewsEvent['category'], src: NewsEvent['source'], mag: NewsEvent['magnitude'], sent: number, headline: string, body: string, f: Shocks, a?: Shocks];

const NORMAL: T[] = [
  ['central_bank', 'central_bank', 'moderate', -1, 'Fed raises rates 25bp in a surprise move, says inflation risks are "tilted up"', 'The FOMC voted 10-2 to lift the federal funds target range. Futures had priced only a 15% chance of a hike.', { RATES: 0.0022, USD: 0.008, GEQ: -0.015, RISKOFF: 0.01 }],
  ['central_bank', 'central_bank', 'moderate', 1, 'Fed cuts rates 25bp and signals further easing if the labour market softens', 'The statement dropped the phrase "restrictive for some time". The dollar fell against all G10 peers.', { RATES: -0.0022, USD: -0.008, GEQ: 0.018 }],
  ['central_bank', 'central_bank', 'minor', -1, 'Fed minutes: "several" officials saw a case for tighter policy', 'Minutes of the last meeting were more hawkish than the press conference suggested, lifting front-end yields.', { RATES: 0.0007, USD: 0.003, GEQ: -0.006 }],
  ['central_bank', 'central_bank', 'minor', 1, 'Fed chair: policy is "well into restrictive territory", cuts can be considered', 'In testimony to Congress the chair said the committee does not need to wait for 2% inflation before easing.', { RATES: -0.0007, USD: -0.003, GEQ: 0.007 }],
  ['china_policy', 'central_bank', 'moderate', 1, 'PBoC cuts reserve requirement ratio by 50bp, freeing RMB 1 trillion of liquidity', 'The central bank said the move supports "reasonable growth in credit". Onshore bond yields fell.', { CNHK: 0.03 }, { USDCNH: 0.004 }],
  ['central_bank', 'central_bank', 'minor', -1, 'HKMA buys HKD 9bn to defend the peg; overnight HIBOR jumps', 'The aggregate balance will shrink as the HKMA defends the weak side of the band, tightening local liquidity.', { CNHK: -0.008 }, { SHKP: -0.015, HSBC: 0.006, USDHKD: -0.002 }],
  ['central_bank', 'central_bank', 'moderate', -1, 'Bank of Japan surprises with a rate hike; yen surges 2%', 'The BoJ lifted its policy rate and hinted at more. Exporters led Tokyo stocks sharply lower.', { USD: -0.01, RATES: 0.0008, GEQ: -0.008 }, { NKY: -0.03 }],
  ['central_bank', 'central_bank', 'minor', 1, 'ECB lowers deposit rate; Lagarde says disinflation is "well on track"', 'European equities extended gains after the decision, led by rate-sensitive sectors.', { GEQ: 0.004 }, { SX5E: 0.012 }],
  ['macro_data', 'wire', 'moderate', -1, 'US core CPI rises 0.5% m/m, well above the 0.3% consensus', 'Shelter and services drove the upside surprise. Traders pared bets on rate cuts this year.', { RATES: 0.0018, USD: 0.006, GEQ: -0.02, RISKOFF: 0.008 }],
  ['macro_data', 'wire', 'moderate', 1, 'US core CPI cools to 0.1% m/m; annual rate lowest in three years', 'The soft print revived hopes of a soft landing. Treasury yields fell across the curve.', { RATES: -0.0018, USD: -0.006, GEQ: 0.02 }],
  ['macro_data', 'wire', 'minor', 1, 'US GDP grows at a 3.4% annualised pace, beating forecasts', 'Consumer spending and business investment both surprised to the upside.', { GEQ: 0.008, RATES: 0.0006 }],
  ['macro_data', 'wire', 'minor', 1, 'China official manufacturing PMI climbs to 51.2, highest in 18 months', 'New orders and export orders both expanded. Iron ore and copper futures rallied in Asia.', { CNHK: 0.013, CMDTY: 0.015 }],
  ['macro_data', 'wire', 'minor', -1, 'China exports fall 7% y/y; producer prices deepen deflation', 'The data points to weak external demand and persistent overcapacity. The offshore yuan weakened.', { CNHK: -0.014, CMDTY: -0.012 }, { USDCNH: 0.003 }],
  ['china_policy', 'wire', 'major', 1, 'Politburo unveils RMB 2 trillion package to buy unsold homes and boost consumption', 'State media said policy will be "more forceful". Mainland property and consumer shares went limit-up.', { CNHK: 0.07, GEQ: 0.01, CMDTY: 0.03 }, { SHKP: 0.03 }],
  ['china_policy', 'wire', 'moderate', -1, 'Beijing drafts tough new rules for online platforms and gaming', 'The draft would cap in-game spending and tighten data rules, reviving memories of the 2021 crackdown.', { CNHK: -0.03 }, { TENCENT: -0.05 }],
  ['china_policy', 'wire', 'minor', 1, 'China extends EV purchase-tax exemption for three more years', 'The finance ministry said the extension supports "new quality productive forces".', { CNHK: 0.004 }, { BYD: 0.025 }],
  ['china_policy', 'wire', 'moderate', -1, 'Major mainland developer misses offshore bond coupon, trading suspended', 'Creditors say talks have stalled. Contagion fears hit Hong Kong property and bank shares.', { CNHK: -0.035, CREDIT: 0.003, RISKOFF: 0.015 }, { SHKP: -0.03 }],
  ['geopolitics', 'wire', 'major', -1, 'US to impose sweeping new tariffs on Chinese goods within 30 days', 'The White House cited "unfair trade practices". Beijing promised "resolute countermeasures".', { CNHK: -0.06, GEQ: -0.025, RISKOFF: 0.04, USD: 0.008 }, { USDCNH: 0.01 }],
  ['geopolitics', 'wire', 'moderate', 1, 'Washington and Beijing agree a framework to roll back tariffs in stages', 'Negotiators said both sides will suspend planned increases. Asian markets rallied on the news.', { CNHK: 0.04, GEQ: 0.015, RISKOFF: -0.02 }, { USDCNH: -0.006 }],
  ['geopolitics', 'wire', 'moderate', -1, 'Tanker attacked in the Strait of Hormuz; insurers halt cover for Gulf shipping', 'About a fifth of the world\'s oil passes through the strait. Brent jumped in early trade.', { CMDTY: 0.06, RISKOFF: 0.03, GEQ: -0.012 }],
  ['geopolitics', 'wire', 'minor', 1, 'Ceasefire agreed in the Gulf; shipping lanes to reopen within days', 'Oil gave back part of its risk premium while equities edged higher.', { CMDTY: -0.02, RISKOFF: -0.012, GEQ: 0.006 }],
  ['earnings', 'filing', 'minor', 1, 'Tencent quarterly profit beats estimates as gaming and ad revenue accelerate', 'The company also raised its buyback programme. Results were filed after the Hong Kong close.', { CNHK: 0.005 }, { TENCENT: 0.022 }],
  ['earnings', 'filing', 'minor', -1, 'HSBC books larger-than-expected charge on Hong Kong commercial real estate', 'Expected credit losses rose sharply. Management kept its return-on-equity target unchanged.', { CNHK: -0.003 }, { HSBC: -0.025 }],
  ['earnings', 'filing', 'moderate', 1, 'US megacap tech earnings smash forecasts on AI demand; guidance raised', 'Cloud revenue grew 35%. Nasdaq futures jumped in after-hours trading.', { GEQ: 0.012 }, { NDX: 0.025 }],
  ['earnings', 'filing', 'moderate', -1, 'Chip leader cuts revenue outlook, citing an AI spending "digestion phase"', 'Shares fell 9% after hours and dragged the wider semiconductor sector lower.', { GEQ: -0.012 }, { NDX: -0.03 }],
  ['earnings', 'filing', 'minor', 1, 'AIA new business value jumps 20% on mainland visitor demand', 'The insurer also announced an additional share buyback.', {}, { AIA: 0.028 }],
  ['earnings', 'filing', 'minor', -1, 'BYD margins squeezed as EV price war deepens; quarterly profit drops', 'The company cut prices on several models for the third time this year.', {}, { BYD: -0.028 }],
  ['earnings', 'filing', 'minor', -1, 'Sun Hung Kai Properties cuts flat prices 12% at flagship launch', 'Analysts said the discount signals weak demand as mortgage rates stay high.', { CNHK: -0.003 }, { SHKP: -0.026 }],
  ['commodities', 'wire', 'minor', -1, 'US crude inventories post biggest build in two years; oil slides', 'Demand worries weigh on energy as refiners cut runs.', { CMDTY: -0.02, GEQ: -0.004 }],
  ['credit', 'wire', 'major', -1, 'Mid-sized US bank seized by regulators after a deposit run', 'It is the largest US bank failure in years. Investors rushed into Treasuries and gold.', { CREDIT: 0.012, RISKOFF: 0.07, GEQ: -0.035, RATES: -0.003, USD: -0.004 }, { HSBC: -0.03 }],
  ['credit', 'wire', 'minor', -1, 'Rating agency warns of a rising default wave in US high-yield borrowers', 'It expects the speculative-grade default rate to climb over the next year.', { CREDIT: 0.001, GEQ: -0.004 }],
  ['credit', 'wire', 'minor', 1, 'Record demand for new corporate bond deals; credit spreads grind tighter', 'Order books were five times covered, a sign of strong risk appetite.', { CREDIT: -0.001, GEQ: 0.004 }],
];
const CONFLICTING: T[] = [
  ['macro_data', 'wire', 'moderate', 0, 'US retail sales surge; stocks rise but Treasury yields jump on "no landing" bets', 'Strong growth is good for earnings but makes rate cuts less likely. Bonds sold off.', { GEQ: 0.006, RATES: 0.0015, USD: 0.005 }],
  ['macro_data', 'wire', 'minor', 0, 'US payrolls miss badly: bonds rally on rate-cut hopes, cyclicals wobble', 'Only 35k jobs were added. Weak growth is bad for profits but pulls yields down.', { RATES: -0.0008, USD: -0.003, GEQ: -0.003, RISKOFF: 0.004 }],
  ['commodities', 'wire', 'moderate', 0, 'OPEC+ agrees a surprise 1m bpd output cut', 'Higher oil helps producers but squeezes consumers and adds to inflation worries.', { CMDTY: 0.05, GEQ: -0.003 }],
  ['china_policy', 'central_bank', 'minor', 0, 'PBoC trims lending rate, but the yuan slides to a one-year low', 'Easier policy supports growth, yet the wider rate gap with the US pressures the currency.', { CNHK: 0.005, USD: 0.002 }, { USDCNH: 0.008 }],
];
const SLOW: T[] = [
  ['central_bank', 'wire', 'moderate', -1, 'HIBOR grinds to a multi-year high as capital drifts out of Hong Kong', 'Banks expect funding costs to keep rising for weeks. Developers and mortgage borrowers feel it most.', { CNHK: -0.02, RATES: 0.001 }, { SHKP: -0.03, USDHKD: 0.004 }],
  ['earnings', 'wire', 'moderate', 1, 'Analysts keep lifting profit forecasts as the AI investment cycle broadens', 'Upgrades have spread from chipmakers to industrials and utilities over recent weeks.', { GEQ: 0.03 }, { NDX: 0.02 }],
  ['credit', 'wire', 'moderate', -1, 'Banks are quietly tightening lending standards, survey shows', 'Credit conditions typically lead the economy by a few months.', { CREDIT: 0.004, GEQ: -0.02 }],
];
/** Rumour + denial pairs. */
const FAKEOUTS: [T, T][] = [
  [['central_bank', 'rumour', 'moderate', 1, 'Sources: Fed officials discussing an emergency inter-meeting rate cut', 'Two people familiar with the matter said talks were "preliminary". The Fed declined to comment.', { RATES: -0.002, GEQ: 0.015, USD: -0.006 }],
   ['central_bank', 'central_bank', 'moderate', -1, 'Fed governor: "no discussion" of an emergency cut, policy is in a good place', 'The on-the-record remarks contradicted an earlier report that had lifted markets.', { RATES: 0.0018, GEQ: -0.014, USD: 0.005 }]],
  [['china_policy', 'rumour', 'moderate', 1, 'Sources: Beijing weighing a RMB 3 trillion consumption stimulus', 'Unverified chatter circulating on trading desks says an announcement could come within days.', { CNHK: 0.04, CMDTY: 0.015 }],
   ['china_policy', 'wire', 'moderate', -1, 'State media: report of mega-stimulus is "inaccurate"; policy to stay targeted', 'The official denial sent mainland and Hong Kong shares back down.', { CNHK: -0.036, CMDTY: -0.012 }]],
  [['central_bank', 'rumour', 'moderate', -1, 'Traders say hedge funds are betting the HKMA will widen the peg band', 'Options pricing shows rising demand for protection against a move in USD/HKD.', { CNHK: -0.025, RISKOFF: 0.01 }, { USDHKD: 0.003 }],
   ['central_bank', 'central_bank', 'moderate', 1, 'HKMA: the Linked Exchange Rate System "will not change"', 'The authority said it has ample reserves and no intention of altering the band.', { CNHK: 0.022, RISKOFF: -0.008 }, { USDHKD: -0.003 }]],
  [['credit', 'rumour', 'moderate', -1, 'Market talk: a large Hong Kong developer is seeking emergency bank waivers', 'The unconfirmed report hit property shares and local credit.', { CNHK: -0.02, CREDIT: 0.002 }, { SHKP: -0.04 }],
   ['credit', 'filing', 'moderate', 1, 'Developer denies waiver talk in exchange filing, says liquidity is "ample"', 'The company said it has HKD 20bn of undrawn facilities and no covenant issues.', { CNHK: 0.018, CREDIT: -0.0018 }, { SHKP: 0.036 }]],
];
const REGIMES: Scenario['regime'][] = [
  { name: 'Goldilocks', description: 'Growth is steady, inflation is drifting lower and central banks are relaxed. Volatility is low.', factorDrift: { GEQ: 0.04, RATES: -0.002 }, volMult: 0.85 },
  { name: 'Late-cycle inflation', description: 'Inflation is sticky and central banks lean hawkish. Bonds and rate-sensitive stocks are under pressure.', factorDrift: { RATES: 0.004, GEQ: -0.03, USD: 0.02 }, volMult: 1.15 },
  { name: 'China reflation', description: 'Beijing is easing and money is rotating back into China and Hong Kong assets. Commodities are firm.', factorDrift: { CNHK: 0.1, CMDTY: 0.06 }, volMult: 1.0 },
  { name: 'Growth scare', description: 'Data is rolling over and investors are nervous. Safe havens are bid, credit is fragile.', factorDrift: { GEQ: -0.1, RISKOFF: 0.04, RATES: -0.004, CREDIT: 0.004 }, volMult: 1.3 },
  { name: 'Range-bound markets', description: 'No clear trend: markets chop sideways and react headline by headline.', factorDrift: { GEQ: -0.05 }, volMult: 1.0 },
];

export function proceduralScenario(seed: string, difficulty: Difficulty, rules: EventRules): Scenario {
  const rng = makeRng(`proc|${seed}|${difficulty}`);
  const d = rules.difficulty[difficulty];
  const shuffle = <X,>(arr: X[]): X[] => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const total = rng.int(d.events[0], d.events[1]);
  const nFake = Math.min(rng.int(d.fakeouts[0], d.fakeouts[1]), Math.floor(total / 4));
  const nConf = rng.int(d.conflicting[0], Math.min(d.conflicting[1], CONFLICTING.length));
  const nSlow = difficulty === 'easy' ? 0 : rng.int(0, 2);
  const nNormal = Math.max(1, total - 2 * nFake - nConf - nSlow);
  type Slot = { tpl: T; kind: NewsEvent['kind']; denial?: T };
  const slots: Slot[] = shuffle([
    ...shuffle(NORMAL).slice(0, nNormal).map((tpl) => ({ tpl, kind: 'normal' as const })),
    ...shuffle(CONFLICTING).slice(0, nConf).map((tpl) => ({ tpl, kind: 'conflicting' as const })),
    ...shuffle(SLOW).slice(0, nSlow).map((tpl) => ({ tpl, kind: 'slow_burn' as const })),
    ...shuffle(FAKEOUTS).slice(0, nFake).map(([tpl, denial]) => ({ tpl, kind: 'fakeout' as const, denial })),
  ]);
  const [w0, w1] = [rules.validation.eventWindow[0] + 0.02, rules.validation.eventWindow[1] - 0.02];
  const width = (w1 - w0) / slots.length;
  const jit = (s: Shocks | undefined) => { const k = 0.8 + rng.uniform() * 0.35; return Object.fromEntries(Object.entries(s ?? {}).map(([a, b]) => [a, +(b * k).toPrecision(3)])); };
  const events: NewsEvent[] = [];
  const mk = (tpl: T, kind: NewsEvent['kind'], t: number, linkedTo?: string): NewsEvent => {
    const e: NewsEvent = { id: `e${events.length + 1}`, t: +t.toFixed(4), headline: tpl[4], body: tpl[5], source: tpl[1], category: tpl[0], magnitude: tpl[2], kind, sentiment: tpl[3], factorShocks: jit(tpl[6]), assetShocks: tpl[7] ? jit(tpl[7]) : undefined, linkedTo };
    events.push(e);
    return e;
  };
  slots.forEach((s, i) => {
    const start = w0 + i * width;
    if (s.denial) {
      const r = mk(s.tpl, 'fakeout', start + rng.uniform() * 0.15 * width);
      mk(s.denial, 'denial', start + (0.6 + rng.uniform() * 0.1) * width, r.id);
    } else mk(s.tpl, s.kind, start + rng.uniform() * 0.45 * width);
  });
  const regime = rng.pick(REGIMES);
  const themes = [...new Set(events.filter((e) => e.magnitude !== 'minor').map((e) => e.category.replace('_', ' ')))].slice(0, 3);
  return {
    id: `proc-${difficulty}-${seed}`,
    title: `${regime.name} #${seed.slice(-4).toUpperCase()}`,
    source: 'synthetic', difficulty, generator: 'procedural',
    storyline: `${regime.description} Over the year the main drivers are ${themes.join(', ') || 'mixed macro data'}. Read each headline, decide which assets it moves and whether it fits your client.`,
    regime, events,
  };
}
