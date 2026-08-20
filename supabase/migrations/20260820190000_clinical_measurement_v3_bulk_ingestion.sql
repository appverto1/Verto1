-- Verto Clinical Measurement Engine V3 - Bulk/offline ingestion.
-- Additive/dark only. Adds one server-only transactional entrypoint and set-based
-- payload handlers. No authenticated/browser grant and no rollout change.

begin;

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

commit;
