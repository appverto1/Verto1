-- Secure appointment responses and responsible session acceptance.
-- Additive: actions happen inside the authenticated app, with audit logs and closure revalidation support.

create extension if not exists pgcrypto;

alter table if exists public.appointments
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by text,
  add column if not exists confirmed_by_role text,
  add column if not exists reschedule_requested_at timestamptz,
  add column if not exists reschedule_requested_by text,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancel_requested_by text,
  add column if not exists rescheduled_from_id uuid references public.appointments(id) on delete set null;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'appointments'
  ) then
    alter table public.appointments
      drop constraint if exists appointments_status_check;

    alter table public.appointments
      add constraint appointments_status_check
      check (status in (
        'scheduled',
        'pending',
        'confirmed',
        'in_progress',
        'cancelled',
        'canceled',
        'completed',
        'no_show',
        'missed',
        'deleted',
        'rescheduled',
        'reschedule',
        'SCHEDULED',
        'PENDING_CONFIRMATION',
        'CONFIRMED',
        'RESCHEDULE_REQUESTED',
        'RESCHEDULED',
        'CANCEL_REQUESTED',
        'CANCELLED',
        'IN_PROGRESS',
        'COMPLETED',
        'NO_SHOW'
      ));
  end if;
end $$;

create table if not exists public.appointment_action_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  requested_by text,
  request_type text not null
    check (request_type in ('RESCHEDULE', 'CANCEL')),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_start timestamptz,
  requested_end timestamptz,
  reason text,
  note text,
  resolved_by text,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.appointment_action_requests
  add column if not exists organization_id uuid,
  add column if not exists appointment_id uuid references public.appointments(id) on delete cascade,
  add column if not exists patient_id uuid references public.patients(id) on delete cascade,
  add column if not exists requested_by text,
  add column if not exists request_type text,
  add column if not exists status text not null default 'PENDING',
  add column if not exists requested_start timestamptz,
  add column if not exists requested_end timestamptz,
  add column if not exists reason text,
  add column if not exists note text,
  add column if not exists resolved_by text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_note text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.session_signatures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  aba_session_id text,
  signed_by_user_id text,
  signed_by_name text not null,
  signed_by_role text,
  signature_type text not null
    check (signature_type in ('DIGITAL_ACCEPTANCE', 'DRAWN_SIGNATURE')),
  signature_storage_path text,
  signature_hash text,
  ip_hash text,
  user_agent_hash text,
  consent_text_version text not null,
  consent_text text not null,
  signed_at timestamptz not null default now(),
  status text not null default 'SIGNED'
    check (status in ('SIGNED', 'REVOKED')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.session_signatures
  add column if not exists organization_id uuid,
  add column if not exists patient_id uuid references public.patients(id) on delete cascade,
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null,
  add column if not exists aba_session_id text,
  add column if not exists signed_by_user_id text,
  add column if not exists signed_by_name text,
  add column if not exists signed_by_role text,
  add column if not exists signature_type text,
  add column if not exists signature_storage_path text,
  add column if not exists signature_hash text,
  add column if not exists ip_hash text,
  add column if not exists user_agent_hash text,
  add column if not exists consent_text_version text,
  add column if not exists consent_text text,
  add column if not exists signed_at timestamptz not null default now(),
  add column if not exists status text not null default 'SIGNED',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.appointment_status_audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  action text not null
    check (action in (
      'CONFIRMED_BY_RESPONSIBLE',
      'RESCHEDULE_REQUESTED',
      'RESCHEDULE_APPROVED',
      'RESCHEDULE_REJECTED',
      'CANCEL_REQUESTED',
      'CANCEL_APPROVED',
      'CANCEL_REJECTED',
      'CANCELLED',
      'SIGNATURE_CREATED',
      'SIGNATURE_REVOKED'
    )),
  previous_status text,
  new_status text,
  performed_by text,
  performed_by_role text,
  performed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.appointment_status_audit_logs
  add column if not exists organization_id uuid,
  add column if not exists appointment_id uuid references public.appointments(id) on delete cascade,
  add column if not exists patient_id uuid references public.patients(id) on delete set null,
  add column if not exists action text,
  add column if not exists previous_status text,
  add column if not exists new_status text,
  add column if not exists performed_by text,
  add column if not exists performed_by_role text,
  add column if not exists performed_at timestamptz not null default now(),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_appointment_action_requests_appointment_status
  on public.appointment_action_requests (organization_id, appointment_id, status);

create index if not exists idx_appointment_action_requests_patient_status_created
  on public.appointment_action_requests (organization_id, patient_id, status, created_at);

create unique index if not exists idx_appointment_action_requests_active_unique
  on public.appointment_action_requests (organization_id, appointment_id, request_type)
  where status = 'PENDING';

create index if not exists idx_session_signatures_appointment_status
  on public.session_signatures (organization_id, appointment_id, status);

create index if not exists idx_session_signatures_aba_session_status
  on public.session_signatures (organization_id, aba_session_id, status);

create unique index if not exists idx_session_signatures_active_appointment_actor
  on public.session_signatures (
    organization_id,
    appointment_id,
    coalesce(aba_session_id, ''),
    coalesce(signed_by_user_id, ''),
    status
  )
  where status = 'SIGNED' and appointment_id is not null;

create unique index if not exists idx_session_signatures_active_session_actor
  on public.session_signatures (
    organization_id,
    aba_session_id,
    coalesce(signed_by_user_id, ''),
    status
  )
  where status = 'SIGNED' and aba_session_id is not null;

create index if not exists idx_appointment_status_audit_logs_appointment_performed
  on public.appointment_status_audit_logs (organization_id, appointment_id, performed_at);

alter table public.appointment_action_requests enable row level security;
alter table public.session_signatures enable row level security;
alter table public.appointment_status_audit_logs enable row level security;

drop policy if exists appointment_action_requests_clinic_or_actor_rw on public.appointment_action_requests;
create policy appointment_action_requests_clinic_or_actor_rw
on public.appointment_action_requests
for all
to authenticated
using (
  requested_by = auth.uid()::text
  or exists (
    select 1
    from public.users u
    left join public.patients p on p.id = appointment_action_requests.patient_id
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist')
      and (
        (u.role in ('owner', 'admin', 'coordinator') and u.clinic_id = appointment_action_requests.organization_id)
        or (u.role = 'therapist' and u.clinic_id = appointment_action_requests.organization_id and p.therapist_id = auth.uid())
      )
  )
)
with check (
  requested_by = auth.uid()::text
  or exists (
    select 1
    from public.users u
    left join public.patients p on p.id = appointment_action_requests.patient_id
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist')
      and (
        (u.role in ('owner', 'admin', 'coordinator') and u.clinic_id = appointment_action_requests.organization_id)
        or (u.role = 'therapist' and u.clinic_id = appointment_action_requests.organization_id and p.therapist_id = auth.uid())
      )
  )
);

drop policy if exists session_signatures_clinic_or_actor_rw on public.session_signatures;
create policy session_signatures_clinic_or_actor_rw
on public.session_signatures
for all
to authenticated
using (
  signed_by_user_id = auth.uid()::text
  or exists (
    select 1
    from public.users u
    left join public.patients p on p.id = session_signatures.patient_id
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist')
      and (
        (u.role in ('owner', 'admin', 'coordinator') and u.clinic_id = session_signatures.organization_id)
        or (u.role = 'therapist' and u.clinic_id = session_signatures.organization_id and p.therapist_id = auth.uid())
      )
  )
)
with check (
  signed_by_user_id = auth.uid()::text
  or exists (
    select 1
    from public.users u
    left join public.patients p on p.id = session_signatures.patient_id
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist')
      and (
        (u.role in ('owner', 'admin', 'coordinator') and u.clinic_id = session_signatures.organization_id)
        or (u.role = 'therapist' and u.clinic_id = session_signatures.organization_id and p.therapist_id = auth.uid())
      )
  )
);

drop policy if exists appointment_status_audit_logs_clinic_or_actor_read on public.appointment_status_audit_logs;
create policy appointment_status_audit_logs_clinic_or_actor_read
on public.appointment_status_audit_logs
for select
to authenticated
using (
  performed_by = auth.uid()::text
  or exists (
    select 1
    from public.users u
    left join public.patients p on p.id = appointment_status_audit_logs.patient_id
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist')
      and (
        (u.role in ('owner', 'admin', 'coordinator') and u.clinic_id = appointment_status_audit_logs.organization_id)
        or (u.role = 'therapist' and u.clinic_id = appointment_status_audit_logs.organization_id and p.therapist_id = auth.uid())
      )
  )
);

drop policy if exists appointment_status_audit_logs_clinic_or_actor_insert on public.appointment_status_audit_logs;
create policy appointment_status_audit_logs_clinic_or_actor_insert
on public.appointment_status_audit_logs
for insert
to authenticated
with check (
  performed_by = auth.uid()::text
  or exists (
    select 1
    from public.users u
    left join public.patients p on p.id = appointment_status_audit_logs.patient_id
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist')
      and (
        (u.role in ('owner', 'admin', 'coordinator') and u.clinic_id = appointment_status_audit_logs.organization_id)
        or (u.role = 'therapist' and u.clinic_id = appointment_status_audit_logs.organization_id and p.therapist_id = auth.uid())
      )
  )
);
