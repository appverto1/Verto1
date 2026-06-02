-- ABA appointment/session operational link.
-- Non-destructive: clinical records inherit appointment_id and ABA sessions accept in_progress.

do $$
begin
  alter table public.aba_sessions
    drop constraint if exists aba_sessions_status_check;

  alter table public.aba_sessions
    add constraint aba_sessions_status_check
    check (status in ('active', 'in_progress', 'completed', 'canceled'));
exception
  when duplicate_object then null;
end $$;

alter table public.aba_session_summaries
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null;

alter table public.aba_trials
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null;

alter table public.aba_behavior_events
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null;

alter table public.aba_interval_records
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null;

alter table public.aba_interval_summaries
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null;

alter table public.aba_abc_events
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null;

alter table public.aba_mastery_evaluations
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null;

alter table public.aba_maintenance_probe_results
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null;

create index if not exists idx_aba_session_summaries_appointment
  on public.aba_session_summaries (organization_id, appointment_id, ended_at desc)
  where appointment_id is not null;

create index if not exists idx_aba_trials_appointment
  on public.aba_trials (organization_id, appointment_id, occurred_at desc)
  where appointment_id is not null;

create index if not exists idx_aba_behavior_events_appointment
  on public.aba_behavior_events (organization_id, appointment_id, occurred_at desc)
  where appointment_id is not null;

create index if not exists idx_aba_interval_records_appointment
  on public.aba_interval_records (organization_id, appointment_id, interval_ended_at desc)
  where appointment_id is not null;

create index if not exists idx_aba_interval_summaries_appointment
  on public.aba_interval_summaries (organization_id, appointment_id, ended_at desc)
  where appointment_id is not null;

create index if not exists idx_aba_abc_events_appointment
  on public.aba_abc_events (organization_id, appointment_id, occurred_at desc)
  where appointment_id is not null;

create index if not exists idx_aba_mastery_evaluations_appointment
  on public.aba_mastery_evaluations (organization_id, appointment_id, evaluated_at desc)
  where appointment_id is not null;

create index if not exists idx_aba_maintenance_probe_results_appointment
  on public.aba_maintenance_probe_results (organization_id, appointment_id, occurred_at desc)
  where appointment_id is not null;
