-- 0001_init.sql
-- PEP Inc. Break Room Games — leaderboard schema (MVP-1)
-- Run this in the Supabase SQL Editor, top to bottom.
--
-- Idempotency: this file is safe to re-run during dev, but DON'T re-run
-- against a production DB with real data — the `drop table ... cascade`
-- lines would nuke scores. The `create ... if not exists` style is for
-- the first installation only.

begin;

-- ───────────────────────────────────────────────────────────────────────
-- games registry — adding/removing a game is a row, not a migration
-- ───────────────────────────────────────────────────────────────────────
create table if not exists public.games (
  id                text primary key,
  display_name      text not null,
  scoring_direction text not null
    check (scoring_direction in ('higher_is_better','lower_is_better')),
  is_active         boolean not null default true,
  hub_order         integer not null default 100,
  created_at        timestamptz not null default now()
);

-- Seed the four current games. scoring_direction for the non-Sudoku games
-- is a best-guess from the README — Tim, please verify each and update
-- with e.g.:
--   update public.games set scoring_direction = 'lower_is_better' where id = 'unseen_case';
insert into public.games (id, display_name, scoring_direction, hub_order) values
  ('sudoku',          'Case Load Sudoku',        'lower_is_better',  10),
  ('bed_locator',     'Bed Locator Challenge',   'higher_is_better', 20),
  ('hospital_escape', 'Hospital Escape',         'higher_is_better', 30),
  ('unseen_case',     'The Unseen Case',         'higher_is_better', 40)
on conflict (id) do nothing;

-- ───────────────────────────────────────────────────────────────────────
-- players — site-wide identity, optional email for cross-device recovery
-- ───────────────────────────────────────────────────────────────────────
create table if not exists public.players (
  id              uuid primary key default gen_random_uuid(),
  username        text not null,
  username_lower  text generated always as (lower(username)) stored,
  email           text,
  email_lower     text generated always as (lower(email)) stored,
  status          text not null default 'approved'
    check (status in ('approved','flagged','rejected')),
  flag_reason     text,
  player_token    uuid not null unique default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  last_active_at  timestamptz not null default now()
);

create unique index if not exists players_username_lower_uq on public.players (username_lower);
create index if not exists players_email_lower_idx on public.players (email_lower) where email is not null;
create index if not exists players_status_idx on public.players (status);

-- ───────────────────────────────────────────────────────────────────────
-- scores — append-only history. One row per submission.
-- ───────────────────────────────────────────────────────────────────────
create table if not exists public.scores (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references public.players(id) on delete cascade,
  game_id         text not null references public.games(id),
  score           numeric not null,
  week_starts_at  date not null,
  submitted_at    timestamptz not null default now(),
  client_meta     jsonb not null default '{}'::jsonb
);

create index if not exists scores_leaderboard_high on public.scores
  (game_id, week_starts_at, score desc, submitted_at asc);
create index if not exists scores_leaderboard_low on public.scores
  (game_id, week_starts_at, score asc, submitted_at asc);
create index if not exists scores_player_idx on public.scores (player_id);

-- ───────────────────────────────────────────────────────────────────────
-- weekly_archive — frozen top-N, written by Monday cron (MVP-3)
-- ───────────────────────────────────────────────────────────────────────
create table if not exists public.weekly_archive (
  id             uuid primary key default gen_random_uuid(),
  week_starts_at date not null,
  game_id        text not null references public.games(id),
  top_n          jsonb not null,
  archived_at    timestamptz not null default now(),
  unique (week_starts_at, game_id)
);

-- ───────────────────────────────────────────────────────────────────────
-- username_audit — every moderation decision for review
-- ───────────────────────────────────────────────────────────────────────
create table if not exists public.username_audit (
  id                  uuid primary key default gen_random_uuid(),
  player_id           uuid references public.players(id) on delete set null,
  username            text not null,
  decision            text not null check (decision in ('approved','flagged','rejected')),
  classifier_response jsonb,
  reviewed_by         text not null default 'auto',
  created_at          timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────────
-- helper: Monday-anchored UTC week start
-- ───────────────────────────────────────────────────────────────────────
create or replace function public.week_start_utc(ts timestamptz default now())
returns date
language sql
immutable
as $$
  -- date_trunc('week', x) is Monday in Postgres
  select (date_trunc('week', ts at time zone 'UTC'))::date;
$$;

-- ───────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER RPC: read this week's leaderboard for one game.
-- Dedupes to best-score-per-player, respects scoring_direction.
-- Anon clients hit this via PostgREST: /rest/v1/rpc/get_current_leaderboard
-- ───────────────────────────────────────────────────────────────────────
create or replace function public.get_current_leaderboard(
  p_game_id text,
  p_limit   integer default 10
)
returns table (
  rank int,
  username text,
  score numeric,
  submitted_at timestamptz,
  client_meta jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_direction text;
begin
  select scoring_direction into v_direction from public.games where id = p_game_id and is_active;
  if v_direction is null then return; end if;

  if v_direction = 'higher_is_better' then
    return query
      with best_per_player as (
        select distinct on (s.player_id)
          s.player_id, s.score, s.submitted_at, s.client_meta
        from public.scores s
        join public.players p on p.id = s.player_id
        where s.game_id = p_game_id
          and s.week_starts_at = public.week_start_utc()
          and p.status = 'approved'
        order by s.player_id, s.score desc, s.submitted_at asc
      )
      select
        (row_number() over (order by b.score desc, b.submitted_at asc))::int as rank,
        p.username, b.score, b.submitted_at, b.client_meta
      from best_per_player b
      join public.players p on p.id = b.player_id
      order by rank
      limit p_limit;
  else
    return query
      with best_per_player as (
        select distinct on (s.player_id)
          s.player_id, s.score, s.submitted_at, s.client_meta
        from public.scores s
        join public.players p on p.id = s.player_id
        where s.game_id = p_game_id
          and s.week_starts_at = public.week_start_utc()
          and p.status = 'approved'
        order by s.player_id, s.score asc, s.submitted_at asc
      )
      select
        (row_number() over (order by b.score asc, b.submitted_at asc))::int as rank,
        p.username, b.score, b.submitted_at, b.client_meta
      from best_per_player b
      join public.players p on p.id = b.player_id
      order by rank
      limit p_limit;
  end if;
end;
$$;

grant execute on function public.get_current_leaderboard(text, integer) to anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────
-- Row-level security
-- All client traffic that touches players, scores, or username_audit goes
-- through Edge Functions with the service_role key (bypasses RLS).
-- ───────────────────────────────────────────────────────────────────────

alter table public.games          enable row level security;
alter table public.players        enable row level security;
alter table public.scores         enable row level security;
alter table public.weekly_archive enable row level security;
alter table public.username_audit enable row level security;

-- Anon can read active games (for the hub widget to enumerate)
drop policy if exists "games_public_read_active" on public.games;
create policy "games_public_read_active"
  on public.games for select
  to anon, authenticated
  using (is_active);

-- Anon can read weekly_archive (historical leaderboards, MVP-2 widget)
drop policy if exists "archive_public_read" on public.weekly_archive;
create policy "archive_public_read"
  on public.weekly_archive for select
  to anon, authenticated
  using (true);

-- No anon policies on players, scores, or username_audit by design.
-- Service role bypasses RLS so Edge Functions still work.

commit;
