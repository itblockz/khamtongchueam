-- A deletion keeps the last copy of the game in its row (deleted = true), so a
-- mistaken delete can be undone. Before this, the tombstone replaced the game with {}.
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
    game = case when excluded.deleted then g.game else excluded.game end,
    updated_at = excluded.updated_at,
    deleted = excluded.deleted
  where excluded.updated_at > g.updated_at;
$$;
