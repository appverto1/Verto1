-- Individual appointment status for monthly pre-billing conference.
-- Additive only. This does not implement TISS/TUSS, XML exports, remittance, denial handling or payer integrations.

create extension if not exists pgcrypto;

create table if not exists public.appointment_conference_statuses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  payer_id uuid references public.clinic_payers(id) on delete set null,
  competence_month date not null,
  status text not null default 'pending_review',
  reviewed_by uuid,
  reviewed_at timestamptz,
  exported_by uuid,
  exported_at timestamptz,
  export_id uuid references public.operational_closure_exports(id) on delete set null,
  reopened_by uuid,
  reopened_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.appointment_conference_statuses
  add column if not exists organization_id uuid,
  add column if not exists appointment_id uuid references public.appointments(id) on delete cascade,
  add column if not exists patient_id uuid references public.patients(id) on delete set null,
  add column if not exists payer_id uuid references public.clinic_payers(id) on delete set null,
  add column if not exists competence_month date not null default date_trunc('month', now())::date,
  add column if not exists status text not null default 'pending_review',
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists exported_by uuid,
  add column if not exists exported_at timestamptz,
  add column if not exists export_id uuid references public.operational_closure_exports(id) on delete set null,
  add column if not exists reopened_by uuid,
  add column if not exists reopened_at timestamptz,
  add column if not exists reason text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.appointment_conference_statuses
  drop constraint if exists appointment_conference_statuses_status_check;

alter table public.appointment_conference_statuses
  add constraint appointment_conference_statuses_status_check
  check (status in ('pending_review', 'reviewed', 'exported', 'reopened', 'non_billable'));

create unique index if not exists idx_appointment_conference_statuses_unique
  on public.appointment_conference_statuses (organization_id, appointment_id, competence_month);

create index if not exists idx_appointment_conference_statuses_competence_status
  on public.appointment_conference_statuses (organization_id, competence_month, status);

create index if not exists idx_appointment_conference_statuses_appointment
  on public.appointment_conference_statuses (appointment_id);

create index if not exists idx_appointment_conference_statuses_patient
  on public.appointment_conference_statuses (organization_id, patient_id, competence_month);

create index if not exists idx_appointment_conference_statuses_payer
  on public.appointment_conference_statuses (organization_id, payer_id, competence_month);

create index if not exists idx_appointment_conference_statuses_export
  on public.appointment_conference_statuses (organization_id, export_id)
  where export_id is not null;

alter table public.appointment_conference_statuses enable row level security;

drop policy if exists appointment_conference_statuses_admin_rw on public.appointment_conference_statuses;
create policy appointment_conference_statuses_admin_rw
on public.appointment_conference_statuses
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = appointment_conference_statuses.organization_id or u.id = appointment_conference_statuses.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = appointment_conference_statuses.organization_id or u.id = appointment_conference_statuses.organization_id)
  )
);

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
    'REVALIDATED_FROM_CONFERENCE',
    'CONFERENCE_STATUS_REVIEWED',
    'CONFERENCE_STATUS_EXPORTED',
    'CONFERENCE_STATUS_REOPENED'
  ));
