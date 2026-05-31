-- Additive hardening for patient identity fields, birthday/status dashboards
-- and age-based anamnesis template selection.

alter table public.patients
  add column if not exists social_name text,
  add column if not exists birth_date date,
  add column if not exists gender text,
  add column if not exists cpf text,
  add column if not exists phone text,
  add column if not exists patient_profile_type text,
  add column if not exists panel_type text,
  add column if not exists profile_type text,
  add column if not exists insurance_type text,
  add column if not exists insurance_name text,
  add column if not exists insurance_card_number text,
  add column if not exists patient_group text,
  add column if not exists lead_source text,
  add column if not exists notes text,
  add column if not exists rg text,
  add column if not exists cep text,
  add column if not exists responsible_name text,
  add column if not exists responsible_birth_date date,
  add column if not exists responsible_cpf text,
  add column if not exists responsible_phone text,
  add column if not exists responsible_email text,
  add column if not exists responsible_relationship text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists onboarding_status text not null default 'NOT_STARTED',
  add column if not exists anamnesis_required boolean not null default true,
  add column if not exists anamnesis_requested_at timestamptz,
  add column if not exists anamnesis_submitted_at timestamptz,
  add column if not exists anamnesis_reviewed_at timestamptz,
  add column if not exists relationship_status text not null default 'CONFIRMED';

create index if not exists idx_patients_birth_date_active
  on public.patients (clinic_id, birth_date)
  where is_active is true and deleted_at is null;

create table if not exists public.anamnesis_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  name text not null,
  description text,
  age_min_months integer,
  age_max_months integer,
  patient_profile_type text,
  questions jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.anamnesis_templates
  add column if not exists organization_id uuid,
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists age_min_months integer,
  add column if not exists age_max_months integer,
  add column if not exists patient_profile_type text,
  add column if not exists questions jsonb not null default '{}'::jsonb,
  add column if not exists is_default boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_by uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_anamnesis_templates_scope_age
  on public.anamnesis_templates (organization_id, is_active, patient_profile_type, age_min_months, age_max_months);

create unique index if not exists idx_anamnesis_templates_global_default_name
  on public.anamnesis_templates (lower(name))
  where organization_id is null and is_default is true;

alter table public.patient_anamnesis_requests
  add column if not exists template_id uuid references public.anamnesis_templates(id) on delete set null;

alter table public.patient_anamnesis_responses
  add column if not exists template_id uuid references public.anamnesis_templates(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists version integer not null default 1;

create index if not exists idx_patient_anamnesis_responses_version
  on public.patient_anamnesis_responses (organization_id, patient_id, version desc, updated_at desc);

alter table public.anamnesis_templates enable row level security;

drop policy if exists anamnesis_templates_clinic_read on public.anamnesis_templates;
create policy anamnesis_templates_clinic_read
on public.anamnesis_templates
for select
using (
  organization_id is null
  or exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist', 'receptionist')
      and (u.clinic_id = anamnesis_templates.organization_id or u.id = anamnesis_templates.organization_id)
  )
);

drop policy if exists anamnesis_templates_clinic_write on public.anamnesis_templates;
create policy anamnesis_templates_clinic_write
on public.anamnesis_templates
for all
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = anamnesis_templates.organization_id or u.id = anamnesis_templates.organization_id)
  )
)
with check (
  organization_id is not null
  and exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = anamnesis_templates.organization_id or u.id = anamnesis_templates.organization_id)
  )
);

insert into public.anamnesis_templates
  (name, description, age_min_months, age_max_months, patient_profile_type, questions, is_default, is_active)
select * from (
  values
    ('Infantil 0-5 anos', 'Modelo global para primeira infancia.', 0, 71, 'KIDS_TEA', '{}'::jsonb, true, true),
    ('Infantil 6-11 anos', 'Modelo global para criancas em idade escolar.', 72, 143, 'KIDS_TEA', '{}'::jsonb, true, true),
    ('Adolescente 12-17 anos', 'Modelo global para adolescentes.', 144, 215, 'TEEN', '{}'::jsonb, true, true),
    ('Adulto ABA 18+', 'Modelo global para adultos TEA em ABA.', 216, null, 'ABA', '{}'::jsonb, true, true),
    ('Adulto convencional 18+', 'Modelo global para adultos neurotipicos.', 216, null, 'ADULT', '{}'::jsonb, true, true)
) as seed(name, description, age_min_months, age_max_months, patient_profile_type, questions, is_default, is_active)
where not exists (
  select 1
  from public.anamnesis_templates existing
  where existing.organization_id is null
    and existing.is_default is true
    and lower(existing.name) = lower(seed.name)
);
