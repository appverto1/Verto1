-- Advanced payer/TUSS contract configuration.
-- Additive only. This prepares real payer master data, negotiated procedure prices,
-- payer-specific De/Para snapshots, and anti-denial rules.
-- It does NOT send remittances, transmit official batches, receive returns,
-- process denials, settle financials, use certificates, or integrate with payer portals.

create extension if not exists pgcrypto;

alter table public.payer_tiss_profiles
  add column if not exists operator_document_number text,
  add column if not exists auditor_contact_name text,
  add column if not exists billing_email text,
  add column if not exists billing_phone text,
  add column if not exists operator_portal_url text,
  add column if not exists administrative_notes text,
  add column if not exists requires_physical_guide boolean not null default false,
  add column if not exists requires_signed_guide boolean not null default false,
  add column if not exists requires_stamped_dated_guide boolean not null default false,
  add column if not exists requires_administrative_report boolean not null default false,
  add column if not exists allows_mixed_multidisciplinary_guide boolean not null default false,
  add column if not exists requires_separate_guide_by_specialty boolean not null default false;

alter table public.payer_tuss_mappings
  add column if not exists contract_code text,
  add column if not exists contract_description text,
  add column if not exists specialty text,
  add column if not exists standard_duration_minutes integer,
  add column if not exists negotiated_amount_cents integer,
  add column if not exists source text not null default 'manual',
  add column if not exists notes text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.payer_procedure_prices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  payer_id uuid not null references public.clinic_payers(id) on delete cascade,
  service_catalog_id uuid references public.tuss_service_catalog(id) on delete cascade,
  tuss_code_id uuid references public.tuss_codes(id) on delete restrict,
  payer_tuss_mapping_id uuid references public.payer_tuss_mappings(id) on delete set null,
  tuss_code text,
  amount_cents integer not null,
  currency text not null default 'BRL',
  valid_from date,
  valid_until date,
  active boolean not null default true,
  source text not null default 'manual',
  notes text,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payer_procedure_prices_tenant_check check (organization_id = clinic_id),
  constraint payer_procedure_prices_amount_check check (amount_cents >= 0),
  constraint payer_procedure_prices_validity_check check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

alter table public.payer_procedure_prices
  add column if not exists organization_id uuid references public.clinics(id) on delete cascade,
  add column if not exists clinic_id uuid references public.clinics(id) on delete cascade,
  add column if not exists payer_id uuid references public.clinic_payers(id) on delete cascade,
  add column if not exists service_catalog_id uuid references public.tuss_service_catalog(id) on delete cascade,
  add column if not exists tuss_code_id uuid references public.tuss_codes(id) on delete restrict,
  add column if not exists payer_tuss_mapping_id uuid references public.payer_tuss_mappings(id) on delete set null,
  add column if not exists tuss_code text,
  add column if not exists amount_cents integer not null default 0,
  add column if not exists currency text not null default 'BRL',
  add column if not exists valid_from date,
  add column if not exists valid_until date,
  add column if not exists active boolean not null default true,
  add column if not exists source text not null default 'manual',
  add column if not exists notes text,
  add column if not exists created_by uuid references public.users(id) on delete set null,
  add column if not exists updated_by uuid references public.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_payer_procedure_prices_scope
  on public.payer_procedure_prices (organization_id, payer_id, active, valid_from, valid_until);
create index if not exists idx_payer_procedure_prices_service
  on public.payer_procedure_prices (organization_id, payer_id, service_catalog_id, active, valid_from, valid_until);
create index if not exists idx_payer_procedure_prices_tuss
  on public.payer_procedure_prices (organization_id, payer_id, tuss_code_id, active, valid_from, valid_until);
create index if not exists idx_payer_procedure_prices_mapping
  on public.payer_procedure_prices (organization_id, payer_tuss_mapping_id, active);

alter table public.payer_procedure_prices enable row level security;

drop policy if exists payer_procedure_prices_admin_rw on public.payer_procedure_prices;
create policy payer_procedure_prices_admin_rw on public.payer_procedure_prices
for all to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      -- Legacy clinics created the clinic row with id = owner user id before clinic_id was consistently populated.
      and (u.clinic_id = payer_procedure_prices.clinic_id or u.id = payer_procedure_prices.clinic_id)
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      -- Legacy clinics created the clinic row with id = owner user id before clinic_id was consistently populated.
      and (u.clinic_id = payer_procedure_prices.clinic_id or u.id = payer_procedure_prices.clinic_id)
  )
);

revoke all on public.payer_procedure_prices from anon;
grant select, insert, update, delete on public.payer_procedure_prices to authenticated;

