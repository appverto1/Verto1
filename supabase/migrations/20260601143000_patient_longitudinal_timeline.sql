-- Patient longitudinal timeline.
-- Additive/idempotent: imported timeline items are persisted once and read many times.

create extension if not exists pgcrypto;

alter table if exists public.patients
  add column if not exists global_patient_identity_id uuid;

alter table if exists public.patient_shared_history_snapshots
  add column if not exists global_patient_identity_id uuid,
  add column if not exists idempotency_key text,
  add column if not exists imported_at timestamptz;

alter table if exists public.patient_portability_snapshots
  add column if not exists global_patient_identity_id uuid,
  add column if not exists idempotency_key text,
  add column if not exists imported_at timestamptz;

create table if not exists public.patient_longitudinal_timeline_items (
  id uuid primary key default gen_random_uuid(),
  global_patient_identity_id uuid,
  organization_id uuid not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  source_organization_id uuid,
  source_patient_id uuid,
  item_type text not null,
  item_title text not null,
  item_date timestamptz,
  item_data jsonb not null default '{}'::jsonb,
  visibility text not null default 'PRIVATE',
  portability_scope jsonb not null default '{}'::jsonb,
  is_imported boolean not null default false,
  is_read_only boolean not null default false,
  imported_from_snapshot_id uuid,
  source_hash text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  imported_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.patient_longitudinal_timeline_items
  add column if not exists global_patient_identity_id uuid,
  add column if not exists organization_id uuid,
  add column if not exists patient_id uuid references public.patients(id) on delete cascade,
  add column if not exists source_organization_id uuid,
  add column if not exists source_patient_id uuid,
  add column if not exists item_type text,
  add column if not exists item_title text,
  add column if not exists item_date timestamptz,
  add column if not exists item_data jsonb not null default '{}'::jsonb,
  add column if not exists visibility text not null default 'PRIVATE',
  add column if not exists portability_scope jsonb not null default '{}'::jsonb,
  add column if not exists is_imported boolean not null default false,
  add column if not exists is_read_only boolean not null default false,
  add column if not exists imported_from_snapshot_id uuid,
  add column if not exists source_hash text,
  add column if not exists created_by uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists imported_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.patient_longitudinal_timeline_items
  drop constraint if exists patient_longitudinal_timeline_items_visibility_check;

alter table public.patient_longitudinal_timeline_items
  add constraint patient_longitudinal_timeline_items_visibility_check
  check (visibility in ('PRIVATE', 'PATIENT', 'PROFESSIONALS', 'PORTABLE', 'IMPORTED'));

alter table public.patient_longitudinal_timeline_items
  drop constraint if exists patient_longitudinal_timeline_items_type_check;

alter table public.patient_longitudinal_timeline_items
  add constraint patient_longitudinal_timeline_items_type_check
  check (item_type in (
    'CLINIC_LINK_STARTED',
    'CLINIC_LINK_ENDED',
    'ANAMNESIS',
    'REPORT',
    'DOCUMENT',
    'SHARED_NOTE',
    'PEI_SUMMARY',
    'ABA_SUMMARY',
    'TARGET_SUMMARY',
    'SESSION_SUMMARY',
    'FILE_REFERENCE',
    'PORTABILITY_IMPORT',
    'OTHER'
  ));

create table if not exists public.patient_history_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  source_snapshot_id uuid,
  source_organization_id uuid,
  imported_by uuid,
  imported_at timestamptz not null default now(),
  status text not null default 'COMPLETED',
  imported_items_count integer not null default 0,
  skipped_duplicates_count integer not null default 0,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.patient_history_imports
  add column if not exists organization_id uuid,
  add column if not exists patient_id uuid references public.patients(id) on delete cascade,
  add column if not exists source_snapshot_id uuid,
  add column if not exists source_organization_id uuid,
  add column if not exists imported_by uuid,
  add column if not exists imported_at timestamptz not null default now(),
  add column if not exists status text not null default 'COMPLETED',
  add column if not exists imported_items_count integer not null default 0,
  add column if not exists skipped_duplicates_count integer not null default 0,
  add column if not exists idempotency_key text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists idx_patient_timeline_source_hash
  on public.patient_longitudinal_timeline_items (organization_id, patient_id, source_hash)
  where source_hash is not null;

create index if not exists idx_patient_timeline_patient_date
  on public.patient_longitudinal_timeline_items (organization_id, patient_id, item_date desc, created_at desc);

create index if not exists idx_patient_timeline_imported
  on public.patient_longitudinal_timeline_items (organization_id, patient_id, is_imported, imported_at desc);

create unique index if not exists idx_patient_history_imports_idempotency
  on public.patient_history_imports (organization_id, patient_id, idempotency_key)
  where idempotency_key is not null;

alter table public.patient_longitudinal_timeline_items enable row level security;
alter table public.patient_history_imports enable row level security;

drop policy if exists patient_longitudinal_timeline_items_clinic_rw on public.patient_longitudinal_timeline_items;
create policy patient_longitudinal_timeline_items_clinic_rw
on public.patient_longitudinal_timeline_items
for all
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist')
      and (u.clinic_id = patient_longitudinal_timeline_items.organization_id or u.id = patient_longitudinal_timeline_items.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist')
      and (u.clinic_id = patient_longitudinal_timeline_items.organization_id or u.id = patient_longitudinal_timeline_items.organization_id)
  )
);

drop policy if exists patient_history_imports_clinic_rw on public.patient_history_imports;
create policy patient_history_imports_clinic_rw
on public.patient_history_imports
for all
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = patient_history_imports.organization_id or u.id = patient_history_imports.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = patient_history_imports.organization_id or u.id = patient_history_imports.organization_id)
  )
);

