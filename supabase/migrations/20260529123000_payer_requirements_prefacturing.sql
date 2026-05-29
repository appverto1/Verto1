-- Payer/insurance requirements for operational pre-billing readiness.
-- Additive only. This does not implement TISS/TUSS, XML exports or external billing integrations.

create extension if not exists pgcrypto;

create table if not exists public.clinic_payers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  payer_type text not null default 'PRIVATE'
    check (payer_type in ('INSURANCE', 'PRIVATE', 'PUBLIC', 'COURTESY', 'OTHER')),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'INACTIVE')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clinic_payers
  add column if not exists organization_id uuid,
  add column if not exists name text,
  add column if not exists payer_type text not null default 'PRIVATE',
  add column if not exists status text not null default 'ACTIVE',
  add column if not exists notes text,
  add column if not exists created_by uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.clinic_payer_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  payer_id uuid not null references public.clinic_payers(id) on delete cascade,
  service_type text,
  require_signature boolean not null default true,
  require_report boolean not null default true,
  require_actual_duration boolean not null default true,
  require_authorization boolean not null default false,
  require_guide boolean not null default false,
  require_professional_registry boolean not null default false,
  require_patient_document boolean not null default false,
  min_duration_minutes integer,
  max_duration_variance_minutes integer,
  allow_manual_override boolean not null default true,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clinic_payer_requirements
  add column if not exists organization_id uuid,
  add column if not exists payer_id uuid references public.clinic_payers(id) on delete cascade,
  add column if not exists service_type text,
  add column if not exists require_signature boolean not null default true,
  add column if not exists require_report boolean not null default true,
  add column if not exists require_actual_duration boolean not null default true,
  add column if not exists require_authorization boolean not null default false,
  add column if not exists require_guide boolean not null default false,
  add column if not exists require_professional_registry boolean not null default false,
  add column if not exists require_patient_document boolean not null default false,
  add column if not exists min_duration_minutes integer,
  add column if not exists max_duration_variance_minutes integer,
  add column if not exists allow_manual_override boolean not null default true,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_by uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.appointment_billing_contexts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  payer_id uuid references public.clinic_payers(id) on delete set null,
  payer_name_snapshot text,
  service_type text,
  authorization_code text,
  guide_number text,
  procedure_code text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.appointment_billing_contexts
  add column if not exists organization_id uuid,
  add column if not exists appointment_id uuid references public.appointments(id) on delete cascade,
  add column if not exists patient_id uuid references public.patients(id) on delete cascade,
  add column if not exists payer_id uuid references public.clinic_payers(id) on delete set null,
  add column if not exists payer_name_snapshot text,
  add column if not exists service_type text,
  add column if not exists authorization_code text,
  add column if not exists guide_number text,
  add column if not exists procedure_code text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.appointment_required_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  appointment_id uuid references public.appointments(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  document_type text not null
    check (document_type in ('SIGNATURE', 'SESSION_REPORT', 'AUTHORIZATION', 'GUIDE', 'PATIENT_DOCUMENT', 'PROFESSIONAL_DOCUMENT', 'OTHER')),
  status text not null default 'PENDING'
    check (status in ('REQUIRED', 'PENDING', 'PROVIDED', 'WAIVED', 'EXPIRED', 'NOT_APPLICABLE')),
  file_id text,
  required_by_payer_id uuid references public.clinic_payers(id) on delete set null,
  required_for_service_type text,
  due_date timestamptz,
  uploaded_at timestamptz,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.appointment_required_documents
  add column if not exists organization_id uuid,
  add column if not exists appointment_id uuid references public.appointments(id) on delete cascade,
  add column if not exists patient_id uuid references public.patients(id) on delete cascade,
  add column if not exists document_type text,
  add column if not exists status text not null default 'PENDING',
  add column if not exists file_id text,
  add column if not exists required_by_payer_id uuid references public.clinic_payers(id) on delete set null,
  add column if not exists required_for_service_type text,
  add column if not exists due_date timestamptz,
  add column if not exists uploaded_at timestamptz,
  add column if not exists uploaded_by uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.payer_requirement_audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  payer_id uuid references public.clinic_payers(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  action text not null
    check (action in (
      'PAYER_CREATED',
      'PAYER_UPDATED',
      'REQUIREMENT_CREATED',
      'REQUIREMENT_UPDATED',
      'REQUIREMENT_DISABLED',
      'BILLING_CONTEXT_UPDATED',
      'DOCUMENT_REQUIRED',
      'DOCUMENT_PROVIDED',
      'DOCUMENT_WAIVED'
    )),
  previous_value jsonb,
  new_value jsonb,
  performed_by uuid,
  performed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.payer_requirement_audit_logs
  add column if not exists organization_id uuid,
  add column if not exists payer_id uuid references public.clinic_payers(id) on delete set null,
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null,
  add column if not exists action text,
  add column if not exists previous_value jsonb,
  add column if not exists new_value jsonb,
  add column if not exists performed_by uuid,
  add column if not exists performed_at timestamptz not null default now(),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.appointment_closure_checks
  add column if not exists payer_id uuid references public.clinic_payers(id) on delete set null,
  add column if not exists payer_name_snapshot text,
  add column if not exists authorization_code text,
  add column if not exists guide_number text,
  add column if not exists applied_payer_requirement_id uuid,
  add column if not exists payer_requirement_source text,
  add column if not exists required_document_pending_count integer not null default 0;

create unique index if not exists idx_clinic_payers_unique_active_name
  on public.clinic_payers (organization_id, lower(name))
  where status = 'ACTIVE';

create index if not exists idx_clinic_payers_scope_status_name
  on public.clinic_payers (organization_id, status, name);

create index if not exists idx_clinic_payer_requirements_scope
  on public.clinic_payer_requirements (organization_id, payer_id, service_type, is_active);

create unique index if not exists idx_clinic_payer_requirements_active_unique
  on public.clinic_payer_requirements (organization_id, payer_id, coalesce(service_type, ''))
  where is_active = true;

create unique index if not exists idx_appointment_billing_contexts_appointment
  on public.appointment_billing_contexts (organization_id, appointment_id);

create index if not exists idx_appointment_billing_contexts_payer
  on public.appointment_billing_contexts (organization_id, payer_id);

create index if not exists idx_appointment_required_documents_status
  on public.appointment_required_documents (organization_id, appointment_id, status);

create index if not exists idx_payer_requirement_audit_logs_scope
  on public.payer_requirement_audit_logs (organization_id, payer_id, performed_at);

alter table public.clinic_payers enable row level security;
alter table public.clinic_payer_requirements enable row level security;
alter table public.appointment_billing_contexts enable row level security;
alter table public.appointment_required_documents enable row level security;
alter table public.payer_requirement_audit_logs enable row level security;

drop policy if exists clinic_payers_admin_rw on public.clinic_payers;
create policy clinic_payers_admin_rw
on public.clinic_payers
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and u.clinic_id = clinic_payers.organization_id
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and u.clinic_id = clinic_payers.organization_id
  )
);

drop policy if exists clinic_payer_requirements_admin_rw on public.clinic_payer_requirements;
create policy clinic_payer_requirements_admin_rw
on public.clinic_payer_requirements
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and u.clinic_id = clinic_payer_requirements.organization_id
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and u.clinic_id = clinic_payer_requirements.organization_id
  )
);

drop policy if exists appointment_billing_contexts_clinic_staff_rw on public.appointment_billing_contexts;
create policy appointment_billing_contexts_clinic_staff_rw
on public.appointment_billing_contexts
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    left join public.patients p on p.id = appointment_billing_contexts.patient_id
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist')
      and (
        (u.role in ('owner', 'admin', 'coordinator') and u.clinic_id = appointment_billing_contexts.organization_id)
        or (u.role = 'therapist' and u.clinic_id = appointment_billing_contexts.organization_id and p.therapist_id = auth.uid())
      )
  )
)
with check (
  exists (
    select 1
    from public.users u
    left join public.patients p on p.id = appointment_billing_contexts.patient_id
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and u.clinic_id = appointment_billing_contexts.organization_id
  )
);

drop policy if exists appointment_required_documents_clinic_staff_rw on public.appointment_required_documents;
create policy appointment_required_documents_clinic_staff_rw
on public.appointment_required_documents
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    left join public.patients p on p.id = appointment_required_documents.patient_id
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist')
      and (
        (u.role in ('owner', 'admin', 'coordinator') and u.clinic_id = appointment_required_documents.organization_id)
        or (u.role = 'therapist' and u.clinic_id = appointment_required_documents.organization_id and p.therapist_id = auth.uid())
      )
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and u.clinic_id = appointment_required_documents.organization_id
  )
);

drop policy if exists payer_requirement_audit_logs_admin_read_insert on public.payer_requirement_audit_logs;
create policy payer_requirement_audit_logs_admin_read_insert
on public.payer_requirement_audit_logs
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and u.clinic_id = payer_requirement_audit_logs.organization_id
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and u.clinic_id = payer_requirement_audit_logs.organization_id
  )
);
