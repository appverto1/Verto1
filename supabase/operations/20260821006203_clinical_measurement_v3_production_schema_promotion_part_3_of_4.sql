-- Verto Clinical Measurement Engine V3
-- Production schema catch-up promotion — SPLIT EXECUTION
--
-- IMPORTANT
--   Execute the four parts in numerical order, in PRODUCTION.
--   Each part is its own transaction and is independently fail-closed.
--   If any part fails, stop and send the error before continuing.
--   No part enables ABA V3 rollout or performs clinical backfill/shadow execution.

-- PART 3/4

begin;
set local lock_timeout = '5s';

do $cmv3_prod_split_part3_preflight$
declare
  v_missing text[] := '{}'::text[];
  v_present text[] := '{}'::text[];
  v_enabled bigint := 0;
begin
  if to_regclass('public.clinical_measurement_sessions_v3') is null then v_missing := array_append(v_missing,'part2:clinical_measurement_sessions_v3'); end if;
  if to_regclass('public.clinical_measurement_raw_events_v3') is null then v_missing := array_append(v_missing,'part2:clinical_measurement_raw_events_v3'); end if;
  if to_regclass('public.clinical_measurement_aba_trials_v3') is null then v_missing := array_append(v_missing,'part2:clinical_measurement_aba_trials_v3'); end if;
  if cardinality(v_missing) > 0 then raise exception 'CMV3_SPLIT_PART3_REQUIRES_PART2:%', array_to_string(v_missing,', '); end if;

  if to_regclass('public.clinical_measurement_sync_batches_v3') is not null then v_present := array_append(v_present,'clinical_measurement_sync_batches_v3'); end if;
  if to_regclass('public.clinical_measurement_projection_queue_v3') is not null then v_present := array_append(v_present,'clinical_measurement_projection_queue_v3'); end if;
  if to_regclass('public.clinical_measurement_evidence_revisions_v3') is not null then v_present := array_append(v_present,'clinical_measurement_evidence_revisions_v3'); end if;
  if cardinality(v_present) > 0 then raise exception 'CMV3_SPLIT_PART3_ALREADY_OR_PARTIALLY_APPLIED:%', array_to_string(v_present,', '); end if;

  select count(*) into v_enabled from public.aba_measurement_rollout_states_v3 where allow_new_v3_sessions is true;
  if v_enabled <> 0 then raise exception 'CMV3_SPLIT_PART3_ACTIVE_ROLLOUT:%', v_enabled; end if;
end;
$cmv3_prod_split_part3_preflight$;

-- Embedded canonical block 07/12: 20260820190000_clinical_measurement_v3_bulk_ingestion.sql
-- ===========================================================================
-- Verto Clinical Measurement Engine V3 - Bulk/offline ingestion.
-- Additive/dark only. Adds one server-only transactional entrypoint and set-based
-- payload handlers. No authenticated/browser grant and no rollout change.


create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Append-only ingestion provenance. Failed batches leave no row because the RPC
-- is atomic; accepted batches can be replayed exactly by client_batch_id + hash.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_sync_batches_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  actor_membership_id uuid not null references public.clinic_memberships(id) on delete restrict,
  client_batch_id text not null,
  payload_hash text not null,
  item_count integer not null check (item_count between 1 and 500),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint cmv3_sync_batch_client_id_shape check (length(trim(client_batch_id)) between 1 and 180),
  constraint cmv3_sync_batch_hash_shape check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint cmv3_sync_batch_clock_shape check (created_at = received_at),
  unique (organization_id, client_batch_id),
  unique (id, organization_id, patient_id)
);

create table if not exists public.clinical_measurement_sync_batch_events_v3 (
  batch_id uuid not null,
  ordinal integer not null check (ordinal > 0),
  organization_id uuid not null,
  patient_id uuid not null,
  event_id uuid not null,
  client_event_id text not null,
  created_at timestamptz not null default now(),
  primary key (batch_id, ordinal),
  foreign key (batch_id, organization_id, patient_id)
    references public.clinical_measurement_sync_batches_v3(id, organization_id, patient_id)
    on delete restrict,
  foreign key (event_id)
    references public.clinical_measurement_raw_events_v3(id)
    on delete restrict,
  unique (batch_id, client_event_id),
  unique (batch_id, event_id)
);

create index if not exists idx_cmv3_sync_batches_patient
  on public.clinical_measurement_sync_batches_v3(organization_id, patient_id, received_at desc);
create index if not exists idx_cmv3_sync_batch_events_event
  on public.clinical_measurement_sync_batch_events_v3(event_id, batch_id);

-- ABA trial intent is frozen server-side per protocol snapshot. The tablet may
-- record trial mechanics, but cannot declare whether a trial is teaching/probe.
create table if not exists public.clinical_aba_trial_protocol_intents_v3 (
  protocol_snapshot_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  trial_type text not null check (trial_type in (
    'TEACHING','PROBE','BASELINE_PROBE','MAINTENANCE_PROBE','GENERALIZATION','OTHER'
  )),
  created_at timestamptz not null default now(),
  foreign key (protocol_snapshot_id)
    references public.clinical_aba_protocol_bindings_v3(protocol_snapshot_id) on delete restrict,
  foreign key (protocol_snapshot_id, organization_id, patient_id, target_id)
    references public.clinical_collection_protocol_snapshots_v3(
      id, organization_id, patient_id, target_id
    ) on delete restrict,
  foreign key (definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definition_versions_v3(
      id, organization_id, patient_id, target_id
    ) on delete restrict
);

create or replace function public.prepare_clinical_aba_trial_protocol_intent_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_snapshot public.clinical_collection_protocol_snapshots_v3%rowtype;
  v_family text;
begin
  select * into v_snapshot
  from public.clinical_collection_protocol_snapshots_v3 snapshot
  where snapshot.id = new.protocol_snapshot_id;

  if not found then
    raise exception 'CMV3_ABA_TRIAL_INTENT_SNAPSHOT_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.clinical_aba_protocol_bindings_v3 binding
    where binding.protocol_snapshot_id = v_snapshot.id
  ) then
    raise exception 'CMV3_ABA_TRIAL_INTENT_BINDING_REQUIRED';
  end if;

  select definition.semantic_family into v_family
  from public.clinical_measurement_definition_versions_v3 version
  join public.clinical_measurement_definitions_v3 definition
    on definition.id = version.definition_id
   and definition.organization_id = version.organization_id
   and definition.patient_id = version.patient_id
   and definition.target_id = version.target_id
  where version.id = v_snapshot.definition_version_id;

  if v_family is distinct from 'PROPORTION' then
    raise exception 'CMV3_ABA_TRIAL_INTENT_REQUIRES_PROPORTION';
  end if;

  new.organization_id := v_snapshot.organization_id;
  new.patient_id := v_snapshot.patient_id;
  new.target_id := v_snapshot.target_id;
  new.definition_version_id := v_snapshot.definition_version_id;
  new.created_at := clock_timestamp();
  return new;
end;
$function$;

create or replace function public.guard_clinical_aba_trial_protocol_intent_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'CMV3_ABA_TRIAL_PROTOCOL_INTENT_IMMUTABLE';
end;
$function$;

create or replace function public.guard_clinical_measurement_sync_provenance_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'CMV3_SYNC_PROVENANCE_APPEND_ONLY';
end;
$function$;

-- ---------------------------------------------------------------------------
-- Shared validation helpers. They never trust organization/patient/scope fields
-- from the payload; stream scope and actor authority are resolved server-side.
-- ---------------------------------------------------------------------------
create or replace function public.validate_clinical_measurement_sync_batch_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_actor_membership_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_actor_role text;
  v_actor_status text;
  v_actor_clinic uuid;
  v_step_count bigint;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'CMV3_SYNC_ITEMS_ARRAY_REQUIRED';
  end if;

  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 500 then
    raise exception 'CMV3_SYNC_BATCH_SIZE_INVALID';
  end if;

  if octet_length(p_items::text) > 2000000 then
    raise exception 'CMV3_SYNC_BATCH_BYTES_EXCEEDED';
  end if;

  select membership.clinic_id, lower(coalesce(membership.status,'')), lower(coalesce(membership.role,''))
    into v_actor_clinic, v_actor_status, v_actor_role
  from public.clinic_memberships membership
  where membership.id = p_actor_membership_id;

  if not found or v_actor_clinic is distinct from p_organization_id or v_actor_status <> 'active' then
    raise exception 'CMV3_SYNC_ACTOR_SCOPE_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where nullif(trim(item->>'client_event_id'),'') is null
       or length(trim(item->>'client_event_id')) > 240
       or nullif(trim(item->>'stream_id'),'') is null
       or nullif(trim(item->>'occurred_at_utc'),'') is null
       or coalesce(item->>'event_kind','FACT') not in ('FACT','CORRECTION','VOID','SUPERSEDE')
       or coalesce(item->>'ingestion_mode','') not in ('LIVE','OFFLINE_SYNC','RETROSPECTIVE_ENTRY','CORRECTION')
  ) then
    raise exception 'CMV3_SYNC_ENVELOPE_SHAPE_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where item ?| array[
      'organization_id','patient_id','actor_membership_id','clinical_date',
      'local_occurred_date','timezone_snapshot','timezone_offset_minutes',
      'protocol_snapshot_id','definition_version_id','phase_epoch_id','semantic_family',
      'payload_hash','recorded_at','received_at'
    ]
  ) then
    raise exception 'CMV3_SYNC_SERVER_OWNED_FIELD_FORBIDDEN';
  end if;

  if exists (
    select 1
    from (
      select item->>'client_event_id' client_event_id, count(*) count_rows
      from jsonb_array_elements(p_items) item
      group by item->>'client_event_id'
    ) duplicate
    where duplicate.count_rows > 1
  ) then
    raise exception 'CMV3_SYNC_DUPLICATE_CLIENT_EVENT_IN_BATCH';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    left join public.clinical_measurement_collection_streams_v3 stream
      on stream.id = (item->>'stream_id')::uuid
     and stream.organization_id = p_organization_id
     and stream.patient_id = p_patient_id
    where stream.id is null
  ) then
    raise exception 'CMV3_SYNC_STREAM_SCOPE_INVALID';
  end if;

  -- Normal collection modes belong to the observer who owns the logical stream.
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    join public.clinical_measurement_collection_streams_v3 stream
      on stream.id = (item->>'stream_id')::uuid
    where coalesce(item->>'ingestion_mode','') in ('LIVE','OFFLINE_SYNC','RETROSPECTIVE_ENTRY')
      and stream.observer_membership_id is distinct from p_actor_membership_id
  ) then
    raise exception 'CMV3_SYNC_STREAM_OBSERVER_MISMATCH';
  end if;

  -- Corrections can be made by the original observer or clinical management.
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    join public.clinical_measurement_collection_streams_v3 stream
      on stream.id = (item->>'stream_id')::uuid
    where coalesce(item->>'ingestion_mode','') = 'CORRECTION'
      and stream.observer_membership_id is distinct from p_actor_membership_id
      and v_actor_role not in ('director','coordinator')
  ) then
    raise exception 'CMV3_SYNC_CORRECTION_AUTHORITY_REQUIRED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where (
      coalesce(item->>'event_kind','FACT') in ('FACT','CORRECTION')
      and jsonb_typeof(item->'payload') <> 'object'
    ) or (
      coalesce(item->>'event_kind','FACT') in ('VOID','SUPERSEDE')
      and item ? 'payload' and item->'payload' <> 'null'::jsonb
    )
  ) then
    raise exception 'CMV3_SYNC_PAYLOAD_EVENT_KIND_MISMATCH';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where coalesce(item->>'event_kind','FACT') in ('FACT','CORRECTION')
      and coalesce(item->'payload'->>'kind','') not in (
        'OBSERVATION_SLICE','COUNT','CATEGORY','SCALAR','TEMPORAL_INTERVAL',
        'INTERVAL_SAMPLE','EXPLICIT_ABSENCE','ABA_TRIAL','ABA_TASK_ANALYSIS'
      )
  ) then
    raise exception 'CMV3_SYNC_PAYLOAD_KIND_UNSUPPORTED';
  end if;

  select coalesce(sum(jsonb_array_length(coalesce(item->'payload'->'steps','[]'::jsonb))),0)
    into v_step_count
  from jsonb_array_elements(p_items) item
  where coalesce(item->'payload'->>'kind','') in ('ABA_TRIAL','ABA_TASK_ANALYSIS');

  if v_step_count > 5000 then
    raise exception 'CMV3_SYNC_STEP_LIMIT_EXCEEDED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where jsonb_array_length(coalesce(item->'payload'->'steps','[]'::jsonb)) > 200
  ) then
    raise exception 'CMV3_SYNC_EVENT_STEP_LIMIT_EXCEEDED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where coalesce(item->'payload'->>'kind','') in ('ABA_TRIAL','ABA_TASK_ANALYSIS')
      and (
        jsonb_typeof(item->'payload'->'steps') <> 'array'
        or jsonb_array_length(item->'payload'->'steps') < 1
      )
  ) then
    raise exception 'CMV3_SYNC_ABA_STEPS_REQUIRED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    left join lateral jsonb_array_elements(coalesce(item->'payload'->'steps','[]'::jsonb)) step on true
    where (coalesce(item->'payload'->>'kind','') = 'ABA_TRIAL' and (item->'payload' ? 'trial_type' or step ? 'opportunity_role'))
       or (coalesce(item->'payload'->>'kind','') = 'ABA_TASK_ANALYSIS' and (item->'payload' ? 'chaining_policy_version_id' or step ? 'eligibility'))
  ) then
    raise exception 'CMV3_SYNC_CLIENT_SEMANTIC_FIELD_FORBIDDEN';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    cross join lateral (
      select step->>'client_step_id' client_step_id, count(*) row_count
      from jsonb_array_elements(coalesce(item->'payload'->'steps','[]'::jsonb)) step
      group by step->>'client_step_id'
    ) duplicated
    where coalesce(item->'payload'->>'kind','') in ('ABA_TRIAL','ABA_TASK_ANALYSIS')
      and (nullif(trim(duplicated.client_step_id),'') is null or duplicated.row_count > 1)
  ) then
    raise exception 'CMV3_SYNC_DUPLICATE_OR_MISSING_CLIENT_STEP_ID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    cross join lateral (
      select step->>'sequence_no' sequence_no, count(*) row_count
      from jsonb_array_elements(coalesce(item->'payload'->'steps','[]'::jsonb)) step
      group by step->>'sequence_no'
    ) duplicated
    where coalesce(item->'payload'->>'kind','') in ('ABA_TRIAL','ABA_TASK_ANALYSIS')
      and (nullif(trim(duplicated.sequence_no),'') is null or duplicated.row_count > 1)
  ) then
    raise exception 'CMV3_SYNC_DUPLICATE_OR_MISSING_STEP_SEQUENCE';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    join public.clinical_measurement_collection_streams_v3 stream
      on stream.id = (item->>'stream_id')::uuid
    join public.clinical_measurement_session_expectations_v3 expectation
      on expectation.id = stream.expectation_id
    join public.clinical_collection_protocol_snapshots_v3 snapshot
      on snapshot.id = expectation.protocol_snapshot_id
    join public.clinical_measurement_definition_versions_v3 version
      on version.id = snapshot.definition_version_id
    join public.clinical_measurement_definitions_v3 definition
      on definition.id = version.definition_id
    where coalesce(item->'payload'->>'kind','') = 'EXPLICIT_ABSENCE'
      and (
        (item->'payload'->>'absence_kind' = 'NO_ELIGIBLE_OPPORTUNITY'
          and definition.semantic_family not in ('PROPORTION','CATEGORICAL','TASK_ANALYSIS'))
        or
        (item->'payload'->>'absence_kind' = 'NO_VALID_OBSERVATION_WINDOW'
          and definition.semantic_family not in ('RATE','DURATION','LATENCY','IRT','INTERVAL'))
      )
  ) then
    raise exception 'CMV3_SYNC_ABSENCE_KIND_SEMANTIC_FAMILY_MISMATCH';
  end if;

  -- Compensation references are expressed with client ids. Same-batch FACTs are
  -- supported; nested same-batch compensation chains are deliberately rejected.
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where coalesce(item->>'event_kind','FACT') <> 'FACT'
      and nullif(trim(item->>'subject_client_event_id'),'') is null
  ) then
    raise exception 'CMV3_SYNC_COMPENSATION_SUBJECT_REQUIRED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) compensation
    join jsonb_array_elements(p_items) subject
      on subject->>'client_event_id' = compensation->>'subject_client_event_id'
    where coalesce(compensation->>'event_kind','FACT') <> 'FACT'
      and coalesce(subject->>'event_kind','FACT') <> 'FACT'
  ) then
    raise exception 'CMV3_SYNC_NESTED_COMPENSATION_REQUIRES_ACCEPTED_SUBJECT';
  end if;
end;
$function$;

create or replace function public.accept_clinical_measurement_raw_envelopes_bulk_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_actor_membership_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  -- First accept FACTs, so a correction/void in the same offline batch may refer
  -- to a FACT that had not reached the server before this transaction.
  insert into public.clinical_measurement_raw_events_v3(
    stream_id, client_event_id, event_kind, subject_event_id, replacement_event_id,
    ingestion_mode, occurred_at_utc, actor_membership_id, reason_code, payload_hash
  )
  select
    (item->>'stream_id')::uuid,
    item->>'client_event_id',
    'FACT',
    null,
    null,
    item->>'ingestion_mode',
    (item->>'occurred_at_utc')::timestamptz,
    p_actor_membership_id,
    null,
    encode(digest(convert_to(item::text,'UTF8'),'sha256'),'hex')
  from jsonb_array_elements(p_items) item
  where coalesce(item->>'event_kind','FACT') = 'FACT'
  on conflict (organization_id, client_event_id) do nothing;

  -- Any replay collision must have byte-equivalent semantic input.
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    join public.clinical_measurement_raw_events_v3 event
      on event.organization_id = p_organization_id
     and event.client_event_id = item->>'client_event_id'
    where event.payload_hash is distinct from encode(digest(convert_to(item::text,'UTF8'),'sha256'),'hex')
  ) then
    raise exception 'CMV3_SYNC_CLIENT_EVENT_ID_COLLISION';
  end if;

  -- Validate compensation refs after FACT insertion. This also allows an offline
  -- correction/void to point at a FACT contained in this same batch.
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    left join public.clinical_measurement_raw_events_v3 subject
      on subject.organization_id = p_organization_id
     and subject.patient_id = p_patient_id
     and subject.client_event_id = item->>'subject_client_event_id'
    where coalesce(item->>'event_kind','FACT') <> 'FACT'
      and subject.id is null
  ) then
    raise exception 'CMV3_SYNC_COMPENSATION_SUBJECT_NOT_ACCEPTED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    left join public.clinical_measurement_raw_events_v3 replacement
      on replacement.organization_id = p_organization_id
     and replacement.patient_id = p_patient_id
     and replacement.client_event_id = item->>'replacement_client_event_id'
    where coalesce(item->>'event_kind','FACT') = 'SUPERSEDE'
      and (nullif(trim(item->>'replacement_client_event_id'),'') is null or replacement.id is null)
  ) then
    raise exception 'CMV3_SYNC_SUPERSEDE_REPLACEMENT_NOT_ACCEPTED';
  end if;

  insert into public.clinical_measurement_raw_events_v3(
    stream_id, client_event_id, event_kind, subject_event_id, replacement_event_id,
    ingestion_mode, occurred_at_utc, actor_membership_id, reason_code, payload_hash
  )
  select
    (item->>'stream_id')::uuid,
    item->>'client_event_id',
    item->>'event_kind',
    subject.id,
    replacement.id,
    item->>'ingestion_mode',
    (item->>'occurred_at_utc')::timestamptz,
    p_actor_membership_id,
    nullif(trim(item->>'reason_code'),''),
    encode(digest(convert_to(item::text,'UTF8'),'sha256'),'hex')
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 subject
    on subject.organization_id = p_organization_id
   and subject.patient_id = p_patient_id
   and subject.client_event_id = item->>'subject_client_event_id'
  left join public.clinical_measurement_raw_events_v3 replacement
    on replacement.organization_id = p_organization_id
   and replacement.patient_id = p_patient_id
   and replacement.client_event_id = item->>'replacement_client_event_id'
  where coalesce(item->>'event_kind','FACT') <> 'FACT'
  on conflict (organization_id, client_event_id) do nothing;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    join public.clinical_measurement_raw_events_v3 event
      on event.organization_id = p_organization_id
     and event.client_event_id = item->>'client_event_id'
    where event.patient_id is distinct from p_patient_id
       or event.payload_hash is distinct from encode(digest(convert_to(item::text,'UTF8'),'sha256'),'hex')
  ) then
    raise exception 'CMV3_SYNC_CLIENT_EVENT_REPLAY_SCOPE_OR_HASH_MISMATCH';
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Universal raw primitive handler. One set-based INSERT per physical family.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_clinical_measurement_primitives_bulk_v3(
  p_organization_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  insert into public.clinical_measurement_observation_slices_v3(event_id, started_at, ended_at, close_reason)
  select event.id,
         (item->'payload'->>'started_at')::timestamptz,
         (item->'payload'->>'ended_at')::timestamptz,
         item->'payload'->>'close_reason'
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  where coalesce(item->'payload'->>'kind','') = 'OBSERVATION_SLICE'
  on conflict (event_id) do nothing;

  insert into public.clinical_measurement_count_facts_v3(event_id, count_delta)
  select event.id, (item->'payload'->>'count_delta')::integer
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  where coalesce(item->'payload'->>'kind','') = 'COUNT'
  on conflict (event_id) do nothing;

  insert into public.clinical_measurement_category_facts_v3(event_id, category_key)
  select event.id, item->'payload'->>'category_key'
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  where coalesce(item->'payload'->>'kind','') = 'CATEGORY'
  on conflict (event_id) do nothing;

  insert into public.clinical_measurement_scalar_facts_v3(event_id, numeric_value)
  select event.id, (item->'payload'->>'numeric_value')::numeric
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  where coalesce(item->'payload'->>'kind','') = 'SCALAR'
  on conflict (event_id) do nothing;

  insert into public.clinical_measurement_interval_facts_v3(
    event_id, started_at, ended_at, is_censored, censor_reason
  )
  select event.id,
         (item->'payload'->>'started_at')::timestamptz,
         (item->'payload'->>'ended_at')::timestamptz,
         coalesce((item->'payload'->>'is_censored')::boolean,false),
         nullif(trim(item->'payload'->>'censor_reason'),'')
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  where coalesce(item->'payload'->>'kind','') = 'TEMPORAL_INTERVAL'
  on conflict (event_id) do nothing;

  insert into public.clinical_measurement_interval_samples_v3(
    event_id, interval_index, started_at, ended_at, response_key
  )
  select event.id,
         (item->'payload'->>'interval_index')::integer,
         (item->'payload'->>'started_at')::timestamptz,
         (item->'payload'->>'ended_at')::timestamptz,
         item->'payload'->>'response_key'
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  where coalesce(item->'payload'->>'kind','') = 'INTERVAL_SAMPLE'
  on conflict (event_id) do nothing;

  insert into public.clinical_measurement_explicit_absence_facts_v3(
    event_id, absence_kind, reason_code
  )
  select event.id,
         item->'payload'->>'absence_kind',
         nullif(trim(item->'payload'->>'reason_code'),'')
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  where coalesce(item->'payload'->>'kind','') = 'EXPLICIT_ABSENCE'
  on conflict (event_id) do nothing;
end;
$function$;

-- ---------------------------------------------------------------------------
-- ABA trial handler. The client submits only mechanical step facts. The existing
-- ABA triggers derive opportunity_role and validate prompt hierarchy server-side.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_clinical_aba_trials_bulk_v3(
  p_organization_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    join public.clinical_measurement_raw_events_v3 event
      on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
    left join public.clinical_aba_trial_protocol_intents_v3 intent
      on intent.protocol_snapshot_id = event.protocol_snapshot_id
    where coalesce(item->'payload'->>'kind','') = 'ABA_TRIAL'
      and intent.protocol_snapshot_id is null
  ) then
    raise exception 'CMV3_SYNC_ABA_TRIAL_INTENT_REQUIRED';
  end if;

  insert into public.clinical_measurement_aba_trials_v3(
    event_id, organization_id, patient_id, session_id, expectation_id, target_id,
    stream_id, protocol_snapshot_id, definition_version_id,
    trial_type, started_at, completed_at, created_at
  )
  select event.id, event.organization_id, event.patient_id, event.session_id,
         event.expectation_id, event.target_id, event.stream_id,
         event.protocol_snapshot_id, event.definition_version_id,
         intent.trial_type,
         nullif(item->'payload'->>'started_at','')::timestamptz,
         nullif(item->'payload'->>'completed_at','')::timestamptz,
         event.recorded_at
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  join public.clinical_aba_trial_protocol_intents_v3 intent
    on intent.protocol_snapshot_id = event.protocol_snapshot_id
   and intent.organization_id = event.organization_id
   and intent.patient_id = event.patient_id
   and intent.target_id = event.target_id
   and intent.definition_version_id = event.definition_version_id
  where coalesce(item->'payload'->>'kind','') = 'ABA_TRIAL'
  on conflict (event_id) do nothing;

  insert into public.clinical_measurement_aba_trial_steps_v3(
    trial_event_id, sequence_no, client_step_id, step_kind, outcome,
    prompt_level_id, latency_ms, occurred_at
  )
  select event.id,
         (step->>'sequence_no')::integer,
         step->>'client_step_id',
         step->>'step_kind',
         nullif(step->>'outcome',''),
         nullif(step->>'prompt_level_id','')::uuid,
         nullif(step->>'latency_ms','')::integer,
         (step->>'occurred_at')::timestamptz
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  cross join lateral jsonb_array_elements(coalesce(item->'payload'->'steps','[]'::jsonb)) step
  where coalesce(item->'payload'->>'kind','') = 'ABA_TRIAL'
  on conflict (trial_event_id, client_step_id) do nothing;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Task Analysis handler. Chaining policy and eligibility are server-owned.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_clinical_aba_task_runs_bulk_v3(
  p_organization_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  insert into public.clinical_measurement_aba_task_runs_v3(
    event_id, organization_id, patient_id, session_id, expectation_id, target_id,
    stream_id, protocol_snapshot_id, definition_version_id,
    chaining_policy_version_id, started_at, completed_at, created_at
  )
  select event.id, event.organization_id, event.patient_id, event.session_id,
         event.expectation_id, event.target_id, event.stream_id,
         event.protocol_snapshot_id, event.definition_version_id,
         binding.chaining_policy_version_id,
         (item->'payload'->>'started_at')::timestamptz,
         (item->'payload'->>'completed_at')::timestamptz,
         event.recorded_at
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  join public.clinical_aba_protocol_bindings_v3 binding
    on binding.protocol_snapshot_id = event.protocol_snapshot_id
  where coalesce(item->'payload'->>'kind','') = 'ABA_TASK_ANALYSIS'
  on conflict (event_id) do nothing;

  insert into public.clinical_measurement_aba_task_step_results_v3(
    run_event_id, step_definition_id, sequence_no, client_step_id,
    performance_code, prompt_level_id, occurred_at
  )
  select event.id,
         (step->>'step_definition_id')::uuid,
         (step->>'sequence_no')::integer,
         step->>'client_step_id',
         step->>'performance_code',
         nullif(step->>'prompt_level_id','')::uuid,
         (step->>'occurred_at')::timestamptz
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  cross join lateral jsonb_array_elements(coalesce(item->'payload'->'steps','[]'::jsonb)) step
  where coalesce(item->'payload'->>'kind','') = 'ABA_TASK_ANALYSIS'
  on conflict (run_event_id, client_step_id) do nothing;

  if exists (
    select 1
    from public.clinical_measurement_aba_task_runs_v3 run
    join public.clinical_measurement_raw_events_v3 event on event.id = run.event_id
    where event.organization_id = p_organization_id
      and event.client_event_id in (
        select item->>'client_event_id'
        from jsonb_array_elements(p_items) item
        where coalesce(item->'payload'->>'kind','') = 'ABA_TASK_ANALYSIS'
      )
      and (
        (select count(*) from public.clinical_measurement_aba_task_step_results_v3 result where result.run_event_id = run.event_id)
        <>
        (select count(*) from public.clinical_aba_chaining_step_rules_v3 rule where rule.policy_version_id = run.chaining_policy_version_id)
      )
  ) then
    raise exception 'CMV3_SYNC_TASK_ANALYSIS_STEP_SET_INCOMPLETE';
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Single transactional entrypoint. One call = one atomic batch. All payload
-- handlers are invoked once per batch and operate set-wise.
-- ---------------------------------------------------------------------------
create or replace function public.sync_clinical_measurements_bulk_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_actor_membership_id uuid,
  p_client_batch_id text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_batch public.clinical_measurement_sync_batches_v3%rowtype;
  v_payload_hash text;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if p_organization_id is null or p_patient_id is null or p_actor_membership_id is null then
    raise exception 'CMV3_SYNC_SCOPE_REQUIRED';
  end if;
  if nullif(trim(p_client_batch_id),'') is null or length(trim(p_client_batch_id)) > 180 then
    raise exception 'CMV3_SYNC_BATCH_ID_INVALID';
  end if;

  perform public.validate_clinical_measurement_sync_batch_v3(
    p_organization_id, p_patient_id, p_actor_membership_id, p_items
  );

  v_payload_hash := encode(digest(convert_to(p_items::text,'UTF8'),'sha256'),'hex');

  -- Serialize only the same logical client batch, not the whole clinic.
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || trim(p_client_batch_id), 0)
  );

  select * into v_batch
  from public.clinical_measurement_sync_batches_v3 batch
  where batch.organization_id = p_organization_id
    and batch.client_batch_id = trim(p_client_batch_id);

  if found then
    if v_batch.patient_id is distinct from p_patient_id
       or v_batch.actor_membership_id is distinct from p_actor_membership_id
       or v_batch.payload_hash is distinct from v_payload_hash
       or v_batch.item_count is distinct from jsonb_array_length(p_items) then
      raise exception 'CMV3_SYNC_BATCH_ID_COLLISION';
    end if;

    select jsonb_build_object(
      'batch_id', v_batch.id,
      'client_batch_id', v_batch.client_batch_id,
      'status', 'IDEMPOTENT_REPLAY',
      'accepted_count', count(*),
      'events', coalesce(jsonb_agg(jsonb_build_object(
        'ordinal', link.ordinal,
        'client_event_id', link.client_event_id,
        'event_id', link.event_id
      ) order by link.ordinal), '[]'::jsonb)
    ) into v_result
    from public.clinical_measurement_sync_batch_events_v3 link
    where link.batch_id = v_batch.id;

    return v_result;
  end if;

  perform public.accept_clinical_measurement_raw_envelopes_bulk_v3(
    p_organization_id, p_patient_id, p_actor_membership_id, p_items
  );

  perform public.ingest_clinical_measurement_primitives_bulk_v3(p_organization_id, p_items);
  perform public.ingest_clinical_aba_trials_bulk_v3(p_organization_id, p_items);
  perform public.ingest_clinical_aba_task_runs_bulk_v3(p_organization_id, p_items);

  -- Force the deferred one-event/one-payload invariant before recording batch success.
  set constraints ensure_clinical_measurement_raw_payload_v3 immediate;
  set constraints ensure_clinical_measurement_raw_payload_v3 deferred;

  insert into public.clinical_measurement_sync_batches_v3(
    organization_id, patient_id, actor_membership_id, client_batch_id,
    payload_hash, item_count, received_at, created_at
  ) values (
    p_organization_id, p_patient_id, p_actor_membership_id, trim(p_client_batch_id),
    v_payload_hash, jsonb_array_length(p_items), v_now, v_now
  )
  returning * into v_batch;

  insert into public.clinical_measurement_sync_batch_events_v3(
    batch_id, ordinal, organization_id, patient_id, event_id, client_event_id, created_at
  )
  select v_batch.id,
         ordinality::integer,
         p_organization_id,
         p_patient_id,
         event.id,
         item->>'client_event_id',
         v_now
  from jsonb_array_elements(p_items) with ordinality input(item, ordinality)
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id
   and event.patient_id = p_patient_id
   and event.client_event_id = item->>'client_event_id';

  select jsonb_build_object(
    'batch_id', v_batch.id,
    'client_batch_id', v_batch.client_batch_id,
    'status', 'ACCEPTED',
    'accepted_count', count(*),
    'events', coalesce(jsonb_agg(jsonb_build_object(
      'ordinal', link.ordinal,
      'client_event_id', link.client_event_id,
      'event_id', link.event_id
    ) order by link.ordinal), '[]'::jsonb)
  ) into v_result
  from public.clinical_measurement_sync_batch_events_v3 link
  where link.batch_id = v_batch.id;

  return v_result;
end;
$function$;

drop trigger if exists prepare_cabav3_trial_protocol_intent on public.clinical_aba_trial_protocol_intents_v3;
create trigger prepare_cabav3_trial_protocol_intent
before insert on public.clinical_aba_trial_protocol_intents_v3
for each row execute function public.prepare_clinical_aba_trial_protocol_intent_v3();

drop trigger if exists guard_cabav3_trial_protocol_intent_immutable on public.clinical_aba_trial_protocol_intents_v3;
create trigger guard_cabav3_trial_protocol_intent_immutable
before update or delete on public.clinical_aba_trial_protocol_intents_v3
for each row execute function public.guard_clinical_aba_trial_protocol_intent_v3();

-- Sync provenance is immutable.
drop trigger if exists guard_cmv3_sync_batches_immutable on public.clinical_measurement_sync_batches_v3;
create trigger guard_cmv3_sync_batches_immutable
before update or delete on public.clinical_measurement_sync_batches_v3
for each row execute function public.guard_clinical_measurement_sync_provenance_v3();

drop trigger if exists guard_cmv3_sync_batch_events_immutable on public.clinical_measurement_sync_batch_events_v3;
create trigger guard_cmv3_sync_batch_events_immutable
before update or delete on public.clinical_measurement_sync_batch_events_v3
for each row execute function public.guard_clinical_measurement_sync_provenance_v3();

-- Dark RLS: no direct browser table access. Writes occur only through server RPC.
do $cmv3_sync_security$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinical_measurement_sync_batches_v3',
    'clinical_measurement_sync_batch_events_v3',
    'clinical_aba_trial_protocol_intents_v3'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
  end loop;
end;
$cmv3_sync_security$;

revoke all on function public.guard_clinical_measurement_sync_provenance_v3() from public, anon, authenticated;
revoke all on function public.prepare_clinical_aba_trial_protocol_intent_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_aba_trial_protocol_intent_v3() from public, anon, authenticated;
revoke all on function public.validate_clinical_measurement_sync_batch_v3(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.accept_clinical_measurement_raw_envelopes_bulk_v3(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ingest_clinical_measurement_primitives_bulk_v3(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ingest_clinical_aba_trials_bulk_v3(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ingest_clinical_aba_task_runs_bulk_v3(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.sync_clinical_measurements_bulk_v3(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.sync_clinical_measurements_bulk_v3(uuid, uuid, uuid, text, jsonb) to service_role;


-- ===========================================================================
-- Embedded canonical block 08/12: 20260820203000_clinical_measurement_v3_projection_read_models.sql
-- ===========================================================================
-- Verto Clinical Measurement Engine V3 - Projection Engine + family read models.
-- Additive/dark only. Raw accepted facts remain authority; all tables below are
-- rebuildable projections or operational queue state. No browser reads/writes.


create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Current-truth raw view. FACT/CORRECTION payloads are effective only while no
-- later direct compensation points to them. Historical/as-recorded reconstruction
-- continues to use the immutable raw tables, never this convenience view alone.
-- ---------------------------------------------------------------------------
create or replace view public.clinical_measurement_effective_raw_events_v3
with (security_barrier = true)
as
select event.*
from public.clinical_measurement_raw_events_v3 event
where event.event_kind in ('FACT','CORRECTION')
  and not exists (
    select 1
    from public.clinical_measurement_raw_events_v3 compensation
    where compensation.subject_event_id = event.id
  );

create or replace view public.clinical_measurement_projection_scope_v3
with (security_barrier = true)
as
select
  expectation.id as expectation_id,
  expectation.organization_id,
  expectation.patient_id,
  expectation.session_id,
  expectation.target_id,
  expectation.protocol_snapshot_id,
  snapshot.definition_version_id,
  snapshot.phase_epoch_id,
  snapshot.phase_version_id,
  definition.semantic_family,
  version.unit_code,
  version.unit_label,
  version.directionality,
  version.content as definition_content,
  version.aggregation_policy,
  session_row.status as session_status,
  session_row.clinical_date,
  session_row.started_at as session_started_at,
  session_row.ended_at as session_ended_at,
  session_row.finalized_at,
  primary_stream.id as primary_stream_id
from public.clinical_measurement_session_expectations_v3 expectation
join public.clinical_measurement_sessions_v3 session_row
  on session_row.id = expectation.session_id
 and session_row.organization_id = expectation.organization_id
 and session_row.patient_id = expectation.patient_id
join public.clinical_collection_protocol_snapshots_v3 snapshot
  on snapshot.id = expectation.protocol_snapshot_id
 and snapshot.organization_id = expectation.organization_id
 and snapshot.patient_id = expectation.patient_id
 and snapshot.target_id = expectation.target_id
join public.clinical_measurement_definition_versions_v3 version
  on version.id = snapshot.definition_version_id
 and version.organization_id = expectation.organization_id
 and version.patient_id = expectation.patient_id
 and version.target_id = expectation.target_id
join public.clinical_measurement_definitions_v3 definition
  on definition.id = version.definition_id
 and definition.organization_id = expectation.organization_id
 and definition.patient_id = expectation.patient_id
 and definition.target_id = expectation.target_id
left join public.clinical_measurement_collection_streams_v3 primary_stream
  on primary_stream.expectation_id = expectation.id
 and primary_stream.stream_role = 'PRIMARY';

create or replace view public.clinical_measurement_effective_primary_events_v3
with (security_barrier = true)
as
select event.*
from public.clinical_measurement_effective_raw_events_v3 event
join public.clinical_measurement_collection_streams_v3 stream
  on stream.id = event.stream_id
 and stream.stream_role = 'PRIMARY';

-- ---------------------------------------------------------------------------
-- Dirty-expectation queue. generation prevents lost updates. This is operational
-- mutable state, not clinical history.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_projection_queue_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  semantic_family text not null,
  generation bigint not null default 1 check (generation > 0),
  processed_generation bigint not null default 0 check (processed_generation >= 0),
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','DONE','FAILED')),
  latest_source_event_id uuid,
  latest_source_recorded_at timestamptz,
  latest_event_kind text,
  latest_ingestion_mode text,
  enqueued_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(
      id, organization_id, patient_id, session_id, target_id
    ) on delete cascade
);

create index if not exists idx_cmv3_projection_queue_pending
  on public.clinical_measurement_projection_queue_v3(status, enqueued_at, expectation_id)
  where status in ('PENDING','FAILED');

-- ---------------------------------------------------------------------------
-- Typed session read models. One expectation = one semantic definition snapshot
-- in one session. No cross-phase or cross-definition aggregation occurs here.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_session_count_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  total_count bigint not null default 0 check (total_count >= 0),
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

create table if not exists public.clinical_measurement_session_rate_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  event_count bigint not null default 0 check (event_count >= 0),
  observation_duration_ms bigint not null default 0 check (observation_duration_ms >= 0),
  rate_per_hour numeric,
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  constraint cmv3_rate_requires_window check (rate_per_hour is null or observation_duration_ms > 0),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

create table if not exists public.clinical_measurement_session_proportion_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  projection_status text not null default 'READY'
    check (projection_status in ('READY','SEMANTIC_CONFIG_REQUIRED','INVALID_MIXED_SOURCE')),
  source_kind text not null check (source_kind in ('ABA_TRIAL','CATEGORY','MIXED','NONE')),
  numerator integer,
  denominator integer,
  percent_value numeric(9,4),
  no_eligible_opportunity_count integer not null default 0 check (no_eligible_opportunity_count >= 0),
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  constraint cmv3_proportion_shape check (
    (numerator is null and denominator is null and percent_value is null)
    or (numerator >= 0 and denominator >= 0 and numerator <= denominator
        and ((denominator = 0 and percent_value is null)
          or (denominator > 0 and percent_value between 0 and 100)))
  ),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

create table if not exists public.clinical_measurement_session_temporal_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  semantic_family text not null check (semantic_family in ('DURATION','LATENCY','IRT')),
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  occurrence_count integer not null default 0 check (occurrence_count >= 0),
  censored_count integer not null default 0 check (censored_count >= 0),
  total_duration_ms bigint not null default 0 check (total_duration_ms >= 0),
  mean_duration_ms numeric,
  min_duration_ms bigint,
  max_duration_ms bigint,
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

create table if not exists public.clinical_measurement_session_continuous_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  observation_count integer not null default 0 check (observation_count >= 0),
  mean_value numeric,
  min_value numeric,
  max_value numeric,
  latest_value numeric,
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

create table if not exists public.clinical_measurement_session_interval_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  interval_count integer not null default 0 check (interval_count >= 0),
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

create table if not exists public.clinical_measurement_session_ordinal_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  observation_count integer not null default 0 check (observation_count >= 0),
  latest_category_key text,
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

create table if not exists public.clinical_measurement_session_categorical_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  observation_count integer not null default 0 check (observation_count >= 0),
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

create table if not exists public.clinical_measurement_session_task_analysis_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  run_count integer not null default 0 check (run_count >= 0),
  acquisition_eligible_count integer not null default 0 check (acquisition_eligible_count >= 0),
  acquisition_independent_count integer not null default 0 check (acquisition_independent_count >= 0),
  maintenance_eligible_count integer not null default 0 check (maintenance_eligible_count >= 0),
  maintenance_independent_count integer not null default 0 check (maintenance_independent_count >= 0),
  trainer_completed_count integer not null default 0 check (trainer_completed_count >= 0),
  not_eligible_count integer not null default 0 check (not_eligible_count >= 0),
  acquisition_independence_percent numeric(9,4),
  maintenance_independence_percent numeric(9,4),
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

-- Narrow relational breakdowns; no analytical JSONB in the hot read path.
create table if not exists public.clinical_measurement_session_category_breakdown_v3 (
  expectation_id uuid not null references public.clinical_measurement_session_expectations_v3(id) on delete cascade,
  category_domain text not null check (category_domain in ('PROPORTION','ORDINAL','CATEGORICAL')),
  category_key text not null,
  occurrence_count integer not null check (occurrence_count >= 0),
  primary key (expectation_id, category_domain, category_key)
);

create table if not exists public.clinical_measurement_session_interval_breakdown_v3 (
  expectation_id uuid not null references public.clinical_measurement_session_expectations_v3(id) on delete cascade,
  response_key text not null,
  occurrence_count integer not null check (occurrence_count >= 0),
  primary key (expectation_id, response_key)
);

create table if not exists public.clinical_measurement_session_prompt_distribution_v3 (
  expectation_id uuid not null references public.clinical_measurement_session_expectations_v3(id) on delete cascade,
  source_kind text not null check (source_kind in ('ABA_TRIAL','TASK_ANALYSIS')),
  prompt_level_id uuid not null references public.clinical_aba_prompt_hierarchy_levels_v3(id) on delete restrict,
  occurrence_count integer not null check (occurrence_count >= 0),
  primary key (expectation_id, source_kind, prompt_level_id)
);

create table if not exists public.clinical_measurement_session_task_step_summaries_v3 (
  expectation_id uuid not null references public.clinical_measurement_session_expectations_v3(id) on delete cascade,
  step_definition_id uuid not null references public.clinical_aba_task_step_definitions_v3(id) on delete restrict,
  sequence_no integer not null,
  acquisition_observation_count integer not null default 0,
  acquisition_independent_count integer not null default 0,
  maintenance_observation_count integer not null default 0,
  maintenance_independent_count integer not null default 0,
  prompted_count integer not null default 0,
  incorrect_count integer not null default 0,
  no_response_count integer not null default 0,
  primary key (expectation_id, step_definition_id)
);

-- Hot read indexes: target timeline first, no full-patient/full-table load required.
create index if not exists idx_cmv3_count_summary_target_time on public.clinical_measurement_session_count_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);
create index if not exists idx_cmv3_rate_summary_target_time on public.clinical_measurement_session_rate_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);
create index if not exists idx_cmv3_proportion_summary_target_time on public.clinical_measurement_session_proportion_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);
create index if not exists idx_cmv3_temporal_summary_target_time on public.clinical_measurement_session_temporal_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);
create index if not exists idx_cmv3_continuous_summary_target_time on public.clinical_measurement_session_continuous_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);
create index if not exists idx_cmv3_interval_summary_target_time on public.clinical_measurement_session_interval_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);
create index if not exists idx_cmv3_ordinal_summary_target_time on public.clinical_measurement_session_ordinal_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);
create index if not exists idx_cmv3_categorical_summary_target_time on public.clinical_measurement_session_categorical_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);
create index if not exists idx_cmv3_task_summary_target_time on public.clinical_measurement_session_task_analysis_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);

-- ---------------------------------------------------------------------------
-- Projection revision ledger. Current hot tables remain typed; compact JSON is
-- stored only on this cold audit path so late sync/corrections remain explainable.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_session_projection_heads_v3 (
  expectation_id uuid primary key references public.clinical_measurement_session_expectations_v3(id) on delete cascade,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  semantic_family text not null,
  revision_number integer not null check (revision_number > 0),
  projection_hash text not null check (projection_hash ~ '^[0-9a-f]{64}$'),
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.clinical_measurement_session_projection_revisions_v3 (
  id uuid primary key default gen_random_uuid(),
  expectation_id uuid not null references public.clinical_measurement_session_expectations_v3(id) on delete restrict,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  semantic_family text not null,
  revision_number integer not null check (revision_number > 0),
  revision_reason text not null check (revision_reason in (
    'INITIAL','SESSION_FINALIZED','LATE_DATA_INCORPORATED','AUDIT_CORRECTION','SOURCE_DATA_CHANGED','MANUAL_REBUILD'
  )),
  projection_hash text not null check (projection_hash ~ '^[0-9a-f]{64}$'),
  projection_payload jsonb not null check (jsonb_typeof(projection_payload)='object'),
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (expectation_id, revision_number)
);

-- ---------------------------------------------------------------------------
-- Common helpers.
-- ---------------------------------------------------------------------------
create or replace function public.cmv3_projection_coverage_status(
  p_expectation_id uuid,
  p_session_status text
)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select case
    when exists (
      select 1 from public.clinical_measurement_effective_primary_events_v3 e
      where e.expectation_id = p_expectation_id
        and exists (
          select 1 from public.clinical_measurement_raw_event_payload_claims_v3 c where c.event_id=e.id
          union all
          select 1 from public.clinical_aba_raw_payload_claims_v3 c where c.event_id=e.id
        )
        and not exists (
          select 1 from public.clinical_measurement_explicit_absence_facts_v3 a where a.event_id=e.id
        )
    ) then 'OBSERVED'
    when exists (
      select 1
      from public.clinical_measurement_effective_primary_events_v3 e
      join public.clinical_measurement_explicit_absence_facts_v3 a on a.event_id=e.id
      where e.expectation_id = p_expectation_id
    ) then 'EXPLICIT_ABSENCE'
    when p_session_status = 'FINALIZED' then 'EXPECTED_NOT_COLLECTED'
    else 'PENDING'
  end;
$function$;

create or replace function public.build_clinical_measurement_projection_snapshot_v3(p_expectation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'expectation_id', scope.expectation_id,
    'semantic_family', scope.semantic_family,
    'session_status', scope.session_status,
    'clinical_date', scope.clinical_date,
    'summary', case scope.semantic_family
      when 'COUNT' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_count_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'RATE' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_rate_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'PROPORTION' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_proportion_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'DURATION' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_temporal_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'LATENCY' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_temporal_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'IRT' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_temporal_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'CONTINUOUS' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_continuous_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'INTERVAL' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_interval_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'ORDINAL' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_ordinal_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'CATEGORICAL' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_categorical_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'TASK_ANALYSIS' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_task_analysis_summaries_v3 s where s.expectation_id=scope.expectation_id)
    end,
    'category_breakdown', (
      select coalesce(jsonb_agg(jsonb_build_object('domain',b.category_domain,'key',b.category_key,'count',b.occurrence_count)
        order by b.category_domain,b.category_key),'[]'::jsonb)
      from public.clinical_measurement_session_category_breakdown_v3 b where b.expectation_id=scope.expectation_id
    ),
    'interval_breakdown', (
      select coalesce(jsonb_agg(jsonb_build_object('key',b.response_key,'count',b.occurrence_count) order by b.response_key),'[]'::jsonb)
      from public.clinical_measurement_session_interval_breakdown_v3 b where b.expectation_id=scope.expectation_id
    ),
    'prompt_distribution', (
      select coalesce(jsonb_agg(jsonb_build_object('source_kind',b.source_kind,'prompt_level_id',b.prompt_level_id,'count',b.occurrence_count)
        order by b.source_kind,b.prompt_level_id),'[]'::jsonb)
      from public.clinical_measurement_session_prompt_distribution_v3 b where b.expectation_id=scope.expectation_id
    ),
    'task_steps', (
      select coalesce(jsonb_agg(to_jsonb(b)-'expectation_id' order by b.sequence_no,b.step_definition_id),'[]'::jsonb)
      from public.clinical_measurement_session_task_step_summaries_v3 b where b.expectation_id=scope.expectation_id
    )
  ))
  from public.clinical_measurement_projection_scope_v3 scope
  where scope.expectation_id=p_expectation_id;
$function$;

-- ---------------------------------------------------------------------------
-- Set-based recomputation for a bounded expectation batch. No per-expectation
-- INSERT loop and no network N+1 are required.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_clinical_measurement_projection_batch_v3(
  p_expectation_ids uuid[],
  p_revision_hint text default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_count integer := 0;
begin
  if coalesce(array_length(p_expectation_ids,1),0) = 0 then return 0; end if;
  if array_length(p_expectation_ids,1) > 250 then raise exception 'CMV3_PROJECTION_BATCH_TOO_LARGE'; end if;

  -- Projection cache is disposable. Clear only the affected expectation grains.
  delete from public.clinical_measurement_session_category_breakdown_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_interval_breakdown_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_prompt_distribution_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_task_step_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_count_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_rate_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_proportion_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_temporal_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_continuous_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_interval_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_ordinal_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_categorical_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_task_analysis_summaries_v3 where expectation_id=any(p_expectation_ids);

  -- COUNT.
  insert into public.clinical_measurement_session_count_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         coalesce(sum(f.count_delta),0)::bigint,
         count(distinct e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_count_facts_v3 f on f.event_id=e.id and f.semantic_family='COUNT'
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='COUNT'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  -- RATE: zero events + valid slice is a legitimate zero rate.
  insert into public.clinical_measurement_session_rate_summaries_v3
  with agg as (
    select scope.*,
      coalesce((select sum(f.count_delta)::bigint from public.clinical_measurement_effective_primary_events_v3 e
                join public.clinical_measurement_count_facts_v3 f on f.event_id=e.id and f.semantic_family='RATE'
                where e.expectation_id=scope.expectation_id),0) event_count,
      coalesce((select sum(floor(extract(epoch from (s.ended_at-s.started_at))*1000.0))::bigint
                from public.clinical_measurement_effective_primary_events_v3 e
                join public.clinical_measurement_observation_slices_v3 s on s.event_id=e.id
                where e.expectation_id=scope.expectation_id),0) observation_ms,
      (select count(*)::integer from public.clinical_measurement_effective_primary_events_v3 e where e.expectation_id=scope.expectation_id) src_count,
      (select max(e.occurred_at_utc) from public.clinical_measurement_effective_primary_events_v3 e where e.expectation_id=scope.expectation_id) src_occ,
      (select max(e.recorded_at) from public.clinical_measurement_effective_primary_events_v3 e where e.expectation_id=scope.expectation_id) src_rec
    from public.clinical_measurement_projection_scope_v3 scope
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='RATE'
  )
  select expectation_id,organization_id,patient_id,session_id,target_id,definition_version_id,phase_epoch_id,
         clinical_date,session_status,public.cmv3_projection_coverage_status(expectation_id,session_status),
         event_count,observation_ms,
         case when observation_ms>0 then (event_count::numeric*3600000::numeric)/observation_ms::numeric else null end,
         src_count,src_occ,src_rec,clock_timestamp()
  from agg;

  -- PROPORTION: ABA trials have fixed server semantics. Generic category-based
  -- proportions are computed only when the version explicitly declares both
  -- numerator_category_keys and denominator_category_keys.
  insert into public.clinical_measurement_session_proportion_summaries_v3
  with aba as (
    select scope.expectation_id,
      count(distinct trial.event_id) filter (where step.opportunity_role='PRIMARY_INDEPENDENT')::integer denominator,
      count(distinct trial.event_id) filter (where step.opportunity_role='PRIMARY_INDEPENDENT' and step.outcome='CORRECT')::integer numerator,
      (count(distinct trial.event_id)
       - count(distinct trial.event_id) filter (where step.opportunity_role='PRIMARY_INDEPENDENT'))::integer no_opp,
      count(distinct trial.event_id)::integer trial_count
    from public.clinical_measurement_projection_scope_v3 scope
    join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
    join public.clinical_measurement_aba_trials_v3 trial on trial.event_id=e.id
    left join public.clinical_measurement_aba_trial_steps_v3 step on step.trial_event_id=trial.event_id
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='PROPORTION'
    group by scope.expectation_id
  ), categories as (
    select scope.expectation_id,
      count(*) filter (where f.category_key in (
        select jsonb_array_elements_text(scope.definition_content #> '{proportion,numerator_category_keys}')
      ))::integer numerator,
      count(*) filter (where f.category_key in (
        select jsonb_array_elements_text(scope.definition_content #> '{proportion,denominator_category_keys}')
      ))::integer denominator,
      count(*)::integer category_count,
      (jsonb_typeof(scope.definition_content #> '{proportion,numerator_category_keys}')='array'
       and jsonb_typeof(scope.definition_content #> '{proportion,denominator_category_keys}')='array'
       and (scope.definition_content #> '{proportion,denominator_category_keys}') @> (scope.definition_content #> '{proportion,numerator_category_keys}')) config_ready
    from public.clinical_measurement_projection_scope_v3 scope
    join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
    join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='PROPORTION'
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='PROPORTION'
    group by scope.expectation_id,scope.definition_content
  ), source_meta as (
    select scope.expectation_id,count(e.id)::integer src_count,max(e.occurred_at_utc) src_occ,max(e.recorded_at) src_rec
    from public.clinical_measurement_projection_scope_v3 scope
    left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='PROPORTION'
    group by scope.expectation_id
  )
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then 'INVALID_MIXED_SOURCE'
           when coalesce(aba.trial_count,0)>0 or coalesce(categories.config_ready,false) then 'READY'
           else 'SEMANTIC_CONFIG_REQUIRED' end,
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then 'MIXED'
           when coalesce(aba.trial_count,0)>0 then 'ABA_TRIAL'
           when coalesce(categories.category_count,0)>0 then 'CATEGORY' else 'NONE' end,
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then null
           when coalesce(aba.trial_count,0)>0 then aba.numerator
           when coalesce(categories.config_ready,false) then categories.numerator else null end,
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then null
           when coalesce(aba.trial_count,0)>0 then aba.denominator
           when coalesce(categories.config_ready,false) then categories.denominator else null end,
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then null
           when coalesce(aba.trial_count,0)>0 and aba.denominator>0 then (aba.numerator::numeric*100)/aba.denominator
           when coalesce(aba.trial_count,0)=0 and coalesce(categories.config_ready,false) and categories.denominator>0 then (categories.numerator::numeric*100)/categories.denominator
           else null end,
         coalesce(aba.no_opp,0),meta.src_count,meta.src_occ,meta.src_rec,clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join aba on aba.expectation_id=scope.expectation_id
  left join categories on categories.expectation_id=scope.expectation_id
  join source_meta meta on meta.expectation_id=scope.expectation_id
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='PROPORTION';

  insert into public.clinical_measurement_session_category_breakdown_v3(expectation_id,category_domain,category_key,occurrence_count)
  select e.expectation_id,'PROPORTION',f.category_key,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='PROPORTION'
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,f.category_key;

  insert into public.clinical_measurement_session_prompt_distribution_v3(expectation_id,source_kind,prompt_level_id,occurrence_count)
  select e.expectation_id,'ABA_TRIAL',step.prompt_level_id,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_aba_trials_v3 trial on trial.event_id=e.id
  join public.clinical_measurement_aba_trial_steps_v3 step on step.trial_event_id=trial.event_id
  where e.expectation_id=any(p_expectation_ids) and step.prompt_level_id is not null
  group by e.expectation_id,step.prompt_level_id;

  -- DURATION / LATENCY / IRT remain temporal, never coerced to score.
  insert into public.clinical_measurement_session_temporal_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.semantic_family,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,count(f.event_id) filter(where f.is_censored)::integer,
         coalesce(sum(f.duration_ms),0)::bigint,avg(f.duration_ms)::numeric,min(f.duration_ms),max(f.duration_ms),
         count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_interval_facts_v3 f on f.event_id=e.id
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family in ('DURATION','LATENCY','IRT')
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.semantic_family,scope.clinical_date,scope.session_status;

  -- CONTINUOUS.
  insert into public.clinical_measurement_session_continuous_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,avg(f.numeric_value),min(f.numeric_value),max(f.numeric_value),
         (array_agg(f.numeric_value order by e.occurred_at_utc desc,e.id desc) filter(where f.event_id is not null))[1],
         count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_scalar_facts_v3 f on f.event_id=e.id
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='CONTINUOUS'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  -- INTERVAL + relational response breakdown.
  insert into public.clinical_measurement_session_interval_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_interval_samples_v3 f on f.event_id=e.id
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='INTERVAL'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  insert into public.clinical_measurement_session_interval_breakdown_v3(expectation_id,response_key,occurrence_count)
  select e.expectation_id,f.response_key,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_interval_samples_v3 f on f.event_id=e.id
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,f.response_key;

  -- ORDINAL: order is preserved as category identity; no mean/percent is invented.
  insert into public.clinical_measurement_session_ordinal_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,
         (array_agg(f.category_key order by e.occurred_at_utc desc,e.id desc) filter(where f.event_id is not null))[1],
         count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='ORDINAL'
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='ORDINAL'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  insert into public.clinical_measurement_session_category_breakdown_v3(expectation_id,category_domain,category_key,occurrence_count)
  select e.expectation_id,'ORDINAL',f.category_key,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='ORDINAL'
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,f.category_key;

  -- CATEGORICAL.
  insert into public.clinical_measurement_session_categorical_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='CATEGORICAL'
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='CATEGORICAL'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  insert into public.clinical_measurement_session_category_breakdown_v3(expectation_id,category_domain,category_key,occurrence_count)
  select e.expectation_id,'CATEGORICAL',f.category_key,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='CATEGORICAL'
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,f.category_key;

  -- TASK ANALYSIS: acquisition and maintenance denominators remain separate.
  insert into public.clinical_measurement_session_task_analysis_summaries_v3
  with agg as (
    select scope.*,
      count(distinct run.event_id)::integer run_count,
      count(result.id) filter(where result.eligibility='ACQUISITION')::integer acq_n,
      count(result.id) filter(where result.eligibility='ACQUISITION' and result.performance_code='INDEPENDENT')::integer acq_i,
      count(result.id) filter(where result.eligibility='MAINTENANCE')::integer maint_n,
      count(result.id) filter(where result.eligibility='MAINTENANCE' and result.performance_code='INDEPENDENT')::integer maint_i,
      count(result.id) filter(where result.eligibility='TRAINER_COMPLETED')::integer trainer_n,
      count(result.id) filter(where result.eligibility='NOT_ELIGIBLE')::integer not_eligible_n,
      count(distinct e.id)::integer src_count,max(e.occurred_at_utc) src_occ,max(e.recorded_at) src_rec
    from public.clinical_measurement_projection_scope_v3 scope
    left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
    left join public.clinical_measurement_aba_task_runs_v3 run on run.event_id=e.id
    left join public.clinical_measurement_aba_task_step_results_v3 result on result.run_event_id=run.event_id
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='TASK_ANALYSIS'
    group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
             scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
             scope.protocol_snapshot_id,scope.semantic_family,scope.unit_code,scope.unit_label,scope.directionality,
             scope.definition_content,scope.aggregation_policy,scope.session_started_at,scope.session_ended_at,
             scope.finalized_at,scope.primary_stream_id
  )
  select expectation_id,organization_id,patient_id,session_id,target_id,definition_version_id,phase_epoch_id,
         clinical_date,session_status,public.cmv3_projection_coverage_status(expectation_id,session_status),
         run_count,acq_n,acq_i,maint_n,maint_i,trainer_n,not_eligible_n,
         case when acq_n>0 then acq_i::numeric*100/acq_n else null end,
         case when maint_n>0 then maint_i::numeric*100/maint_n else null end,
         src_count,src_occ,src_rec,clock_timestamp()
  from agg;

  insert into public.clinical_measurement_session_task_step_summaries_v3(
    expectation_id,step_definition_id,sequence_no,acquisition_observation_count,acquisition_independent_count,
    maintenance_observation_count,maintenance_independent_count,prompted_count,incorrect_count,no_response_count
  )
  select e.expectation_id,result.step_definition_id,result.sequence_no,
         count(*) filter(where result.eligibility='ACQUISITION')::integer,
         count(*) filter(where result.eligibility='ACQUISITION' and result.performance_code='INDEPENDENT')::integer,
         count(*) filter(where result.eligibility='MAINTENANCE')::integer,
         count(*) filter(where result.eligibility='MAINTENANCE' and result.performance_code='INDEPENDENT')::integer,
         count(*) filter(where result.performance_code='PROMPTED')::integer,
         count(*) filter(where result.performance_code='INCORRECT')::integer,
         count(*) filter(where result.performance_code='NO_RESPONSE')::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_aba_task_runs_v3 run on run.event_id=e.id
  join public.clinical_measurement_aba_task_step_results_v3 result on result.run_event_id=run.event_id
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,result.step_definition_id,result.sequence_no;

  insert into public.clinical_measurement_session_prompt_distribution_v3(expectation_id,source_kind,prompt_level_id,occurrence_count)
  select e.expectation_id,'TASK_ANALYSIS',result.prompt_level_id,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_aba_task_runs_v3 run on run.event_id=e.id
  join public.clinical_measurement_aba_task_step_results_v3 result on result.run_event_id=run.event_id
  where e.expectation_id=any(p_expectation_ids) and result.prompt_level_id is not null
  group by e.expectation_id,result.prompt_level_id;

  -- Append a revision only when the semantic projection actually changed.
  with snapshots as (
    select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,scope.semantic_family,
           public.build_clinical_measurement_projection_snapshot_v3(scope.expectation_id) payload,
           (select max(e.recorded_at) from public.clinical_measurement_raw_events_v3 e where e.expectation_id=scope.expectation_id) latest_recorded,
           clock_timestamp() computed_at
    from public.clinical_measurement_projection_scope_v3 scope
    where scope.expectation_id=any(p_expectation_ids)
  ), hashed as (
    select s.*,encode(digest(convert_to(s.payload::text,'UTF8'),'sha256'),'hex') projection_hash
    from snapshots s
  ), changed as (
    select h.*,head.revision_number old_revision,head.projection_hash old_hash,head.source_latest_recorded_at old_source,
      case
        when head.expectation_id is null then 'INITIAL'
        when p_revision_hint='MANUAL_REBUILD' then 'MANUAL_REBUILD'
        when exists (select 1 from public.clinical_measurement_raw_events_v3 e
                     where e.expectation_id=h.expectation_id
                       and e.recorded_at>coalesce(head.source_latest_recorded_at,'-infinity'::timestamptz)
                       and e.event_kind in ('CORRECTION','VOID','SUPERSEDE')) then 'AUDIT_CORRECTION'
        when exists (select 1 from public.clinical_measurement_raw_events_v3 e
                     where e.expectation_id=h.expectation_id
                       and e.recorded_at>coalesce(head.source_latest_recorded_at,'-infinity'::timestamptz)
                       and e.ingestion_mode='OFFLINE_SYNC') then 'LATE_DATA_INCORPORATED'
        when exists (select 1 from public.clinical_measurement_sessions_v3 s2
                     where s2.id=h.session_id and s2.status='FINALIZED'
                       and (head.expectation_id is null or head.computed_at<s2.finalized_at)) then 'SESSION_FINALIZED'
        else 'SOURCE_DATA_CHANGED' end revision_reason
    from hashed h
    left join public.clinical_measurement_session_projection_heads_v3 head on head.expectation_id=h.expectation_id
    where head.expectation_id is null or head.projection_hash is distinct from h.projection_hash
  ), inserted_revisions as (
    insert into public.clinical_measurement_session_projection_revisions_v3(
      expectation_id,organization_id,patient_id,session_id,target_id,semantic_family,revision_number,
      revision_reason,projection_hash,projection_payload,source_latest_recorded_at,computed_at
    )
    select expectation_id,organization_id,patient_id,session_id,target_id,semantic_family,coalesce(old_revision,0)+1,
           revision_reason,projection_hash,payload,latest_recorded,computed_at
    from changed
    returning expectation_id,revision_number,projection_hash,source_latest_recorded_at,computed_at
  )
  insert into public.clinical_measurement_session_projection_heads_v3(
    expectation_id,organization_id,patient_id,session_id,target_id,semantic_family,revision_number,
    projection_hash,source_latest_recorded_at,computed_at,updated_at
  )
  select c.expectation_id,c.organization_id,c.patient_id,c.session_id,c.target_id,c.semantic_family,
         r.revision_number,r.projection_hash,r.source_latest_recorded_at,r.computed_at,clock_timestamp()
  from changed c join inserted_revisions r using(expectation_id)
  on conflict(expectation_id) do update set
    revision_number=excluded.revision_number,
    projection_hash=excluded.projection_hash,
    source_latest_recorded_at=excluded.source_latest_recorded_at,
    computed_at=excluded.computed_at,
    updated_at=excluded.updated_at;

  select count(*) into v_count from unnest(p_expectation_ids) id;
  return v_count;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Statement-level enqueue: one bulk INSERT statement generates at most one queue
-- upsert per affected expectation, not one write per event.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_clinical_measurement_projection_from_raw_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  insert into public.clinical_measurement_projection_queue_v3(
    expectation_id,organization_id,patient_id,session_id,target_id,semantic_family,
    generation,processed_generation,status,latest_source_event_id,latest_source_recorded_at,
    latest_event_kind,latest_ingestion_mode,enqueued_at
  )
  select distinct on (event.expectation_id)
    event.expectation_id,event.organization_id,event.patient_id,event.session_id,event.target_id,event.semantic_family,
    1,0,'PENDING',event.id,event.recorded_at,event.event_kind,event.ingestion_mode,clock_timestamp()
  from inserted_events event
  join public.clinical_measurement_collection_streams_v3 stream on stream.id=event.stream_id and stream.stream_role='PRIMARY'
  order by event.expectation_id,event.recorded_at desc,event.id desc
  on conflict(expectation_id) do update set
    generation=public.clinical_measurement_projection_queue_v3.generation+1,
    status='PENDING',latest_source_event_id=excluded.latest_source_event_id,
    latest_source_recorded_at=greatest(public.clinical_measurement_projection_queue_v3.latest_source_recorded_at,excluded.latest_source_recorded_at),
    latest_event_kind=excluded.latest_event_kind,latest_ingestion_mode=excluded.latest_ingestion_mode,
    enqueued_at=excluded.enqueued_at,last_error=null;
  return null;
end;
$function$;

create or replace function public.enqueue_clinical_measurement_projection_on_session_finalization_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  if old.status is distinct from 'FINALIZED' and new.status='FINALIZED' then
    insert into public.clinical_measurement_projection_queue_v3(
      expectation_id,organization_id,patient_id,session_id,target_id,semantic_family,
      generation,processed_generation,status,enqueued_at
    )
    select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,scope.semantic_family,
           1,0,'PENDING',clock_timestamp()
    from public.clinical_measurement_projection_scope_v3 scope
    where scope.session_id=new.id
    on conflict(expectation_id) do update set
      generation=public.clinical_measurement_projection_queue_v3.generation+1,
      status='PENDING',enqueued_at=excluded.enqueued_at,last_error=null;
  end if;
  return null;
end;
$function$;

-- Claim + process a bounded queue batch without per-expectation SQL calls.
create or replace function public.process_clinical_measurement_projection_queue_v3(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_ids uuid[];
  v_count integer;
begin
  if p_limit < 1 or p_limit > 250 then raise exception 'CMV3_PROJECTION_LIMIT_INVALID'; end if;

  with candidates as (
    select expectation_id
    from public.clinical_measurement_projection_queue_v3
    where status in ('PENDING','FAILED')
    order by enqueued_at,expectation_id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.clinical_measurement_projection_queue_v3 queue
    set status='PROCESSING',processing_started_at=clock_timestamp(),attempt_count=attempt_count+1,last_error=null
    from candidates
    where queue.expectation_id=candidates.expectation_id
    returning queue.expectation_id
  )
  select array_agg(expectation_id order by expectation_id),count(*)::integer into v_ids,v_count from claimed;

  if coalesce(v_count,0)=0 then return jsonb_build_object('processed',0); end if;

  perform public.recompute_clinical_measurement_projection_batch_v3(v_ids,null);

  update public.clinical_measurement_projection_queue_v3
  set processed_generation=generation,status='DONE',processed_at=clock_timestamp(),processing_started_at=null,last_error=null
  where expectation_id=any(v_ids);

  return jsonb_build_object('processed',v_count,'expectation_ids',to_jsonb(v_ids));
end;
$function$;

-- Manual deterministic rebuild. It never touches raw facts.
create or replace function public.rebuild_clinical_measurement_projection_v3(p_expectation_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  return public.recompute_clinical_measurement_projection_batch_v3(p_expectation_ids,'MANUAL_REBUILD');
end;
$function$;

-- Projection revision history itself is append-only.
create or replace function public.guard_clinical_measurement_projection_revision_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'CMV3_PROJECTION_REVISION_APPEND_ONLY';
end;
$function$;

drop trigger if exists enqueue_cmv3_projection_raw on public.clinical_measurement_raw_events_v3;
create trigger enqueue_cmv3_projection_raw
after insert on public.clinical_measurement_raw_events_v3
referencing new table as inserted_events
for each statement execute function public.enqueue_clinical_measurement_projection_from_raw_v3();

drop trigger if exists enqueue_cmv3_projection_session_finalized on public.clinical_measurement_sessions_v3;
create trigger enqueue_cmv3_projection_session_finalized
after update of status on public.clinical_measurement_sessions_v3
for each row execute function public.enqueue_clinical_measurement_projection_on_session_finalization_v3();

drop trigger if exists guard_cmv3_projection_revision_immutable on public.clinical_measurement_session_projection_revisions_v3;
create trigger guard_cmv3_projection_revision_immutable
before update or delete on public.clinical_measurement_session_projection_revisions_v3
for each row execute function public.guard_clinical_measurement_projection_revision_v3();

-- ---------------------------------------------------------------------------
-- Dark RLS and privileges. API/read endpoints arrive later; browser roles cannot
-- query these internal projections directly.
-- ---------------------------------------------------------------------------
do $cmv3_projection_rls$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinical_measurement_projection_queue_v3',
    'clinical_measurement_session_count_summaries_v3',
    'clinical_measurement_session_rate_summaries_v3',
    'clinical_measurement_session_proportion_summaries_v3',
    'clinical_measurement_session_temporal_summaries_v3',
    'clinical_measurement_session_continuous_summaries_v3',
    'clinical_measurement_session_interval_summaries_v3',
    'clinical_measurement_session_ordinal_summaries_v3',
    'clinical_measurement_session_categorical_summaries_v3',
    'clinical_measurement_session_task_analysis_summaries_v3',
    'clinical_measurement_session_category_breakdown_v3',
    'clinical_measurement_session_interval_breakdown_v3',
    'clinical_measurement_session_prompt_distribution_v3',
    'clinical_measurement_session_task_step_summaries_v3',
    'clinical_measurement_session_projection_heads_v3',
    'clinical_measurement_session_projection_revisions_v3'
  ] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated',v_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role',v_table);
  end loop;
end;
$cmv3_projection_rls$;

-- Cold revision ledger is append-only even for service_role; only SELECT/INSERT are needed.
revoke update, delete on table public.clinical_measurement_session_projection_revisions_v3 from service_role;

revoke all on public.clinical_measurement_effective_raw_events_v3 from public,anon,authenticated;
revoke all on public.clinical_measurement_projection_scope_v3 from public,anon,authenticated;
revoke all on public.clinical_measurement_effective_primary_events_v3 from public,anon,authenticated;
grant select on public.clinical_measurement_effective_raw_events_v3 to service_role;
grant select on public.clinical_measurement_projection_scope_v3 to service_role;
grant select on public.clinical_measurement_effective_primary_events_v3 to service_role;

revoke all on function public.cmv3_projection_coverage_status(uuid,text) from public,anon,authenticated;
revoke all on function public.build_clinical_measurement_projection_snapshot_v3(uuid) from public,anon,authenticated;
revoke all on function public.recompute_clinical_measurement_projection_batch_v3(uuid[],text) from public,anon,authenticated;
revoke all on function public.process_clinical_measurement_projection_queue_v3(integer) from public,anon,authenticated;
revoke all on function public.rebuild_clinical_measurement_projection_v3(uuid[]) from public,anon,authenticated;
grant execute on function public.cmv3_projection_coverage_status(uuid,text) to service_role;
grant execute on function public.build_clinical_measurement_projection_snapshot_v3(uuid) to service_role;
grant execute on function public.recompute_clinical_measurement_projection_batch_v3(uuid[],text) to service_role;
grant execute on function public.process_clinical_measurement_projection_queue_v3(integer) to service_role;
grant execute on function public.rebuild_clinical_measurement_projection_v3(uuid[]) to service_role;


-- ===========================================================================
-- Embedded canonical block 09/12: 20260820220000_clinical_measurement_v3_semantic_api_decisions.sql
-- ===========================================================================
-- Verto Clinical Measurement Engine V3 - Migration G
-- Semantic decision/evidence state foundation. Additive/dark only.


create unique index if not exists ux_cmv3_phase_epoch_scope_id
  on public.clinical_measurement_phase_epochs_v3(id, organization_id, patient_id, target_id);

create table if not exists public.clinical_measurement_criterion_epochs_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  criterion_key text not null,
  criterion_type text not null check (criterion_type in ('MASTERY','MAINTENANCE','GENERALIZATION','CUSTOM')),
  rule jsonb not null check (jsonb_typeof(rule)='object'),
  rule_hash text not null default repeat('0',64) check (rule_hash ~ '^[0-9a-f]{64}$'),
  effective_from timestamptz not null,
  effective_until timestamptz,
  recorded_at timestamptz not null default now(),
  supersedes_criterion_epoch_id uuid,
  superseded_at timestamptz,
  created_by text,
  constraint cmv3_criterion_epoch_window check (effective_until is null or effective_until > effective_from),
  constraint cmv3_criterion_epoch_key_nonempty check (length(trim(criterion_key)) between 1 and 180),
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id) on delete restrict,
  foreign key (definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definition_versions_v3(id, organization_id, patient_id, target_id) on delete restrict,
  foreign key (phase_epoch_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_phase_epochs_v3(id, organization_id, patient_id, target_id) on delete restrict,
  unique (id, organization_id, patient_id, target_id),
  foreign key (supersedes_criterion_epoch_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_criterion_epochs_v3(id, organization_id, patient_id, target_id) on delete restrict
);

create index if not exists idx_cmv3_criterion_epochs_target
  on public.clinical_measurement_criterion_epochs_v3(organization_id,patient_id,target_id,effective_from desc,recorded_at desc);

do $cmv3_criterion_overlap$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.clinical_measurement_criterion_epochs_v3'::regclass and conname='cmv3_criterion_epoch_no_overlap') then
    alter table public.clinical_measurement_criterion_epochs_v3 add constraint cmv3_criterion_epoch_no_overlap
      exclude using gist (organization_id with =, target_id with =, criterion_key with =,
        tstzrange(effective_from,coalesce(effective_until,'infinity'::timestamptz),'[)') with &&)
      where (superseded_at is null);
  end if;
end;$cmv3_criterion_overlap$;

create table if not exists public.clinical_measurement_evidence_revisions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  criterion_epoch_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  evidence_support_state text not null check (evidence_support_state in ('NOT_EVALUATED','INSUFFICIENT','SUFFICIENT','CHANGED_SINCE_DECISION','INVALIDATED')),
  evaluation_status text not null check (evaluation_status in ('NOT_EVALUATED','CRITERION_NOT_MET','CRITERION_MET','INDETERMINATE')),
  evaluation jsonb not null default '{}'::jsonb check (jsonb_typeof(evaluation)='object'),
  evidence_hash text not null default repeat('0',64) check (evidence_hash ~ '^[0-9a-f]{64}$'),
  projection_watermark timestamptz,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (criterion_epoch_id, revision_number),
  unique (id, organization_id, patient_id, target_id),
  foreign key (criterion_epoch_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_criterion_epochs_v3(id, organization_id, patient_id, target_id) on delete restrict,
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id) on delete restrict
);

create index if not exists idx_cmv3_evidence_revisions_latest
  on public.clinical_measurement_evidence_revisions_v3(organization_id,patient_id,target_id,criterion_epoch_id,revision_number desc);

create table if not exists public.clinical_measurement_clinical_decision_events_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  decision_type text not null check (decision_type in ('CLINICIAN_CONFIRMED_MASTERY','CLINICIAN_REVOKED_MASTERY','CLINICIAN_CONFIRMED_MAINTENANCE','CLINICIAN_REOPENED_ACQUISITION')),
  evidence_revision_id uuid,
  actor_membership_id uuid not null references public.clinic_memberships(id) on delete restrict,
  reason text,
  decided_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  supersedes_decision_event_id uuid,
  unique (id, organization_id, patient_id, target_id),
  foreign key (supersedes_decision_event_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_clinical_decision_events_v3(id, organization_id, patient_id, target_id) on delete restrict,
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id) on delete restrict,
  foreign key (evidence_revision_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_evidence_revisions_v3(id, organization_id, patient_id, target_id) on delete restrict
);

create index if not exists idx_cmv3_decisions_target
  on public.clinical_measurement_clinical_decision_events_v3(organization_id,patient_id,target_id,decided_at desc,recorded_at desc);


create or replace function public.prepare_clinical_measurement_criterion_epoch_v3()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,extensions set row_security=off as $function$
begin
  new.recorded_at := clock_timestamp();
  new.rule_hash := encode(digest(convert_to(new.rule::text,'UTF8'),'sha256'),'hex');
  return new;
end;$function$;
drop trigger if exists cmv3_prepare_criterion_epoch on public.clinical_measurement_criterion_epochs_v3;
create trigger cmv3_prepare_criterion_epoch before insert on public.clinical_measurement_criterion_epochs_v3
for each row execute function public.prepare_clinical_measurement_criterion_epoch_v3();

create or replace function public.prepare_clinical_measurement_evidence_revision_v3()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,extensions set row_security=off as $function$
begin
  new.evaluated_at := clock_timestamp(); new.created_at := new.evaluated_at;
  new.evidence_hash := encode(digest(convert_to(jsonb_build_object(
    'criterion_epoch_id',new.criterion_epoch_id,'revision_number',new.revision_number,
    'support',new.evidence_support_state,'status',new.evaluation_status,
    'evaluation',new.evaluation
  )::text,'UTF8'),'sha256'),'hex');
  return new;
end;$function$;
drop trigger if exists cmv3_prepare_evidence_revision on public.clinical_measurement_evidence_revisions_v3;
create trigger cmv3_prepare_evidence_revision before insert on public.clinical_measurement_evidence_revisions_v3
for each row execute function public.prepare_clinical_measurement_evidence_revision_v3();

create or replace function public.validate_clinical_measurement_decision_actor_v3()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public set row_security=off as $function$
declare v_ok boolean;
begin
  select exists(select 1 from public.clinic_memberships m where m.id=new.actor_membership_id and m.clinic_id=new.organization_id and lower(coalesce(m.status,''))='active') into v_ok;
  if not v_ok then raise exception 'CMV3_DECISION_ACTOR_SCOPE_INVALID'; end if;
  new.recorded_at := clock_timestamp();
  return new;
end;$function$;
drop trigger if exists cmv3_validate_decision_actor on public.clinical_measurement_clinical_decision_events_v3;
create trigger cmv3_validate_decision_actor before insert on public.clinical_measurement_clinical_decision_events_v3
for each row execute function public.validate_clinical_measurement_decision_actor_v3();

create table if not exists public.clinical_measurement_target_states_v3 (
  target_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  clinical_state text not null default 'ACTIVE' check (clinical_state in ('ACTIVE','MASTERED','MAINTENANCE','REOPENED_ACQUISITION')),
  evidence_support_state text not null default 'NOT_EVALUATED' check (evidence_support_state in ('NOT_EVALUATED','INSUFFICIENT','SUFFICIENT','CHANGED_SINCE_DECISION','INVALIDATED')),
  workflow_attention_state text not null default 'NONE' check (workflow_attention_state in ('NONE','REVIEW_REQUIRED')),
  latest_decision_event_id uuid,
  latest_evidence_revision_id uuid,
  updated_at timestamptz not null default now(),
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id) on delete cascade,
  foreign key (latest_decision_event_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_clinical_decision_events_v3(id, organization_id, patient_id, target_id) on delete restrict,
  foreign key (latest_evidence_revision_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_evidence_revisions_v3(id, organization_id, patient_id, target_id) on delete restrict
);


create or replace function public.evaluate_clinical_measurement_criterion_v3(p_criterion_epoch_id uuid)
returns public.clinical_measurement_evidence_revisions_v3
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
set row_security=off
as $function$
declare
  c public.clinical_measurement_criterion_epochs_v3;
  d public.clinical_measurement_definitions_v3;
  v_size integer;
  v_min_den integer;
  v_operator text;
  v_threshold numeric;
  v_points jsonb := '[]'::jsonb;
  v_eligible integer := 0;
  v_passing integer := 0;
  v_eval_status text := 'INDETERMINATE';
  v_support text := 'INSUFFICIENT';
  v_evaluation jsonb;
  v_watermark timestamptz;
  v_latest public.clinical_measurement_evidence_revisions_v3;
  v_result public.clinical_measurement_evidence_revisions_v3;
begin
  select * into strict c from public.clinical_measurement_criterion_epochs_v3 where id=p_criterion_epoch_id for update;
  select def.* into strict d from public.clinical_measurement_definition_versions_v3 ver
    join public.clinical_measurement_definitions_v3 def on def.id=ver.definition_id
    where ver.id=c.definition_version_id and def.target_id=c.target_id;
  v_size := greatest(1,least(100,coalesce((c.rule#>>'{window,size}')::integer,1)));
  v_min_den := greatest(0,coalesce((c.rule->>'minimum_denominator_per_point')::integer,0));
  v_operator := upper(coalesce(c.rule->>'operator',''));
  v_threshold := nullif(c.rule->>'threshold','')::numeric;
  if v_operator not in ('GREATER_THAN_OR_EQUAL','GREATER_THAN','LESS_THAN_OR_EQUAL','LESS_THAN','EQUAL') or v_threshold is null then
    raise exception 'CMV3_CRITERION_RULE_UNSUPPORTED';
  end if;
  if upper(coalesce(c.rule#>>'{window,unit}','SESSION')) <> 'SESSION'
     or coalesce((c.rule#>>'{window,consecutive}')::boolean,true) is not true then
    raise exception 'CMV3_CRITERION_WINDOW_UNSUPPORTED';
  end if;
  if (d.semantic_family in ('PROPORTION','TASK_ANALYSIS') and upper(coalesce(c.rule->>'threshold_unit','')) <> 'PERCENT')
     or (d.semantic_family='RATE' and upper(coalesce(c.rule->>'threshold_unit','')) <> 'EVENTS_PER_HOUR')
     or (d.semantic_family='COUNT' and upper(coalesce(c.rule->>'threshold_unit','')) <> 'COUNT')
     or (d.semantic_family in ('DURATION','LATENCY','IRT') and upper(coalesce(c.rule->>'threshold_unit','')) <> 'MILLISECOND')
     or (d.semantic_family='CONTINUOUS' and nullif(c.rule->>'threshold_unit','') is null) then
    raise exception 'CMV3_CRITERION_THRESHOLD_UNIT_REQUIRED';
  end if;

  if d.semantic_family='CONTINUOUS' and upper(c.rule->>'threshold_unit') is distinct from upper(coalesce((select unit_code from public.clinical_measurement_definition_versions_v3 where id=c.definition_version_id),'')) then
    raise exception 'CMV3_CRITERION_THRESHOLD_UNIT_MISMATCH';
  end if;

  if d.semantic_family='PROPORTION' then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,
        (s.coverage_status='OBSERVED' and s.denominator is not null and s.denominator>=v_min_den and s.percent_value is not null) eligible,
        case v_operator when 'GREATER_THAN_OR_EQUAL' then s.percent_value>=v_threshold when 'GREATER_THAN' then s.percent_value>v_threshold when 'LESS_THAN_OR_EQUAL' then s.percent_value<=v_threshold when 'LESS_THAN' then s.percent_value<v_threshold else s.percent_value=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,
        jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.percent_value,'numerator',s.numerator,'denominator',s.denominator) point
      from public.clinical_measurement_session_proportion_summaries_v3 s
      where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  elsif d.semantic_family='RATE' then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,(s.coverage_status='OBSERVED' and s.rate_per_hour is not null) eligible,
        case v_operator when 'GREATER_THAN_OR_EQUAL' then s.rate_per_hour>=v_threshold when 'GREATER_THAN' then s.rate_per_hour>v_threshold when 'LESS_THAN_OR_EQUAL' then s.rate_per_hour<=v_threshold when 'LESS_THAN' then s.rate_per_hour<v_threshold else s.rate_per_hour=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.rate_per_hour,'event_count',s.event_count,'observation_duration_ms',s.observation_duration_ms) point
      from public.clinical_measurement_session_rate_summaries_v3 s where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  elsif d.semantic_family='COUNT' then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,(s.coverage_status='OBSERVED') eligible,
        (s.coverage_status='OBSERVED') and case v_operator when 'GREATER_THAN_OR_EQUAL' then s.total_count>=v_threshold when 'GREATER_THAN' then s.total_count>v_threshold when 'LESS_THAN_OR_EQUAL' then s.total_count<=v_threshold when 'LESS_THAN' then s.total_count<v_threshold else s.total_count=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.total_count) point
      from public.clinical_measurement_session_count_summaries_v3 s where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  elsif d.semantic_family in ('DURATION','LATENCY','IRT') then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,(s.coverage_status='OBSERVED' and s.mean_duration_ms is not null) eligible,
        case v_operator when 'GREATER_THAN_OR_EQUAL' then s.mean_duration_ms>=v_threshold when 'GREATER_THAN' then s.mean_duration_ms>v_threshold when 'LESS_THAN_OR_EQUAL' then s.mean_duration_ms<=v_threshold when 'LESS_THAN' then s.mean_duration_ms<v_threshold else s.mean_duration_ms=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.mean_duration_ms,'unit','MILLISECOND') point
      from public.clinical_measurement_session_temporal_summaries_v3 s where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id and s.semantic_family=d.semantic_family
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  elsif d.semantic_family='CONTINUOUS' then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,(s.coverage_status='OBSERVED' and s.latest_value is not null) eligible,
        case v_operator when 'GREATER_THAN_OR_EQUAL' then s.latest_value>=v_threshold when 'GREATER_THAN' then s.latest_value>v_threshold when 'LESS_THAN_OR_EQUAL' then s.latest_value<=v_threshold when 'LESS_THAN' then s.latest_value<v_threshold else s.latest_value=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.latest_value) point
      from public.clinical_measurement_session_continuous_summaries_v3 s where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  elsif d.semantic_family='TASK_ANALYSIS' then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,(s.coverage_status='OBSERVED' and s.acquisition_eligible_count>=v_min_den and s.acquisition_independence_percent is not null) eligible,
        case v_operator when 'GREATER_THAN_OR_EQUAL' then s.acquisition_independence_percent>=v_threshold when 'GREATER_THAN' then s.acquisition_independence_percent>v_threshold when 'LESS_THAN_OR_EQUAL' then s.acquisition_independence_percent<=v_threshold when 'LESS_THAN' then s.acquisition_independence_percent<v_threshold else s.acquisition_independence_percent=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.acquisition_independence_percent,'eligible_steps',s.acquisition_eligible_count) point
      from public.clinical_measurement_session_task_analysis_summaries_v3 s where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  else
    v_eval_status := 'INDETERMINATE'; v_support := 'INSUFFICIENT';
  end if;

  if d.semantic_family in ('PROPORTION','RATE','COUNT','DURATION','LATENCY','IRT','CONTINUOUS','TASK_ANALYSIS') then
    if v_eligible < v_size then v_eval_status:='INDETERMINATE'; v_support:='INSUFFICIENT';
    elsif v_passing=v_size then v_eval_status:='CRITERION_MET'; v_support:='SUFFICIENT';
    else v_eval_status:='CRITERION_NOT_MET'; v_support:='INSUFFICIENT'; end if;
  end if;
  v_evaluation := jsonb_build_object('eligible_points',v_eligible,'required_points',v_size,'passing_points',v_passing,'points',v_points,'rule',c.rule);
  select * into v_latest from public.clinical_measurement_evidence_revisions_v3 e where e.criterion_epoch_id=c.id order by e.revision_number desc limit 1;
  if v_latest.id is not null and v_latest.evidence_support_state=v_support and v_latest.evaluation_status=v_eval_status and v_latest.evaluation=v_evaluation then return v_latest; end if;
  insert into public.clinical_measurement_evidence_revisions_v3(organization_id,patient_id,target_id,criterion_epoch_id,revision_number,evidence_support_state,evaluation_status,evaluation,projection_watermark)
  values(c.organization_id,c.patient_id,c.target_id,c.id,coalesce(v_latest.revision_number,0)+1,v_support,v_eval_status,v_evaluation,v_watermark)
  returning * into v_result;
  return v_result;
end;$function$;

create or replace function public.refresh_clinical_measurement_target_state_v3(p_target_id uuid)
returns public.clinical_measurement_target_states_v3
language plpgsql
security definer
set search_path=pg_catalog,public
set row_security=off
as $function$
declare
  v_target public.clinical_measurement_targets_v3;
  v_decision public.clinical_measurement_clinical_decision_events_v3;
  v_evidence public.clinical_measurement_evidence_revisions_v3;
  v_clinical text := 'ACTIVE';
  v_evidence_state text := 'NOT_EVALUATED';
  v_workflow text := 'NONE';
  v_result public.clinical_measurement_target_states_v3;
begin
  select * into strict v_target from public.clinical_measurement_targets_v3 where id=p_target_id;
  select * into v_decision from public.clinical_measurement_clinical_decision_events_v3 d
    where d.target_id=p_target_id order by d.decided_at desc,d.recorded_at desc,d.id desc limit 1;
  if v_decision.id is not null and v_decision.evidence_revision_id is not null then
    select current_e.* into v_evidence
    from public.clinical_measurement_evidence_revisions_v3 decided_e
    join public.clinical_measurement_evidence_revisions_v3 current_e
      on current_e.criterion_epoch_id=decided_e.criterion_epoch_id
    where decided_e.id=v_decision.evidence_revision_id and current_e.target_id=p_target_id
    order by current_e.revision_number desc,current_e.evaluated_at desc,current_e.id desc limit 1;
  else
    select * into v_evidence from public.clinical_measurement_evidence_revisions_v3 e
      where e.target_id=p_target_id order by e.evaluated_at desc,e.revision_number desc,e.id desc limit 1;
  end if;

  if v_decision.id is not null then
    v_clinical := case v_decision.decision_type
      when 'CLINICIAN_CONFIRMED_MASTERY' then 'MASTERED'
      when 'CLINICIAN_REVOKED_MASTERY' then 'ACTIVE'
      when 'CLINICIAN_CONFIRMED_MAINTENANCE' then 'MAINTENANCE'
      when 'CLINICIAN_REOPENED_ACQUISITION' then 'REOPENED_ACQUISITION'
      else 'ACTIVE' end;
  end if;
  if v_evidence.id is not null then v_evidence_state := v_evidence.evidence_support_state; end if;
  if v_decision.id is not null and v_evidence.id is not null
     and (v_decision.evidence_revision_id is distinct from v_evidence.id)
     and v_evidence.evidence_support_state in ('INSUFFICIENT','CHANGED_SINCE_DECISION','INVALIDATED') then
    v_workflow := 'REVIEW_REQUIRED';
  end if;

  insert into public.clinical_measurement_target_states_v3(
    target_id,organization_id,patient_id,clinical_state,evidence_support_state,workflow_attention_state,
    latest_decision_event_id,latest_evidence_revision_id,updated_at)
  values (v_target.id,v_target.organization_id,v_target.patient_id,v_clinical,v_evidence_state,v_workflow,
    v_decision.id,v_evidence.id,clock_timestamp())
  on conflict (target_id) do update set
    clinical_state=excluded.clinical_state,
    evidence_support_state=excluded.evidence_support_state,
    workflow_attention_state=excluded.workflow_attention_state,
    latest_decision_event_id=excluded.latest_decision_event_id,
    latest_evidence_revision_id=excluded.latest_evidence_revision_id,
    updated_at=excluded.updated_at
  returning * into v_result;
  return v_result;
end;
$function$;


create or replace function public.cmv3_refresh_target_state_after_append()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public set row_security=off as $function$
begin
  perform public.refresh_clinical_measurement_target_state_v3(new.target_id);
  return new;
end;$function$;
drop trigger if exists cmv3_refresh_state_after_evidence on public.clinical_measurement_evidence_revisions_v3;
create trigger cmv3_refresh_state_after_evidence after insert on public.clinical_measurement_evidence_revisions_v3
for each row execute function public.cmv3_refresh_target_state_after_append();
drop trigger if exists cmv3_refresh_state_after_decision on public.clinical_measurement_clinical_decision_events_v3;
create trigger cmv3_refresh_state_after_decision after insert on public.clinical_measurement_clinical_decision_events_v3
for each row execute function public.cmv3_refresh_target_state_after_append();

create or replace function public.cmv3_criterion_epoch_mutation_guard()
returns trigger language plpgsql as $function$
begin
  if tg_op='DELETE' then raise exception 'CMV3_CRITERION_EPOCH_DELETE_FORBIDDEN'; end if;
  if (to_jsonb(new)-'superseded_at') is distinct from (to_jsonb(old)-'superseded_at') then
    raise exception 'CMV3_CRITERION_EPOCH_IMMUTABLE';
  end if;
  if new.superseded_at is not null and new.superseded_at < old.recorded_at then raise exception 'CMV3_CRITERION_SUPERSEDED_TIME_INVALID'; end if;
  return new;
end;$function$;
drop trigger if exists cmv3_criterion_epoch_mutation_guard on public.clinical_measurement_criterion_epochs_v3;
create trigger cmv3_criterion_epoch_mutation_guard before update or delete on public.clinical_measurement_criterion_epochs_v3
for each row execute function public.cmv3_criterion_epoch_mutation_guard();

create or replace function public.cmv3_append_only_guard()
returns trigger language plpgsql as $function$
begin
  raise exception 'CMV3_APPEND_ONLY_ENTITY';
end;$function$;

do $guards$
declare t text;
begin
  foreach t in array array['clinical_measurement_evidence_revisions_v3','clinical_measurement_clinical_decision_events_v3'] loop
    execute format('drop trigger if exists cmv3_append_only_guard on public.%I',t);
    execute format('create trigger cmv3_append_only_guard before update or delete on public.%I for each row execute function public.cmv3_append_only_guard()',t);
  end loop;
end;$guards$;

-- Browser remains closed. Server/service role is the only path during dark rollout.
do $rls$
declare t text;
begin
  foreach t in array array[
    'clinical_measurement_criterion_epochs_v3','clinical_measurement_evidence_revisions_v3',
    'clinical_measurement_clinical_decision_events_v3','clinical_measurement_target_states_v3'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
  end loop;
end;$rls$;

revoke all on function public.evaluate_clinical_measurement_criterion_v3(uuid) from public, anon, authenticated;
grant execute on function public.evaluate_clinical_measurement_criterion_v3(uuid) to service_role;
revoke all on function public.refresh_clinical_measurement_target_state_v3(uuid) from public, anon, authenticated;
grant execute on function public.refresh_clinical_measurement_target_state_v3(uuid) to service_role;


-- ===========================================================================


do $cmv3_prod_split_part3_postflight$
declare v_missing text[] := '{}'::text[]; v_enabled bigint := 0; v_raw bigint := 0;
begin
  if to_regclass('public.clinical_measurement_sync_batches_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_sync_batches_v3'); end if;
  if to_regprocedure('public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)') is null then v_missing := array_append(v_missing,'sync_clinical_measurements_bulk_v3'); end if;
  if to_regclass('public.clinical_measurement_projection_queue_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_projection_queue_v3'); end if;
  if to_regprocedure('public.process_clinical_measurement_projection_queue_v3(integer)') is null then v_missing := array_append(v_missing,'process_clinical_measurement_projection_queue_v3'); end if;
  if to_regclass('public.clinical_measurement_evidence_revisions_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_evidence_revisions_v3'); end if;
  if to_regclass('public.clinical_measurement_target_states_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_target_states_v3'); end if;
  if cardinality(v_missing)>0 then raise exception 'CMV3_SPLIT_PART3_POSTFLIGHT_MISSING:%',array_to_string(v_missing,', '); end if;
  select count(*) into v_enabled from public.aba_measurement_rollout_states_v3 where allow_new_v3_sessions is true;
  if v_enabled<>0 then raise exception 'CMV3_SPLIT_PART3_CHANGED_ROLLOUT:%',v_enabled; end if;
  select count(*) into v_raw from public.clinical_measurement_raw_events_v3;
  if v_raw<>0 then raise exception 'CMV3_SPLIT_PART3_UNEXPECTED_RAW_DATA:%',v_raw; end if;
end;
$cmv3_prod_split_part3_postflight$;
commit;
select jsonb_build_object('gate','PRODUCTION_SCHEMA_PROMOTION_PART_3_PASS','next_step','RUN_PART_4','cmv3_raw_event_count',(select count(*) from public.clinical_measurement_raw_events_v3)) as result;
