import { z } from 'zod';
import type { AssetClass, Difficulty, EventRules, AssetDef } from '@config/event-rules';

export type { AssetClass, Difficulty, EventRules, AssetDef };

// ── Scenario schema (strict JSON; also what the AI worker must return) ───────
export const SOURCE_STYLES = ['wire', 'central_bank', 'filing', 'rumour'] as const;
export const CATEGORIES = ['central_bank', 'earnings', 'geopolitics', 'china_policy', 'macro_data', 'commodities', 'credit'] as const;
export const EVENT_KINDS = ['normal', 'fakeout', 'denial', 'slow_burn', 'conflicting'] as const;

export const NewsEventSchema = z.object({
  id: z.string().min(1),
  /** Position in the session, 0..1 (fraction of the simulated year). */
  t: z.number().min(0).max(1),
  headline: z.string().min(8).max(160),
  /** Anonymised headline shown when a historical episode is disguised. */
  altHeadline: z.string().max(160).optional(),
  body: z.string().min(10).max(600),
  source: z.enum(SOURCE_STYLES),
  category: z.enum(CATEGORIES),
  magnitude: z.enum(['minor', 'moderate', 'major']),
  kind: z.enum(EVENT_KINDS).default('normal'),
  /** For `denial` events: the id of the rumour being denied. */
  linkedTo: z.string().optional(),
  /** Author's own read of risk sentiment: -1 bearish for risk assets, +1 bullish, 0 mixed. */
  sentiment: z.number().int().min(-1).max(1),
  /** Expected factor shocks (factor id -> size in the factor's unit). */
  factorShocks: z.record(z.string(), z.number()).default({}),
  /** Optional asset-specific shocks (asset id -> fractional return). */
  assetShocks: z.record(z.string(), z.number()).optional(),
  /** Real calendar date (historical scenarios only). */
  date: z.string().optional(),
});
export type NewsEvent = z.infer<typeof NewsEventSchema>;

export const RegimeSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().min(10).max(600),
  /** Annualised extra drift per factor during this scenario. */
  factorDrift: z.record(z.string(), z.number()).default({}),
  /** Multiplier on all factor volatilities (1 = normal). */
  volMult: z.number().min(0.4).max(2.5).default(1),
});

export const HistoricalDataSchema = z.object({
  episodeId: z.string(),
  realTitle: z.string(),
  disguisedTitle: z.string(),
  dates: z.array(z.string()),
  /** asset id -> daily closes aligned with `dates`. Missing assets are not tradable. */
  series: z.record(z.string(), z.array(z.number())),
});

export const ScenarioSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(3).max(120),
  source: z.enum(['synthetic', 'historical']),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  storyline: z.string().min(20).max(1500),
  regime: RegimeSchema,
  events: z.array(NewsEventSchema).min(3).max(40),
  historical: HistoricalDataSchema.optional(),
  generator: z.string().optional(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

// ── Client mandate ───────────────────────────────────────────────────────────
export const ConstraintSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('maxClass'), cls: z.enum(['equity', 'bond', 'cash', 'fx', 'commodity']), max: z.number().min(0).max(1) }),
  z.object({ type: z.literal('minClass'), cls: z.enum(['equity', 'bond', 'cash', 'fx', 'commodity']), min: z.number().min(0).max(1) }),
  z.object({ type: z.literal('maxSingleName'), max: z.number().min(0.01).max(1) }),
  z.object({ type: z.literal('noShort') }),
  z.object({ type: z.literal('maxLeverage'), max: z.number().min(1).max(4) }),
  z.object({ type: z.literal('currencyMin'), currency: z.enum(['HKD', 'USD']), min: z.number().min(0).max(1) }),
  z.object({ type: z.literal('excludeTag'), tag: z.string(), label: z.string() }),
]);
export type Constraint = z.infer<typeof ConstraintSchema>;

export const ClientSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2).max(80),
  age: z.number().int().min(18).max(100),
  occupation: z.string().max(120),
  wealthHKD: z.number().positive(),
  goal: z.enum(['income', 'growth', 'capital_preservation', 'liquidity']),
  goalDetail: z.string().max(300),
  riskProfile: z.number().int().min(1).max(5),
  horizonYears: z.number().min(0.5).max(40),
  notes: z.string().max(500),
  constraints: z.array(ConstraintSchema).min(1).max(8),
});
export type Client = z.infer<typeof ClientSchema>;

// ── Trading ──────────────────────────────────────────────────────────────────
export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderSource = 'user' | 'opening' | 'liquidation';
export interface OrderInput { assetId: string; side: Side; qty: number; type: OrderType; limitPrice?: number; source?: OrderSource; participantId?: string }
export interface Order extends OrderInput {
  id: string; tick: number; status: 'working' | 'filled' | 'cancelled' | 'rejected'; reason?: string; source: OrderSource;
}
export interface Fill {
  id: string; orderId: string; tick: number; assetId: string; side: Side; qty: number; price: number; fee: number; realizedPnl: number; source: OrderSource;
  /** Team mode: who placed the order. */
  participantId?: string;
}
/** Deterministic input log: replaying it over the same path reproduces the session exactly. */
export type LogEntry = { tick: number; kind: 'place'; input: OrderInput } | { tick: number; kind: 'cancel'; orderId: string } | { tick: number; kind: 'end' };

export interface Position { qty: number; avg: number }
export interface MandateCheck { key: string; label: string; value: number; limit: number; ok: boolean; util: number; kind: 'max' | 'min' | 'flag'; breachTicks: number }
export interface ScoreBreakdown { return: number; sortino: number; drawdown: number; mandate: number; composite: number }
export interface Metrics {
  tick: number; equity: number; cash: number; pnl: number; ret: number; sortino: number; maxDD: number; curDD: number;
  gross: number; leverage: number; marginUsed: number; marginAvail: number; maintenance: number; marginCall: boolean; bust: boolean;
  exposureByClass: Record<AssetClass, number>; var95: number; mandate: MandateCheck[]; penalisedTicks: number; score: ScoreBreakdown;
}
export interface Snapshot { tick: number; equity: number; cash: number; positions: Record<string, number>; score: number }
export interface BreachEpisode { key: string; label: string; startTick: number; endTick: number; penalisedTicks: number }
