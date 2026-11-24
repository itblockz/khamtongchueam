-- The old app's word feedback is retired: the Vercel site is now the judge app,
-- whose games go to judge_games. Applied to the Supabase project on 2026-11-24.
-- The old app's /api/feedback/* endpoints still exist in the backend but have no
-- tables to write to; with SUPABASE_URL unset (Render) they record nothing anyway.
drop function if exists public.record_word_event(text, jsonb, text, text);
drop table if exists public.syllable_reports;
drop table if exists public.syllable_words;
