alter table public.aba_session_summaries
  add column if not exists pending_warnings jsonb not null default '[]'::jsonb;

alter table public.aba_session_summaries
  add column if not exists trial_types_used jsonb not null default '[]'::jsonb,
  add column if not exists mastery_summary jsonb not null default '[]'::jsonb,
  add column if not exists blocking_items jsonb not null default '[]'::jsonb,
  add column if not exists warning_items jsonb not null default '[]'::jsonb,
  add column if not exists session_note text;
