import { LESSONS, PLAN_START, PRELIM_DATE } from '@config/learn/lessons';
import { PLAYBOOKS, PLAYBOOK_BY_ID } from '@config/learn/playbooks';
import { matchPlaybook, type Playbook } from '@engine/learn';
import type { EventRules, NewsEvent } from '@engine/types';
import type { LessonAttemptRow, ScoreRow } from './store';

export const PASS_MARK = 70;
export const CHEATSHEET_KEY = 'wt:cheatsheet-seen';

/** Best grade and attempt count per lesson for one player. */
export function lessonStats(attempts: LessonAttemptRow[], userId: string | null) {
  const out: Record<string, { best: number; tries: number; last: string; passed: boolean }> = {};
  for (const a of attempts) {
    if (userId && a.user_id !== userId) continue;
    const s = (out[a.lesson_id] ??= { best: 0, tries: 0, last: a.created_at, passed: false });
    s.best = Math.max(s.best, Number(a.grade)); s.tries++; if (a.created_at > s.last) s.last = a.created_at;
    s.passed = s.best >= PASS_MARK;
  }
  return out;
}

/** Playbooks a player has learned (best grade ≥ pass mark) or is struggling with (best below it, or the last 2 tries failed). */
export function playbookLearning(attempts: LessonAttemptRow[], userId: string | null): { passed: string[]; struggling: string[] } {
  const per: Record<string, number[]> = {};
  const mine = attempts.filter((a) => !userId || a.user_id === userId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const a of mine) for (const d of a.decisions ?? []) (per[d.playbookId] ??= []).push(Number(d.grade));
  const passed: string[] = [], struggling: string[] = [];
  for (const [id, g] of Object.entries(per)) {
    const best = Math.max(...g);
    const last2 = g.slice(-2);
    if (best < PASS_MARK || (last2.length === 2 && last2.every((x) => x < PASS_MARK))) struggling.push(id); else passed.push(id);
  }
  return { passed, struggling };
}

/** Playbook card for a headline in hint mode / debrief tags. */
export function playbookFor(e: Pick<NewsEvent, 'source' | 'kind' | 'factorShocks'>, rules: EventRules): Playbook | null {
  return matchPlaybook(e, rules, PLAYBOOKS.filter((p) => p.kind === 'news'));
}

// ── Weekly plan ─────────────────────────────────────────────────────────────
export interface PlanItem { id: string; label: string; done: boolean; progress?: string; href?: string }
export interface PlanWeek { n: number; from: string; to: string; items: PlanItem[]; current: boolean }

const day = (iso: string) => new Date(`${iso}T00:00:00`);
const addDays = (iso: string, n: number) => { const d = day(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export function weeklyPlan(attempts: LessonAttemptRow[], userId: string | null, scores: ScoreRow[], cheatsheetSeen: boolean, today = new Date()): PlanWeek[] {
  const stats = lessonStats(attempts, userId);
  const lessonItem = (id: string): PlanItem => {
    const l = LESSONS.find((x) => x.id === id)!;
    const s = stats[id];
    return { id: `lesson-${id}`, label: `Lesson ${l.n}: ${l.title}`, done: !!s, progress: s ? `best ${s.best}%` : undefined, href: `/learn/${id}` };
  };
  // Each practice session ticks at most one requirement, earliest week first.
  const pool = [...scores].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const used = new Set<string>();
  const need = (id: string, label: string, n: number, ok: (s: ScoreRow) => boolean): PlanItem => {
    let got = 0;
    for (const s of pool) { if (got >= n) break; if (!used.has(s.session_id) && ok(s)) { used.add(s.session_id); got++; } }
    return { id, label, done: got >= n, progress: `${Math.min(got, n)}/${n}`, href: '/' };
  };
  const retry = Object.entries(stats).filter(([, s]) => s.best < PASS_MARK).map(([id]) => LESSONS.find((l) => l.id === id)!);
  const weeks: { items: PlanItem[] }[] = [
    { items: [...['scoring', 'opening', 'drivers', 'rates'].map(lessonItem), need('w1-easy', 'Practice: 2 Easy sessions with hints on', 2, (s) => s.difficulty === 'easy' && !!s.hints)] },
    { items: [...['china', 'risk-off', 'oil', 'rumours'].map(lessonItem),
      need('w2-med-h', 'Practice: 2 Medium sessions with hints on', 2, (s) => s.difficulty === 'medium' && !!s.hints),
      need('w2-med', 'Practice: 1 Medium session with hints off', 1, (s) => s.difficulty === 'medium' && !s.hints)] },
    { items: [...['sizing', 'pressure'].map(lessonItem),
      { id: 'retry', label: retry.length ? `Retry lessons under ${PASS_MARK}%: ${retry.map((l) => l.n).join(', ')}` : `Retry any lesson under ${PASS_MARK}%`, done: Object.keys(stats).length > 0 && retry.length === 0, href: retry[0] ? `/learn/${retry[0].id}` : '/learn' },
      need('w3-real', 'Practice: 3 Medium/Hard sessions with hints off', 3, (s) => (s.difficulty === 'medium' || s.difficulty === 'hard') && !s.hints),
      need('w3-team', 'Practice: 1 team session with your team-mate', 1, (s) => !!s.team_mode),
      { id: 'cheatsheet', label: 'Read the cheat sheet the day before', done: cheatsheetSeen, href: '/learn/cheatsheet' }] },
  ];
  const t = today.toISOString().slice(0, 10);
  return weeks.map((w, i) => {
    const from = addDays(PLAN_START, i * 7);
    const to = i === 2 ? PRELIM_DATE : addDays(from, 6);
    return { n: i + 1, from, to, items: w.items, current: t >= from && t <= to || (i === 0 && t < from) || (i === 2 && t > to) };
  });
}

export function daysToEvent(today = new Date()): number {
  return Math.ceil((day(PRELIM_DATE).getTime() - today.getTime()) / 86_400_000);
}

export { LESSONS, PLAYBOOKS, PLAYBOOK_BY_ID, PRELIM_DATE };
