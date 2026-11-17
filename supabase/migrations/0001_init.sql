-- Wealthathon Trainer schema. RLS is enabled on every table.
-- Model: sessions -> participants -> orders/fills, so a shared 3-person team session can be added later.

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.scenarios (
  id text primary key,
  title text not null,
  source text not null check (source in ('synthetic', 'historical')),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  generator text,
  json jsonb not null,
  validated boolean not null default false,
  validation jsonb,
  used_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index scenarios_pool_idx on public.scenarios (source, difficulty, validated);

create table public.clients (
  id text primary key,
  json jsonb not null,
  source text not null default 'seed',
  created_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  scenario_id text not null references public.scenarios,
  scenario_title text not null,
  client_id text,
  client jsonb not null,
  seed text not null,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  mode text not null check (mode in ('synthetic', 'historical')),
  disguise boolean not null default true,
  session_minutes numeric not null,
  rules jsonb not null,               -- full snapshot of config/event-rules.ts at session start
  input_log jsonb not null default '[]'::jsonb, -- deterministic order log, replayable
  status text not null default 'briefing' check (status in ('briefing', 'active', 'finished', 'abandoned')),
  team_mode boolean not null default false,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index sessions_owner_idx on public.sessions (owner_id, created_at desc);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  role text not null default 'solo' check (role in ('solo', 'news_analyst', 'trader', 'risk_manager')),
  joined_at timestamptz not null default now(),
  unique (session_id, user_id)
);
create index participants_user_idx on public.participants (user_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions on delete cascade,
  participant_id uuid references public.participants on delete set null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  client_order_id text not null,
  tick integer not null,
  asset_id text not null,
  side text not null check (side in ('buy', 'sell')),
  qty numeric not null,
  type text not null check (type in ('market', 'limit')),
  limit_price numeric,
  status text not null,
  reason text,
  source text not null default 'user',
  created_at timestamptz not null default now(),
  unique (session_id, client_order_id)
);
create index orders_user_idx on public.orders (user_id);

create table public.fills (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions on delete cascade,
  participant_id uuid references public.participants on delete set null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  client_fill_id text not null,
  client_order_id text not null,
  tick integer not null,
  asset_id text not null,
  side text not null,
  qty numeric not null,
  price numeric not null,
  fee numeric not null default 0,
  realized_pnl numeric not null default 0,
  source text not null default 'user',
  created_at timestamptz not null default now(),
  unique (session_id, client_fill_id)
);
create index fills_user_idx on public.fills (user_id);

create table public.snapshots (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions on delete cascade,
  participant_id uuid references public.participants on delete set null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  tick integer not null,
  equity numeric not null,
  cash numeric not null,
  positions jsonb not null,
  score numeric not null,
  unique (session_id, tick)
);
create index snapshots_user_idx on public.snapshots (user_id);

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions on delete cascade,
  participant_id uuid references public.participants on delete set null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  team_id uuid,                        -- reserved for team / global leaderboards
  scenario_id text not null,
  scenario_title text not null,
  client_name text,
  difficulty text not null,
  mode text not null,
  composite numeric not null,
  return_score numeric not null,
  sortino_score numeric not null,
  drawdown_score numeric not null,
  mandate_score numeric not null,
  ret numeric not null,
  sortino numeric not null,
  max_dd numeric not null,
  final_equity numeric not null,
  created_at timestamptz not null default now(),
  unique (session_id, user_id)
);
create index scores_user_idx on public.scores (user_id, created_at desc);

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  result jsonb,
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index ai_jobs_queue_idx on public.ai_jobs (status, created_at);
create index ai_jobs_user_idx on public.ai_jobs (user_id);

create table public.debriefs (
  session_id uuid primary key references public.sessions on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  report jsonb,
  optimal jsonb,
  coach jsonb,
  coach_job_id uuid references public.ai_jobs on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index debriefs_user_idx on public.debriefs (user_id);
create index debriefs_job_idx on public.debriefs (coach_job_id);

create table public.pitches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  session_id uuid references public.sessions on delete set null,
  status text not null default 'draft',
  audio_path text,
  transcript text,
  qa jsonb not null default '[]'::jsonb,
  scorecard jsonb,
  context jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pitches_user_idx on public.pitches (user_id, created_at desc);
create index pitches_session_idx on public.pitches (session_id);

create table public.worker_heartbeats (
  id text primary key,
  last_seen timestamptz not null default now(),
  info jsonb
);

-- ── Helpers ────────────────────────────────────────────────────────────────
create schema if not exists private;

create or replace function private.is_session_member(sid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sessions s where s.id = sid and s.owner_id = (select auth.uid()))
      or exists (select 1 from public.participants p where p.session_id = sid and p.user_id = (select auth.uid()));
$$;
grant usage on schema private to authenticated;
grant execute on function private.is_session_member(uuid) to authenticated;

create or replace function private.bump_scenario_used(sid text)
returns void language sql security definer set search_path = '' as $$
  update public.scenarios set used_count = used_count + 1 where id = sid;
$$;
create or replace function public.bump_scenario_used(sid text)
returns void language sql security invoker set search_path = '' as $$
  select private.bump_scenario_used(sid);
$$;
grant execute on function private.bump_scenario_used(text) to authenticated;
revoke execute on function public.bump_scenario_used(text) from anon, public;
grant execute on function public.bump_scenario_used(text) to authenticated;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name) values (new.id, split_part(new.email, '@', 1)) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

-- ── Row level security ─────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.scenarios enable row level security;
alter table public.clients enable row level security;
alter table public.sessions enable row level security;
alter table public.participants enable row level security;
alter table public.orders enable row level security;
alter table public.fills enable row level security;
alter table public.snapshots enable row level security;
alter table public.scores enable row level security;
alter table public.ai_jobs enable row level security;
alter table public.debriefs enable row level security;
alter table public.pitches enable row level security;
alter table public.worker_heartbeats enable row level security;

create policy profiles_own on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Shared, read-only content. Only the worker / seed script (service role) writes.
create policy scenarios_read on public.scenarios for select to authenticated using (validated);
create policy clients_read on public.clients for select to authenticated using (true);
create policy heartbeats_read on public.worker_heartbeats for select to authenticated using (true);

create policy sessions_select on public.sessions for select to authenticated
  using (owner_id = (select auth.uid()) or private.is_session_member(id));
create policy sessions_insert on public.sessions for insert to authenticated with check (owner_id = (select auth.uid()));
create policy sessions_update on public.sessions for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy sessions_delete on public.sessions for delete to authenticated using (owner_id = (select auth.uid()));

create policy participants_select on public.participants for select to authenticated using (private.is_session_member(session_id));
create policy participants_insert on public.participants for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_session_member(session_id));
create policy participants_delete on public.participants for delete to authenticated using (user_id = (select auth.uid()));

create policy orders_select on public.orders for select to authenticated using (private.is_session_member(session_id));
create policy orders_insert on public.orders for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_session_member(session_id));
create policy orders_update on public.orders for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy fills_select on public.fills for select to authenticated using (private.is_session_member(session_id));
create policy fills_insert on public.fills for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_session_member(session_id));
create policy fills_update on public.fills for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy snapshots_select on public.snapshots for select to authenticated using (private.is_session_member(session_id));
create policy snapshots_insert on public.snapshots for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_session_member(session_id));
create policy snapshots_update on public.snapshots for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Personal leaderboard today; widen this policy (e.g. team_id / public flag) for team or global boards.
create policy scores_select on public.scores for select to authenticated using (user_id = (select auth.uid()));
create policy scores_insert on public.scores for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_session_member(session_id));
create policy scores_update on public.scores for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy ai_jobs_select on public.ai_jobs for select to authenticated using (user_id = (select auth.uid()));
create policy ai_jobs_insert on public.ai_jobs for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'queued' and result is null);

create policy debriefs_own on public.debriefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy pitches_own on public.pitches for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ── Realtime ───────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.ai_jobs;
alter publication supabase_realtime add table public.worker_heartbeats;
alter publication supabase_realtime add table public.orders;   -- for team mode later

-- ── Storage: private bucket for pitch recordings, one folder per user ──────
insert into storage.buckets (id, name, public) values ('pitch-audio', 'pitch-audio', false) on conflict do nothing;
create policy pitch_audio_select on storage.objects for select to authenticated
  using (bucket_id = 'pitch-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy pitch_audio_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pitch-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy pitch_audio_update on storage.objects for update to authenticated
  using (bucket_id = 'pitch-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Extra foreign-key indexes
create index sessions_scenario_idx on public.sessions (scenario_id);
create index orders_participant_idx on public.orders (participant_id);
create index fills_participant_idx on public.fills (participant_id);
create index snapshots_participant_idx on public.snapshots (participant_id);
create index scores_participant_idx on public.scores (participant_id);
