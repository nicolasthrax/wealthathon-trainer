import type { Lesson, LessonEvent } from '../../packages/engine/src/learn';
import type { Client, NewsEvent } from '../../packages/engine/src/types';

/**
 * The 10 guided lessons. Each one is an ordinary engine scenario (one simulated quarter) plus
 * decision points where the clock stops and you trade in the real terminal.
 * Shocks are hand-set within the validator's caps; `engine.test.ts` checks every lesson.
 */

type Opt = Partial<Pick<NewsEvent, 'source' | 'category' | 'magnitude' | 'sentiment' | 'kind' | 'linkedTo' | 'assetShocks'>> & { variants?: LessonEvent['variants'] };
const ev = (id: string, t: number, headline: string, body: string, factorShocks: Record<string, number>, o: Opt = {}): LessonEvent => ({
  id, t, headline, body, factorShocks, source: o.source ?? 'wire', category: o.category ?? 'macro_data', magnitude: o.magnitude ?? 'moderate',
  sentiment: o.sentiment ?? 0, kind: o.kind ?? 'normal', ...(o.linkedTo ? { linkedTo: o.linkedTo } : {}), ...(o.assetShocks ? { assetShocks: o.assetShocks } : {}),
  ...(o.variants ? { variants: o.variants } : {}),
});
const calm = (name: string, description: string) => ({ name, description, factorDrift: {}, volMult: 0.4 });
const client = (c: Partial<Client> & Pick<Client, 'id' | 'name' | 'constraints'>): Client => ({
  age: 45, occupation: 'Training client', wealthHKD: 10_000_000, goal: 'growth', goalDetail: 'Grow the portfolio steadily over the quarter.',
  riskProfile: 3, horizonYears: 3, notes: 'A practice client for this lesson.', ...c,
});

const EQUITIES = ['HSI', 'HSCEI', 'HSBC', 'TENCENT', 'AIA', 'BYD', 'SHKP', 'SPX', 'NDX', 'SX5E', 'NKY'];
const buyAll = (ids: string[]) => ids.map((assetId) => ({ assetId, dir: 1 as const }));
const sellAll = (ids: string[]) => ids.map((assetId) => ({ assetId, dir: -1 as const }));

export const LESSONS: Lesson[] = [
  // ── 1 ───────────────────────────────────────────────────────────────────
  {
    id: 'scoring', n: 1, title: 'How you\'re scored', minutes: 12, sessionMinutes: 4,
    summary: 'Return is only 35% of the score. Learn why losing less beats winning more.',
    concept: [
      'Your score is **35% return, 30% [[sortino]], 20% max [[drawdown]] and 15% [[mandate]]**. So 65% of the points are about risk, not profit.',
      '**Sortino** rewards steady gains: every losing tick counts against you, winning ticks don\'t. Trading on noise adds random losing days.',
      '**Drawdown** remembers your worst dip. One big loss you didn\'t cut stays on your record for the whole session.',
      '**Mandate**: break a client limit for more than a few ticks and you lose mandate points every tick until it\'s fixed.',
      'In this lesson you\'ll face three moments: a headline that is just noise, a scary crash, and a clear opportunity.',
    ],
    example: { title: 'Two traders, same +8% return', rows: [['Trader A: smooth ride, worst dip -2%', 'Sortino high, drawdown score ~92 → wins'], ['Trader B: swung to -9% then recovered', 'Sortino low, drawdown score ~64 → loses']] },
    playbooks: ['protect-downside'],
    takeaways: ['Not every headline is a trade: noise trades hurt Sortino.', 'Cut risk fast when a big shock hits: drawdown is remembered.', 'Still take clear opportunities: return is 35%.'],
    client: client({ id: 'lesson-client-1', name: 'Training account', constraints: [{ type: 'maxClass', cls: 'equity', max: 0.8 }, { type: 'maxLeverage', max: 1.2 }] }),
    opening: { HSI: 0.2, SPX: 0.2, NDX: 0.15, TENCENT: 0.1, AIA: 0.1, HKDMM: 0.15 },
    regime: calm('Late-cycle calm', 'Markets are calm and stocks have done well. Investors are relaxed, maybe too relaxed.'),
    storyline: 'A quiet quarter that turns: first some noise, then a shock, then the central bank steps in.',
    events: [
      ev('n1', 0.12, 'US jobs report mixed: hiring beats forecasts but wage growth cools', 'Payrolls rose more than expected while average hourly earnings slowed. Economists called the report "neither here nor there".',
        { GEQ: 0.003, RATES: -0.0002 }, { magnitude: 'minor', sentiment: 0, variants: [
          { headline: 'Euro-area PMI flat at 50.1, exactly in line with forecasts', body: 'Business activity in the euro area held steady, matching economists\' expectations.', factorShocks: { GEQ: 0.002 } },
          { headline: 'Japan core inflation steady at 2.0%, matching estimates', body: 'No surprise in Japan\'s price data; the yen and bonds barely reacted.', factorShocks: { GEQ: 0.002, RATES: 0.0002 } },
        ] }),
      ev('n2', 0.38, 'Major US lender collapses overnight; regulators seize it', 'A top-20 US bank failed after a run on deposits. Regulators took control at 2am. Futures point to a sharp fall across global stock markets.',
        { RISKOFF: 0.07, GEQ: -0.04, CREDIT: 0.006, RATES: -0.003, USD: 0.008 }, { magnitude: 'major', sentiment: -1, category: 'credit', variants: [
          { headline: 'Global clearing house misses margin calls; trading halted in several markets', body: 'A major clearing house failed to meet margin calls, freezing parts of the derivatives market. Panic selling spread across Asia and Europe.', factorShocks: { RISKOFF: 0.07, GEQ: -0.04, CREDIT: 0.006, RATES: -0.003, USD: 0.008 } },
          { headline: 'Surprise default at a top-10 Asian bank sparks global panic', body: 'A large Asian lender defaulted on its bonds. Investors fear contagion and are dumping stocks worldwide.', factorShocks: { RISKOFF: 0.065, GEQ: -0.035, CREDIT: 0.006, RATES: -0.0025, USD: 0.007 } },
        ] }),
      ev('n3', 0.68, 'Fed signals rate cuts are coming as inflation cools fast', 'The Fed chair said the committee "stands ready to cut" after inflation fell faster than forecast. Markets now price three cuts.',
        { RATES: -0.002, GEQ: 0.01, RISKOFF: -0.015, USD: -0.004 }, { source: 'central_bank', category: 'central_bank', sentiment: 1, variants: [
          { headline: 'US inflation drops to 2.1%; traders bet on early Fed cuts', body: 'Inflation came in well below forecasts. Bond yields fell sharply as markets priced in rate cuts.', factorShocks: { RATES: -0.002, GEQ: 0.01, RISKOFF: -0.012, USD: -0.004 } },
          { headline: 'Fed minutes: most officials see cuts "soon"', body: 'Minutes of the last meeting showed broad support for cutting rates within months.', factorShocks: { RATES: -0.0018, GEQ: 0.009, RISKOFF: -0.012, USD: -0.004 } },
        ] }),
      ev('n4', 0.88, 'Tech earnings season ends broadly in line with forecasts', 'Big tech results met expectations on average, with few surprises.', { GEQ: 0.003 }, { magnitude: 'minor', category: 'earnings' }),
    ],
    decisions: [
      { id: 'd1', at: { event: 'n1' }, playbookId: 'protect-downside',
        prompt: 'A headline just landed. Is it worth a trade? Remember: every losing tick counts against your Sortino.',
        expect: { flatOk: true, sizePctNav: [0, 3] }, whyKeywords: ['noise', 'mixed', 'small', 'no clear', 'sortino', 'wait', 'unclear', 'nothing', 'in line', 'no surprise'],
        explain: 'The news was mixed or exactly as expected: no driver really moved. The best trade was no trade (or a tiny one). Trading noise just adds random losing ticks.' },
      { id: 'd2', at: { event: 'n2' }, playbookId: 'risk-off',
        prompt: 'You hold about 75% in stocks. Something big just broke. What do you do to protect your drawdown score?',
        expect: { reduce: { cls: 'equity', minFrac: 0.3 }, avoid: buyAll(['SPX', 'NDX', 'HSI', 'TENCENT', 'AIA']) },
        whyKeywords: ['drawdown', 'risk', 'cut', 'loss', 'protect', 'fear', 'risk-off', 'crash', 'panic', 'sell'],
        explain: 'A major failure means fear across markets: stocks fall hard over the next few ticks. Cutting at least a third of your stocks right away limits the drawdown that stays on your record.' },
      { id: 'd3', at: { event: 'n3' }, playbookId: 'dovish-surprise',
        prompt: 'A clear piece of good news. Risk control isn\'t everything: return is still 35%. Take the opportunity, sensibly sized.',
        expect: { assets: buyAll(['UST20', 'NDX', 'SHKP', 'SPX', 'HSI', 'GOLD']), avoid: sellAll(['UST20', 'NDX', 'SHKP']), sizePctNav: [2, 12] },
        whyKeywords: ['rate', 'cut', 'fed', 'yield', 'bond', 'dovish', 'cheaper', 'inflation'],
        explain: 'Lower expected rates lift long bonds, growth stocks and property. A 2-12% position captures the move without betting the house.' },
    ],
  },

  // ── 2 ───────────────────────────────────────────────────────────────────
  {
    id: 'opening', n: 2, title: 'Client brief → opening allocation', minutes: 12, sessionMinutes: 4,
    summary: 'Read the client\'s limits first, then build a base portfolio that respects them and leaves room to trade.',
    concept: [
      'Before the clock starts you get a **client brief**: goal, risk profile and **hard limits** (the [[mandate]]). They apply from the very first tick.',
      'Build the opening in this order: **1)** fill the minimums (e.g. "min 30% bonds"); **2)** stay well under the maximums, about 5 points of headroom; **3)** spread across several assets ([[diversification]]); **4)** keep 10-30% as [[dry-powder]] in cash or the [[mmf]].',
      'Watch the sneaky rules: single-company caps ([[single-name]]), "no shorting", currency minimums (HKD assets include the HK stocks, HKGB and HKDMM).',
      'Then trade the news without breaking the limits: before every order, check how much room you have.',
    ],
    example: { title: 'Income client: max 40% stocks, min 30% bonds', rows: [['Bonds first: UST2Y 15%, HKGB 15%, IGCR 10%', '= 40% bonds (minimum met with room)'], ['Stocks: 2800 12%, 0005 8%, SPX 10%', '= 30% stocks (10 points under the cap)'], ['HKDMM 20%, cash 10%', '= dry powder']] },
    playbooks: ['mandate-safe-opening'],
    takeaways: ['Minimums first, then maximums with headroom.', 'Keep dry powder for the news.', 'Check mandate room before every trade.'],
    client: client({ id: 'lesson-client-2', name: 'Mrs Chan', age: 63, occupation: 'Retired secondary-school teacher', goal: 'income', goalDetail: 'Steady income to supplement her pension; capital must not be at big risk.',
      riskProfile: 2, horizonYears: 5, notes: 'Lives in Hong Kong and spends in HKD. Dislikes big swings.',
      constraints: [{ type: 'maxClass', cls: 'equity', max: 0.4 }, { type: 'minClass', cls: 'bond', min: 0.3 }, { type: 'maxSingleName', max: 0.1 }, { type: 'noShort' }, { type: 'currencyMin', currency: 'HKD', min: 0.4 }] }),
    opening: 'briefing',
    allocation: {
      prompt: 'Build Mrs Chan\'s opening portfolio. Read her limits on the left first.',
      investedRange: [0.6, 0.9], maxPosition: 0.25, minPositions: 4,
      whyKeywords: ['bond', 'income', 'limit', 'mandate', 'constraint', 'hkd', 'safe', 'diversif', 'minimum', 'equity', 'cap'],
      explain: 'A good opening meets the 30% bond minimum with room to spare, keeps stocks well under 40% and each company under 10%, holds at least 40% in HKD assets (cash, HKDMM, HKGB and HK stocks count), and keeps 10-40% in cash or HKDMM to act on news.',
    },
    regime: calm('Steady income market', 'Rates are stable and markets are calm, a good backdrop for an income portfolio.'),
    storyline: 'A calm quarter for an income client, with one tempting rally.',
    events: [
      ev('m1', 0.1, 'HK retail sales edge up 1.2% year on year', 'Hong Kong retail sales grew modestly, in line with forecasts.', { CNHK: 0.004 }, { magnitude: 'minor', category: 'macro_data' }),
      ev('m2', 0.3, 'Hang Seng jumps as HK banks report record profits', 'HSBC led a rally in Hong Kong after reporting record quarterly profit on higher interest margins. Brokers say "the party is just starting".',
        { GEQ: 0.005, CNHK: 0.02 }, { assetShocks: { HSBC: 0.03 }, sentiment: 1, category: 'earnings', source: 'filing', variants: [
          { headline: 'Hong Kong stocks surge on strong bank and insurer earnings', body: 'HSBC and AIA both beat forecasts, lifting the Hang Seng to a three-month high.', factorShocks: { GEQ: 0.005, CNHK: 0.02 }, assetShocks: { HSBC: 0.025, AIA: 0.02 } },
          { headline: 'HSBC raises dividend after blowout quarter; Hang Seng rallies', body: 'A bigger dividend and buyback from HSBC sent HK financials sharply higher.', factorShocks: { GEQ: 0.004, CNHK: 0.018 }, assetShocks: { HSBC: 0.035 } },
        ] }),
      ev('m3', 0.6, 'HK government bond auction draws solid demand', 'The latest HKGB auction was well covered; yields were little changed.', { RATES: -0.0003 }, { magnitude: 'minor', category: 'macro_data' }),
      ev('m4', 0.85, 'Global stocks drift higher in quiet holiday trading', 'Volumes were thin and moves small across major markets.', { GEQ: 0.004 }, { magnitude: 'minor', category: 'macro_data' }),
    ],
    decisions: [
      { id: 'd1', at: { event: 'm2' }, playbookId: 'mandate-safe-opening',
        prompt: 'HK stocks are rallying. Tempting! Before you buy, check your room: Mrs Chan allows at most 40% in stocks and 10% in any one company.',
        expect: { assets: buyAll(['HSBC', 'HSI', 'AIA']), flatOk: true, sizePctNav: [0, 8] },
        whyKeywords: ['mandate', 'limit', 'room', '40', 'equity', '10', 'single', 'headroom', 'constraint', 'cap'],
        explain: 'Buying a little is fine if you have room under the 40% stock cap and the 10% single-company cap. Doing nothing is also fine for an income client. Breaking a limit is not.' },
    ],
  },

  // ── 3 ───────────────────────────────────────────────────────────────────
  {
    id: 'drivers', n: 3, title: 'Headline → driver → asset', minutes: 13, sessionMinutes: 4,
    summary: 'Every headline moves one or two big drivers. Learn the seven drivers and which assets follow each.',
    concept: [
      'Don\'t ask "is this good or bad news?". Ask **"which driver did it move?"** There are seven: **growth**, **China/HK**, **US rates**, **US dollar**, **credit**, **commodities** and **fear** ([[risk-off]]).',
      '**US rates up** → long bonds ↓↓ (high [[duration]]), HK property ↓ ([[hibor]] follows via the [[peg]]), tech ↓, gold ↓, banks ↑.',
      '**China/HK growth up** → HSCEI, Tencent, BYD ↑↑, Hang Seng ↑, oil ↑ a little.',
      '**Credit stress** (fear of defaults, [[spread]]s widen) → [[high-yield]] bonds ↓↓, investment-grade ↓, insurers ↓.',
      'You\'ll get three headlines, each moving a different driver. Name the driver, then trade its assets.',
    ],
    example: { title: 'Reading a headline', rows: [['"US CPI hotter than expected"', 'Driver: US rates ↑'], ['Rates ↑ means…', 'Sell UST20Y, 0016 property, NDX; HSBC may gain']] },
    playbooks: ['driver-map', 'hawkish-surprise', 'china-stimulus', 'credit-stress'],
    takeaways: ['Headline → driver → assets, every time.', 'Long bonds and HK property are the most rate-sensitive.', 'China news trades best through HSCEI, Tencent and BYD.'],
    client: client({ id: 'lesson-client-3', name: 'Growth client', constraints: [{ type: 'maxClass', cls: 'equity', max: 0.7 }, { type: 'maxLeverage', max: 1.5 }] }),
    opening: { HSI: 0.15, SPX: 0.15, UST20: 0.1, IG: 0.05, HY: 0.1, GOLD: 0.05, HKDMM: 0.2 },
    regime: calm('Crosscurrents', 'Inflation, China and credit are all in the news. Each headline pulls on a different driver.'),
    storyline: 'Three drivers take turns: US rates, Chinese growth and credit.',
    events: [
      ev('h1', 0.15, 'US inflation runs hot: core CPI up 0.5% vs 0.3% expected', 'Core consumer prices rose faster than any economist forecast. Traders now expect the Fed to keep rates higher for longer.',
        { RATES: 0.002, USD: 0.006, GEQ: -0.006 }, { sentiment: -1, variants: [
          { headline: 'US producer prices surge; traders price in more Fed hikes', body: 'Wholesale inflation jumped well above forecasts, pushing Treasury yields higher.', factorShocks: { RATES: 0.002, USD: 0.005, GEQ: -0.006 } },
          { headline: 'US wage growth accelerates to 5%, reviving rate-hike fears', body: 'Hourly earnings beat forecasts by a wide margin. Bond yields jumped.', factorShocks: { RATES: 0.0018, USD: 0.006, GEQ: -0.005 } },
        ] }),
      ev('h2', 0.42, 'China factory PMI jumps to 52.3, the strongest in two years', 'Manufacturing activity in China expanded at the fastest pace in two years as new orders surged.',
        { CNHK: 0.03, GEQ: 0.004, CMDTY: 0.01 }, { sentiment: 1, category: 'china_policy', variants: [
          { headline: 'China exports beat forecasts by a wide margin; imports rebound', body: 'Trade data showed demand recovering at home and abroad.', factorShocks: { CNHK: 0.028, GEQ: 0.004, CMDTY: 0.01 } },
          { headline: 'China credit growth surges as banks lend more to businesses', body: 'New loans far exceeded expectations, a sign the economy is picking up.', factorShocks: { CNHK: 0.03, GEQ: 0.003, CMDTY: 0.008 } },
        ] }),
      ev('h3', 0.7, 'US high-yield fund freezes withdrawals; junk bond spreads blow out', 'A large high-yield bond fund suspended redemptions after heavy losses. Investors are dumping risky corporate debt.',
        { CREDIT: 0.004, RISKOFF: 0.01, GEQ: -0.005 }, { sentiment: -1, category: 'credit', variants: [
          { headline: 'Wave of defaults hits US leveraged-loan market', body: 'Three mid-sized companies missed debt payments in a week. Credit spreads jumped.', factorShocks: { CREDIT: 0.004, RISKOFF: 0.01, GEQ: -0.005 } },
          { headline: 'Rating agency downgrades $200bn of corporate bonds to junk', body: 'A sweeping downgrade forced funds to sell, pushing credit spreads sharply wider.', factorShocks: { CREDIT: 0.0035, RISKOFF: 0.008, GEQ: -0.004 } },
        ] }),
      ev('h4', 0.9, 'Gold steady as markets await next week\'s data', 'Quiet trading with little news.', { GEQ: 0.002 }, { magnitude: 'minor' }),
    ],
    decisions: [
      { id: 'd1', at: { event: 'h1' }, playbookId: 'hawkish-surprise', prompt: 'Which driver did this headline move? Trade the assets that follow it.',
        expect: { assets: sellAll(['UST20', 'NDX', 'SHKP', 'GOLD', 'HKGB']), avoid: buyAll(['UST20', 'SHKP']), sizePctNav: [1, 10] },
        whyKeywords: ['rate', 'inflation', 'yield', 'bond', 'fed', 'cpi', 'hike', 'wage'],
        explain: 'Driver: US rates ↑. Long Treasuries fall most, then HK property (0016), growth tech (NDX) and gold. Sell what you hold, sized 2-5% per leg.' },
      { id: 'd2', at: { event: 'h2' }, playbookId: 'china-stimulus', prompt: 'New headline, different driver. Which one, and which assets follow it?',
        expect: { assets: buyAll(['HSCEI', 'TENCENT', 'BYD', 'HSI']), avoid: sellAll(['HSCEI', 'HSI', 'TENCENT']), sizePctNav: [1, 10] },
        whyKeywords: ['china', 'growth', 'pmi', 'factory', 'hk', 'hang seng', 'demand', 'export', 'credit growth'],
        explain: 'Driver: China/HK growth ↑. HSCEI, Tencent and BYD react most, the Hang Seng a bit less.' },
      { id: 'd3', at: { event: 'h3' }, playbookId: 'credit-stress', prompt: 'And this one? You hold some high-yield and investment-grade credit.',
        expect: { assets: sellAll(['HY', 'IG', 'AIA']), avoid: buyAll(['HY', 'IG']), sizePctNav: [1, 15] },
        whyKeywords: ['credit', 'spread', 'junk', 'high yield', 'default', 'hy', 'corporate', 'downgrade'],
        explain: 'Driver: credit spreads ↑. High-yield (HYCR) falls most, then investment-grade (IGCR). Cut them; government bonds are the safer swap.' },
    ],
  },

  // ── 4 ───────────────────────────────────────────────────────────────────
  {
    id: 'rates', n: 4, title: 'Playbook: rates surprise', minutes: 13, sessionMinutes: 4,
    summary: 'Hawkish and dovish surprises, and why Hong Kong feels US rates through the peg.',
    concept: [
      'A **[[hawkish]] surprise** means rates are going higher than the market expected; a **[[dovish]]** one means lower. Only the *surprise* moves prices.',
      'Rates up → existing bonds lose value. A 20-year bond has high [[duration]]: 0.25% higher [[yield]]s ≈ -4% price. Short bonds barely move.',
      'Hong Kong\'s [[peg]] means [[hibor]] follows US rates. Higher HIBOR: **banks (HSBC) earn more**, **property (SHKP) suffers** from mortgage costs.',
      'Growth stocks (NDX, Tencent) and gold also dislike higher rates. Dovish surprises flip every arrow.',
    ],
    example: { title: 'Fed hikes 0.5% vs 0.25% expected', rows: [['UST20Y', '≈ -4%'], ['0016 property', '≈ -2.5%'], ['NDX', '≈ -2.5%'], ['Gold', '≈ -2%'], ['UST2Y (short bond)', '≈ -0.5%']] },
    playbooks: ['hawkish-surprise', 'hibor-spike', 'dovish-surprise'],
    takeaways: ['Hawkish: sell long bonds, property, tech, gold.', 'HIBOR up: banks over property.', 'Dovish: the same list, opposite way.'],
    client: client({ id: 'lesson-client-4', name: 'Balanced client', constraints: [{ type: 'maxClass', cls: 'equity', max: 0.7 }, { type: 'maxLeverage', max: 1.5 }] }),
    opening: { HSI: 0.15, NDX: 0.1, SHKP: 0.08, HSBC: 0.07, UST20: 0.15, GOLD: 0.05, HKDMM: 0.2 },
    regime: calm('Central banks in focus', 'Everyone is watching the Fed. Rates news will drive this quarter.'),
    storyline: 'A hawkish shock, a squeeze on Hong Kong rates, then a dovish U-turn.',
    events: [
      ev('r1', 0.15, 'Fed hikes 50bp, twice what markets expected', 'The Federal Reserve raised rates by half a point and signalled more to come. Markets had priced only a quarter-point move.',
        { RATES: 0.0025, USD: 0.008, GEQ: -0.01 }, { source: 'central_bank', category: 'central_bank', sentiment: -1, variants: [
          { headline: 'Fed chair: "more hikes likely"; dot plot shifts sharply higher', body: 'Fed officials now expect two more increases this year, far more than markets assumed.', factorShocks: { RATES: 0.002, USD: 0.007, GEQ: -0.009 } },
          { headline: 'Treasury yields spike after hot wage data; Fed hike odds jump', body: 'Traders rushed to price in another rate rise after unexpectedly strong wage growth.', factorShocks: { RATES: 0.002, USD: 0.005, GEQ: -0.008 } },
        ] }),
      ev('r2', 0.42, 'HIBOR jumps to 5.5% as HKMA defends the peg', 'Hong Kong interbank rates surged after the HKMA drained liquidity to keep USD/HKD inside its band. Mortgage rates are set to rise.',
        { RATES: 0.0015 }, { source: 'central_bank', category: 'central_bank', sentiment: 0, assetShocks: { HSBC: 0.015, SHKP: -0.015 }, variants: [
          { headline: 'HK banks raise prime rate for the first time in a year', body: 'Higher lending rates will boost bank margins but squeeze homebuyers and developers.', factorShocks: { RATES: 0.0012 }, assetShocks: { HSBC: 0.015, SHKP: -0.015 } },
          { headline: 'One-month HIBOR hits 15-year high on tight liquidity', body: 'Funding costs in Hong Kong spiked. Analysts warn of pressure on the property market.', factorShocks: { RATES: 0.0015 }, assetShocks: { HSBC: 0.012, SHKP: -0.018 } },
        ] }),
      ev('r3', 0.7, 'Fed surprises with a rate cut as US jobs data weakens', 'Citing a cooling labour market, the Fed cut rates by a quarter point. Markets had expected no change.',
        { RATES: -0.0025, USD: -0.008, GEQ: 0.008 }, { source: 'central_bank', category: 'central_bank', sentiment: 1, variants: [
          { headline: 'Inflation falls to 2%; Fed signals cuts within weeks', body: 'With inflation back at target, the Fed said it can now lower rates.', factorShocks: { RATES: -0.002, USD: -0.006, GEQ: 0.008 } },
          { headline: 'Fed ends hiking cycle and flags cuts ahead', body: 'The Fed dropped its tightening bias. Bond yields fell sharply.', factorShocks: { RATES: -0.0022, USD: -0.006, GEQ: 0.007 } },
        ] }),
      ev('r4', 0.9, 'US housing starts little changed', 'Construction activity was flat on the month.', { RATES: -0.0002, GEQ: 0.002 }, { magnitude: 'minor' }),
    ],
    decisions: [
      { id: 'd1', at: { event: 'r1' }, playbookId: 'hawkish-surprise', prompt: 'Rates surprise. Which way, and what do you do with your long bonds, property, tech and gold?',
        expect: { assets: sellAll(['UST20', 'SHKP', 'NDX', 'GOLD']), avoid: buyAll(['UST20', 'SHKP', 'NDX']), sizePctNav: [1, 12] },
        whyKeywords: ['rate', 'hike', 'yield', 'bond', 'fed', 'hawkish', 'dollar', 'usd', 'duration'],
        explain: 'Hawkish surprise: long bonds fall most (UST20Y ≈ -4%), then property and tech; gold too. Sell those, 2-5% per leg.' },
      { id: 'd2', at: { event: 'r2' }, playbookId: 'hibor-spike', prompt: 'Hong Kong-specific rates news. Who wins and who loses inside the Hang Seng?',
        expect: { assets: [{ assetId: 'HSBC', dir: 1 }, { assetId: 'SHKP', dir: -1 }], avoid: [{ assetId: 'SHKP', dir: 1 }, { assetId: 'HSBC', dir: -1 }], sizePctNav: [1, 10] },
        whyKeywords: ['hibor', 'peg', 'bank', 'property', 'rate', 'margin', 'mortgage', 'hkma', 'prime'],
        explain: 'Higher HIBOR = wider bank margins (HSBC ↑) and pricier mortgages (SHKP ↓). Trade the pair: buy the bank, sell the developer.' },
      { id: 'd3', at: { event: 'r3' }, playbookId: 'dovish-surprise', prompt: 'The Fed turns. Flip the playbook.',
        expect: { assets: buyAll(['UST20', 'SHKP', 'NDX', 'GOLD']), avoid: sellAll(['UST20', 'SHKP']), sizePctNav: [1, 12] },
        whyKeywords: ['rate', 'cut', 'yield', 'bond', 'fed', 'dovish', 'cheaper', 'inflation'],
        explain: 'Dovish surprise: long bonds, property, tech and gold all rise. Buy (or buy back) 2-5% per leg.' },
    ],
  },

  // ── 5 ───────────────────────────────────────────────────────────────────
  {
    id: 'china', n: 5, title: 'Playbook: China stimulus', minutes: 12, sessionMinutes: 4,
    summary: 'How Beijing\'s policy moves flow into Hong Kong-listed stocks, and how rallies fade.',
    concept: [
      'Hong Kong is where global investors trade China. When Beijing adds [[stimulus]] (rate cuts, property support, spending), **HSCEI, Tencent and BYD** move most, the **Hang Seng** a bit less, and **oil** gains on demand.',
      'Official, confirmed policy is tradable. **"Sources say" is not** (that\'s Lesson 8).',
      'China rallies often **fade**: if the follow-up disappoints ("no new stimulus"), the same stocks drop. Take profit, don\'t marry the trade.',
      'Watch the single-company cap: Tencent and BYD are single names.',
    ],
    example: { title: 'Beijing announces RMB 1.5tn package', rows: [['Tencent / BYD', '≈ +6%'], ['HSCEI', '≈ +5%'], ['Hang Seng (2800)', '≈ +4.5%'], ['Brent', '≈ +3%']] },
    playbooks: ['china-stimulus', 'china-disappointment'],
    takeaways: ['Confirmed stimulus: buy HSCEI / Tencent / BYD.', 'Disappointment: take profit or cut.', 'Respect single-name caps.'],
    client: client({ id: 'lesson-client-5', name: 'HK growth client', constraints: [{ type: 'maxClass', cls: 'equity', max: 0.75 }, { type: 'maxSingleName', max: 0.15 }, { type: 'maxLeverage', max: 1.5 }] }),
    opening: { HSI: 0.1, SPX: 0.15, UST2: 0.15, HKGB: 0.1, GOLD: 0.05, HKDMM: 0.25 },
    regime: calm('Waiting for Beijing', 'China\'s economy has been slow. Everyone is waiting to see if Beijing will act.'),
    storyline: 'Beijing delivers a big package, then the follow-up disappoints.',
    events: [
      ev('c1', 0.15, 'Beijing unveils RMB 1.5tn stimulus: rate cuts and property support', 'China\'s State Council announced a broad package including interest-rate cuts, support for property developers and infrastructure spending.',
        { CNHK: 0.04, GEQ: 0.005, CMDTY: 0.02 }, { category: 'china_policy', sentiment: 1, variants: [
          { headline: 'PBoC cuts key rate by 50bp and lowers bank reserve ratios', body: 'China\'s central bank delivered its biggest easing in years to revive growth.', factorShocks: { CNHK: 0.035, GEQ: 0.004, CMDTY: 0.015 } },
          { headline: 'China launches RMB 1tn infrastructure bond programme', body: 'Beijing will issue special bonds to fund railways, power grids and housing.', factorShocks: { CNHK: 0.035, GEQ: 0.005, CMDTY: 0.025 } },
        ] }),
      ev('c2', 0.48, 'NPC sets modest growth target; no new stimulus announced', 'China\'s legislature set a cautious growth goal and announced no additional support. Investors had hoped for more.',
        { CNHK: -0.03, GEQ: -0.003 }, { category: 'china_policy', sentiment: -1, variants: [
          { headline: 'China retail sales and investment miss forecasts badly', body: 'Data showed the economy still struggling despite earlier support.', factorShocks: { CNHK: -0.028, GEQ: -0.003 } },
          { headline: 'Beijing signals no further easing "for now"', body: 'Officials said current policy is sufficient, dashing hopes of more support.', factorShocks: { CNHK: -0.03, GEQ: -0.002 } },
        ] }),
      ev('c3', 0.75, 'Macau gaming revenue edges higher', 'Monthly casino takings rose slightly.', { CNHK: 0.006 }, { magnitude: 'minor', category: 'macro_data' }),
      ev('c4', 0.9, 'Hang Seng flat in thin pre-holiday trade', 'Little news; small moves.', { CNHK: 0.002 }, { magnitude: 'minor' }),
    ],
    decisions: [
      { id: 'd1', at: { event: 'c1' }, playbookId: 'china-stimulus', prompt: 'Official policy news from Beijing. Which Hong Kong assets do you buy, and how much?',
        expect: { assets: buyAll(['HSCEI', 'TENCENT', 'BYD', 'HSI']), minHits: 1, avoid: sellAll(['HSCEI', 'TENCENT', 'BYD', 'HSI']), sizePctNav: [2, 15] },
        whyKeywords: ['china', 'stimulus', 'beijing', 'hk', 'growth', 'hang seng', 'policy', 'pboc', 'rate cut', 'infrastructure'],
        explain: 'Confirmed stimulus lifts China-exposed HK stocks most: HSCEI, Tencent and BYD, then the Hang Seng. Spread 3-8% across two or three names, each under the 15% cap.' },
      { id: 'd2', at: { event: 'c2' }, playbookId: 'china-disappointment', prompt: 'The follow-up disappoints. What happens to the China trade?',
        expect: { assets: sellAll(['HSCEI', 'TENCENT', 'BYD', 'HSI']), avoid: buyAll(['HSCEI', 'TENCENT', 'BYD', 'HSI']), sizePctNav: [1, 20] },
        whyKeywords: ['china', 'stimulus', 'disappoint', 'target', 'no new', 'profit', 'growth', 'miss', 'fade'],
        explain: 'No more support means the rally fades. Take profit on the China names you bought (and don\'t buy the dip on this news).' },
    ],
  },

  // ── 6 ───────────────────────────────────────────────────────────────────
  {
    id: 'risk-off', n: 6, title: 'Playbook: risk-off shock', minutes: 12, sessionMinutes: 4,
    summary: 'When fear hits: cut risk, move to safe havens, and buy back when the panic fades. Now with a 30-second timer.',
    concept: [
      'In a panic ([[risk-off]]), investors sell everything risky at once: **stocks ↓↓**, **[[high-yield]] bonds ↓**. They buy **[[safe-haven]]s**: **US Treasuries ↑** and **gold ↑**.',
      'Speed matters: prices adjust over a few ticks after the headline. Act on the headline, not after the fall.',
      'When fear fades (a rescue, a guarantee, a ceasefire), the trade reverses: a **relief rally**. Stocks bounce, gold and Treasuries give back.',
      'From this lesson on, decisions have a **30-second timer**, closer to the real event.',
    ],
    example: { title: 'Bank failure, typical first reaction', rows: [['NDX / SPX / 2800', '≈ -4%'], ['High yield', '≈ -1.5%'], ['UST20Y', '≈ +3%'], ['Gold', '≈ +2.5%']] },
    playbooks: ['risk-off', 'relief-rally'],
    takeaways: ['Fear: sell stocks and junk bonds, buy Treasuries and gold.', 'Act on the headline, fast.', 'Relief: reverse the trade.'],
    client: client({ id: 'lesson-client-6', name: 'Balanced client', constraints: [{ type: 'maxClass', cls: 'equity', max: 0.7 }, { type: 'maxClass', cls: 'commodity', max: 0.15 }, { type: 'maxLeverage', max: 1.5 }] }),
    opening: { HSI: 0.15, SPX: 0.15, NDX: 0.1, HY: 0.1, UST20: 0.1, HKDMM: 0.2 },
    regime: calm('Cracks appearing', 'Higher rates have strained some lenders. Markets are calm on the surface.'),
    storyline: 'A bank fails and fear spreads, then regulators step in.',
    events: [
      ev('k1', 0.2, 'Regional US bank fails; depositors queue as contagion fears spread', 'A mid-sized US lender collapsed after a run on deposits. Shares of other regional banks are being suspended.',
        { RISKOFF: 0.04, GEQ: -0.02, CREDIT: 0.003, RATES: -0.0015, USD: 0.005 }, { category: 'credit', sentiment: -1, variants: [
          { headline: 'Missiles strike major oil port; markets tumble on war fears', body: 'A military escalation sent investors running for safety around the world.', factorShocks: { RISKOFF: 0.04, GEQ: -0.02, CREDIT: 0.002, RATES: -0.0015, USD: 0.005, CMDTY: 0.01 }, category: 'geopolitics' },
          { headline: 'Hedge fund blow-up forces fire sales across markets', body: 'A large fund collapsed, dumping stocks and credit to meet margin calls.', factorShocks: { RISKOFF: 0.035, GEQ: -0.02, CREDIT: 0.003, RATES: -0.0012, USD: 0.004 } },
        ] }),
      ev('k2', 0.55, 'Regulators guarantee all deposits; banking panic eases', 'US authorities announced a full guarantee for depositors at failed banks. Futures jumped.',
        { RISKOFF: -0.03, GEQ: 0.015, CREDIT: -0.002, RATES: 0.001 }, { source: 'central_bank', category: 'central_bank', sentiment: 1, variants: [
          { headline: 'Ceasefire agreed; markets rebound sharply', body: 'Both sides agreed to halt hostilities. Investors piled back into stocks.', factorShocks: { RISKOFF: -0.03, GEQ: 0.015, CREDIT: -0.001, RATES: 0.001, CMDTY: -0.01 }, category: 'geopolitics' },
          { headline: 'Central banks pledge unlimited liquidity; fear gauge plunges', body: 'A coordinated statement calmed markets around the world.', factorShocks: { RISKOFF: -0.028, GEQ: 0.014, CREDIT: -0.002, RATES: 0.0008 } },
        ] }),
      ev('k3', 0.8, 'US consumer confidence little changed', 'Sentiment surveys were steady.', { GEQ: 0.002 }, { magnitude: 'minor' }),
    ],
    decisions: [
      { id: 'd1', at: { event: 'k1' }, playbookId: 'risk-off', timeLimitSec: 30, prompt: 'Fear is spreading. You have 30 seconds. What do you sell, and what do you buy?',
        expect: { assets: [...sellAll(['SPX', 'NDX', 'HSI', 'HY']), ...buyAll(['UST20', 'GOLD'])], avoid: buyAll(['SPX', 'NDX', 'HSI', 'HY']), sizePctNav: [2, 25] },
        whyKeywords: ['risk', 'fear', 'bank', 'contagion', 'safe', 'haven', 'treasur', 'gold', 'sell', 'panic', 'war'],
        explain: 'Risk-off: sell stocks and high yield, buy Treasuries and gold. Cutting a quarter to half of your equity quickly protects the drawdown score.' },
      { id: 'd2', at: { event: 'k2' }, playbookId: 'relief-rally', timeLimitSec: 30, prompt: 'The authorities step in. 30 seconds: what now?',
        expect: { assets: [...buyAll(['SPX', 'NDX', 'HSI']), ...sellAll(['GOLD', 'UST20'])], avoid: sellAll(['SPX', 'NDX', 'HSI']), sizePctNav: [2, 25] },
        whyKeywords: ['relief', 'calm', 'risk', 'guarantee', 'rebound', 'fear', 'back', 'ceasefire', 'liquidity'],
        explain: 'Relief rally: the stocks that fell hardest bounce. Buy back equity in steps and take profit on gold and Treasuries.' },
    ],
  },

  // ── 7 ───────────────────────────────────────────────────────────────────
  {
    id: 'oil', n: 7, title: 'Playbook: oil supply shock', minutes: 11, sessionMinutes: 4,
    summary: 'Supply disruptions spike oil and hurt oil importers. Then supply comes back.',
    concept: [
      'Oil prices move on **supply** (wars, blockades, OPEC decisions) and **demand** (growth). A supply shock means **less oil, higher price**.',
      'Who gets hurt? **Oil importers**: Europe (SX5E) and Japan (NKY) pay more for energy. Higher fuel costs also feed inflation fears.',
      'Some clients exclude fossil fuels: check the mandate before buying Brent.',
      'When supply returns (OPEC adds output, a blockade lifts), **oil drops**. Take profit.',
    ],
    example: { title: 'Gulf shipping lane closed', rows: [['Brent', '≈ +6%'], ['Euro Stoxx / Nikkei', '≈ -1%'], ['S&P 500', '≈ -1%']] },
    playbooks: ['oil-supply-shock', 'oil-supply-relief'],
    takeaways: ['Supply shock: buy Brent, trim importers (Europe, Japan).', 'Supply relief: take profit on oil.', 'Check fossil-fuel exclusions.'],
    client: client({ id: 'lesson-client-7', name: 'Global client', constraints: [{ type: 'maxClass', cls: 'commodity', max: 0.2 }, { type: 'maxClass', cls: 'equity', max: 0.7 }] }),
    opening: { SPX: 0.15, SX5E: 0.1, NKY: 0.1, HSI: 0.1, UST2: 0.1, HKDMM: 0.25 },
    regime: calm('Tense Gulf', 'Shipping through the Gulf has been tense for weeks.'),
    storyline: 'Supply is cut, then restored.',
    events: [
      ev('o1', 0.2, 'Tanker attacks shut key Gulf shipping lane; Brent spikes', 'Attacks on two tankers halted traffic through a strait that carries a fifth of the world\'s oil.',
        { CMDTY: 0.05, RISKOFF: 0.01, RATES: 0.0008, GEQ: -0.006 }, { category: 'commodities', sentiment: -1, variants: [
          { headline: 'OPEC+ announces surprise 2 million barrel output cut', body: 'The producer group cut supply far more than expected to lift prices.', factorShocks: { CMDTY: 0.045, RATES: 0.0006, GEQ: -0.005, RISKOFF: 0.005 } },
          { headline: 'Pipeline sabotage halts 1.5m barrels a day of exports', body: 'A major export pipeline was knocked out; repairs could take weeks.', factorShocks: { CMDTY: 0.045, RISKOFF: 0.01, RATES: 0.0006, GEQ: -0.006 } },
        ] }),
      ev('o2', 0.58, 'OPEC+ agrees surprise output increase as shipping lane reopens', 'Producers will pump more and tanker traffic is resuming. Oil traders rushed to sell.',
        { CMDTY: -0.04, RISKOFF: -0.008, GEQ: 0.004 }, { category: 'commodities', sentiment: 1, variants: [
          { headline: 'Navy escorts restore Gulf tanker traffic; oil slides', body: 'Shipping resumed under naval protection, easing supply fears.', factorShocks: { CMDTY: -0.04, RISKOFF: -0.008, GEQ: 0.004 } },
          { headline: 'US releases 60m barrels from strategic reserve', body: 'A large emergency release added supply to the market.', factorShocks: { CMDTY: -0.035, RISKOFF: -0.005, GEQ: 0.003 } },
        ] }),
      ev('o3', 0.85, 'European factory orders tick up', 'A modest improvement in industrial demand.', { GEQ: 0.003 }, { magnitude: 'minor' }),
    ],
    decisions: [
      { id: 'd1', at: { event: 'o1' }, playbookId: 'oil-supply-shock', timeLimitSec: 30, prompt: 'Supply shock in the Gulf. 30 seconds: what do you buy, and which stock markets do you trim?',
        expect: { assets: [{ assetId: 'BRENT', dir: 1 }, ...sellAll(['SX5E', 'NKY', 'SPX'])], avoid: [{ assetId: 'BRENT', dir: -1 }], sizePctNav: [1, 15] },
        whyKeywords: ['oil', 'supply', 'brent', 'energy', 'inflation', 'shipping', 'import', 'opec'],
        explain: 'Less supply → Brent ↑. Oil importers (Europe, Japan) suffer a bit. Buy Brent 2-5%; trimming SX5E/NKY is a bonus.' },
      { id: 'd2', at: { event: 'o2' }, playbookId: 'oil-supply-relief', timeLimitSec: 30, prompt: 'Supply is coming back. 30 seconds.',
        expect: { assets: [{ assetId: 'BRENT', dir: -1 }], avoid: [{ assetId: 'BRENT', dir: 1 }], sizePctNav: [1, 15] },
        whyKeywords: ['oil', 'supply', 'opec', 'brent', 'output', 'price', 'profit', 'reserve', 'reopen'],
        explain: 'More supply → Brent ↓. Take profit on your oil long (or short a little if allowed).' },
    ],
  },

  // ── 8 ───────────────────────────────────────────────────────────────────
  {
    id: 'rumours', n: 8, title: 'Playbook: rumours & denials', minutes: 12, sessionMinutes: 4,
    summary: 'Unconfirmed reports move prices, then often get denied. Trade the confirmation, not the whisper.',
    concept: [
      'Headlines starting with **"sources say"**, "people familiar", "market chatter" are **rumours**. Look at the source tag: **RUMOUR**.',
      'Rumours move prices, but they are often **denied**, and the move reverses (a [[fakeout]]). Buying the rumour full size is gambling.',
      'Playbook: **stay flat or trade tiny (0-2%)**, exit at once on a denial, and **trade full size only on official confirmation**.',
      '30-second timer on every decision.',
    ],
    example: { title: 'A typical rumour cycle', rows: [['"Sources: Beijing plans RMB 2tn rescue"', 'HSCEI +2%'], ['"Officials deny the report"', 'HSCEI -2%: back to start'], ['Official package weeks later', 'Now trade it']] },
    playbooks: ['rumour-fade', 'china-stimulus'],
    takeaways: ['Rumour: flat or tiny.', 'Denial: get out of anything you bought on it.', 'Official confirmation: trade it properly.'],
    client: client({ id: 'lesson-client-8', name: 'HK growth client', constraints: [{ type: 'maxClass', cls: 'equity', max: 0.7 }, { type: 'maxSingleName', max: 0.15 }] }),
    opening: { HSI: 0.1, SPX: 0.15, UST2: 0.15, HKGB: 0.1, HKDMM: 0.25 },
    regime: calm('Rumour mill', 'Markets are hungry for good news from Beijing. Every whisper moves prices.'),
    storyline: 'A rumour, a denial, then the real thing.',
    events: [
      ev('u1', 0.15, 'Sources say Beijing is preparing a RMB 2tn property rescue', 'People familiar with the matter say officials are drafting a huge support package for developers. No official comment.',
        { CNHK: 0.02 }, { source: 'rumour', kind: 'fakeout', category: 'china_policy', sentiment: 1, variants: [
          { headline: 'Market chatter: PBoC to cut rates this weekend', body: 'Traders are passing around reports of an imminent rate cut. The central bank has not commented.', factorShocks: { CNHK: 0.018 } },
          { headline: 'Report: Beijing to scrap home-purchase limits in big cities', body: 'An unverified social-media report says restrictions will be lifted soon.', factorShocks: { CNHK: 0.02 } },
        ] }),
      ev('u2', 0.35, 'Officials deny property rescue report: "no such plan"', 'A government spokesperson said the reported package "does not exist".',
        { CNHK: -0.02 }, { kind: 'denial', linkedTo: 'u1', category: 'china_policy', sentiment: -1, variants: [
          { headline: 'PBoC says it has no plans for a weekend rate move', body: 'The central bank dismissed the rate-cut rumours as "groundless".', factorShocks: { CNHK: -0.018 } },
          { headline: 'Housing ministry: purchase limits will stay', body: 'Officials denied any plan to scrap the restrictions.', factorShocks: { CNHK: -0.02 } },
        ] }),
      ev('u3', 0.65, 'State Council approves RMB 1tn housing fund in official statement', 'Beijing formally announced a fund to finish stalled housing projects, plus mortgage-rate cuts.',
        { CNHK: 0.03, GEQ: 0.003 }, { category: 'china_policy', sentiment: 1, variants: [
          { headline: 'PBoC officially cuts mortgage rates and reserve ratios', body: 'The central bank confirmed broad easing measures in a press conference.', factorShocks: { CNHK: 0.028, GEQ: 0.003 } },
          { headline: 'Beijing confirms nationwide easing of home-purchase rules', body: 'An official notice removed purchase limits in all but four cities.', factorShocks: { CNHK: 0.03, GEQ: 0.002 } },
        ] }),
      ev('u4', 0.88, 'HK property sales pick up in latest weekend', 'Developers reported stronger sales.', { CNHK: 0.006 }, { magnitude: 'minor' }),
    ],
    decisions: [
      { id: 'd1', at: { event: 'u1' }, playbookId: 'rumour-fade', timeLimitSec: 30, prompt: 'Look at the source tag. 30 seconds: how much do you put on this?',
        expect: { flatOk: true, sizePctNav: [0, 3] },
        whyKeywords: ['rumour', 'unconfirmed', 'sources', 'denial', 'small', 'wait', 'confirm', 'chatter', 'report'],
        explain: 'It\'s a rumour: no official source. Stay flat or trade tiny (up to 2-3%). Most of the time, a denial follows.' },
      { id: 'd2', at: { event: 'u2' }, playbookId: 'rumour-fade', timeLimitSec: 30, prompt: 'Denied. 30 seconds: make sure you\'re not left holding anything you bought on the rumour.',
        expect: { capAfter: { assets: ['HSCEI', 'TENCENT', 'BYD', 'SHKP'], max: 0.02 }, avoid: buyAll(['HSCEI', 'TENCENT', 'BYD', 'SHKP']), flatOk: true },
        whyKeywords: ['denial', 'deny', 'denied', 'rumour', 'cut', 'exit', 'false', 'unwind', 'no such'],
        explain: 'The denial reverses the rumour\'s move. Anything bought on the rumour should go now.' },
      { id: 'd3', at: { event: 'u3' }, playbookId: 'china-stimulus', timeLimitSec: 30, prompt: 'This time it\'s official. 30 seconds.',
        expect: { assets: buyAll(['HSCEI', 'SHKP', 'HSI', 'TENCENT', 'BYD']), avoid: sellAll(['HSCEI', 'HSI']), sizePctNav: [2, 15] },
        whyKeywords: ['official', 'confirm', 'statement', 'approved', 'china', 'property', 'stimulus', 'formally'],
        explain: 'Official confirmation is tradable: buy China/HK names (HSCEI, property, Hang Seng), 3-8% in total.' },
    ],
  },

  // ── 9 ───────────────────────────────────────────────────────────────────
  {
    id: 'sizing', n: 9, title: 'Sizing: how big, adding, cutting losers', minutes: 12, sessionMinutes: 4,
    summary: 'Start small, add on confirmation, and cut fast when the story breaks. 20-second timer.',
    concept: [
      'Size is where beginners lose most. Rule of thumb: **first clip 2-5% of [[nav]]**. The order ticket presets (1/2/5/10/25%) help.',
      '**Scale in**: if the next headline confirms your idea, add another 2-5%. Never add to a loser.',
      '**Cut the loser**: when news breaks your reason for owning something, sell at least half straight away. Small losses keep [[drawdown]] and [[sortino]] healthy.',
      'Watch the single-company cap while adding. Timer is now **20 seconds**.',
    ],
    example: { title: 'Scaling a Tencent idea', rows: [['Earnings beat', 'Buy 3% of NAV'], ['New game approvals', 'Add 3% → 6%'], ['Regulatory crackdown', 'Sell at least half, ideally all']] },
    playbooks: ['scale-in', 'cut-the-loser'],
    takeaways: ['Start with 2-5%.', 'Add only on confirmation.', 'When the reason breaks, cut at least half.'],
    client: client({ id: 'lesson-client-9', name: 'Growth client', constraints: [{ type: 'maxClass', cls: 'equity', max: 0.7 }, { type: 'maxSingleName', max: 0.15 }, { type: 'maxLeverage', max: 1.5 }] }),
    opening: { SPX: 0.15, HSI: 0.1, UST2: 0.15, HKGB: 0.1, HKDMM: 0.25 },
    regime: calm('Stock-picker\'s market', 'Company news is driving individual stocks more than the overall market.'),
    storyline: 'One company\'s story: good, better, then broken.',
    events: [
      ev('s1', 0.15, 'Tencent beats on earnings; gaming revenue up 20%', 'Tencent\'s quarterly profit beat forecasts on strong gaming and advertising revenue.',
        { GEQ: 0.002, CNHK: 0.005 }, { source: 'filing', category: 'earnings', sentiment: 1, assetShocks: { TENCENT: 0.04 }, variants: [
          { headline: 'Tencent raises buyback to HKD 100bn after strong quarter', body: 'A record buyback signals management confidence.', factorShocks: { GEQ: 0.002, CNHK: 0.005 }, assetShocks: { TENCENT: 0.035 } },
          { headline: 'Tencent ad revenue jumps 25%, beating every forecast', body: 'Advertising growth surprised analysts.', factorShocks: { GEQ: 0.002, CNHK: 0.004 }, assetShocks: { TENCENT: 0.04 } },
        ] }),
      ev('s2', 0.38, 'Tencent wins approval for 15 new games; analysts upgrade', 'Regulators approved a batch of new titles. Several brokers raised their price targets.',
        { CNHK: 0.005 }, { source: 'filing', category: 'earnings', sentiment: 1, assetShocks: { TENCENT: 0.03 }, variants: [
          { headline: 'Tencent\'s new hit game tops global download charts', body: 'Early revenue estimates for the game have doubled.', factorShocks: { CNHK: 0.004 }, assetShocks: { TENCENT: 0.03 } },
          { headline: 'Brokers lift Tencent targets after investor day', body: 'Management outlined faster growth than expected.', factorShocks: { CNHK: 0.004 }, assetShocks: { TENCENT: 0.025 } },
        ] }),
      ev('s3', 0.62, 'Regulators announce surprise crackdown on online gaming spending', 'New rules will cap how much players can spend in online games. Gaming stocks are plunging.',
        { CNHK: -0.01 }, { category: 'china_policy', sentiment: -1, assetShocks: { TENCENT: -0.06 }, variants: [
          { headline: 'Tencent hit by antitrust probe; fines could be record', body: 'Regulators opened an investigation into Tencent\'s business practices.', factorShocks: { CNHK: -0.008 }, assetShocks: { TENCENT: -0.06 } },
          { headline: 'Tencent warns profit will fall as gaming curbs bite', body: 'A surprise profit warning sent the shares sharply lower.', factorShocks: { CNHK: -0.008 }, assetShocks: { TENCENT: -0.055 } },
        ] }),
      ev('s4', 0.85, 'Hang Seng steadies in quiet trade', 'Little news.', { CNHK: 0.003 }, { magnitude: 'minor' }),
    ],
    decisions: [
      { id: 'd1', at: { event: 's1' }, playbookId: 'scale-in', timeLimitSec: 20, prompt: 'Good news for Tencent (0700). Start a position: how big is a sensible first clip? 20 seconds.',
        expect: { assets: [{ assetId: 'TENCENT', dir: 1 }], avoid: [{ assetId: 'TENCENT', dir: -1 }], sizePctNav: [1, 6] },
        whyKeywords: ['start', 'small', 'scale', 'size', 'first', 'tencent', 'earnings', 'beat'],
        explain: 'A first clip of 2-5% of NAV: enough to matter, small enough to survive being wrong.' },
      { id: 'd2', at: { event: 's2' }, playbookId: 'scale-in', timeLimitSec: 20, prompt: 'The story is confirmed. Add, and stay under the 15% single-company cap. 20 seconds.',
        expect: { assets: [{ assetId: 'TENCENT', dir: 1 }], avoid: [{ assetId: 'TENCENT', dir: -1 }], sizePctNav: [1, 6] },
        whyKeywords: ['confirm', 'add', 'scale', 'second', 'upgrade', 'approval', 'more', 'cap'],
        explain: 'Confirmation is the time to add another 2-5%, staying well under the 15% cap.' },
      { id: 'd3', at: { event: 's3' }, playbookId: 'cut-the-loser', timeLimitSec: 20, prompt: 'The story just broke. 20 seconds.',
        expect: { reduce: { assets: ['TENCENT'], minFrac: 0.5 }, avoid: [{ assetId: 'TENCENT', dir: 1 }] },
        whyKeywords: ['cut', 'loser', 'stop', 'wrong', 'regulat', 'crackdown', 'exit', 'sell', 'broke', 'probe', 'warn'],
        explain: 'Your reason to own Tencent is gone. Sell at least half immediately; all of it is fine.' },
    ],
  },

  // ── 10 ──────────────────────────────────────────────────────────────────
  {
    id: 'pressure', n: 10, title: 'Mandate & drawdown under pressure', minutes: 13, sessionMinutes: 4,
    summary: 'Fix breaches fast, de-risk in a selloff, and know when sitting in cash is the best trade. 20-second timer.',
    concept: [
      'A [[breach]] costs nothing for a few ticks (the [[grace-period]]), then costs score **every tick** until fixed. Fix it fast, and don\'t fix one limit by breaking another.',
      'Fix in this order: **1)** single-company caps (sell the oversized name), **2)** asset-class caps, **3)** minimums (buy bonds, for example). Leave 1-2 points of margin.',
      'In a selloff, **cut risk first**. When the news is mixed and you\'re already down, **cash is a position**: it has no losing days.',
      'You start this lesson with a portfolio inherited from a colleague. It breaks three limits.',
    ],
    example: { title: 'Fixing three breaches at once', rows: [['Tencent 18% > 15% cap', 'Sell ~5% of NAV of Tencent'], ['Stocks 73% > 60% cap', 'Sell ~15% more of 2800 / SPX'], ['Bonds 10% < 15% min', 'Buy ~7% UST2Y with the cash']] },
    playbooks: ['breach-fix', 'risk-off', 'sit-in-cash'],
    takeaways: ['Fix breaches within the grace period: single names, then classes, then minimums.', 'Selloff: cut risk first.', 'Mixed news: cash is a position.'],
    client: client({ id: 'lesson-client-10', name: 'Mr Lau', age: 55, occupation: 'Business owner', goal: 'capital_preservation', goalDetail: 'Protect wealth ahead of retirement while beating deposits.', riskProfile: 2,
      constraints: [{ type: 'maxClass', cls: 'equity', max: 0.6 }, { type: 'maxSingleName', max: 0.15 }, { type: 'minClass', cls: 'bond', min: 0.15 }, { type: 'maxLeverage', max: 1.2 }] }),
    opening: { HSI: 0.2, SPX: 0.15, NDX: 0.1, TENCENT: 0.18, AIA: 0.1, UST2: 0.1, HKDMM: 0.07 },
    regime: calm('Fragile market', 'Valuations are high and Hong Kong property developers are under strain.'),
    storyline: 'An inherited mess, a selloff, then a murky finish.',
    events: [
      ev('p1', 0.3, 'Major HK developer misses bond payment; Hang Seng tumbles', 'A large property developer missed an interest payment, raising fears of contagion through Hong Kong\'s banks and markets.',
        { RISKOFF: 0.05, CNHK: -0.03, GEQ: -0.01, CREDIT: 0.003 }, { magnitude: 'major', category: 'credit', sentiment: -1, variants: [
          { headline: 'China shadow-bank collapse triggers HK market selloff', body: 'A large trust company failed, sparking fears for the wider financial system.', factorShocks: { RISKOFF: 0.05, CNHK: -0.03, GEQ: -0.01, CREDIT: 0.003 } },
          { headline: 'Global stocks plunge as tech valuations crack', body: 'A sharp selloff in tech spread to every market.', factorShocks: { RISKOFF: 0.045, GEQ: -0.03, CNHK: -0.01, CREDIT: 0.002 } },
        ] }),
      ev('p2', 0.7, 'Mixed signals: China data beats while US earnings warnings pile up', 'Chinese activity data surprised to the upside, but several large US companies cut their profit outlooks.',
        { CNHK: 0.01, GEQ: -0.01 }, { kind: 'conflicting', sentiment: 0, variants: [
          { headline: 'Fed holds rates but splits on next move; China exports slip', body: 'Two pieces of news pulling in different directions.', factorShocks: { RATES: 0.0003, CNHK: -0.008, GEQ: 0.004 } },
          { headline: 'Strong US jobs, weak China retail: markets unsure', body: 'Investors struggled to read conflicting data.', factorShocks: { GEQ: 0.006, CNHK: -0.01 } },
        ] }),
      ev('p3', 0.85, 'Year-end window dressing keeps markets range-bound', 'Fund managers tidied up portfolios ahead of the quarter end.', { GEQ: 0.002 }, { magnitude: 'minor' }),
    ],
    decisions: [
      { id: 'd1', at: 'start', playbookId: 'breach-fix', timeLimitSec: 60, prompt: 'You\'ve inherited this portfolio. It breaks three of Mr Lau\'s limits (see the Risk panel). Fix all of them. You have 60 seconds.',
        expect: { mandateOkAfter: true },
        whyKeywords: ['mandate', 'limit', 'breach', 'equity', 'bond', 'single', 'fix', 'penalt', 'tencent', 'cap', 'minimum'],
        explain: 'Sell enough Tencent to get under 15%, sell stocks to get under 60%, and buy bonds (UST2Y/HKGB) to get above 15%, leaving a point or two of margin.' },
      { id: 'd2', at: { event: 'p1' }, playbookId: 'risk-off', timeLimitSec: 20, prompt: 'A selloff is starting. Cut risk without breaking any limit. 20 seconds.',
        expect: { reduce: { cls: 'equity', minFrac: 0.25 }, avoid: buyAll(['HSI', 'HSCEI', 'TENCENT', 'AIA', 'SPX', 'NDX']) },
        whyKeywords: ['risk', 'drawdown', 'cut', 'fear', 'sell', 'protect', 'reduce', 'default', 'contagion'],
        explain: 'Cut at least a quarter of your stocks straight away. Your bond minimum is unaffected by selling stocks.' },
      { id: 'd3', at: { event: 'p2' }, playbookId: 'sit-in-cash', timeLimitSec: 20, prompt: 'Mixed news, late in the quarter, after a rough patch. 20 seconds.',
        expect: { flatOk: true, sizePctNav: [0, 3] },
        whyKeywords: ['mixed', 'unclear', 'cash', 'protect', 'wait', 'sit', 'conflict', 'nothing', 'confus'],
        explain: 'The news pulls both ways. There\'s no clear driver, so the best trade is none: protect Sortino and drawdown.' },
    ],
  },
];

export const LESSON_BY_ID: Record<string, Lesson> = Object.fromEntries(LESSONS.map((l) => [l.id, l]));

/** Event date for the weekly plan. Change when the real Preliminary Round date is known. */
export const PRELIM_DATE = '2026-12-08';
export const PLAN_START = '2026-11-17';
