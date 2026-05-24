alter table public.aba_session_summaries
  add column if not exists pending_warnings jsonb not null default '[]'::jsonb;
