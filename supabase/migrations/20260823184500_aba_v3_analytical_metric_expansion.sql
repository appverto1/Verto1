-- ABA / Clinical Measurement V3 — canonical analytical metric expansion.
--
-- Completes the server-side read model needed by the simplified analytics UX:
--   * skills: primary independence, final completion accuracy, effective trial volume;
--   * behaviors: frequency, rate/hour, duration episode count, total duration,
--     weighted average completed duration, interval occurrence;
--   * maintenance remains phase/version bounded.
--
-- Clinical semantics:
--   * FINAL_COMPLETION_ACCURACY_PERCENT = final correct completions / effective trials.
--     This intentionally includes supported completion and is NOT independence.
--   * EFFECTIVE_TRIAL_COUNT is collection volume and has NO_DIRECTIONAL_JUDGMENT.
--   * average duration excludes right-censored and still-open episodes from its denominator.
--   * duration total/average carry requires_review when censored/open episodes exist.
--   * all ratios are derived from server-side canonical counts; browser math is not authority.
--
-- Read-model/schema only. No raw trial, behavior event, clinical state, rollout state,
-- plan, session or legacy V2 row is mutated.

begin;

create or replace view public.aba_target_chart_points_v3
with (security_invoker = true)
as
select
  read_row.organization_id,
  read_row.patient_id,
  read_row.target_id,
  read_row.target_name,
  'V3'::text as measurement_model_version,
  read_row.phase_assignment_id,
  read_row.phase_type,
  read_row.phase_label,
  'PRIMARY_INDEPENDENCE_PERCENT'::text as metric_key,
  'Independência primária'::text as metric_label,
  'percent'::text as unit,
  ('dtt:' || read_row.target_id)::text as series_key,
  read_row.target_name::text as series_label,
  'DTT_NET_PROBE'::text as source_family,
  read_row.session_id::text as source_id,
  read_row.session_id,
  read_row.session_started_at as occurred_at,
  read_row.primary_independence_percent::numeric as value,
  read_row.primary_independent_correct_count::numeric as numerator,
  read_row.eligible_independent_opportunity_count::numeric as denominator,
  false as requires_review
from public.aba_session_target_read_v3 read_row
where read_row.primary_independence_percent is not null

union all

select
  read_row.organization_id,
  read_row.patient_id,
  read_row.target_id,
  read_row.target_name,
  'V3'::text,
  read_row.phase_assignment_id,
  read_row.phase_type,
  read_row.phase_label,
  'FINAL_COMPLETION_ACCURACY_PERCENT'::text,
  'Acurácia final'::text,
  'percent'::text,
  ('dtt:' || read_row.target_id)::text,
  read_row.target_name::text,
  'DTT_NET_PROBE'::text,
  read_row.session_id::text,
  read_row.session_id,
  read_row.session_started_at,
  round((summary.final_completion_correct_count::numeric * 100.0) / nullif(read_row.effective_trial_count::numeric, 0), 4),
  summary.final_completion_correct_count::numeric,
  read_row.effective_trial_count::numeric,
  false
from public.aba_session_target_read_v3 read_row
join public.aba_session_target_summaries_v3 summary
  on summary.organization_id = read_row.organization_id
 and summary.patient_id = read_row.patient_id
 and summary.session_id = read_row.session_id
 and summary.target_id = read_row.target_id
 and summary.target_phase_assignment_id = read_row.phase_assignment_id
where read_row.effective_trial_count > 0

union all

select
  read_row.organization_id,
  read_row.patient_id,
  read_row.target_id,
  read_row.target_name,
  'V3'::text,
  read_row.phase_assignment_id,
  read_row.phase_type,
  read_row.phase_label,
  'EFFECTIVE_TRIAL_COUNT'::text,
  'Tentativas registradas'::text,
  'count'::text,
  ('dtt:' || read_row.target_id)::text,
  read_row.target_name::text,
  'DTT_NET_PROBE'::text,
  read_row.session_id::text,
  read_row.session_id,
  read_row.session_started_at,
  read_row.effective_trial_count::numeric,
  read_row.effective_trial_count::numeric,
  null::numeric,
  false
from public.aba_session_target_read_v3 read_row
where read_row.effective_trial_count > 0

union all

select
  read_row.organization_id,
  read_row.patient_id,
  read_row.target_id,
  read_row.target_name,
  'V3'::text,
  read_row.phase_assignment_id,
  read_row.phase_type,
  read_row.phase_label,
  'TASK_INDEPENDENT_STEPS_PERCENT'::text,
  'Passos independentes'::text,
  'percent'::text,
  ('task:' || read_row.target_id)::text,
  read_row.target_name::text,
  'TASK_ANALYSIS'::text,
  read_row.session_id::text,
  read_row.session_id,
  read_row.session_started_at,
  read_row.independent_steps_percent::numeric,
  read_row.independent_step_count::numeric,
  read_row.eligible_step_count::numeric,
  false
from public.aba_session_task_analysis_read_v3 read_row
where read_row.independent_steps_percent is not null

union all

select
  read_row.organization_id,
  read_row.patient_id,
  read_row.target_id,
  read_row.target_name,
  'V3'::text,
  read_row.phase_assignment_id,
  read_row.phase_type,
  read_row.phase_label,
  'MAINTENANCE_PRIMARY_INDEPENDENCE_PERCENT'::text,
  'Sondagem de manutenção'::text,
  'percent'::text,
  ('maintenance:' || read_row.target_id)::text,
  read_row.target_name::text,
  'MAINTENANCE_PROBE'::text,
  read_row.probe_id::text,
  read_row.session_id,
  read_row.session_started_at,
  read_row.primary_independence_percent::numeric,
  read_row.primary_correct_count::numeric,
  read_row.eligible_trial_count::numeric,
  read_row.requires_review
from public.aba_maintenance_probe_read_v3 read_row
where read_row.primary_independence_percent is not null

union all

select
  summary.organization_id,
  summary.patient_id,
  behavior_binding.target_id,
  target.name as target_name,
  'V3'::text,
  target_binding.target_phase_assignment_id,
  phase.phase_type,
  phase.label as phase_label,
  metric.metric_key,
  metric.metric_label,
  metric.unit,
  ('behavior:' || summary.behavior_id || ':' || summary.context_id::text || ':' || metric.metric_key)::text,
  (summary.behavior_name || ' · ' || summary.context_label)::text,
  'BEHAVIOR'::text,
  (summary.session_id || ':' || summary.behavior_id || ':' || summary.context_id::text || ':' || metric.metric_key)::text,
  summary.session_id,
  summary.session_started_at,
  metric.value,
  metric.numerator,
  metric.denominator,
  metric.requires_review
from public.aba_session_behavior_read_v3 summary
join public.aba_session_behavior_collection_bindings_v3 behavior_binding
  on behavior_binding.organization_id = summary.organization_id
 and behavior_binding.patient_id = summary.patient_id
 and behavior_binding.session_id = summary.session_id
 and behavior_binding.behavior_id = summary.behavior_id
 and behavior_binding.measurement_model_version = 'V3'
join public.aba_session_target_measurement_bindings target_binding
  on target_binding.id = behavior_binding.session_target_measurement_binding_id
 and target_binding.organization_id = summary.organization_id
 and target_binding.patient_id = summary.patient_id
 and target_binding.session_id = summary.session_id
 and target_binding.target_id = behavior_binding.target_id
 and target_binding.measurement_model_version = 'V3'
join public.aba_targets target
  on target.id = behavior_binding.target_id
 and target.patient_id = summary.patient_id
 and target.clinic_id = summary.organization_id::text
join public.aba_target_phase_assignments_v3 phase
  on phase.id = target_binding.target_phase_assignment_id
cross join lateral (
  values
    ('BEHAVIOR_FREQUENCY_COUNT'::text, 'Frequência'::text, 'count'::text,
      summary.frequency_count::numeric, summary.frequency_count::numeric, null::numeric, false),
    ('BEHAVIOR_RATE_PER_HOUR'::text, 'Taxa por hora'::text, 'rate_per_hour'::text,
      summary.rate_per_hour::numeric, summary.frequency_count::numeric,
      case when summary.active_observation_seconds > 0 then summary.active_observation_seconds::numeric else null::numeric end,
      false),
    ('BEHAVIOR_DURATION_EPISODES'::text, 'Episódios de duração'::text, 'count'::text,
      summary.duration_episode_count::numeric, summary.duration_episode_count::numeric, null::numeric, false),
    ('BEHAVIOR_DURATION_SECONDS'::text, 'Duração total'::text, 'seconds'::text,
      summary.completed_duration_seconds::numeric, summary.completed_duration_seconds::numeric, null::numeric,
      (summary.censored_duration_count > 0 or summary.open_duration_count > 0)),
    ('BEHAVIOR_DURATION_AVG'::text, 'Duração média'::text, 'seconds'::text,
      case
        when greatest(summary.duration_episode_count - summary.censored_duration_count - summary.open_duration_count, 0) > 0
          then round(
            summary.completed_duration_seconds::numeric
            / greatest(summary.duration_episode_count - summary.censored_duration_count - summary.open_duration_count, 0)::numeric,
            4
          )
        else null::numeric
      end,
      summary.completed_duration_seconds::numeric,
      case
        when greatest(summary.duration_episode_count - summary.censored_duration_count - summary.open_duration_count, 0) > 0
          then greatest(summary.duration_episode_count - summary.censored_duration_count - summary.open_duration_count, 0)::numeric
        else null::numeric
      end,
      (summary.censored_duration_count > 0 or summary.open_duration_count > 0))
) metric(metric_key, metric_label, unit, value, numerator, denominator, requires_review)
where metric.value is not null
  and (
    (metric.metric_key = 'BEHAVIOR_FREQUENCY_COUNT' and summary.configured_measurement_type = 'frequency')
    or (metric.metric_key = 'BEHAVIOR_RATE_PER_HOUR' and summary.configured_measurement_type = 'rate')
    or (metric.metric_key in (
      'BEHAVIOR_DURATION_EPISODES',
      'BEHAVIOR_DURATION_SECONDS',
      'BEHAVIOR_DURATION_AVG'
    ) and summary.configured_measurement_type = 'duration')
  )

union all

select
  summary.organization_id,
  summary.patient_id,
  behavior_binding.target_id,
  target.name as target_name,
  'V3'::text,
  target_binding.target_phase_assignment_id,
  phase.phase_type,
  phase.label as phase_label,
  ('INTERVAL_OCCURRENCE_PERCENT_' || summary.measurement_method)::text,
  case summary.measurement_method
    when 'PARTIAL_INTERVAL' then 'Intervalo parcial'
    when 'WHOLE_INTERVAL' then 'Intervalo total'
    when 'MOMENTARY_TIME_SAMPLING' then 'Amostragem momentânea'
    else 'Intervalos'
  end::text,
  'percent'::text,
  ('interval:' || summary.behavior_id || ':' || summary.context_id::text || ':' || summary.measurement_method)::text,
  (summary.behavior_name || ' · ' || summary.context_label)::text,
  'INTERVAL'::text,
  summary.interval_run_id::text,
  summary.session_id,
  summary.session_started_at,
  summary.occurrence_percent::numeric,
  summary.occurred_intervals::numeric,
  summary.observed_intervals::numeric,
  false
from public.aba_session_interval_read_v3 summary
join public.aba_session_behavior_collection_bindings_v3 behavior_binding
  on behavior_binding.organization_id = summary.organization_id
 and behavior_binding.patient_id = summary.patient_id
 and behavior_binding.session_id = summary.session_id
 and behavior_binding.behavior_id = summary.behavior_id
 and behavior_binding.measurement_model_version = 'V3'
join public.aba_session_target_measurement_bindings target_binding
  on target_binding.id = behavior_binding.session_target_measurement_binding_id
 and target_binding.organization_id = summary.organization_id
 and target_binding.patient_id = summary.patient_id
 and target_binding.session_id = summary.session_id
 and target_binding.target_id = behavior_binding.target_id
 and target_binding.measurement_model_version = 'V3'
join public.aba_targets target
  on target.id = behavior_binding.target_id
 and target.patient_id = summary.patient_id
 and target.clinic_id = summary.organization_id::text
join public.aba_target_phase_assignments_v3 phase
  on phase.id = target_binding.target_phase_assignment_id
where summary.occurrence_percent is not null;



create or replace function public.get_aba_target_chart_series_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_target_id text,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '90 days');
  v_to timestamptz := coalesce(p_to, now());
  v_limit integer := greatest(1, least(coalesce(p_limit, 90), 180));
  v_target_name text;
begin
  if p_organization_id is null or p_patient_id is null
     or nullif(btrim(coalesce(p_target_id, '')), '') is null then
    raise exception 'ABA_V3_READ_SCOPE_REQUIRED';
  end if;
  if v_to < v_from or v_to - v_from > interval '366 days' then
    raise exception 'ABA_V3_READ_WINDOW_INVALID';
  end if;

  select target.name into v_target_name
  from public.aba_targets target
  where target.id = p_target_id
    and target.patient_id = p_patient_id
    and target.clinic_id = p_organization_id::text;
  if not found then raise exception 'ABA_V3_READ_TARGET_SCOPE_INVALID'; end if;

  return (
    with scoped as materialized (
      select point.*,
        row_number() over (
          partition by point.measurement_model_version, point.phase_assignment_id,
                       point.metric_key, point.series_key
          order by point.occurred_at desc, point.source_id desc
        ) as rn
      from public.aba_target_chart_points_v3 point
      where point.organization_id = p_organization_id
        and point.patient_id = p_patient_id
        and point.target_id = p_target_id
        and point.occurred_at >= v_from
        and point.occurred_at <= v_to
    ),
    bounded as materialized (
      select * from scoped where rn <= v_limit
    ),
    segment_keys as (
      select
        measurement_model_version,
        phase_assignment_id,
        phase_type,
        phase_label,
        metric_key,
        metric_label,
        unit,
        series_key,
        series_label,
        source_family,
        min(occurred_at) as segment_started_at,
        max(occurred_at) as segment_ended_at,
        count(*)::integer as point_count
      from bounded
      group by measurement_model_version, phase_assignment_id, phase_type, phase_label,
               metric_key, metric_label, unit, series_key, series_label, source_family
    )
    select jsonb_build_object(
      'target_id', p_target_id,
      'target_name', v_target_name,
      'from', v_from,
      'to', v_to,
      'limit_per_segment', v_limit,
      'continuity_policy', 'BREAK_ON_PHASE_OR_MODEL_CHANGE',
      'legacy_history_separate', true,
      'available_metrics', coalesce((
        select jsonb_agg(metric_row order by metric_priority, metric_row ->> 'label')
        from (
          select distinct
            jsonb_build_object(
              'key', bounded.metric_key,
              'label', bounded.metric_label,
              'unit', bounded.unit,
              'source_family', bounded.source_family
            ) as metric_row,
            case bounded.metric_key
              when 'PRIMARY_INDEPENDENCE_PERCENT' then 10
              when 'FINAL_COMPLETION_ACCURACY_PERCENT' then 20
              when 'EFFECTIVE_TRIAL_COUNT' then 30
              when 'TASK_INDEPENDENT_STEPS_PERCENT' then 40
              when 'BEHAVIOR_FREQUENCY_COUNT' then 50
              when 'BEHAVIOR_RATE_PER_HOUR' then 60
              when 'BEHAVIOR_DURATION_EPISODES' then 70
              when 'BEHAVIOR_DURATION_SECONDS' then 80
              when 'BEHAVIOR_DURATION_AVG' then 90
              when 'MAINTENANCE_PRIMARY_INDEPENDENCE_PERCENT' then 100
              else 200
            end as metric_priority
          from bounded
        ) metrics
      ), '[]'::jsonb),
      'segments', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'measurement_model_version', segment.measurement_model_version,
            'phase_assignment_id', segment.phase_assignment_id,
            'phase_type', segment.phase_type,
            'phase_label', segment.phase_label,
            'metric_key', segment.metric_key,
            'metric_label', segment.metric_label,
            'unit', segment.unit,
            'series_key', segment.series_key,
            'series_label', segment.series_label,
            'source_family', segment.source_family,
            'segment_started_at', segment.segment_started_at,
            'segment_ended_at', segment.segment_ended_at,
            'point_count', segment.point_count,
            'points', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'source_id', point.source_id,
                  'session_id', point.session_id,
                  'occurred_at', point.occurred_at,
                  'value', point.value,
                  'numerator', point.numerator,
                  'denominator', point.denominator,
                  'requires_review', point.requires_review
                ) order by point.occurred_at, point.source_id
              )
              from bounded point
              where point.measurement_model_version = segment.measurement_model_version
                and point.phase_assignment_id = segment.phase_assignment_id
                and point.metric_key = segment.metric_key
                and point.series_key = segment.series_key
            ), '[]'::jsonb)
          ) order by segment.segment_started_at, segment.metric_label, segment.series_label
        )
        from segment_keys segment
      ), '[]'::jsonb)
    )
  );
end;
$function$;



revoke all on public.aba_target_chart_points_v3 from public, anon, authenticated;
revoke all on function public.get_aba_target_chart_series_v3(
  uuid, uuid, text, timestamptz, timestamptz, integer
) from public, anon, authenticated;
grant select on public.aba_target_chart_points_v3 to service_role;
grant execute on function public.get_aba_target_chart_series_v3(
  uuid, uuid, text, timestamptz, timestamptz, integer
) to service_role;

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
        when point.metric_key = 'EFFECTIVE_TRIAL_COUNT' then 'NO_DIRECTIONAL_JUDGMENT'
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
     and plan.organization_id = point.organization_id::text
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
  'gate', 'ABA_V3_ANALYTICAL_METRIC_EXPANSION_INSTALLED',
  'skills', jsonb_build_array(
    'PRIMARY_INDEPENDENCE_PERCENT',
    'FINAL_COMPLETION_ACCURACY_PERCENT',
    'EFFECTIVE_TRIAL_COUNT'
  ),
  'behaviors', jsonb_build_array(
    'BEHAVIOR_FREQUENCY_COUNT',
    'BEHAVIOR_RATE_PER_HOUR',
    'BEHAVIOR_DURATION_EPISODES',
    'BEHAVIOR_DURATION_SECONDS',
    'BEHAVIOR_DURATION_AVG',
    'INTERVAL_OCCURRENCE_PERCENT_*'
  ),
  'trial_volume_directionality', 'NO_DIRECTIONAL_JUDGMENT',
  'duration_average_excludes_censored_open', true,
  'clinical_rows_written', false,
  'legacy_v2_mutated', false,
  'browser_execute', false
) as aba_v3_analytical_metric_expansion;
