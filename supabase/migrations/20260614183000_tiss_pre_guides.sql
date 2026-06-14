-- Marco Pre-guia TISS.
-- Additive only. This migration does NOT generate TISS XML, batches, remittance,
-- return files, denial handling or external payer integrations.

create extension if not exists pgcrypto;

create table if not exists public.clinic_tiss_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  legal_name text,
  trade_name text,
  document_type text,
  document_number text,
  cnes_code text,
  provider_code text,
  ans_provider_code text,
  address_line text,
  address_number text,
  address_complement text,
  district text,
  city text,
  state text,
  postal_code text,
  phone text,
  email text,
  active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_tiss_profiles_tenant_check check (organization_id = clinic_id),
  constraint clinic_tiss_profiles_document_type_check check (document_type is null or document_type in ('CPF', 'CNPJ'))
);

alter table public.clinic_tiss_profiles
  add column if not exists organization_id uuid references public.clinics(id) on delete cascade,
  add column if not exists clinic_id uuid references public.clinics(id) on delete cascade,
  add column if not exists legal_name text,
  add column if not exists trade_name text,
  add column if not exists document_type text,
  add column if not exists document_number text,
  add column if not exists cnes_code text,
  add column if not exists provider_code text,
  add column if not exists ans_provider_code text,
  add column if not exists address_line text,
  add column if not exists address_number text,
  add column if not exists address_complement text,
  add column if not exists district text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists postal_code text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists active boolean not null default true,
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_clinic_tiss_profiles_clinic_active
  on public.clinic_tiss_profiles (organization_id);

create table if not exists public.payer_tiss_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  payer_id uuid not null references public.clinic_payers(id) on delete cascade,
  ans_registration text,
  operator_code text,
  tiss_version text,
  default_guide_type text not null default 'sp_sadt',
  requires_authorization boolean not null default false,
  requires_provider_code boolean not null default false,
  requires_cnes boolean not null default false,
  requires_cbo boolean not null default false,
  requires_executant_registry boolean not null default false,
  requires_beneficiary_card boolean not null default true,
  active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payer_tiss_profiles_tenant_check check (organization_id = clinic_id),
  constraint payer_tiss_profiles_guide_type_check check (default_guide_type in ('consulta', 'sp_sadt', 'other'))
);

alter table public.payer_tiss_profiles
  add column if not exists organization_id uuid references public.clinics(id) on delete cascade,
  add column if not exists clinic_id uuid references public.clinics(id) on delete cascade,
  add column if not exists payer_id uuid references public.clinic_payers(id) on delete cascade,
  add column if not exists ans_registration text,
  add column if not exists operator_code text,
  add column if not exists tiss_version text,
  add column if not exists default_guide_type text not null default 'sp_sadt',
  add column if not exists requires_authorization boolean not null default false,
  add column if not exists requires_provider_code boolean not null default false,
  add column if not exists requires_cnes boolean not null default false,
  add column if not exists requires_cbo boolean not null default false,
  add column if not exists requires_executant_registry boolean not null default false,
  add column if not exists requires_beneficiary_card boolean not null default true,
  add column if not exists active boolean not null default true,
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_payer_tiss_profiles_payer_active
  on public.payer_tiss_profiles (organization_id, payer_id);
create index if not exists idx_payer_tiss_profiles_payer
  on public.payer_tiss_profiles (clinic_id, payer_id, active);

create table if not exists public.professional_billing_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  professional_id uuid not null references public.users(id) on delete cascade,
  display_name text,
  document_type text,
  document_number text,
  council_type text,
  council_number text,
  council_state text,
  cbo_code text,
  specialty_name text,
  provider_code text,
  active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_billing_profiles_tenant_check check (organization_id = clinic_id),
  constraint professional_billing_profiles_document_type_check check (document_type is null or document_type in ('CPF', 'CNPJ', 'OTHER'))
);

alter table public.professional_billing_profiles
  add column if not exists organization_id uuid references public.clinics(id) on delete cascade,
  add column if not exists clinic_id uuid references public.clinics(id) on delete cascade,
  add column if not exists professional_id uuid references public.users(id) on delete cascade,
  add column if not exists display_name text,
  add column if not exists document_type text,
  add column if not exists document_number text,
  add column if not exists council_type text,
  add column if not exists council_number text,
  add column if not exists council_state text,
  add column if not exists cbo_code text,
  add column if not exists specialty_name text,
  add column if not exists provider_code text,
  add column if not exists active boolean not null default true,
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_professional_billing_profiles_professional_active
  on public.professional_billing_profiles (organization_id, professional_id);
create index if not exists idx_professional_billing_profiles_professional
  on public.professional_billing_profiles (clinic_id, professional_id, active);

create table if not exists public.appointment_tiss_pre_guides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  professional_id uuid references public.users(id) on delete set null,
  payer_id uuid references public.clinic_payers(id) on delete set null,
  billing_item_id uuid references public.appointment_billing_items(id) on delete set null,
  provider_profile_id uuid references public.clinic_tiss_profiles(id) on delete set null,
  payer_tiss_profile_id uuid references public.payer_tiss_profiles(id) on delete set null,
  professional_billing_profile_id uuid references public.professional_billing_profiles(id) on delete set null,
  guide_type text not null default 'sp_sadt',
  guide_number text,
  authorization_code text,
  authorization_valid_until date,
  beneficiary_card_number text,
  internal_procedure_code text,
  internal_procedure_name text,
  tuss_code text,
  tuss_description text,
  tuss_version text,
  quantity numeric(12, 4) not null default 1,
  unit text,
  unit_amount_cents integer,
  total_amount_cents integer,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  patient_name_snapshot text,
  professional_name_snapshot text,
  payer_name_snapshot text,
  clinic_name_snapshot text,
  status text not null default 'draft',
  validation_errors jsonb not null default '[]'::jsonb,
  validation_warnings jsonb not null default '[]'::jsonb,
  validation_error_codes text[] not null default array[]::text[],
  validation_warning_codes text[] not null default array[]::text[],
  snapshot_data jsonb not null default '{}'::jsonb,
  generated_from_version text not null default 'tiss-pre-guide-v1',
  stale_reason text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_validated_at timestamptz,
  constraint appointment_tiss_pre_guides_tenant_check check (organization_id = clinic_id),
  constraint appointment_tiss_pre_guides_status_check check (status in ('draft', 'valid', 'pending_data', 'not_applicable', 'cancelled')),
  constraint appointment_tiss_pre_guides_guide_type_check check (guide_type in ('consulta', 'sp_sadt', 'other')),
  constraint appointment_tiss_pre_guides_quantity_check check (quantity > 0),
  constraint appointment_tiss_pre_guides_amount_check check (
    (unit_amount_cents is null or unit_amount_cents >= 0)
    and (total_amount_cents is null or total_amount_cents >= 0)
  )
);

alter table public.appointment_tiss_pre_guides
  add column if not exists organization_id uuid references public.clinics(id) on delete cascade,
  add column if not exists clinic_id uuid references public.clinics(id) on delete cascade,
  add column if not exists appointment_id uuid references public.appointments(id) on delete cascade,
  add column if not exists patient_id uuid references public.patients(id) on delete set null,
  add column if not exists professional_id uuid references public.users(id) on delete set null,
  add column if not exists payer_id uuid references public.clinic_payers(id) on delete set null,
  add column if not exists billing_item_id uuid references public.appointment_billing_items(id) on delete set null,
  add column if not exists provider_profile_id uuid references public.clinic_tiss_profiles(id) on delete set null,
  add column if not exists payer_tiss_profile_id uuid references public.payer_tiss_profiles(id) on delete set null,
  add column if not exists professional_billing_profile_id uuid references public.professional_billing_profiles(id) on delete set null,
  add column if not exists guide_type text not null default 'sp_sadt',
  add column if not exists guide_number text,
  add column if not exists authorization_code text,
  add column if not exists authorization_valid_until date,
  add column if not exists beneficiary_card_number text,
  add column if not exists internal_procedure_code text,
  add column if not exists internal_procedure_name text,
  add column if not exists tuss_code text,
  add column if not exists tuss_description text,
  add column if not exists tuss_version text,
  add column if not exists quantity numeric(12, 4) not null default 1,
  add column if not exists unit text,
  add column if not exists unit_amount_cents integer,
  add column if not exists total_amount_cents integer,
  add column if not exists scheduled_start timestamptz,
  add column if not exists scheduled_end timestamptz,
  add column if not exists patient_name_snapshot text,
  add column if not exists professional_name_snapshot text,
  add column if not exists payer_name_snapshot text,
  add column if not exists clinic_name_snapshot text,
  add column if not exists status text not null default 'draft',
  add column if not exists validation_errors jsonb not null default '[]'::jsonb,
  add column if not exists validation_warnings jsonb not null default '[]'::jsonb,
  add column if not exists validation_error_codes text[] not null default array[]::text[],
  add column if not exists validation_warning_codes text[] not null default array[]::text[],
  add column if not exists snapshot_data jsonb not null default '{}'::jsonb,
  add column if not exists generated_from_version text not null default 'tiss-pre-guide-v1',
  add column if not exists stale_reason text,
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_validated_at timestamptz;

create unique index if not exists idx_appointment_tiss_pre_guides_appointment
  on public.appointment_tiss_pre_guides (organization_id, appointment_id);
create index if not exists idx_appointment_tiss_pre_guides_period_status
  on public.appointment_tiss_pre_guides (organization_id, scheduled_start desc, status);
create index if not exists idx_appointment_tiss_pre_guides_payer_period
  on public.appointment_tiss_pre_guides (organization_id, payer_id, scheduled_start desc);
create index if not exists idx_appointment_tiss_pre_guides_patient_period
  on public.appointment_tiss_pre_guides (organization_id, patient_id, scheduled_start desc);
create index if not exists idx_appointment_tiss_pre_guides_professional_period
  on public.appointment_tiss_pre_guides (organization_id, professional_id, scheduled_start desc);
create index if not exists idx_appointment_tiss_pre_guides_error_codes
  on public.appointment_tiss_pre_guides using gin (validation_error_codes);

alter table public.clinic_tiss_profiles enable row level security;
alter table public.payer_tiss_profiles enable row level security;
alter table public.professional_billing_profiles enable row level security;
alter table public.appointment_tiss_pre_guides enable row level security;

drop policy if exists clinic_tiss_profiles_admin_rw on public.clinic_tiss_profiles;
create policy clinic_tiss_profiles_admin_rw on public.clinic_tiss_profiles
for all to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = clinic_tiss_profiles.clinic_id or u.id = clinic_tiss_profiles.clinic_id)
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = clinic_tiss_profiles.clinic_id or u.id = clinic_tiss_profiles.clinic_id)
  )
);

drop policy if exists payer_tiss_profiles_admin_rw on public.payer_tiss_profiles;
create policy payer_tiss_profiles_admin_rw on public.payer_tiss_profiles
for all to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = payer_tiss_profiles.clinic_id or u.id = payer_tiss_profiles.clinic_id)
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = payer_tiss_profiles.clinic_id or u.id = payer_tiss_profiles.clinic_id)
  )
);

drop policy if exists professional_billing_profiles_admin_rw on public.professional_billing_profiles;
create policy professional_billing_profiles_admin_rw on public.professional_billing_profiles
for all to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = professional_billing_profiles.clinic_id or u.id = professional_billing_profiles.clinic_id)
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = professional_billing_profiles.clinic_id or u.id = professional_billing_profiles.clinic_id)
  )
);

drop policy if exists appointment_tiss_pre_guides_admin_rw on public.appointment_tiss_pre_guides;
create policy appointment_tiss_pre_guides_admin_rw on public.appointment_tiss_pre_guides
for all to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = appointment_tiss_pre_guides.clinic_id or u.id = appointment_tiss_pre_guides.clinic_id)
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = appointment_tiss_pre_guides.clinic_id or u.id = appointment_tiss_pre_guides.clinic_id)
  )
);

revoke all on table public.clinic_tiss_profiles from anon;
revoke all on table public.payer_tiss_profiles from anon;
revoke all on table public.professional_billing_profiles from anon;
revoke all on table public.appointment_tiss_pre_guides from anon;
