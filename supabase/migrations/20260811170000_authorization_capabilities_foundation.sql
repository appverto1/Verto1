-- Verto authorization foundation v1
-- Additive foundation for role presets + per-membership permission overrides.
-- Existing patient/clinical data is not required for this migration.

begin;

-- Allow the new clinic-scoped base roles without turning them into platform roles.
do $role_constraint$
declare
  item record;
begin
  for item in
    select conname
    from pg_catalog.pg_constraint
    where conrelid = 'public.clinic_memberships'::regclass
      and contype = 'c'
      and pg_catalog.pg_get_constraintdef(oid) ilike '%role%'
      and pg_catalog.pg_get_constraintdef(oid) ilike '%coordinator%'
      and pg_catalog.pg_get_constraintdef(oid) ilike '%therapist%'
      and pg_catalog.pg_get_constraintdef(oid) ilike '%receptionist%'
  loop
    execute format('alter table public.clinic_memberships drop constraint %I', item.conname);
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.clinic_memberships'::regclass
      and conname = 'clinic_memberships_role_v2'
  ) then
    alter table public.clinic_memberships
      add constraint clinic_memberships_role_v2
      check (role in ('director', 'coordinator', 'supervisor', 'therapist', 'receptionist', 'biller'));
  end if;
end;
$role_constraint$;

create table if not exists public.clinic_membership_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.clinic_memberships(id) on delete cascade,
  permission_key text not null,
  effect text not null check (effect in ('allow', 'deny')),
  granted_by uuid references public.users(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (membership_id, permission_key)
);

create index if not exists idx_membership_permission_overrides_membership
  on public.clinic_membership_permission_overrides(membership_id);

create table if not exists public.clinical_supervision_links (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  supervisor_user_id uuid not null references public.users(id) on delete cascade,
  supervised_user_id uuid references public.users(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'ended')),
  starts_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (supervised_user_id is not null or patient_id is not null),
  check (ended_at is null or ended_at >= starts_at)
);

create index if not exists idx_clinical_supervision_links_supervisor
  on public.clinical_supervision_links(clinic_id, supervisor_user_id, status);
create index if not exists idx_clinical_supervision_links_professional
  on public.clinical_supervision_links(clinic_id, supervised_user_id, status)
  where supervised_user_id is not null;
create index if not exists idx_clinical_supervision_links_patient
  on public.clinical_supervision_links(clinic_id, patient_id, status)
  where patient_id is not null;

create table if not exists public.external_organizations (
  id uuid primary key default gen_random_uuid(),
  organization_type text not null check (organization_type in ('billing_company')),
  legal_name text not null,
  display_name text,
  document_number text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.external_organization_users (
  id uuid primary key default gen_random_uuid(),
  external_organization_id uuid not null references public.external_organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (external_organization_id, user_id)
);

create table if not exists public.external_organization_clinic_links (
  id uuid primary key default gen_random_uuid(),
  external_organization_id uuid not null references public.external_organizations(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'inactive')),
  granted_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (external_organization_id, clinic_id)
);

create index if not exists idx_external_org_clinic_links_clinic
  on public.external_organization_clinic_links(clinic_id, status);

create table if not exists public.authorization_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id) on delete set null,
  target_user_id uuid references public.users(id) on delete set null,
  clinic_id uuid references public.clinics(id) on delete set null,
  external_organization_id uuid references public.external_organizations(id) on delete set null,
  event_type text not null,
  permission_key text,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_authorization_audit_events_clinic_created
  on public.authorization_audit_events(clinic_id, created_at desc);
create index if not exists idx_authorization_audit_events_target_created
  on public.authorization_audit_events(target_user_id, created_at desc);

-- These tables are server-managed in v1. Direct authenticated access stays closed.
alter table public.clinic_membership_permission_overrides enable row level security;
alter table public.clinical_supervision_links enable row level security;
alter table public.external_organizations enable row level security;
alter table public.external_organization_users enable row level security;
alter table public.external_organization_clinic_links enable row level security;
alter table public.authorization_audit_events enable row level security;

comment on table public.clinic_membership_permission_overrides is
  'Per-workspace capability overrides. Role defaults remain defined by the application authorization catalog.';
comment on table public.clinical_supervision_links is
  'Explicit supervision scope by professional and/or patient. It never grants tenant-global access.';
comment on table public.external_organizations is
  'External service providers such as billing companies. Their users still require explicit clinic authorization.';
comment on table public.authorization_audit_events is
  'Append-only audit trail for authorization and delegation changes.';

commit;
