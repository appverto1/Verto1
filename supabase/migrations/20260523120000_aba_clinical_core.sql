-- ABA clinical core foundation.
-- Additive schema for structured sessions and DTT/NET/probe trials.

create extension if not exists pgcrypto;

create table if not exists public.aba_prompt_levels (
  id uuid primary key default gen_random_uuid(),
  clinic_id text not null,
  key text not null,
  name text not null,
  abbreviation text,
  sort_order integer not null default 0,
  is_independent boolean not null default false,
  is_error boolean not null default false,
  is_default boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, key)
);

create table if not exists public.aba_programs (
  id text primary key default gen_random_uuid()::text,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  name text not null,
  description text,
  program_type text not null default 'skill_acquisition'
    check (program_type in ('skill_acquisition', 'behavior_reduction', 'task_analysis')),
  status text not null default 'active'
    check (status in ('draft', 'active', 'on_hold', 'archived')),
  protocol_id text,
  protocol_title text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aba_targets (
  id text primary key,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  program_id text references public.aba_programs(id) on delete set null,
  name text not null,
  description text,
  target_type text not null default 'dtt'
    check (target_type in ('dtt', 'net', 'probe', 'behavior', 'task_analysis')),
  phase text not null default 'teaching'
    check (phase in ('draft', 'baseline', 'teaching', 'mastered', 'maintenance', 'generalization', 'on_hold', 'regressed', 'discontinued')),
  protocol_id text,
  protocol_title text,
  domain_id text,
  domain_name text,
  mastery_criteria jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aba_behavior_definitions (
  id text primary key default gen_random_uuid()::text,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  name text not null,
  operational_definition text,
  measurement_type text not null default 'frequency'
    check (measurement_type in ('frequency', 'duration', 'rate', 'partial_interval', 'whole_interval', 'momentary_time_sampling', 'abc')),
  interval_seconds integer,
  status text not null default 'active'
    check (status in ('active', 'on_hold', 'archived')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aba_behavior_events (
  id text primary key,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  session_id text,
  behavior_id text,
  behavior_name text not null,
  measurement_type text not null default 'frequency'
    check (measurement_type in ('frequency', 'duration', 'rate', 'partial_interval', 'whole_interval', 'momentary_time_sampling', 'abc')),
  count_delta integer,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  interval_index integer,
  interval_occurred boolean,
  severity integer,
  antecedent text,
  consequence text,
  location text,
  response_by_therapist text,
  notes text,
  occurred_at timestamptz not null default now(),
  therapist_id text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.aba_sessions (
  id text primary key,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  patient_name text,
  therapist_id text,
  device_id text,
  source text not null default 'verto_web',
  status text not null default 'active'
    check (status in ('active', 'completed', 'canceled')),
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_minutes integer,
  reference_date date,
  record_count integer not null default 0,
  sync_status text not null default 'synced'
    check (sync_status in ('local_only', 'queued', 'syncing', 'synced', 'conflict', 'failed')),
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aba_trials (
  id text primary key,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  session_id text,
  target_id text,
  target_name text not null,
  program_id text,
  protocol_id text,
  protocol_title text,
  domain_id text,
  domain_name text,
  collection_type text not null default 'dtt'
    check (collection_type in ('dtt', 'net', 'cold_probe', 'baseline_probe', 'maintenance_probe')),
  response_score numeric(8,2),
  max_score numeric(8,2),
  correct boolean not null default false,
  independent boolean not null default false,
  prompt_level_key text,
  prompt_level_name text,
  latency_ms integer,
  notes text,
  occurred_at timestamptz not null default now(),
  therapist_id text,
  source_history_id text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_aba_prompt_levels_clinic
  on public.aba_prompt_levels (clinic_id, sort_order);
create index if not exists idx_aba_programs_patient
  on public.aba_programs (patient_id, status, updated_at desc);
create index if not exists idx_aba_targets_patient
  on public.aba_targets (patient_id, phase, updated_at desc);
create index if not exists idx_aba_behavior_definitions_patient
  on public.aba_behavior_definitions (patient_id, measurement_type, status);
create index if not exists idx_aba_behavior_events_patient
  on public.aba_behavior_events (patient_id, measurement_type, occurred_at desc);
create index if not exists idx_aba_behavior_events_session
  on public.aba_behavior_events (session_id, occurred_at desc);
create index if not exists idx_aba_sessions_patient_started
  on public.aba_sessions (patient_id, started_at desc);
create index if not exists idx_aba_trials_patient_occurred
  on public.aba_trials (patient_id, occurred_at desc);
create index if not exists idx_aba_trials_session
  on public.aba_trials (session_id, occurred_at desc);
create index if not exists idx_aba_trials_target
  on public.aba_trials (patient_id, target_id, occurred_at desc);

alter table public.aba_prompt_levels enable row level security;
alter table public.aba_programs enable row level security;
alter table public.aba_targets enable row level security;
alter table public.aba_behavior_definitions enable row level security;
alter table public.aba_behavior_events enable row level security;
alter table public.aba_sessions enable row level security;
alter table public.aba_trials enable row level security;

drop policy if exists aba_prompt_levels_clinic_rw on public.aba_prompt_levels;
create policy aba_prompt_levels_clinic_rw
on public.aba_prompt_levels
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (
          u.role in ('coordinator', 'therapist')
          and u.clinic_id::text = aba_prompt_levels.clinic_id
        )
      )
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (
          u.role in ('coordinator', 'therapist')
          and u.clinic_id::text = aba_prompt_levels.clinic_id
        )
      )
  )
);

drop policy if exists aba_programs_patient_scope_rw on public.aba_programs;
create policy aba_programs_patient_scope_rw
on public.aba_programs
for all
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_programs.patient_id
      and (
        u.role in ('owner', 'admin')
        or (
          u.role = 'coordinator'
          and u.clinic_id::text = aba_programs.clinic_id
        )
        or (
          u.role = 'therapist'
          and p.therapist_id = auth.uid()
          and u.clinic_id::text = aba_programs.clinic_id
        )
      )
  )
)
with check (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_programs.patient_id
      and (
        u.role in ('owner', 'admin')
        or (
          u.role = 'coordinator'
          and u.clinic_id::text = aba_programs.clinic_id
        )
        or (
          u.role = 'therapist'
          and p.therapist_id = auth.uid()
          and u.clinic_id::text = aba_programs.clinic_id
        )
      )
  )
);

drop policy if exists aba_targets_patient_scope_rw on public.aba_targets;
create policy aba_targets_patient_scope_rw
on public.aba_targets
for all
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_targets.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_targets.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_targets.clinic_id)
      )
  )
)
with check (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_targets.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_targets.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_targets.clinic_id)
      )
  )
);

drop policy if exists aba_behavior_definitions_patient_scope_rw on public.aba_behavior_definitions;
create policy aba_behavior_definitions_patient_scope_rw
on public.aba_behavior_definitions
for all
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_behavior_definitions.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_behavior_definitions.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_behavior_definitions.clinic_id)
      )
  )
)
with check (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_behavior_definitions.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_behavior_definitions.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_behavior_definitions.clinic_id)
      )
  )
);

drop policy if exists aba_behavior_events_patient_scope_rw on public.aba_behavior_events;
create policy aba_behavior_events_patient_scope_rw
on public.aba_behavior_events
for all
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_behavior_events.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_behavior_events.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_behavior_events.clinic_id)
      )
  )
)
with check (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_behavior_events.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_behavior_events.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_behavior_events.clinic_id)
      )
  )
);

drop policy if exists aba_sessions_patient_scope_rw on public.aba_sessions;
create policy aba_sessions_patient_scope_rw
on public.aba_sessions
for all
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_sessions.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_sessions.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_sessions.clinic_id)
      )
  )
)
with check (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_sessions.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_sessions.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_sessions.clinic_id)
      )
  )
);

drop policy if exists aba_trials_patient_scope_rw on public.aba_trials;
create policy aba_trials_patient_scope_rw
on public.aba_trials
for all
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_trials.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_trials.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_trials.clinic_id)
      )
  )
)
with check (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_trials.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_trials.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_trials.clinic_id)
      )
  )
);
