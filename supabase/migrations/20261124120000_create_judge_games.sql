-- Anonymous game logs from the judge app, to improve the segmenter and to build
-- checks for nouns, connections and forbidden words from real decisions.
-- One row per game, replaced as the game changes (undo and corrections included),
-- so it always holds the game's latest state. No player names: players appear as
-- seat ids (p1, p2, ...). Only the game backend writes, with the project's secret
-- key; RLS is on with no policies, so the anon and authenticated roles get nothing.

create table public.judge_games (
  id text primary key check (id ~ '^[a-z0-9]{6,40}$'),
  data jsonb not null,
  model_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.judge_games enable row level security;

create or replace function public.record_judge_game(
  p_id text,
  p_data jsonb,
  p_model_version text
) returns void
language sql
set search_path = ''
as $$
  insert into public.judge_games as g (id, data, model_version)
  values (p_id, p_data, p_model_version)
  on conflict (id) do update set
    data = excluded.data,
    model_version = excluded.model_version,
    updated_at = now();
$$;

revoke all on function public.record_judge_game(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_judge_game(text, jsonb, text) to service_role;
