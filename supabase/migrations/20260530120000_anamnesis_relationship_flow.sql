-- Patient relationship confirmation and family anamnesis flow.

alter table public.patients
  add column if not exists onboarding_status text not null default 'NOT_STARTED',
  add column if not exists anamnesis_required boolean not null default true,
  add column if not exists anamnesis_requested_at timestamptz,
  add column if not exists anamnesis_submitted_at timestamptz,
  add column if not exists anamnesis_reviewed_at timestamptz,
  add column if not exists relationship_status text not null default 'CONFIRMED';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.patients'::regclass
      and conname = 'patients_status_check'
  ) then
    alter table public.patients drop constraint patients_status_check;
    alter table public.patients
      add constraint patients_status_check
      check (
        status is null
        or status in (
          'active',
          'inactive',
          'pending',
          'pending_activation',
          'waiting_treatment',
          'deleted',
          'unlinked',
          'archived',
          'PENDING_ANAMNESIS',
          'PENDING_CONFIRMATION',
          'ACTIVE',
          'INACTIVE',
          'ARCHIVED'
        )
      );
  end if;
end $$;

create table if not exists public.patient_anamnesis_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  requested_by uuid,
  assigned_to_user_id uuid,
  status text not null default 'DRAFT',
  sent_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.patient_anamnesis_requests
  add column if not exists organization_id uuid,
  add column if not exists patient_id uuid,
  add column if not exists requested_by uuid,
  add column if not exists assigned_to_user_id uuid,
  add column if not exists status text not null default 'DRAFT',
  add column if not exists sent_at timestamptz,
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists expires_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.patient_anamnesis_requests
  drop constraint if exists patient_anamnesis_requests_status_check;
alter table public.patient_anamnesis_requests
  add constraint patient_anamnesis_requests_status_check
  check (status in ('DRAFT', 'SENT', 'IN_PROGRESS', 'SUBMITTED', 'REVIEWED', 'CANCELLED', 'EXPIRED'));

create table if not exists public.patient_anamnesis_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  request_id uuid references public.patient_anamnesis_requests(id) on delete set null,
  respondent_user_id uuid,
  respondent_role text not null default 'family',
  answers jsonb not null default '{}'::jsonb,
  status text not null default 'DRAFT',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.patient_anamnesis_responses
  add column if not exists organization_id uuid,
  add column if not exists patient_id uuid,
  add column if not exists request_id uuid,
  add column if not exists respondent_user_id uuid,
  add column if not exists respondent_role text not null default 'family',
  add column if not exists answers jsonb not null default '{}'::jsonb,
  add column if not exists status text not null default 'DRAFT',
  add column if not exists submitted_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.patient_anamnesis_responses
  drop constraint if exists patient_anamnesis_responses_status_check;
alter table public.patient_anamnesis_responses
  add constraint patient_anamnesis_responses_status_check
  check (status in ('DRAFT', 'SUBMITTED', 'REVIEWED'));

create table if not exists public.patient_relationship_confirmations (
  id uuid primary key default gen_random_uuid(),
  organization_id_requesting uuid not null,
  patient_id_requesting uuid not null references public.patients(id) on delete cascade,
  responsible_user_id uuid,
  email_normalized text not null,
  status text not null default 'PENDING',
  confirmation_token_hash text not null,
  sent_at timestamptz,
  confirmed_at timestamptz,
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.patient_relationship_confirmations
  add column if not exists organization_id_requesting uuid,
  add column if not exists patient_id_requesting uuid,
  add column if not exists responsible_user_id uuid,
  add column if not exists email_normalized text,
  add column if not exists status text not null default 'PENDING',
  add column if not exists confirmation_token_hash text,
  add column if not exists sent_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists created_by uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.patient_relationship_confirmations
  drop constraint if exists patient_relationship_confirmations_status_check;
alter table public.patient_relationship_confirmations
  add constraint patient_relationship_confirmations_status_check
  check (status in ('PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED'));

create table if not exists public.patient_shared_history_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id_source uuid,
  organization_id_target uuid not null,
  patient_id_source uuid,
  patient_id_target uuid not null references public.patients(id) on delete cascade,
  generated_by uuid,
  authorized_by_user_id uuid,
  scope jsonb not null default '{}'::jsonb,
  snapshot_data jsonb not null default '{}'::jsonb,
  status text not null default 'GENERATED',
  generated_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.patient_shared_history_snapshots
  add column if not exists organization_id_source uuid,
  add column if not exists organization_id_target uuid,
  add column if not exists patient_id_source uuid,
  add column if not exists patient_id_target uuid,
  add column if not exists generated_by uuid,
  add column if not exists authorized_by_user_id uuid,
  add column if not exists scope jsonb not null default '{}'::jsonb,
  add column if not exists snapshot_data jsonb not null default '{}'::jsonb,
  add column if not exists status text not null default 'GENERATED',
  add column if not exists generated_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.patient_shared_history_snapshots
  drop constraint if exists patient_shared_history_snapshots_status_check;
alter table public.patient_shared_history_snapshots
  add constraint patient_shared_history_snapshots_status_check
  check (status in ('GENERATED', 'IMPORTED', 'REVOKED', 'EXPIRED'));

create index if not exists idx_patient_anamnesis_requests_patient
  on public.patient_anamnesis_requests (organization_id, patient_id, status, sent_at desc);

create index if not exists idx_patient_anamnesis_responses_request
  on public.patient_anamnesis_responses (organization_id, patient_id, request_id, updated_at desc);

create unique index if not exists idx_relationship_confirmations_token_hash
  on public.patient_relationship_confirmations (confirmation_token_hash);

create index if not exists idx_relationship_confirmations_patient
  on public.patient_relationship_confirmations (organization_id_requesting, patient_id_requesting, status, created_at desc);

create index if not exists idx_shared_history_snapshots_target
  on public.patient_shared_history_snapshots (organization_id_target, patient_id_target, status, generated_at desc);

alter table public.patient_anamnesis_requests enable row level security;
alter table public.patient_anamnesis_responses enable row level security;
alter table public.patient_relationship_confirmations enable row level security;
alter table public.patient_shared_history_snapshots enable row level security;

drop policy if exists patient_anamnesis_requests_clinic_rw on public.patient_anamnesis_requests;
create policy patient_anamnesis_requests_clinic_rw
on public.patient_anamnesis_requests
for all
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist', 'receptionist')
      and (u.clinic_id = patient_anamnesis_requests.organization_id or u.id = patient_anamnesis_requests.organization_id)
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist', 'receptionist')
      and (u.clinic_id = patient_anamnesis_requests.organization_id or u.id = patient_anamnesis_requests.organization_id)
  )
);

drop policy if exists patient_anamnesis_requests_patient_read on public.patient_anamnesis_requests;
create policy patient_anamnesis_requests_patient_read
on public.patient_anamnesis_requests
for select
using (
  exists (
    select 1 from public.patients p
    where p.id = patient_anamnesis_requests.patient_id
      and (p.responsible_user_id = auth.uid() or exists (
        select 1 from public.users u where u.id = auth.uid() and lower(u.email) = lower(p.email)
      ))
  )
);

drop policy if exists patient_anamnesis_responses_clinic_rw on public.patient_anamnesis_responses;
create policy patient_anamnesis_responses_clinic_rw
on public.patient_anamnesis_responses
for all
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist', 'receptionist')
      and (u.clinic_id = patient_anamnesis_responses.organization_id or u.id = patient_anamnesis_responses.organization_id)
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist', 'receptionist')
      and (u.clinic_id = patient_anamnesis_responses.organization_id or u.id = patient_anamnesis_responses.organization_id)
  )
);

drop policy if exists patient_anamnesis_responses_patient_rw on public.patient_anamnesis_responses;
create policy patient_anamnesis_responses_patient_rw
on public.patient_anamnesis_responses
for all
using (
  respondent_user_id = auth.uid()
  or exists (
    select 1 from public.patients p
    where p.id = patient_anamnesis_responses.patient_id
      and (p.responsible_user_id = auth.uid() or exists (
        select 1 from public.users u where u.id = auth.uid() and lower(u.email) = lower(p.email)
      ))
  )
)
with check (
  respondent_user_id = auth.uid()
  or exists (
    select 1 from public.patients p
    where p.id = patient_anamnesis_responses.patient_id
      and (p.responsible_user_id = auth.uid() or exists (
        select 1 from public.users u where u.id = auth.uid() and lower(u.email) = lower(p.email)
      ))
  )
);

drop policy if exists patient_relationship_confirmations_clinic_rw on public.patient_relationship_confirmations;
create policy patient_relationship_confirmations_clinic_rw
on public.patient_relationship_confirmations
for all
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = patient_relationship_confirmations.organization_id_requesting or u.id = patient_relationship_confirmations.organization_id_requesting)
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id = patient_relationship_confirmations.organization_id_requesting or u.id = patient_relationship_confirmations.organization_id_requesting)
  )
);

drop policy if exists patient_relationship_confirmations_responsible_read on public.patient_relationship_confirmations;
create policy patient_relationship_confirmations_responsible_read
on public.patient_relationship_confirmations
for select
using (
  responsible_user_id = auth.uid()
  or exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and lower(u.email) = lower(patient_relationship_confirmations.email_normalized)
  )
);

drop policy if exists patient_shared_history_snapshots_clinic_read on public.patient_shared_history_snapshots;
create policy patient_shared_history_snapshots_clinic_read
on public.patient_shared_history_snapshots
for select
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'therapist')
      and (
        u.clinic_id = patient_shared_history_snapshots.organization_id_target
        or u.id = patient_shared_history_snapshots.organization_id_target
      )
  )
);
