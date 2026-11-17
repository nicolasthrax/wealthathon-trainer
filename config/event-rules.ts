/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  WEALTHATHON TRAINER — EVENT RULES
 *  The ONE place where every rule of the simulation lives.
 *
 *  When BOCHK / HKU / AmplifyME publish the real rules, edit this file only:
 *  starting capital, asset list, scoring weights, costs, margin, clock, etc.
 *  Nothing else in the codebase hard-codes a rule. Each session stores a full
 *  snapshot of this object, so old sessions stay comparable after you edit it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type AssetClass = 'equity' | 'bond' | 'cash' | 'fx' | 'commodity';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Magnitude = 'minor' | 'moderate' | 'major';

export interface FactorDef {
  id: string;
  name: string;
  /** Annualised volatility, in the factor's own unit (see `unit`). */
  vol: number;
  /** Annualised baseline drift. */
  drift: number;
  unit: string;
  /** Largest plausible one-headline shock per magnitude tier (validator). */
  maxShock: Record<Magnitude, number>;
}

export interface AssetDef {
  id: string;
  ticker: string;
  name: string;
  cls: AssetClass;
  group: 'HK/China' | 'Global Equity' | 'Bonds & Cash' | 'FX & Commodities';
  /** Currency bucket used by "HKD-heavy / USD-heavy" mandate constraints. */
  currency: 'HKD' | 'USD' | 'EUR' | 'JPY' | 'CNH';
  startPrice: number;
  decimals: number;
  /** Sensitivity to each factor. For RATES/CREDIT this is minus (spread) duration. */
  loadings: Record<string, number>;
  /** Annualised asset-specific volatility. */
  idioVol: number;
  /** Annualised carry / yield accrual. */
  carry: number;
  /** Counts for the "max % in one name" mandate constraint. */
  singleName?: boolean;
  /** Free tags used by exclusion constraints (e.g. ESG "fossil"). */
  tags?: string[];
  /** Hard price band (USD/HKD peg). */
  band?: [number, number];
  /** Yahoo Finance symbol used by scripts/fetch-history.ts (historical replay). */
  historyTicker?: string;
  /** Keep the real price level in historical replay (FX) instead of rebasing. */
  rawHistory?: boolean;
}

const F = (g: number, c: number, r: number, u: number, cr: number, cm: number, ro: number) => ({
  GEQ: g, CNHK: c, RATES: r, USD: u, CREDIT: cr, CMDTY: cm, RISKOFF: ro,
});

export const EVENT_RULES = {
  version: '2026-11-draft-1',
  eventName: 'BOCHK x HKU Business School Wealthathon Challenge 2026',
  baseCurrency: 'HKD',
  /** Starting capital in HKD. */
  startingCapital: 10_000_000,

  // ── Clock ────────────────────────────────────────────────────────────────
  clock: {
    /** A session always simulates one year in exactly this many ticks, so the
     *  price path does not depend on how fast you play it. */
    totalTicks: 1200,
    tradingDaysPerYear: 252,
    defaultSessionMinutes: 30,
    minSessionMinutes: 15,
    maxSessionMinutes: 45,
    /** Rules-briefing phase before the clock starts. */
    briefingSeconds: 180,
  },

  // ── Factor model ─────────────────────────────────────────────────────────
  factors: [
    { id: 'GEQ', name: 'Global equity', vol: 0.15, drift: 0.06, unit: 'return',
      maxShock: { minor: 0.012, moderate: 0.035, major: 0.09 } },
    { id: 'CNHK', name: 'China / HK equity', vol: 0.17, drift: 0.0, unit: 'return',
      maxShock: { minor: 0.015, moderate: 0.045, major: 0.11 } },
    { id: 'RATES', name: 'US interest rates', vol: 0.009, drift: 0.0, unit: 'yield change (0.01 = 100bp)',
      maxShock: { minor: 0.0008, moderate: 0.0025, major: 0.006 } },
    { id: 'USD', name: 'US dollar', vol: 0.07, drift: 0.0, unit: 'return',
      maxShock: { minor: 0.004, moderate: 0.012, major: 0.03 } },
    { id: 'CREDIT', name: 'Credit spreads', vol: 0.011, drift: 0.0, unit: 'spread change (0.01 = 100bp)',
      maxShock: { minor: 0.001, moderate: 0.004, major: 0.015 } },
    { id: 'CMDTY', name: 'Commodities', vol: 0.24, drift: 0.0, unit: 'return',
      maxShock: { minor: 0.02, moderate: 0.06, major: 0.15 } },
    { id: 'RISKOFF', name: 'Risk-off / fear', vol: 0.07, drift: 0.0, unit: 'intensity',
      maxShock: { minor: 0.012, moderate: 0.04, major: 0.1 } },
  ] as FactorDef[],

  // ── Asset universe ───────────────────────────────────────────────────────
  //                         GEQ   CNHK  RATES   USD  CREDIT CMDTY RISKOFF
  assets: [
    { id: 'HSI', ticker: '2800', name: 'Tracker Fund (Hang Seng ETF)', cls: 'equity', group: 'HK/China', currency: 'HKD',
      startPrice: 26.5, decimals: 2, loadings: F(0.9, 1.0, -2, -0.3, -1, 0, -0.4), idioVol: 0.04, carry: 0, historyTicker: '2800.HK' },
    { id: 'HSCEI', ticker: '2828', name: 'Hang Seng China Enterprises ETF', cls: 'equity', group: 'HK/China', currency: 'HKD',
      startPrice: 96, decimals: 2, loadings: F(0.9, 1.2, -1, -0.4, -1, 0, -0.4), idioVol: 0.05, carry: 0, historyTicker: '^HSCE' },
    { id: 'HSBC', ticker: '0005', name: 'HSBC Holdings', cls: 'equity', group: 'HK/China', currency: 'HKD',
      startPrice: 108, decimals: 2, loadings: F(0.8, 0.5, 3, 0, -2, 0, -0.4), idioVol: 0.14, carry: 0, singleName: true, historyTicker: '0005.HK' },
    { id: 'TENCENT', ticker: '0700', name: 'Tencent Holdings', cls: 'equity', group: 'HK/China', currency: 'HKD',
      startPrice: 620, decimals: 1, loadings: F(1.0, 1.4, -3, -0.3, 0, 0, -0.4), idioVol: 0.2, carry: 0, singleName: true, historyTicker: '0700.HK' },
    { id: 'AIA', ticker: '1299', name: 'AIA Group', cls: 'equity', group: 'HK/China', currency: 'HKD',
      startPrice: 78, decimals: 2, loadings: F(0.9, 0.8, 1, -0.2, -1.5, 0, -0.4), idioVol: 0.16, carry: 0, singleName: true, historyTicker: '1299.HK' },
    { id: 'BYD', ticker: '1211', name: 'BYD Company', cls: 'equity', group: 'HK/China', currency: 'HKD',
      startPrice: 118, decimals: 2, loadings: F(1.0, 1.3, -2, -0.3, 0, -0.1, -0.4), idioVol: 0.26, carry: 0, singleName: true, historyTicker: '1211.HK' },
    { id: 'SHKP', ticker: '0016', name: 'Sun Hung Kai Properties', cls: 'equity', group: 'HK/China', currency: 'HKD',
      startPrice: 96, decimals: 2, loadings: F(0.6, 0.8, -8, 0, -1, 0, -0.3), idioVol: 0.15, carry: 0, singleName: true, historyTicker: '0016.HK' },

    { id: 'SPX', ticker: 'SPX', name: 'S&P 500', cls: 'equity', group: 'Global Equity', currency: 'USD',
      startPrice: 6800, decimals: 0, loadings: F(1.0, 0, -2, 0, -1, 0, -0.5), idioVol: 0.03, carry: 0, historyTicker: '^GSPC' },
    { id: 'NDX', ticker: 'NDX', name: 'Nasdaq 100', cls: 'equity', group: 'Global Equity', currency: 'USD',
      startPrice: 25000, decimals: 0, loadings: F(1.25, 0, -5, 0, -1, 0, -0.6), idioVol: 0.06, carry: 0, historyTicker: '^NDX' },
    { id: 'SX5E', ticker: 'SX5E', name: 'Euro Stoxx 50', cls: 'equity', group: 'Global Equity', currency: 'EUR',
      startPrice: 5700, decimals: 0, loadings: F(1.0, 0.1, -1, -0.2, -1.5, 0.05, -0.5), idioVol: 0.06, carry: 0, historyTicker: '^STOXX50E' },
    { id: 'NKY', ticker: 'NKY', name: 'Nikkei 225', cls: 'equity', group: 'Global Equity', currency: 'JPY',
      startPrice: 50000, decimals: 0, loadings: F(0.9, 0.15, 0, 0.5, -1, 0, -0.5), idioVol: 0.08, carry: 0, historyTicker: '^N225' },

    { id: 'UST2', ticker: 'UST2Y', name: 'US Treasuries 1-3Y (short)', cls: 'bond', group: 'Bonds & Cash', currency: 'USD',
      startPrice: 100, decimals: 2, loadings: F(0, 0, -1.9, 0, 0, 0, 0.02), idioVol: 0.003, carry: 0.04, historyTicker: 'SHY' },
    { id: 'UST20', ticker: 'UST20Y', name: 'US Treasuries 20Y+ (long)', cls: 'bond', group: 'Bonds & Cash', currency: 'USD',
      startPrice: 100, decimals: 2, loadings: F(0, 0, -16, 0, 0, 0, 0.15), idioVol: 0.02, carry: 0.045, historyTicker: 'TLT' },
    { id: 'HKGB', ticker: 'HKGB', name: 'HK Government Bond 5-7Y', cls: 'bond', group: 'Bonds & Cash', currency: 'HKD',
      startPrice: 100, decimals: 2, loadings: F(0, 0, -5, 0, 0, 0, 0.05), idioVol: 0.012, carry: 0.035, historyTicker: 'IEF' },
    { id: 'IG', ticker: 'IGCR', name: 'USD Investment Grade Credit', cls: 'bond', group: 'Bonds & Cash', currency: 'USD',
      startPrice: 100, decimals: 2, loadings: F(0, 0, -7, 0, -2.5, 0, -0.05), idioVol: 0.012, carry: 0.05, historyTicker: 'LQD' },
    { id: 'HY', ticker: 'HYCR', name: 'USD High Yield Credit', cls: 'bond', group: 'Bonds & Cash', currency: 'USD',
      startPrice: 100, decimals: 2, loadings: F(0.15, 0, -3.5, 0, -4, 0, -0.15), idioVol: 0.02, carry: 0.075, tags: ['high-yield'], historyTicker: 'HYG' },
    { id: 'HKDMM', ticker: 'HKDMM', name: 'HKD Money Market Fund', cls: 'cash', group: 'Bonds & Cash', currency: 'HKD',
      startPrice: 100, decimals: 3, loadings: F(0, 0, 0, 0, 0, 0, 0), idioVol: 0, carry: 0.038 },

    { id: 'USDHKD', ticker: 'USDHKD', name: 'USD/HKD (pegged 7.75-7.85)', cls: 'fx', group: 'FX & Commodities', currency: 'USD',
      startPrice: 7.8, decimals: 4, loadings: F(0, 0, 0.5, 0.03, 0, 0, 0.01), idioVol: 0.004, carry: 0, band: [7.75, 7.85], historyTicker: 'HKD=X', rawHistory: true },
    { id: 'USDCNH', ticker: 'USDCNH', name: 'USD/CNH', cls: 'fx', group: 'FX & Commodities', currency: 'USD',
      startPrice: 7.1, decimals: 4, loadings: F(0, -0.15, 0, 0.5, 0, 0, 0.05), idioVol: 0.02, carry: 0, historyTicker: 'CNY=X', rawHistory: true },
    { id: 'GOLD', ticker: 'XAU', name: 'Gold', cls: 'commodity', group: 'FX & Commodities', currency: 'USD',
      startPrice: 4000, decimals: 0, loadings: F(0, 0, -6, -0.8, 0, 0.15, 0.5), idioVol: 0.08, carry: 0, historyTicker: 'GC=F' },
    { id: 'BRENT', ticker: 'BRENT', name: 'Brent Crude Oil', cls: 'commodity', group: 'FX & Commodities', currency: 'USD',
      startPrice: 65, decimals: 2, loadings: F(0.3, 0, 0, -0.3, 0, 1.3, -0.3), idioVol: 0.12, carry: 0, tags: ['fossil'], historyTicker: 'BZ=F' },
  ] as AssetDef[],

  // ── News → price transmission ────────────────────────────────────────────
  news: {
    /** A headline's price impact is spread over this many ticks after it lands.
     *  Smaller = you must react faster. */
    impactLagTicks: { easy: 8, medium: 5, hard: 3 } as Record<Difficulty, number>,
    /** Default ramp length for "slow burn" events, in ticks. */
    slowBurnTicks: 80,
  },

  // ── Trading rules ────────────────────────────────────────────────────────
  orders: {
    types: ['market', 'limit'] as ('market' | 'limit')[],
    /** Quantity presets on the order ticket, as % of current NAV (hotkeys 1-5). */
    sizePresetsPctNav: [1, 2, 5, 10, 25],
  },
  shorting: {
    allowed: true,
    /** Annual borrow fee charged on short market value. */
    borrowRate: 0.01,
  },
  margin: {
    allowed: true,
    /** Hard cap on gross exposure / NAV. */
    maxLeverage: 4,
    /** Initial margin as a fraction of position value, by asset class. */
    initialRate: { equity: 0.4, bond: 0.2, cash: 0.02, fx: 0.1, commodity: 0.4 } as Record<AssetClass, number>,
    /** Maintenance margin = initial margin x this. Below it you get a margin call. */
    maintenanceFactor: 0.6,
    /** Ticks you have to fix a margin call before forced liquidation. */
    marginCallGraceTicks: 6,
    /** If NAV falls below initial margin x this, liquidation is immediate. */
    liquidationFactor: 0.4,
    /** Penalty fee on forced liquidations (bps of liquidated value). */
    liquidationFeeBps: 25,
    /** Annual interest charged on borrowed cash (negative cash balance). */
    borrowRate: 0.055,
    /** Annual interest paid on idle positive cash. (Buy HKDMM to earn yield.) */
    cashRate: 0,
  },
  /** Transaction costs. OFF by default; switch on if the real event charges them. */
  costs: {
    enabled: false,
    commissionBps: 5,
    spreadBps: { equity: 6, bond: 4, cash: 1, fx: 2, commodity: 8 } as Record<AssetClass, number>,
  },

  // ── Client mandate ───────────────────────────────────────────────────────
  mandate: {
    /** A breach lasting longer than this many ticks starts costing score. */
    breachGraceTicks: 10,
    /** Tolerance on numeric limits (0.005 = half a percentage point). */
    tolerance: 0.005,
    /** Mandate score = 100 x (1 - penaltyMultiplier x share of ticks in penalised breach). */
    penaltyMultiplier: 3,
    /** If true, orders that would breach the mandate are rejected outright. */
    hardBlock: false,
  },

  // ── Scoring ──────────────────────────────────────────────────────────────
  scoring: {
    /** Composite weights (should sum to 1; they are normalised anyway). */
    weights: { return: 0.35, sortino: 0.3, drawdown: 0.2, mandate: 0.15 },
    /** Each component is mapped linearly onto 0-100 between these bounds. */
    returnBounds: { zero: -0.1, full: 0.2 },
    sortinoBounds: { zero: -1, full: 3 },
    /** Max drawdown of 0 scores 100; at/above this it scores 0. */
    drawdownZeroAt: 0.25,
    /** Sortino is not meaningful on very few ticks. */
    minTicksForSortino: 30,
  },

  // ── Difficulty ───────────────────────────────────────────────────────────
  difficulty: {
    easy: { label: 'Easy', events: [8, 12], fakeouts: [0, 0], conflicting: [0, 1], pauseAllowed: true,
      sessionMinutes: 30, mandateTightness: 1.0, minEventGapTicks: 40 },
    medium: { label: 'Medium', events: [12, 18], fakeouts: [0, 2], conflicting: [0, 2], pauseAllowed: false,
      sessionMinutes: 30, mandateTightness: 1.0, minEventGapTicks: 20 },
    hard: { label: 'Hard', events: [18, 25], fakeouts: [1, 4], conflicting: [1, 4], pauseAllowed: false,
      sessionMinutes: 22, mandateTightness: 0.8, minEventGapTicks: 12 },
  } as Record<Difficulty, { label: string; events: [number, number]; fakeouts: [number, number]; conflicting: [number, number];
    pauseAllowed: boolean; sessionMinutes: number; mandateTightness: number; minEventGapTicks: number }>,

  // ── Scenario validator ───────────────────────────────────────────────────
  validation: {
    /** Largest implied single-asset move per headline tier (after factor loadings). */
    maxAssetMove: { minor: 0.03, moderate: 0.08, major: 0.2 } as Record<Magnitude, number>,
    /** Shocks above limit x this are rejected instead of clamped. */
    rejectAboveMultiple: 2.5,
    /** Share of events whose shock direction may disagree with blind sentiment. */
    maxSentimentMismatchFrac: 0.15,
    /** Min implied equity move for an event to be sentiment-checked. */
    sentimentMinMove: 0.004,
    /** Keyword (Jaccard) similarity above which a scenario is a duplicate. */
    maxSimilarity: 0.45,
    eventWindow: [0.02, 0.97] as [number, number],
  },

  // ── Scenario pool / AI worker ────────────────────────────────────────────
  pool: {
    /** Worker keeps at least this many validated synthetic scenarios per pool. */
    minSize: 15,
    /** Worker keeps at least this many client briefs (10 hand-written seeds + AI-generated). */
    minClients: 30,
    /** Target share of the pool per difficulty. */
    mix: { easy: 0.25, medium: 0.45, hard: 0.3 } as Record<Difficulty, number>,
    workerHeartbeatSeconds: 30,
    /** Worker considered offline after this many seconds without a heartbeat. */
    workerOfflineAfterSeconds: 90,
  },

  // ── Debrief ──────────────────────────────────────────────────────────────
  debrief: {
    /** A trade within this many ticks of a headline counts as a reaction to it. */
    reactionWindowTicks: 60,
    /** Horizon used to judge whether a trade went the right way. */
    hitHorizonTicks: 60,
    /** An asset is "relevant" to a headline if its expected move exceeds this. */
    relevantMove: 0.006,
    /** Perfect-foresight benchmark limits (on top of the client mandate). */
    optimal: { maxAssetWeight: 0.4, maxLeverage: 1.5, maxShortPerAsset: 0.2, stepWeight: 0.05 },
    snapshotEveryTicks: 20,
  },

  // ── Pitch mode (Grand Final) ─────────────────────────────────────────────
  pitch: {
    pitchSeconds: 300,
    answerSeconds: 120,
    followUps: [3, 5] as [number, number],
    criteria: [
      { id: 'clarity', label: 'Clarity & structure' },
      { id: 'suitability', label: 'Suitability reasoning' },
      { id: 'risk', label: 'Risk awareness' },
      { id: 'consistency', label: 'Consistency: said vs traded' },
      { id: 'composure', label: 'Composure under questioning' },
    ],
  },

  /** News categories used for weak-spot analytics. */
  newsCategories: ['central_bank', 'earnings', 'geopolitics', 'china_policy', 'macro_data', 'commodities', 'credit'] as const,
};

export type EventRules = typeof EVENT_RULES;

/** User-adjustable overrides (Settings page) merged over the file defaults. */
export interface RuleOverrides {
  startingCapital?: number;
  weights?: Partial<EventRules['scoring']['weights']>;
  costsEnabled?: boolean;
  briefingSeconds?: number;
}

export function applyOverrides(base: EventRules, o: RuleOverrides | null | undefined): EventRules {
  const r: EventRules = structuredClone(base);
  if (!o) return r;
  if (o.startingCapital && o.startingCapital > 0) r.startingCapital = o.startingCapital;
  if (o.weights) r.scoring.weights = { ...r.scoring.weights, ...o.weights };
  if (typeof o.costsEnabled === 'boolean') r.costs.enabled = o.costsEnabled;
  if (typeof o.briefingSeconds === 'number') r.clock.briefingSeconds = Math.max(0, o.briefingSeconds);
  return r;
}
