# Wealthathon Trainer

Practice simulator for the **2026 BOCHK x HKU Business School Wealthathon Challenge** (AmplifyME platform).
Optimised for the Preliminary Round: a client brief, a short briefing, then one simulated year of live news in ~30 minutes, scored on return, Sortino, drawdown and mandate compliance. Pitch mode covers the Grand Final.

- **Trading terminal**: news feed, quotes and sparklines, a lightweight-charts price chart with news markers, an order ticket with hotkeys, positions/blotter, a risk panel with live mandate meters and VaR, plus the clock and score.
- **Deterministic engine** (`packages/engine`): seeded factor model, market/limit orders, shorts, leverage, margin calls and liquidation, financing, optional costs, mandate tracking, composite scoring. Same scenario + seed + rules + order log = identical session.
- **Debrief**: reaction time per headline, hit rate, best/worst trades, drawdown, breaches, turnover, plus an **optimal-path** overlay (a mandate-respecting rebalance at each headline using the headline's known shocks) and the biggest missed opportunities.
- **AI layer on your Mac** (`worker/`): scenario + client generation (validated by code), coach critique and pitch judge. Runs through `claude -p` on your Claude subscription, with no API key.
- **Works with the Mac off**: 15 validated scenarios + 5 historical episodes + 10 clients are already in Supabase. Guests can play without an account.

## Run locally

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. Guest mode works immediately. Sign in to sync sessions and use the AI features.

| Command | What it does |
|---|---|
| `npm test` | Engine + worker test suite (determinism, factor coherence, margin, mandate, scoring, validator, debrief) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run worker` | Start the AI worker (see [worker/README.md](worker/README.md)) |
| `npx tsx worker/ai-smoke.ts` | Run the coach + judge prompts on a replayed seed session (no DB) |
| `npm run worker:dry -- medium` | Generate + validate one scenario and one client with Claude, without the DB |
| `npm run fetch-history` | Re-download historical episode prices from Yahoo Finance into `public/seed/history/` (`-- --push` also uploads them) |
| `npm run seed` | Upsert seed scenarios, procedural fillers, historical episodes and clients into Supabase (needs the service-role key) |

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + `.env.local` | `https://fdjzwksirelrrafxtcxt.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel + `.env.local` | The publishable key (safe in the browser; RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Mac `.env.local` only** | Worker and seed script. Bypasses RLS, so never put it in Vercel or git |
| `WORKER_MODEL` | Mac, optional | Claude model for the worker, e.g. `claude-sonnet-5-5` |
| `WHISPER_MODEL`, `WHISPER_BIN`, `FFMPEG_BIN` | Mac, optional | Audio transcription fallback for pitch mode |

## Supabase

Project **wealthathon-trainer** (Singapore, free tier). The schema is in `supabase/migrations/0001_init.sql` and has already been applied:
`profiles, scenarios, clients, sessions, participants, orders, fills, snapshots, scores, ai_jobs, debriefs, pitches, worker_heartbeats`, plus a private `pitch-audio` storage bucket. RLS is on for every table. Users only see their own sessions, scores, jobs and pitches. Scenarios and clients are read-only to the app and written only by the worker / seed script (service role).

Auth: email + password or magic link. If sign-up emails are slow (Supabase's built-in mailer is rate-limited), turn off "Confirm email" under Authentication → Providers → Email while you're the only user.

**Multiplayer-ready**: `sessions → participants (role: solo | news_analyst | trader | risk_manager) → orders/fills/snapshots/scores`. Membership checks go through `private.is_session_member()`, `orders` is in the Realtime publication, and `scores.team_id` is reserved. Team mode means adding participants to a session and broadcasting order inputs. Because the engine is deterministic, every client can replay the same input log.

## Deploy to Vercel

1. Push this repo to GitHub.
2. Vercel → Add New Project → import the repo (framework auto-detects Next.js).
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Production + Preview). Deploy.
4. Supabase → Authentication → URL Configuration: set the Site URL to your Vercel URL so magic links come back to it.

## Editing `config/event-rules.ts` when the real rules arrive

Every rule lives in this one file. Nothing else hard-codes a rule. Each new session stores a full snapshot of the rules, so old sessions stay comparable.

| You learn… | Edit |
|---|---|
| Starting capital | `startingCapital` |
| Scoring formula / weights | `scoring.weights` (normalised automatically), `returnBounds`, `sortinoBounds`, `drawdownZeroAt` |
| The asset list | `assets[]`: add/remove entries. Each needs `cls`, `group`, `currency`, `startPrice`, `loadings` on the 7 factors, `idioVol`, `carry`. Optional `singleName`, `tags` (for ESG exclusions), `band` (pegs), `historyTicker` (Yahoo symbol for replays). Then run `npm run fetch-history` if you use historical mode. |
| Costs are charged | `costs.enabled = true`, `commissionBps`, `spreadBps` per class |
| No shorting / no leverage | `shorting.allowed`, `margin.allowed`, `margin.maxLeverage`, margin rates |
| Only market orders | `orders.types` |
| Session length / briefing time | `clock.defaultSessionMinutes`, `clock.briefingSeconds`, `difficulty.*.sessionMinutes` |
| Mandate penalty | `mandate.breachGraceTicks`, `penaltyMultiplier`, `hardBlock` (reject breaching orders) |
| How fast news hits prices | `news.impactLagTicks` |

The Settings page lets you override capital, weights, costs and briefing time per account without editing the file. Bump `version` when you change the file so the debriefs show which rules a session used.

## How the simulation works

- One session is always `clock.totalTicks` = 1200 ticks (one year). The wall-clock length (15-45 min) only changes the seconds per tick, so the price path never depends on play speed.
- Price model: each tick, 7 factors move (drift + regime drift + vol × noise + news shocks); each asset's log-return = Σ loading × factor move + carry + idiosyncratic noise. News shocks are spread over a few ticks (`impactLagTicks`); "slow burn" events over ~80 ticks. USD/HKD is clamped to the 7.75-7.85 band.
- Simplification: every instrument is quoted and settled as HKD per unit (no separate FX conversion), and currency buckets are used only for mandate constraints.
- Historical replays interpolate real daily closes (rebased to the configured start prices) across the 1200 ticks; "disguise" hides dates, the episode name and identifying headline words.

## Project layout

```
config/event-rules.ts      all rules
packages/engine/           deterministic engine + tests (path, runner, mandate, scoring, report, validator, procedural)
seed/                      hand-written scenarios, clients, historical headlines
public/seed/history/       fetched historical price data (also in Supabase)
src/app/                   Next.js pages: practice, play/[id], debrief/[id], leaderboard, progress, pitch, settings, login
src/lib/store.ts           Supabase (cloud) and localStorage (guest) data layer
worker/                    local AI worker (Claude Code headless), launchd plist
scripts/                   fetch-history, seed-db
supabase/migrations/       schema + RLS
```
