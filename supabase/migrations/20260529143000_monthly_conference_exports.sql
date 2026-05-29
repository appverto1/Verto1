-- Monthly operational conference export audit trail.

create extension if not exists pgcrypto;

create table if not exists public.operational_closure_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  export_type text not null,
  filters jsonb not null default '{}'::jsonb,
  generated_by uuid,
  generated_at timestamptz not null default now(),
  file_path text,
  row_count integer,
  status text not null default 'GENERATED',
  metadata jsonb not null default '{}'::jsonb
);

alter table public.operational_closure_exports
  add column if not exists organization_id uuid,
  add column if not exists export_type text not null default 'sessions',
  add column if not exists filters jsonb not null default '{}'::jsonb,
  add column if not exists generated_by uuid,
  add column if not exists generated_at timestamptz not null default now(),
  add column if not exists file_path text,
  add column if not exists row_count integer,
  add column if not exists status text not null default 'GENERATED',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.operational_closure_exports
  drop constraint if exists operational_closure_exports_status_check;

alter table public.operational_closure_exports
  add constraint operational_closure_exports_status_check
  check (status in ('GENERATED', 'FAILED', 'EXPIRED'));

alter table public.appointment_closure_audit_logs
  drop constraint if exists appointment_closure_audit_logs_action_check;

alter table public.appointment_closure_audit_logs
  add constraint appointment_closure_audit_logs_action_check
  check (action in (
    'CHECK_GENERATED',
    'CHECK_REGENERATED',
    'ISSUE_RESOLVED',
    'STATUS_CHANGED',
    'MANUAL_OVERRIDE',
    'MARKED_NOT_BILLABLE',
    'VIEWED_DETAIL',
    'EXPORTED',
    'CONFERENCE_VIEWED',
    'CONFERENCE_FILTERED',
    'EXPORT_GENERATED',
    'EXPORT_FAILED',
    'SESSION_DETAIL_VIEWED',
    'CHECKLIST_OPENED',
    'REVALIDATED_FROM_CONFERENCE'
  ));

create index if not exists idx_operational_closure_exports_scope
  on public.operational_closure_exports (organization_id, generated_at desc);

alter table public.operational_closure_exports enable row level security;

drop policy if exists operational_closure_exports_admin_rw on public.operational_closure_exports;
create policy operational_closure_exports_admin_rw
on public.operational_closure_exports
for all
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = operational_closure_exports.organization_id or u.id = operational_closure_exports.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = operational_closure_exports.organization_id or u.id = operational_closure_exports.organization_id)
  )
);
