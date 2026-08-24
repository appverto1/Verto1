-- Verto Clinical Measurement Engine V3
-- Production schema catch-up promotion — SPLIT EXECUTION
--
-- IMPORTANT
--   Execute the four parts in numerical order, in PRODUCTION.
--   Each part is its own transaction and is independently fail-closed.
--   If any part fails, stop and send the error before continuing.
--   No part enables ABA V3 rollout or performs clinical backfill/shadow execution.

-- PART 2/4

begin;
set local lock_timeout = '5s';

do $cmv3_prod_split_part2_preflight$
declare
  v_missing text[] := '{}'::text[];
  v_present text[] := '{}'::text[];
  v_enabled bigint := 0;
begin
  if to_regprocedure('public.get_aba_session_read_bundle_v3(uuid,uuid,text)') is null then v_missing := array_append(v_missing,'part1:get_aba_session_read_bundle_v3'); end if;
  if to_regprocedure('public.record_aba_trial_action_v3(uuid,uuid,jsonb,text,uuid)') is null then v_missing := array_append(v_missing,'part1:record_aba_trial_action_v3'); end if;
  if to_regclass('public.clinical_measurement_targets_v3') is null then v_missing := array_append(v_missing,'part1:clinical_measurement_targets_v3'); end if;
  if cardinality(v_missing) > 0 then raise exception 'CMV3_SPLIT_PART2_REQUIRES_PART1:%', array_to_string(v_missing,', '); end if;

  if to_regclass('public.clinical_measurement_sessions_v3') is not null then v_present := array_append(v_present,'clinical_measurement_sessions_v3'); end if;
  if to_regclass('public.clinical_measurement_raw_events_v3') is not null then v_present := array_append(v_present,'clinical_measurement_raw_events_v3'); end if;
  if to_regclass('public.clinical_measurement_aba_trials_v3') is not null then v_present := array_append(v_present,'clinical_measurement_aba_trials_v3'); end if;
  if cardinality(v_present) > 0 then raise exception 'CMV3_SPLIT_PART2_ALREADY_OR_PARTIALLY_APPLIED:%', array_to_string(v_present,', '); end if;

  select count(*) into v_enabled from public.aba_measurement_rollout_states_v3 where allow_new_v3_sessions is true;
  if v_enabled <> 0 then raise exception 'CMV3_SPLIT_PART2_ACTIVE_ROLLOUT:%', v_enabled; end if;
end;
$cmv3_prod_split_part2_preflight$;

-- Embedded canonical block 04/12: 20260820144500_clinical_measurement_v3_sessions_expectations.sql
-- ===========================================================================
-- Verto Clinical Measurement Engine V3 - Migration B: sessions & expectations.
-- Additive/dark only. Creates the universal clinical-session identity, the frozen
-- expected measurement set for each session, and logical collection streams.
-- Does not mutate ABA V2, the existing ABA V3 implementation, routes, or writers.


create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Universal clinical measurement session.
-- clinical_date is derived exactly once from started_at + timezone_snapshot and
-- is then immutable. It is intentionally distinct from event occurrence dates.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_sessions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_key text not null,
  source_kind text not null default 'NATIVE_V3'
    check (source_kind in ('NATIVE_V3', 'ABA_SESSION')),
  aba_session_id text references public.aba_sessions(id) on delete restrict,
  status text not null default 'PREPARING'
    check (status in ('PREPARING', 'OPEN', 'FINALIZED', 'CANCELED')),
  started_at timestamptz not null,
  ended_at timestamptz,
  clinical_date date not null,
  clinical_date_policy text not null default 'SESSION_START_LOCAL_DATE'
    check (clinical_date_policy = 'SESSION_START_LOCAL_DATE'),
  timezone_snapshot text not null,
  timezone_offset_minutes integer not null
    check (timezone_offset_minutes between -900 and 900),
  recorded_at timestamptz not null default now(),
  expectations_sealed_at timestamptz,
  finalized_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_session_key_nonempty
    check (length(trim(session_key)) between 1 and 180),
  constraint cmv3_session_time_window
    check (ended_at is null or ended_at >= started_at),
  constraint cmv3_session_finalize_shape
    check (
      (status = 'FINALIZED' and ended_at is not null and finalized_at is not null)
      or (status <> 'FINALIZED' and finalized_at is null)
    ),
  constraint cmv3_session_expectation_seal_shape
    check (
      (status = 'PREPARING' and expectations_sealed_at is null)
      or (status in ('OPEN', 'FINALIZED') and expectations_sealed_at is not null)
      or status = 'CANCELED'
    ),
  constraint cmv3_session_source_shape check (
    (source_kind = 'NATIVE_V3' and aba_session_id is null)
    or (source_kind = 'ABA_SESSION' and aba_session_id is not null)
  ),
  unique (organization_id, patient_id, session_key),
  unique (id, organization_id, patient_id)
);

create unique index if not exists ux_cmv3_session_aba_source
  on public.clinical_measurement_sessions_v3 (organization_id, aba_session_id)
  where source_kind = 'ABA_SESSION';
create index if not exists idx_cmv3_sessions_patient_timeline
  on public.clinical_measurement_sessions_v3
  (organization_id, patient_id, clinical_date desc, started_at desc);
create index if not exists idx_cmv3_sessions_status
  on public.clinical_measurement_sessions_v3
  (organization_id, status, started_at desc);

-- ---------------------------------------------------------------------------
-- Frozen expected measurement set for a session.
-- A row means this measurement was explicitly expected for this session. We do
-- not materialize NOT_COLLECTED/NOT_SCHEDULED rows. Missingness is derived later
-- by comparing these expectations with accepted raw observations.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_session_expectations_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id uuid not null,
  target_id uuid not null,
  protocol_snapshot_id uuid not null,
  expectation_key text not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_expectation_key_nonempty
    check (length(trim(expectation_key)) between 1 and 180),
  foreign key (session_id, organization_id, patient_id)
    references public.clinical_measurement_sessions_v3(id, organization_id, patient_id)
    on delete restrict,
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id)
    on delete restrict,
  foreign key (protocol_snapshot_id, organization_id, patient_id, target_id)
    references public.clinical_collection_protocol_snapshots_v3(
      id, organization_id, patient_id, target_id
    ) on delete restrict,
  unique (session_id, expectation_key),
  unique (session_id, protocol_snapshot_id),
  unique (id, organization_id, patient_id, session_id, target_id)
);

create index if not exists idx_cmv3_expectations_session
  on public.clinical_measurement_session_expectations_v3
  (organization_id, patient_id, session_id, target_id);
create index if not exists idx_cmv3_expectations_target
  on public.clinical_measurement_session_expectations_v3
  (organization_id, patient_id, target_id, session_id);

-- ---------------------------------------------------------------------------
-- Logical collection stream. Device changes do not create a new PRIMARY stream.
-- Observation slices and raw events added later will bind to this stable identity.
-- One PRIMARY stream exists per expectation; RELIABILITY streams may be multiple
-- but must point to that expectation's PRIMARY stream.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_collection_streams_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id uuid not null,
  expectation_id uuid not null,
  target_id uuid not null,
  stream_key text not null,
  stream_role text not null
    check (stream_role in ('PRIMARY', 'RELIABILITY')),
  observer_membership_id uuid not null references public.clinic_memberships(id) on delete restrict,
  paired_primary_stream_id uuid,
  status text not null default 'OPEN'
    check (status in ('OPEN', 'CLOSED')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_stream_key_nonempty
    check (length(trim(stream_key)) between 1 and 180),
  constraint cmv3_stream_close_shape
    check ((status = 'OPEN' and closed_at is null) or (status = 'CLOSED' and closed_at is not null)),
  constraint cmv3_stream_pair_shape check (
    (stream_role = 'PRIMARY' and paired_primary_stream_id is null)
    or (stream_role = 'RELIABILITY' and paired_primary_stream_id is not null)
  ),
  foreign key (session_id, organization_id, patient_id)
    references public.clinical_measurement_sessions_v3(id, organization_id, patient_id)
    on delete restrict,
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(
      id, organization_id, patient_id, session_id, target_id
    ) on delete restrict,
  unique (session_id, expectation_id, stream_key),
  unique (id, organization_id, patient_id, session_id, expectation_id, target_id)
);

create unique index if not exists ux_cmv3_primary_stream_per_expectation
  on public.clinical_measurement_collection_streams_v3 (expectation_id)
  where stream_role = 'PRIMARY';
create unique index if not exists ux_cmv3_reliability_stream_per_observer
  on public.clinical_measurement_collection_streams_v3 (expectation_id, observer_membership_id)
  where stream_role = 'RELIABILITY';
create index if not exists idx_cmv3_streams_session
  on public.clinical_measurement_collection_streams_v3
  (organization_id, patient_id, session_id, expectation_id, stream_role);

-- Self-reference is added after table creation so RELIABILITY can point only to a
-- stream identity in the same tenant/session/expectation/target scope. Role is
-- additionally validated by trigger below.
do $cmv3_stream_pair_fk$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_collection_streams_v3'::regclass
      and conname = 'cmv3_stream_paired_primary_scope_fkey'
  ) then
    alter table public.clinical_measurement_collection_streams_v3
      add constraint cmv3_stream_paired_primary_scope_fkey
      foreign key (
        paired_primary_stream_id,
        organization_id,
        patient_id,
        session_id,
        expectation_id,
        target_id
      ) references public.clinical_measurement_collection_streams_v3 (
        id,
        organization_id,
        patient_id,
        session_id,
        expectation_id,
        target_id
      ) on delete restrict;
  end if;
end;
$cmv3_stream_pair_fk$;

-- ---------------------------------------------------------------------------
-- Server-owned temporal normalization and scope validation.
-- ---------------------------------------------------------------------------
create or replace function public.prepare_clinical_measurement_session_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_timezone text;
begin
  select zone.name
    into v_timezone
  from pg_catalog.pg_timezone_names zone
  where zone.name = nullif(trim(new.timezone_snapshot), '')
  limit 1;

  if v_timezone is null then
    raise exception 'CMV3_SESSION_TIMEZONE_INVALID';
  end if;

  new.timezone_snapshot := v_timezone;
  new.clinical_date := timezone(v_timezone, new.started_at)::date;
  new.timezone_offset_minutes := round(
    extract(epoch from (
      timezone(v_timezone, new.started_at)
      - timezone('UTC', new.started_at)
    )) / 60.0
  )::integer;
  new.recorded_at := clock_timestamp();
  new.created_at := new.recorded_at;

  if new.status <> 'PREPARING' then
    raise exception 'CMV3_SESSION_INSERT_MUST_PREPARE';
  end if;

  if new.ended_at is not null then
    raise exception 'CMV3_SESSION_PREPARING_END_FORBIDDEN';
  end if;

  new.expectations_sealed_at := null;
  new.finalized_at := null;

  return new;
end;
$function$;

create or replace function public.validate_clinical_measurement_session_scope_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_patient_clinic_id uuid;
  v_legacy_patient_id uuid;
  v_legacy_clinic_id text;
begin
  select patient.clinic_id
    into v_patient_clinic_id
  from public.patients patient
  where patient.id = new.patient_id;

  if not found or v_patient_clinic_id is distinct from new.organization_id then
    raise exception 'CMV3_SESSION_PATIENT_SCOPE_INVALID';
  end if;

  if new.source_kind = 'ABA_SESSION' then
    select session_row.patient_id, session_row.clinic_id
      into v_legacy_patient_id, v_legacy_clinic_id
    from public.aba_sessions session_row
    where session_row.id = new.aba_session_id;

    if not found
       or v_legacy_patient_id is distinct from new.patient_id
       or v_legacy_clinic_id is distinct from new.organization_id::text then
      raise exception 'CMV3_ABA_SESSION_SCOPE_INVALID';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.guard_clinical_measurement_session_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'CMV3_SESSION_DELETE_FORBIDDEN';
  end if;

  if (to_jsonb(old) - array['status', 'ended_at', 'expectations_sealed_at', 'finalized_at']::text[])
     is distinct from
     (to_jsonb(new) - array['status', 'ended_at', 'expectations_sealed_at', 'finalized_at']::text[]) then
    raise exception 'CMV3_SESSION_IDENTITY_IMMUTABLE';
  end if;

  if old.status in ('FINALIZED', 'CANCELED') then
    raise exception 'CMV3_SESSION_TERMINAL_STATE_IMMUTABLE';
  end if;

  if old.status = 'PREPARING' then
    if new.status = 'PREPARING' then
      if new.ended_at is not null
         or new.expectations_sealed_at is not null
         or new.finalized_at is not null then
        raise exception 'CMV3_SESSION_PREPARING_TEMPORAL_MUTATION_FORBIDDEN';
      end if;
      return new;
    end if;

    if new.status = 'OPEN' then
      if new.ended_at is not null or new.finalized_at is not null then
        raise exception 'CMV3_SESSION_OPEN_SHAPE_INVALID';
      end if;
      if not exists (
        select 1
        from public.clinical_measurement_session_expectations_v3 expectation
        where expectation.session_id = old.id
      ) then
        raise exception 'CMV3_SESSION_EXPECTATION_SET_EMPTY';
      end if;
      new.expectations_sealed_at := clock_timestamp();
      return new;
    end if;

    if new.status = 'CANCELED' then
      if exists (
        select 1
        from public.clinical_measurement_collection_streams_v3 stream
        where stream.session_id = old.id
          and stream.status = 'OPEN'
      ) then
        raise exception 'CMV3_SESSION_OPEN_STREAMS_EXIST';
      end if;
      new.expectations_sealed_at := old.expectations_sealed_at;
      new.finalized_at := null;
      return new;
    end if;

    raise exception 'CMV3_SESSION_STATUS_TRANSITION_INVALID';
  end if;

  if old.status = 'OPEN' then
    if new.status = 'OPEN' then
      if new.ended_at is distinct from old.ended_at
         or new.expectations_sealed_at is distinct from old.expectations_sealed_at
         or new.finalized_at is distinct from old.finalized_at then
        raise exception 'CMV3_SESSION_OPEN_TEMPORAL_MUTATION_FORBIDDEN';
      end if;
      return new;
    end if;

    if new.status in ('FINALIZED', 'CANCELED') and exists (
      select 1
      from public.clinical_measurement_collection_streams_v3 stream
      where stream.session_id = old.id
        and stream.status = 'OPEN'
    ) then
      raise exception 'CMV3_SESSION_OPEN_STREAMS_EXIST';
    end if;

    if new.status = 'FINALIZED' then
      if new.ended_at is null or new.ended_at < old.started_at then
        raise exception 'CMV3_SESSION_FINALIZED_END_INVALID';
      end if;
      new.expectations_sealed_at := old.expectations_sealed_at;
      new.finalized_at := clock_timestamp();
      return new;
    end if;

    if new.status = 'CANCELED' then
      new.expectations_sealed_at := old.expectations_sealed_at;
      new.finalized_at := null;
      return new;
    end if;

    raise exception 'CMV3_SESSION_STATUS_TRANSITION_INVALID';
  end if;

  raise exception 'CMV3_SESSION_STATUS_TRANSITION_INVALID';
end;
$function$;

create or replace function public.guard_clinical_measurement_expectation_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'CMV3_SESSION_EXPECTATION_IMMUTABLE';
end;
$function$;

create or replace function public.validate_clinical_measurement_expectation_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_session_status text;
begin
  select session_row.status
    into v_session_status
  from public.clinical_measurement_sessions_v3 session_row
  where session_row.id = new.session_id
    and session_row.organization_id = new.organization_id
    and session_row.patient_id = new.patient_id;

  if not found then
    raise exception 'CMV3_EXPECTATION_SESSION_SCOPE_INVALID';
  end if;

  if v_session_status <> 'PREPARING' then
    raise exception 'CMV3_EXPECTATION_SET_SEALED';
  end if;

  new.created_at := clock_timestamp();
  return new;
end;
$function$;

create or replace function public.validate_clinical_measurement_stream_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_session_status text;
  v_membership_clinic_id uuid;
  v_membership_status text;
  v_primary_role text;
  v_primary_observer_membership_id uuid;
begin
  select session_row.status
    into v_session_status
  from public.clinical_measurement_sessions_v3 session_row
  where session_row.id = new.session_id
    and session_row.organization_id = new.organization_id
    and session_row.patient_id = new.patient_id;

  if not found then
    raise exception 'CMV3_STREAM_SESSION_SCOPE_INVALID';
  end if;

  if tg_op = 'INSERT' and v_session_status not in ('PREPARING', 'OPEN') then
    raise exception 'CMV3_STREAM_SESSION_NOT_COLLECTABLE';
  end if;

  if new.status <> 'OPEN' then
    raise exception 'CMV3_STREAM_INSERT_MUST_OPEN';
  end if;

  new.opened_at := clock_timestamp();
  new.closed_at := null;
  new.created_at := new.opened_at;

  select membership.clinic_id, membership.status
    into v_membership_clinic_id, v_membership_status
  from public.clinic_memberships membership
  where membership.id = new.observer_membership_id;

  if not found
     or v_membership_clinic_id is distinct from new.organization_id
     or lower(coalesce(v_membership_status, '')) <> 'active' then
    raise exception 'CMV3_STREAM_OBSERVER_SCOPE_INVALID';
  end if;

  if new.stream_role = 'RELIABILITY' then
    select paired.stream_role, paired.observer_membership_id
      into v_primary_role, v_primary_observer_membership_id
    from public.clinical_measurement_collection_streams_v3 paired
    where paired.id = new.paired_primary_stream_id
      and paired.organization_id = new.organization_id
      and paired.patient_id = new.patient_id
      and paired.session_id = new.session_id
      and paired.expectation_id = new.expectation_id
      and paired.target_id = new.target_id;

    if not found or v_primary_role <> 'PRIMARY' then
      raise exception 'CMV3_STREAM_PRIMARY_PAIR_INVALID';
    end if;

    if v_primary_observer_membership_id is not distinct from new.observer_membership_id then
      raise exception 'CMV3_RELIABILITY_OBSERVER_MUST_DIFFER';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.guard_clinical_measurement_stream_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'CMV3_STREAM_DELETE_FORBIDDEN';
  end if;

  if (to_jsonb(old) - array['status', 'closed_at']::text[])
     is distinct from
     (to_jsonb(new) - array['status', 'closed_at']::text[]) then
    raise exception 'CMV3_STREAM_IDENTITY_IMMUTABLE';
  end if;

  if old.status = 'CLOSED' then
    raise exception 'CMV3_STREAM_CLOSED_FINAL';
  end if;

  if new.status = 'OPEN' then
    if new.closed_at is not null then
      raise exception 'CMV3_STREAM_OPEN_CLOSE_SHAPE_INVALID';
    end if;
    return new;
  end if;

  if new.status = 'CLOSED' then
    new.closed_at := clock_timestamp();
    return new;
  end if;

  raise exception 'CMV3_STREAM_STATUS_TRANSITION_INVALID';
end;
$function$;

-- Triggers ------------------------------------------------------------------
drop trigger if exists prepare_clinical_measurement_session_v3
  on public.clinical_measurement_sessions_v3;
create trigger prepare_clinical_measurement_session_v3
before insert on public.clinical_measurement_sessions_v3
for each row execute function public.prepare_clinical_measurement_session_v3();

drop trigger if exists validate_clinical_measurement_session_scope_v3
  on public.clinical_measurement_sessions_v3;
create trigger validate_clinical_measurement_session_scope_v3
before insert on public.clinical_measurement_sessions_v3
for each row execute function public.validate_clinical_measurement_session_scope_v3();

drop trigger if exists guard_clinical_measurement_session_v3
  on public.clinical_measurement_sessions_v3;
create trigger guard_clinical_measurement_session_v3
before update or delete on public.clinical_measurement_sessions_v3
for each row execute function public.guard_clinical_measurement_session_v3();

drop trigger if exists validate_clinical_measurement_expectation_v3
  on public.clinical_measurement_session_expectations_v3;
create trigger validate_clinical_measurement_expectation_v3
before insert on public.clinical_measurement_session_expectations_v3
for each row execute function public.validate_clinical_measurement_expectation_v3();

drop trigger if exists guard_clinical_measurement_expectation_v3
  on public.clinical_measurement_session_expectations_v3;
create trigger guard_clinical_measurement_expectation_v3
before update or delete on public.clinical_measurement_session_expectations_v3
for each row execute function public.guard_clinical_measurement_expectation_v3();

drop trigger if exists validate_clinical_measurement_stream_v3
  on public.clinical_measurement_collection_streams_v3;
create trigger validate_clinical_measurement_stream_v3
before insert on public.clinical_measurement_collection_streams_v3
for each row execute function public.validate_clinical_measurement_stream_v3();

drop trigger if exists guard_clinical_measurement_stream_v3
  on public.clinical_measurement_collection_streams_v3;
create trigger guard_clinical_measurement_stream_v3
before update or delete on public.clinical_measurement_collection_streams_v3
for each row execute function public.guard_clinical_measurement_stream_v3();

-- Dark-deploy security: no browser table or RPC is opened by Migration B.
alter table public.clinical_measurement_sessions_v3 enable row level security;
alter table public.clinical_measurement_session_expectations_v3 enable row level security;
alter table public.clinical_measurement_collection_streams_v3 enable row level security;

revoke all on table public.clinical_measurement_sessions_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_session_expectations_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_collection_streams_v3 from public, anon, authenticated;

grant all on table public.clinical_measurement_sessions_v3 to service_role;
grant all on table public.clinical_measurement_session_expectations_v3 to service_role;
grant all on table public.clinical_measurement_collection_streams_v3 to service_role;

revoke all on function public.prepare_clinical_measurement_session_v3() from public, anon, authenticated;
revoke all on function public.validate_clinical_measurement_session_scope_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_measurement_session_v3() from public, anon, authenticated;
revoke all on function public.validate_clinical_measurement_expectation_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_measurement_expectation_v3() from public, anon, authenticated;
revoke all on function public.validate_clinical_measurement_stream_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_measurement_stream_v3() from public, anon, authenticated;

-- Explicit preservation invariant: this migration creates no expectations,
-- sessions, streams, backfills, browser writers, or mutations in V2/ABA V3.


-- ===========================================================================
-- Embedded canonical block 05/12: 20260820160000_clinical_measurement_v3_raw_primitives.sql
-- ===========================================================================
-- Verto Clinical Measurement Engine V3 - Raw Measurement Primitives.
-- Additive/dark only. Creates append-only accepted-event envelopes plus typed raw
-- primitives. Does not enable browser writers, projections, graphs or ABA V3 rollout.


create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Accepted raw-event envelope.
-- Scope, semantic family, protocol version and clinical calendar are resolved by
-- the server from the logical collection stream. The browser never writes here.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_raw_events_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id uuid not null,
  expectation_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  protocol_snapshot_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  phase_version_id uuid,
  semantic_family text not null
    check (semantic_family in (
      'PROPORTION', 'RATE', 'COUNT', 'DURATION', 'LATENCY', 'IRT',
      'INTERVAL', 'ORDINAL', 'CONTINUOUS', 'TASK_ANALYSIS', 'CATEGORICAL'
    )),
  client_event_id text not null,
  event_kind text not null default 'FACT'
    check (event_kind in ('FACT', 'CORRECTION', 'VOID', 'SUPERSEDE')),
  subject_event_id uuid,
  replacement_event_id uuid,
  ingestion_mode text not null
    check (ingestion_mode in ('LIVE', 'OFFLINE_SYNC', 'RETROSPECTIVE_ENTRY', 'CORRECTION')),
  occurred_at_utc timestamptz not null,
  clinical_date date not null,
  local_occurred_date date not null,
  timezone_snapshot text not null,
  timezone_offset_minutes integer not null
    check (timezone_offset_minutes between -900 and 900),
  actor_membership_id uuid not null references public.clinic_memberships(id) on delete restrict,
  reason_code text,
  payload_hash text not null,
  received_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint cmv3_raw_event_client_id_nonempty
    check (length(trim(client_event_id)) between 1 and 240),
  constraint cmv3_raw_event_hash_shape
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint cmv3_raw_event_reason_shape
    check (reason_code is null or length(trim(reason_code)) between 1 and 120),
  constraint cmv3_raw_event_temporal_shape
    check (received_at <= recorded_at and created_at = recorded_at),
  constraint cmv3_raw_event_phase_shape
    check (
      (phase_epoch_id is null and phase_version_id is null)
      or (phase_epoch_id is not null and phase_version_id is not null)
    ),
  constraint cmv3_raw_event_compensation_shape check (
    (event_kind = 'FACT'
      and subject_event_id is null
      and replacement_event_id is null
      and ingestion_mode <> 'CORRECTION'
      and reason_code is null)
    or
    (event_kind = 'CORRECTION'
      and subject_event_id is not null
      and replacement_event_id is null
      and ingestion_mode = 'CORRECTION'
      and reason_code is not null)
    or
    (event_kind = 'VOID'
      and subject_event_id is not null
      and replacement_event_id is null
      and ingestion_mode = 'CORRECTION'
      and reason_code is not null)
    or
    (event_kind = 'SUPERSEDE'
      and subject_event_id is not null
      and replacement_event_id is not null
      and ingestion_mode = 'CORRECTION'
      and reason_code is not null)
  ),
  foreign key (
    stream_id, organization_id, patient_id, session_id, expectation_id, target_id
  ) references public.clinical_measurement_collection_streams_v3 (
    id, organization_id, patient_id, session_id, expectation_id, target_id
  ) on delete restrict,
  foreign key (protocol_snapshot_id, organization_id, patient_id, target_id)
    references public.clinical_collection_protocol_snapshots_v3(
      id, organization_id, patient_id, target_id
    ) on delete restrict,
  foreign key (definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definition_versions_v3(
      id, organization_id, patient_id, target_id
    ) on delete restrict,
  foreign key (phase_epoch_id, organization_id, patient_id, target_id, phase_version_id)
    references public.clinical_measurement_phase_epochs_v3(
      id, organization_id, patient_id, target_id, phase_version_id
    ) on delete restrict,
  unique (organization_id, client_event_id),
  unique (id, organization_id, patient_id, session_id, target_id, stream_id),
  unique (id, organization_id, patient_id, session_id, expectation_id, target_id, stream_id)
);

create index if not exists idx_cmv3_raw_events_stream_timeline
  on public.clinical_measurement_raw_events_v3
  (organization_id, patient_id, stream_id, occurred_at_utc, recorded_at);
create index if not exists idx_cmv3_raw_events_target_timeline
  on public.clinical_measurement_raw_events_v3
  (organization_id, patient_id, target_id, clinical_date, occurred_at_utc);
create index if not exists idx_cmv3_raw_events_recorded
  on public.clinical_measurement_raw_events_v3
  (organization_id, recorded_at, id);
create index if not exists idx_cmv3_raw_events_subject
  on public.clinical_measurement_raw_events_v3(subject_event_id)
  where subject_event_id is not null;
create unique index if not exists ux_cmv3_raw_single_direct_compensation
  on public.clinical_measurement_raw_events_v3(subject_event_id)
  where event_kind in ('CORRECTION', 'VOID', 'SUPERSEDE');

-- One accepted FACT/CORRECTION envelope owns exactly one typed raw payload.
-- This prevents a single idempotency key from simultaneously becoming, for
-- example, both COUNT evidence and an explicit absence fact.
create table if not exists public.clinical_measurement_raw_event_payload_claims_v3 (
  event_id uuid primary key references public.clinical_measurement_raw_events_v3(id) on delete restrict,
  payload_kind text not null
    check (payload_kind in (
      'OBSERVATION_SLICE', 'COUNT', 'CATEGORY', 'SCALAR',
      'TEMPORAL_INTERVAL', 'INTERVAL_SAMPLE', 'EXPLICIT_ABSENCE'
    )),
  claimed_at timestamptz not null default now()
);

-- Self-scope FKs are added after the table exists.
do $cmv3_raw_self_fks$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_raw_events_v3'::regclass
      and conname = 'cmv3_raw_event_subject_scope_fkey'
  ) then
    alter table public.clinical_measurement_raw_events_v3
      add constraint cmv3_raw_event_subject_scope_fkey
      foreign key (
        subject_event_id, organization_id, patient_id, session_id,
        expectation_id, target_id, stream_id
      ) references public.clinical_measurement_raw_events_v3 (
        id, organization_id, patient_id, session_id,
        expectation_id, target_id, stream_id
      ) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_raw_events_v3'::regclass
      and conname = 'cmv3_raw_event_replacement_scope_fkey'
  ) then
    alter table public.clinical_measurement_raw_events_v3
      add constraint cmv3_raw_event_replacement_scope_fkey
      foreign key (
        replacement_event_id, organization_id, patient_id, session_id,
        expectation_id, target_id, stream_id
      ) references public.clinical_measurement_raw_events_v3 (
        id, organization_id, patient_id, session_id,
        expectation_id, target_id, stream_id
      ) on delete restrict;
  end if;
end;
$cmv3_raw_self_fks$;

-- ---------------------------------------------------------------------------
-- Closed active-observation slices. A slice is persisted only when its interval
-- is known, so raw evidence remains append-only. Open-timer UX is operational
-- state and is not a canonical raw observation row.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_observation_slices_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  expectation_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  semantic_family text not null
    check (semantic_family in (
      'PROPORTION', 'RATE', 'COUNT', 'DURATION', 'LATENCY', 'IRT',
      'INTERVAL', 'ORDINAL', 'CONTINUOUS', 'TASK_ANALYSIS', 'CATEGORICAL'
    )),
  lineage_root_event_id uuid not null references public.clinical_measurement_raw_events_v3(id) on delete restrict,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  close_reason text not null
    check (close_reason in (
      'USER_STOP', 'SESSION_FINALIZATION', 'OFFLINE_RECOVERY', 'OBSERVATION_INTERRUPTED'
    )),
  observation_range tstzrange generated always as (
    tstzrange(started_at, ended_at, '[)')
  ) stored,
  created_at timestamptz not null,
  constraint cmv3_observation_slice_time_order check (ended_at > started_at),
  foreign key (
    event_id, organization_id, patient_id, session_id, expectation_id, target_id, stream_id
  ) references public.clinical_measurement_raw_events_v3 (
    id, organization_id, patient_id, session_id, expectation_id, target_id, stream_id
  ) on delete restrict
);

-- A logical stream is the denominator identity. Device swaps do not produce a
-- second stream, therefore they cannot double-count overlapping observation time.
do $cmv3_observation_slice_overlap$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_observation_slices_v3'::regclass
      and conname = 'cmv3_observation_slices_no_overlap'
  ) then
    alter table public.clinical_measurement_observation_slices_v3
      add constraint cmv3_observation_slices_no_overlap
      exclude using gist (
        stream_id with =,
        observation_range with &&,
        lineage_root_event_id with <>
      );
  end if;
end;
$cmv3_observation_slice_overlap$;

create index if not exists idx_cmv3_observation_slices_stream
  on public.clinical_measurement_observation_slices_v3
  (organization_id, patient_id, stream_id, started_at);

-- ---------------------------------------------------------------------------
-- Typed mathematical raw primitives. They reference the accepted envelope and
-- intentionally do not collapse unlike measurement families into one sparse row.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_count_facts_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  semantic_family text not null check (semantic_family in ('COUNT', 'RATE')),
  count_delta integer not null check (count_delta between 1 and 1000000),
  created_at timestamptz not null,
  foreign key (event_id, organization_id, patient_id, session_id, target_id, stream_id)
    references public.clinical_measurement_raw_events_v3(
      id, organization_id, patient_id, session_id, target_id, stream_id
    ) on delete restrict
);

create index if not exists idx_cmv3_count_facts_stream
  on public.clinical_measurement_count_facts_v3
  (organization_id, patient_id, stream_id, event_id);

create table if not exists public.clinical_measurement_category_facts_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  semantic_family text not null
    check (semantic_family in ('PROPORTION', 'ORDINAL', 'CATEGORICAL')),
  category_key text not null,
  created_at timestamptz not null,
  constraint cmv3_category_fact_key_nonempty
    check (length(trim(category_key)) between 1 and 180),
  foreign key (event_id, organization_id, patient_id, session_id, target_id, stream_id)
    references public.clinical_measurement_raw_events_v3(
      id, organization_id, patient_id, session_id, target_id, stream_id
    ) on delete restrict
);

create index if not exists idx_cmv3_category_facts_stream
  on public.clinical_measurement_category_facts_v3
  (organization_id, patient_id, stream_id, event_id);

create table if not exists public.clinical_measurement_scalar_facts_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  semantic_family text not null check (semantic_family = 'CONTINUOUS'),
  numeric_value numeric not null,
  created_at timestamptz not null,
  constraint cmv3_scalar_fact_finite
    check (numeric_value::text not in ('NaN', 'Infinity', '-Infinity')),
  foreign key (event_id, organization_id, patient_id, session_id, target_id, stream_id)
    references public.clinical_measurement_raw_events_v3(
      id, organization_id, patient_id, session_id, target_id, stream_id
    ) on delete restrict
);

create index if not exists idx_cmv3_scalar_facts_stream
  on public.clinical_measurement_scalar_facts_v3
  (organization_id, patient_id, stream_id, event_id);

create table if not exists public.clinical_measurement_interval_facts_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  semantic_family text not null check (semantic_family in ('DURATION', 'LATENCY', 'IRT')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  is_censored boolean not null default false,
  censor_reason text,
  duration_ms bigint generated always as (
    floor(extract(epoch from (ended_at - started_at)) * 1000.0)::bigint
  ) stored,
  created_at timestamptz not null,
  constraint cmv3_interval_fact_time_order check (ended_at > started_at),
  constraint cmv3_interval_fact_censor_shape check (
    (not is_censored and censor_reason is null)
    or
    (is_censored and censor_reason in (
      'SESSION_FINALIZATION', 'OBSERVATION_INTERRUPTED', 'UNKNOWN_END'
    ))
  ),
  foreign key (event_id, organization_id, patient_id, session_id, target_id, stream_id)
    references public.clinical_measurement_raw_events_v3(
      id, organization_id, patient_id, session_id, target_id, stream_id
    ) on delete restrict
);

create index if not exists idx_cmv3_interval_facts_stream
  on public.clinical_measurement_interval_facts_v3
  (organization_id, patient_id, stream_id, started_at);

create table if not exists public.clinical_measurement_interval_samples_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  semantic_family text not null check (semantic_family = 'INTERVAL'),
  lineage_root_event_id uuid not null references public.clinical_measurement_raw_events_v3(id) on delete restrict,
  interval_index integer not null check (interval_index > 0),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  response_key text not null,
  sample_range tstzrange generated always as (
    tstzrange(started_at, ended_at, '[)')
  ) stored,
  created_at timestamptz not null,
  constraint cmv3_interval_sample_time_order check (ended_at > started_at),
  constraint cmv3_interval_sample_response_nonempty
    check (length(trim(response_key)) between 1 and 180),
  foreign key (event_id, organization_id, patient_id, session_id, target_id, stream_id)
    references public.clinical_measurement_raw_events_v3(
      id, organization_id, patient_id, session_id, target_id, stream_id
    ) on delete restrict
);

do $cmv3_interval_sample_overlap$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_interval_samples_v3'::regclass
      and conname = 'cmv3_interval_samples_no_overlap'
  ) then
    alter table public.clinical_measurement_interval_samples_v3
      add constraint cmv3_interval_samples_no_overlap
      exclude using gist (
        stream_id with =,
        sample_range with &&,
        lineage_root_event_id with <>
      );
  end if;
end;
$cmv3_interval_sample_overlap$;

do $cmv3_interval_sample_index_collision$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_interval_samples_v3'::regclass
      and conname = 'cmv3_interval_samples_index_lineage_guard'
  ) then
    alter table public.clinical_measurement_interval_samples_v3
      add constraint cmv3_interval_samples_index_lineage_guard
      exclude using gist (
        stream_id with =,
        interval_index with =,
        lineage_root_event_id with <>
      );
  end if;
end;
$cmv3_interval_sample_index_collision$;

create index if not exists idx_cmv3_interval_samples_stream
  on public.clinical_measurement_interval_samples_v3
  (organization_id, patient_id, stream_id, interval_index);

-- Explicit omission facts only. EXPECTED_NOT_COLLECTED and NOT_SCHEDULED remain
-- derived from expectations + accepted evidence and are never persisted as raw facts.
create table if not exists public.clinical_measurement_explicit_absence_facts_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  semantic_family text not null,
  absence_kind text not null
    check (absence_kind in (
      'NO_ELIGIBLE_OPPORTUNITY',
      'NO_VALID_OBSERVATION_WINDOW',
      'REFUSED_BY_PATIENT',
      'INTERRUPTED'
    )),
  reason_code text,
  created_at timestamptz not null,
  constraint cmv3_absence_reason_shape
    check (reason_code is null or length(trim(reason_code)) between 1 and 180),
  foreign key (event_id, organization_id, patient_id, session_id, target_id, stream_id)
    references public.clinical_measurement_raw_events_v3(
      id, organization_id, patient_id, session_id, target_id, stream_id
    ) on delete restrict
);

create index if not exists idx_cmv3_absence_facts_stream
  on public.clinical_measurement_explicit_absence_facts_v3
  (organization_id, patient_id, stream_id, event_id);

-- ---------------------------------------------------------------------------
-- Server-authoritative scope/time normalization for raw envelopes.
-- ---------------------------------------------------------------------------
create or replace function public.prepare_clinical_measurement_raw_event_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_stream public.clinical_measurement_collection_streams_v3%rowtype;
  v_expectation public.clinical_measurement_session_expectations_v3%rowtype;
  v_session public.clinical_measurement_sessions_v3%rowtype;
  v_snapshot public.clinical_collection_protocol_snapshots_v3%rowtype;
  v_definition_version public.clinical_measurement_definition_versions_v3%rowtype;
  v_family text;
  v_membership_clinic_id uuid;
  v_membership_status text;
  v_now timestamptz := clock_timestamp();
  v_subject_kind text;
  v_replacement_kind text;
begin
  select * into v_stream
  from public.clinical_measurement_collection_streams_v3 stream
  where stream.id = new.stream_id;

  if not found then
    raise exception 'CMV3_RAW_STREAM_NOT_FOUND';
  end if;

  select * into v_expectation
  from public.clinical_measurement_session_expectations_v3 expectation
  where expectation.id = v_stream.expectation_id
    and expectation.organization_id = v_stream.organization_id
    and expectation.patient_id = v_stream.patient_id
    and expectation.session_id = v_stream.session_id
    and expectation.target_id = v_stream.target_id;

  if not found then
    raise exception 'CMV3_RAW_EXPECTATION_SCOPE_INVALID';
  end if;

  select * into v_session
  from public.clinical_measurement_sessions_v3 session_row
  where session_row.id = v_stream.session_id
    and session_row.organization_id = v_stream.organization_id
    and session_row.patient_id = v_stream.patient_id;

  if not found or v_session.status = 'CANCELED' then
    raise exception 'CMV3_RAW_SESSION_NOT_COLLECTABLE';
  end if;

  select * into v_snapshot
  from public.clinical_collection_protocol_snapshots_v3 snapshot
  where snapshot.id = v_expectation.protocol_snapshot_id
    and snapshot.organization_id = v_stream.organization_id
    and snapshot.patient_id = v_stream.patient_id
    and snapshot.target_id = v_stream.target_id;

  if not found then
    raise exception 'CMV3_RAW_PROTOCOL_SNAPSHOT_INVALID';
  end if;

  select * into v_definition_version
  from public.clinical_measurement_definition_versions_v3 definition_version
  where definition_version.id = v_snapshot.definition_version_id
    and definition_version.organization_id = v_stream.organization_id
    and definition_version.patient_id = v_stream.patient_id
    and definition_version.target_id = v_stream.target_id;

  if not found then
    raise exception 'CMV3_RAW_DEFINITION_VERSION_INVALID';
  end if;

  select definition.semantic_family
    into v_family
  from public.clinical_measurement_definitions_v3 definition
  where definition.id = v_definition_version.definition_id
    and definition.organization_id = v_stream.organization_id
    and definition.patient_id = v_stream.patient_id
    and definition.target_id = v_stream.target_id;

  if not found then
    raise exception 'CMV3_RAW_DEFINITION_INVALID';
  end if;

  select membership.clinic_id, membership.status
    into v_membership_clinic_id, v_membership_status
  from public.clinic_memberships membership
  where membership.id = new.actor_membership_id;

  if not found
     or v_membership_clinic_id is distinct from v_stream.organization_id
     or lower(coalesce(v_membership_status, '')) <> 'active' then
    raise exception 'CMV3_RAW_ACTOR_SCOPE_INVALID';
  end if;

  -- LIVE facts require an actually open stream/session. Offline/retrospective
  -- arrivals may legitimately be accepted after logical closure/finalization.
  if new.event_kind = 'FACT' and new.ingestion_mode = 'LIVE' then
    if v_session.status <> 'OPEN' or v_stream.status <> 'OPEN' then
      raise exception 'CMV3_RAW_LIVE_STREAM_NOT_OPEN';
    end if;
  end if;

  if new.event_kind <> 'FACT' and new.ingestion_mode <> 'CORRECTION' then
    raise exception 'CMV3_RAW_COMPENSATION_MODE_INVALID';
  end if;

  if new.event_kind = 'FACT' and new.ingestion_mode = 'CORRECTION' then
    raise exception 'CMV3_RAW_FACT_CORRECTION_KIND_REQUIRED';
  end if;

  if new.occurred_at_utc < v_session.started_at then
    raise exception 'CMV3_RAW_OCCURRED_BEFORE_SESSION';
  end if;

  if v_session.ended_at is not null and new.occurred_at_utc > v_session.ended_at then
    raise exception 'CMV3_RAW_OCCURRED_AFTER_SESSION';
  end if;

  new.organization_id := v_stream.organization_id;
  new.patient_id := v_stream.patient_id;
  new.session_id := v_stream.session_id;
  new.expectation_id := v_stream.expectation_id;
  new.target_id := v_stream.target_id;
  new.protocol_snapshot_id := v_expectation.protocol_snapshot_id;
  new.definition_version_id := v_snapshot.definition_version_id;
  new.phase_epoch_id := v_snapshot.phase_epoch_id;
  new.phase_version_id := v_snapshot.phase_version_id;
  new.semantic_family := v_family;
  new.clinical_date := v_session.clinical_date;
  new.timezone_snapshot := v_session.timezone_snapshot;
  new.local_occurred_date := timezone(v_session.timezone_snapshot, new.occurred_at_utc)::date;
  new.timezone_offset_minutes := round(
    extract(epoch from (
      timezone(v_session.timezone_snapshot, new.occurred_at_utc)
      - timezone('UTC', new.occurred_at_utc)
    )) / 60.0
  )::integer;
  new.received_at := v_now;
  new.recorded_at := v_now;
  new.created_at := v_now;

  if new.subject_event_id is not null then
    select event.event_kind into v_subject_kind
    from public.clinical_measurement_raw_events_v3 event
    where event.id = new.subject_event_id
      and event.organization_id = new.organization_id
      and event.patient_id = new.patient_id
      and event.session_id = new.session_id
      and event.expectation_id = new.expectation_id
      and event.target_id = new.target_id
      and event.stream_id = new.stream_id;

    if not found or v_subject_kind not in ('FACT', 'CORRECTION', 'VOID') then
      raise exception 'CMV3_RAW_SUBJECT_EVENT_INVALID';
    end if;

    if new.subject_event_id = new.id then
      raise exception 'CMV3_RAW_SELF_REFERENCE_FORBIDDEN';
    end if;
  end if;

  if new.replacement_event_id is not null then
    select event.event_kind into v_replacement_kind
    from public.clinical_measurement_raw_events_v3 event
    where event.id = new.replacement_event_id
      and event.organization_id = new.organization_id
      and event.patient_id = new.patient_id
      and event.session_id = new.session_id
      and event.expectation_id = new.expectation_id
      and event.target_id = new.target_id
      and event.stream_id = new.stream_id;

    if not found or v_replacement_kind not in ('FACT', 'CORRECTION') then
      raise exception 'CMV3_RAW_REPLACEMENT_EVENT_INVALID';
    end if;

    if new.replacement_event_id = new.subject_event_id then
      raise exception 'CMV3_RAW_SUPERSEDE_REPLACEMENT_INVALID';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.claim_clinical_measurement_raw_payload_v3(
  p_event_id uuid,
  p_payload_kind text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_existing_kind text;
begin
  insert into public.clinical_measurement_raw_event_payload_claims_v3(
    event_id, payload_kind, claimed_at
  ) values (
    p_event_id, p_payload_kind, clock_timestamp()
  )
  on conflict (event_id) do nothing;

  select claim.payload_kind
    into v_existing_kind
  from public.clinical_measurement_raw_event_payload_claims_v3 claim
  where claim.event_id = p_event_id;

  if v_existing_kind is distinct from p_payload_kind then
    raise exception 'CMV3_RAW_EVENT_PAYLOAD_KIND_CONFLICT';
  end if;
end;
$function$;

create or replace function public.resolve_clinical_measurement_payload_event_v3(
  p_event_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  with recursive lineage as (
    select event.id, event.subject_event_id, 0 as depth
    from public.clinical_measurement_raw_events_v3 event
    where event.id = p_event_id

    union all

    select parent.id, parent.subject_event_id, lineage.depth + 1
    from lineage
    join public.clinical_measurement_raw_events_v3 parent
      on parent.id = lineage.subject_event_id
    where lineage.depth < 64
  )
  select lineage.id
  from lineage
  join public.clinical_measurement_raw_event_payload_claims_v3 claim
    on claim.event_id = lineage.id
  order by lineage.depth
  limit 1;
$function$;

create or replace function public.ensure_clinical_measurement_raw_payload_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_payload_kind text;
  v_subject_payload_kind text;
  v_replacement_payload_kind text;
  v_subject_payload_event_id uuid;
begin
  select claim.payload_kind
    into v_payload_kind
  from public.clinical_measurement_raw_event_payload_claims_v3 claim
  where claim.event_id = new.id;

  if new.event_kind in ('FACT', 'CORRECTION') and v_payload_kind is null then
    raise exception 'CMV3_RAW_EVENT_TYPED_PAYLOAD_REQUIRED';
  end if;

  if new.event_kind in ('VOID', 'SUPERSEDE') and v_payload_kind is not null then
    raise exception 'CMV3_RAW_COMPENSATION_PAYLOAD_FORBIDDEN';
  end if;

  if new.event_kind = 'CORRECTION' then
    v_subject_payload_event_id := public.resolve_clinical_measurement_payload_event_v3(new.subject_event_id);

    select claim.payload_kind
      into v_subject_payload_kind
    from public.clinical_measurement_raw_event_payload_claims_v3 claim
    where claim.event_id = v_subject_payload_event_id;

    if v_subject_payload_kind is null or v_subject_payload_kind is distinct from v_payload_kind then
      raise exception 'CMV3_RAW_CORRECTION_PAYLOAD_KIND_MISMATCH';
    end if;
  end if;

  if new.event_kind = 'SUPERSEDE' then
    select claim.payload_kind into v_subject_payload_kind
    from public.clinical_measurement_raw_event_payload_claims_v3 claim
    where claim.event_id = new.subject_event_id;

    select claim.payload_kind into v_replacement_payload_kind
    from public.clinical_measurement_raw_event_payload_claims_v3 claim
    where claim.event_id = new.replacement_event_id;

    if v_subject_payload_kind is null
       or v_replacement_payload_kind is null
       or v_subject_payload_kind is distinct from v_replacement_payload_kind then
      raise exception 'CMV3_RAW_SUPERSEDE_PAYLOAD_KIND_MISMATCH';
    end if;
  end if;

  return null;
end;
$function$;

create or replace function public.guard_clinical_measurement_raw_immutable_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'CMV3_RAW_APPEND_ONLY';
end;
$function$;

-- Resolve the accepted event into a typed primitive and derive all repeated
-- scope fields from the envelope instead of trusting caller-supplied values.
create or replace function public.prepare_clinical_measurement_primitive_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_event public.clinical_measurement_raw_events_v3%rowtype;
  v_session public.clinical_measurement_sessions_v3%rowtype;
  v_allowed text[];
  v_payload_kind text;
  v_subject_slice public.clinical_measurement_observation_slices_v3%rowtype;
  v_subject_sample public.clinical_measurement_interval_samples_v3%rowtype;
  v_subject_payload_event_id uuid;
begin
  select * into v_event
  from public.clinical_measurement_raw_events_v3 event
  where event.id = new.event_id;

  if not found then
    raise exception 'CMV3_PRIMITIVE_EVENT_NOT_FOUND';
  end if;

  if v_event.event_kind not in ('FACT', 'CORRECTION') then
    raise exception 'CMV3_PRIMITIVE_EVENT_KIND_INVALID';
  end if;

  if tg_table_name = 'clinical_measurement_count_facts_v3' then
    v_allowed := array['COUNT', 'RATE'];
  elsif tg_table_name = 'clinical_measurement_category_facts_v3' then
    v_allowed := array['PROPORTION', 'ORDINAL', 'CATEGORICAL'];
  elsif tg_table_name = 'clinical_measurement_scalar_facts_v3' then
    v_allowed := array['CONTINUOUS'];
  elsif tg_table_name = 'clinical_measurement_interval_facts_v3' then
    v_allowed := array['DURATION', 'LATENCY', 'IRT'];
  elsif tg_table_name = 'clinical_measurement_interval_samples_v3' then
    v_allowed := array['INTERVAL'];
  else
    v_allowed := null;
  end if;

  if v_allowed is not null and not (v_event.semantic_family = any(v_allowed)) then
    raise exception 'CMV3_PRIMITIVE_SEMANTIC_FAMILY_MISMATCH';
  end if;

  if tg_table_name = 'clinical_measurement_observation_slices_v3' then
    v_payload_kind := 'OBSERVATION_SLICE';
  elsif tg_table_name = 'clinical_measurement_count_facts_v3' then
    v_payload_kind := 'COUNT';
  elsif tg_table_name = 'clinical_measurement_category_facts_v3' then
    v_payload_kind := 'CATEGORY';
  elsif tg_table_name = 'clinical_measurement_scalar_facts_v3' then
    v_payload_kind := 'SCALAR';
  elsif tg_table_name = 'clinical_measurement_interval_facts_v3' then
    v_payload_kind := 'TEMPORAL_INTERVAL';
  elsif tg_table_name = 'clinical_measurement_interval_samples_v3' then
    v_payload_kind := 'INTERVAL_SAMPLE';
  else
    raise exception 'CMV3_PRIMITIVE_TABLE_UNSUPPORTED';
  end if;

  perform public.claim_clinical_measurement_raw_payload_v3(v_event.id, v_payload_kind);

  if tg_table_name = 'clinical_measurement_observation_slices_v3' then
    if v_event.event_kind = 'FACT' then
      new.lineage_root_event_id := v_event.id;
    else
      v_subject_payload_event_id := public.resolve_clinical_measurement_payload_event_v3(v_event.subject_event_id);

      select * into v_subject_slice
      from public.clinical_measurement_observation_slices_v3 slice
      where slice.event_id = v_subject_payload_event_id;

      if not found then
        raise exception 'CMV3_OBSERVATION_SLICE_CORRECTION_SUBJECT_INVALID';
      end if;

      new.lineage_root_event_id := v_subject_slice.lineage_root_event_id;
    end if;
  elsif tg_table_name = 'clinical_measurement_interval_samples_v3' then
    if v_event.event_kind = 'FACT' then
      new.lineage_root_event_id := v_event.id;
    else
      v_subject_payload_event_id := public.resolve_clinical_measurement_payload_event_v3(v_event.subject_event_id);

      select * into v_subject_sample
      from public.clinical_measurement_interval_samples_v3 sample
      where sample.event_id = v_subject_payload_event_id;

      if not found then
        raise exception 'CMV3_INTERVAL_SAMPLE_CORRECTION_SUBJECT_INVALID';
      end if;

      if new.interval_index is distinct from v_subject_sample.interval_index then
        raise exception 'CMV3_INTERVAL_SAMPLE_CORRECTION_INDEX_IMMUTABLE';
      end if;

      new.lineage_root_event_id := v_subject_sample.lineage_root_event_id;
    end if;
  end if;

  if tg_table_name in (
    'clinical_measurement_observation_slices_v3',
    'clinical_measurement_interval_facts_v3',
    'clinical_measurement_interval_samples_v3'
  ) then
    select * into v_session
    from public.clinical_measurement_sessions_v3 session_row
    where session_row.id = v_event.session_id
      and session_row.organization_id = v_event.organization_id
      and session_row.patient_id = v_event.patient_id;

    if not found then
      raise exception 'CMV3_PRIMITIVE_SESSION_SCOPE_INVALID';
    end if;

    if new.started_at < v_session.started_at then
      raise exception 'CMV3_PRIMITIVE_STARTED_BEFORE_SESSION';
    end if;

    if v_session.ended_at is not null and new.ended_at > v_session.ended_at then
      raise exception 'CMV3_PRIMITIVE_ENDED_AFTER_SESSION';
    end if;
  end if;

  new.organization_id := v_event.organization_id;
  new.patient_id := v_event.patient_id;
  new.session_id := v_event.session_id;
  new.target_id := v_event.target_id;
  new.stream_id := v_event.stream_id;
  new.semantic_family := v_event.semantic_family;
  new.created_at := v_event.recorded_at;

  if tg_table_name in ('clinical_measurement_observation_slices_v3', 'clinical_measurement_interval_facts_v3', 'clinical_measurement_interval_samples_v3') then
    if new.started_at is distinct from v_event.occurred_at_utc then
      raise exception 'CMV3_PRIMITIVE_START_MUST_MATCH_EVENT_TIME';
    end if;
  end if;

  return new;
end;
$function$;

-- Explicit absence is typed separately because it has no scalar/vector value.
create or replace function public.prepare_clinical_measurement_absence_fact_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_event public.clinical_measurement_raw_events_v3%rowtype;
begin
  select * into v_event
  from public.clinical_measurement_raw_events_v3 event
  where event.id = new.event_id;

  if not found then
    raise exception 'CMV3_ABSENCE_EVENT_NOT_FOUND';
  end if;

  if v_event.event_kind not in ('FACT', 'CORRECTION') then
    raise exception 'CMV3_ABSENCE_EVENT_KIND_INVALID';
  end if;

  perform public.claim_clinical_measurement_raw_payload_v3(v_event.id, 'EXPLICIT_ABSENCE');

  new.organization_id := v_event.organization_id;
  new.patient_id := v_event.patient_id;
  new.session_id := v_event.session_id;
  new.target_id := v_event.target_id;
  new.stream_id := v_event.stream_id;
  new.semantic_family := v_event.semantic_family;
  new.created_at := v_event.recorded_at;

  return new;
end;
$function$;

-- Triggers ------------------------------------------------------------------
drop trigger if exists prepare_clinical_measurement_raw_event_v3
  on public.clinical_measurement_raw_events_v3;
create trigger prepare_clinical_measurement_raw_event_v3
before insert on public.clinical_measurement_raw_events_v3
for each row execute function public.prepare_clinical_measurement_raw_event_v3();

drop trigger if exists ensure_clinical_measurement_raw_payload_v3
  on public.clinical_measurement_raw_events_v3;
create constraint trigger ensure_clinical_measurement_raw_payload_v3
after insert on public.clinical_measurement_raw_events_v3
deferrable initially deferred
for each row execute function public.ensure_clinical_measurement_raw_payload_v3();

drop trigger if exists guard_clinical_measurement_raw_events_v3
  on public.clinical_measurement_raw_events_v3;
create trigger guard_clinical_measurement_raw_events_v3
before update or delete on public.clinical_measurement_raw_events_v3
for each row execute function public.guard_clinical_measurement_raw_immutable_v3();

drop trigger if exists guard_cmv3_payload_claim_immutable
  on public.clinical_measurement_raw_event_payload_claims_v3;
create trigger guard_cmv3_payload_claim_immutable
before update or delete on public.clinical_measurement_raw_event_payload_claims_v3
for each row execute function public.guard_clinical_measurement_raw_immutable_v3();

-- Every typed primitive is server-derived from its event envelope and immutable.
do $cmv3_primitive_triggers$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinical_measurement_observation_slices_v3',
    'clinical_measurement_count_facts_v3',
    'clinical_measurement_category_facts_v3',
    'clinical_measurement_scalar_facts_v3',
    'clinical_measurement_interval_facts_v3',
    'clinical_measurement_interval_samples_v3'
  ] loop
    execute format('drop trigger if exists prepare_cmv3_primitive on public.%I', v_table);
    execute format(
      'create trigger prepare_cmv3_primitive before insert on public.%I for each row execute function public.prepare_clinical_measurement_primitive_v3()',
      v_table
    );
    execute format('drop trigger if exists guard_cmv3_raw_immutable on public.%I', v_table);
    execute format(
      'create trigger guard_cmv3_raw_immutable before update or delete on public.%I for each row execute function public.guard_clinical_measurement_raw_immutable_v3()',
      v_table
    );
  end loop;
end;
$cmv3_primitive_triggers$;

drop trigger if exists prepare_cmv3_absence_fact
  on public.clinical_measurement_explicit_absence_facts_v3;
create trigger prepare_cmv3_absence_fact
before insert on public.clinical_measurement_explicit_absence_facts_v3
for each row execute function public.prepare_clinical_measurement_absence_fact_v3();

drop trigger if exists guard_cmv3_absence_immutable
  on public.clinical_measurement_explicit_absence_facts_v3;
create trigger guard_cmv3_absence_immutable
before update or delete on public.clinical_measurement_explicit_absence_facts_v3
for each row execute function public.guard_clinical_measurement_raw_immutable_v3();

-- Dark-deploy security -------------------------------------------------------
do $cmv3_raw_security$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinical_measurement_raw_events_v3',
    'clinical_measurement_raw_event_payload_claims_v3',
    'clinical_measurement_observation_slices_v3',
    'clinical_measurement_count_facts_v3',
    'clinical_measurement_category_facts_v3',
    'clinical_measurement_scalar_facts_v3',
    'clinical_measurement_interval_facts_v3',
    'clinical_measurement_interval_samples_v3',
    'clinical_measurement_explicit_absence_facts_v3'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant all on table public.%I to service_role', v_table);
  end loop;
end;
$cmv3_raw_security$;

revoke all on function public.prepare_clinical_measurement_raw_event_v3() from public, anon, authenticated;
revoke all on function public.claim_clinical_measurement_raw_payload_v3(uuid, text) from public, anon, authenticated;
revoke all on function public.resolve_clinical_measurement_payload_event_v3(uuid) from public, anon, authenticated;
revoke all on function public.ensure_clinical_measurement_raw_payload_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_measurement_raw_immutable_v3() from public, anon, authenticated;
revoke all on function public.prepare_clinical_measurement_primitive_v3() from public, anon, authenticated;
revoke all on function public.prepare_clinical_measurement_absence_fact_v3() from public, anon, authenticated;

-- Explicit preservation invariant: no V2/legacy ABA table is mutated and no
-- authenticated writer is granted by this migration.


-- ===========================================================================
-- Embedded canonical block 06/12: 20260820173000_clinical_measurement_v3_aba_engine.sql
-- ===========================================================================
-- Verto Clinical Measurement Engine V3 - ABA specialized engine.
-- Additive/dark only. Adds categorical prompt hierarchies, versioned chaining,
-- ordered trials and Task Analysis on top of the universal raw layer.
-- No browser writer, rollout change, projection, graph, or legacy mutation.


create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Immutable ABA prompt hierarchy. No 0-100 prompt score exists in this model.
-- Legacy aba_prompt_types may be referenced only as a source identity/label.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_aba_prompt_hierarchies_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_id uuid not null,
  hierarchy_key text not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cabav3_prompt_hierarchy_key_nonempty
    check (length(trim(hierarchy_key)) between 1 and 180),
  foreign key (definition_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definitions_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  unique (definition_id, hierarchy_key),
  unique (id, organization_id, patient_id, target_id, definition_id)
);

create table if not exists public.clinical_aba_prompt_hierarchy_versions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_id uuid not null,
  hierarchy_id uuid not null,
  version integer not null check (version > 0),
  strategy text not null check (strategy in ('LEAST_TO_MOST','MOST_TO_LEAST','CUSTOM')),
  version_hash text,
  status text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED','DEPRECATED','ARCHIVED')),
  published_at timestamptz,
  deprecated_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cabav3_prompt_hierarchy_hash_shape check (version_hash is null or version_hash ~ '^[0-9a-f]{64}$'),
  constraint cabav3_prompt_hierarchy_lifecycle check (
    (status = 'DRAFT' and published_at is null and deprecated_at is null and version_hash is null)
    or (status = 'PUBLISHED' and published_at is not null and deprecated_at is null and version_hash is not null)
    or (status in ('DEPRECATED','ARCHIVED') and published_at is not null and deprecated_at is not null and version_hash is not null)
  ),
  foreign key (hierarchy_id, organization_id, patient_id, target_id, definition_id)
    references public.clinical_aba_prompt_hierarchies_v3(id, organization_id, patient_id, target_id, definition_id)
    on delete restrict,
  unique (hierarchy_id, version),
  unique (id, organization_id, patient_id, target_id, definition_id)
);

create table if not exists public.clinical_aba_prompt_hierarchy_levels_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_id uuid not null,
  hierarchy_version_id uuid not null,
  sequence_no integer not null check (sequence_no > 0),
  prompt_key text not null,
  label text not null,
  category text not null,
  is_independent boolean not null default false,
  legacy_prompt_type_id uuid references public.aba_prompt_types(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint cabav3_prompt_level_key_nonempty check (length(trim(prompt_key)) between 1 and 180),
  constraint cabav3_prompt_level_label_nonempty check (length(trim(label)) between 1 and 180),
  constraint cabav3_prompt_level_category_nonempty check (length(trim(category)) between 1 and 120),
  foreign key (hierarchy_version_id, organization_id, patient_id, target_id, definition_id)
    references public.clinical_aba_prompt_hierarchy_versions_v3(
      id, organization_id, patient_id, target_id, definition_id
    ) on delete restrict,
  unique (hierarchy_version_id, sequence_no),
  unique (hierarchy_version_id, prompt_key),
  unique (id, hierarchy_version_id, organization_id, patient_id, target_id, definition_id)
);

create unique index if not exists ux_cabav3_prompt_one_independent_level
  on public.clinical_aba_prompt_hierarchy_levels_v3(hierarchy_version_id)
  where is_independent;

-- ---------------------------------------------------------------------------
-- Task Analysis step definitions and versioned chaining policy. Eligibility is
-- materialized as a server-owned rule per step; tablets never submit it.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_aba_task_step_definitions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_version_id uuid not null,
  sequence_no integer not null check (sequence_no > 0),
  step_key text not null,
  label text not null,
  created_at timestamptz not null default now(),
  constraint cabav3_task_step_key_nonempty check (length(trim(step_key)) between 1 and 180),
  constraint cabav3_task_step_label_nonempty check (length(trim(label)) between 1 and 240),
  foreign key (definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definition_versions_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  unique (definition_version_id, sequence_no),
  unique (definition_version_id, step_key),
  unique (id, definition_version_id, organization_id, patient_id, target_id)
);

create table if not exists public.clinical_aba_chaining_policy_versions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_version_id uuid not null,
  policy_key text not null,
  version integer not null check (version > 0),
  strategy text not null check (strategy in ('FORWARD','BACKWARD','TOTAL_TASK','CUSTOM')),
  policy_hash text,
  status text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED','DEPRECATED','ARCHIVED')),
  published_at timestamptz,
  deprecated_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cabav3_chaining_policy_key_nonempty check (length(trim(policy_key)) between 1 and 180),
  constraint cabav3_chaining_policy_hash_shape check (policy_hash is null or policy_hash ~ '^[0-9a-f]{64}$'),
  constraint cabav3_chaining_policy_lifecycle check (
    (status = 'DRAFT' and published_at is null and deprecated_at is null and policy_hash is null)
    or (status = 'PUBLISHED' and published_at is not null and deprecated_at is null and policy_hash is not null)
    or (status in ('DEPRECATED','ARCHIVED') and published_at is not null and deprecated_at is not null and policy_hash is not null)
  ),
  foreign key (definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definition_versions_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  unique (definition_version_id, policy_key, version),
  unique (id, organization_id, patient_id, target_id, definition_version_id)
);

create table if not exists public.clinical_aba_chaining_step_rules_v3 (
  policy_version_id uuid not null,
  step_definition_id uuid not null,
  organization_id uuid not null,
  patient_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  sequence_no integer not null check (sequence_no > 0),
  eligibility text not null default 'NOT_ELIGIBLE'
    check (eligibility in ('ACQUISITION','MAINTENANCE','TRAINER_COMPLETED','NOT_ELIGIBLE')),
  created_at timestamptz not null default now(),
  primary key (policy_version_id, step_definition_id),
  foreign key (policy_version_id, organization_id, patient_id, target_id, definition_version_id)
    references public.clinical_aba_chaining_policy_versions_v3(
      id, organization_id, patient_id, target_id, definition_version_id
    ) on delete restrict,
  foreign key (step_definition_id, definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_aba_task_step_definitions_v3(
      id, definition_version_id, organization_id, patient_id, target_id
    ) on delete restrict,
  unique (policy_version_id, sequence_no)
);

-- One immutable server-owned ABA binding per protocol snapshot. It freezes the
-- hierarchy/chaining semantics used to resolve trial and TA eligibility.
create table if not exists public.clinical_aba_protocol_bindings_v3 (
  protocol_snapshot_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  prompt_hierarchy_version_id uuid,
  chaining_policy_version_id uuid,
  initial_opportunity_mode text not null default 'INDEPENDENT_ELIGIBLE'
    check (initial_opportunity_mode in ('INDEPENDENT_ELIGIBLE','ERRORLESS_NO_INDEPENDENT')),
  created_at timestamptz not null default now(),
  foreign key (protocol_snapshot_id, organization_id, patient_id, target_id)
    references public.clinical_collection_protocol_snapshots_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  foreign key (definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definition_versions_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  foreign key (chaining_policy_version_id, organization_id, patient_id, target_id, definition_version_id)
    references public.clinical_aba_chaining_policy_versions_v3(
      id, organization_id, patient_id, target_id, definition_version_id
    ) on delete restrict
);

-- Prompt hierarchy compatibility is definition-identity based (not definition-version
-- based), so it is validated explicitly by the server trigger below.

create index if not exists idx_cabav3_protocol_binding_prompt
  on public.clinical_aba_protocol_bindings_v3(prompt_hierarchy_version_id)
  where prompt_hierarchy_version_id is not null;
create index if not exists idx_cabav3_protocol_binding_chaining
  on public.clinical_aba_protocol_bindings_v3(chaining_policy_version_id)
  where chaining_policy_version_id is not null;

-- ---------------------------------------------------------------------------
-- ABA-specific payload claims remain mutually exclusive with universal raw
-- payload claims without changing the already-deployed generic claim enum.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_aba_raw_payload_claims_v3 (
  event_id uuid primary key references public.clinical_measurement_raw_events_v3(id) on delete restrict,
  payload_kind text not null check (payload_kind in ('ABA_TRIAL','ABA_TASK_ANALYSIS')),
  claimed_at timestamptz not null default now()
);

create or replace function public.guard_clinical_aba_payload_claim_exclusivity_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  -- Serialize generic-vs-ABA claim acquisition on the immutable raw envelope.
  -- This closes the cross-table write-skew race under concurrent ingestion.
  perform 1
  from public.clinical_measurement_raw_events_v3 event
  where event.id = new.event_id
  for update;
  if not found then
    raise exception 'CMV3_ABA_PAYLOAD_EVENT_NOT_FOUND';
  end if;

  if tg_table_name = 'clinical_aba_raw_payload_claims_v3' then
    if exists (select 1 from public.clinical_measurement_raw_event_payload_claims_v3 c where c.event_id = new.event_id) then
      raise exception 'CMV3_ABA_RAW_EVENT_ALREADY_HAS_GENERIC_PAYLOAD';
    end if;
  else
    if exists (select 1 from public.clinical_aba_raw_payload_claims_v3 c where c.event_id = new.event_id) then
      raise exception 'CMV3_RAW_EVENT_ALREADY_HAS_ABA_PAYLOAD';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists guard_cabav3_payload_claim on public.clinical_aba_raw_payload_claims_v3;
create trigger guard_cabav3_payload_claim
before insert on public.clinical_aba_raw_payload_claims_v3
for each row execute function public.guard_clinical_aba_payload_claim_exclusivity_v3();

drop trigger if exists guard_cmv3_generic_claim_against_aba on public.clinical_measurement_raw_event_payload_claims_v3;
create trigger guard_cmv3_generic_claim_against_aba
before insert on public.clinical_measurement_raw_event_payload_claims_v3
for each row execute function public.guard_clinical_aba_payload_claim_exclusivity_v3();

-- Extend the universal deferred payload validator so ABA specialized payloads
-- participate in the exact same one-event/one-payload and correction lineage rules.
create or replace function public.resolve_clinical_measurement_payload_kind_v3(p_event_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  with recursive lineage as (
    select event.id, event.subject_event_id, 0 as depth
    from public.clinical_measurement_raw_events_v3 event
    where event.id = p_event_id
    union all
    select parent.id, parent.subject_event_id, lineage.depth + 1
    from lineage
    join public.clinical_measurement_raw_events_v3 parent on parent.id = lineage.subject_event_id
    where lineage.depth < 64
  ), claims as (
    select lineage.id, lineage.depth, generic.payload_kind
    from lineage
    join public.clinical_measurement_raw_event_payload_claims_v3 generic on generic.event_id = lineage.id
    union all
    select lineage.id, lineage.depth, aba.payload_kind
    from lineage
    join public.clinical_aba_raw_payload_claims_v3 aba on aba.event_id = lineage.id
  )
  select claims.payload_kind from claims order by claims.depth limit 1;
$function$;

create or replace function public.ensure_clinical_measurement_raw_payload_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_payload_kind text;
  v_subject_payload_kind text;
  v_replacement_payload_kind text;
begin
  select coalesce(generic.payload_kind, aba.payload_kind)
    into v_payload_kind
  from (select new.id as event_id) source
  left join public.clinical_measurement_raw_event_payload_claims_v3 generic on generic.event_id = source.event_id
  left join public.clinical_aba_raw_payload_claims_v3 aba on aba.event_id = source.event_id;

  if new.event_kind in ('FACT','CORRECTION') and v_payload_kind is null then
    raise exception 'CMV3_RAW_EVENT_TYPED_PAYLOAD_REQUIRED';
  end if;
  if new.event_kind in ('VOID','SUPERSEDE') and v_payload_kind is not null then
    raise exception 'CMV3_RAW_COMPENSATION_PAYLOAD_FORBIDDEN';
  end if;

  if new.event_kind = 'CORRECTION' then
    v_subject_payload_kind := public.resolve_clinical_measurement_payload_kind_v3(new.subject_event_id);
    if v_subject_payload_kind is null or v_subject_payload_kind is distinct from v_payload_kind then
      raise exception 'CMV3_RAW_CORRECTION_PAYLOAD_KIND_MISMATCH';
    end if;
  end if;

  if new.event_kind = 'SUPERSEDE' then
    v_subject_payload_kind := public.resolve_clinical_measurement_payload_kind_v3(new.subject_event_id);
    v_replacement_payload_kind := public.resolve_clinical_measurement_payload_kind_v3(new.replacement_event_id);
    if v_subject_payload_kind is null or v_replacement_payload_kind is null
       or v_subject_payload_kind is distinct from v_replacement_payload_kind then
      raise exception 'CMV3_RAW_SUPERSEDE_PAYLOAD_KIND_MISMATCH';
    end if;
  end if;
  return null;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Ordered ABA trials. The trial owns no outcome score. Ordered steps are the raw
-- clinical evidence; opportunity_role is always derived by the server.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_aba_trials_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  expectation_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  protocol_snapshot_id uuid not null,
  definition_version_id uuid not null,
  trial_type text not null check (trial_type in (
    'TEACHING','PROBE','BASELINE_PROBE','MAINTENANCE_PROBE','GENERALIZATION','OTHER'
  )),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null,
  constraint cabav3_trial_time_shape check (
    started_at is null or completed_at is null or completed_at >= started_at
  ),
  foreign key (event_id, organization_id, patient_id, session_id, expectation_id, target_id, stream_id)
    references public.clinical_measurement_raw_events_v3(
      id, organization_id, patient_id, session_id, expectation_id, target_id, stream_id
    ) on delete restrict,
  foreign key (protocol_snapshot_id, organization_id, patient_id, target_id)
    references public.clinical_collection_protocol_snapshots_v3(
      id, organization_id, patient_id, target_id
    ) on delete restrict,
  unique (event_id, organization_id, patient_id, target_id, definition_version_id)
);

create index if not exists idx_cabav3_trials_session_target
  on public.clinical_measurement_aba_trials_v3(organization_id, patient_id, session_id, target_id, event_id);

create table if not exists public.clinical_measurement_aba_trial_steps_v3 (
  id uuid primary key default gen_random_uuid(),
  trial_event_id uuid not null,
  organization_id uuid not null,
  patient_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  sequence_no integer not null check (sequence_no > 0),
  client_step_id text not null,
  step_kind text not null check (step_kind in ('RESPONSE','PROMPT','CORRECTION','TRANSFER')),
  opportunity_role text not null default 'SUPPORT'
    check (opportunity_role in ('PRIMARY_INDEPENDENT','SUPPORT','CORRECTION','TRANSFER')),
  outcome text check (outcome is null or outcome in ('CORRECT','INCORRECT','NO_RESPONSE')),
  prompt_level_id uuid,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint cabav3_trial_step_client_id_nonempty check (length(trim(client_step_id)) between 1 and 240),
  constraint cabav3_trial_step_response_shape check (
    (step_kind = 'RESPONSE' and outcome is not null)
    or (step_kind <> 'RESPONSE' and outcome is null)
  ),
  constraint cabav3_trial_step_prompt_shape check (
    (step_kind = 'PROMPT' and prompt_level_id is not null)
    or (step_kind <> 'PROMPT' and prompt_level_id is null)
  ),
  foreign key (trial_event_id, organization_id, patient_id, target_id, definition_version_id)
    references public.clinical_measurement_aba_trials_v3(
      event_id, organization_id, patient_id, target_id, definition_version_id
    ) on delete restrict,
  unique (trial_event_id, sequence_no),
  unique (trial_event_id, client_step_id)
);

create unique index if not exists ux_cabav3_trial_one_primary_independent
  on public.clinical_measurement_aba_trial_steps_v3(trial_event_id)
  where opportunity_role = 'PRIMARY_INDEPENDENT';
create index if not exists idx_cabav3_trial_steps_timeline
  on public.clinical_measurement_aba_trial_steps_v3(trial_event_id, sequence_no);

-- ---------------------------------------------------------------------------
-- Task Analysis raw run + step results. Eligibility is looked up from the frozen
-- chaining policy and cannot be accepted from client payloads.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_aba_task_runs_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  expectation_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  protocol_snapshot_id uuid not null,
  definition_version_id uuid not null,
  chaining_policy_version_id uuid not null,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  created_at timestamptz not null,
  constraint cabav3_task_run_time_shape check (completed_at >= started_at),
  foreign key (event_id, organization_id, patient_id, session_id, expectation_id, target_id, stream_id)
    references public.clinical_measurement_raw_events_v3(
      id, organization_id, patient_id, session_id, expectation_id, target_id, stream_id
    ) on delete restrict,
  foreign key (chaining_policy_version_id, organization_id, patient_id, target_id, definition_version_id)
    references public.clinical_aba_chaining_policy_versions_v3(
      id, organization_id, patient_id, target_id, definition_version_id
    ) on delete restrict,
  unique (event_id, organization_id, patient_id, target_id, definition_version_id)
);

create index if not exists idx_cabav3_task_runs_session_target
  on public.clinical_measurement_aba_task_runs_v3(organization_id, patient_id, session_id, target_id, event_id);

create table if not exists public.clinical_measurement_aba_task_step_results_v3 (
  id uuid primary key default gen_random_uuid(),
  run_event_id uuid not null,
  organization_id uuid not null,
  patient_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  step_definition_id uuid not null,
  sequence_no integer not null check (sequence_no > 0),
  client_step_id text not null,
  eligibility text not null default 'NOT_ELIGIBLE'
    check (eligibility in ('ACQUISITION','MAINTENANCE','TRAINER_COMPLETED','NOT_ELIGIBLE')),
  performance_code text not null
    check (performance_code in ('INDEPENDENT','PROMPTED','INCORRECT','NO_RESPONSE','NOT_APPLICABLE','NOT_OBSERVED')),
  prompt_level_id uuid,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint cabav3_task_result_client_id_nonempty check (length(trim(client_step_id)) between 1 and 240),
  constraint cabav3_task_result_prompt_shape check (
    (performance_code = 'PROMPTED' and prompt_level_id is not null)
    or (performance_code <> 'PROMPTED' and prompt_level_id is null)
  ),
  foreign key (run_event_id, organization_id, patient_id, target_id, definition_version_id)
    references public.clinical_measurement_aba_task_runs_v3(
      event_id, organization_id, patient_id, target_id, definition_version_id
    ) on delete restrict,
  foreign key (step_definition_id, definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_aba_task_step_definitions_v3(
      id, definition_version_id, organization_id, patient_id, target_id
    ) on delete restrict,
  unique (run_event_id, sequence_no),
  unique (run_event_id, step_definition_id),
  unique (run_event_id, client_step_id)
);

-- ---------------------------------------------------------------------------
-- Scope/semantic validators. These are server-owned and intentionally do not
-- expose writer functions to authenticated/browser roles.
-- ---------------------------------------------------------------------------
create or replace function public.validate_clinical_aba_configuration_scope_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_family text;
  v_org uuid;
  v_patient uuid;
  v_target uuid;
begin
  if tg_table_name = 'clinical_aba_prompt_hierarchies_v3' then
    select d.semantic_family, d.organization_id, d.patient_id, d.target_id
      into v_family, v_org, v_patient, v_target
    from public.clinical_measurement_definitions_v3 d
    where d.id = new.definition_id;
    if not found or v_org is distinct from new.organization_id
       or v_patient is distinct from new.patient_id or v_target is distinct from new.target_id
       or v_family not in ('PROPORTION','TASK_ANALYSIS') then
      raise exception 'CMV3_ABA_PROMPT_HIERARCHY_DEFINITION_INVALID';
    end if;
  else
    select d.semantic_family, v.organization_id, v.patient_id, v.target_id
      into v_family, v_org, v_patient, v_target
    from public.clinical_measurement_definition_versions_v3 v
    join public.clinical_measurement_definitions_v3 d on d.id = v.definition_id
    where v.id = new.definition_version_id;
    if not found or v_org is distinct from new.organization_id
       or v_patient is distinct from new.patient_id or v_target is distinct from new.target_id
       or v_family <> 'TASK_ANALYSIS' then
      raise exception 'CMV3_ABA_TASK_ANALYSIS_DEFINITION_INVALID';
    end if;

    if tg_table_name = 'clinical_aba_task_step_definitions_v3' and exists (
      select 1
      from public.clinical_aba_chaining_policy_versions_v3 policy
      where policy.definition_version_id = new.definition_version_id
        and policy.status in ('PUBLISHED','DEPRECATED','ARCHIVED')
    ) then
      raise exception 'CMV3_ABA_TASK_STEP_SET_ALREADY_SEALED';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.validate_clinical_aba_protocol_binding_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_snapshot public.clinical_collection_protocol_snapshots_v3%rowtype;
  v_definition public.clinical_measurement_definition_versions_v3%rowtype;
  v_prompt public.clinical_aba_prompt_hierarchy_versions_v3%rowtype;
  v_chain public.clinical_aba_chaining_policy_versions_v3%rowtype;
begin
  select * into v_snapshot from public.clinical_collection_protocol_snapshots_v3 where id = new.protocol_snapshot_id;
  if not found
     or v_snapshot.organization_id is distinct from new.organization_id
     or v_snapshot.patient_id is distinct from new.patient_id
     or v_snapshot.target_id is distinct from new.target_id
     or v_snapshot.definition_version_id is distinct from new.definition_version_id then
    raise exception 'CMV3_ABA_PROTOCOL_SNAPSHOT_SCOPE_INVALID';
  end if;

  select * into v_definition from public.clinical_measurement_definition_versions_v3 where id = new.definition_version_id;
  if not found or v_definition.organization_id is distinct from new.organization_id
     or v_definition.patient_id is distinct from new.patient_id
     or v_definition.target_id is distinct from new.target_id then
    raise exception 'CMV3_ABA_PROTOCOL_DEFINITION_SCOPE_INVALID';
  end if;

  if new.prompt_hierarchy_version_id is not null then
    select * into v_prompt from public.clinical_aba_prompt_hierarchy_versions_v3 where id = new.prompt_hierarchy_version_id;
    if not found or v_prompt.organization_id is distinct from new.organization_id
       or v_prompt.patient_id is distinct from new.patient_id
       or v_prompt.target_id is distinct from new.target_id
       or v_prompt.definition_id is distinct from v_definition.definition_id
       or v_prompt.status <> 'PUBLISHED' then
      raise exception 'CMV3_ABA_PROMPT_HIERARCHY_SCOPE_INVALID';
    end if;
  end if;

  if new.chaining_policy_version_id is not null then
    select * into v_chain from public.clinical_aba_chaining_policy_versions_v3 where id = new.chaining_policy_version_id;
    if not found or v_chain.organization_id is distinct from new.organization_id
       or v_chain.patient_id is distinct from new.patient_id
       or v_chain.target_id is distinct from new.target_id
       or v_chain.definition_version_id is distinct from new.definition_version_id
       or v_chain.status <> 'PUBLISHED' then
      raise exception 'CMV3_ABA_CHAINING_POLICY_SCOPE_INVALID';
    end if;
  end if;

  if v_definition.content->>'kind' = 'TASK_ANALYSIS' and new.chaining_policy_version_id is null then
    raise exception 'CMV3_ABA_TASK_ANALYSIS_REQUIRES_CHAINING_POLICY';
  end if;

  return new;
end;
$function$;

create or replace function public.prepare_clinical_aba_trial_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_event public.clinical_measurement_raw_events_v3%rowtype;
  v_binding public.clinical_aba_protocol_bindings_v3%rowtype;
begin
  select * into v_event from public.clinical_measurement_raw_events_v3 where id = new.event_id;
  if not found or v_event.organization_id is distinct from new.organization_id
     or v_event.patient_id is distinct from new.patient_id
     or v_event.session_id is distinct from new.session_id
     or v_event.expectation_id is distinct from new.expectation_id
     or v_event.target_id is distinct from new.target_id
     or v_event.stream_id is distinct from new.stream_id
     or v_event.protocol_snapshot_id is distinct from new.protocol_snapshot_id
     or v_event.definition_version_id is distinct from new.definition_version_id
     or v_event.semantic_family <> 'PROPORTION'
     or v_event.event_kind not in ('FACT','CORRECTION') then
    raise exception 'CMV3_ABA_TRIAL_RAW_EVENT_INVALID';
  end if;

  select * into v_binding from public.clinical_aba_protocol_bindings_v3 where protocol_snapshot_id = new.protocol_snapshot_id;
  if not found then raise exception 'CMV3_ABA_TRIAL_PROTOCOL_BINDING_REQUIRED'; end if;

  new.created_at := v_event.recorded_at;
  insert into public.clinical_aba_raw_payload_claims_v3(event_id, payload_kind)
  values (new.event_id, 'ABA_TRIAL');
  return new;
end;
$function$;

create or replace function public.prepare_clinical_aba_trial_step_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_trial public.clinical_measurement_aba_trials_v3%rowtype;
  v_binding public.clinical_aba_protocol_bindings_v3%rowtype;
  v_level public.clinical_aba_prompt_hierarchy_levels_v3%rowtype;
begin
  select * into v_trial from public.clinical_measurement_aba_trials_v3 where event_id = new.trial_event_id;
  if not found then raise exception 'CMV3_ABA_TRIAL_STEP_TRIAL_NOT_FOUND'; end if;
  if (v_trial.started_at is not null and new.occurred_at < v_trial.started_at)
     or (v_trial.completed_at is not null and new.occurred_at > v_trial.completed_at) then
    raise exception 'CMV3_ABA_TRIAL_STEP_OUTSIDE_TRIAL_WINDOW';
  end if;
  new.organization_id := v_trial.organization_id;
  new.patient_id := v_trial.patient_id;
  new.target_id := v_trial.target_id;
  new.definition_version_id := v_trial.definition_version_id;

  select * into v_binding from public.clinical_aba_protocol_bindings_v3 where protocol_snapshot_id = v_trial.protocol_snapshot_id;
  if not found then raise exception 'CMV3_ABA_TRIAL_STEP_PROTOCOL_BINDING_REQUIRED'; end if;

  if new.prompt_level_id is not null then
    if v_binding.prompt_hierarchy_version_id is null then raise exception 'CMV3_ABA_PROMPT_NOT_CONFIGURED'; end if;
    select * into v_level from public.clinical_aba_prompt_hierarchy_levels_v3 level
    where level.id = new.prompt_level_id and level.hierarchy_version_id = v_binding.prompt_hierarchy_version_id;
    if not found or v_level.organization_id is distinct from v_trial.organization_id
       or v_level.patient_id is distinct from v_trial.patient_id
       or v_level.target_id is distinct from v_trial.target_id
       or v_level.is_independent then
      raise exception 'CMV3_ABA_PROMPT_LEVEL_SCOPE_INVALID';
    end if;
  end if;

  if new.step_kind = 'CORRECTION' then
    new.opportunity_role := 'CORRECTION';
  elsif new.step_kind = 'TRANSFER' then
    new.opportunity_role := 'TRANSFER';
  elsif new.step_kind = 'PROMPT' then
    new.opportunity_role := 'SUPPORT';
  elsif new.step_kind = 'RESPONSE'
        and new.sequence_no = 1
        and v_binding.initial_opportunity_mode = 'INDEPENDENT_ELIGIBLE' then
    new.opportunity_role := 'PRIMARY_INDEPENDENT';
  else
    new.opportunity_role := 'SUPPORT';
  end if;

  return new;
end;
$function$;

create or replace function public.prepare_clinical_aba_task_run_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_event public.clinical_measurement_raw_events_v3%rowtype;
  v_binding public.clinical_aba_protocol_bindings_v3%rowtype;
begin
  select * into v_event from public.clinical_measurement_raw_events_v3 where id = new.event_id;
  if not found or v_event.organization_id is distinct from new.organization_id
     or v_event.patient_id is distinct from new.patient_id
     or v_event.session_id is distinct from new.session_id
     or v_event.expectation_id is distinct from new.expectation_id
     or v_event.target_id is distinct from new.target_id
     or v_event.stream_id is distinct from new.stream_id
     or v_event.protocol_snapshot_id is distinct from new.protocol_snapshot_id
     or v_event.definition_version_id is distinct from new.definition_version_id
     or v_event.semantic_family <> 'TASK_ANALYSIS'
     or v_event.event_kind not in ('FACT','CORRECTION') then
    raise exception 'CMV3_ABA_TASK_RUN_RAW_EVENT_INVALID';
  end if;

  select * into v_binding from public.clinical_aba_protocol_bindings_v3 where protocol_snapshot_id = new.protocol_snapshot_id;
  if not found or v_binding.chaining_policy_version_id is null
     or v_binding.chaining_policy_version_id is distinct from new.chaining_policy_version_id then
    raise exception 'CMV3_ABA_TASK_RUN_CHAINING_BINDING_INVALID';
  end if;

  new.created_at := v_event.recorded_at;
  insert into public.clinical_aba_raw_payload_claims_v3(event_id, payload_kind)
  values (new.event_id, 'ABA_TASK_ANALYSIS');
  return new;
end;
$function$;

create or replace function public.prepare_clinical_aba_task_result_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_run public.clinical_measurement_aba_task_runs_v3%rowtype;
  v_rule public.clinical_aba_chaining_step_rules_v3%rowtype;
  v_binding public.clinical_aba_protocol_bindings_v3%rowtype;
  v_level public.clinical_aba_prompt_hierarchy_levels_v3%rowtype;
begin
  select * into v_run from public.clinical_measurement_aba_task_runs_v3 where event_id = new.run_event_id;
  if not found then raise exception 'CMV3_ABA_TASK_RESULT_RUN_NOT_FOUND'; end if;
  if new.occurred_at < v_run.started_at or new.occurred_at > v_run.completed_at then
    raise exception 'CMV3_ABA_TASK_RESULT_OUTSIDE_RUN_WINDOW';
  end if;
  new.organization_id := v_run.organization_id;
  new.patient_id := v_run.patient_id;
  new.target_id := v_run.target_id;
  new.definition_version_id := v_run.definition_version_id;

  select * into v_rule from public.clinical_aba_chaining_step_rules_v3 rule
  where rule.policy_version_id = v_run.chaining_policy_version_id
    and rule.step_definition_id = new.step_definition_id
    and rule.sequence_no = new.sequence_no;
  if not found then raise exception 'CMV3_ABA_TASK_STEP_NOT_IN_CHAINING_POLICY'; end if;
  new.eligibility := v_rule.eligibility;

  if new.prompt_level_id is not null then
    select * into v_binding from public.clinical_aba_protocol_bindings_v3 where protocol_snapshot_id = v_run.protocol_snapshot_id;
    if not found or v_binding.prompt_hierarchy_version_id is null then raise exception 'CMV3_ABA_TASK_PROMPT_NOT_CONFIGURED'; end if;
    select * into v_level from public.clinical_aba_prompt_hierarchy_levels_v3 level
    where level.id = new.prompt_level_id and level.hierarchy_version_id = v_binding.prompt_hierarchy_version_id;
    if not found or v_level.is_independent then raise exception 'CMV3_ABA_TASK_PROMPT_LEVEL_INVALID'; end if;
  end if;

  return new;
end;
$function$;

-- Draft configuration rows are populated first, then atomically published. The
-- server computes hashes from the complete ordered level/rule set at publication.
create or replace function public.guard_clinical_aba_config_child_insert_v3()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public set row_security = off
as $function$
declare
  v_status text;
  v_prompt_org uuid;
begin
  if tg_table_name = 'clinical_aba_prompt_hierarchy_levels_v3' then
    select status into v_status from public.clinical_aba_prompt_hierarchy_versions_v3 where id = new.hierarchy_version_id;
    if v_status is distinct from 'DRAFT' then raise exception 'CMV3_ABA_PROMPT_VERSION_NOT_DRAFT'; end if;
    if new.legacy_prompt_type_id is not null then
      select organization_id into v_prompt_org from public.aba_prompt_types where id = new.legacy_prompt_type_id;
      if not found or v_prompt_org is distinct from new.organization_id then
        raise exception 'CMV3_ABA_LEGACY_PROMPT_SCOPE_INVALID';
      end if;
    end if;
  else
    select status into v_status from public.clinical_aba_chaining_policy_versions_v3 where id = new.policy_version_id;
    if v_status is distinct from 'DRAFT' then raise exception 'CMV3_ABA_CHAINING_VERSION_NOT_DRAFT'; end if;
  end if;
  return new;
end;
$function$;

create or replace function public.publish_clinical_aba_prompt_hierarchy_version_v3(p_version_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public, extensions set row_security = off
as $function$
declare
  v_version public.clinical_aba_prompt_hierarchy_versions_v3%rowtype;
  v_levels jsonb;
  v_independent_count integer;
begin
  select * into v_version from public.clinical_aba_prompt_hierarchy_versions_v3 where id = p_version_id for update;
  if not found or v_version.status <> 'DRAFT' then raise exception 'CMV3_ABA_PROMPT_PUBLISH_REQUIRES_DRAFT'; end if;

  select jsonb_agg(jsonb_build_object(
           'sequence_no', l.sequence_no, 'prompt_key', l.prompt_key, 'label', l.label,
           'category', l.category, 'is_independent', l.is_independent
         ) order by l.sequence_no),
         count(*) filter (where l.is_independent)
    into v_levels, v_independent_count
  from public.clinical_aba_prompt_hierarchy_levels_v3 l
  where l.hierarchy_version_id = p_version_id;

  if jsonb_array_length(coalesce(v_levels, '[]'::jsonb)) < 2 then raise exception 'CMV3_ABA_PROMPT_HIERARCHY_TOO_SHORT'; end if;
  if v_independent_count <> 1 then raise exception 'CMV3_ABA_PROMPT_HIERARCHY_REQUIRES_ONE_INDEPENDENT'; end if;

  update public.clinical_aba_prompt_hierarchy_versions_v3
     set status = 'PUBLISHED', published_at = clock_timestamp(),
         version_hash = encode(digest(convert_to(jsonb_build_object(
           'hierarchy_id', v_version.hierarchy_id, 'version', v_version.version,
           'strategy', v_version.strategy, 'levels', v_levels
         )::text,'UTF8'),'sha256'),'hex')
   where id = p_version_id;
end;
$function$;

create or replace function public.publish_clinical_aba_chaining_policy_version_v3(p_version_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public, extensions set row_security = off
as $function$
declare
  v_version public.clinical_aba_chaining_policy_versions_v3%rowtype;
  v_rules jsonb;
  v_rule_count integer;
  v_step_count integer;
begin
  select * into v_version from public.clinical_aba_chaining_policy_versions_v3 where id = p_version_id for update;
  if not found or v_version.status <> 'DRAFT' then raise exception 'CMV3_ABA_CHAINING_PUBLISH_REQUIRES_DRAFT'; end if;

  select count(*) into v_step_count
  from public.clinical_aba_task_step_definitions_v3 s
  where s.definition_version_id = v_version.definition_version_id;
  select jsonb_agg(jsonb_build_object(
           'sequence_no', r.sequence_no, 'step_definition_id', r.step_definition_id,
           'eligibility', r.eligibility
         ) order by r.sequence_no), count(*)
    into v_rules, v_rule_count
  from public.clinical_aba_chaining_step_rules_v3 r
  where r.policy_version_id = p_version_id;

  if v_step_count = 0 or v_rule_count <> v_step_count then
    raise exception 'CMV3_ABA_CHAINING_RULE_COVERAGE_INCOMPLETE';
  end if;

  update public.clinical_aba_chaining_policy_versions_v3
     set status = 'PUBLISHED', published_at = clock_timestamp(),
         policy_hash = encode(digest(convert_to(jsonb_build_object(
           'definition_version_id', v_version.definition_version_id,
           'policy_key', v_version.policy_key, 'version', v_version.version,
           'strategy', v_version.strategy, 'rules', v_rules
         )::text,'UTF8'),'sha256'),'hex')
   where id = p_version_id;
end;
$function$;

create or replace function public.guard_clinical_aba_append_only_v3()
returns trigger language plpgsql set search_path = pg_catalog, public
as $function$
begin
  raise exception 'CMV3_ABA_APPEND_ONLY';
end;
$function$;

create or replace function public.guard_clinical_aba_version_lifecycle_v3()
returns trigger language plpgsql set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then raise exception 'CMV3_ABA_VERSION_DELETE_FORBIDDEN'; end if;

  if old.status = 'DRAFT' and new.status = 'PUBLISHED' then
    if (to_jsonb(old) - array['status','published_at','version_hash','policy_hash']::text[])
       is distinct from (to_jsonb(new) - array['status','published_at','version_hash','policy_hash']::text[]) then
      raise exception 'CMV3_ABA_VERSION_PUBLISH_MUTATION_INVALID';
    end if;
    return new;
  end if;

  if old.status = 'PUBLISHED' and new.status in ('DEPRECATED','ARCHIVED') then
    if (to_jsonb(old) - array['status','deprecated_at']::text[])
       is distinct from (to_jsonb(new) - array['status','deprecated_at']::text[]) then
      raise exception 'CMV3_ABA_VERSION_IMMUTABLE';
    end if;
    if new.deprecated_at is null then raise exception 'CMV3_ABA_VERSION_DEPRECATION_TIME_REQUIRED'; end if;
    return new;
  end if;

  raise exception 'CMV3_ABA_VERSION_TRANSITION_INVALID';
end;
$function$;

-- Validators/triggers.
drop trigger if exists validate_cabav3_prompt_hierarchy_scope on public.clinical_aba_prompt_hierarchies_v3;
create trigger validate_cabav3_prompt_hierarchy_scope
before insert on public.clinical_aba_prompt_hierarchies_v3
for each row execute function public.validate_clinical_aba_configuration_scope_v3();

drop trigger if exists validate_cabav3_task_step_scope on public.clinical_aba_task_step_definitions_v3;
create trigger validate_cabav3_task_step_scope
before insert on public.clinical_aba_task_step_definitions_v3
for each row execute function public.validate_clinical_aba_configuration_scope_v3();

drop trigger if exists validate_cabav3_chaining_scope on public.clinical_aba_chaining_policy_versions_v3;
create trigger validate_cabav3_chaining_scope
before insert on public.clinical_aba_chaining_policy_versions_v3
for each row execute function public.validate_clinical_aba_configuration_scope_v3();

drop trigger if exists validate_cabav3_protocol_binding on public.clinical_aba_protocol_bindings_v3;
create trigger validate_cabav3_protocol_binding
before insert on public.clinical_aba_protocol_bindings_v3
for each row execute function public.validate_clinical_aba_protocol_binding_v3();

drop trigger if exists guard_cabav3_prompt_level_insert on public.clinical_aba_prompt_hierarchy_levels_v3;
create trigger guard_cabav3_prompt_level_insert
before insert on public.clinical_aba_prompt_hierarchy_levels_v3
for each row execute function public.guard_clinical_aba_config_child_insert_v3();

drop trigger if exists guard_cabav3_chaining_rule_insert on public.clinical_aba_chaining_step_rules_v3;
create trigger guard_cabav3_chaining_rule_insert
before insert on public.clinical_aba_chaining_step_rules_v3
for each row execute function public.guard_clinical_aba_config_child_insert_v3();

drop trigger if exists prepare_cabav3_trial on public.clinical_measurement_aba_trials_v3;
create trigger prepare_cabav3_trial
before insert on public.clinical_measurement_aba_trials_v3
for each row execute function public.prepare_clinical_aba_trial_v3();

drop trigger if exists prepare_cabav3_trial_step on public.clinical_measurement_aba_trial_steps_v3;
create trigger prepare_cabav3_trial_step
before insert on public.clinical_measurement_aba_trial_steps_v3
for each row execute function public.prepare_clinical_aba_trial_step_v3();

drop trigger if exists prepare_cabav3_task_run on public.clinical_measurement_aba_task_runs_v3;
create trigger prepare_cabav3_task_run
before insert on public.clinical_measurement_aba_task_runs_v3
for each row execute function public.prepare_clinical_aba_task_run_v3();

drop trigger if exists prepare_cabav3_task_result on public.clinical_measurement_aba_task_step_results_v3;
create trigger prepare_cabav3_task_result
before insert on public.clinical_measurement_aba_task_step_results_v3
for each row execute function public.prepare_clinical_aba_task_result_v3();

-- All ABA V3 configuration/raw facts except version lifecycle rows are immutable.
do $cabav3_append_only_triggers$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinical_aba_prompt_hierarchies_v3',
    'clinical_aba_prompt_hierarchy_levels_v3',
    'clinical_aba_task_step_definitions_v3',
    'clinical_aba_chaining_step_rules_v3',
    'clinical_aba_protocol_bindings_v3',
    'clinical_aba_raw_payload_claims_v3',
    'clinical_measurement_aba_trials_v3',
    'clinical_measurement_aba_trial_steps_v3',
    'clinical_measurement_aba_task_runs_v3',
    'clinical_measurement_aba_task_step_results_v3'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'guard_' || v_table || '_append_only', v_table);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.guard_clinical_aba_append_only_v3()',
      'guard_' || v_table || '_append_only', v_table
    );
  end loop;
end;
$cabav3_append_only_triggers$;

drop trigger if exists guard_cabav3_prompt_hierarchy_version on public.clinical_aba_prompt_hierarchy_versions_v3;
create trigger guard_cabav3_prompt_hierarchy_version
before update or delete on public.clinical_aba_prompt_hierarchy_versions_v3
for each row execute function public.guard_clinical_aba_version_lifecycle_v3();

drop trigger if exists guard_cabav3_chaining_policy_version on public.clinical_aba_chaining_policy_versions_v3;
create trigger guard_cabav3_chaining_policy_version
before update or delete on public.clinical_aba_chaining_policy_versions_v3
for each row execute function public.guard_clinical_aba_version_lifecycle_v3();

-- RLS/dark surface. No browser role receives direct access.
do $cabav3_rls$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinical_aba_prompt_hierarchies_v3',
    'clinical_aba_prompt_hierarchy_versions_v3',
    'clinical_aba_prompt_hierarchy_levels_v3',
    'clinical_aba_task_step_definitions_v3',
    'clinical_aba_chaining_policy_versions_v3',
    'clinical_aba_chaining_step_rules_v3',
    'clinical_aba_protocol_bindings_v3',
    'clinical_aba_raw_payload_claims_v3',
    'clinical_measurement_aba_trials_v3',
    'clinical_measurement_aba_trial_steps_v3',
    'clinical_measurement_aba_task_runs_v3',
    'clinical_measurement_aba_task_step_results_v3'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant all on table public.%I to service_role', v_table);
  end loop;
end;
$cabav3_rls$;

-- Functions are service-only.
do $cabav3_function_acl$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.guard_clinical_aba_payload_claim_exclusivity_v3()',
    'public.resolve_clinical_measurement_payload_kind_v3(uuid)',
    'public.ensure_clinical_measurement_raw_payload_v3()',
    'public.validate_clinical_aba_configuration_scope_v3()',
    'public.validate_clinical_aba_protocol_binding_v3()',
    'public.prepare_clinical_aba_trial_v3()',
    'public.prepare_clinical_aba_trial_step_v3()',
    'public.prepare_clinical_aba_task_run_v3()',
    'public.prepare_clinical_aba_task_result_v3()',
    'public.guard_clinical_aba_config_child_insert_v3()',
    'public.publish_clinical_aba_prompt_hierarchy_version_v3(uuid)',
    'public.publish_clinical_aba_chaining_policy_version_v3(uuid)',
    'public.guard_clinical_aba_append_only_v3()',
    'public.guard_clinical_aba_version_lifecycle_v3()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end;
$cabav3_function_acl$;


-- ===========================================================================


do $cmv3_prod_split_part2_postflight$
declare v_missing text[] := '{}'::text[]; v_enabled bigint := 0; v_raw bigint := 0;
begin
  if to_regclass('public.clinical_measurement_sessions_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_sessions_v3'); end if;
  if to_regclass('public.clinical_measurement_session_expectations_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_session_expectations_v3'); end if;
  if to_regclass('public.clinical_measurement_collection_streams_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_collection_streams_v3'); end if;
  if to_regclass('public.clinical_measurement_raw_events_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_raw_events_v3'); end if;
  if to_regclass('public.clinical_measurement_observation_slices_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_observation_slices_v3'); end if;
  if to_regclass('public.clinical_measurement_aba_trials_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_aba_trials_v3'); end if;
  if to_regclass('public.clinical_measurement_aba_trial_steps_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_aba_trial_steps_v3'); end if;
  if cardinality(v_missing)>0 then raise exception 'CMV3_SPLIT_PART2_POSTFLIGHT_MISSING:%',array_to_string(v_missing,', '); end if;
  select count(*) into v_enabled from public.aba_measurement_rollout_states_v3 where allow_new_v3_sessions is true;
  if v_enabled<>0 then raise exception 'CMV3_SPLIT_PART2_CHANGED_ROLLOUT:%',v_enabled; end if;
  select count(*) into v_raw from public.clinical_measurement_raw_events_v3;
  if v_raw<>0 then raise exception 'CMV3_SPLIT_PART2_UNEXPECTED_RAW_DATA:%',v_raw; end if;
end;
$cmv3_prod_split_part2_postflight$;
commit;
select jsonb_build_object('gate','PRODUCTION_SCHEMA_PROMOTION_PART_2_PASS','next_step','RUN_PART_3','cmv3_raw_event_count',(select count(*) from public.clinical_measurement_raw_events_v3)) as result;
