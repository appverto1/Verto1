-- ABA Maintenance Probe real trial linkage.
-- Additive only: preserve the schedule/trial relationship for idempotent probe execution.

alter table public.aba_trials
  add column if not exists maintenance_schedule_id text references public.aba_maintenance_schedules(id) on delete set null;

alter table public.aba_maintenance_probe_results
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null,
  add column if not exists trial_id text,
  add column if not exists probe_date date,
  add column if not exists clinical_date date,
  add column if not exists result text,
  add column if not exists prompt_type text,
  add column if not exists passed boolean,
  add column if not exists created_by text,
  add column if not exists updated_by text,
  add column if not exists updated_at timestamptz;

create index if not exists idx_aba_trials_maintenance_schedule
  on public.aba_trials (organization_id, maintenance_schedule_id, occurred_at desc)
  where maintenance_schedule_id is not null;

create index if not exists idx_aba_maintenance_probe_results_schedule_trial
  on public.aba_maintenance_probe_results (organization_id, maintenance_schedule_id, session_id, trial_id)
  where maintenance_schedule_id is not null and trial_id is not null;

create unique index if not exists ux_aba_maintenance_probe_results_schedule_session_trial
  on public.aba_maintenance_probe_results (organization_id, maintenance_schedule_id, session_id, trial_id)
  where maintenance_schedule_id is not null and session_id is not null and trial_id is not null;
