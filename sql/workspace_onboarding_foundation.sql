-- Workspace + Onboarding foundation
-- Execute in Supabase SQL editor before using onboarding/invitations/workspaces.

create extension if not exists pgcrypto;

create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references public.users(id) on delete set null,
  name text not null default 'Minha Clinica',
  logo_url text,
  phone_commercial text,
  session_duration_minutes int not null default 50,
  specialty text,
  council text,
  council_number text,
  signature_data_url text,
  country_code text,
  address jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clinic_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  role text not null check (role in ('coordinator', 'therapist', 'receptionist')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  invited_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, clinic_id)
);

create index if not exists idx_clinic_memberships_clinic on public.clinic_memberships(clinic_id);
create index if not exists idx_clinic_memberships_user on public.clinic_memberships(user_id);

create table if not exists public.professional_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  full_name text,
  birth_date date,
  gender text,
  country_code text,
  phone text,
  profile_photo_url text,
  clinic_name text,
  clinic_logo_url text,
  clinic_phone text,
  specialty text,
  council text,
  council_number text,
  signature_data_url text,
  requires_onboarding boolean not null default true,
  onboarding_completed_at timestamptz,
  address jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clinics enable row level security;
alter table public.clinic_memberships enable row level security;
alter table public.professional_profiles enable row level security;

drop policy if exists clinics_access on public.clinics;
create policy clinics_access
on public.clinics
for all
to authenticated
using (
  exists (
    select 1
    from public.clinic_memberships cm
    where cm.clinic_id = clinics.id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.clinic_memberships cm
    where cm.clinic_id = clinics.id
      and cm.user_id = auth.uid()
      and cm.role = 'coordinator'
      and cm.status = 'active'
  )
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin')
  )
);

drop policy if exists clinic_memberships_access on public.clinic_memberships;
create policy clinic_memberships_access
on public.clinic_memberships
for all
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.clinic_memberships cm2
    where cm2.clinic_id = clinic_memberships.clinic_id
      and cm2.user_id = auth.uid()
      and cm2.role = 'coordinator'
      and cm2.status = 'active'
  )
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin')
  )
)
with check (
  user_id = auth.uid()
  or exists (
    select 1
    from public.clinic_memberships cm2
    where cm2.clinic_id = clinic_memberships.clinic_id
      and cm2.user_id = auth.uid()
      and cm2.role = 'coordinator'
      and cm2.status = 'active'
  )
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin')
  )
);

drop policy if exists professional_profiles_access on public.professional_profiles;
create policy professional_profiles_access
on public.professional_profiles
for all
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin')
  )
)
with check (
  user_id = auth.uid()
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin')
  )
);

alter table public.invitations
  add column if not exists required_onboarding_fields jsonb not null default '{}'::jsonb;

