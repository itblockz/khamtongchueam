-- The shared answer bank behind the judge's hints: one row per word, read by every
-- game, so a word is only ever worked out once however many people play.
--
-- A row overrides the bundled dictionaries for that word:
-- - noun: true = can be a noun (no not-a-noun hint), false = cannot (hint),
--   null = no opinion (the dictionaries decide)
-- - english: what the word means in English, used to spot translations
--
-- Only checked answers go in: 'confirmed' rows are entered by a person; 'llm' is
-- reserved for answers from a language model, if one is added later. Game data is
-- never copied in automatically. Only the game backend reads, with the project's
-- secret key; RLS is on with no policies, so the anon and authenticated roles get
-- nothing.

create table public.word_checks (
  word text primary key check (length(word) between 1 and 60),
  noun boolean,
  english text[] not null default '{}',
  source text not null check (source in ('confirmed', 'llm')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.word_checks enable row level security;
