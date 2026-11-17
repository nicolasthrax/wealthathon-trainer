-- Team mode (shared live sessions) + closed sign-ups (allowlisted accounts only).

-- ── Allowlist: only these emails can create an account ─────────────────────
create table private.allowed_users (
  email text primary key,
  display_name text not null
);
-- Rows are inserted separately (not committed to git):
--   insert into private.allowed_users values ('you@example.com', 'Nicolas'), ('partner@example.com', 'AG');

create or replace function private.enforce_allowlist()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.allowed_users a where a.email = lower(new.email)) then
    raise exception 'Sign-ups are closed for this app.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger enforce_allowlist before insert on auth.users for each row execute function private.enforce_allowlist();

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce((select a.display_name from private.allowed_users a where a.email = lower(new.email)), split_part(new.email, '@', 1)))
  on conflict do nothing;
  return new;
end $$;

-- No guest access any more: the app requires sign-in.
drop policy if exists scenarios_read_anon on public.scenarios;
drop policy if exists clients_read_anon on public.clients;
drop policy if exists heartbeats_read_anon on public.worker_heartbeats;

-- Team-mates can see each other's display name.
drop policy profiles_own on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ── Sessions: team flag on scores, members may update shared state ─────────
alter table public.scores add column team_mode boolean not null default false;
create policy sessions_update_member on public.sessions for update to authenticated
  using (private.is_session_member(id)) with check (private.is_session_member(id));
-- The owner adds team-mates to their session.
create policy participants_insert_owner on public.participants for insert to authenticated
  with check (exists (select 1 from public.sessions s where s.id = session_id and s.owner_id = (select auth.uid())));
create policy participants_update_own on public.participants for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ── Live input log: every order / cancel, in a single global order (tick, seq) ─
create table public.session_inputs (
  seq bigint generated always as identity primary key,
  session_id uuid not null references public.sessions on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  participant_id uuid references public.participants on delete set null,
  tick integer not null check (tick >= 0),
  kind text not null check (kind in ('place', 'cancel', 'end')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index session_inputs_session_idx on public.session_inputs (session_id, tick, seq);
create index session_inputs_user_idx on public.session_inputs (user_id);
create index session_inputs_participant_idx on public.session_inputs (participant_id);
alter table public.session_inputs enable row level security;
create policy session_inputs_select on public.session_inputs for select to authenticated using (private.is_session_member(session_id));
create policy session_inputs_insert on public.session_inputs for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_session_member(session_id));

-- ── Debriefs: one per user per session (each player has their own coach) ───
alter table public.debriefs drop constraint debriefs_pkey;
alter table public.debriefs add primary key (session_id, user_id);

-- ── Server clock, so both players compute the same tick ───────────────────
create or replace function public.server_now() returns timestamptz language sql stable security invoker set search_path = '' as $$ select now() $$;
revoke execute on function public.server_now() from anon, public;
grant execute on function public.server_now() to authenticated;

alter publication supabase_realtime add table public.session_inputs;
alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.participants;
