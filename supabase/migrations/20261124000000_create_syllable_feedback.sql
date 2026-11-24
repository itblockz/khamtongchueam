-- Anonymous word collection for improving syllable segmentation.
-- Applied to the Supabase project "khamtongchueam" (ap-southeast-1).
-- Only the game backend writes, with the project's secret key. RLS is on with no
-- policies, so the anon and authenticated roles cannot read or write.

create table public.syllable_words (
  text text primary key check (char_length(text) between 1 and 60),
  syllables jsonb not null,
  model_version text not null,
  submit_count integer not null default 0,
  duplicate_elimination_count integer not null default 0,
  undo_after_duplicate_count integer not null default 0,
  host_duplicate_count integer not null default 0,
  report_count integer not null default 0,
  review_status text not null default 'new' check (review_status in ('new', 'confirmed', 'corrected', 'ignored')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.syllable_reports (
  id bigint generated always as identity primary key,
  text text not null check (char_length(text) between 1 and 60),
  segmenter_syllables jsonb not null,
  reported_syllables jsonb not null,
  model_version text not null,
  status text not null default 'new' check (status in ('new', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);

create index syllable_reports_text_idx on public.syllable_reports (text);
create index syllable_words_review_idx on public.syllable_words (review_status, submit_count desc);

alter table public.syllable_words enable row level security;
alter table public.syllable_reports enable row level security;

create or replace function public.record_word_event(
  p_text text,
  p_syllables jsonb,
  p_model_version text,
  p_event text
) returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_event not in ('submit', 'duplicate_elimination', 'undo_after_duplicate', 'host_duplicate', 'report') then
    raise exception 'unknown event %', p_event;
  end if;

  insert into public.syllable_words as w (
    text, syllables, model_version,
    submit_count, duplicate_elimination_count, undo_after_duplicate_count, host_duplicate_count, report_count
  )
  values (
    p_text, p_syllables, p_model_version,
    (p_event = 'submit')::int,
    (p_event = 'duplicate_elimination')::int,
    (p_event = 'undo_after_duplicate')::int,
    (p_event = 'host_duplicate')::int,
    (p_event = 'report')::int
  )
  on conflict (text) do update set
    syllables = excluded.syllables,
    model_version = excluded.model_version,
    submit_count = w.submit_count + excluded.submit_count,
    duplicate_elimination_count = w.duplicate_elimination_count + excluded.duplicate_elimination_count,
    undo_after_duplicate_count = w.undo_after_duplicate_count + excluded.undo_after_duplicate_count,
    host_duplicate_count = w.host_duplicate_count + excluded.host_duplicate_count,
    report_count = w.report_count + excluded.report_count,
    last_seen_at = now();
end;
$$;

revoke all on function public.record_word_event(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.record_word_event(text, jsonb, text, text) to service_role;
