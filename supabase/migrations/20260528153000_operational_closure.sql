-- Operational closure / pre-billing readiness.
-- Additive only: persisted read model used by the closure center and agenda badges.

create extension if not exists pgcrypto;

create table if not exists public.appointment_closure_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  appointment_id uuid references public.appointments(id) on delete cascade,
  aba_session_id text,
  patient_id uuid references public.patients(id) on delete cascade,
  professional_id uuid,
  service_type text,
  readiness_status text not null default 'UNKNOWN',
  checklist jsonb not null default '[]'::jsonb,
  blocking_issues_count integer not null default 0,
  warning_issues_count integer not null default 0,
  missing_required_count integer not null default 0,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  scheduled_minutes integer,
  actual_minutes integer,
  main_issues jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  generated_by uuid,
  updated_at timestamptz not null default now(),
  context_hash text not null default ''
);

alter table public.appointment_closure_checks
  add column if not exists organization_id uuid,
  add column if not exists appointment_id uuid references public.appointments(id) on delete cascade,
  add column if not exists aba_session_id text,
  add column if not exists patient_id uuid references public.patients(id) on delete cascade,
  add column if not exists professional_id uuid,
  add column if not exists service_type text,
  add column if not exists readiness_status text not null default 'UNKNOWN',
  add column if not exists checklist jsonb not null default '[]'::jsonb,
  add column if not exists blocking_issues_count integer not null default 0,
  add column if not exists warning_issues_count integer not null default 0,
  add column if not exists missing_required_count integer not null default 0,
  add column if not exists scheduled_start timestamptz,
  add column if not exists scheduled_end timestamptz,
  add column if not exists actual_start timestamptz,
  add column if not exists actual_end timestamptz,
  add column if not exists scheduled_minutes integer,
  add column if not exists actual_minutes integer,
  add column if not exists main_issues jsonb not null default '[]'::jsonb,
  add column if not exists generated_at timestamptz not null default now(),
  add column if not exists generated_by uuid,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists context_hash text not null default '';

do $$
begin
  alter table public.appointment_closure_checks
    add constraint appointment_closure_checks_status_check
    check (readiness_status in ('READY','PENDING','WARNING','NOT_BILLABLE','DRAFT','UNKNOWN'));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.appointment_closure_audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  appointment_id uuid references public.appointments(id) on delete set null,
  aba_session_id text,
  patient_id uuid references public.patients(id) on delete set null,
  action text not null,
  previous_status text,
  new_status text,
  performed_by uuid,
  performed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.appointment_closure_audit_logs
  add column if not exists organization_id uuid,
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null,
  add column if not exists aba_session_id text,
  add column if not exists patient_id uuid references public.patients(id) on delete set null,
  add column if not exists action text not null default 'CHECK_GENERATED',
  add column if not exists previous_status text,
  add column if not exists new_status text,
  add column if not exists performed_by uuid,
  add column if not exists performed_at timestamptz not null default now(),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
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
      'EXPORTED'
    ));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.clinic_closure_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  service_type text,
  payer_type text,
  require_signature boolean not null default true,
  require_report boolean not null default true,
  require_actual_duration boolean not null default true,
  min_duration_minutes integer,
  max_duration_variance_minutes integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clinic_closure_requirements
  add column if not exists organization_id uuid,
  add column if not exists service_type text,
  add column if not exists payer_type text,
  add column if not exists require_signature boolean not null default true,
  add column if not exists require_report boolean not null default true,
  add column if not exists require_actual_duration boolean not null default true,
  add column if not exists min_duration_minutes integer,
  add column if not exists max_duration_variance_minutes integer,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_appointment_closure_checks_appointment_unique
  on public.appointment_closure_checks(organization_id, appointment_id);

create unique index if not exists idx_appointment_closure_checks_aba_session_unique
  on public.appointment_closure_checks(organization_id, aba_session_id);

create index if not exists idx_appointment_closure_checks_status_generated
  on public.appointment_closure_checks(organization_id, readiness_status, generated_at);

create index if not exists idx_appointment_closure_checks_patient_generated
  on public.appointment_closure_checks(organization_id, patient_id, generated_at);

create index if not exists idx_appointment_closure_checks_professional_generated
  on public.appointment_closure_checks(organization_id, professional_id, generated_at);

create index if not exists idx_appointment_closure_checks_appointment
  on public.appointment_closure_checks(organization_id, appointment_id);

create index if not exists idx_appointment_closure_checks_aba_session
  on public.appointment_closure_checks(organization_id, aba_session_id);

create index if not exists idx_appointment_closure_audit_scope
  on public.appointment_closure_audit_logs(organization_id, performed_at desc);

create index if not exists idx_clinic_closure_requirements_scope
  on public.clinic_closure_requirements(organization_id, is_active, service_type, payer_type);

create index if not exists idx_appointments_closure_window
  on public.appointments(organization_id, scheduled_at, scheduled_end_at, status);

alter table public.appointment_closure_checks enable row level security;
alter table public.appointment_closure_audit_logs enable row level security;
alter table public.clinic_closure_requirements enable row level security;

drop policy if exists appointment_closure_checks_clinic_scope_rw on public.appointment_closure_checks;
create policy appointment_closure_checks_clinic_scope_rw
on public.appointment_closure_checks
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    left join public.patients p on p.id = appointment_closure_checks.patient_id
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist')
      and (
        (u.role in ('owner', 'admin', 'coordinator')
          and (u.clinic_id = appointment_closure_checks.organization_id or u.id = appointment_closure_checks.organization_id))
        or
        (u.role = 'therapist'
          and u.clinic_id = appointment_closure_checks.organization_id
          and (
            p.therapist_id = auth.uid()
            or appointment_closure_checks.professional_id = auth.uid()
          ))
      )
  )
)
with check (
  exists (
    select 1
    from public.users u
    left join public.patients p on p.id = appointment_closure_checks.patient_id
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist')
      and (
        (u.role in ('owner', 'admin', 'coordinator')
          and (u.clinic_id = appointment_closure_checks.organization_id or u.id = appointment_closure_checks.organization_id))
        or
        (u.role = 'therapist'
          and u.clinic_id = appointment_closure_checks.organization_id
          and (
            p.therapist_id = auth.uid()
            or appointment_closure_checks.professional_id = auth.uid()
          ))
      )
  )
);

drop policy if exists appointment_closure_audit_logs_clinic_scope_rw on public.appointment_closure_audit_logs;
create policy appointment_closure_audit_logs_clinic_scope_rw
on public.appointment_closure_audit_logs
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    left join public.patients p on p.id = appointment_closure_audit_logs.patient_id
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist')
      and (
        (u.role in ('owner', 'admin', 'coordinator')
          and (u.clinic_id = appointment_closure_audit_logs.organization_id or u.id = appointment_closure_audit_logs.organization_id))
        or
        (u.role = 'therapist'
          and u.clinic_id = appointment_closure_audit_logs.organization_id
          and p.therapist_id = auth.uid())
      )
  )
)
with check (
  exists (
    select 1
    from public.users u
    left join public.patients p on p.id = appointment_closure_audit_logs.patient_id
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist')
      and (
        (u.role in ('owner', 'admin', 'coordinator')
          and (u.clinic_id = appointment_closure_audit_logs.organization_id or u.id = appointment_closure_audit_logs.organization_id))
        or
        (u.role = 'therapist'
          and u.clinic_id = appointment_closure_audit_logs.organization_id
          and p.therapist_id = auth.uid())
      )
  )
);

drop policy if exists clinic_closure_requirements_admin_rw on public.clinic_closure_requirements;
create policy clinic_closure_requirements_admin_rw
on public.clinic_closure_requirements
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = clinic_closure_requirements.organization_id or u.id = clinic_closure_requirements.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = clinic_closure_requirements.organization_id or u.id = clinic_closure_requirements.organization_id)
  )
);
