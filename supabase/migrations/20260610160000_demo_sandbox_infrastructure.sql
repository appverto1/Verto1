-- Demo/sandbox infrastructure. Additive only; no production data is deleted.

alter table public.clinics
  add column if not exists billing_model text,
  add column if not exists is_demo boolean not null default false,
  add column if not exists demo_template_id text,
  add column if not exists demo_expires_at timestamptz,
  add column if not exists demo_reset_at timestamptz,
  add column if not exists demo_owner_user_id text,
  add column if not exists demo_source text check (demo_source is null or demo_source in ('template', 'prospect', 'presentation')),
  add column if not exists demo_status text not null default 'active' check (demo_status in ('active', 'expired', 'archived')),
  add column if not exists demo_notes text;

alter table public.users
  add column if not exists billing_model text,
  add column if not exists is_demo_user boolean not null default false,
  add column if not exists demo_role text,
  add column if not exists demo_expires_at timestamptz;

alter table public.patients
  add column if not exists is_demo boolean not null default false;

create table if not exists public.demo_sandbox_audit_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id text not null,
  actor_user_id text,
  action text not null,
  status text not null default 'success',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.demo_sandbox_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id text not null unique,
  name text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  seed_version text not null default '2026-06-demo-v1',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clinics_demo_status
  on public.clinics (is_demo, demo_status, demo_expires_at);

create index if not exists idx_users_demo_user
  on public.users (is_demo_user, demo_expires_at);

create index if not exists idx_patients_is_demo_clinic
  on public.patients (is_demo, clinic_id);

create index if not exists idx_demo_sandbox_audit_logs_clinic
  on public.demo_sandbox_audit_logs (clinic_id, created_at desc);

alter table public.demo_sandbox_audit_logs enable row level security;
alter table public.demo_sandbox_templates enable row level security;

drop policy if exists demo_sandbox_audit_logs_admin_read on public.demo_sandbox_audit_logs;
create policy demo_sandbox_audit_logs_admin_read
on public.demo_sandbox_audit_logs
for select
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('admin', 'owner')
  )
);

drop policy if exists demo_sandbox_templates_admin_read on public.demo_sandbox_templates;
create policy demo_sandbox_templates_admin_read
on public.demo_sandbox_templates
for select
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('admin', 'owner')
  )
);
