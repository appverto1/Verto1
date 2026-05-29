-- Patient portability foundation.
-- Additive only: requests, approved snapshots and scoped access grants. No history is moved automatically.

create extension if not exists pgcrypto;

alter table if exists public.patients
  add column if not exists responsible_user_id uuid,
  add column if not exists client_record_id text;

alter table if exists public.notes
  add column if not exists portability_scope text not null default 'PRIVATE',
  add column if not exists is_portable boolean not null default false,
  add column if not exists shared_with_patient boolean not null default false,
  add column if not exists shared_with_professionals boolean not null default false,
  add column if not exists original_organization_id uuid,
  add column if not exists original_author_id uuid;

create table if not exists public.patient_portability_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id_requesting uuid not null,
  organization_id_source uuid,
  patient_id_requesting uuid references public.patients(id) on delete set null,
  patient_identity_id uuid,
  responsible_user_id uuid,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  status text not null default 'PENDING_RESPONSIBLE_APPROVAL',
  scope jsonb not null default '{}'::jsonb,
  reason text,
  resolved_by uuid,
  resolved_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.patient_portability_requests
  add column if not exists organization_id_requesting uuid,
  add column if not exists organization_id_source uuid,
  add column if not exists patient_id_requesting uuid references public.patients(id) on delete set null,
  add column if not exists patient_identity_id uuid,
  add column if not exists responsible_user_id uuid,
  add column if not exists requested_by uuid,
  add column if not exists requested_at timestamptz not null default now(),
  add column if not exists status text not null default 'PENDING_RESPONSIBLE_APPROVAL',
  add column if not exists scope jsonb not null default '{}'::jsonb,
  add column if not exists reason text,
  add column if not exists resolved_by uuid,
  add column if not exists resolved_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.patient_portability_requests
  drop constraint if exists patient_portability_requests_status_check;

alter table public.patient_portability_requests
  add constraint patient_portability_requests_status_check
  check (status in (
    'DRAFT',
    'PENDING_RESPONSIBLE_APPROVAL',
    'APPROVED',
    'REJECTED',
    'EXPIRED',
    'REVOKED',
    'COMPLETED'
  ));

create table if not exists public.patient_portability_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id_source uuid not null,
  organization_id_target uuid not null,
  portability_request_id uuid not null references public.patient_portability_requests(id) on delete cascade,
  patient_id_source uuid references public.patients(id) on delete set null,
  patient_id_target uuid references public.patients(id) on delete set null,
  snapshot_type text not null,
  snapshot_data jsonb not null default '{}'::jsonb,
  generated_by uuid,
  generated_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'GENERATED',
  metadata jsonb not null default '{}'::jsonb
);

alter table public.patient_portability_snapshots
  add column if not exists organization_id_source uuid,
  add column if not exists organization_id_target uuid,
  add column if not exists portability_request_id uuid references public.patient_portability_requests(id) on delete cascade,
  add column if not exists patient_id_source uuid references public.patients(id) on delete set null,
  add column if not exists patient_id_target uuid references public.patients(id) on delete set null,
  add column if not exists snapshot_type text,
  add column if not exists snapshot_data jsonb not null default '{}'::jsonb,
  add column if not exists generated_by uuid,
  add column if not exists generated_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists status text not null default 'GENERATED',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.patient_portability_snapshots
  drop constraint if exists patient_portability_snapshots_status_check;

alter table public.patient_portability_snapshots
  add constraint patient_portability_snapshots_status_check
  check (status in ('GENERATED', 'IMPORTED', 'REVOKED', 'EXPIRED'));

alter table public.patient_portability_snapshots
  drop constraint if exists patient_portability_snapshots_type_check;

alter table public.patient_portability_snapshots
  add constraint patient_portability_snapshots_type_check
  check (snapshot_type in (
    'DEMOGRAPHICS',
    'SHARED_NOTES',
    'REPORTS',
    'PEI_SUMMARY',
    'ABA_SUMMARY',
    'FILE_INDEX',
    'FULL_ALLOWED_PACKAGE'
  ));

create table if not exists public.patient_access_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  granted_to_organization_id uuid,
  granted_to_professional_id uuid,
  granted_by_user_id uuid,
  scope jsonb not null default '{}'::jsonb,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.patient_access_grants
  add column if not exists organization_id uuid,
  add column if not exists patient_id uuid references public.patients(id) on delete cascade,
  add column if not exists granted_to_organization_id uuid,
  add column if not exists granted_to_professional_id uuid,
  add column if not exists granted_by_user_id uuid,
  add column if not exists scope jsonb not null default '{}'::jsonb,
  add column if not exists starts_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists reason text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_patients_responsible_user_clinic
  on public.patients (responsible_user_id, clinic_id)
  where responsible_user_id is not null;

create index if not exists idx_patients_client_record_clinic
  on public.patients (clinic_id, client_record_id)
  where client_record_id is not null;

create index if not exists idx_patient_portability_requests_requesting
  on public.patient_portability_requests (organization_id_requesting, patient_id_requesting, status, requested_at desc);

create index if not exists idx_patient_portability_requests_responsible
  on public.patient_portability_requests (responsible_user_id, status, requested_at desc)
  where responsible_user_id is not null;

create index if not exists idx_patient_portability_snapshots_request
  on public.patient_portability_snapshots (portability_request_id, status, generated_at desc);

create index if not exists idx_patient_access_grants_patient_scope
  on public.patient_access_grants (organization_id, patient_id, starts_at desc);

alter table public.patient_portability_requests enable row level security;
alter table public.patient_portability_snapshots enable row level security;
alter table public.patient_access_grants enable row level security;

drop policy if exists patient_portability_requests_clinic_admin_rw on public.patient_portability_requests;
create policy patient_portability_requests_clinic_admin_rw
on public.patient_portability_requests
for all
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = patient_portability_requests.organization_id_requesting or u.id = patient_portability_requests.organization_id_requesting)
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = patient_portability_requests.organization_id_requesting or u.id = patient_portability_requests.organization_id_requesting)
  )
);

drop policy if exists patient_portability_requests_responsible_read_update on public.patient_portability_requests;
create policy patient_portability_requests_responsible_read_update
on public.patient_portability_requests
for update
using (responsible_user_id = auth.uid())
with check (responsible_user_id = auth.uid());

drop policy if exists patient_portability_requests_responsible_select on public.patient_portability_requests;
create policy patient_portability_requests_responsible_select
on public.patient_portability_requests
for select
using (responsible_user_id = auth.uid());

drop policy if exists patient_portability_snapshots_clinic_rw on public.patient_portability_snapshots;
create policy patient_portability_snapshots_clinic_rw
on public.patient_portability_snapshots
for all
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (
        u.clinic_id = patient_portability_snapshots.organization_id_source
        or u.clinic_id = patient_portability_snapshots.organization_id_target
        or u.id = patient_portability_snapshots.organization_id_source
        or u.id = patient_portability_snapshots.organization_id_target
      )
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (
        u.clinic_id = patient_portability_snapshots.organization_id_source
        or u.clinic_id = patient_portability_snapshots.organization_id_target
        or u.id = patient_portability_snapshots.organization_id_source
        or u.id = patient_portability_snapshots.organization_id_target
      )
  )
);

drop policy if exists patient_access_grants_clinic_rw on public.patient_access_grants;
create policy patient_access_grants_clinic_rw
on public.patient_access_grants
for all
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = patient_access_grants.organization_id or u.id = patient_access_grants.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = patient_access_grants.organization_id or u.id = patient_access_grants.organization_id)
  )
);
