import type { Difficulty, EventRules } from '../packages/engine/src/types';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function scenarioPrompt(rules: EventRules, difficulty: Difficulty, avoidTitles: string[], feedback?: string): string {
  const d = rules.difficulty[difficulty];
  const factors = rules.factors.map((f) => `- ${f.id} (${f.name}; unit: ${f.unit}; annual vol ${f.vol}). Max shock per headline: minor ±${f.maxShock.minor}, moderate ±${f.maxShock.moderate}, major ±${f.maxShock.major}`).join('\n');
  const assets = rules.assets.map((a) => `- ${a.id}: ${a.name} [${a.cls}] loadings ${Object.entries(a.loadings).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}`).join(' ')}`).join('\n');
  return `You are designing a training scenario for a student wealth-management competition (BOCHK x HKU Wealthathon, Hong Kong).
Players manage a HKD multi-asset portfolio through one simulated year while timed news headlines land. Prices come from a factor model:
asset return = sum(loading x factor move) + noise. Each headline you write carries "factorShocks" (factor moves) and optional "assetShocks" (stock-specific % moves). The engine turns them into price jumps.

FACTORS
${factors}

ASSETS (loadings; RATES/CREDIT loadings are minus duration, so RATES +0.002 (=+20bp) moves UST20 by -16 x 0.002 = -3.2%)
${assets}

DIFFICULTY: ${difficulty.toUpperCase()}
- Exactly ${d.events[0]}-${d.events[1]} events in total.
- ${d.fakeouts[0]}-${d.fakeouts[1]} "fakeout" events (source "rumour", e.g. "Sources say...") EACH followed later by exactly one "denial" event (kind "denial", linkedTo = the rumour's id) that reverses most of the move.
- ${d.conflicting[0]}-${d.conflicting[1]} "conflicting" events: good for one asset class and bad for another (sentiment 0).
- ${difficulty === 'easy' ? 'Headlines must be clear and unambiguous.' : difficulty === 'hard' ? 'Dense, fast news; include 1-2 "slow_burn" events (effect builds over weeks) and some ambiguity.' : 'Event-like pace; 0-2 "slow_burn" events allowed.'}
- Event times "t" are fractions of the year in [${rules.validation.eventWindow[0]}, ${rules.validation.eventWindow[1]}], sorted ascending, at least ${(d.minEventGapTicks / rules.clock.totalTicks + 0.002).toFixed(3)} apart.

REALISM RULES (a code validator enforces these; violations are rejected)
- Shock direction must match the headline: a hawkish surprise raises RATES and USD and hurts equities; China stimulus raises CNHK; a war/crisis raises RISKOFF; etc.
- "sentiment" = your read for global risk assets (equities): -1 bearish, +1 bullish, 0 mixed. It must agree with the sign of the average equity move your shocks imply.
- Respect the max shock sizes above. Biggest implied single-asset move: minor ≤ ${pct(rules.validation.maxAssetMove.minor)}, moderate ≤ ${pct(rules.validation.maxAssetMove.moderate)}, major ≤ ${pct(rules.validation.maxAssetMove.major)}.
- Use Hong Kong / China / global macro themes: Fed, HKMA and the USD/HKD peg, HIBOR, PBoC, Beijing policy, property developers, tariffs, earnings of HSBC/Tencent/AIA/BYD/SHKP, oil, credit events. Invent plausible but fictional specifics; no real dates.
- Headlines: wire-service style, ≤ 140 chars. Body: 1-3 factual sentences adding detail a trader would use.
- Make the storyline coherent: a starting regime, then a plot with 2-3 acts.
${avoidTitles.length ? `- Must be clearly different from these existing scenarios: ${avoidTitles.slice(0, 40).join('; ')}` : ''}

OUTPUT: ONLY a JSON object, no prose:
{
  "title": "3-6 word title",
  "storyline": "3-5 sentences",
  "regime": { "name": "short", "description": "1-2 sentences", "factorDrift": { "GEQ": 0.03 }, "volMult": 1.0 },
  "events": [
    { "id": "e1", "t": 0.05, "headline": "...", "body": "...", "source": "wire|central_bank|filing|rumour", "category": "central_bank|earnings|geopolitics|china_policy|macro_data|commodities|credit",
      "magnitude": "minor|moderate|major", "kind": "normal|fakeout|denial|slow_burn|conflicting", "sentiment": -1, "factorShocks": { "RATES": 0.0015, "USD": 0.005, "GEQ": -0.015 }, "assetShocks": { "SHKP": -0.02 } },
    { "id": "e7", "t": 0.40, "...": "...", "kind": "denial", "linkedTo": "e6" }
  ]
}
regime.factorDrift is annualised extra drift per factor (|drift| ≤ 2x factor vol); volMult between 0.7 and 1.5.${feedback ? `\n\nA previous attempt failed validation. Fix these problems:\n${feedback}` : ''}`;
}

export function sentimentPrompt(events: { id: string; headline: string; body: string }[]): string {
  return `For each news item below, classify its likely immediate effect on GLOBAL EQUITY prices (stocks overall), judging only from the text.
Answer -1 (stocks fall), 0 (mixed / unclear / mostly affects other assets), or 1 (stocks rise).
Reply with ONLY a JSON object mapping id to -1, 0 or 1, e.g. {"e1": -1, "e2": 0}.

${events.map((e) => `${e.id}: ${e.headline} — ${e.body}`).join('\n')}`;
}

export function clientPrompt(existingNames: string[]): string {
  return `Create one realistic private-banking client brief for a Hong Kong wealth-management training simulator (BOCHK style).
The portfolio universe: HK/China equities (Tracker Fund, HSCEI, HSBC, Tencent, AIA, BYD, Sun Hung Kai Properties), global equity indices (S&P 500, Nasdaq 100, Euro Stoxx, Nikkei),
bonds (US Treasuries short/long, HK govt bond, IG credit, HY credit tagged "high-yield"), HKD money market (asset class "cash"), FX (USD/HKD, USD/CNH) and commodities (gold, Brent tagged "fossil").
Vary age, background, goal and constraints. Constraints must be internally consistent and satisfiable together (e.g. never min bonds 60% plus max bonds 40%), and fit the risk profile.
Avoid these names: ${existingNames.slice(0, 60).join(', ')}.

Reply with ONLY JSON:
{ "name": "...", "age": 45, "occupation": "...", "wealthHKD": 20000000, "goal": "income|growth|capital_preservation|liquidity", "goalDetail": "1 sentence",
  "riskProfile": 1-5, "horizonYears": 1-30, "notes": "1-2 sentences of personality / preferences a banker should respect",
  "constraints": [ 2-6 of:
    {"type":"maxClass","cls":"equity|bond|cash|fx|commodity","max":0.4},
    {"type":"minClass","cls":"equity|bond|cash|fx|commodity","min":0.2},
    {"type":"maxSingleName","max":0.1},
    {"type":"noShort"},
    {"type":"maxLeverage","max":1},            // 1 = no leverage, up to 2.5 for aggressive clients
    {"type":"currencyMin","currency":"HKD|USD","min":0.6},
    {"type":"excludeTag","tag":"fossil|high-yield","label":"ESG: no fossil fuels (Brent)"} ] }`;
}

export const COACH_SYSTEM = `You are a patient, sharp trading coach preparing a first-year university student for the BOCHK x HKU Wealthathon (a timed portfolio-management simulation scored on return, Sortino ratio, max drawdown and client-mandate compliance).
Explain finance in plain language, from first principles, with no jargon left undefined. Be specific to the student's actual trades and timings. Be honest but encouraging.`;

export function coachPrompt(payload: unknown): string {
  return `Here is everything about one practice session: scenario, client mandate, every headline (with the expected movers, the student's reaction time and first trade), the full fill log, the rule-based report, and a perfect-information "optimal path" benchmark (an upper bound, not a realistic target).

${JSON.stringify(payload)}

Write a critique. Reply with ONLY JSON:
{
  "summary": "2-3 sentences: overall verdict and the single most important lesson",
  "mistakes": [ exactly 3 of {
      "title": "short",
      "whatHappened": "what the student did (cite the headline, asset and timing), and what it cost",
      "mechanism": ["3-6 short steps explaining the market mechanism from first principles, e.g. why a rate hike hurts long bonds and HK property"],
      "fix": "the concrete rule to follow next time" } ],
  "strengths": [ exactly 3 of { "title": "short", "detail": "specific evidence from the session" } ],
  "drill": { "title": "one concrete drill for the next session", "steps": ["3-5 steps"] }
}
Prioritise mistakes by score impact (return, Sortino, drawdown, mandate). If the student barely traded, say so and treat inaction as a mistake where it cost them.
If the payload has a "learning" field (playbooks from the app's Learn section that the student has passed or is struggling with), name the matching playbook in a mistake's fix (e.g. "Playbook: Hawkish surprise, Lesson 4"), and prefer pointing at struggling playbooks when they fit.`;
}

export const JUDGE_SYSTEM = `You are a senior judge from BOCHK Wealth Management at the Wealthathon Grand Final in the Bank of China Tower, Hong Kong.
You are courteous but rigorous. You care about: suitability for the client, risk management, disciplined rebalancing, conviction backed by reasoning, and whether the candidate's story matches what they actually traded.
You never accept vague claims; you ask for specifics. Questions are short (1-2 sentences), one at a time, in plain English.`;

export function judgeQuestionPrompt(ctx: unknown, transcript: string, qa: { q: string; a: string }[], mustAsk: boolean): string {
  return `CANDIDATE FILE (client brief and, if available, their actual session: scenario, headlines, trades, allocation snapshots, results):
${JSON.stringify(ctx)}

PITCH TRANSCRIPT:
"""${transcript || '[no transcript available]'}"""

QUESTIONS SO FAR:
${qa.length ? qa.map((x, i) => `Q${i + 1}: ${x.q}\nA${i + 1}: ${x.a || '[no answer]'}`).join('\n') : '(none yet)'}

${mustAsk ? 'Ask the next follow-up question.' : 'Decide whether you have enough to score (you may stop once suitability, risk, rebalancing and consistency have each been tested), or ask one more question.'}
Prefer questions that probe (a) a gap between what they said and what they traded, (b) suitability versus the client's constraints and goal, (c) how they controlled drawdown and sized positions, (d) what would make them change their mind.
Do not repeat earlier questions. Reply with ONLY JSON: ${mustAsk ? '{"action":"ask","question":"...","focus":"suitability|risk|rebalancing|consistency|conviction"}' : '{"action":"ask","question":"...","focus":"..."} or {"action":"score"}'}`;
}

export function judgeScorePrompt(ctx: unknown, transcript: string, qa: { q: string; a: string }[], criteria: { id: string; label: string }[]): string {
  return `CANDIDATE FILE:
${JSON.stringify(ctx)}

PITCH TRANSCRIPT:
"""${transcript || '[no transcript available]'}"""

Q&A:
${qa.map((x, i) => `Q${i + 1}: ${x.q}\nA${i + 1}: ${x.a || '[no answer]'}`).join('\n')}

Score the candidate as a Grand Final judge. For "consistency", compare their claims with the actual trades and allocation in the file (if there is no session data, judge internal consistency).
Reply with ONLY JSON:
{ "overall": 0-100, "verdict": "2-3 sentences",
  "criteria": [ ${criteria.map((c) => `{"id":"${c.id}","label":"${c.label}","score":0-10,"justification":"specific, cite their words or trades","improvement":"one concrete improvement"}`).join(', ')} ] }`;
}

export const LESSON_WHY_SYSTEM = `You are a friendly trading coach for two beginners preparing for the BOCHK x HKU Wealthathon simulation. Be brief, concrete and encouraging; plain English, no jargon without a short explanation.`;

export function lessonWhyPrompt(payload: unknown): string {
  return `A student just finished a guided lesson. For each decision you get the headline, the prompt, the playbook it tests, the model answer, the student's trades, their one-line "why", and their process grade.

${JSON.stringify(payload)}

For each decision, write ONE or TWO sentences on the student's "why": is the reasoning right (driver -> assets -> direction), what is missing or wrong, and one tip. If the why is empty, say what they should have written.
Then a one-sentence overall summary.
Reply with ONLY JSON: {"summary": "...", "comments": {"<decision id>": "...", ...}}`;
}
