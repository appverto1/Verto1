-- ABA mastery engine foundation.
-- Stores every automatic mastery evaluation without mutating target phase silently.

create extension if not exists pgcrypto;

create table if not exists public.aba_mastery_evaluations (
  id text primary key,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  session_id text,
  target_id text,
  target_name text not null,
  evaluation_status text not null default 'not_met'
    check (evaluation_status in ('not_met', 'met', 'mastered', 'regressed', 'maintenance_due', 'insufficient_data')),
  suggested_phase text
    check (suggested_phase in ('draft', 'baseline', 'teaching', 'mastered', 'maintenance', 'generalization', 'regressed', 'discontinued')),
  accuracy_percent numeric(6,2),
  consecutive_successes integer not null default 0,
  min_consecutive_successes integer not null default 1,
  trials_considered integer not null default 0,
  distinct_therapists_count integer,
  first_trial_independent boolean,
  criteria jsonb not null default '{}'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz not null default now(),
  therapist_id text,
  source_trial_id text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_aba_mastery_evaluations_patient
  on public.aba_mastery_evaluations (patient_id, evaluated_at desc);
create index if not exists idx_aba_mastery_evaluations_target
  on public.aba_mastery_evaluations (patient_id, target_id, evaluated_at desc);
create index if not exists idx_aba_mastery_evaluations_status
  on public.aba_mastery_evaluations (clinic_id, evaluation_status, evaluated_at desc);

alter table public.aba_mastery_evaluations enable row level security;

drop policy if exists aba_mastery_evaluations_patient_scope_rw on public.aba_mastery_evaluations;
create policy aba_mastery_evaluations_patient_scope_rw
on public.aba_mastery_evaluations
for all
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_mastery_evaluations.patient_id
      and (
        u.role in ('owner', 'admin')
        or (
          u.role = 'coordinator'
          and u.clinic_id::text = aba_mastery_evaluations.clinic_id
        )
        or (
          u.role = 'therapist'
          and p.therapist_id = auth.uid()
          and u.clinic_id::text = aba_mastery_evaluations.clinic_id
        )
      )
  )
)
with check (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_mastery_evaluations.patient_id
      and (
        u.role in ('owner', 'admin')
        or (
          u.role = 'coordinator'
          and u.clinic_id::text = aba_mastery_evaluations.clinic_id
        )
        or (
          u.role = 'therapist'
          and p.therapist_id = auth.uid()
          and u.clinic_id::text = aba_mastery_evaluations.clinic_id
        )
      )
  )
);
