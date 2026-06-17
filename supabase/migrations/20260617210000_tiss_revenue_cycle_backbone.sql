-- TISS/TUSS revenue cycle backbone.
-- Additive only. This migration prepares operational state, anti-denial audit, and draft grouping.
-- It does NOT transmit official batches, send remittances, receive returns, process denials,
-- create appeals, perform financial settlement, use certificates, or integrate with payer portals.

create extension if not exists pgcrypto;

alter table public.tuss_codes
  add column if not exists source text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.tuss_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  version text not null,
  description text,
  source text not null default 'manual',
  active boolean not null default true,
  valid_from date,
  valid_until date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tuss_versions_tenant_check check (organization_id is not null),
  constraint tuss_versions_validity_check check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create table if not exists public.tuss_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  code text not null,
  name text not null,
  source text not null default 'manual',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.denial_reason_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  code text not null,
  description text not null,
  source text not null default 'manual',
  active boolean not null default true,
  valid_from date,
  valid_until date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint denial_reason_codes_validity_check check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

alter table public.payer_tuss_mappings
  add column if not exists payer_specific_description text,
  add column if not exists negotiated_amount_cents integer,
  add column if not exists source text not null default 'manual',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.appointment_tiss_pre_guides
  add column if not exists revenue_cycle_state text,
  add column if not exists revenue_cycle_state_reason text,
  add column if not exists anti_glosa_checklist jsonb not null default '{}'::jsonb,
  add column if not exists anti_glosa_risk_codes text[] not null default '{}';

create table if not exists public.tiss_revenue_cycle_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  pre_guide_id uuid references public.appointment_tiss_pre_guides(id) on delete set null,
  xml_draft_id uuid references public.tiss_xml_drafts(id) on delete set null,
  payer_id uuid references public.clinic_payers(id) on delete set null,
  event_type text not null,
  previous_state text,
  new_state text not null,
  reason text,
  performed_by uuid references public.users(id) on delete set null,
  performed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint tiss_revenue_cycle_events_tenant_check check (organization_id = clinic_id),
  constraint tiss_revenue_cycle_events_type_check check (
    event_type in (
      'PRE_GUIDE_MATERIALIZED',
      'PRE_GUIDE_VALIDATED',
      'PRE_GUIDE_READY_FOR_BILLING',
      'PRE_GUIDE_PENDING',
      'AUTHORIZATION_ATTACHED',
      'XML_DRAFT_GENERATED',
      'XML_DRAFT_VALIDATED',
      'XML_DRAFT_SUPERSEDED',
      'TISS_BILLING_BATCH_DRAFT_CREATED',
      'TISS_BILLING_BATCH_DRAFT_CANCELLED',
      'MANUAL_OVERRIDE_APPLIED'
    )
  ),
  constraint tiss_revenue_cycle_events_state_check check (
    new_state in (
      'draft',
      'missing_data',
      'awaiting_authorization',
      'authorized',
      'in_execution',
      'ready_for_billing',
      'xml_draft_generated',
      'billing_batch_draft',
      'sent',
      'processed',
      'paid',
      'denied',
      'partially_denied',
      'appealed'
    )
  )
);

create table if not exists public.tiss_billing_batch_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  payer_id uuid not null references public.clinic_payers(id) on delete restrict,
  competence_month date not null,
  status text not null default 'draft',
  pre_guide_ids uuid[] not null default '{}',
  xml_draft_ids uuid[] not null default '{}',
  guide_count integer not null default 0,
  total_amount_cents integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  validation_summary jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint tiss_billing_batch_drafts_tenant_check check (organization_id = clinic_id),
  constraint tiss_billing_batch_drafts_status_check check (status in ('draft', 'validated', 'cancelled', 'superseded'))
);

create index if not exists idx_tiss_revenue_cycle_events_scope
  on public.tiss_revenue_cycle_events (organization_id, performed_at desc, event_type);
create index if not exists idx_tiss_revenue_cycle_events_pre_guide
  on public.tiss_revenue_cycle_events (organization_id, pre_guide_id, performed_at desc);
create index if not exists idx_tiss_revenue_cycle_events_xml_draft
  on public.tiss_revenue_cycle_events (organization_id, xml_draft_id, performed_at desc);
create index if not exists idx_tiss_billing_batch_drafts_period
  on public.tiss_billing_batch_drafts (organization_id, competence_month desc, payer_id, status);
create index if not exists idx_tiss_billing_batch_drafts_pre_guides
  on public.tiss_billing_batch_drafts using gin (pre_guide_ids);
create index if not exists idx_tuss_versions_org_active
  on public.tuss_versions (organization_id, active, version);
create index if not exists idx_tuss_categories_org_active
  on public.tuss_categories (organization_id, active, code);
create index if not exists idx_denial_reason_codes_org_active
  on public.denial_reason_codes (organization_id, active, code);

alter table public.tiss_revenue_cycle_events enable row level security;
alter table public.tiss_billing_batch_drafts enable row level security;
alter table public.tuss_versions enable row level security;
alter table public.tuss_categories enable row level security;
alter table public.denial_reason_codes enable row level security;

drop policy if exists tiss_revenue_cycle_events_admin_rw on public.tiss_revenue_cycle_events;
create policy tiss_revenue_cycle_events_admin_rw on public.tiss_revenue_cycle_events
for all to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      -- Legacy clinics created the clinic row with id = owner user id before clinic_id was consistently populated.
      and (u.clinic_id = tiss_revenue_cycle_events.clinic_id or u.id = tiss_revenue_cycle_events.clinic_id)
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      -- Legacy clinics created the clinic row with id = owner user id before clinic_id was consistently populated.
      and (u.clinic_id = tiss_revenue_cycle_events.clinic_id or u.id = tiss_revenue_cycle_events.clinic_id)
  )
);

drop policy if exists tiss_billing_batch_drafts_admin_rw on public.tiss_billing_batch_drafts;
create policy tiss_billing_batch_drafts_admin_rw on public.tiss_billing_batch_drafts
for all to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      -- Legacy clinics created the clinic row with id = owner user id before clinic_id was consistently populated.
      and (u.clinic_id = tiss_billing_batch_drafts.clinic_id or u.id = tiss_billing_batch_drafts.clinic_id)
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      -- Legacy clinics created the clinic row with id = owner user id before clinic_id was consistently populated.
      and (u.clinic_id = tiss_billing_batch_drafts.clinic_id or u.id = tiss_billing_batch_drafts.clinic_id)
  )
);

drop policy if exists tuss_versions_admin_rw on public.tuss_versions;
create policy tuss_versions_admin_rw on public.tuss_versions
for all to authenticated
using (
  organization_id in (
    select clinic_id from public.users
    where id = auth.uid()
      and role in ('owner', 'admin', 'coordinator')
  )
)
with check (
  organization_id in (
    select clinic_id from public.users
    where id = auth.uid()
      and role in ('owner', 'admin', 'coordinator')
  )
);

drop policy if exists tuss_categories_admin_rw on public.tuss_categories;
create policy tuss_categories_admin_rw on public.tuss_categories
for all to authenticated
using (
  organization_id in (
    select clinic_id from public.users
    where id = auth.uid()
      and role in ('owner', 'admin', 'coordinator')
  )
)
with check (
  organization_id in (
    select clinic_id from public.users
    where id = auth.uid()
      and role in ('owner', 'admin', 'coordinator')
  )
);

drop policy if exists denial_reason_codes_admin_rw on public.denial_reason_codes;
create policy denial_reason_codes_admin_rw on public.denial_reason_codes
for all to authenticated
using (
  organization_id in (
    select clinic_id from public.users
    where id = auth.uid()
      and role in ('owner', 'admin', 'coordinator')
  )
)
with check (
  organization_id in (
    select clinic_id from public.users
    where id = auth.uid()
      and role in ('owner', 'admin', 'coordinator')
  )
);

revoke all on table public.tiss_revenue_cycle_events from anon;
revoke all on table public.tiss_billing_batch_drafts from anon;
revoke all on table public.tuss_versions from anon;
revoke all on table public.tuss_categories from anon;
revoke all on table public.denial_reason_codes from anon;
