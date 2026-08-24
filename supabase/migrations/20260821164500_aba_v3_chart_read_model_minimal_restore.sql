-- ABA V3 — minimal production restore for canonical chart read model.
--
-- Production preflight proved that all source dependencies exist while
-- public.aba_target_chart_points_v3 and get_aba_target_chart_series_v3 are absent.
-- This migration restores ONLY those two canonical chart objects from the
-- repository's PR10 definition. It does not alter rollout/enrollment state,
-- sessions, trials, bindings, source plans, or any clinical evidence.
--
-- Idempotent schema-only repair: safe to apply once through migrations and safe
-- to re-run manually while the canonical definitions remain unchanged.

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
  false
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
      summary.frequency_count::numeric, summary.frequency_count::numeric, null::numeric),
    ('BEHAVIOR_RATE_PER_HOUR'::text, 'Taxa por hora'::text, 'rate_per_hour'::text,
      summary.rate_per_hour::numeric, summary.frequency_count::numeric,
      case when summary.active_observation_seconds > 0 then summary.active_observation_seconds::numeric else null::numeric end),
    ('BEHAVIOR_DURATION_SECONDS'::text, 'Duração total'::text, 'seconds'::text,
      summary.completed_duration_seconds::numeric, summary.completed_duration_seconds::numeric,
      summary.duration_episode_count::numeric)
) metric(metric_key, metric_label, unit, value, numerator, denominator)
where metric.value is not null
  and (
    (metric.metric_key = 'BEHAVIOR_FREQUENCY_COUNT' and summary.configured_measurement_type = 'frequency')
    or (metric.metric_key = 'BEHAVIOR_RATE_PER_HOUR' and summary.configured_measurement_type = 'rate')
    or (metric.metric_key = 'BEHAVIOR_DURATION_SECONDS' and summary.configured_measurement_type = 'duration')
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
        select jsonb_agg(metric_row order by metric_row ->> 'label')
        from (
          select distinct jsonb_build_object(
            'key', bounded.metric_key,
            'label', bounded.metric_label,
            'unit', bounded.unit,
            'source_family', bounded.source_family
          ) as metric_row
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
  uuid,
  uuid,
  text,
  timestamptz,
  timestamptz,
  integer
) from public, anon, authenticated;

grant select on public.aba_target_chart_points_v3 to service_role;
grant execute on function public.get_aba_target_chart_series_v3(
  uuid,
  uuid,
  text,
  timestamptz,
  timestamptz,
  integer
) to service_role;

-- Metadata/security attestation only. No clinical rows are read or written here.
do $attest$
begin
  if to_regclass('public.aba_target_chart_points_v3') is null then
    raise exception 'ABA_V3_CHART_READ_MODEL_RESTORE_MISSING';
  end if;

  if to_regprocedure(
    'public.get_aba_target_chart_series_v3(uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)'
  ) is null then
    raise exception 'ABA_V3_CHART_SERIES_RPC_RESTORE_MISSING';
  end if;

  if coalesce(
       pg_catalog.has_table_privilege(
         'anon',
         'public.aba_target_chart_points_v3',
         'SELECT'
       ),
       false
     )
     or coalesce(
       pg_catalog.has_table_privilege(
         'authenticated',
         'public.aba_target_chart_points_v3',
         'SELECT'
       ),
       false
     ) then
    raise exception 'ABA_V3_CHART_READ_MODEL_BROWSER_SELECT_OPEN';
  end if;

  if coalesce(
       pg_catalog.has_function_privilege(
         'anon',
         pg_catalog.to_regprocedure(
           'public.get_aba_target_chart_series_v3(uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)'
         ),
         'EXECUTE'
       ),
       false
     )
     or coalesce(
       pg_catalog.has_function_privilege(
         'authenticated',
         pg_catalog.to_regprocedure(
           'public.get_aba_target_chart_series_v3(uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)'
         ),
         'EXECUTE'
       ),
       false
     ) then
    raise exception 'ABA_V3_CHART_SERIES_RPC_BROWSER_EXECUTE_OPEN';
  end if;
end;
$attest$;

commit;

select jsonb_build_object(
  'gate', 'ABA_V3_CHART_READ_MODEL_MINIMAL_RESTORE_INSTALLED',
  'aba_target_chart_points_v3',
    to_regclass('public.aba_target_chart_points_v3') is not null,
  'get_aba_patient_chart_catalog_v3',
    to_regprocedure(
      'public.get_aba_patient_chart_catalog_v3(uuid,uuid,timestamp with time zone,timestamp with time zone)'
    ) is not null,
  'get_aba_target_chart_series_v3',
    to_regprocedure(
      'public.get_aba_target_chart_series_v3(uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)'
    ) is not null,
  'browser_select', false,
  'browser_execute', false,
  'clinical_rows_written', false,
  'rollout_state_mutated', false,
  'next', 'RERUN_CMV3_MARCO4_DASHBOARD_CONVERGENCE'
) as aba_v3_chart_read_model_minimal_restore;
