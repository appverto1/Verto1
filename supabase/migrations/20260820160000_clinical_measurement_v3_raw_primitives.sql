-- Verto Clinical Measurement Engine V3 - Raw Measurement Primitives.
-- Additive/dark only. Creates append-only accepted-event envelopes plus typed raw
-- primitives. Does not enable browser writers, projections, graphs or ABA V3 rollout.

begin;

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

commit;
