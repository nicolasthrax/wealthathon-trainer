import type { NewsEvent, Scenario } from '@engine/types';

/** Hand-written synthetic scenarios: always available, no AI needed. */
type S = Record<string, number>;
let n = 0;
const ev = (t: number, source: NewsEvent['source'], category: NewsEvent['category'], magnitude: NewsEvent['magnitude'], sentiment: number,
  headline: string, body: string, factorShocks: S, assetShocks?: S, kind: NewsEvent['kind'] = 'normal', linkedTo?: string): NewsEvent =>
  ({ id: `e${++n}`, t, source, category, magnitude, sentiment, headline, body, factorShocks, assetShocks, kind, linkedTo });
const start = () => { n = 0; };

start();
const softLanding: Scenario = {
  id: 'seed-soft-landing', title: 'Soft Landing', source: 'synthetic', difficulty: 'easy', generator: 'hand-written',
  storyline: 'US inflation is finally fading and the Fed is ready to cut. China is easing gently and trade tensions are calming. A friendly year for risk assets, with a few bumps: an oil supply cut, one weak jobs report and a Hong Kong property scare at HSBC.',
  regime: { name: 'Goldilocks', description: 'Steady growth, falling inflation, central banks turning supportive. Volatility is low and trends persist.', factorDrift: { GEQ: 0.04, RATES: -0.003 }, volMult: 0.85 },
  events: [
    ev(0.06, 'wire', 'macro_data', 'minor', 1, 'US core inflation cools to 2.6%, lowest in three years', 'Shelter costs slowed for a fourth month. Rate futures now price two Fed cuts by year-end.', { RATES: -0.0007, USD: -0.003, GEQ: 0.008 }),
    ev(0.14, 'central_bank', 'central_bank', 'moderate', 1, 'Fed cuts rates by 25bp, signals more easing ahead', 'The vote was unanimous. The statement said risks to employment and inflation are "roughly in balance".', { RATES: -0.002, USD: -0.007, GEQ: 0.015 }),
    ev(0.23, 'filing', 'earnings', 'minor', 1, 'Tencent Q2 profit beats estimates on gaming and AI cloud demand', 'Revenue rose 14% year on year. The company lifted its annual buyback to HKD 120bn.', { CNHK: 0.005 }, { TENCENT: 0.022 }),
    ev(0.32, 'central_bank', 'china_policy', 'moderate', 1, 'PBoC trims reserve requirement ratio by 50bp to support growth', 'The cut releases about RMB 1 trillion of long-term liquidity. The offshore yuan slipped slightly.', { CNHK: 0.03 }, { USDCNH: 0.004 }),
    ev(0.42, 'wire', 'commodities', 'moderate', 0, 'OPEC+ announces surprise 1m bpd output cut', 'Brent jumped on the news. Higher fuel costs help producers but squeeze consumers and airlines.', { CMDTY: 0.05, GEQ: -0.003 }, undefined, 'conflicting'),
    ev(0.52, 'wire', 'macro_data', 'minor', -1, 'US payrolls miss: economy adds just 40k jobs', 'Unemployment ticked up to 4.4%. Stocks dipped on growth worries while Treasuries rallied.', { RATES: -0.0008, GEQ: -0.006, RISKOFF: 0.006, USD: -0.003 }),
    ev(0.62, 'filing', 'earnings', 'minor', -1, 'HSBC flags higher provisions on Hong Kong commercial property', 'Expected credit losses rose to USD 1.1bn. Office vacancies in Central remain near record highs.', { CNHK: -0.003 }, { HSBC: -0.025, SHKP: -0.015 }),
    ev(0.72, 'central_bank', 'central_bank', 'moderate', 1, 'Fed delivers second cut; chair says inflation fight is "largely won"', 'Officials pencilled in two more cuts next year. The dollar index fell to a 10-month low.', { RATES: -0.0018, USD: -0.006, GEQ: 0.012 }),
    ev(0.82, 'wire', 'geopolitics', 'moderate', 1, 'US and China agree to extend tariff truce by 12 months', 'Both sides will keep current tariff rates frozen and reopen talks on technology export controls.', { CNHK: 0.035, GEQ: 0.012, RISKOFF: -0.02 }, { USDCNH: -0.005 }),
    ev(0.91, 'wire', 'macro_data', 'minor', 1, 'China manufacturing PMI climbs to 51.4, a two-year high', 'New export orders returned to expansion. Copper and iron ore extended gains.', { CNHK: 0.013, CMDTY: 0.015 }),
  ],
};

start();
const tariffShock: Scenario = {
  id: 'seed-tariff-shock', title: 'Tariff Shock', source: 'synthetic', difficulty: 'medium', generator: 'hand-written',
  storyline: 'A fragile calm breaks when Washington announces sweeping tariffs on China. Beijing retaliates, exports slump and markets swing on every hint of stimulus, including one rumour that turns out to be false. Late in the year real stimulus and a leaders\' meeting change the mood. The Fed is stuck between tariff inflation and weaker growth.',
  regime: { name: 'Late-cycle, fragile calm', description: 'Growth is slowing and valuations are stretched. There is no strong trend, so headlines drive prices.', factorDrift: { GEQ: -0.05 }, volMult: 1.1 },
  events: [
    ev(0.05, 'wire', 'geopolitics', 'minor', -1, 'Washington opens trade probe into Chinese EV and battery imports', 'The Commerce Department said the investigation could lead to new duties within months.', { CNHK: -0.008 }, { BYD: -0.02 }),
    ev(0.11, 'wire', 'geopolitics', 'major', -1, 'US announces 60% tariffs on all Chinese goods, effective in 30 days', 'The White House cited national security. Economists estimate the move could cut China\'s GDP growth by up to 2 points.', { CNHK: -0.06, GEQ: -0.025, RISKOFF: 0.04, USD: 0.008 }, { USDCNH: 0.01 }),
    ev(0.16, 'wire', 'china_policy', 'moderate', -1, 'Beijing retaliates with export controls on rare earths', 'The commerce ministry said licences will be required for seven rare-earth elements used in chips and EV motors.', { GEQ: -0.015, CNHK: -0.02, RISKOFF: 0.015 }, { NDX: -0.01 }),
    ev(0.22, 'central_bank', 'central_bank', 'minor', 1, 'PBoC sets yuan fixing stronger than expected, vows a "basically stable" currency', 'The fixing was 400 pips stronger than models predicted, a signal that Beijing will not use devaluation as a weapon.', { CNHK: 0.008 }, { USDCNH: -0.006 }),
    ev(0.29, 'rumour', 'china_policy', 'moderate', 1, 'Sources: Beijing weighing RMB 3 trillion consumption stimulus', 'Unverified chatter on trading desks says the State Council could announce a package this week.', { CNHK: 0.04, CMDTY: 0.015 }, undefined, 'fakeout'),
    ev(0.33, 'wire', 'china_policy', 'moderate', -1, 'State media: report of mega-stimulus "inaccurate", policy to stay targeted', 'An official commentary said China will not resort to "flood-like" stimulus.', { CNHK: -0.036, CMDTY: -0.012 }, undefined, 'denial', 'e5'),
    ev(0.4, 'wire', 'macro_data', 'moderate', -1, 'China exports plunge 9% y/y as front-loading fades', 'Shipments to the US fell 31%. Producer prices dropped for a 30th straight month.', { CNHK: -0.025, CMDTY: -0.02 }, { USDCNH: 0.004 }),
    ev(0.46, 'central_bank', 'central_bank', 'moderate', 0, 'Fed holds rates; warns tariffs raise both inflation and unemployment risks', 'The chair said the committee is "well positioned to wait". Markets had hoped for a clearer easing signal.', { RATES: 0.0008, GEQ: -0.006, USD: 0.003 }, undefined, 'conflicting'),
    ev(0.53, 'filing', 'earnings', 'minor', -1, 'Major iPhone supplier cuts guidance citing tariff costs; Nasdaq futures slide', 'The company expects gross margin to fall 3 points next quarter.', { GEQ: -0.008 }, { NDX: -0.015 }),
    ev(0.6, 'wire', 'credit', 'minor', -1, 'Rating agency warns of rising defaults among US importers; high-yield spreads widen', 'Retailers and auto-parts makers are most exposed to higher input costs.', { CREDIT: 0.001, GEQ: -0.004 }),
    ev(0.67, 'wire', 'china_policy', 'major', 1, 'Politburo unveils RMB 2 trillion package: home purchases and consumer vouchers', 'State media said fiscal policy will be "more proactive". Mainland property shares went limit-up.', { CNHK: 0.07, GEQ: 0.01, CMDTY: 0.03 }, { SHKP: 0.03 }),
    ev(0.74, 'filing', 'earnings', 'minor', 1, 'BYD overseas sales double as it pivots to Europe and Southeast Asia', 'Exports now make up a quarter of volume, cushioning the company from US tariffs.', {}, { BYD: 0.028 }),
    ev(0.81, 'wire', 'geopolitics', 'moderate', 1, 'US and Chinese leaders to meet; officials signal a tariff rollback framework', 'Negotiators have reportedly agreed the outline of a phased reduction.', { CNHK: 0.04, GEQ: 0.015, RISKOFF: -0.02 }, { USDCNH: -0.006 }),
    ev(0.87, 'wire', 'macro_data', 'minor', -1, 'US CPI jumps 0.5% m/m as tariff costs pass through to consumers', 'Core goods prices rose the most in three years. Rate-cut bets were trimmed.', { RATES: 0.0008, USD: 0.003, GEQ: -0.008 }),
    ev(0.93, 'central_bank', 'central_bank', 'minor', 1, 'Fed governor: tariff inflation is "transitory", cuts still on the table', 'He said policy should look through a one-off rise in the price level.', { RATES: -0.0007, GEQ: 0.007, USD: -0.003 }),
  ],
};

start();
const stagflation: Scenario = {
  id: 'seed-stagflation-squeeze', title: 'Stagflation Squeeze & Peg Jitters', source: 'synthetic', difficulty: 'hard', generator: 'hand-written',
  storyline: 'US inflation re-accelerates just as an oil shock hits. The Fed hikes again, Hong Kong interest rates follow because of the peg, and speculators start whispering about the peg itself. Mid-year a US bank fails and policy makers scramble. Expect rumours that get denied, data that is good and bad at once, and a slow squeeze on Hong Kong property.',
  regime: { name: 'Sticky inflation, tight money', description: 'Inflation is above target and central banks are still tightening. Volatility is elevated and safe havens are unreliable because bonds fall when rates rise.', factorDrift: { RATES: 0.004, GEQ: -0.05 }, volMult: 1.25 },
  events: [
    ev(0.04, 'wire', 'macro_data', 'moderate', -1, 'US CPI re-accelerates to 4.1%; services inflation hottest since 2023', 'Core prices rose 0.5% on the month. Two-year Treasury yields jumped.', { RATES: 0.0018, USD: 0.006, GEQ: -0.02, RISKOFF: 0.008 }),
    ev(0.08, 'wire', 'commodities', 'moderate', -1, 'Drone strike shuts key Gulf export terminal; Brent spikes', 'The terminal handles about 4m barrels a day. Repairs could take weeks.', { CMDTY: 0.06, RISKOFF: 0.03, GEQ: -0.012 }),
    ev(0.12, 'central_bank', 'central_bank', 'moderate', -1, 'Fed hikes 25bp in surprise move, drops reference to future cuts', 'The chair said the committee "cannot rule out" further increases.', { RATES: 0.0022, USD: 0.008, GEQ: -0.015, RISKOFF: 0.01 }),
    ev(0.16, 'wire', 'central_bank', 'moderate', -1, 'HIBOR grinds to 17-year high as capital leaves Hong Kong', 'Banks expect funding costs to keep rising for weeks. Mortgage rates are being repriced higher.', { CNHK: -0.02, RATES: 0.001 }, { SHKP: -0.03, USDHKD: 0.004 }, 'slow_burn'),
    ev(0.21, 'rumour', 'central_bank', 'moderate', -1, 'Traders say hedge funds are betting the HKMA will be forced to widen the peg band', 'One-year USD/HKD forwards moved outside the band for the first time in years.', { CNHK: -0.025, RISKOFF: 0.01 }, { USDHKD: 0.003 }, 'fakeout'),
    ev(0.24, 'central_bank', 'central_bank', 'moderate', 1, 'HKMA: Linked Exchange Rate System "will not change"; buys HKD 12bn', 'The authority said reserves exceed USD 420bn, more than 1.7 times the monetary base.', { CNHK: 0.022, RISKOFF: -0.008 }, { USDHKD: -0.004 }, 'denial', 'e5'),
    ev(0.28, 'filing', 'earnings', 'minor', 1, 'HSBC net interest income beats as higher rates fatten margins', 'The bank raised its full-year income guidance and announced a USD 3bn buyback.', {}, { HSBC: 0.028 }),
    ev(0.32, 'filing', 'earnings', 'minor', -1, 'Sun Hung Kai cuts flat prices 15% at flagship launch', 'Agents said buyers are staying away as mortgage rates top 4.5%.', { CNHK: -0.004 }, { SHKP: -0.026 }),
    ev(0.36, 'wire', 'macro_data', 'moderate', 0, 'US retail sales surge 1.2%; Treasury yields jump on "no landing" bets', 'Strong spending supports earnings but makes further Fed hikes more likely.', { GEQ: 0.006, RATES: 0.0015, USD: 0.005 }, undefined, 'conflicting'),
    ev(0.41, 'wire', 'credit', 'major', -1, 'Mid-sized US lender seized by regulators after deposit run', 'Unrealised losses on its bond portfolio wiped out capital. It is the biggest US bank failure in years.', { CREDIT: 0.012, RISKOFF: 0.07, GEQ: -0.035, RATES: -0.003, USD: -0.004 }, { HSBC: -0.03 }),
    ev(0.44, 'central_bank', 'central_bank', 'moderate', 1, 'Fed opens emergency liquidity facility; Treasury backs all deposits', 'Banks can borrow against bonds at par. Officials said the system is "sound and resilient".', { CREDIT: -0.004, RISKOFF: -0.035, GEQ: 0.02 }),
    ev(0.49, 'rumour', 'central_bank', 'moderate', 1, 'Sources: Fed discussing an emergency inter-meeting rate cut', 'Two people familiar with the matter said the talks are preliminary. The Fed declined to comment.', { RATES: -0.002, GEQ: 0.015, USD: -0.006 }, undefined, 'fakeout'),
    ev(0.52, 'central_bank', 'central_bank', 'moderate', -1, 'New York Fed president: "no discussion" of an emergency cut; inflation still job one', 'He said financial-stability tools and interest-rate policy are separate.', { RATES: 0.0018, GEQ: -0.014, USD: 0.005 }, undefined, 'denial', 'e12'),
    ev(0.57, 'central_bank', 'china_policy', 'moderate', 1, 'PBoC cuts loan prime rate by 25bp, largest move since 2022', 'The five-year rate, the benchmark for mortgages, was cut by the same amount.', { CNHK: 0.03 }, { USDCNH: 0.004 }),
    ev(0.62, 'wire', 'china_policy', 'minor', 0, 'Yuan slides past 7.35 as PBoC easing widens rate gap with the US', 'Cheaper money helps growth, but a weaker currency raises capital-outflow worries.', { CNHK: -0.006, USD: 0.003 }, { USDCNH: 0.008 }, 'conflicting'),
    ev(0.67, 'wire', 'geopolitics', 'minor', 1, 'Gulf producers restore exports; ceasefire talks begin', 'The damaged terminal is back at 80% capacity, ahead of schedule.', { CMDTY: -0.02, RISKOFF: -0.012, GEQ: 0.006 }),
    ev(0.72, 'filing', 'earnings', 'moderate', -1, 'Chip giant slashes AI capex outlook; Nasdaq leaders tumble', 'Management cited customers "digesting" earlier orders and higher financing costs.', { GEQ: -0.012 }, { NDX: -0.03 }),
    ev(0.78, 'wire', 'macro_data', 'moderate', 1, 'US CPI drops to 3.2% as energy prices unwind', 'Core inflation slowed for the first time in six months.', { RATES: -0.0018, USD: -0.006, GEQ: 0.02 }),
    ev(0.84, 'wire', 'credit', 'minor', -1, 'Private credit fund gates withdrawals; high-yield spreads widen', 'The fund cited "elevated redemption requests" from wealthy investors.', { CREDIT: 0.001, GEQ: -0.004 }),
    ev(0.9, 'central_bank', 'central_bank', 'moderate', 1, 'Fed pauses; projections show two cuts next year', 'The chair said policy is now "sufficiently restrictive".', { RATES: -0.002, USD: -0.007, GEQ: 0.015 }),
    ev(0.95, 'filing', 'earnings', 'minor', 1, 'AIA new business value jumps 22% on mainland visitor demand', 'Margins widened and the insurer added USD 1bn to its buyback.', {}, { AIA: 0.028 }),
  ],
};

export const SEED_SCENARIOS: Scenario[] = [softLanding, tariffShock, stagflation];
