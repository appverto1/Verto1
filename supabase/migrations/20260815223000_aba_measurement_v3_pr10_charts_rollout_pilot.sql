-- ABA Measurement V3 - PR10 segmented charts + guarded pilot rollout.
-- Additive/dark by default. Legacy V2 remains untouched and no rollout row is enabled here.

begin;

-- ---------------------------------------------------------------------------
-- ABC stays Legacy-only in the first V3 pilot. A new V3 behavior mapping must
-- never silently promote an ABC behavior into an unsupported semantic model.
-- ---------------------------------------------------------------------------
create or replace function public.validate_aba_behavior_target_binding_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_measurement_type text;
begin
  select lower(behavior.measurement_type)
    into v_measurement_type
  from public.aba_behavior_definitions behavior
  where behavior.id = new.behavior_id
    and behavior.patient_id = new.patient_id
    and behavior.clinic_id = new.organization_id::text;

  if not found then
    raise exception 'ABA_V3_BEHAVIOR_BINDING_BEHAVIOR_SCOPE_INVALID';
  end if;
  if v_measurement_type = 'abc' and new.status = 'ACTIVE' then
    raise exception 'ABA_V3_ABC_LEGACY_ONLY';
  end if;

  if not exists (
    select 1 from public.aba_targets target
    where target.id = new.target_id
      and target.patient_id = new.patient_id
      and target.clinic_id = new.organization_id::text
      and lower(target.target_type) = 'behavior'
  ) then
    raise exception 'ABA_V3_BEHAVIOR_BINDING_TARGET_SCOPE_INVALID';
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Canonical chart points. Each row has one clinical metric and one immutable
-- V3 phase. V2 is deliberately absent: the UI renders Legacy and V3 separately,
-- which guarantees a model-boundary break instead of joining unlike semantics.
-- ---------------------------------------------------------------------------
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

create or replace function public.get_aba_patient_chart_catalog_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '366 days');
  v_to timestamptz := coalesce(p_to, now());
begin
  if p_organization_id is null or p_patient_id is null then raise exception 'ABA_V3_READ_SCOPE_REQUIRED'; end if;
  if v_to < v_from or v_to - v_from > interval '366 days' then raise exception 'ABA_V3_READ_WINDOW_INVALID'; end if;
  if not exists (
    select 1 from public.patients patient
    where patient.id = p_patient_id and patient.clinic_id = p_organization_id::text
  ) then raise exception 'ABA_V3_READ_PATIENT_SCOPE_INVALID'; end if;

  return jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'targets', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'target_id', catalog.target_id,
          'target_name', catalog.target_name,
          'metric_count', catalog.metric_count,
          'point_count', catalog.point_count,
          'first_point_at', catalog.first_point_at,
          'last_point_at', catalog.last_point_at
        ) order by catalog.target_name, catalog.target_id
      )
      from (
        select
          point.target_id,
          max(point.target_name) as target_name,
          count(distinct point.metric_key)::integer as metric_count,
          count(*)::integer as point_count,
          min(point.occurred_at) as first_point_at,
          max(point.occurred_at) as last_point_at
        from public.aba_target_chart_points_v3 point
        where point.organization_id = p_organization_id
          and point.patient_id = p_patient_id
          and point.occurred_at >= v_from
          and point.occurred_at <= v_to
        group by point.target_id
      ) catalog
    ), '[]'::jsonb)
  );
end;
$function$;

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

-- ---------------------------------------------------------------------------
-- Pilot preflight: evaluates only the requested patient/program/target scope.
-- No rollout mutation happens here. Missing configuration is returned as blockers.
-- ---------------------------------------------------------------------------
create or replace function public.get_aba_v3_pilot_readiness(
  p_organization_id uuid,
  p_patient_id uuid,
  p_program_id text default null,
  p_target_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_target_count integer := 0;
  v_missing_definition integer := 0;
  v_missing_phase integer := 0;
  v_missing_task_steps integer := 0;
  v_abc_binding_count integer := 0;
  v_quarantine_count integer := 0;
  v_open_session_count integer := 0;
  v_blockers jsonb := '[]'::jsonb;
begin
  if p_organization_id is null or p_patient_id is null then
    raise exception 'ABA_V3_PILOT_SCOPE_REQUIRED';
  end if;
  if not exists (
    select 1 from public.patients patient
    where patient.id = p_patient_id
      and patient.clinic_id = p_organization_id::text
  ) then raise exception 'ABA_V3_PILOT_PATIENT_SCOPE_INVALID'; end if;

  with target_scope as (
    select target.*
    from public.aba_targets target
    where target.patient_id = p_patient_id
      and target.clinic_id = p_organization_id::text
      and (p_program_id is null or target.program_id = p_program_id)
      and (p_target_id is null or target.id = p_target_id)
  )
  select count(*)::integer into v_target_count from target_scope;

  if p_target_id is not null and v_target_count = 0 then
    raise exception 'ABA_V3_PILOT_TARGET_SCOPE_INVALID';
  end if;
  if p_program_id is not null and v_target_count = 0 then
    raise exception 'ABA_V3_PILOT_PROGRAM_SCOPE_EMPTY';
  end if;

  with target_scope as (
    select target.id
    from public.aba_targets target
    where target.patient_id = p_patient_id
      and target.clinic_id = p_organization_id::text
      and (p_program_id is null or target.program_id = p_program_id)
      and (p_target_id is null or target.id = p_target_id)
  )
  select count(*)::integer into v_missing_definition
  from target_scope target
  where not exists (
    select 1 from public.aba_collection_definition_versions_v3 definition
    where definition.organization_id = p_organization_id
      and definition.patient_id = p_patient_id
      and definition.target_id = target.id
      and definition.status = 'PUBLISHED'
      and definition.published_at <= now()
  );

  with target_scope as (
    select target.id
    from public.aba_targets target
    where target.patient_id = p_patient_id
      and target.clinic_id = p_organization_id::text
      and (p_program_id is null or target.program_id = p_program_id)
      and (p_target_id is null or target.id = p_target_id)
  )
  select count(*)::integer into v_missing_phase
  from target_scope target
  where not exists (
    select 1 from public.aba_target_phase_assignments_v3 phase
    where phase.organization_id = p_organization_id
      and phase.patient_id = p_patient_id
      and phase.target_id = target.id
      and phase.effective_from <= now()
      and (phase.effective_until is null or phase.effective_until > now())
  );

  with target_scope as (
    select target.id, lower(target.target_type) as target_type
    from public.aba_targets target
    where target.patient_id = p_patient_id
      and target.clinic_id = p_organization_id::text
      and (p_program_id is null or target.program_id = p_program_id)
      and (p_target_id is null or target.id = p_target_id)
  ), published_definition as (
    select distinct on (definition.target_id)
      definition.target_id, definition.id
    from public.aba_collection_definition_versions_v3 definition
    join target_scope target on target.id = definition.target_id
    where definition.organization_id = p_organization_id
      and definition.patient_id = p_patient_id
      and definition.status = 'PUBLISHED'
      and definition.published_at <= now()
    order by definition.target_id, definition.version desc
  )
  select count(*)::integer into v_missing_task_steps
  from target_scope target
  left join published_definition definition on definition.target_id = target.id
  where target.target_type = 'task_analysis'
    and (
      definition.id is null
      or not exists (
        select 1 from public.aba_task_analysis_step_definitions_v3 step
        where step.collection_definition_version_id = definition.id
      )
    );

  with target_scope as (
    select target.id
    from public.aba_targets target
    where target.patient_id = p_patient_id
      and target.clinic_id = p_organization_id::text
      and (p_program_id is null or target.program_id = p_program_id)
      and (p_target_id is null or target.id = p_target_id)
  )
  select count(*)::integer into v_abc_binding_count
  from public.aba_behavior_target_bindings_v3 binding
  join target_scope target on target.id = binding.target_id
  join public.aba_behavior_definitions behavior
    on behavior.id = binding.behavior_id
   and behavior.patient_id = binding.patient_id
   and behavior.clinic_id = binding.organization_id::text
  where binding.organization_id = p_organization_id
    and binding.patient_id = p_patient_id
    and binding.status = 'ACTIVE'
    and lower(behavior.measurement_type) = 'abc';

  select count(*)::integer into v_quarantine_count
  from public.aba_sync_quarantine_v3 quarantine
  left join public.aba_targets quarantine_target
    on quarantine_target.id = quarantine.target_id
   and quarantine_target.patient_id = quarantine.patient_id
   and quarantine_target.clinic_id = quarantine.organization_id::text
  where quarantine.organization_id = p_organization_id
    and quarantine.patient_id = p_patient_id
    and quarantine.status in ('OPEN','READY_FOR_RETRY')
    and (p_program_id is null or quarantine_target.program_id = p_program_id)
    and (p_target_id is null or quarantine.target_id = p_target_id);

  select count(*)::integer into v_open_session_count
  from public.aba_sessions session_row
  where session_row.patient_id = p_patient_id
    and session_row.clinic_id = p_organization_id::text
    and lower(coalesce(session_row.status,'')) in ('active','in_progress');

  if v_target_count = 0 then v_blockers := v_blockers || jsonb_build_array('NO_TARGETS_IN_SCOPE'); end if;
  if v_missing_definition > 0 then v_blockers := v_blockers || jsonb_build_array('MISSING_PUBLISHED_COLLECTION_DEFINITION'); end if;
  if v_missing_phase > 0 then v_blockers := v_blockers || jsonb_build_array('MISSING_ACTIVE_TARGET_PHASE'); end if;
  if v_missing_task_steps > 0 then v_blockers := v_blockers || jsonb_build_array('TASK_ANALYSIS_STEPS_MISSING'); end if;
  if v_abc_binding_count > 0 then v_blockers := v_blockers || jsonb_build_array('ABC_V3_MAPPING_FORBIDDEN'); end if;
  if v_quarantine_count > 0 then v_blockers := v_blockers || jsonb_build_array('UNRESOLVED_SYNC_QUARANTINE'); end if;

  return jsonb_build_object(
    'ready', jsonb_array_length(v_blockers) = 0,
    'patient_id', p_patient_id,
    'program_id', p_program_id,
    'target_id', p_target_id,
    'abc_policy', 'LEGACY_V2_ONLY_FIRST_PILOT',
    'counts', jsonb_build_object(
      'targets', v_target_count,
      'missing_published_definition', v_missing_definition,
      'missing_active_phase', v_missing_phase,
      'missing_task_analysis_steps', v_missing_task_steps,
      'abc_v3_bindings', v_abc_binding_count,
      'unresolved_sync_quarantine', v_quarantine_count,
      'open_sessions', v_open_session_count
    ),
    'blockers', v_blockers
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- The only supported operational rollout writer after PR10. Updates are
-- optimistic-lock protected and remain fully audited by the PR1/PR2 triggers.
-- Enabling PROGRAM/TARGET requires a clean pilot preflight in the same tx.
-- ---------------------------------------------------------------------------
create or replace function public.set_aba_measurement_rollout_state_v3(
  p_organization_id uuid,
  p_scope_type text,
  p_patient_id uuid default null,
  p_program_id text default null,
  p_target_id text default null,
  p_allow_new_v3_sessions boolean default false,
  p_accept_v3_sync boolean default false,
  p_reason text default null,
  p_actor_id uuid default null,
  p_expected_state_version bigint default null
)
returns public.aba_measurement_rollout_states_v3
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_scope text := upper(btrim(coalesce(p_scope_type,'')));
  v_reason text := btrim(coalesce(p_reason,''));
  v_existing public.aba_measurement_rollout_states_v3%rowtype;
  v_result public.aba_measurement_rollout_states_v3%rowtype;
  v_readiness jsonb;
begin
  if p_organization_id is null or p_actor_id is null then raise exception 'ABA_V3_ROLLOUT_ACTOR_SCOPE_REQUIRED'; end if;
  if v_scope not in ('CLINIC','PATIENT','PROGRAM','TARGET') then raise exception 'ABA_V3_ROLLOUT_SCOPE_INVALID'; end if;
  if length(v_reason) < 5 or length(v_reason) > 500 then raise exception 'ABA_V3_ROLLOUT_REASON_INVALID'; end if;

  if not exists (
    select 1 from public.platform_admins platform_admin
    where platform_admin.user_id = p_actor_id
      and platform_admin.active is true
  ) then raise exception 'ABA_V3_ROLLOUT_PLATFORM_ADMIN_REQUIRED'; end if;

  if (v_scope = 'CLINIC' and (p_patient_id is not null or p_program_id is not null or p_target_id is not null))
     or (v_scope = 'PATIENT' and (p_patient_id is null or p_program_id is not null or p_target_id is not null))
     or (v_scope = 'PROGRAM' and (p_patient_id is null or p_program_id is null or p_target_id is not null))
     or (v_scope = 'TARGET' and (p_patient_id is null or p_program_id is null or p_target_id is null)) then
    raise exception 'ABA_V3_ROLLOUT_SCOPE_SHAPE_INVALID';
  end if;

  if p_patient_id is not null and not exists (
    select 1 from public.patients patient
    where patient.id = p_patient_id and patient.clinic_id = p_organization_id::text
  ) then raise exception 'ABA_V3_ROLLOUT_PATIENT_SCOPE_INVALID'; end if;

  if p_allow_new_v3_sessions or p_accept_v3_sync then
    if v_scope in ('PROGRAM','TARGET') then
      v_readiness := public.get_aba_v3_pilot_readiness(
        p_organization_id,
        p_patient_id,
        p_program_id,
        case when v_scope = 'TARGET' then p_target_id else null end
      );
      if coalesce((v_readiness ->> 'ready')::boolean, false) = false then
        raise exception 'ABA_V3_ROLLOUT_PREFLIGHT_BLOCKED:%', v_readiness::text;
      end if;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':','aba-v3-rollout',p_organization_id::text,v_scope,
      coalesce(p_patient_id::text,'-'),coalesce(p_program_id,'-'),coalesce(p_target_id,'-')), 0
  ));

  select * into v_existing
  from public.aba_measurement_rollout_states_v3 state
  where state.organization_id = p_organization_id
    and state.scope_type = v_scope
    and state.patient_id is not distinct from p_patient_id
    and state.program_id is not distinct from p_program_id
    and state.target_id is not distinct from p_target_id
  for update;

  if found then
    if p_expected_state_version is not null and v_existing.state_version <> p_expected_state_version then
      raise exception 'ABA_V3_ROLLOUT_STATE_VERSION_CONFLICT';
    end if;
    if v_existing.allow_new_v3_sessions = p_allow_new_v3_sessions
       and v_existing.accept_v3_sync = p_accept_v3_sync then
      return v_existing;
    end if;

    update public.aba_measurement_rollout_states_v3
    set allow_new_v3_sessions = p_allow_new_v3_sessions,
        accept_v3_sync = p_accept_v3_sync,
        effective_from = clock_timestamp(),
        reason = v_reason,
        changed_by = p_actor_id
    where id = v_existing.id
    returning * into v_result;
    return v_result;
  end if;

  if p_expected_state_version is not null and p_expected_state_version <> 0 then
    raise exception 'ABA_V3_ROLLOUT_STATE_VERSION_CONFLICT';
  end if;

  insert into public.aba_measurement_rollout_states_v3(
    organization_id, scope_type, patient_id, program_id, target_id,
    allow_new_v3_sessions, accept_v3_sync, effective_from, reason, changed_by
  ) values (
    p_organization_id, v_scope, p_patient_id, p_program_id, p_target_id,
    p_allow_new_v3_sessions, p_accept_v3_sync, clock_timestamp(), v_reason, p_actor_id
  ) returning * into v_result;
  return v_result;
end;
$function$;

revoke all on public.aba_target_chart_points_v3 from public, anon, authenticated;
revoke all on function public.get_aba_patient_chart_catalog_v3(uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.get_aba_target_chart_series_v3(uuid,uuid,text,timestamptz,timestamptz,integer) from public, anon, authenticated;
revoke all on function public.get_aba_v3_pilot_readiness(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint) from public, anon, authenticated;

grant select on public.aba_target_chart_points_v3 to service_role;
grant execute on function public.get_aba_patient_chart_catalog_v3(uuid,uuid,timestamptz,timestamptz) to service_role;
grant execute on function public.get_aba_target_chart_series_v3(uuid,uuid,text,timestamptz,timestamptz,integer) to service_role;
grant execute on function public.get_aba_v3_pilot_readiness(uuid,uuid,text,text) to service_role;
grant execute on function public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint) to service_role;

commit;

-- Staging verification only. This migration itself never enables the rollout.
select
  to_regclass('public.aba_target_chart_points_v3') is not null as chart_points_ready,
  to_regprocedure('public.get_aba_patient_chart_catalog_v3(uuid,uuid,timestamp with time zone,timestamp with time zone)') is not null as chart_catalog_rpc_ready,
  to_regprocedure('public.get_aba_target_chart_series_v3(uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)') is not null as chart_series_rpc_ready,
  to_regprocedure('public.get_aba_v3_pilot_readiness(uuid,uuid,text,text)') is not null as pilot_readiness_rpc_ready,
  to_regprocedure('public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint)') is not null as rollout_writer_rpc_ready,
  not exists (
    select 1 from public.aba_measurement_rollout_states_v3
    where allow_new_v3_sessions or accept_v3_sync
  ) as no_v3_rollout_enabled;
