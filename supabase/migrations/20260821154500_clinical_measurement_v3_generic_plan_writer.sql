-- Clinical Measurement Engine V3 — generic PTS/specialty plan writer.
--
-- Marco 2 of PTS & Specialty convergence.
-- Adds one server-only, atomic writer that resolves an existing PLAN_GOAL or
-- THERAPEUTIC_OBJECTIVE identity, reuses immutable semantic definitions/version
-- snapshots, writes through the established CMV3 bulk-ingestion pipeline, and
-- refreshes only the affected projection grain.
--
-- Preservation rules:
--   * no legacy clinical_observations/ABA writes;
--   * no browser EXECUTE grant;
--   * no destructive mutation of source plans/objectives;
--   * one idempotency key = one immutable V3 observation session;
--   * semantic-family changes never rewrite an existing definition identity.

begin;

create extension if not exists pgcrypto;

create or replace function public.write_clinical_plan_measurement_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_actor_membership_id uuid,
  p_client_event_id text,
  p_source_kind text,
  p_plan_id uuid,
  p_goal_id text,
  p_therapeutic_objective_id uuid,
  p_metric_key text,
  p_metric_label text,
  p_semantic_family text,
  p_unit_code text,
  p_unit_label text,
  p_directionality text,
  p_observed_at timestamptz,
  p_measurement jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_source_kind text := upper(btrim(coalesce(p_source_kind, '')));
  v_family text := upper(btrim(coalesce(p_semantic_family, '')));
  v_metric_key text := lower(btrim(coalesce(p_metric_key, '')));
  v_metric_label text := btrim(coalesce(p_metric_label, ''));
  v_client_event_id text := btrim(coalesce(p_client_event_id, ''));
  v_physical_event_prefix text;
  v_sync_batch_id text;
  v_directionality text := upper(btrim(coalesce(p_directionality, 'NO_DIRECTIONAL_JUDGMENT')));
  v_timezone text;
  v_actor_user_id text;
  v_actor_status text;
  v_actor_clinic uuid;
  v_target public.clinical_measurement_targets_v3%rowtype;
  v_definition public.clinical_measurement_definitions_v3%rowtype;
  v_definition_version public.clinical_measurement_definition_versions_v3%rowtype;
  v_activation public.clinical_measurement_definition_activations_v3%rowtype;
  v_previous_activation public.clinical_measurement_definition_activations_v3%rowtype;
  v_snapshot public.clinical_collection_protocol_snapshots_v3%rowtype;
  v_session public.clinical_measurement_sessions_v3%rowtype;
  v_expectation public.clinical_measurement_session_expectations_v3%rowtype;
  v_stream public.clinical_measurement_collection_streams_v3%rowtype;
  v_definition_key text;
  v_content jsonb;
  v_aggregation jsonb := jsonb_build_object('grain','SESSION','method','RAW');
  v_existing_version integer;
  v_ingestion_mode text;
  v_sync_items jsonb;
  v_sync_result jsonb;
  v_projection jsonb;
  v_session_started_at timestamptz;
  v_session_ended_at timestamptz;
  v_interval_start timestamptz;
  v_interval_end timestamptz;
  v_numeric numeric;
  v_count integer;
  v_category text;
  v_is_censored boolean := false;
  v_replayed boolean := false;
begin
  if p_organization_id is null or p_patient_id is null or p_actor_membership_id is null then
    raise exception 'CMV3_PLAN_WRITE_SCOPE_REQUIRED';
  end if;

  if length(v_client_event_id) < 16 or length(v_client_event_id) > 160 then
    raise exception 'CMV3_PLAN_WRITE_IDEMPOTENCY_INVALID';
  end if;
  if length(v_metric_key) < 1 or length(v_metric_key) > 120
     or length(v_metric_label) < 1 or length(v_metric_label) > 180
     or length(coalesce(p_unit_code,'')) > 80
     or length(coalesce(p_unit_label,'')) > 120 then
    raise exception 'CMV3_PLAN_WRITE_METRIC_INVALID';
  end if;
  if p_measurement is null or jsonb_typeof(p_measurement) <> 'object' then
    raise exception 'CMV3_PLAN_WRITE_MEASUREMENT_OBJECT_REQUIRED';
  end if;
  if v_source_kind not in ('PLAN_GOAL','THERAPEUTIC_OBJECTIVE') then
    raise exception 'CMV3_PLAN_WRITE_SOURCE_KIND_UNSUPPORTED';
  end if;
  if v_family not in ('CONTINUOUS','COUNT','CATEGORICAL','RATE','DURATION','LATENCY','IRT') then
    raise exception 'CMV3_PLAN_WRITE_SEMANTIC_FAMILY_UNSUPPORTED';
  end if;
  if v_directionality not in (
    'INCREASE_IS_BETTER','DECREASE_IS_BETTER','TARGET_RANGE_IS_BETTER','NO_DIRECTIONAL_JUDGMENT'
  ) then
    raise exception 'CMV3_PLAN_WRITE_DIRECTIONALITY_INVALID';
  end if;
  if p_observed_at is null
     or p_observed_at > clock_timestamp() + interval '5 minutes'
     or p_observed_at < clock_timestamp() - interval '20 years' then
    raise exception 'CMV3_PLAN_WRITE_OCCURRED_AT_INVALID';
  end if;

  select membership.clinic_id,
         lower(coalesce(membership.status,'')),
         membership.user_id::text,
         coalesce(nullif(btrim(membership.availability_timezone),''),'America/Sao_Paulo')
    into v_actor_clinic, v_actor_status, v_actor_user_id, v_timezone
  from public.clinic_memberships membership
  where membership.id = p_actor_membership_id;

  if not found or v_actor_clinic is distinct from p_organization_id or v_actor_status <> 'active' then
    raise exception 'CMV3_PLAN_WRITE_ACTOR_SCOPE_INVALID';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_timezone_names zone where zone.name = v_timezone
  ) then
    raise exception 'CMV3_PLAN_WRITE_TIMEZONE_INVALID';
  end if;

  -- Resolve an already-registered source identity. The writer never invents a
  -- plan goal or objective from a browser-supplied label.
  if v_source_kind = 'PLAN_GOAL' then
    if p_plan_id is null or nullif(btrim(coalesce(p_goal_id,'')), '') is null or length(btrim(p_goal_id)) > 100 then
      raise exception 'CMV3_PLAN_WRITE_PLAN_GOAL_REQUIRED';
    end if;

    select target.* into v_target
    from public.clinical_measurement_targets_v3 target
    where target.organization_id = p_organization_id
      and target.patient_id = p_patient_id
      and target.source_kind = 'PLAN_GOAL'
      and target.therapeutic_plan_id = p_plan_id
      and target.status = 'ACTIVE'
      and target.source_goal_key in (
        'pts:' || btrim(p_goal_id),
        btrim(p_goal_id)
      )
    order by case when target.source_goal_key = 'pts:' || btrim(p_goal_id) then 0 else 1 end
    limit 1;

    if not found then
      raise exception 'CMV3_PLAN_WRITE_PLAN_GOAL_IDENTITY_NOT_FOUND';
    end if;
  else
    if p_therapeutic_objective_id is null then
      raise exception 'CMV3_PLAN_WRITE_THERAPEUTIC_OBJECTIVE_REQUIRED';
    end if;

    select target.* into v_target
    from public.clinical_measurement_targets_v3 target
    where target.organization_id = p_organization_id
      and target.patient_id = p_patient_id
      and target.source_kind = 'THERAPEUTIC_OBJECTIVE'
      and target.therapeutic_objective_id = p_therapeutic_objective_id
      and target.status = 'ACTIVE'
    limit 1;

    if not found then
      raise exception 'CMV3_PLAN_WRITE_THERAPEUTIC_OBJECTIVE_IDENTITY_NOT_FOUND';
    end if;
  end if;

  -- One logical event id serializes the complete writer path without locking the
  -- patient or clinic. Replays reuse the same session/stream and are verified by
  -- sync_clinical_measurements_bulk_v3's payload hash.
  v_physical_event_prefix := 'plan:' || p_patient_id::text || ':' || v_client_event_id;
  v_sync_batch_id := 'plan:' || encode(
    digest(convert_to(p_patient_id::text || ':' || v_client_event_id, 'UTF8'), 'sha256'),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_patient_id::text || ':CMV3_PLAN_WRITE:' || v_client_event_id,
      0
    )
  );

  v_definition_key := 'plan_metric:' || v_metric_key;
  v_content := jsonb_strip_nulls(jsonb_build_object(
    'kind', v_family,
    'source', jsonb_build_object(
      'source_kind', v_source_kind,
      'therapeutic_plan_id', case when v_source_kind = 'PLAN_GOAL' then p_plan_id else null end,
      'source_goal_key', case when v_source_kind = 'PLAN_GOAL' then v_target.source_goal_key else null end,
      'therapeutic_objective_id', case when v_source_kind = 'THERAPEUTIC_OBJECTIVE' then p_therapeutic_objective_id else null end
    ),
    'metric', jsonb_build_object('key',v_metric_key,'label',v_metric_label)
  ));

  -- An idempotent replay does not create new semantic versions. It must point to
  -- the same target that was resolved from the current request.
  select session_row.* into v_session
  from public.clinical_measurement_sessions_v3 session_row
  where session_row.organization_id = p_organization_id
    and session_row.patient_id = p_patient_id
    and session_row.session_key = 'plan-write:' || v_client_event_id
  limit 1;

  if found then
    v_replayed := true;

    select expectation.* into v_expectation
    from public.clinical_measurement_session_expectations_v3 expectation
    where expectation.session_id = v_session.id
    limit 1;

    if not found or v_expectation.target_id is distinct from v_target.id then
      raise exception 'CMV3_PLAN_WRITE_IDEMPOTENCY_SCOPE_COLLISION';
    end if;

    select stream.* into v_stream
    from public.clinical_measurement_collection_streams_v3 stream
    where stream.expectation_id = v_expectation.id
      and stream.stream_role = 'PRIMARY'
    limit 1;

    if not found or v_stream.observer_membership_id is distinct from p_actor_membership_id then
      raise exception 'CMV3_PLAN_WRITE_IDEMPOTENCY_ACTOR_COLLISION';
    end if;

    select snapshot.* into v_snapshot
    from public.clinical_collection_protocol_snapshots_v3 snapshot
    where snapshot.id = v_expectation.protocol_snapshot_id
      and snapshot.organization_id = p_organization_id
      and snapshot.patient_id = p_patient_id
      and snapshot.target_id = v_target.id
    limit 1;
    if not found then raise exception 'CMV3_PLAN_WRITE_IDEMPOTENCY_SNAPSHOT_MISSING'; end if;

    select version.* into v_definition_version
    from public.clinical_measurement_definition_versions_v3 version
    where version.id = v_snapshot.definition_version_id
      and version.organization_id = p_organization_id
      and version.patient_id = p_patient_id
      and version.target_id = v_target.id
    limit 1;
    if not found then raise exception 'CMV3_PLAN_WRITE_IDEMPOTENCY_VERSION_MISSING'; end if;

    select definition.* into v_definition
    from public.clinical_measurement_definitions_v3 definition
    where definition.id = v_definition_version.definition_id
      and definition.organization_id = p_organization_id
      and definition.patient_id = p_patient_id
      and definition.target_id = v_target.id
    limit 1;

    if not found or v_definition.semantic_family is distinct from v_family
       or v_definition.definition_key is distinct from v_definition_key
       or v_definition_version.unit_code is distinct from nullif(btrim(coalesce(p_unit_code,'')),'')
       or v_definition_version.unit_label is distinct from nullif(btrim(coalesce(p_unit_label,'')),'')
       or v_definition_version.directionality is distinct from v_directionality
       or v_definition_version.content is distinct from v_content
       or v_definition_version.aggregation_policy is distinct from v_aggregation then
      raise exception 'CMV3_PLAN_WRITE_IDEMPOTENCY_SEMANTIC_COLLISION';
    end if;
  else
    -- Stable mathematical identity: a family change for the same metric key is
    -- blocked rather than silently rewriting the definition.
    select definition.* into v_definition
    from public.clinical_measurement_definitions_v3 definition
    where definition.organization_id = p_organization_id
      and definition.patient_id = p_patient_id
      and definition.target_id = v_target.id
      and definition.definition_key = v_definition_key
    limit 1;

    if found then
      if v_definition.semantic_family is distinct from v_family then
        raise exception 'CMV3_PLAN_WRITE_SEMANTIC_FAMILY_CONFLICT';
      end if;
      if v_definition.status <> 'ACTIVE' then
        raise exception 'CMV3_PLAN_WRITE_DEFINITION_NOT_ACTIVE';
      end if;
    else
      insert into public.clinical_measurement_definitions_v3(
        organization_id,patient_id,target_id,definition_key,semantic_family,status,created_by
      ) values (
        p_organization_id,p_patient_id,v_target.id,v_definition_key,v_family,'ACTIVE',v_actor_user_id
      ) returning * into v_definition;
    end if;

    select version.* into v_definition_version
    from public.clinical_measurement_definition_versions_v3 version
    where version.organization_id = p_organization_id
      and version.patient_id = p_patient_id
      and version.target_id = v_target.id
      and version.definition_id = v_definition.id
      and version.status = 'PUBLISHED'
      and version.unit_code is not distinct from nullif(btrim(coalesce(p_unit_code,'')),'')
      and version.unit_label is not distinct from nullif(btrim(coalesce(p_unit_label,'')),'')
      and version.directionality = v_directionality
      and version.content = v_content
      and version.aggregation_policy = v_aggregation
    order by version.version desc
    limit 1;

    if not found then
      select coalesce(max(version.version),0) + 1 into v_existing_version
      from public.clinical_measurement_definition_versions_v3 version
      where version.definition_id = v_definition.id;

      update public.clinical_measurement_definition_versions_v3 version
      set status = 'DEPRECATED', deprecated_at = clock_timestamp()
      where version.definition_id = v_definition.id
        and version.status = 'PUBLISHED';

      insert into public.clinical_measurement_definition_versions_v3(
        organization_id,patient_id,target_id,definition_id,version,schema_version,
        unit_code,unit_label,directionality,content,aggregation_policy,definition_hash,
        status,published_at,created_by
      ) values (
        p_organization_id,p_patient_id,v_target.id,v_definition.id,v_existing_version,3,
        nullif(btrim(coalesce(p_unit_code,'')),''),
        nullif(btrim(coalesce(p_unit_label,'')),''),
        v_directionality,v_content,v_aggregation,repeat('0',64),'PUBLISHED',clock_timestamp(),v_actor_user_id
      ) returning * into v_definition_version;
    end if;

    select activation.* into v_activation
    from public.clinical_measurement_definition_activations_v3 activation
    where activation.organization_id = p_organization_id
      and activation.patient_id = p_patient_id
      and activation.target_id = v_target.id
      and activation.definition_id = v_definition.id
      and activation.definition_version_id = v_definition_version.id
      and activation.superseded_at is null
      and activation.effective_from <= p_observed_at
      and (activation.effective_until is null or p_observed_at < activation.effective_until)
    order by activation.recorded_at desc
    limit 1;

    if not found then
      select activation.* into v_previous_activation
      from public.clinical_measurement_definition_activations_v3 activation
      where activation.organization_id = p_organization_id
        and activation.patient_id = p_patient_id
        and activation.target_id = v_target.id
        and activation.definition_id = v_definition.id
        and activation.superseded_at is null
      order by activation.recorded_at desc
      limit 1;

      if found then
        update public.clinical_measurement_definition_activations_v3
        set superseded_at = clock_timestamp()
        where id = v_previous_activation.id;
      end if;

      insert into public.clinical_measurement_definition_activations_v3(
        organization_id,patient_id,target_id,definition_id,definition_version_id,
        effective_from,effective_until,activation_mode,supersedes_activation_id,
        superseded_at,reason,created_by
      ) values (
        p_organization_id,p_patient_id,v_target.id,v_definition.id,v_definition_version.id,
        p_observed_at,null,
        case when p_observed_at < clock_timestamp() - interval '5 minutes'
          then 'RETROSPECTIVE_CORRECTION' else 'PROSPECTIVE' end,
        case when v_previous_activation.id is not null then v_previous_activation.id else null end,
        null,'PLAN_MEASUREMENT_DEFINITION_ACTIVATED',v_actor_user_id
      ) returning * into v_activation;
    end if;

    select snapshot.* into v_snapshot
    from public.clinical_collection_protocol_snapshots_v3 snapshot
    where snapshot.organization_id = p_organization_id
      and snapshot.patient_id = p_patient_id
      and snapshot.target_id = v_target.id
      and snapshot.definition_activation_id = v_activation.id
      and snapshot.definition_version_id = v_definition_version.id
      and snapshot.phase_epoch_id is null
    order by snapshot.created_at desc
    limit 1;

    if not found then
      insert into public.clinical_collection_protocol_snapshots_v3(
        organization_id,patient_id,target_id,definition_activation_id,definition_version_id,
        phase_epoch_id,phase_version_id,schema_version,snapshot,snapshot_hash,created_by
      ) values (
        p_organization_id,p_patient_id,v_target.id,v_activation.id,v_definition_version.id,
        null,null,3,
        jsonb_build_object(
          'kind','PLAN_MEASUREMENT',
          'source_kind',v_source_kind,
          'metric_key',v_metric_key,
          'semantic_family',v_family,
          'definition_version',v_definition_version.version
        ),
        repeat('0',64),v_actor_user_id
      ) returning * into v_snapshot;
    end if;

    -- Validate and derive the physical primitive before creating the session.
    if v_family = 'CONTINUOUS' then
      begin
        v_numeric := (p_measurement->>'numeric_value')::numeric;
      exception when others then
        raise exception 'CMV3_PLAN_WRITE_CONTINUOUS_VALUE_INVALID';
      end;
      if v_numeric is null or abs(v_numeric) > 1000000000000000::numeric then
        raise exception 'CMV3_PLAN_WRITE_CONTINUOUS_VALUE_INVALID';
      end if;
      v_session_started_at := p_observed_at;
      v_session_ended_at := p_observed_at;
    elsif v_family = 'COUNT' then
      begin
        v_count := (p_measurement->>'count_delta')::integer;
      exception when others then
        raise exception 'CMV3_PLAN_WRITE_COUNT_VALUE_INVALID';
      end;
      if v_count is null or v_count < 0 or v_count > 1000000000 then
        raise exception 'CMV3_PLAN_WRITE_COUNT_VALUE_INVALID';
      end if;
      v_session_started_at := p_observed_at;
      v_session_ended_at := p_observed_at;
    elsif v_family = 'CATEGORICAL' then
      v_category := btrim(coalesce(p_measurement->>'category_key',''));
      if length(v_category) < 1 or length(v_category) > 180 then
        raise exception 'CMV3_PLAN_WRITE_CATEGORY_VALUE_INVALID';
      end if;
      v_session_started_at := p_observed_at;
      v_session_ended_at := p_observed_at;
    elsif v_family in ('DURATION','LATENCY','IRT') then
      begin
        v_interval_start := (p_measurement->>'started_at')::timestamptz;
        v_interval_end := (p_measurement->>'ended_at')::timestamptz;
        v_is_censored := coalesce((p_measurement->>'is_censored')::boolean,false);
      exception when others then
        raise exception 'CMV3_PLAN_WRITE_TEMPORAL_VALUE_INVALID';
      end;
      if v_interval_start is null or v_interval_end is null
         or v_interval_end <= v_interval_start
         or v_interval_end - v_interval_start > interval '7 days' then
        raise exception 'CMV3_PLAN_WRITE_TEMPORAL_VALUE_INVALID';
      end if;
      v_session_started_at := v_interval_start;
      v_session_ended_at := v_interval_end;
    elsif v_family = 'RATE' then
      begin
        v_count := (p_measurement->>'count_delta')::integer;
        v_interval_start := (p_measurement->>'observation_started_at')::timestamptz;
        v_interval_end := (p_measurement->>'observation_ended_at')::timestamptz;
      exception when others then
        raise exception 'CMV3_PLAN_WRITE_RATE_VALUE_INVALID';
      end;
      if v_count is null or v_count < 0 or v_count > 1000000000
         or v_interval_start is null or v_interval_end is null
         or v_interval_end <= v_interval_start
         or v_interval_end - v_interval_start > interval '7 days' then
        raise exception 'CMV3_PLAN_WRITE_RATE_VALUE_INVALID';
      end if;
      v_session_started_at := v_interval_start;
      v_session_ended_at := v_interval_end;
    end if;

    insert into public.clinical_measurement_sessions_v3(
      organization_id,patient_id,session_key,source_kind,aba_session_id,status,
      started_at,ended_at,clinical_date,clinical_date_policy,timezone_snapshot,
      timezone_offset_minutes,created_by
    ) values (
      p_organization_id,p_patient_id,'plan-write:' || v_client_event_id,'NATIVE_V3',null,'PREPARING',
      v_session_started_at,null,v_session_started_at::date,'SESSION_START_LOCAL_DATE',v_timezone,0,v_actor_user_id
    ) returning * into v_session;

    insert into public.clinical_measurement_session_expectations_v3(
      organization_id,patient_id,session_id,target_id,protocol_snapshot_id,expectation_key,created_by
    ) values (
      p_organization_id,p_patient_id,v_session.id,v_target.id,v_snapshot.id,
      'plan-metric:' || v_definition.id::text,v_actor_user_id
    ) returning * into v_expectation;

    insert into public.clinical_measurement_collection_streams_v3(
      organization_id,patient_id,session_id,expectation_id,target_id,stream_key,
      stream_role,observer_membership_id,paired_primary_stream_id,status,created_by
    ) values (
      p_organization_id,p_patient_id,v_session.id,v_expectation.id,v_target.id,
      'primary:' || p_actor_membership_id::text,'PRIMARY',p_actor_membership_id,null,'OPEN',v_actor_user_id
    ) returning * into v_stream;

    update public.clinical_measurement_sessions_v3
    set status = 'OPEN'
    where id = v_session.id
    returning * into v_session;
  end if;

  -- On replay the physical interval/count values still need to be parsed so the
  -- existing bulk-ingestion hash can detect any changed payload.
  if v_replayed then
    if v_family = 'CONTINUOUS' then
      begin v_numeric := (p_measurement->>'numeric_value')::numeric;
      exception when others then raise exception 'CMV3_PLAN_WRITE_CONTINUOUS_VALUE_INVALID'; end;
      if v_numeric is null or abs(v_numeric) > 1000000000000000::numeric then raise exception 'CMV3_PLAN_WRITE_CONTINUOUS_VALUE_INVALID'; end if;
    elsif v_family = 'COUNT' then
      begin v_count := (p_measurement->>'count_delta')::integer;
      exception when others then raise exception 'CMV3_PLAN_WRITE_COUNT_VALUE_INVALID'; end;
      if v_count is null or v_count < 0 or v_count > 1000000000 then raise exception 'CMV3_PLAN_WRITE_COUNT_VALUE_INVALID'; end if;
    elsif v_family = 'CATEGORICAL' then
      v_category := btrim(coalesce(p_measurement->>'category_key',''));
      if length(v_category) < 1 or length(v_category) > 180 then raise exception 'CMV3_PLAN_WRITE_CATEGORY_VALUE_INVALID'; end if;
    elsif v_family in ('DURATION','LATENCY','IRT') then
      begin
        v_interval_start := (p_measurement->>'started_at')::timestamptz;
        v_interval_end := (p_measurement->>'ended_at')::timestamptz;
        v_is_censored := coalesce((p_measurement->>'is_censored')::boolean,false);
      exception when others then raise exception 'CMV3_PLAN_WRITE_TEMPORAL_VALUE_INVALID'; end;
      if v_interval_start is null or v_interval_end is null or v_interval_end <= v_interval_start or v_interval_end-v_interval_start > interval '7 days' then raise exception 'CMV3_PLAN_WRITE_TEMPORAL_VALUE_INVALID'; end if;
    elsif v_family = 'RATE' then
      begin
        v_count := (p_measurement->>'count_delta')::integer;
        v_interval_start := (p_measurement->>'observation_started_at')::timestamptz;
        v_interval_end := (p_measurement->>'observation_ended_at')::timestamptz;
      exception when others then raise exception 'CMV3_PLAN_WRITE_RATE_VALUE_INVALID'; end;
      if v_count is null or v_count < 0 or v_count > 1000000000 or v_interval_start is null or v_interval_end is null or v_interval_end <= v_interval_start or v_interval_end-v_interval_start > interval '7 days' then raise exception 'CMV3_PLAN_WRITE_RATE_VALUE_INVALID'; end if;
    end if;
  end if;

  v_ingestion_mode := case
    when coalesce(v_interval_end, p_observed_at) < v_session.recorded_at - interval '5 minutes' then 'RETROSPECTIVE_ENTRY'
    else 'LIVE'
  end;

  if v_family = 'CONTINUOUS' then
    v_sync_items := jsonb_build_array(jsonb_build_object(
      'client_event_id',v_physical_event_prefix,'stream_id',v_stream.id::text,
      'occurred_at_utc',p_observed_at,'event_kind','FACT','ingestion_mode',v_ingestion_mode,
      'payload',jsonb_build_object('kind','SCALAR','numeric_value',v_numeric)
    ));
  elsif v_family = 'COUNT' then
    v_sync_items := jsonb_build_array(jsonb_build_object(
      'client_event_id',v_physical_event_prefix,'stream_id',v_stream.id::text,
      'occurred_at_utc',p_observed_at,'event_kind','FACT','ingestion_mode',v_ingestion_mode,
      'payload',jsonb_build_object('kind','COUNT','count_delta',v_count)
    ));
  elsif v_family = 'CATEGORICAL' then
    v_sync_items := jsonb_build_array(jsonb_build_object(
      'client_event_id',v_physical_event_prefix,'stream_id',v_stream.id::text,
      'occurred_at_utc',p_observed_at,'event_kind','FACT','ingestion_mode',v_ingestion_mode,
      'payload',jsonb_build_object('kind','CATEGORY','category_key',v_category)
    ));
  elsif v_family in ('DURATION','LATENCY','IRT') then
    v_sync_items := jsonb_build_array(jsonb_build_object(
      'client_event_id',v_physical_event_prefix,'stream_id',v_stream.id::text,
      'occurred_at_utc',v_interval_end,'event_kind','FACT','ingestion_mode',v_ingestion_mode,
      'payload',jsonb_build_object(
        'kind','TEMPORAL_INTERVAL','started_at',v_interval_start,'ended_at',v_interval_end,
        'is_censored',v_is_censored,
        'censor_reason',nullif(btrim(coalesce(p_measurement->>'censor_reason','')),'')
      )
    ));
  elsif v_family = 'RATE' then
    v_sync_items := jsonb_build_array(
      jsonb_build_object(
        'client_event_id',v_physical_event_prefix || ':window','stream_id',v_stream.id::text,
        'occurred_at_utc',v_interval_end,'event_kind','FACT','ingestion_mode',v_ingestion_mode,
        'payload',jsonb_build_object('kind','OBSERVATION_SLICE','started_at',v_interval_start,'ended_at',v_interval_end,'close_reason','COMPLETED')
      ),
      jsonb_build_object(
        'client_event_id',v_physical_event_prefix || ':count','stream_id',v_stream.id::text,
        'occurred_at_utc',v_interval_end,'event_kind','FACT','ingestion_mode',v_ingestion_mode,
        'payload',jsonb_build_object('kind','COUNT','count_delta',v_count)
      )
    );
  end if;

  select public.sync_clinical_measurements_bulk_v3(
    p_organization_id,p_patient_id,p_actor_membership_id,
    v_sync_batch_id,v_sync_items
  ) into v_sync_result;

  if not v_replayed then
    update public.clinical_measurement_collection_streams_v3
    set status = 'CLOSED'
    where id = v_stream.id;

    update public.clinical_measurement_sessions_v3
    set status = 'FINALIZED', ended_at = v_session_ended_at
    where id = v_session.id;
  end if;

  -- One affected expectation is recomputed synchronously so the next read sees
  -- the point without F5 or a queue worker. The dirty queue watermark is then
  -- acknowledged at its current generation; no unrelated expectation is read.
  perform public.recompute_clinical_measurement_projection_batch_v3(array[v_expectation.id], 'PLAN_WRITER');

  update public.clinical_measurement_projection_queue_v3 queue
  set processed_generation = queue.generation,
      status = 'DONE',
      processed_at = clock_timestamp(),
      processing_started_at = null,
      last_error = null
  where queue.expectation_id = v_expectation.id;

  select public.build_clinical_measurement_projection_snapshot_v3(v_expectation.id)
    into v_projection;

  return jsonb_build_object(
    'status', case when v_replayed then 'IDEMPOTENT_REPLAY' else 'ACCEPTED' end,
    'target_id', v_target.id,
    'definition_id', v_definition.id,
    'session_id', v_session.id,
    'expectation_id', v_expectation.id,
    'semantic_family', v_family,
    'sync', v_sync_result,
    'projection', v_projection
  );
end;
$function$;

revoke all on function public.write_clinical_plan_measurement_v3(
  uuid,uuid,uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,timestamptz,jsonb
) from public, anon, authenticated;
grant execute on function public.write_clinical_plan_measurement_v3(
  uuid,uuid,uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,timestamptz,jsonb
) to service_role;

-- Installation/security attestation. This is read-only and intentionally does
-- not create clinical evidence.
do $attest$
begin
  if to_regprocedure('public.write_clinical_plan_measurement_v3(uuid,uuid,uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,timestamp with time zone,jsonb)') is null then
    raise exception 'CMV3_GENERIC_PLAN_WRITER_MISSING';
  end if;
  if coalesce(pg_catalog.has_function_privilege(
      'anon',
      pg_catalog.to_regprocedure('public.write_clinical_plan_measurement_v3(uuid,uuid,uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,timestamp with time zone,jsonb)'),
      'EXECUTE'
    ),false)
    or coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      pg_catalog.to_regprocedure('public.write_clinical_plan_measurement_v3(uuid,uuid,uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,timestamp with time zone,jsonb)'),
      'EXECUTE'
    ),false) then
    raise exception 'CMV3_GENERIC_PLAN_WRITER_BROWSER_EXECUTE_OPEN';
  end if;
end;
$attest$;

commit;

select jsonb_build_object(
  'gate','CMV3_GENERIC_PLAN_WRITER_INSTALLED',
  'plan_goal_identities',(
    select count(*) from public.clinical_measurement_targets_v3 where source_kind='PLAN_GOAL'
  ),
  'therapeutic_objective_identities',(
    select count(*) from public.clinical_measurement_targets_v3 where source_kind='THERAPEUTIC_OBJECTIVE'
  ),
  'supported_families',jsonb_build_array('CONTINUOUS','COUNT','CATEGORICAL','RATE','DURATION','LATENCY','IRT'),
  'browser_execute',false,
  'legacy_clinical_rows_written',false,
  'next','CMV3_PLAN_READ_MODEL_BULK'
) as clinical_measurement_v3_generic_plan_writer;
