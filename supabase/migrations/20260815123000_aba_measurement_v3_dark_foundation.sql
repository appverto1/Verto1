-- ABA Measurement V3 - PR1 dark foundation.
-- Additive only. Does not alter ABA V2 data, routes, summaries or runtime behavior.
-- Feature gates default to false and no rollout row is created by this migration.

begin;

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- Immutable definition snapshots used by future V3 collection.
-- A corrected prompt/configuration creates a NEW version; it does not mutate the
-- definition used by already-collected/offline events.
create table if not exists public.aba_collection_definition_versions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  program_id text references public.aba_programs(id) on delete restrict,
  target_id text not null references public.aba_targets(id) on delete restrict,
  version integer not null check (version > 0),
  schema_version integer not null default 3 check (schema_version = 3),
  status text not null default 'PUBLISHED'
    check (status in ('PUBLISHED', 'DEPRECATED', 'ARCHIVED')),
  definition jsonb not null,
  definition_hash text not null,
  published_at timestamptz not null default now(),
  deprecated_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint aba_collection_definition_v3_object
    check (jsonb_typeof(definition) = 'object'),
  constraint aba_collection_definition_v3_hash
    check (definition_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_collection_definition_v3_deprecation_time
    check (
      (status = 'PUBLISHED' and deprecated_at is null)
      or (status in ('DEPRECATED', 'ARCHIVED') and deprecated_at is not null)
    ),
  unique (target_id, version),
  unique (id, organization_id, patient_id, target_id)
);

create index if not exists idx_aba_collection_definition_v3_target
  on public.aba_collection_definition_versions_v3
  (organization_id, patient_id, target_id, version desc);

create index if not exists idx_aba_collection_definition_v3_status
  on public.aba_collection_definition_versions_v3
  (organization_id, status, target_id);

-- Clinical phase episode for one target. Intentionally orthogonal to collection
-- definition versions: a definition can change without creating a fake phase break.
create table if not exists public.aba_target_phase_assignments_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  program_id text references public.aba_programs(id) on delete restrict,
  target_id text not null references public.aba_targets(id) on delete restrict,
  source_clinical_plan_phase_id uuid references public.clinical_plan_phases(id) on delete set null,
  phase_type text not null
    check (phase_type in (
      'baseline', 'intervention', 'procedure_change', 'maintenance',
      'generalization', 'pause', 'instrument_change'
    )),
  phase_key text not null,
  label text not null,
  reason text,
  effective_from timestamptz not null,
  effective_until timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint aba_target_phase_assignment_v3_window
    check (effective_until is null or effective_until > effective_from),
  unique (id, organization_id, patient_id, target_id)
);

create index if not exists idx_aba_target_phase_assignment_v3_timeline
  on public.aba_target_phase_assignments_v3
  (organization_id, patient_id, target_id, effective_from desc);

-- Half-open windows [effective_from, effective_until) for the SAME target cannot
-- overlap. Offline sync will later validate event occurred_at against this window;
-- an assignment may be closed at sync time and still be valid for an old event.
do $phase_overlap$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.aba_target_phase_assignments_v3'::regclass
      and c.conname = 'aba_target_phase_assignments_v3_no_overlap'
  ) then
    alter table public.aba_target_phase_assignments_v3
      add constraint aba_target_phase_assignments_v3_no_overlap
      exclude using gist (
        organization_id with =,
        target_id with =,
        tstzrange(
          effective_from,
          coalesce(effective_until, 'infinity'::timestamptz),
          '[)'
        ) with &&
      );
  end if;
end;
$phase_overlap$;

-- Persisted rollout controls. Absence of a row means disabled. Both switches are
-- false by default; this migration never enables V3 for any tenant.
create table if not exists public.aba_measurement_rollout_states_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  scope_type text not null
    check (scope_type in ('CLINIC', 'PATIENT', 'PROGRAM', 'TARGET')),
  patient_id uuid references public.patients(id) on delete cascade,
  program_id text references public.aba_programs(id) on delete cascade,
  target_id text references public.aba_targets(id) on delete cascade,
  allow_new_v3_sessions boolean not null default false,
  accept_v3_sync boolean not null default false,
  effective_from timestamptz not null default now(),
  state_version bigint not null default 1 check (state_version > 0),
  reason text,
  changed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aba_measurement_rollout_v3_scope_shape check (
    (scope_type = 'CLINIC'
      and patient_id is null and program_id is null and target_id is null)
    or
    (scope_type = 'PATIENT'
      and patient_id is not null and program_id is null and target_id is null)
    or
    (scope_type = 'PROGRAM'
      and patient_id is not null and program_id is not null and target_id is null)
    or
    (scope_type = 'TARGET'
      and patient_id is not null and program_id is not null and target_id is not null)
  )
);

create unique index if not exists ux_aba_rollout_v3_clinic_scope
  on public.aba_measurement_rollout_states_v3 (organization_id)
  where scope_type = 'CLINIC';

create unique index if not exists ux_aba_rollout_v3_patient_scope
  on public.aba_measurement_rollout_states_v3 (organization_id, patient_id)
  where scope_type = 'PATIENT';

create unique index if not exists ux_aba_rollout_v3_program_scope
  on public.aba_measurement_rollout_states_v3 (organization_id, patient_id, program_id)
  where scope_type = 'PROGRAM';

create unique index if not exists ux_aba_rollout_v3_target_scope
  on public.aba_measurement_rollout_states_v3
  (organization_id, patient_id, program_id, target_id)
  where scope_type = 'TARGET';

create table if not exists public.aba_measurement_rollout_events_v3 (
  id uuid primary key default gen_random_uuid(),
  rollout_state_id uuid not null
    references public.aba_measurement_rollout_states_v3(id) on delete restrict,
  organization_id uuid not null references public.clinics(id) on delete restrict,
  event_type text not null check (event_type in ('CREATED', 'UPDATED')),
  state_version bigint not null check (state_version > 0),
  before_state jsonb,
  after_state jsonb not null,
  changed_by uuid,
  occurred_at timestamptz not null default now(),
  constraint aba_rollout_event_before_object_v3
    check (before_state is null or jsonb_typeof(before_state) = 'object'),
  constraint aba_rollout_event_after_object_v3
    check (jsonb_typeof(after_state) = 'object')
);

create index if not exists idx_aba_rollout_events_v3_state
  on public.aba_measurement_rollout_events_v3
  (organization_id, rollout_state_id, state_version desc);

-- Immutable decision for one target inside one session. The PR2 resolver will be
-- the only supported writer. Mid-session rollout changes never rewrite this row.
create table if not exists public.aba_session_target_measurement_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text not null references public.aba_sessions(id) on delete restrict,
  program_id text references public.aba_programs(id) on delete restrict,
  target_id text not null references public.aba_targets(id) on delete restrict,
  measurement_model_version text not null
    check (measurement_model_version in (
      'LEGACY_V2', 'V3', 'EMERGENCY_LEGACY_BRIDGE'
    )),
  collection_definition_version_id uuid,
  target_phase_assignment_id uuid,
  rollout_state_id uuid references public.aba_measurement_rollout_states_v3(id) on delete set null,
  rollout_state_version bigint check (rollout_state_version is null or rollout_state_version > 0),
  binding_source text not null default 'SERVER_RESOLVER'
    check (binding_source in ('SERVER_RESOLVER', 'OFFLINE_SNAPSHOT', 'EMERGENCY_BRIDGE')),
  bound_at timestamptz not null default now(),
  bound_by uuid,
  created_at timestamptz not null default now(),
  constraint aba_session_target_binding_v3_shape check (
    (
      measurement_model_version = 'V3'
      and collection_definition_version_id is not null
      and target_phase_assignment_id is not null
    )
    or
    (
      measurement_model_version in ('LEGACY_V2', 'EMERGENCY_LEGACY_BRIDGE')
      and collection_definition_version_id is null
      and target_phase_assignment_id is null
    )
  ),
  unique (session_id, target_id),
  foreign key (
    collection_definition_version_id,
    organization_id,
    patient_id,
    target_id
  ) references public.aba_collection_definition_versions_v3 (
    id,
    organization_id,
    patient_id,
    target_id
  ) on delete restrict,
  foreign key (
    target_phase_assignment_id,
    organization_id,
    patient_id,
    target_id
  ) references public.aba_target_phase_assignments_v3 (
    id,
    organization_id,
    patient_id,
    target_id
  ) on delete restrict
);

create index if not exists idx_aba_session_target_binding_v3_patient
  on public.aba_session_target_measurement_bindings
  (organization_id, patient_id, session_id);

create index if not exists idx_aba_session_target_binding_v3_target
  on public.aba_session_target_measurement_bindings
  (organization_id, patient_id, target_id, bound_at desc);

-- Defense in depth for the new V3 tables. Existing ABA ownership columns are
-- text, so comparisons use clinic_id::text without mutating legacy tables.
create or replace function public.validate_aba_v3_foundation_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_patient_clinic_id uuid;
  v_target_patient_id uuid;
  v_target_clinic_id text;
  v_target_program_id text;
  v_program_patient_id uuid;
  v_program_clinic_id text;
  v_session_patient_id uuid;
  v_session_clinic_id text;
begin
  if new.organization_id is null then
    raise exception 'ABA_V3_ORGANIZATION_REQUIRED';
  end if;

  if new.patient_id is not null then
    select patient.clinic_id
      into v_patient_clinic_id
    from public.patients patient
    where patient.id = new.patient_id;

    if not found or v_patient_clinic_id is distinct from new.organization_id then
      raise exception 'ABA_V3_PATIENT_SCOPE_INVALID';
    end if;
  end if;

  if new.program_id is not null then
    select program.patient_id, program.clinic_id
      into v_program_patient_id, v_program_clinic_id
    from public.aba_programs program
    where program.id = new.program_id;

    if not found
       or v_program_clinic_id is distinct from new.organization_id::text
       or (new.patient_id is not null and v_program_patient_id is distinct from new.patient_id) then
      raise exception 'ABA_V3_PROGRAM_SCOPE_INVALID';
    end if;
  end if;

  if new.target_id is not null then
    select target.patient_id, target.clinic_id, target.program_id
      into v_target_patient_id, v_target_clinic_id, v_target_program_id
    from public.aba_targets target
    where target.id = new.target_id;

    if not found
       or v_target_clinic_id is distinct from new.organization_id::text
       or (new.patient_id is not null and v_target_patient_id is distinct from new.patient_id)
       or (new.program_id is not null and v_target_program_id is distinct from new.program_id) then
      raise exception 'ABA_V3_TARGET_SCOPE_INVALID';
    end if;
  end if;

  if tg_table_name = 'aba_session_target_measurement_bindings' then
    select session.patient_id, session.clinic_id
      into v_session_patient_id, v_session_clinic_id
    from public.aba_sessions session
    where session.id = new.session_id;

    if not found
       or v_session_patient_id is distinct from new.patient_id
       or v_session_clinic_id is distinct from new.organization_id::text then
      raise exception 'ABA_V3_SESSION_SCOPE_INVALID';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists validate_aba_collection_definition_scope_v3
  on public.aba_collection_definition_versions_v3;
create trigger validate_aba_collection_definition_scope_v3
before insert or update on public.aba_collection_definition_versions_v3
for each row execute function public.validate_aba_v3_foundation_scope();

drop trigger if exists validate_aba_target_phase_assignment_scope_v3
  on public.aba_target_phase_assignments_v3;
create trigger validate_aba_target_phase_assignment_scope_v3
before insert or update on public.aba_target_phase_assignments_v3
for each row execute function public.validate_aba_v3_foundation_scope();

drop trigger if exists validate_aba_measurement_rollout_scope_v3
  on public.aba_measurement_rollout_states_v3;
create trigger validate_aba_measurement_rollout_scope_v3
before insert or update on public.aba_measurement_rollout_states_v3
for each row execute function public.validate_aba_v3_foundation_scope();

drop trigger if exists validate_aba_session_target_binding_scope_v3
  on public.aba_session_target_measurement_bindings;
create trigger validate_aba_session_target_binding_scope_v3
before insert or update on public.aba_session_target_measurement_bindings
for each row execute function public.validate_aba_v3_foundation_scope();

-- Definition content is immutable. Only lifecycle status/deprecated_at may change.
create or replace function public.guard_aba_collection_definition_version_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'ABA_V3_COLLECTION_VERSION_DELETE_FORBIDDEN';
  end if;

  if old.organization_id is distinct from new.organization_id
     or old.patient_id is distinct from new.patient_id
     or old.program_id is distinct from new.program_id
     or old.target_id is distinct from new.target_id
     or old.version is distinct from new.version
     or old.schema_version is distinct from new.schema_version
     or old.definition is distinct from new.definition
     or old.definition_hash is distinct from new.definition_hash
     or old.published_at is distinct from new.published_at
     or old.created_by is distinct from new.created_by
     or old.created_at is distinct from new.created_at then
    raise exception 'ABA_V3_COLLECTION_VERSION_IMMUTABLE';
  end if;

  if old.status = 'ARCHIVED' and new.status <> 'ARCHIVED' then
    raise exception 'ABA_V3_COLLECTION_VERSION_ARCHIVED_FINAL';
  end if;

  if old.status = 'DEPRECATED' and new.status = 'PUBLISHED' then
    raise exception 'ABA_V3_COLLECTION_VERSION_REACTIVATION_FORBIDDEN';
  end if;

  return new;
end;
$function$;

drop trigger if exists guard_aba_collection_definition_version_v3
  on public.aba_collection_definition_versions_v3;
create trigger guard_aba_collection_definition_version_v3
before update or delete on public.aba_collection_definition_versions_v3
for each row execute function public.guard_aba_collection_definition_version_v3();

-- Bindings are immutable clinical context. New session/target => new binding.
create or replace function public.guard_aba_session_target_binding_immutable_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'ABA_V3_SESSION_TARGET_BINDING_IMMUTABLE';
end;
$function$;

drop trigger if exists guard_aba_session_target_binding_immutable_v3
  on public.aba_session_target_measurement_bindings;
create trigger guard_aba_session_target_binding_immutable_v3
before update or delete on public.aba_session_target_measurement_bindings
for each row execute function public.guard_aba_session_target_binding_immutable_v3();

-- Rollout rows remain mutable, but every mutation increments state_version and is
-- persisted in an append-only event table.
create or replace function public.prepare_aba_measurement_rollout_state_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'UPDATE' then
    new.state_version := old.state_version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists prepare_aba_measurement_rollout_state_v3
  on public.aba_measurement_rollout_states_v3;
create trigger prepare_aba_measurement_rollout_state_v3
before update on public.aba_measurement_rollout_states_v3
for each row execute function public.prepare_aba_measurement_rollout_state_v3();

create or replace function public.audit_aba_measurement_rollout_state_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  insert into public.aba_measurement_rollout_events_v3 (
    rollout_state_id,
    organization_id,
    event_type,
    state_version,
    before_state,
    after_state,
    changed_by
  ) values (
    new.id,
    new.organization_id,
    case when tg_op = 'INSERT' then 'CREATED' else 'UPDATED' end,
    new.state_version,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    new.changed_by
  );
  return new;
end;
$function$;

drop trigger if exists audit_aba_measurement_rollout_state_v3
  on public.aba_measurement_rollout_states_v3;
create trigger audit_aba_measurement_rollout_state_v3
after insert or update on public.aba_measurement_rollout_states_v3
for each row execute function public.audit_aba_measurement_rollout_state_v3();

create or replace function public.guard_aba_measurement_rollout_event_append_only_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'ABA_V3_ROLLOUT_EVENT_APPEND_ONLY';
end;
$function$;

drop trigger if exists guard_aba_measurement_rollout_event_append_only_v3
  on public.aba_measurement_rollout_events_v3;
create trigger guard_aba_measurement_rollout_event_append_only_v3
before update or delete on public.aba_measurement_rollout_events_v3
for each row execute function public.guard_aba_measurement_rollout_event_append_only_v3();

-- Dark deploy security: no browser access in PR1. Subsequent PRs expose narrow
-- security-definer RPCs after authorization/idempotency tests exist.
alter table public.aba_collection_definition_versions_v3 enable row level security;
alter table public.aba_target_phase_assignments_v3 enable row level security;
alter table public.aba_measurement_rollout_states_v3 enable row level security;
alter table public.aba_measurement_rollout_events_v3 enable row level security;
alter table public.aba_session_target_measurement_bindings enable row level security;

revoke all on table public.aba_collection_definition_versions_v3 from public, anon, authenticated;
revoke all on table public.aba_target_phase_assignments_v3 from public, anon, authenticated;
revoke all on table public.aba_measurement_rollout_states_v3 from public, anon, authenticated;
revoke all on table public.aba_measurement_rollout_events_v3 from public, anon, authenticated;
revoke all on table public.aba_session_target_measurement_bindings from public, anon, authenticated;

grant all on table public.aba_collection_definition_versions_v3 to service_role;
grant all on table public.aba_target_phase_assignments_v3 to service_role;
grant all on table public.aba_measurement_rollout_states_v3 to service_role;
grant all on table public.aba_measurement_rollout_events_v3 to service_role;
grant all on table public.aba_session_target_measurement_bindings to service_role;

revoke all on function public.validate_aba_v3_foundation_scope() from public, anon, authenticated;
revoke all on function public.guard_aba_collection_definition_version_v3() from public, anon, authenticated;
revoke all on function public.guard_aba_session_target_binding_immutable_v3() from public, anon, authenticated;
revoke all on function public.prepare_aba_measurement_rollout_state_v3() from public, anon, authenticated;
revoke all on function public.audit_aba_measurement_rollout_state_v3() from public, anon, authenticated;
revoke all on function public.guard_aba_measurement_rollout_event_append_only_v3() from public, anon, authenticated;

-- Explicit dark-launch invariant: this migration creates no rollout state row and
-- changes no V2 object/data. No INSERT/UPDATE/DELETE against ABA V2 tables occurs.

commit;
