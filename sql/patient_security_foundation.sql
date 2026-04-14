-- Patient Security Foundation (LGPD/HIPAA-oriented hardening)
-- Execute in Supabase SQL editor with privileged role.

create extension if not exists pgcrypto;

create table if not exists public.patient_records (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  clinic_id uuid,
  therapist_id uuid references public.users(id) on delete set null,
  pseudonym_id text not null,
  payload_encrypted text,
  payload_preview jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_patient_records_clinic on public.patient_records(clinic_id);
create index if not exists idx_patient_records_pseudonym on public.patient_records(pseudonym_id);

alter table public.patient_records enable row level security;

drop policy if exists patient_records_select on public.patient_records;
create policy patient_records_select
on public.patient_records
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or u.id = therapist_id
        or (u.role in ('coordinator', 'receptionist') and u.clinic_id = clinic_id)
      )
  )
);

drop policy if exists patient_records_write on public.patient_records;
create policy patient_records_write
on public.patient_records
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or u.id = therapist_id
        or (u.role in ('coordinator', 'receptionist') and u.clinic_id = clinic_id)
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
        or u.id = therapist_id
        or (u.role in ('coordinator', 'receptionist') and u.clinic_id = clinic_id)
      )
  )
);

create table if not exists public.clinic_anamnesis_templates (
  clinic_id uuid primary key,
  template_json jsonb not null default '{"hiddenFields":[],"customQuestions":[]}'::jsonb,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.clinic_anamnesis_templates enable row level security;

drop policy if exists clinic_anamnesis_templates_select on public.clinic_anamnesis_templates;
create policy clinic_anamnesis_templates_select
on public.clinic_anamnesis_templates
for select
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or u.clinic_id = clinic_id
        or u.id = clinic_id
      )
  )
);

drop policy if exists clinic_anamnesis_templates_write on public.clinic_anamnesis_templates;
create policy clinic_anamnesis_templates_write
on public.clinic_anamnesis_templates
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin', 'coordinator', 'receptionist', 'therapist')
        and (u.clinic_id = clinic_id or u.id = clinic_id)
      )
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin', 'coordinator', 'receptionist', 'therapist')
        and (u.clinic_id = clinic_id or u.id = clinic_id)
      )
  )
);
