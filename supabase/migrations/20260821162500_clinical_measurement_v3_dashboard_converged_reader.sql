-- Clinical Measurement Engine V3 — converged bulk reader for Clinical Outcomes.
--
-- Marco 4 of PTS & Specialty convergence.
-- The plan dashboard must not depend on a manual ABA shadow mirror. This reader
-- composes, in one service-only RPC, two canonical read-model sources:
--   1) generic CMV3 plan/objective typed session projections (Marco 3); and
--   2) the operational ABA V3 target chart read model used by Default-On sessions.
--
-- Preservation / performance rules:
--   * one bounded RPC per patient + period (no per-target N+1);
--   * no raw ABA V3 trials/events are read here;
--   * no legacy V2 snapshot/clinical_observation rows are read here;
--   * no clinical/source rows are written or mutated;
--   * exact visible plan/program/objective scopes are supplied by the server;
--   * browser roles cannot execute this privileged reader directly.

begin;

create or replace function public.read_clinical_outcomes_converged_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_date_from date,
  p_date_to date,
  p_plan_ids uuid[],
  p_therapeutic_objective_ids uuid[],
  p_program_ids text[],
  p_limit integer default 5000
)
returns table (
  organization_id uuid,
  patient_id uuid,
  target_id text,
  source_kind text,
  plan_id uuid,
  source_goal_key text,
  goal_id text,
  therapeutic_objective_id uuid,
  specialty text,
  target_status text,
  program_id text,
  item_id text,
  item_label text,
  definition_id text,
  definition_version_id text,
  definition_version integer,
  metric_key text,
  metric_label text,
  semantic_family text,
  unit_code text,
  unit_label text,
  directionality text,
  expectation_id text,
  session_id text,
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
  read_model_source text,
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
    raise exception 'CMV3_CONVERGED_READ_SCOPE_REQUIRED';
  end if;

  if p_date_from is null or p_date_to is null
     or p_date_to < p_date_from
     or (p_date_to - p_date_from) > 730 then
    raise exception 'CMV3_CONVERGED_READ_PERIOD_INVALID';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'CMV3_CONVERGED_READ_LIMIT_INVALID';
  end if;

  if cardinality(coalesce(p_plan_ids, '{}'::uuid[])) > 250
     or cardinality(coalesce(p_therapeutic_objective_ids, '{}'::uuid[])) > 1000
     or cardinality(coalesce(p_program_ids, '{}'::text[])) > 1000 then
    raise exception 'CMV3_CONVERGED_READ_SCOPE_TOO_LARGE';
  end if;

  -- Defense in depth: even service-role callers cannot cross the patient clinic.
  if not exists (
    select 1
    from public.patients patient_row
    where patient_row.id = p_patient_id
      and patient_row.clinic_id::text = p_organization_id::text
  ) then
    raise exception 'CMV3_CONVERGED_READ_PATIENT_SCOPE_MISMATCH';
  end if;

  if cardinality(coalesce(p_plan_ids, '{}'::uuid[])) = 0
     and cardinality(coalesce(p_therapeutic_objective_ids, '{}'::uuid[])) = 0
     and cardinality(coalesce(p_program_ids, '{}'::text[])) = 0 then
    return;
  end if;

  return query
  with generic_plan_rows as materialized (
    select
      generic.organization_id,
      generic.patient_id,
      generic.target_id::text as target_id,
      generic.source_kind,
      generic.plan_id,
      generic.source_goal_key,
      generic.goal_id,
      generic.therapeutic_objective_id,
      generic.specialty,
      generic.target_status,
      null::text as program_id,
      generic.target_id::text as item_id,
      generic.metric_label::text as item_label,
      generic.definition_id::text as definition_id,
      generic.definition_version_id::text as definition_version_id,
      generic.definition_version,
      generic.metric_key,
      generic.metric_label,
      generic.semantic_family,
      generic.unit_code,
      generic.unit_label,
      generic.directionality,
      generic.expectation_id::text as expectation_id,
      generic.session_id::text as session_id,
      generic.clinical_date,
      generic.observed_at,
      generic.coverage_status,
      generic.value_number,
      generic.value_text,
      generic.numerator,
      generic.denominator,
      generic.canonical_value_unit,
      generic.value_details,
      generic.source_latest_recorded_at,
      generic.computed_at,
      'CMV3_TYPED_SESSION_PROJECTION'::text as read_model_source,
      generic.projection_queue_status,
      generic.projection_stale
    from public.read_clinical_plan_outcomes_v3(
      p_organization_id,
      p_patient_id,
      p_date_from,
      p_date_to,
      coalesce(p_plan_ids, '{}'::uuid[]),
      coalesce(p_therapeutic_objective_ids, '{}'::uuid[]),
      p_limit
    ) generic
  ),
  aba_v3_rows as materialized (
    select
      point.organization_id,
      point.patient_id,
      point.target_id::text as target_id,
      'ABA_TARGET'::text as source_kind,
      plan.id as plan_id,
      ('aba_target:' || point.target_id)::text as source_goal_key,
      program.therapeutic_objective_id::text as goal_id,
      program.therapeutic_objective_id,
      plan.specialty::text as specialty,
      target.phase::text as target_status,
      program.id::text as program_id,
      (point.series_key || ':phase:' || coalesce(point.phase_assignment_id::text, 'none'))::text as item_id,
      coalesce(nullif(btrim(point.series_label), ''), nullif(btrim(point.target_name), ''), point.metric_label)::text as item_label,
      null::text as definition_id,
      null::text as definition_version_id,
      1::integer as definition_version,
      point.metric_key::text as metric_key,
      point.metric_label::text as metric_label,
      case lower(coalesce(point.unit, ''))
        when 'percent' then 'PROPORTION'
        when 'count' then 'COUNT'
        when 'rate_per_hour' then 'RATE'
        when 'seconds' then 'DURATION'
        else 'CONTINUOUS'
      end::text as semantic_family,
      point.unit::text as unit_code,
      case lower(coalesce(point.unit, ''))
        when 'percent' then '%'
        when 'count' then 'contagem'
        when 'rate_per_hour' then 'eventos/h'
        when 'seconds' then 's'
        else point.unit
      end::text as unit_label,
      case
        when point.source_family in ('BEHAVIOR', 'INTERVAL') then 'DECREASE_IS_BETTER'
        else 'INCREASE_IS_BETTER'
      end::text as directionality,
      ('aba-v3:' || point.source_id)::text as expectation_id,
      point.session_id::text as session_id,
      (point.occurred_at at time zone 'UTC')::date as clinical_date,
      point.occurred_at as observed_at,
      'OBSERVED'::text as coverage_status,
      point.value::numeric as value_number,
      null::text as value_text,
      point.numerator::numeric as numerator,
      point.denominator::numeric as denominator,
      case lower(coalesce(point.unit, ''))
        when 'percent' then 'PERCENT'
        when 'count' then 'COUNT'
        when 'rate_per_hour' then 'EVENTS_PER_HOUR'
        when 'seconds' then 'SECOND'
        else upper(coalesce(point.unit, 'VALUE'))
      end::text as canonical_value_unit,
      jsonb_strip_nulls(jsonb_build_object(
        'aba_target_id', point.target_id,
        'target_name', point.target_name,
        'measurement_model_version', point.measurement_model_version,
        'phase_assignment_id', point.phase_assignment_id,
        'phase_type', point.phase_type,
        'phase_label', point.phase_label,
        'series_key', point.series_key,
        'series_label', point.series_label,
        'source_family', point.source_family,
        'requires_review', point.requires_review
      )) as value_details,
      null::timestamptz as source_latest_recorded_at,
      null::timestamptz as computed_at,
      'ABA_V3_TARGET_CHART_READ_MODEL'::text as read_model_source,
      null::text as projection_queue_status,
      false as projection_stale
    from public.aba_target_chart_points_v3 point
    join public.aba_targets target
      on target.id = point.target_id
     and target.patient_id = point.patient_id
     and target.clinic_id = point.organization_id::text
    join public.aba_programs program
      on program.id = target.program_id
     and program.patient_id = point.patient_id
     and program.organization_id::text = point.organization_id::text
    join public.patient_therapeutic_plans plan
      on plan.id = program.therapeutic_plan_id
     and plan.patient_id = point.patient_id
     and plan.organization_id = point.organization_id
    where point.organization_id = p_organization_id
      and point.patient_id = p_patient_id
      and point.occurred_at >= p_date_from::timestamptz
      and point.occurred_at < (p_date_to + 1)::timestamptz
      and program.id = any(coalesce(p_program_ids, '{}'::text[]))
      and plan.id = any(coalesce(p_plan_ids, '{}'::uuid[]))
      and (
        program.therapeutic_objective_id is null
        or program.therapeutic_objective_id = any(coalesce(p_therapeutic_objective_ids, '{}'::uuid[]))
      )
  ),
  combined as (
    select * from generic_plan_rows
    union all
    select * from aba_v3_rows
  )
  select
    combined.organization_id,
    combined.patient_id,
    combined.target_id,
    combined.source_kind,
    combined.plan_id,
    combined.source_goal_key,
    combined.goal_id,
    combined.therapeutic_objective_id,
    combined.specialty,
    combined.target_status,
    combined.program_id,
    combined.item_id,
    combined.item_label,
    combined.definition_id,
    combined.definition_version_id,
    combined.definition_version,
    combined.metric_key,
    combined.metric_label,
    combined.semantic_family,
    combined.unit_code,
    combined.unit_label,
    combined.directionality,
    combined.expectation_id,
    combined.session_id,
    combined.clinical_date,
    combined.observed_at,
    combined.coverage_status,
    combined.value_number,
    combined.value_text,
    combined.numerator,
    combined.denominator,
    combined.canonical_value_unit,
    combined.value_details,
    combined.source_latest_recorded_at,
    combined.computed_at,
    combined.read_model_source,
    combined.projection_queue_status,
    combined.projection_stale
  from combined
  order by
    combined.clinical_date asc,
    combined.observed_at asc nulls last,
    combined.plan_id,
    combined.program_id nulls first,
    combined.item_id,
    combined.metric_key,
    combined.expectation_id
  limit p_limit;
end;
$function$;

revoke all on function public.read_clinical_outcomes_converged_v3(
  uuid,
  uuid,
  date,
  date,
  uuid[],
  uuid[],
  text[],
  integer
) from public, anon, authenticated;

grant execute on function public.read_clinical_outcomes_converged_v3(
  uuid,
  uuid,
  date,
  date,
  uuid[],
  uuid[],
  text[],
  integer
) to service_role;

-- Installation/security attestation. Metadata only; no clinical evidence is written.
do $attest$
begin
  if to_regprocedure(
    'public.read_clinical_outcomes_converged_v3(uuid,uuid,date,date,uuid[],uuid[],text[],integer)'
  ) is null then
    raise exception 'CMV3_CLINICAL_OUTCOMES_CONVERGED_READER_MISSING';
  end if;

  if to_regclass('public.aba_target_chart_points_v3') is null then
    raise exception 'CMV3_CLINICAL_OUTCOMES_ABA_V3_READ_MODEL_MISSING';
  end if;

  if to_regprocedure(
    'public.read_clinical_plan_outcomes_v3(uuid,uuid,date,date,uuid[],uuid[],integer)'
  ) is null then
    raise exception 'CMV3_CLINICAL_OUTCOMES_GENERIC_PLAN_READER_MISSING';
  end if;

  if coalesce(
       pg_catalog.has_function_privilege(
         'anon',
         pg_catalog.to_regprocedure(
           'public.read_clinical_outcomes_converged_v3(uuid,uuid,date,date,uuid[],uuid[],text[],integer)'
         ),
         'EXECUTE'
       ),
       false
     )
     or coalesce(
       pg_catalog.has_function_privilege(
         'authenticated',
         pg_catalog.to_regprocedure(
           'public.read_clinical_outcomes_converged_v3(uuid,uuid,date,date,uuid[],uuid[],text[],integer)'
         ),
         'EXECUTE'
       ),
       false
     ) then
    raise exception 'CMV3_CLINICAL_OUTCOMES_CONVERGED_READER_BROWSER_EXECUTE_OPEN';
  end if;
end;
$attest$;

commit;

select jsonb_build_object(
  'gate', 'CMV3_CLINICAL_OUTCOMES_DASHBOARD_CONVERGENCE_INSTALLED',
  'reader', 'read_clinical_outcomes_converged_v3',
  'generic_plan_source', 'CMV3_TYPED_SESSION_PROJECTION',
  'aba_v3_source', 'ABA_V3_TARGET_CHART_READ_MODEL',
  'aba_default_on_bridge', true,
  'single_bulk_rpc', true,
  'raw_aba_v3_events_read', false,
  'legacy_v2_rows_read', false,
  'clinical_rows_written', false,
  'browser_execute', false,
  'max_period_days', 730,
  'max_rows', 5000,
  'next', 'CMV3_PTS_SPECIALTY_PRODUCTION_SMOKE'
) as clinical_measurement_v3_dashboard_convergence;
