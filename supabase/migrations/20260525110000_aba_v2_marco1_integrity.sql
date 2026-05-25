-- ABA V2 Marco 1 integrity metadata.
-- Additive only: records keep clinic scope, timestamps, sync status, and source/client channel.

alter table public.aba_trials
  add column if not exists source text not null default 'verto_web';

alter table public.aba_behavior_events
  add column if not exists source text not null default 'verto_web';

alter table public.aba_interval_records
  add column if not exists source text not null default 'verto_web';

alter table public.aba_interval_summaries
  add column if not exists source text not null default 'verto_web';

alter table public.aba_abc_events
  add column if not exists source text not null default 'verto_web',
  add column if not exists occurred_at timestamptz not null default now();

alter table public.aba_session_summaries
  add column if not exists source text not null default 'verto_web';

alter table public.aba_audit_events
  add column if not exists source text not null default 'verto_web';
