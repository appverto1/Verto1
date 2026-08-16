-- ABA Measurement V3 - post-PR12 runtime UUID scope repair.
-- Additive/idempotent function repair only. No clinical rows, rollout state, Legacy V2
-- data or previously-applied migration files are mutated.
--
-- Canonical schema: patients.clinic_id is UUID, while legacy ABA session/target
-- clinic_id columns remain TEXT. Only patient-scope comparisons are repaired here.

begin;

do $aba_v3_uuid_scope_precondition$
begin
  if not exists (
    select 1
    from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'patients'
      and column_info.column_name = 'clinic_id'
      and column_info.udt_name = 'uuid'
  ) then
    raise exception 'ABA_V3_PATIENT_CLINIC_ID_TYPE_UNEXPECTED';
  end if;
end;
$aba_v3_uuid_scope_precondition$;

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
    where patient.id = p_patient_id and patient.clinic_id = p_organization_id
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
      and patient.clinic_id = p_organization_id
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
  v_drain jsonb;
begin
  if p_organization_id is null or p_actor_id is null then raise exception 'ABA_V3_ROLLOUT_ACTOR_SCOPE_REQUIRED'; end if;
  if v_scope not in ('CLINIC','PATIENT','PROGRAM','TARGET') then raise exception 'ABA_V3_ROLLOUT_SCOPE_INVALID'; end if;
  if length(v_reason) < 5 or length(v_reason) > 500 then raise exception 'ABA_V3_ROLLOUT_REASON_INVALID'; end if;
  if p_allow_new_v3_sessions and not p_accept_v3_sync then
    raise exception 'ABA_V3_ROLLOUT_SYNC_REQUIRED';
  end if;

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
    where patient.id = p_patient_id and patient.clinic_id = p_organization_id
  ) then raise exception 'ABA_V3_ROLLOUT_PATIENT_SCOPE_INVALID'; end if;

  -- Readiness gates NEW V3 enrollment only. Sync by itself is a continuity/recovery
  -- control and must remain enable-able while new sessions are already disabled.
  if p_allow_new_v3_sessions then
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

  if not p_accept_v3_sync then
    v_drain := public.get_aba_v3_rollout_drain_status(
      p_organization_id, v_scope, p_patient_id, p_program_id, p_target_id
    );
    if coalesce((v_drain ->> 'drained')::boolean, false) = false then
      raise exception 'ABA_V3_ROLLOUT_DRAIN_REQUIRED:%', v_drain::text;
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

create or replace function public.get_aba_v3_preflight_scope_snapshot(
  p_organization_id uuid,
  p_patient_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_metrics jsonb;
  v_fingerprint text;
  v_enabled_rollout_count integer := 0;
begin
  if p_organization_id is null or p_patient_id is null then
    raise exception 'ABA_V3_PREFLIGHT_SNAPSHOT_SCOPE_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.patients patient
    where patient.id = p_patient_id
      and patient.clinic_id = p_organization_id
  ) then
    raise exception 'ABA_V3_PREFLIGHT_SNAPSHOT_PATIENT_SCOPE_INVALID';
  end if;

  -- Fixed-size aggregate set: one read per canonical surface, never one query per
  -- target/behavior. These values are evidence that a dark preflight did not mutate
  -- the selected patient scope. They intentionally exclude display-only V2 data.
  select jsonb_build_object(
    'target_bindings', jsonb_build_object(
      'count', count(*)::bigint,
      'v3_count', count(*) filter (where measurement_model_version = 'V3')::bigint,
      'latest_created_at', max(created_at)
    )
  ) into v_metrics
  from public.aba_session_target_measurement_bindings
  where organization_id = p_organization_id
    and patient_id = p_patient_id;

  v_metrics := v_metrics || jsonb_build_object(
    'collection_definitions', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'published_count', count(*) filter (where status = 'PUBLISHED')::bigint,
        'deprecated_count', count(*) filter (where status in ('DEPRECATED','ARCHIVED'))::bigint,
        'latest_created_at', max(created_at),
        'latest_deprecated_at', max(deprecated_at)
      )
      from public.aba_collection_definition_versions_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'target_phases', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_count', count(*) filter (where effective_until is null)::bigint,
        'latest_created_at', max(created_at),
        'latest_effective_until', max(effective_until)
      )
      from public.aba_target_phase_assignments_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'task_analysis_definitions', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_created_at', max(created_at)
      )
      from public.aba_task_analysis_step_definitions_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'behavior_target_bindings', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'active_count', count(*) filter (where status = 'ACTIVE')::bigint,
        'archived_count', count(*) filter (where status = 'ARCHIVED')::bigint,
        'latest_created_at', max(created_at),
        'latest_archived_at', max(archived_at)
      )
      from public.aba_behavior_target_bindings_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'behavior_bindings', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_created_at', max(created_at)
      )
      from public.aba_session_behavior_collection_bindings_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'trials', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_created_at', max(created_at),
        'latest_occurred_at', max(occurred_at)
      )
      from public.aba_trials_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'behavior_events', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_duration_count', count(*) filter (where measurement_kind = 'DURATION' and ended_at is null and status = 'ACTIVE')::bigint,
        'void_count', count(*) filter (where status = 'VOID')::bigint,
        'latest_created_at', max(created_at),
        'latest_ended_at', max(ended_at)
      )
      from public.aba_behavior_events_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'behavior_observation_slices', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_count', count(*) filter (where ended_at is null and status = 'ACTIVE')::bigint,
        'void_count', count(*) filter (where status = 'VOID')::bigint,
        'latest_created_at', max(created_at),
        'latest_ended_at', max(ended_at)
      )
      from public.aba_behavior_observation_slices_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'interval_runs', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_count', count(*) filter (where lifecycle_status = 'OPEN')::bigint,
        'latest_created_at', max(created_at),
        'latest_updated_at', max(updated_at),
        'latest_ended_at', max(ended_at)
      )
      from public.aba_interval_runs_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'interval_observations', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_created_at', max(created_at),
        'latest_interval_ended_at', max(interval_ended_at)
      )
      from public.aba_interval_observations_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'task_analysis_runs', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'complete_count', count(*) filter (where lifecycle_status = 'COMPLETE')::bigint,
        'incomplete_count', count(*) filter (where lifecycle_status = 'INCOMPLETE')::bigint,
        'cancelled_count', count(*) filter (where lifecycle_status = 'CANCELLED')::bigint,
        'latest_created_at', max(created_at),
        'latest_completed_at', max(completed_at)
      )
      from public.aba_task_analysis_runs_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'maintenance_probes', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_count', count(*) filter (where lifecycle_status = 'OPEN')::bigint,
        'review_count', count(*) filter (where requires_review)::bigint,
        'latest_created_at', max(created_at),
        'latest_updated_at', max(updated_at),
        'latest_closed_at', max(closed_at)
      )
      from public.aba_maintenance_probes_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'target_summaries', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_session_target_summaries_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'behavior_summaries', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_session_behavior_summaries_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'task_summaries', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_session_task_analysis_summaries_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'interval_summaries', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_interval_summaries_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'ioa_summaries', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_ioa_summaries_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'clinical_state', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'state_version_sum', coalesce(sum(state_version), 0)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_target_clinical_states_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'sync_quarantine', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_count', count(*) filter (where status in ('OPEN','READY_FOR_RETRY'))::bigint,
        'occurrence_sum', coalesce(sum(occurrence_count), 0)::bigint,
        'latest_last_seen_at', max(last_seen_at),
        'latest_resolved_at', max(resolved_at)
      )
      from public.aba_sync_quarantine_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'rollout_state', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'enabled_count', count(*) filter (where allow_new_v3_sessions or accept_v3_sync)::bigint,
        'state_version_sum', coalesce(sum(state_version), 0)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_measurement_rollout_states_v3 state
      where state.organization_id = p_organization_id
        and (
          state.scope_type = 'CLINIC'
          or state.patient_id = p_patient_id
        )
    ),
    'rollout_events', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'max_state_version', max(event.state_version),
        'latest_occurred_at', max(event.occurred_at)
      )
      from public.aba_measurement_rollout_events_v3 event
      join public.aba_measurement_rollout_states_v3 state
        on state.id = event.rollout_state_id
      where event.organization_id = p_organization_id
        and (
          state.scope_type = 'CLINIC'
          or state.patient_id = p_patient_id
        )
    )
  );

  select count(*)::integer into v_enabled_rollout_count
  from public.aba_measurement_rollout_states_v3 state
  where state.organization_id = p_organization_id
    and (state.scope_type = 'CLINIC' or state.patient_id = p_patient_id)
    and (state.allow_new_v3_sessions or state.accept_v3_sync);

  v_fingerprint := encode(
    digest(convert_to(v_metrics::text, 'UTF8'), 'sha256'),
    'hex'
  );

  return jsonb_build_object(
    'snapshot_version', 'PR12_V1',
    'organization_id', p_organization_id,
    'patient_id', p_patient_id,
    'scope_fingerprint', v_fingerprint,
    'rollout_dark', v_enabled_rollout_count = 0,
    'enabled_rollout_count', v_enabled_rollout_count,
    'metrics', v_metrics
  );
end;
$function$;

-- Preserve the post-PR10/PR11/PR12 execution boundary explicitly.
revoke all on function public.get_aba_patient_chart_catalog_v3(uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.get_aba_v3_pilot_readiness(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint) from public, anon, authenticated;
revoke all on function public.get_aba_v3_preflight_scope_snapshot(uuid,uuid) from public, anon, authenticated;

grant execute on function public.get_aba_patient_chart_catalog_v3(uuid,uuid,timestamptz,timestamptz) to service_role;
grant execute on function public.get_aba_v3_pilot_readiness(uuid,uuid,text,text) to service_role;
grant execute on function public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint) to service_role;
grant execute on function public.get_aba_v3_preflight_scope_snapshot(uuid,uuid) to service_role;

commit;

-- Deployment verification only. This does not mutate rollout or clinical state.
select
  to_regprocedure('public.get_aba_patient_chart_catalog_v3(uuid,uuid,timestamp with time zone,timestamp with time zone)') is not null as chart_catalog_rpc_ready,
  to_regprocedure('public.get_aba_v3_pilot_readiness(uuid,uuid,text,text)') is not null as pilot_readiness_rpc_ready,
  to_regprocedure('public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint)') is not null as rollout_writer_rpc_ready,
  to_regprocedure('public.get_aba_v3_preflight_scope_snapshot(uuid,uuid)') is not null as preflight_snapshot_rpc_ready;
