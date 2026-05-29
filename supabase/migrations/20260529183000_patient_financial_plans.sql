-- Patient registration persistence and treatment financial plan lines.
-- Additive only. This stores payer/authorization context for operational closure.

create extension if not exists pgcrypto;

alter table if exists public.patients
  add column if not exists type text,
  add column if not exists social_name text,
  add column if not exists birth_date date,
  add column if not exists gender text,
  add column if not exists patient_profile_type text,
  add column if not exists panel_type text,
  add column if not exists profile_type text,
  add column if not exists insurance_type text,
  add column if not exists insurance_name text,
  add column if not exists insurance_card_number text,
  add column if not exists patient_group text,
  add column if not exists lead_source text,
  add column if not exists rg text,
  add column if not exists cep text,
  add column if not exists responsible_name text,
  add column if not exists responsible_birth_date date,
  add column if not exists responsible_cpf text,
  add column if not exists responsible_phone text,
  add column if not exists responsible_email text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.patient_financial_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  service_type text not null default 'CUSTOM',
  custom_service_name text,
  service_name_snapshot text,
  billing_mode text not null default 'PRIVATE'
    check (billing_mode in ('PRIVATE', 'INSURANCE', 'PACKAGE', 'MONTHLY', 'COURTESY', 'OTHER')),
  payer_id uuid references public.clinic_payers(id) on delete set null,
  payer_name_snapshot text,
  insurance_plan_name text,
  authorization_code text,
  authorization_valid_until date,
  sessions_quantity integer,
  quantity_period text
    check (quantity_period is null or quantity_period in ('SESSION', 'WEEK', 'MONTH', 'PACKAGE', 'AUTHORIZATION')),
  amount_cents integer not null default 0 check (amount_cents >= 0),
  copayment_amount_cents integer not null default 0 check (copayment_amount_cents >= 0),
  payment_method text,
  due_day integer check (due_day is null or (due_day >= 1 and due_day <= 31)),
  package_valid_until date,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.patient_financial_plans
  add column if not exists organization_id uuid,
  add column if not exists patient_id uuid references public.patients(id) on delete cascade,
  add column if not exists service_type text not null default 'CUSTOM',
  add column if not exists custom_service_name text,
  add column if not exists service_name_snapshot text,
  add column if not exists billing_mode text not null default 'PRIVATE',
  add column if not exists payer_id uuid references public.clinic_payers(id) on delete set null,
  add column if not exists payer_name_snapshot text,
  add column if not exists insurance_plan_name text,
  add column if not exists authorization_code text,
  add column if not exists authorization_valid_until date,
  add column if not exists sessions_quantity integer,
  add column if not exists quantity_period text,
  add column if not exists amount_cents integer not null default 0,
  add column if not exists copayment_amount_cents integer not null default 0,
  add column if not exists payment_method text,
  add column if not exists due_day integer,
  add column if not exists package_valid_until date,
  add column if not exists status text not null default 'ACTIVE',
  add column if not exists notes text,
  add column if not exists created_by uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_patients_profile_type
  on public.patients (clinic_id, patient_profile_type);

create index if not exists idx_patient_financial_plans_scope
  on public.patient_financial_plans (organization_id, patient_id, status);

create index if not exists idx_patient_financial_plans_payer
  on public.patient_financial_plans (organization_id, payer_id);

create index if not exists idx_patient_financial_plans_authorization
  on public.patient_financial_plans (organization_id, authorization_valid_until)
  where billing_mode = 'INSURANCE' and authorization_valid_until is not null;

alter table public.patient_financial_plans enable row level security;

drop policy if exists patient_financial_plans_admin_rw on public.patient_financial_plans;
create policy patient_financial_plans_admin_rw
on public.patient_financial_plans
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and u.clinic_id = patient_financial_plans.organization_id
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and u.clinic_id = patient_financial_plans.organization_id
  )
);
