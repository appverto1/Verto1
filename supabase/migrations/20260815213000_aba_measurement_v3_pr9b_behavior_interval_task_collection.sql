-- ABA Measurement V3 - PR9B behavior, interval and task-analysis collection bridge.
-- Additive/dark only. Legacy V2 tables and rollout state remain untouched.
-- Behavior -> target identity is explicit; no name-based inference or retrospective backfill is allowed.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Explicit behavior -> V3 target mapping. A behavior never becomes V3 merely
-- because its label resembles a behavior target. Mapping is tenant/patient scoped.
-- ---------------------------------------------------------------------------
create table if not exists public.aba_behavior_target_bindings_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  behavior_id text not null references public.aba_behavior_definitions(id) on delete restrict,
  target_id text not null references public.aba_targets(id) on delete restrict,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ARCHIVED')),
  created_by uuid not null,
  archived_by uuid,
  archived_at timestamptz,
  archive_reason text,
  created_at timestamptz not null default now(),
  constraint aba_behavior_target_binding_v3_archive_shape check (
    (status = 'ACTIVE' and archived_at is null and archived_by is null and archive_reason is null)
    or (
      status = 'ARCHIVED'
      and archived_at is not null
      and archived_by is not null
      and length(btrim(archive_reason)) between 3 and 500
    )
  ),
  unique (id, organization_id, patient_id, behavior_id, target_id)
);

create unique index if not exists uq_aba_behavior_target_binding_v3_active
  on public.aba_behavior_target_bindings_v3(organization_id, patient_id, behavior_id)
  where status = 'ACTIVE';

create index if not exists idx_aba_behavior_target_binding_v3_target
  on public.aba_behavior_target_bindings_v3(organization_id, patient_id, target_id)
  where status = 'ACTIVE';

-- First behavior resolution inside a session is immutable as well. This prevents a
-- configuration change (archive/rebind) from changing the target/model mid-session.
-- Unmapped canonical behaviors freeze a LEGACY_V2 decision for that session.
create table if not exists public.aba_session_behavior_collection_bindings_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text not null references public.aba_sessions(id) on delete restrict,
  behavior_id text not null references public.aba_behavior_definitions(id) on delete restrict,
  behavior_target_binding_id uuid references public.aba_behavior_target_bindings_v3(id) on delete restrict,
  target_id text references public.aba_targets(id) on delete restrict,
  session_target_measurement_binding_id uuid references public.aba_session_target_measurement_bindings(id) on delete restrict,
  measurement_model_version text not null check (measurement_model_version in ('LEGACY_V2','V3','EMERGENCY_LEGACY_BRIDGE')),
  binding_reason text not null,
  bound_by uuid not null,
  bound_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint aba_session_behavior_collection_binding_v3_shape check (
    (
      behavior_target_binding_id is null
      and target_id is null
      and session_target_measurement_binding_id is null
      and measurement_model_version = 'LEGACY_V2'
    )
    or (
      behavior_target_binding_id is not null
      and target_id is not null
      and session_target_measurement_binding_id is not null
    )
  ),
  unique (organization_id, patient_id, session_id, behavior_id)
);

create index if not exists idx_aba_session_behavior_collection_binding_v3_session
  on public.aba_session_behavior_collection_bindings_v3(organization_id, patient_id, session_id, behavior_id);

create or replace function public.guard_aba_session_behavior_collection_binding_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'ABA_V3_SESSION_BEHAVIOR_BINDING_IMMUTABLE';
end;
$function$;

drop trigger if exists guard_aba_session_behavior_collection_binding_v3 on public.aba_session_behavior_collection_bindings_v3;
create trigger guard_aba_session_behavior_collection_binding_v3
before update or delete on public.aba_session_behavior_collection_bindings_v3
for each row execute function public.guard_aba_session_behavior_collection_binding_v3();

create or replace function public.validate_aba_session_behavior_collection_binding_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_map public.aba_behavior_target_bindings_v3%rowtype;
  v_target_binding public.aba_session_target_measurement_bindings%rowtype;
begin
  if not exists (
    select 1 from public.aba_sessions session_row
    where session_row.id = new.session_id
      and session_row.patient_id = new.patient_id
      and session_row.clinic_id = new.organization_id::text
  ) then raise exception 'ABA_V3_SESSION_BEHAVIOR_BINDING_SESSION_SCOPE_INVALID'; end if;

  if not exists (
    select 1 from public.aba_behavior_definitions behavior
    where behavior.id = new.behavior_id
      and behavior.patient_id = new.patient_id
      and behavior.clinic_id = new.organization_id::text
  ) then raise exception 'ABA_V3_SESSION_BEHAVIOR_BINDING_BEHAVIOR_SCOPE_INVALID'; end if;

  if new.behavior_target_binding_id is null then
    return new;
  end if;

  select * into v_map from public.aba_behavior_target_bindings_v3
  where id = new.behavior_target_binding_id;
  if not found
     or v_map.organization_id is distinct from new.organization_id
     or v_map.patient_id is distinct from new.patient_id
     or v_map.behavior_id is distinct from new.behavior_id
     or v_map.target_id is distinct from new.target_id then
    raise exception 'ABA_V3_SESSION_BEHAVIOR_BINDING_MAP_SCOPE_INVALID';
  end if;

  select * into v_target_binding from public.aba_session_target_measurement_bindings
  where id = new.session_target_measurement_binding_id;
  if not found
     or v_target_binding.organization_id is distinct from new.organization_id
     or v_target_binding.patient_id is distinct from new.patient_id
     or v_target_binding.session_id is distinct from new.session_id
     or v_target_binding.target_id is distinct from new.target_id
     or v_target_binding.measurement_model_version is distinct from new.measurement_model_version then
    raise exception 'ABA_V3_SESSION_BEHAVIOR_BINDING_TARGET_SCOPE_INVALID';
  end if;
  return new;
end;
$function$;

drop trigger if exists validate_aba_session_behavior_collection_binding_v3 on public.aba_session_behavior_collection_bindings_v3;
create trigger validate_aba_session_behavior_collection_binding_v3
before insert on public.aba_session_behavior_collection_bindings_v3
for each row execute function public.validate_aba_session_behavior_collection_binding_v3();

create or replace function public.validate_aba_behavior_target_binding_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  if not exists (
    select 1 from public.aba_behavior_definitions behavior
    where behavior.id = new.behavior_id
      and behavior.patient_id = new.patient_id
      and behavior.clinic_id = new.organization_id::text
  ) then
    raise exception 'ABA_V3_BEHAVIOR_BINDING_BEHAVIOR_SCOPE_INVALID';
  end if;

  if not exists (
    select 1 from public.aba_targets target
    where target.id = new.target_id
      and target.patient_id = new.patient_id
      and target.clinic_id = new.organization_id::text
      and lower(target.target_type) = 'behavior'
  ) then
    raise exception 'ABA_V3_BEHAVIOR_BINDING_TARGET_SCOPE_INVALID';
  end if;
  return new;
end;
$function$;

drop trigger if exists validate_aba_behavior_target_binding_v3 on public.aba_behavior_target_bindings_v3;
create trigger validate_aba_behavior_target_binding_v3
before insert or update on public.aba_behavior_target_bindings_v3
for each row execute function public.validate_aba_behavior_target_binding_v3();

create or replace function public.guard_aba_behavior_target_binding_mutation_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'ABA_V3_BEHAVIOR_BINDING_DELETE_FORBIDDEN';
  end if;
  if old.organization_id is distinct from new.organization_id
     or old.patient_id is distinct from new.patient_id
     or old.behavior_id is distinct from new.behavior_id
     or old.target_id is distinct from new.target_id
     or old.created_by is distinct from new.created_by
     or old.created_at is distinct from new.created_at then
    raise exception 'ABA_V3_BEHAVIOR_BINDING_IDENTITY_IMMUTABLE';
  end if;
  if old.status <> 'ACTIVE' or new.status <> 'ARCHIVED' then
    raise exception 'ABA_V3_BEHAVIOR_BINDING_TRANSITION_INVALID';
  end if;
  return new;
end;
$function$;

drop trigger if exists guard_aba_behavior_target_binding_mutation_v3 on public.aba_behavior_target_bindings_v3;
create trigger guard_aba_behavior_target_binding_mutation_v3
before update or delete on public.aba_behavior_target_bindings_v3
for each row execute function public.guard_aba_behavior_target_binding_mutation_v3();

create or replace function public.bind_aba_behavior_target_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_behavior_id text,
  p_target_id text,
  p_actor_id uuid
)
returns public.aba_behavior_target_bindings_v3
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_role text;
  v_existing public.aba_behavior_target_bindings_v3%rowtype;
  v_result public.aba_behavior_target_bindings_v3%rowtype;
begin
  if p_actor_id is null then raise exception 'ABA_V3_BEHAVIOR_BINDING_ACTOR_REQUIRED'; end if;
  v_role := public.verto_clinic_actor_role_v1(p_actor_id, p_organization_id);
  if coalesce(v_role,'') not in ('owner','admin','director','coordinator') then
    raise exception 'ABA_V3_BEHAVIOR_BINDING_ACCESS_DENIED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'aba-v3-behavior-target:' || p_organization_id::text || ':' || p_patient_id::text || ':' || p_behavior_id, 0
  ));

  select * into v_existing
  from public.aba_behavior_target_bindings_v3 binding
  where binding.organization_id = p_organization_id
    and binding.patient_id = p_patient_id
    and binding.behavior_id = p_behavior_id
    and binding.status = 'ACTIVE'
  for update;

  if found then
    if v_existing.target_id = p_target_id then return v_existing; end if;
    raise exception 'ABA_V3_BEHAVIOR_BINDING_ALREADY_ACTIVE';
  end if;

  insert into public.aba_behavior_target_bindings_v3(
    organization_id, patient_id, behavior_id, target_id, created_by
  ) values (
    p_organization_id, p_patient_id, p_behavior_id, p_target_id, p_actor_id
  ) returning * into v_result;
  return v_result;
end;
$function$;

create or replace function public.archive_aba_behavior_target_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_behavior_id text,
  p_actor_id uuid,
  p_reason text
)
returns public.aba_behavior_target_bindings_v3
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_role text;
  v_existing public.aba_behavior_target_bindings_v3%rowtype;
  v_result public.aba_behavior_target_bindings_v3%rowtype;
  v_reason text := btrim(coalesce(p_reason,''));
begin
  if p_actor_id is null then raise exception 'ABA_V3_BEHAVIOR_BINDING_ACTOR_REQUIRED'; end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'ABA_V3_BEHAVIOR_BINDING_ARCHIVE_REASON_INVALID';
  end if;

  v_role := public.verto_clinic_actor_role_v1(p_actor_id, p_organization_id);
  if coalesce(v_role,'') not in ('owner','admin','director','coordinator') then
    raise exception 'ABA_V3_BEHAVIOR_BINDING_ACCESS_DENIED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'aba-v3-behavior-target:' || p_organization_id::text || ':' || p_patient_id::text || ':' || p_behavior_id, 0
  ));

  select * into v_existing
  from public.aba_behavior_target_bindings_v3 binding
  where binding.organization_id = p_organization_id
    and binding.patient_id = p_patient_id
    and binding.behavior_id = p_behavior_id
    and binding.status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'ABA_V3_BEHAVIOR_BINDING_ACTIVE_NOT_FOUND';
  end if;

  -- Historical session-target bindings stay immutable. Archiving only affects the
  -- decision for future session+behavior resolution.
  update public.aba_behavior_target_bindings_v3
  set status = 'ARCHIVED',
      archived_by = p_actor_id,
      archived_at = now(),
      archive_reason = v_reason
  where id = v_existing.id
  returning * into v_result;

  return v_result;
end;
$function$;

-- Resolve behavior collection without guessing. Unmapped behavior remains Legacy V2.
create or replace function public.resolve_aba_behavior_collection_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_behavior_id text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_behavior public.aba_behavior_definitions%rowtype;
  v_map public.aba_behavior_target_bindings_v3%rowtype;
  v_binding public.aba_session_target_measurement_bindings%rowtype;
  v_session_binding public.aba_session_behavior_collection_bindings_v3%rowtype;
  v_role text;
begin
  if p_actor_id is null then raise exception 'ABA_V3_BEHAVIOR_COLLECTION_ACTOR_REQUIRED'; end if;
  v_role := public.verto_clinic_actor_role_v1(p_actor_id, p_organization_id);
  if coalesce(v_role,'') not in ('owner','admin','director','coordinator','therapist') then
    raise exception 'ABA_V3_BEHAVIOR_ACCESS_DENIED';
  end if;
  if not exists (
    select 1 from public.aba_sessions session_row
    where session_row.id = p_session_id
      and session_row.patient_id = p_patient_id
      and session_row.clinic_id = p_organization_id::text
  ) then raise exception 'ABA_V3_BEHAVIOR_SESSION_SCOPE_INVALID'; end if;

  select * into v_behavior from public.aba_behavior_definitions behavior
  where behavior.id = p_behavior_id
    and behavior.patient_id = p_patient_id
    and behavior.clinic_id = p_organization_id::text;

  if not found then
    return jsonb_build_object(
      'measurement_model_version','LEGACY_V2',
      'behavior_id', p_behavior_id,
      'target_id', null,
      'binding_reason','BEHAVIOR_NOT_CANONICALLY_DEFINED'
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'aba-v3-session-behavior:' || p_organization_id::text || ':' || p_patient_id::text || ':' || p_session_id || ':' || p_behavior_id, 0
  ));

  select * into v_session_binding
  from public.aba_session_behavior_collection_bindings_v3 binding
  where binding.organization_id = p_organization_id
    and binding.patient_id = p_patient_id
    and binding.session_id = p_session_id
    and binding.behavior_id = p_behavior_id;

  if found then
    if v_session_binding.session_target_measurement_binding_id is not null then
      select * into v_binding from public.aba_session_target_measurement_bindings
      where id = v_session_binding.session_target_measurement_binding_id;
      if not found then raise exception 'ABA_V3_SESSION_BEHAVIOR_BINDING_TARGET_MISSING'; end if;
    end if;

    return jsonb_build_object(
      'measurement_model_version', v_session_binding.measurement_model_version,
      'behavior_id', p_behavior_id,
      'target_id', v_session_binding.target_id,
      'session_behavior_binding_id', v_session_binding.id,
      'session_target_binding_id', v_session_binding.session_target_measurement_binding_id,
      'collection_definition_version_id', v_binding.collection_definition_version_id,
      'target_phase_assignment_id', v_binding.target_phase_assignment_id,
      'binding_reason', v_session_binding.binding_reason
    );
  end if;

  select * into v_map from public.aba_behavior_target_bindings_v3 binding
  where binding.organization_id = p_organization_id
    and binding.patient_id = p_patient_id
    and binding.behavior_id = p_behavior_id
    and binding.status = 'ACTIVE';

  if not found then
    insert into public.aba_session_behavior_collection_bindings_v3(
      organization_id, patient_id, session_id, behavior_id,
      measurement_model_version, binding_reason, bound_by
    ) values (
      p_organization_id, p_patient_id, p_session_id, p_behavior_id,
      'LEGACY_V2', 'BEHAVIOR_TARGET_NOT_EXPLICITLY_BOUND', p_actor_id
    ) returning * into v_session_binding;

    return jsonb_build_object(
      'measurement_model_version','LEGACY_V2',
      'behavior_id', p_behavior_id,
      'target_id', null,
      'session_behavior_binding_id', v_session_binding.id,
      'binding_reason', v_session_binding.binding_reason
    );
  end if;

  v_binding := public.resolve_aba_session_target_measurement_binding_v1(
    p_organization_id, p_patient_id, p_session_id, v_map.target_id, p_actor_id
  );

  insert into public.aba_session_behavior_collection_bindings_v3(
    organization_id, patient_id, session_id, behavior_id,
    behavior_target_binding_id, target_id, session_target_measurement_binding_id,
    measurement_model_version, binding_reason, bound_by
  ) values (
    p_organization_id, p_patient_id, p_session_id, p_behavior_id,
    v_map.id, v_map.target_id, v_binding.id,
    v_binding.measurement_model_version, v_binding.binding_reason, p_actor_id
  ) returning * into v_session_binding;

  return jsonb_build_object(
    'measurement_model_version', v_binding.measurement_model_version,
    'behavior_id', p_behavior_id,
    'target_id', v_map.target_id,
    'session_behavior_binding_id', v_session_binding.id,
    'session_target_binding_id', v_binding.id,
    'collection_definition_version_id', v_binding.collection_definition_version_id,
    'target_phase_assignment_id', v_binding.target_phase_assignment_id,
    'binding_reason', v_binding.binding_reason
  );
end;
$function$;

-- Internal segment resolver used by behavior + interval writers.
create or replace function public.ensure_aba_behavior_segment_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_behavior_id text,
  p_actor_id uuid,
  p_effective_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_resolution jsonb;
  v_context public.aba_behavior_contexts_v3%rowtype;
  v_collector public.aba_behavior_collector_bindings_v3%rowtype;
  v_session public.aba_sessions%rowtype;
  v_role text;
  v_effective_at timestamptz := coalesce(p_effective_at, now());
begin
  v_resolution := public.resolve_aba_behavior_collection_v3(
    p_organization_id, p_patient_id, p_session_id, p_behavior_id, p_actor_id
  );
  if coalesce(v_resolution ->> 'measurement_model_version','') <> 'V3' then
    raise exception 'ABA_V3_BEHAVIOR_NOT_V3';
  end if;

  v_role := public.verto_clinic_actor_role_v1(p_actor_id, p_organization_id);
  if coalesce(v_role,'') not in ('owner','admin','director','coordinator','therapist') then
    raise exception 'ABA_V3_BEHAVIOR_ACCESS_DENIED';
  end if;

  select * into v_session from public.aba_sessions session_row
  where session_row.id = p_session_id
    and session_row.patient_id = p_patient_id
    and session_row.clinic_id = p_organization_id::text;
  if not found then raise exception 'ABA_V3_BEHAVIOR_SESSION_SCOPE_INVALID'; end if;
  if v_effective_at < v_session.started_at
     or (v_session.ended_at is not null and v_effective_at > v_session.ended_at) then
    raise exception 'ABA_V3_BEHAVIOR_EFFECTIVE_TIME_OUTSIDE_SESSION';
  end if;

  insert into public.aba_behavior_contexts_v3(
    organization_id, patient_id, behavior_id, context_key, label, status, created_by
  ) values (
    p_organization_id, p_patient_id, p_behavior_id, 'SESSION_DEFAULT', 'Sessão', 'ACTIVE', p_actor_id
  )
  on conflict (organization_id, patient_id, behavior_id, context_key)
  do nothing;

  select * into v_context from public.aba_behavior_contexts_v3 context
  where context.organization_id = p_organization_id
    and context.patient_id = p_patient_id
    and context.behavior_id = p_behavior_id
    and context.context_key = 'SESSION_DEFAULT';
  if not found or v_context.status <> 'ACTIVE' then
    raise exception 'ABA_V3_BEHAVIOR_CONTEXT_NOT_ACTIVE';
  end if;

  select * into v_collector from public.aba_behavior_collector_bindings_v3 collector
  where collector.session_id = p_session_id
    and collector.behavior_id = p_behavior_id
    and collector.context_id = v_context.id
    and collector.collector_user_id = p_actor_id;

  if not found then
    if exists (
      select 1 from public.aba_behavior_collector_bindings_v3 collector
      where collector.session_id = p_session_id
        and collector.behavior_id = p_behavior_id
        and collector.context_id = v_context.id
        and collector.collector_role = 'PRIMARY'
        and collector.ended_at is null
        and collector.collector_user_id <> p_actor_id
    ) then
      raise exception 'ABA_V3_BEHAVIOR_PRIMARY_COLLECTOR_ALREADY_ASSIGNED';
    end if;

    insert into public.aba_behavior_collector_bindings_v3(
      organization_id, patient_id, session_id, behavior_id, context_id,
      collector_user_id, collector_role, bound_at, metadata
    ) values (
      p_organization_id, p_patient_id, p_session_id, p_behavior_id, v_context.id,
      p_actor_id, 'PRIMARY', v_effective_at, jsonb_build_object('source','PR9B_SESSION_UI')
    ) returning * into v_collector;
  end if;

  if v_collector.collector_role <> 'PRIMARY' or v_collector.ended_at is not null then
    raise exception 'ABA_V3_BEHAVIOR_PRIMARY_COLLECTOR_INVALID';
  end if;
  if v_effective_at < v_collector.bound_at
     or (v_collector.ended_at is not null and v_effective_at >= v_collector.ended_at) then
    raise exception 'ABA_V3_BEHAVIOR_COLLECTOR_TIME_OUTSIDE_BINDING';
  end if;

  return v_resolution || jsonb_build_object(
    'context_id', v_context.id,
    'collector_binding_id', v_collector.id,
    'collector_user_id', v_collector.collector_user_id,
    'collector_role', v_collector.collector_role
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Behavior actions. Frequency/rate events are append-only. Duration and rate
-- observation timers have a single guarded OPEN -> CLOSED transition.
-- ---------------------------------------------------------------------------
create or replace function public.record_aba_behavior_action_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_behavior_id text,
  p_action_type text,
  p_client_event_id text,
  p_occurred_at timestamptz,
  p_actor_id uuid,
  p_episode_event_id text default null,
  p_count_delta integer default 1,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_segment jsonb;
  v_context_id uuid;
  v_collector_id uuid;
  v_action text := upper(trim(coalesce(p_action_type,'')));
  v_measurement text;
  v_hash text;
  v_existing_event public.aba_behavior_events_v3%rowtype;
  v_existing_slice public.aba_behavior_observation_slices_v3%rowtype;
  v_event_id uuid;
  v_slice_id uuid;
begin
  if p_actor_id is null then raise exception 'ABA_V3_BEHAVIOR_ACTOR_REQUIRED'; end if;
  if btrim(coalesce(p_client_event_id,'')) = '' then raise exception 'ABA_V3_BEHAVIOR_CLIENT_EVENT_REQUIRED'; end if;
  if p_occurred_at is null then raise exception 'ABA_V3_BEHAVIOR_OCCURRED_AT_REQUIRED'; end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then raise exception 'ABA_V3_BEHAVIOR_METADATA_INVALID'; end if;
  if v_action not in ('FREQUENCY','RATE_OCCURRENCE','DURATION_START','DURATION_STOP','OBSERVATION_START','OBSERVATION_STOP') then
    raise exception 'ABA_V3_BEHAVIOR_ACTION_INVALID';
  end if;

  select lower(behavior.measurement_type) into v_measurement
  from public.aba_behavior_definitions behavior
  where behavior.id = p_behavior_id
    and behavior.patient_id = p_patient_id
    and behavior.clinic_id = p_organization_id::text;
  if not found then raise exception 'ABA_V3_BEHAVIOR_DEFINITION_NOT_FOUND'; end if;

  if v_action = 'FREQUENCY' and v_measurement <> 'frequency' then raise exception 'ABA_V3_BEHAVIOR_METHOD_MISMATCH'; end if;
  if v_action in ('RATE_OCCURRENCE','OBSERVATION_START','OBSERVATION_STOP') and v_measurement <> 'rate' then raise exception 'ABA_V3_BEHAVIOR_METHOD_MISMATCH'; end if;
  if v_action in ('DURATION_START','DURATION_STOP') and v_measurement <> 'duration' then raise exception 'ABA_V3_BEHAVIOR_METHOD_MISMATCH'; end if;

  v_segment := public.ensure_aba_behavior_segment_v3(
    p_organization_id, p_patient_id, p_session_id, p_behavior_id, p_actor_id, p_occurred_at
  );
  v_context_id := (v_segment ->> 'context_id')::uuid;
  v_collector_id := (v_segment ->> 'collector_binding_id')::uuid;

  v_hash := encode(digest(convert_to(jsonb_build_object(
    'organization_id',p_organization_id,'patient_id',p_patient_id,'session_id',p_session_id,
    'behavior_id',p_behavior_id,'action_type',v_action,'client_event_id',p_client_event_id,
    'episode_event_id',p_episode_event_id,'occurred_at',p_occurred_at,
    'count_delta',p_count_delta,'metadata',p_metadata
  )::text,'UTF8'),'sha256'),'hex');

  if v_action in ('FREQUENCY','RATE_OCCURRENCE') then
    if coalesce(p_count_delta,0) <= 0 or p_count_delta > 1000 then raise exception 'ABA_V3_BEHAVIOR_COUNT_INVALID'; end if;
    select * into v_existing_event from public.aba_behavior_events_v3 event
    where event.organization_id = p_organization_id and event.client_event_id = p_client_event_id;
    if found then
      if v_existing_event.payload_hash <> v_hash then raise exception 'ABA_V3_BEHAVIOR_IDEMPOTENCY_CONFLICT'; end if;
      return v_segment || jsonb_build_object('event_id',v_existing_event.id,'inserted',false);
    end if;

    insert into public.aba_behavior_events_v3(
      organization_id,patient_id,session_id,behavior_id,context_id,collector_binding_id,
      collector_user_id,collector_role,client_event_id,measurement_kind,count_delta,
      occurred_at,payload_hash,metadata
    ) values (
      p_organization_id,p_patient_id,p_session_id,p_behavior_id,v_context_id,v_collector_id,
      p_actor_id,'PRIMARY',p_client_event_id,'FREQUENCY',p_count_delta,
      p_occurred_at,v_hash,p_metadata || jsonb_build_object('measurement_type',v_measurement)
    ) returning id into v_event_id;
    return v_segment || jsonb_build_object('event_id',v_event_id,'inserted',true);
  end if;

  if v_action = 'DURATION_START' then
    select * into v_existing_event from public.aba_behavior_events_v3 event
    where event.organization_id = p_organization_id and event.client_event_id = p_client_event_id;
    if found then
      if v_existing_event.payload_hash <> v_hash then raise exception 'ABA_V3_BEHAVIOR_IDEMPOTENCY_CONFLICT'; end if;
      return v_segment || jsonb_build_object('event_id',v_existing_event.id,'inserted',false,'open',v_existing_event.ended_at is null);
    end if;

    insert into public.aba_behavior_events_v3(
      organization_id,patient_id,session_id,behavior_id,context_id,collector_binding_id,
      collector_user_id,collector_role,client_event_id,measurement_kind,count_delta,
      occurred_at,started_at,payload_hash,metadata
    ) values (
      p_organization_id,p_patient_id,p_session_id,p_behavior_id,v_context_id,v_collector_id,
      p_actor_id,'PRIMARY',p_client_event_id,'DURATION',null,
      p_occurred_at,p_occurred_at,v_hash,p_metadata || jsonb_build_object('measurement_type','duration')
    ) returning id into v_event_id;
    return v_segment || jsonb_build_object('event_id',v_event_id,'inserted',true,'open',true);
  end if;

  if v_action = 'DURATION_STOP' then
    if btrim(coalesce(p_episode_event_id,'')) = '' then raise exception 'ABA_V3_BEHAVIOR_EPISODE_REQUIRED'; end if;
    select * into v_existing_event from public.aba_behavior_events_v3 event
    where event.organization_id = p_organization_id
      and event.patient_id = p_patient_id
      and event.session_id = p_session_id
      and event.behavior_id = p_behavior_id
      and event.client_event_id = p_episode_event_id
      and event.measurement_kind = 'DURATION'
    for update;
    if not found then raise exception 'ABA_V3_BEHAVIOR_DURATION_EPISODE_NOT_FOUND'; end if;
    if v_existing_event.ended_at is not null then
      if coalesce(v_existing_event.metadata ->> 'stop_client_event_id','') = p_client_event_id then
        if coalesce(v_existing_event.metadata ->> 'stop_payload_hash','') <> v_hash then
          raise exception 'ABA_V3_BEHAVIOR_IDEMPOTENCY_CONFLICT';
        end if;
        return v_segment || jsonb_build_object('event_id',v_existing_event.id,'inserted',false,'open',false);
      end if;
      raise exception 'ABA_V3_BEHAVIOR_DURATION_ALREADY_CLOSED';
    end if;
    if p_occurred_at <= v_existing_event.started_at then raise exception 'ABA_V3_BEHAVIOR_DURATION_END_INVALID'; end if;

    update public.aba_behavior_events_v3
    set ended_at = p_occurred_at,
        end_reason = 'USER_STOP',
        metadata = metadata || p_metadata || jsonb_build_object(
          'stop_client_event_id',p_client_event_id,
          'stop_payload_hash',v_hash
        )
    where id = v_existing_event.id
    returning id into v_event_id;
    return v_segment || jsonb_build_object('event_id',v_event_id,'inserted',true,'open',false);
  end if;

  if v_action = 'OBSERVATION_START' then
    select * into v_existing_slice from public.aba_behavior_observation_slices_v3 slice
    where slice.organization_id = p_organization_id and slice.client_event_id = p_client_event_id;
    if found then
      if v_existing_slice.payload_hash <> v_hash then raise exception 'ABA_V3_BEHAVIOR_IDEMPOTENCY_CONFLICT'; end if;
      return v_segment || jsonb_build_object('observation_slice_id',v_existing_slice.id,'inserted',false,'open',v_existing_slice.ended_at is null);
    end if;

    insert into public.aba_behavior_observation_slices_v3(
      organization_id,patient_id,session_id,behavior_id,context_id,collector_binding_id,
      collector_user_id,collector_role,client_event_id,started_at,payload_hash,metadata
    ) values (
      p_organization_id,p_patient_id,p_session_id,p_behavior_id,v_context_id,v_collector_id,
      p_actor_id,'PRIMARY',p_client_event_id,p_occurred_at,v_hash,p_metadata || jsonb_build_object('measurement_type','rate')
    ) returning id into v_slice_id;
    return v_segment || jsonb_build_object('observation_slice_id',v_slice_id,'inserted',true,'open',true);
  end if;

  if v_action = 'OBSERVATION_STOP' then
    if btrim(coalesce(p_episode_event_id,'')) = '' then raise exception 'ABA_V3_BEHAVIOR_OBSERVATION_REQUIRED'; end if;
    select * into v_existing_slice from public.aba_behavior_observation_slices_v3 slice
    where slice.organization_id = p_organization_id
      and slice.patient_id = p_patient_id
      and slice.session_id = p_session_id
      and slice.behavior_id = p_behavior_id
      and slice.client_event_id = p_episode_event_id
    for update;
    if not found then raise exception 'ABA_V3_BEHAVIOR_OBSERVATION_NOT_FOUND'; end if;
    if v_existing_slice.ended_at is not null then
      if coalesce(v_existing_slice.metadata ->> 'stop_client_event_id','') = p_client_event_id then
        if coalesce(v_existing_slice.metadata ->> 'stop_payload_hash','') <> v_hash then
          raise exception 'ABA_V3_BEHAVIOR_IDEMPOTENCY_CONFLICT';
        end if;
        return v_segment || jsonb_build_object('observation_slice_id',v_existing_slice.id,'inserted',false,'open',false);
      end if;
      raise exception 'ABA_V3_BEHAVIOR_OBSERVATION_ALREADY_CLOSED';
    end if;
    if p_occurred_at <= v_existing_slice.started_at then raise exception 'ABA_V3_BEHAVIOR_OBSERVATION_END_INVALID'; end if;

    update public.aba_behavior_observation_slices_v3
    set ended_at = p_occurred_at,
        close_reason = 'USER_STOP',
        metadata = metadata || p_metadata || jsonb_build_object(
          'stop_client_event_id',p_client_event_id,
          'stop_payload_hash',v_hash
        )
    where id = v_existing_slice.id
    returning id into v_slice_id;
    return v_segment || jsonb_build_object('observation_slice_id',v_slice_id,'inserted',true,'open',false);
  end if;

  raise exception 'ABA_V3_BEHAVIOR_ACTION_UNREACHABLE';
end;
$function$;

-- ---------------------------------------------------------------------------
-- Interval collection wrappers. Run creation is idempotent and uses the same
-- PRIMARY behavior collector; observations reuse PR7 bulk/idempotency engine.
-- ---------------------------------------------------------------------------
create or replace function public.start_aba_interval_run_action_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_behavior_id text,
  p_client_run_event_id text,
  p_measurement_method text,
  p_interval_seconds integer,
  p_planned_intervals integer,
  p_started_at timestamptz,
  p_actor_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_segment jsonb;
  v_method text := upper(trim(coalesce(p_measurement_method,'')));
  v_expected_method text;
  v_hash text;
  v_existing public.aba_interval_runs_v3%rowtype;
  v_run public.aba_interval_runs_v3%rowtype;
begin
  if p_actor_id is null then raise exception 'ABA_V3_INTERVAL_ACTOR_REQUIRED'; end if;
  if btrim(coalesce(p_client_run_event_id,'')) = '' then raise exception 'ABA_V3_INTERVAL_CLIENT_RUN_REQUIRED'; end if;
  if p_interval_seconds < 1 or p_interval_seconds > 3600 then raise exception 'ABA_V3_INTERVAL_SECONDS_INVALID'; end if;
  if p_planned_intervals < 1 or p_planned_intervals > 200 then raise exception 'ABA_V3_INTERVAL_COUNT_INVALID'; end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then raise exception 'ABA_V3_INTERVAL_METADATA_INVALID'; end if;
  if v_method not in ('PARTIAL_INTERVAL','WHOLE_INTERVAL','MOMENTARY_TIME_SAMPLING') then raise exception 'ABA_V3_INTERVAL_METHOD_INVALID'; end if;

  select upper(behavior.measurement_type) into v_expected_method
  from public.aba_behavior_definitions behavior
  where behavior.id = p_behavior_id
    and behavior.patient_id = p_patient_id
    and behavior.clinic_id = p_organization_id::text;
  if not found or v_expected_method <> v_method then raise exception 'ABA_V3_BEHAVIOR_METHOD_MISMATCH'; end if;

  v_segment := public.ensure_aba_behavior_segment_v3(
    p_organization_id,p_patient_id,p_session_id,p_behavior_id,p_actor_id,p_started_at
  );

  v_hash := encode(digest(convert_to(jsonb_build_object(
    'organization_id',p_organization_id,'patient_id',p_patient_id,'session_id',p_session_id,
    'behavior_id',p_behavior_id,'client_run_event_id',p_client_run_event_id,
    'measurement_method',v_method,'interval_seconds',p_interval_seconds,
    'planned_intervals',p_planned_intervals,'started_at',p_started_at,'metadata',p_metadata
  )::text,'UTF8'),'sha256'),'hex');

  select * into v_existing from public.aba_interval_runs_v3 run
  where run.organization_id = p_organization_id and run.client_run_event_id = p_client_run_event_id;
  if found then
    if v_existing.payload_hash <> v_hash then raise exception 'ABA_V3_INTERVAL_IDEMPOTENCY_CONFLICT'; end if;
    return v_segment || jsonb_build_object(
      'interval_run_id',v_existing.id,'inserted',false,'lifecycle_status',v_existing.lifecycle_status
    );
  end if;

  insert into public.aba_interval_runs_v3(
    organization_id,patient_id,session_id,behavior_id,context_id,
    primary_collector_binding_id,client_run_event_id,payload_hash,
    measurement_method,interval_seconds,planned_intervals,started_at,created_by,metadata
  ) values (
    p_organization_id,p_patient_id,p_session_id,p_behavior_id,(v_segment ->> 'context_id')::uuid,
    (v_segment ->> 'collector_binding_id')::uuid,p_client_run_event_id,v_hash,
    v_method,p_interval_seconds,p_planned_intervals,p_started_at,p_actor_id,p_metadata
  ) returning * into v_run;

  return v_segment || jsonb_build_object(
    'interval_run_id',v_run.id,'inserted',true,'lifecycle_status',v_run.lifecycle_status
  );
end;
$function$;

create or replace function public.record_aba_interval_observation_action_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_interval_run_id uuid,
  p_interval_index integer,
  p_observation_code text,
  p_client_event_id text,
  p_actor_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_run public.aba_interval_runs_v3%rowtype;
  v_binding public.aba_behavior_collector_bindings_v3%rowtype;
  v_result jsonb;
begin
  if p_actor_id is null then raise exception 'ABA_V3_INTERVAL_ACTOR_REQUIRED'; end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then raise exception 'ABA_V3_INTERVAL_METADATA_INVALID'; end if;

  select * into v_run from public.aba_interval_runs_v3 run
  where run.id = p_interval_run_id
    and run.organization_id = p_organization_id
    and run.patient_id = p_patient_id
    and run.session_id = p_session_id;
  if not found then raise exception 'ABA_V3_INTERVAL_RUN_SCOPE_INVALID'; end if;

  select * into v_binding from public.aba_behavior_collector_bindings_v3 collector
  where collector.id = v_run.primary_collector_binding_id;
  if not found or v_binding.collector_user_id <> p_actor_id or v_binding.collector_role <> 'PRIMARY' then
    raise exception 'ABA_V3_INTERVAL_COLLECTOR_SCOPE_INVALID';
  end if;

  v_result := public.record_aba_interval_observations_bulk_v3(
    p_organization_id,
    p_patient_id,
    p_interval_run_id,
    v_run.primary_collector_binding_id,
    jsonb_build_array(jsonb_build_object(
      'interval_index',p_interval_index,
      'observation_code',upper(trim(coalesce(p_observation_code,''))),
      'client_event_id',p_client_event_id,
      'metadata',p_metadata
    ))
  );
  return v_result;
end;
$function$;

create or replace function public.finalize_aba_interval_run_action_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_interval_run_id uuid,
  p_ended_at timestamptz,
  p_close_reason text,
  p_actor_id uuid
)
returns public.aba_interval_runs_v3
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_run public.aba_interval_runs_v3%rowtype;
  v_binding public.aba_behavior_collector_bindings_v3%rowtype;
begin
  select * into v_run from public.aba_interval_runs_v3 run
  where run.id = p_interval_run_id
    and run.organization_id = p_organization_id
    and run.patient_id = p_patient_id
    and run.session_id = p_session_id;
  if not found then raise exception 'ABA_V3_INTERVAL_RUN_SCOPE_INVALID'; end if;

  select * into v_binding from public.aba_behavior_collector_bindings_v3 collector
  where collector.id = v_run.primary_collector_binding_id;
  if not found or v_binding.collector_user_id <> p_actor_id then
    raise exception 'ABA_V3_INTERVAL_COLLECTOR_SCOPE_INVALID';
  end if;

  return public.finalize_aba_interval_run_v3(
    p_interval_run_id,p_actor_id,p_ended_at,upper(trim(coalesce(p_close_reason,'CLIENT_COMPLETE')))
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Task-analysis collection wrappers. Definition and results are delivered as
-- categorical steps; no weighted prompt score is accepted from the browser.
-- ---------------------------------------------------------------------------
create or replace function public.get_aba_task_analysis_definition_for_session_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_target_id text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_target public.aba_targets%rowtype;
  v_binding public.aba_session_target_measurement_bindings%rowtype;
  v_steps jsonb;
begin
  select * into v_target from public.aba_targets target
  where target.id = p_target_id
    and target.patient_id = p_patient_id
    and target.clinic_id = p_organization_id::text;
  if not found or lower(v_target.target_type) <> 'task_analysis' then
    raise exception 'ABA_V3_TASK_ANALYSIS_TARGET_INVALID';
  end if;

  v_binding := public.resolve_aba_session_target_measurement_binding_v1(
    p_organization_id,p_patient_id,p_session_id,p_target_id,p_actor_id
  );
  if v_binding.measurement_model_version <> 'V3' then
    return jsonb_build_object(
      'measurement_model_version',v_binding.measurement_model_version,
      'target_id',p_target_id,
      'steps','[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',step.id,
    'sequence_no',step.sequence_no,
    'step_key',step.step_key,
    'label',step.label,
    'description',step.description,
    'is_required',step.is_required
  ) order by step.sequence_no),'[]'::jsonb)
  into v_steps
  from public.aba_task_analysis_step_definitions_v3 step
  where step.collection_definition_version_id = v_binding.collection_definition_version_id;

  if jsonb_array_length(v_steps) = 0 then raise exception 'ABA_V3_TASK_ANALYSIS_DEFINITION_STEPS_MISSING'; end if;

  return jsonb_build_object(
    'measurement_model_version','V3',
    'target_id',p_target_id,
    'binding_id',v_binding.id,
    'collection_definition_version_id',v_binding.collection_definition_version_id,
    'target_phase_assignment_id',v_binding.target_phase_assignment_id,
    'steps',v_steps
  );
end;
$function$;

create or replace function public.record_aba_task_analysis_action_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_target_id text,
  p_client_event_id text,
  p_occurred_at timestamptz,
  p_completed_at timestamptz,
  p_results jsonb,
  p_actor_id uuid,
  p_lifecycle_status text default 'COMPLETE',
  p_metadata jsonb default '{}'::jsonb
)
returns public.aba_task_analysis_runs_v3
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_target_type text;
  v_binding public.aba_session_target_measurement_bindings%rowtype;
begin
  select lower(target.target_type) into v_target_type from public.aba_targets target
  where target.id = p_target_id
    and target.patient_id = p_patient_id
    and target.clinic_id = p_organization_id::text;
  if not found or v_target_type <> 'task_analysis' then raise exception 'ABA_V3_TASK_ANALYSIS_TARGET_INVALID'; end if;

  v_binding := public.resolve_aba_session_target_measurement_binding_v1(
    p_organization_id,p_patient_id,p_session_id,p_target_id,p_actor_id
  );
  if v_binding.measurement_model_version <> 'V3' then raise exception 'ABA_V3_TARGET_NOT_V3'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_results) as result(
      sequence_no integer, performance_code text, prompt_key text, occurred_at timestamptz, metadata jsonb
    )
    left join public.aba_prompt_types prompt
      on prompt.organization_id = p_organization_id
     and prompt.key = result.prompt_key
     and prompt.active
     and prompt.show_in_session
    where result.performance_code = 'PROMPTED'
      and prompt.id is null
  ) then raise exception 'ABA_V3_TASK_ANALYSIS_PROMPT_NOT_CONFIGURED'; end if;

  return public.record_aba_task_analysis_run_v3(
    p_organization_id,p_patient_id,p_session_id,p_target_id,p_client_event_id,
    p_occurred_at,p_completed_at,p_results,p_actor_id,p_lifecycle_status,p_metadata
  );
end;
$function$;

-- Browser roles never touch PR9B tables/functions directly.
alter table public.aba_behavior_target_bindings_v3 enable row level security;
alter table public.aba_session_behavior_collection_bindings_v3 enable row level security;
revoke all on table public.aba_behavior_target_bindings_v3 from public, anon, authenticated;
revoke all on table public.aba_session_behavior_collection_bindings_v3 from public, anon, authenticated;
grant select on table public.aba_behavior_target_bindings_v3 to service_role;
grant select on table public.aba_session_behavior_collection_bindings_v3 to service_role;

revoke all on function public.validate_aba_behavior_target_binding_v3() from public, anon, authenticated;
revoke all on function public.guard_aba_behavior_target_binding_mutation_v3() from public, anon, authenticated;
revoke all on function public.validate_aba_session_behavior_collection_binding_v3() from public, anon, authenticated;
revoke all on function public.guard_aba_session_behavior_collection_binding_v3() from public, anon, authenticated;
revoke all on function public.bind_aba_behavior_target_v3(uuid,uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.archive_aba_behavior_target_v3(uuid,uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.resolve_aba_behavior_collection_v3(uuid,uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.ensure_aba_behavior_segment_v3(uuid,uuid,text,text,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.record_aba_behavior_action_v3(uuid,uuid,text,text,text,text,timestamptz,uuid,text,integer,jsonb) from public, anon, authenticated;
revoke all on function public.start_aba_interval_run_action_v3(uuid,uuid,text,text,text,text,integer,integer,timestamptz,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.record_aba_interval_observation_action_v3(uuid,uuid,text,uuid,integer,text,text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.finalize_aba_interval_run_action_v3(uuid,uuid,text,uuid,timestamptz,text,uuid) from public, anon, authenticated;
revoke all on function public.get_aba_task_analysis_definition_for_session_v3(uuid,uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.record_aba_task_analysis_action_v3(uuid,uuid,text,text,text,timestamptz,timestamptz,jsonb,uuid,text,jsonb) from public, anon, authenticated;

grant execute on function public.bind_aba_behavior_target_v3(uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.archive_aba_behavior_target_v3(uuid,uuid,text,uuid,text) to service_role;
grant execute on function public.resolve_aba_behavior_collection_v3(uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.ensure_aba_behavior_segment_v3(uuid,uuid,text,text,uuid,timestamptz) to service_role;
grant execute on function public.record_aba_behavior_action_v3(uuid,uuid,text,text,text,text,timestamptz,uuid,text,integer,jsonb) to service_role;
grant execute on function public.start_aba_interval_run_action_v3(uuid,uuid,text,text,text,text,integer,integer,timestamptz,uuid,jsonb) to service_role;
grant execute on function public.record_aba_interval_observation_action_v3(uuid,uuid,text,uuid,integer,text,text,uuid,jsonb) to service_role;
grant execute on function public.finalize_aba_interval_run_action_v3(uuid,uuid,text,uuid,timestamptz,text,uuid) to service_role;
grant execute on function public.get_aba_task_analysis_definition_for_session_v3(uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.record_aba_task_analysis_action_v3(uuid,uuid,text,text,text,timestamptz,timestamptz,jsonb,uuid,text,jsonb) to service_role;

commit;

select
  to_regclass('public.aba_behavior_target_bindings_v3') is not null as behavior_target_binding_ready,
  to_regclass('public.aba_session_behavior_collection_bindings_v3') is not null as session_behavior_binding_ready,
  to_regprocedure('public.archive_aba_behavior_target_v3(uuid,uuid,text,uuid,text)') is not null as behavior_target_archive_ready,
  to_regprocedure('public.resolve_aba_behavior_collection_v3(uuid,uuid,text,text,uuid)') is not null as behavior_resolver_ready,
  to_regprocedure('public.record_aba_behavior_action_v3(uuid,uuid,text,text,text,text,timestamp with time zone,uuid,text,integer,jsonb)') is not null as behavior_action_ready,
  to_regprocedure('public.start_aba_interval_run_action_v3(uuid,uuid,text,text,text,text,integer,integer,timestamp with time zone,uuid,jsonb)') is not null as interval_start_ready,
  to_regprocedure('public.record_aba_interval_observation_action_v3(uuid,uuid,text,uuid,integer,text,text,uuid,jsonb)') is not null as interval_observation_ready,
  to_regprocedure('public.finalize_aba_interval_run_action_v3(uuid,uuid,text,uuid,timestamp with time zone,text,uuid)') is not null as interval_finalize_ready,
  to_regprocedure('public.get_aba_task_analysis_definition_for_session_v3(uuid,uuid,text,text,uuid)') is not null as task_definition_ready,
  to_regprocedure('public.record_aba_task_analysis_action_v3(uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,uuid,text,jsonb)') is not null as task_action_ready,
  not exists (
    select 1 from public.aba_measurement_rollout_states_v3 where allow_new_v3_sessions
  ) as no_new_v3_sessions_enabled;
