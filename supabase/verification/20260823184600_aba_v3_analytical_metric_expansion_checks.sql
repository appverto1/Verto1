-- ABA / Clinical Measurement V3 — analytical metric expansion checks.
-- READ ONLY: metadata/security + optional read-model inventory. No clinical row is changed.

with defs as (
  select
    lower(pg_catalog.pg_get_viewdef('public.aba_target_chart_points_v3'::regclass, true)) as chart_view_definition,
    lower(pg_catalog.pg_get_functiondef(
      'public.get_aba_target_chart_series_v3(uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)'::regprocedure
    )) as chart_rpc_definition,
    lower(pg_catalog.pg_get_functiondef(
      'public.read_clinical_outcomes_converged_v3(uuid,uuid,date,date,uuid[],uuid[],text[],integer)'::regprocedure
    )) as converged_rpc_definition
), observed_metric_keys as (
  select coalesce(jsonb_agg(metric_key order by metric_key), '[]'::jsonb) as keys
  from (
    select distinct point.metric_key
    from public.aba_target_chart_points_v3 point
  ) rows
), security as (
  select jsonb_build_object(
    'anon_chart_select', coalesce(pg_catalog.has_table_privilege('anon','public.aba_target_chart_points_v3','SELECT'), false),
    'authenticated_chart_select', coalesce(pg_catalog.has_table_privilege('authenticated','public.aba_target_chart_points_v3','SELECT'), false),
    'service_chart_select', coalesce(pg_catalog.has_table_privilege('service_role','public.aba_target_chart_points_v3','SELECT'), false),
    'anon_chart_rpc_execute', coalesce(pg_catalog.has_function_privilege(
      'anon',
      'public.get_aba_target_chart_series_v3(uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)',
      'EXECUTE'
    ), false),
    'authenticated_chart_rpc_execute', coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      'public.get_aba_target_chart_series_v3(uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)',
      'EXECUTE'
    ), false),
    'service_chart_rpc_execute', coalesce(pg_catalog.has_function_privilege(
      'service_role',
      'public.get_aba_target_chart_series_v3(uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)',
      'EXECUTE'
    ), false),
    'anon_converged_rpc_execute', coalesce(pg_catalog.has_function_privilege(
      'anon',
      'public.read_clinical_outcomes_converged_v3(uuid,uuid,date,date,uuid[],uuid[],text[],integer)',
      'EXECUTE'
    ), false),
    'authenticated_converged_rpc_execute', coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      'public.read_clinical_outcomes_converged_v3(uuid,uuid,date,date,uuid[],uuid[],text[],integer)',
      'EXECUTE'
    ), false),
    'service_converged_rpc_execute', coalesce(pg_catalog.has_function_privilege(
      'service_role',
      'public.read_clinical_outcomes_converged_v3(uuid,uuid,date,date,uuid[],uuid[],text[],integer)',
      'EXECUTE'
    ), false)
  ) as snapshot
), verdict as (
  select
    d.*,
    o.keys as observed_metric_keys,
    s.snapshot as security_snapshot,
    case
      when d.chart_view_definition not like '%final_completion_accuracy_percent%'
        then 'BLOCKED_FINAL_ACCURACY_METRIC_MISSING'
      when d.chart_view_definition not like '%effective_trial_count%'
        then 'BLOCKED_TRIAL_VOLUME_METRIC_MISSING'
      when d.chart_view_definition not like '%behavior_duration_episodes%'
        then 'BLOCKED_DURATION_EPISODE_METRIC_MISSING'
      when d.chart_view_definition not like '%behavior_duration_avg%'
        then 'BLOCKED_DURATION_AVG_METRIC_MISSING'
      when d.chart_view_definition not like '%censored_duration_count%'
        or d.chart_view_definition not like '%open_duration_count%'
        then 'BLOCKED_DURATION_CENSOR_SEMANTICS_MISSING'
      when d.converged_rpc_definition not like '%effective_trial_count%no_directional_judgment%'
        then 'BLOCKED_TRIAL_VOLUME_DIRECTIONALITY_INVALID'
      when (s.snapshot->>'anon_chart_select')::boolean
        or (s.snapshot->>'authenticated_chart_select')::boolean
        or (s.snapshot->>'anon_chart_rpc_execute')::boolean
        or (s.snapshot->>'authenticated_chart_rpc_execute')::boolean
        or (s.snapshot->>'anon_converged_rpc_execute')::boolean
        or (s.snapshot->>'authenticated_converged_rpc_execute')::boolean
        then 'BLOCKED_BROWSER_PRIVILEGE_OPEN'
      when not (s.snapshot->>'service_chart_select')::boolean
        or not (s.snapshot->>'service_chart_rpc_execute')::boolean
        or not (s.snapshot->>'service_converged_rpc_execute')::boolean
        then 'BLOCKED_SERVICE_ROLE_PRIVILEGE_MISSING'
      else 'PASS_ABA_V3_ANALYTICAL_METRIC_EXPANSION'
    end as gate
  from defs d
  cross join observed_metric_keys o
  cross join security s
)
select jsonb_build_object(
  'gate', gate,
  'writes', false,
  'canonical_skills', jsonb_build_array(
    'PRIMARY_INDEPENDENCE_PERCENT',
    'FINAL_COMPLETION_ACCURACY_PERCENT',
    'EFFECTIVE_TRIAL_COUNT'
  ),
  'canonical_behaviors', jsonb_build_array(
    'BEHAVIOR_FREQUENCY_COUNT',
    'BEHAVIOR_RATE_PER_HOUR',
    'BEHAVIOR_DURATION_EPISODES',
    'BEHAVIOR_DURATION_SECONDS',
    'BEHAVIOR_DURATION_AVG',
    'INTERVAL_OCCURRENCE_PERCENT_*'
  ),
  'observed_metric_keys', observed_metric_keys,
  'security', security_snapshot,
  'semantics', jsonb_build_object(
    'final_accuracy', 'final_completion_correct_count / effective_trial_count',
    'trial_volume_directionality', 'NO_DIRECTIONAL_JUDGMENT',
    'duration_average_denominator', 'completed episodes only; censored/open excluded',
    'date_bucket_rate', 'weighted by canonical observation seconds in application read layer',
    'date_bucket_duration_average', 'weighted by canonical completed episode count in application read layer'
  )
) as aba_v3_analytical_metric_expansion_checks
from verdict;
