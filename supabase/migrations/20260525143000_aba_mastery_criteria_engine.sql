-- ABA V2 Epic 10: configurable mastery criteria and auditable evaluations.
-- Additive only. The engine suggests review states; it does not mutate aba_targets.phase/status.

create extension if not exists pgcrypto;

create table if not exists public.aba_mastery_criteria (
  id text primary key default gen_random_uuid()::text,
  organization_id text not null,
  clinic_id text not null,
  program_id text null,
  target_id text null,
  name text not null default 'Criterio de maestria',
  min_accuracy_percent numeric(6,2) not null default 80,
  min_independence_percent numeric(6,2) not null default 80,
  min_trials_per_session integer not null default 3,
  min_consecutive_days integer not null default 1,
  require_first_trial_independent boolean not null default false,
  cold_probe_only boolean not null default false,
  min_distinct_therapists integer not null default 1,
  maintenance_required boolean not null default false,
  maintenance_days jsonb null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_accuracy_percent >= 0 and min_accuracy_percent <= 100),
  check (min_independence_percent >= 0 and min_independence_percent <= 100),
  check (min_trials_per_session >= 1),
  check (min_consecutive_days >= 1),
  check (min_distinct_therapists >= 1)
);

alter table public.aba_mastery_evaluations
  add column if not exists criteria_id text,
  add column if not exists total_trials integer not null default 0,
  add column if not exists independent_trials integer not null default 0,
  add column if not exists prompted_trials integer not null default 0,
  add column if not exists error_trials integer not null default 0,
  add column if not exists independence_percent numeric(6,2),
  add column if not exists cold_probe_trials_count integer not null default 0,
  add column if not exists consecutive_successful_days integer not null default 0,
  add column if not exists status text not null default 'INSUFFICIENT_DATA'
    check (status in ('INSUFFICIENT_DATA', 'NOT_MET', 'MET_TODAY', 'READY_FOR_REVIEW', 'MASTERED_APPROVED', 'REGRESSION_RISK'));

create table if not exists public.aba_target_status_audit_logs (
  id text primary key default gen_random_uuid()::text,
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  target_id text not null,
  previous_status text,
  new_status text not null,
  evaluation_id text not null,
  changed_by text not null,
  changed_at timestamptz not null default now(),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_aba_trials_org_patient_target_occurred
  on public.aba_trials (organization_id, patient_id, target_id, occurred_at desc);
create index if not exists idx_aba_trials_org_session_target
  on public.aba_trials (organization_id, session_id, target_id);
create index if not exists idx_aba_mastery_evaluations_org_patient_target_evaluated
  on public.aba_mastery_evaluations (organization_id, patient_id, target_id, evaluated_at desc);
create index if not exists idx_aba_mastery_criteria_org_target_active
  on public.aba_mastery_criteria (organization_id, target_id, is_active);
create index if not exists idx_aba_mastery_criteria_org_program_active
  on public.aba_mastery_criteria (organization_id, program_id, is_active);
create index if not exists idx_aba_target_status_audit_logs_org_patient_target
  on public.aba_target_status_audit_logs (organization_id, patient_id, target_id, changed_at desc);

alter table public.aba_mastery_criteria enable row level security;
alter table public.aba_mastery_evaluations enable row level security;
alter table public.aba_target_status_audit_logs enable row level security;

drop policy if exists aba_mastery_criteria_clinic_rw on public.aba_mastery_criteria;
create policy aba_mastery_criteria_clinic_rw
on public.aba_mastery_criteria
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (
          u.role in ('coordinator', 'therapist')
          and u.clinic_id::text = aba_mastery_criteria.clinic_id
          and u.clinic_id::text = aba_mastery_criteria.organization_id
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (
          u.role in ('coordinator', 'therapist')
          and u.clinic_id::text = aba_mastery_criteria.clinic_id
          and u.clinic_id::text = aba_mastery_criteria.organization_id
        )
      )
  )
);

drop policy if exists aba_target_status_audit_logs_patient_scope_rw on public.aba_target_status_audit_logs;
create policy aba_target_status_audit_logs_patient_scope_rw
on public.aba_target_status_audit_logs
for all
to authenticated
using (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_target_status_audit_logs.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_target_status_audit_logs.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_target_status_audit_logs.clinic_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_target_status_audit_logs.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_target_status_audit_logs.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_target_status_audit_logs.clinic_id)
      )
  )
);
