# Learn section: spec

Status: agreed in interview, 17 Nov 2026. Not built yet.

## 1. Goal

Nicolas and AG have little trading experience and under 3 weeks until the Preliminary Round (assumed date: **8 Dec 2026**). They have a few hours a week each. Learn should turn them into competent simulation traders by teaching:
- a small set of **reusable strategy playbooks**;
- **how the score rewards risk control**.

Practice happens **inside the real trading terminal**, so the habits carry over to the event.

### Principles (from the interview)

| Decision | Choice |
|---|---|
| Grounding | **Real-world first.** Teach market mechanics and scoring logic that carry over to AmplifyME. Our engine is the practice ground, not the thing to game. No engine-specific tricks. |
| Main formats | **Guided mini-sessions** + **strategy playbooks** (no standalone reading-only course, no quiz drills) |
| Content source | **Hand-authored** and shipped with the app; works without the AI worker. |
| Roles | Same path for both players (no trader/risk split). |
| Order | Open: everything unlocked, with a suggested order. |
| Pacing | **Weekly plan** over 3 weeks, counting down to the event. |
| Device | Laptop-first. It must still work on the phone layout, but nothing is designed for phone first. |
| Jargon | Plain English. Finance terms are underlined; tap or hover shows a one-line glossary definition. |

## 2. What gets built

1. **`/learn` page**:
   - weekly plan;
   - list of the 10 lessons with status;
   - playbook library;
   - progress for both players;
   - link to the cheat sheet.
2. **Guided lesson player** (`/learn/[lessonId]`): a scripted mini-session in the normal terminal that pauses at decision points.
3. **Playbook library** (`/learn/playbooks`, plus a detail view): named plays with trigger → what moves → size → exit → risks.
4. **One-page cheat sheet** (`/learn/cheatsheet`): printable, fits one screen or A4.
5. **Hint mode** for normal practice sessions: optional, and flagged on the session.
6. **Glossary**: a shared term list with an inline `<Term>` component.
7. **Data**: a lesson-attempts table. The AI coach gets a "learned / struggling playbooks" context.
8. **Nav**: a new "Learn" tab, placed after Practice.

## 3. Curriculum: 10 guided lessons, 10–15 minutes each

Every lesson has the same shape:
1. **Concept card.** A 60–90 second read: plain English, 1 diagram or worked example, and links to the playbook(s).
2. **Guided mini-session.** A short scripted market (3–5 minutes of sim time) in the real terminal with 2–4 **decision points**.
3. **Results.** A process grade per decision, the outcome shown separately, and the "why" answers.
4. **Takeaway.** 1–3 bullets, added to the cheat sheet.

| # | Lesson | Core idea | Playbooks introduced |
|---|---|---|---|
| 1 | How you're scored | Return is only 35%. Sortino, drawdown and mandate are 65%. Losing less beats winning more. | "Protect the downside" |
| 2 | Client brief → opening allocation | Read the constraints first, build a mandate-safe base portfolio, and keep a cash buffer. | "Mandate-safe opening" |
| 3 | Headline → driver → asset | The 7 drivers (growth/equity, China/HK, rates, USD, credit, commodities, risk-off). Which assets load on each, and which way. | "Driver map" |
| 4 | Rates surprise | Hawkish or dovish surprises; bonds vs. equities vs. USD; HIBOR follows US rates via the peg. | "Hawkish surprise", "Dovish surprise" |
| 5 | China stimulus | HSCEI, Tencent, BYD, HSI, commodities, CNH. Buy the confirmed headline, not the rumour. | "China stimulus" |
| 6 | Risk-off shock | Bank failure, war, crisis: cut risk, hold Treasuries and gold, avoid high yield. Prices move over several ticks. | "Risk-off" |
| 7 | Oil supply shock | Brent up, equities down a bit, inflation worries feeding into rates. | "Oil supply shock" |
| 8 | Rumours & denials | Unconfirmed "sources say" headlines: trade small or fade them, and expect denials. | "Rumour fade" |
| 9 | Sizing | % of NAV presets, starting small and adding on confirmation, cutting losers, max single-trade size. | "Scale in", "Cut the loser" |
| 10 | Mandate & drawdown under pressure | Fixing a breach within the grace period, de-risking after a drawdown, and when sitting in cash is the right trade. | "Breach fix", "Sit in cash" |

Lessons 4–8 each cover one news type. Lessons 1, 2, 9 and 10 cover risk and process.

### Playbook format (`config/learn/playbooks.ts`)

```ts
interface Playbook {
  id: string;                       // 'hawkish-surprise'
  name: string;                     // 'Hawkish surprise'
  trigger: string;                  // plain-English description of the headline type
  categories: NewsCategory[];       // ties to EVENT_RULES.newsCategories, for hint matching
  factorSignature: Record<string, number>; // sign pattern of factor shocks, for hint matching
  moves: { assetId: string; dir: 1 | -1; strength: 1 | 2 }[];  // "key moves"
  size: string;                     // e.g. "2–5% of NAV first, add on confirmation"
  exit: string;                     // e.g. "take profit after the reaction (≈ lag ticks) or on reversal headline"
  risks: string[];                  // e.g. "denial risk", "mandate equity cap"
  universal: true;                  // real-world-first: every playbook must hold outside this sim
  lessonId: string;
}
```

## 4. Guided mini-session design

### Scenario scripting
- Each lesson defines a **lesson script** (`config/learn/lessons.ts`) containing:
  - a hand-written `Scenario`: regime, 3–6 events, and a client with simple constraints;
  - a fixed seed;
  - decision points.
- The scripts are made of ordinary engine `Scenario` objects. That keeps them deterministic, replayable and covered by the existing validator. Each script must pass `validateScenario` in a unit test.
- Session length is short: 3–5 minutes for one simulated quarter. The tick count stays at the rules default; only the sim-time window changes. The exact mechanism is decided during build.
- **First attempt** uses the fixed, hand-checked script.
- **Retries** use a new seed and, where the lesson defines alternates, a different headline of the same playbook type. That way you can't memorise. Each lesson ships 2–3 alternate headlines per decision point.

### Decision points
```ts
interface DecisionPoint {
  id: string;
  atEvent: string;                  // pause right after this event lands (or atTick)
  prompt: string;                   // "The Fed just surprised hawkish. Act."
  playbookId: string;
  expect: {
    assets?: { assetId: string; dir: 1 | -1 }[];   // acceptable directional trades (any subset ≥ 1)
    avoid?: { assetId: string; dir: 1 | -1 }[];    // trades that count as wrong-way
    sizePctNav?: [number, number];                 // acceptable gross size added
    mandateSafe: boolean;                          // must not create a breach
    flatOk?: boolean;                              // "doing nothing" is acceptable (e.g. rumour)
  };
  timeLimitSec?: number;            // absent = untimed
  askWhy: boolean;
}
```
- At a decision point the **clock stops**. A non-blocking banner sits over the terminal with the prompt. The terminal stays fully usable: you place real orders with the normal ticket and hotkeys. Then press **"Done: continue"**.
- **Timer progression:**
  - lessons 1–5 are untimed;
  - lessons 6–8 give 30s;
  - lessons 9–10 give 20s.
  - When the timer runs out, the clock resumes and whatever you placed is graded.
- **"Say why" step:** after each decision you write a one-line explanation (typed; voice optional, reusing `Recorder`). It feeds pitch practice later.

### Grading: process first
For each decision, the checks are:

| Check | Pass rule |
|---|---|
| Direction | Net trades on `expect.assets` go the expected way; nothing in `avoid` |
| Asset choice | At least one expected asset traded, or `flatOk` and nothing traded |
| Size | Gross notional added falls inside `sizePctNav` |
| Mandate | No new breach (uses the existing `runner.preview` / `mandateViolation`) |
| Speed (timed lessons only) | Order placed within half the time limit |
| Why | Offline: keyword check (mentions the driver or an affected asset or the direction). If the AI worker is online, a short AI comment is added asynchronously. |

- The lesson grade is the % of checks passed. A lesson is **"passed"** at 70% or more. Lessons stay open; the grade is for feedback only.
- The **outcome** (P&L from the decision to the end of the reaction window) appears separately as "what happened this time". It never changes the grade.
- The results screen shows, for each decision:
  - your trades next to the playbook's key moves;
  - a mini chart of the affected assets with the decision tick marked;
  - your "why" answer and its check.

## 5. Weekly plan (3 weeks, ending 8 Dec 2026)

The plan is fixed up front and ticked off automatically. The event date is a constant in `config/event-rules.ts` (`event.prelimDate`) so it is easy to change later.

| Week | Dates | Lessons | Practice |
|---|---|---|---|
| 1 | 17–23 Nov | 1, 2, 3, 4 | 2 Easy sessions with hint mode on |
| 2 | 24–30 Nov | 5, 6, 7, 8 | 2 Medium sessions with hints on, 1 with hints off |
| 3 | 1–8 Dec | 9, 10 + retry any lesson under 70% | 3+ Medium/Hard sessions, hints off, 1 team session, read the cheat sheet the day before |

- Plan items tick themselves: a lesson attempt, or a session at the right difficulty and hint setting.
- The current week is highlighted. Overdue items stay visible without nagging.

## 6. Hint mode (normal practice sessions)

- Toggle on the home page next to Start session: **"Hints (learning mode)"**.
- Stored on the session as `sessions.hints boolean default false`.
- When a headline lands, it is matched to a playbook by category and factor-shock sign pattern (`factorSignature`, using `expectedImpact`). If it matches, a small card appears under the headline in the News panel. It shows the playbook name and its key moves ("Hawkish surprise: long bonds ↓, USD ↑, HK property ↓"), with a link to the full playbook.
- Hints never suggest a specific size or order.
- Hinted sessions are **flagged**:
  - marked "Hints" in the debrief;
  - excluded from the leaderboard;
  - shown separately in Progress (and excluded from the trend line).
- In team mode, hints are on for both players if the session owner turned them on.

## 7. Glossary

- `config/learn/glossary.ts`: about 40 terms, each with a definition of 25 words or fewer. Examples: Sortino, drawdown, NAV, basis point, duration, risk-off, HIBOR, peg, high yield, leverage, margin call, short, limit order, mandate, notional, % of NAV.
- `<Term id="sortino">Sortino</Term>` renders a dotted underline with a tooltip on hover and a popover on tap.
- Used in lessons, playbooks, the cheat sheet, and the existing Briefing and Risk panel labels where cheap.

## 8. Cheat sheet (`/learn/cheatsheet`)

- One page:
  - the playbook table (trigger → key moves → size → exit);
  - the driver map (7 drivers × asset groups, arrows);
  - "scoring rules of thumb" (5 bullets);
  - a pre-trade checklist (mandate, size, why).
- A print stylesheet makes it fit A4. On screen it is a dense single page.
- It is generated from the same playbook and lesson data, so it is never out of sync.

## 9. Progress, sharing and AI coach

### Data model (new migration `0004_learn.sql`, RLS on everything)

```sql
create table public.lesson_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  lesson_id text not null,
  attempt int not null,
  seed text not null,
  variant jsonb not null default '{}',      -- which alternate headlines were used
  decisions jsonb not null,                 -- per decision: trades, checks, outcome, why, ai_comment
  grade numeric not null,                   -- 0–100
  passed boolean not null,
  created_at timestamptz not null default now()
);
-- RLS: insert/update own rows; select for any authenticated user (both players see each other's progress)
alter table public.sessions add column hints boolean not null default false;
```

The engine input log goes in `decisions`, so a lesson attempt can be replayed exactly.

### Sharing
- `/learn` shows a two-column progress board (Nicolas | AG): best grade per lesson, last attempt date, and weekly-plan ticks.
- Lessons are done solo. There is no team lesson mode.

### AI coach integration
- The coach payload (`src/lib/context.ts`) gains `learning: { passed: string[]; struggling: string[] }`, listing playbook ids from lesson attempts. "Struggling" means the best grade is under 70% or the last 2 attempts failed.
- The coach prompt is told to reference playbooks by name, e.g. "this was a Hawkish surprise; see Lesson 4".
- Debrief "Headline by headline" rows get a playbook tag when a headline matches, linking to the playbook. This works even without the worker.
- "Why" AI comments are queued as a small `ai_jobs` type `lesson_why`, only when the worker is online. Lessons never wait for it.
- **Not** in the leaderboard or the Progress trend.

## 10. Implementation notes

**Engine**
- No new market mechanics.
- Needs: a pause-at-tick hook (the runner already steps manually), plus `gradeDecision(runner, decisionPoint, ordersSince)` in a new `packages/engine/src/learn.ts`.
- Playbook matching (`matchPlaybook(event, rules)`) also lives there, with unit tests.

**Terminal**
- Reuse `Terminal` with a new optional `lesson` prop: a decision banner, a "Done: continue" button and a timer.
- The clock stays stopped while the banner is open.
- No changes to scoring.

**Content files**
- `config/learn/{lessons,playbooks,glossary}.ts`, all typed with Zod.
- A test checks that:
  - every lesson validates;
  - every playbook referenced exists;
  - every decision's expected directions agree with `expectedImpact` for its event.

**Pages**
- `/learn`, `/learn/[lessonId]`, `/learn/playbooks`, `/learn/playbooks/[id]`, `/learn/cheatsheet`.
- Laptop-first layout. The existing mobile CSS keeps them usable on a phone.

**Offline/local mode**
- Lessons work in local mode, with attempts kept in localStorage via the `Store` interface (`saveLessonAttempt`, `listLessonAttempts`).

**Docs**
- Add a section to `PROGRESS.md` and a "Learn" paragraph to the README.

## 11. Acceptance criteria

1. All 10 lessons are playable start to finish on a laptop, each in 15 minutes or less, with no AI worker running.
2. In each decision, trading the playbook's key moves at the right size, without a breach, scores 100% on process. Doing the opposite scores under 50%. Both cases are covered by engine tests per lesson.
3. Retrying a lesson gives a different seed and, where defined, a different headline of the same type.
4. Timed decisions auto-continue when the timer runs out. Untimed ones wait.
5. Hint mode shows playbook cards for matching headlines.
6. Hinted sessions are flagged in the debrief, excluded from the leaderboard, and separated in Progress.
7. Both players see each other's lesson progress. RLS stops anyone from writing another player's attempts.
8. The cheat sheet prints on one A4 page.
9. The coach output references playbook names when the learning context marks one as struggling.
10. Desktop terminal behaviour outside lessons is unchanged. All existing tests still pass.

## 12. Out of scope (for now)

- Quiz-style drills and long reading courses.
- Role-specific tracks.
- Gated unlocks.
- A readiness "mock Prelim" score.
- AI-generated lessons.
- A separate Grand Final pitch lesson (the "why" answers prepare for it).

## 13. Open questions

- The real Prelim date: replace the 8 Dec assumption in `event.prelimDate` once it's known.
- Once the real AmplifyME asset list and rules arrive, re-check that each playbook's key moves still apply. They are written to be universal, but the asset names may differ.
