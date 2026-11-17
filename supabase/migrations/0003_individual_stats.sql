-- Individual stats inside team sessions (each player's own trades, attributed by fill).
alter table public.scores
  add column player_composite numeric,
  add column player_return_score numeric,
  add column player_sortino_score numeric,
  add column player_drawdown_score numeric,
  add column player_mandate_score numeric,
  add column player_pnl numeric,
  add column player_trades integer,
  add column player_hit_rate numeric,
  add column player_avg_reaction numeric,
  add column player_stats jsonb;
alter table public.debriefs add column player_report jsonb;
