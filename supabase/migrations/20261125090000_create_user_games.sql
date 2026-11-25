-- Backups for judges who sign in (Google). One row per game per account, holding
-- the whole game as the device keeps it, player names included. Row-level security
-- lets each signed-in user read and write only their own rows. Deleting a game
-- keeps a tombstone (deleted = true) so other devices drop it too.

create table public.user_games (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (id ~ '^[a-z0-9]{6,40}$'),
  game jsonb not null check (octet_length(game::text) < 2000000),
  updated_at bigint not null,
  deleted boolean not null default false,
  primary key (user_id, id)
);

alter table public.user_games enable row level security;

create policy "own games: read" on public.user_games
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own games: add" on public.user_games
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own games: change" on public.user_games
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Save games for the signed-in user, keeping whichever copy is newer.
create or replace function public.save_my_games(p_games jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.user_games as g (user_id, id, game, updated_at, deleted)
  select auth.uid(), x->>'id', x->'game', (x->>'updated_at')::bigint, coalesce((x->>'deleted')::boolean, false)
  from jsonb_array_elements(p_games) as x
  on conflict (user_id, id) do update set
    game = excluded.game,
    updated_at = excluded.updated_at,
    deleted = excluded.deleted
  where excluded.updated_at > g.updated_at;
$$;

revoke all on function public.save_my_games(jsonb) from public, anon;
grant execute on function public.save_my_games(jsonb) to authenticated;

-- Delete the signed-in user's account and, through the foreign key, all their games.
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
