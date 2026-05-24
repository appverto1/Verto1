-- ABA V2 additive persistence for interval collection, ABC complements and audit.

alter table public.aba_behavior_definitions
  add column if not exists abc_requirement text not null default 'OPTIONAL'
    check (abc_requirement in ('REQUIRED', 'RECOMMENDED', 'OPTIONAL', 'DISABLED')),
  add column if not exists default_location text,
  add column if not exists default_severity integer check (default_severity between 0 and 5),
  add column if not exists is_active boolean not null default true;

alter table public.aba_behavior_events
  add column if not exists status text not null default 'COMPLETED'
    check (status in ('IN_PROGRESS', 'COMPLETED', 'CANCELED')),
  add column if not exists sync_status text not null default 'synced'
    check (sync_status in ('local', 'local_only', 'queued', 'syncing', 'synced', 'error', 'failed', 'conflict')),
  add column if not exists interval_number integer,
  add column if not exists interval_started_at timestamptz,
  add column if not exists interval_ended_at timestamptz,
  add column if not exists interval_occurred boolean,
  add column if not exists occurred boolean;

alter table public.aba_trials
  add column if not exists sync_status text not null default 'synced'
    check (sync_status in ('local', 'local_only', 'queued', 'syncing', 'synced', 'error', 'failed', 'conflict')),
  add column if not exists prompt_level_id text;

alter table public.aba_session_summaries
  add column if not exists abc_summary jsonb not null default '[]'::jsonb;

create table if not exists public.aba_interval_records (
  id text primary key,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  session_id text not null,
  behavior_id text,
  behavior_name text not null,
  method text not null default 'partial_interval'
    check (method in ('partial_interval', 'whole_interval', 'momentary_time_sampling')),
  interval_number integer not null,
  interval_duration_seconds integer not null,
  interval_started_at timestamptz not null,
  interval_ended_at timestamptz not null,
  occurred boolean not null default false,
  location text,
  severity integer check (severity between 0 and 5),
  therapist_id text,
  sync_status text not null default 'synced'
    check (sync_status in ('local', 'local_only', 'queued', 'syncing', 'synced', 'error', 'failed', 'conflict')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.aba_interval_summaries (
  id text primary key,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  session_id text not null,
  behavior_id text,
  behavior_name text not null,
  method text not null default 'partial_interval'
    check (method in ('partial_interval', 'whole_interval', 'momentary_time_sampling')),
  total_intervals integer not null default 0,
  yes_count integer not null default 0,
  no_count integer not null default 0,
  occurrence_percent numeric(5,2) not null default 0,
  started_at timestamptz,
  ended_at timestamptz not null,
  location text,
  severity integer check (severity between 0 and 5),
  therapist_id text,
  sync_status text not null default 'synced'
    check (sync_status in ('local', 'local_only', 'queued', 'syncing', 'synced', 'error', 'failed', 'conflict')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.aba_abc_events (
  id text primary key,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  session_id text,
  behavior_id text,
  behavior_event_id text,
  behavior_name text not null,
  antecedent text,
  consequence text,
  location text,
  severity integer check (severity between 0 and 5),
  response text,
  notes text,
  therapist_id text,
  sync_status text not null default 'synced'
    check (sync_status in ('local', 'local_only', 'queued', 'syncing', 'synced', 'error', 'failed', 'conflict')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.aba_audit_events (
  id text primary key default gen_random_uuid()::text,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  session_id text,
  entity_table text not null,
  entity_id text,
  action text not null,
  actor_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_aba_interval_records_session
  on public.aba_interval_records (session_id, interval_number);
create index if not exists idx_aba_interval_records_patient
  on public.aba_interval_records (patient_id, created_at desc);
create index if not exists idx_aba_interval_summaries_session
  on public.aba_interval_summaries (session_id, ended_at desc);
create index if not exists idx_aba_abc_events_session
  on public.aba_abc_events (session_id, created_at desc);
create index if not exists idx_aba_abc_events_patient
  on public.aba_abc_events (patient_id, created_at desc);
create index if not exists idx_aba_audit_events_session
  on public.aba_audit_events (session_id, created_at desc);

alter table public.aba_interval_records enable row level security;
alter table public.aba_interval_summaries enable row level security;
alter table public.aba_abc_events enable row level security;
alter table public.aba_audit_events enable row level security;

drop policy if exists aba_interval_records_patient_scope_rw on public.aba_interval_records;
create policy aba_interval_records_patient_scope_rw
on public.aba_interval_records
for all
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_interval_records.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_interval_records.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_interval_records.clinic_id)
      )
  )
)
with check (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_interval_records.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_interval_records.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_interval_records.clinic_id)
      )
  )
);

drop policy if exists aba_interval_summaries_patient_scope_rw on public.aba_interval_summaries;
create policy aba_interval_summaries_patient_scope_rw
on public.aba_interval_summaries
for all
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_interval_summaries.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_interval_summaries.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_interval_summaries.clinic_id)
      )
  )
)
with check (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_interval_summaries.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_interval_summaries.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_interval_summaries.clinic_id)
      )
  )
);

drop policy if exists aba_abc_events_patient_scope_rw on public.aba_abc_events;
create policy aba_abc_events_patient_scope_rw
on public.aba_abc_events
for all
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_abc_events.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_abc_events.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_abc_events.clinic_id)
      )
  )
)
with check (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_abc_events.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_abc_events.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_abc_events.clinic_id)
      )
  )
);

drop policy if exists aba_audit_events_patient_scope_rw on public.aba_audit_events;
create policy aba_audit_events_patient_scope_rw
on public.aba_audit_events
for all
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_audit_events.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_audit_events.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_audit_events.clinic_id)
      )
  )
)
with check (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_audit_events.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_audit_events.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_audit_events.clinic_id)
      )
  )
);
