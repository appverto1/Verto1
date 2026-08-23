-- ABA V3 — bounded multi-target chart bundle for the simplified analytics UX.
--
-- Purpose:
--   Read up to three selected ABA V3 targets in one database round-trip while
--   preserving the existing target/phase/metric/series segmentation contract.
--
-- Safety:
--   * read-only function over the canonical V3 chart read model;
--   * no raw trial/behavior/session/rollout/clinical-state row is mutated;
--   * target scope is validated against organization + patient;
--   * target count and per-segment point count are bounded server-side;
--   * phase/model boundaries remain explicit and are never connected by the API.

begin;

-- The simplified analytics header also consumes the existing patient overview.
-- Repair its patient clinic comparison to the current UUID patients.clinic_id schema
-- while preserving the exact response contract.
create or replace function public.get_aba_patient_overview_v3(
  p_organization_id uuid,
  p_patient_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_session_count bigint := 0;
  v_last_session_at timestamptz;
  v_probe_review_count bigint := 0;
  v_ioa_review_count bigint := 0;
begin
  if p_organization_id is null or p_patient_id is null then
    raise exception 'ABA_V3_READ_SCOPE_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.patients patient
    where patient.id = p_patient_id
      and patient.clinic_id = p_organization_id
  ) then
    raise exception 'ABA_V3_READ_PATIENT_SCOPE_INVALID';
  end if;

  select count(distinct binding.session_id), max(session_row.started_at)
    into v_session_count, v_last_session_at
  from public.aba_session_target_measurement_bindings binding
  join public.aba_sessions session_row
    on session_row.id = binding.session_id
   and session_row.patient_id = binding.patient_id
   and session_row.clinic_id = binding.organization_id::text
  where binding.organization_id = p_organization_id
    and binding.patient_id = p_patient_id
    and binding.measurement_model_version = 'V3';

  select count(*) into v_probe_review_count
  from public.aba_maintenance_probes_v3 probe
  where probe.organization_id = p_organization_id
    and probe.patient_id = p_patient_id
    and probe.requires_review;

  select count(*) into v_ioa_review_count
  from public.aba_ioa_summaries_v3 ioa
  where ioa.organization_id = p_organization_id
    and ioa.patient_id = p_patient_id
    and ioa.requires_review;

  return jsonb_build_object(
    'v3_session_count', v_session_count,
    'last_v3_session_at', v_last_session_at,
    'review_counts', jsonb_build_object(
      'maintenance_probes', v_probe_review_count,
      'ioa', v_ioa_review_count
    ),
    'targets', coalesce((
      select jsonb_agg(
        (to_jsonb(state_read) - 'organization_id' - 'patient_id')
        order by state_read.program_name, state_read.target_name, state_read.target_id
      )
      from public.aba_target_state_read_v3 state_read
      where state_read.organization_id = p_organization_id
        and state_read.patient_id = p_patient_id
    ), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.get_aba_chart_series_bundle_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_target_ids text[],
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 120
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '180 days');
  v_to timestamptz := coalesce(p_to, now());
  v_limit integer := greatest(1, least(coalesce(p_limit, 120), 180));
  v_target_ids text[];
  v_requested_count integer := 0;
  v_valid_count integer := 0;
begin
  if p_organization_id is null or p_patient_id is null then
    raise exception 'ABA_V3_READ_SCOPE_REQUIRED';
  end if;
  if v_to < v_from or v_to - v_from > interval '366 days' then
    raise exception 'ABA_V3_READ_WINDOW_INVALID';
  end if;

  select coalesce(array_agg(distinct nullif(btrim(value), '') order by nullif(btrim(value), '')), '{}'::text[])
    into v_target_ids
  from unnest(coalesce(p_target_ids, '{}'::text[])) as requested(value)
  where nullif(btrim(value), '') is not null;

  v_requested_count := cardinality(v_target_ids);
  if v_requested_count < 1 or v_requested_count > 3 then
    raise exception 'ABA_V3_CHART_BUNDLE_TARGET_COUNT_INVALID';
  end if;

  if not exists (
    select 1
    from public.patients patient
    where patient.id = p_patient_id
      and patient.clinic_id = p_organization_id
  ) then
    raise exception 'ABA_V3_READ_PATIENT_SCOPE_INVALID';
  end if;

  select count(*)::integer
    into v_valid_count
  from public.aba_targets target
  where target.patient_id = p_patient_id
    and target.clinic_id = p_organization_id::text
    and target.id = any(v_target_ids);

  if v_valid_count <> v_requested_count then
    raise exception 'ABA_V3_READ_TARGET_SCOPE_INVALID';
  end if;

  return (
    with scoped as materialized (
      select
        point.*,
        row_number() over (
          partition by point.target_id, point.measurement_model_version,
                       point.phase_assignment_id, point.metric_key, point.series_key
          order by point.occurred_at desc, point.source_id desc
        ) as rn
      from public.aba_target_chart_points_v3 point
      where point.organization_id = p_organization_id
        and point.patient_id = p_patient_id
        and point.target_id = any(v_target_ids)
        and point.occurred_at >= v_from
        and point.occurred_at <= v_to
    ),
    bounded as materialized (
      select * from scoped where rn <= v_limit
    ),
    segment_keys as (
      select
        target_id,
        max(target_name) as target_name,
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
      group by target_id, measurement_model_version, phase_assignment_id, phase_type,
               phase_label, metric_key, metric_label, unit, series_key, series_label,
               source_family
    )
    select jsonb_build_object(
      'from', v_from,
      'to', v_to,
      'limit_per_segment', v_limit,
      'continuity_policy', 'BREAK_ON_PHASE_OR_MODEL_CHANGE',
      'legacy_history_separate', true,
      'target_ids', to_jsonb(v_target_ids),
      'targets', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'target_id', target.id,
            'target_name', target.name,
            'target_type', target.target_type
          ) order by target.name, target.id
        )
        from public.aba_targets target
        where target.patient_id = p_patient_id
          and target.clinic_id = p_organization_id::text
          and target.id = any(v_target_ids)
      ), '[]'::jsonb),
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
            'target_id', segment.target_id,
            'target_name', segment.target_name,
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
              where point.target_id = segment.target_id
                and point.measurement_model_version = segment.measurement_model_version
                and point.phase_assignment_id = segment.phase_assignment_id
                and point.metric_key = segment.metric_key
                and point.series_key = segment.series_key
            ), '[]'::jsonb)
          ) order by segment.segment_started_at, segment.target_name,
                     segment.metric_label, segment.series_label
        )
        from segment_keys segment
      ), '[]'::jsonb)
    )
  );
end;
$function$;

revoke all on function public.get_aba_patient_overview_v3(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_aba_patient_overview_v3(uuid, uuid) to service_role;

revoke all on function public.get_aba_chart_series_bundle_v3(
  uuid, uuid, text[], timestamptz, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.get_aba_chart_series_bundle_v3(
  uuid, uuid, text[], timestamptz, timestamptz, integer
) to service_role;

commit;
