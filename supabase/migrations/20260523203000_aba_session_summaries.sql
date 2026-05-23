alter table public.aba_sessions
  add column if not exists duration_seconds integer;

create table if not exists public.aba_session_summaries (
  id text primary key,
  clinic_id text not null,
  session_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  therapist_id text,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds integer not null default 0,
  total_trials integer not null default 0,
  independent_trials integer not null default 0,
  prompted_trials integer not null default 0,
  error_trials integer not null default 0,
  accuracy_percent integer not null default 0,
  independence_percent integer not null default 0,
  total_behavior_events integer not null default 0,
  frequency_summary jsonb not null default '[]'::jsonb,
  duration_summary jsonb not null default '[]'::jsonb,
  interval_summary jsonb not null default '[]'::jsonb,
  pending_items jsonb not null default '[]'::jsonb,
  sync_status text not null default 'synced'
    check (sync_status in ('local', 'local_only', 'queued', 'syncing', 'synced', 'error', 'failed', 'conflict')),
  summary_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_aba_session_summaries_session
  on public.aba_session_summaries (session_id);

create index if not exists idx_aba_session_summaries_patient
  on public.aba_session_summaries (patient_id, ended_at desc);

alter table public.aba_session_summaries enable row level security;

drop policy if exists aba_session_summaries_patient_scope_rw on public.aba_session_summaries;
create policy aba_session_summaries_patient_scope_rw
on public.aba_session_summaries
for all
using (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_session_summaries.patient_id
      and (
        u.role in ('admin', 'owner')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_session_summaries.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_session_summaries.clinic_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_session_summaries.patient_id
      and (
        u.role in ('admin', 'owner')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_session_summaries.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_session_summaries.clinic_id)
      )
  )
);
