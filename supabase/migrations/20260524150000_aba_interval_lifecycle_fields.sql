-- ABA interval collection lifecycle controls: pause, resume, early finish and cancellation.

alter table public.aba_interval_records
  add column if not exists collection_status text
    check (collection_status in ('RUNNING', 'AWAITING_RESPONSE', 'PAUSED', 'COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED')),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists cancel_reason text;

alter table public.aba_interval_summaries
  add column if not exists planned_intervals integer not null default 0,
  add column if not exists answered_intervals integer not null default 0,
  add column if not exists collection_status text not null default 'COMPLETED'
    check (collection_status in ('COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED')),
  add column if not exists paused_at timestamptz,
  add column if not exists resumed_at timestamptz,
  add column if not exists ended_early_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists cancel_reason text,
  add column if not exists end_reason text;

update public.aba_interval_summaries
set planned_intervals = greatest(planned_intervals, total_intervals),
    answered_intervals = greatest(answered_intervals, total_intervals)
where planned_intervals = 0
   or answered_intervals = 0;

create index if not exists idx_aba_interval_summaries_lifecycle
  on public.aba_interval_summaries (session_id, collection_status, ended_at desc);
