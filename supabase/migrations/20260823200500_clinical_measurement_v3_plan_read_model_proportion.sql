-- Clinical Measurement Engine V3 — bulk read model for PTS and specialty plans — PROPORTION convergence.
--
-- Marco 3 of PTS & Specialty convergence.
-- Exposes one service-only, set-based read contract over the typed CMV3 session
-- projections created by the canonical writer. It never reads raw events and never
-- falls back to legacy clinical_observations / ABA snapshot tables.
--
-- Performance / preservation rules:
--   * one RPC for a patient + bounded period + already-authorized plan/objective ids;
--   * joins only typed projection tables and immutable semantic metadata;
--   * no N+1 target loop;
--   * no clinical/source mutations;
--   * browser roles cannot execute the privileged bulk reader directly;
--   * historical target/definition versions remain readable even when no longer active.

begin;

create or replace function public.read_clinical_plan_outcomes_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_date_from date,
  p_date_to date,
  p_plan_ids uuid[],
  p_therapeutic_objective_ids uuid[],
  p_limit integer default 5000
)
returns table (
  organization_id uuid,
  patient_id uuid,
  target_id uuid,
  source_kind text,
  plan_id uuid,
  source_goal_key text,
  goal_id text,
  therapeutic_objective_id uuid,
  specialty text,
  target_status text,
  definition_id uuid,
  definition_version_id uuid,
  definition_version integer,
  metric_key text,
  metric_label text,
  semantic_family text,
  unit_code text,
  unit_label text,
  directionality text,
  expectation_id uuid,
  session_id uuid,
  clinical_date date,
  observed_at timestamptz,
  coverage_status text,
  value_number numeric,
  value_text text,
  numerator numeric,
  denominator numeric,
  canonical_value_unit text,
  value_details jsonb,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz,
  projection_queue_status text,
  projection_stale boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  if p_organization_id is null or p_patient_id is null then
    raise exception 'CMV3_PLAN_READ_SCOPE_REQUIRED';
  end if;

  if p_date_from is null or p_date_to is null
     or p_date_to < p_date_from
     or (p_date_to - p_date_from) > 730 then
    raise exception 'CMV3_PLAN_READ_PERIOD_INVALID';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'CMV3_PLAN_READ_LIMIT_INVALID';
  end if;

  if cardinality(coalesce(p_plan_ids, '{}'::uuid[])) > 250
     or cardinality(coalesce(p_therapeutic_objective_ids, '{}'::uuid[])) > 1000 then
    raise exception 'CMV3_PLAN_READ_SCOPE_TOO_LARGE';
  end if;

  -- Defense in depth: even service-role callers cannot read a patient from another clinic.
  if not exists (
    select 1
    from public.patients patient_row
    where patient_row.id = p_patient_id
      and patient_row.clinic_id::text = p_organization_id::text
  ) then
    raise exception 'CMV3_PLAN_READ_PATIENT_SCOPE_MISMATCH';
  end if;

  if cardinality(coalesce(p_plan_ids, '{}'::uuid[])) = 0
     and cardinality(coalesce(p_therapeutic_objective_ids, '{}'::uuid[])) = 0 then
    return;
  end if;

  return query
  with scoped_metadata as materialized (
    select
      target.organization_id,
      target.patient_id,
      target.id as target_id,
      target.source_kind,
      target.therapeutic_plan_id as plan_id,
      target.source_goal_key,
      case
        when target.source_kind = 'PLAN_GOAL'
             and target.source_goal_key like 'pts:%'
          then substring(target.source_goal_key from 5)
        when target.source_kind = 'PLAN_GOAL'
          then target.source_goal_key
        when target.source_kind = 'THERAPEUTIC_OBJECTIVE'
          then target.therapeutic_objective_id::text
        else null
      end as goal_id,
      target.therapeutic_objective_id,
      target.specialty,
      target.status as target_status,
      definition.id as definition_id,
      definition.definition_key,
      definition.semantic_family,
      version.id as definition_version_id,
      version.version as definition_version,
      version.unit_code,
      version.unit_label,
      version.directionality,
      coalesce(
        nullif(btrim(version.content #>> '{metric,key}'), ''),
        nullif(regexp_replace(definition.definition_key, '^plan_metric:', ''), ''),
        definition.definition_key
      ) as metric_key,
      coalesce(
        nullif(btrim(version.content #>> '{metric,label}'), ''),
        nullif(btrim(version.content #>> '{label}'), ''),
        nullif(regexp_replace(definition.definition_key, '^plan_metric:', ''), ''),
        definition.definition_key
      ) as metric_label
    from public.clinical_measurement_targets_v3 target
    join public.clinical_measurement_definitions_v3 definition
      on definition.organization_id = target.organization_id
     and definition.patient_id = target.patient_id
     and definition.target_id = target.id
    join public.clinical_measurement_definition_versions_v3 version
      on version.organization_id = definition.organization_id
     and version.patient_id = definition.patient_id
     and version.target_id = definition.target_id
     and version.definition_id = definition.id
    where target.organization_id = p_organization_id
      and target.patient_id = p_patient_id
      and target.source_kind in ('PLAN_GOAL', 'THERAPEUTIC_OBJECTIVE')
      and (
        (
          target.source_kind = 'PLAN_GOAL'
          and target.therapeutic_plan_id = any(coalesce(p_plan_ids, '{}'::uuid[]))
        )
        or (
          target.source_kind = 'THERAPEUTIC_OBJECTIVE'
          and target.therapeutic_objective_id = any(coalesce(p_therapeutic_objective_ids, '{}'::uuid[]))
        )
      )
  ),
  normalized as (
    select
      metadata.organization_id,
      metadata.patient_id,
      metadata.target_id,
      metadata.source_kind,
      metadata.plan_id,
      metadata.source_goal_key,
      metadata.goal_id,
      metadata.therapeutic_objective_id,
      metadata.specialty,
      metadata.target_status,
      metadata.definition_id,
      metadata.definition_version_id,
      metadata.definition_version,
      metadata.metric_key,
      metadata.metric_label,
      metadata.semantic_family,
      metadata.unit_code,
      metadata.unit_label,
      metadata.directionality,
      summary.expectation_id,
      summary.session_id,
      summary.clinical_date,
      coalesce(summary.source_latest_occurred_at, session_row.started_at) as observed_at,
      summary.coverage_status,
      summary.latest_value::numeric as value_number,
      null::text as value_text,
      null::numeric as numerator,
      null::numeric as denominator,
      coalesce(nullif(metadata.unit_code, ''), nullif(metadata.unit_label, ''), 'VALUE') as canonical_value_unit,
      jsonb_strip_nulls(jsonb_build_object(
        'observation_count', summary.observation_count,
        'mean_value', summary.mean_value,
        'min_value', summary.min_value,
        'max_value', summary.max_value
      )) as value_details,
      summary.source_latest_recorded_at,
      summary.computed_at,
      queue.status as projection_queue_status,
      coalesce(
        queue.status in ('PENDING', 'PROCESSING', 'FAILED')
        or queue.generation > queue.processed_generation,
        false
      ) as projection_stale
    from scoped_metadata metadata
    join public.clinical_measurement_session_continuous_summaries_v3 summary
      on summary.organization_id = metadata.organization_id
     and summary.patient_id = metadata.patient_id
     and summary.target_id = metadata.target_id
     and summary.definition_version_id = metadata.definition_version_id
    join public.clinical_measurement_sessions_v3 session_row
      on session_row.id = summary.session_id
     and session_row.organization_id = summary.organization_id
     and session_row.patient_id = summary.patient_id
    left join public.clinical_measurement_projection_queue_v3 queue
      on queue.expectation_id = summary.expectation_id
    where metadata.semantic_family = 'CONTINUOUS'
      and summary.clinical_date between p_date_from and p_date_to

    union all

    select
      metadata.organization_id, metadata.patient_id, metadata.target_id, metadata.source_kind,
      metadata.plan_id, metadata.source_goal_key, metadata.goal_id, metadata.therapeutic_objective_id,
      metadata.specialty, metadata.target_status, metadata.definition_id, metadata.definition_version_id,
      metadata.definition_version, metadata.metric_key, metadata.metric_label, metadata.semantic_family,
      metadata.unit_code, metadata.unit_label, metadata.directionality, summary.expectation_id, summary.session_id,
      summary.clinical_date, coalesce(summary.source_latest_occurred_at, session_row.started_at) as observed_at,
      summary.coverage_status,
      case when summary.projection_status='READY' then summary.percent_value::numeric else null end as value_number,
      null::text as value_text, summary.numerator::numeric as numerator, summary.denominator::numeric as denominator,
      'PERCENT'::text as canonical_value_unit,
      jsonb_strip_nulls(jsonb_build_object(
        'projection_status',summary.projection_status,
        'source_kind',summary.source_kind,
        'numerator',summary.numerator,
        'denominator',summary.denominator,
        'percent_value',summary.percent_value,
        'no_eligible_opportunity_count',summary.no_eligible_opportunity_count
      )) as value_details,
      summary.source_latest_recorded_at, summary.computed_at, queue.status as projection_queue_status,
      coalesce(queue.status in ('PENDING','PROCESSING','FAILED') or queue.generation > queue.processed_generation,false) as projection_stale
    from scoped_metadata metadata
    join public.clinical_measurement_session_proportion_summaries_v3 summary
      on summary.organization_id=metadata.organization_id
     and summary.patient_id=metadata.patient_id
     and summary.target_id=metadata.target_id
     and summary.definition_version_id=metadata.definition_version_id
    join public.clinical_measurement_sessions_v3 session_row
      on session_row.id=summary.session_id
     and session_row.organization_id=summary.organization_id
     and session_row.patient_id=summary.patient_id
    left join public.clinical_measurement_projection_queue_v3 queue on queue.expectation_id=summary.expectation_id
    where metadata.semantic_family='PROPORTION'
      and summary.clinical_date between p_date_from and p_date_to

    union all

    select
      metadata.organization_id,
      metadata.patient_id,
      metadata.target_id,
      metadata.source_kind,
      metadata.plan_id,
      metadata.source_goal_key,
      metadata.goal_id,
      metadata.therapeutic_objective_id,
      metadata.specialty,
      metadata.target_status,
      metadata.definition_id,
      metadata.definition_version_id,
      metadata.definition_version,
      metadata.metric_key,
      metadata.metric_label,
      metadata.semantic_family,
      metadata.unit_code,
      metadata.unit_label,
      metadata.directionality,
      summary.expectation_id,
      summary.session_id,
      summary.clinical_date,
      coalesce(summary.source_latest_occurred_at, session_row.started_at) as observed_at,
      summary.coverage_status,
      summary.total_count::numeric as value_number,
      null::text as value_text,
      null::numeric as numerator,
      null::numeric as denominator,
      coalesce(nullif(metadata.unit_code, ''), nullif(metadata.unit_label, ''), 'COUNT') as canonical_value_unit,
      jsonb_build_object('total_count', summary.total_count) as value_details,
      summary.source_latest_recorded_at,
      summary.computed_at,
      queue.status as projection_queue_status,
      coalesce(
        queue.status in ('PENDING', 'PROCESSING', 'FAILED')
        or queue.generation > queue.processed_generation,
        false
      ) as projection_stale
    from scoped_metadata metadata
    join public.clinical_measurement_session_count_summaries_v3 summary
      on summary.organization_id = metadata.organization_id
     and summary.patient_id = metadata.patient_id
     and summary.target_id = metadata.target_id
     and summary.definition_version_id = metadata.definition_version_id
    join public.clinical_measurement_sessions_v3 session_row
      on session_row.id = summary.session_id
     and session_row.organization_id = summary.organization_id
     and session_row.patient_id = summary.patient_id
    left join public.clinical_measurement_projection_queue_v3 queue
      on queue.expectation_id = summary.expectation_id
    where metadata.semantic_family = 'COUNT'
      and summary.clinical_date between p_date_from and p_date_to

    union all

    select
      metadata.organization_id,
      metadata.patient_id,
      metadata.target_id,
      metadata.source_kind,
      metadata.plan_id,
      metadata.source_goal_key,
      metadata.goal_id,
      metadata.therapeutic_objective_id,
      metadata.specialty,
      metadata.target_status,
      metadata.definition_id,
      metadata.definition_version_id,
      metadata.definition_version,
      metadata.metric_key,
      metadata.metric_label,
      metadata.semantic_family,
      metadata.unit_code,
      metadata.unit_label,
      metadata.directionality,
      summary.expectation_id,
      summary.session_id,
      summary.clinical_date,
      coalesce(summary.source_latest_occurred_at, session_row.started_at) as observed_at,
      summary.coverage_status,
      summary.rate_per_hour::numeric as value_number,
      null::text as value_text,
      summary.event_count::numeric as numerator,
      null::numeric as denominator,
      'EVENTS_PER_HOUR'::text as canonical_value_unit,
      jsonb_build_object(
        'event_count', summary.event_count,
        'observation_duration_ms', summary.observation_duration_ms,
        'rate_per_hour', summary.rate_per_hour
      ) as value_details,
      summary.source_latest_recorded_at,
      summary.computed_at,
      queue.status as projection_queue_status,
      coalesce(
        queue.status in ('PENDING', 'PROCESSING', 'FAILED')
        or queue.generation > queue.processed_generation,
        false
      ) as projection_stale
    from scoped_metadata metadata
    join public.clinical_measurement_session_rate_summaries_v3 summary
      on summary.organization_id = metadata.organization_id
     and summary.patient_id = metadata.patient_id
     and summary.target_id = metadata.target_id
     and summary.definition_version_id = metadata.definition_version_id
    join public.clinical_measurement_sessions_v3 session_row
      on session_row.id = summary.session_id
     and session_row.organization_id = summary.organization_id
     and session_row.patient_id = summary.patient_id
    left join public.clinical_measurement_projection_queue_v3 queue
      on queue.expectation_id = summary.expectation_id
    where metadata.semantic_family = 'RATE'
      and summary.clinical_date between p_date_from and p_date_to

    union all

    select
      metadata.organization_id,
      metadata.patient_id,
      metadata.target_id,
      metadata.source_kind,
      metadata.plan_id,
      metadata.source_goal_key,
      metadata.goal_id,
      metadata.therapeutic_objective_id,
      metadata.specialty,
      metadata.target_status,
      metadata.definition_id,
      metadata.definition_version_id,
      metadata.definition_version,
      metadata.metric_key,
      metadata.metric_label,
      metadata.semantic_family,
      metadata.unit_code,
      metadata.unit_label,
      metadata.directionality,
      summary.expectation_id,
      summary.session_id,
      summary.clinical_date,
      coalesce(summary.source_latest_occurred_at, session_row.started_at) as observed_at,
      summary.coverage_status,
      summary.mean_duration_ms::numeric as value_number,
      null::text as value_text,
      summary.occurrence_count::numeric as numerator,
      null::numeric as denominator,
      'MILLISECOND'::text as canonical_value_unit,
      jsonb_build_object(
        'occurrence_count', summary.occurrence_count,
        'censored_count', summary.censored_count,
        'total_duration_ms', summary.total_duration_ms,
        'mean_duration_ms', summary.mean_duration_ms,
        'min_duration_ms', summary.min_duration_ms,
        'max_duration_ms', summary.max_duration_ms
      ) as value_details,
      summary.source_latest_recorded_at,
      summary.computed_at,
      queue.status as projection_queue_status,
      coalesce(
        queue.status in ('PENDING', 'PROCESSING', 'FAILED')
        or queue.generation > queue.processed_generation,
        false
      ) as projection_stale
    from scoped_metadata metadata
    join public.clinical_measurement_session_temporal_summaries_v3 summary
      on summary.organization_id = metadata.organization_id
     and summary.patient_id = metadata.patient_id
     and summary.target_id = metadata.target_id
     and summary.definition_version_id = metadata.definition_version_id
     and summary.semantic_family = metadata.semantic_family
    join public.clinical_measurement_sessions_v3 session_row
      on session_row.id = summary.session_id
     and session_row.organization_id = summary.organization_id
     and session_row.patient_id = summary.patient_id
    left join public.clinical_measurement_projection_queue_v3 queue
      on queue.expectation_id = summary.expectation_id
    where metadata.semantic_family in ('DURATION', 'LATENCY', 'IRT')
      and summary.clinical_date between p_date_from and p_date_to

    union all

    select
      metadata.organization_id,
      metadata.patient_id,
      metadata.target_id,
      metadata.source_kind,
      metadata.plan_id,
      metadata.source_goal_key,
      metadata.goal_id,
      metadata.therapeutic_objective_id,
      metadata.specialty,
      metadata.target_status,
      metadata.definition_id,
      metadata.definition_version_id,
      metadata.definition_version,
      metadata.metric_key,
      metadata.metric_label,
      metadata.semantic_family,
      metadata.unit_code,
      metadata.unit_label,
      metadata.directionality,
      summary.expectation_id,
      summary.session_id,
      summary.clinical_date,
      coalesce(summary.source_latest_occurred_at, session_row.started_at) as observed_at,
      summary.coverage_status,
      null::numeric as value_number,
      category.category_key as value_text,
      null::numeric as numerator,
      null::numeric as denominator,
      'CATEGORY'::text as canonical_value_unit,
      jsonb_strip_nulls(jsonb_build_object(
        'observation_count', summary.observation_count,
        'category_breakdown', category.breakdown
      )) as value_details,
      summary.source_latest_recorded_at,
      summary.computed_at,
      queue.status as projection_queue_status,
      coalesce(
        queue.status in ('PENDING', 'PROCESSING', 'FAILED')
        or queue.generation > queue.processed_generation,
        false
      ) as projection_stale
    from scoped_metadata metadata
    join public.clinical_measurement_session_categorical_summaries_v3 summary
      on summary.organization_id = metadata.organization_id
     and summary.patient_id = metadata.patient_id
     and summary.target_id = metadata.target_id
     and summary.definition_version_id = metadata.definition_version_id
    join public.clinical_measurement_sessions_v3 session_row
      on session_row.id = summary.session_id
     and session_row.organization_id = summary.organization_id
     and session_row.patient_id = summary.patient_id
    left join public.clinical_measurement_projection_queue_v3 queue
      on queue.expectation_id = summary.expectation_id
    left join lateral (
      select
        case when count(*) = 1 then max(breakdown.category_key) else null end as category_key,
        jsonb_object_agg(breakdown.category_key, breakdown.occurrence_count order by breakdown.category_key) as breakdown
      from public.clinical_measurement_session_category_breakdown_v3 breakdown
      where breakdown.expectation_id = summary.expectation_id
        and breakdown.category_domain = 'CATEGORICAL'
    ) category on true
    where metadata.semantic_family = 'CATEGORICAL'
      and summary.clinical_date between p_date_from and p_date_to
  )
  select
    normalized.organization_id,
    normalized.patient_id,
    normalized.target_id,
    normalized.source_kind,
    normalized.plan_id,
    normalized.source_goal_key,
    normalized.goal_id,
    normalized.therapeutic_objective_id,
    normalized.specialty,
    normalized.target_status,
    normalized.definition_id,
    normalized.definition_version_id,
    normalized.definition_version,
    normalized.metric_key,
    normalized.metric_label,
    normalized.semantic_family,
    normalized.unit_code,
    normalized.unit_label,
    normalized.directionality,
    normalized.expectation_id,
    normalized.session_id,
    normalized.clinical_date,
    normalized.observed_at,
    normalized.coverage_status,
    normalized.value_number,
    normalized.value_text,
    normalized.numerator,
    normalized.denominator,
    normalized.canonical_value_unit,
    normalized.value_details,
    normalized.source_latest_recorded_at,
    normalized.computed_at,
    normalized.projection_queue_status,
    normalized.projection_stale
  from normalized
  order by
    normalized.clinical_date asc,
    normalized.observed_at asc nulls last,
    normalized.target_id,
    normalized.definition_version,
    normalized.expectation_id
  limit p_limit;
end;
$function$;

revoke all on function public.read_clinical_plan_outcomes_v3(
  uuid,
  uuid,
  date,
  date,
  uuid[],
  uuid[],
  integer
) from public, anon, authenticated;

grant execute on function public.read_clinical_plan_outcomes_v3(
  uuid,
  uuid,
  date,
  date,
  uuid[],
  uuid[],
  integer
) to service_role;

-- Installation/security attestation. This is metadata-only and writes no evidence.
do $attest$
begin
  if to_regprocedure(
    'public.read_clinical_plan_outcomes_v3(uuid,uuid,date,date,uuid[],uuid[],integer)'
  ) is null then
    raise exception 'CMV3_PLAN_READ_MODEL_BULK_MISSING';
  end if;

  if coalesce(
       pg_catalog.has_function_privilege(
         'anon',
         pg_catalog.to_regprocedure(
           'public.read_clinical_plan_outcomes_v3(uuid,uuid,date,date,uuid[],uuid[],integer)'
         ),
         'EXECUTE'
       ),
       false
     )
     or coalesce(
       pg_catalog.has_function_privilege(
         'authenticated',
         pg_catalog.to_regprocedure(
           'public.read_clinical_plan_outcomes_v3(uuid,uuid,date,date,uuid[],uuid[],integer)'
         ),
         'EXECUTE'
       ),
       false
     ) then
    raise exception 'CMV3_PLAN_READ_MODEL_BROWSER_EXECUTE_OPEN';
  end if;
end;
$attest$;

commit;

select jsonb_build_object(
  'gate', 'CMV3_PLAN_READ_MODEL_BULK_INSTALLED',
  'reader', 'read_clinical_plan_outcomes_v3',
  'source', 'CMV3_TYPED_SESSION_PROJECTIONS',
  'raw_events_read', false,
  'legacy_clinical_rows_read', false,
  'browser_execute', false,
  'max_period_days', 730,
  'max_rows', 5000,
  'plan_goal_identities', (
    select count(*)
    from public.clinical_measurement_targets_v3
    where source_kind = 'PLAN_GOAL'
  ),
  'therapeutic_objective_identities', (
    select count(*)
    from public.clinical_measurement_targets_v3
    where source_kind = 'THERAPEUTIC_OBJECTIVE'
  ),
  'next', 'CMV3_CLINICAL_OUTCOMES_DASHBOARD_CONVERGENCE'
) as clinical_measurement_v3_plan_read_model_bulk;
