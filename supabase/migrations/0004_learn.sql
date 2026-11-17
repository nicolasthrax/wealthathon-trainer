-- Learn section: guided-lesson attempts (visible to both players) and hint-mode flags on sessions/scores.

alter table public.sessions add column if not exists hints boolean not null default false;
alter table public.scores add column if not exists hints boolean not null default false;

create table if not exists public.lesson_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  lesson_id text not null,
  attempt integer not null,
  seed text not null,
  variant jsonb not null default '{}'::jsonb,
  -- per decision: id, playbookId, checks, grade, trades, outcome, why, actionSec; plus the input log for replay
  decisions jsonb not null,
  input_log jsonb not null default '[]'::jsonb,
  grade numeric not null,
  passed boolean not null,
  ai_job_id uuid references public.ai_jobs on delete set null,
  ai_feedback jsonb,
  created_at timestamptz not null default now()
);
create index if not exists lesson_attempts_user_idx on public.lesson_attempts (user_id, lesson_id, created_at desc);
create index if not exists lesson_attempts_job_idx on public.lesson_attempts (ai_job_id);

alter table public.lesson_attempts enable row level security;

-- Both players see each other's lesson progress; each can only write their own attempts.
create policy lesson_attempts_read on public.lesson_attempts for select to authenticated using (true);
create policy lesson_attempts_insert_own on public.lesson_attempts for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy lesson_attempts_update_own on public.lesson_attempts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
