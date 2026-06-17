-- TISS XML draft preview layer.
-- Additive only. This migration creates an internal XML draft history for review.
-- It does NOT send remittances, create official batches, receive returns, handle denials,
-- use digital certificates, or integrate with external payer portals.

create extension if not exists pgcrypto;

alter table public.clinic_tiss_profiles
  add column if not exists tiss_version text,
  add column if not exists default_guide_type text;

alter table public.payer_tiss_profiles
  add column if not exists xml_layout_type text;

create table if not exists public.tiss_xml_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  payer_id uuid not null references public.clinic_payers(id) on delete restrict,
  competence_month date not null,
  guide_type text not null default 'sp_sadt',
  tiss_version text,
  status text not null default 'draft',
  xml_content text not null,
  xml_hash text not null,
  generated_from_pre_guide_ids uuid[] not null default '{}',
  generated_by uuid references public.users(id) on delete set null,
  generated_at timestamptz not null default now(),
  validation_summary jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tiss_xml_drafts_tenant_check check (organization_id = clinic_id),
  constraint tiss_xml_drafts_status_check check (status in ('draft', 'superseded', 'cancelled')),
  constraint tiss_xml_drafts_guide_type_check check (guide_type in ('consulta', 'sp_sadt', 'other'))
);

alter table public.tiss_xml_drafts
  add column if not exists organization_id uuid references public.clinics(id) on delete cascade,
  add column if not exists clinic_id uuid references public.clinics(id) on delete cascade,
  add column if not exists payer_id uuid references public.clinic_payers(id) on delete restrict,
  add column if not exists competence_month date,
  add column if not exists guide_type text not null default 'sp_sadt',
  add column if not exists tiss_version text,
  add column if not exists status text not null default 'draft',
  add column if not exists xml_content text,
  add column if not exists xml_hash text,
  add column if not exists generated_from_pre_guide_ids uuid[] not null default '{}',
  add column if not exists generated_by uuid references public.users(id) on delete set null,
  add column if not exists generated_at timestamptz not null default now(),
  add column if not exists validation_summary jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_tiss_xml_drafts_period
  on public.tiss_xml_drafts (organization_id, competence_month desc, payer_id, status);
create index if not exists idx_tiss_xml_drafts_generated_at
  on public.tiss_xml_drafts (organization_id, generated_at desc);
create index if not exists idx_tiss_xml_drafts_pre_guides
  on public.tiss_xml_drafts using gin (generated_from_pre_guide_ids);
create index if not exists idx_tiss_xml_drafts_hash
  on public.tiss_xml_drafts (organization_id, xml_hash);

alter table public.tiss_xml_drafts enable row level security;

drop policy if exists tiss_xml_drafts_admin_rw on public.tiss_xml_drafts;
create policy tiss_xml_drafts_admin_rw on public.tiss_xml_drafts
for all to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      -- Legacy clinics created the clinic row with id = owner user id before clinic_id was consistently populated.
      and (u.clinic_id = tiss_xml_drafts.clinic_id or u.id = tiss_xml_drafts.clinic_id)
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      -- Legacy clinics created the clinic row with id = owner user id before clinic_id was consistently populated.
      and (u.clinic_id = tiss_xml_drafts.clinic_id or u.id = tiss_xml_drafts.clinic_id)
  )
);

revoke all on table public.tiss_xml_drafts from anon;
