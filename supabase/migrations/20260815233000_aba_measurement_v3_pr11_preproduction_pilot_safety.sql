-- ABA Measurement V3 - PR11 pre-production pilot safety.
-- Additive/fail-closed. Legacy V2 remains untouched.
-- This migration adds a read-only session collection plan and explicit drain checks,
-- then hardens the PR10 rollout writer so sync cannot be disabled unsafely.

begin;

-- ---------------------------------------------------------------------------
-- One read per session: preview the immutable measurement model that would be
-- selected for the requested targets at session.started_at, without creating a
-- session-target binding. Existing bindings always win.
-- Active behavior->target mappings are included so the UI can load canonical
-- behavior definitions only when a behavior is actually enrolled in V3.
-- ---------------------------------------------------------------------------
create or replace function public.get_aba_v3_session_collection_plan(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_target_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_session public.aba_sessions%rowtype;
  v_requested_count integer := 0;
  v_found_requested_count integer := 0;
  v_targets jsonb := '[]'::jsonb;
  v_v3_behavior_ids jsonb := '[]'::jsonb;
begin
  if p_organization_id is null or p_patient_id is null
     or nullif(btrim(coalesce(p_session_id, '')), '') is null then
    raise exception 'ABA_V3_SESSION_PLAN_SCOPE_REQUIRED';
  end if;

  if coalesce(cardinality(p_target_ids), 0) > 200 then
    raise exception 'ABA_V3_SESSION_PLAN_TARGET_LIMIT';
  end if;

  select * into v_session
  from public.aba_sessions session_row
  where session_row.id = p_session_id
    and session_row.patient_id = p_patient_id
    and session_row.clinic_id = p_organization_id::text;
  if not found then raise exception 'ABA_V3_SESSION_PLAN_SESSION_SCOPE_INVALID'; end if;

  select count(distinct target_id)::integer
  into v_requested_count
  from unnest(coalesce(p_target_ids, '{}'::text[])) as requested(target_id)
  where nullif(btrim(target_id), '') is not null;

  with requested_ids as (
    select distinct btrim(target_id) as target_id
    from unnest(coalesce(p_target_ids, '{}'::text[])) as requested(target_id)
    where nullif(btrim(target_id), '') is not null
  ), behavior_target_ids as (
    select distinct binding.target_id
    from public.aba_behavior_target_bindings_v3 binding
    join public.aba_behavior_definitions behavior
      on behavior.id = binding.behavior_id
     and behavior.patient_id = binding.patient_id
     and behavior.clinic_id = binding.organization_id::text
    where binding.organization_id = p_organization_id
      and binding.patient_id = p_patient_id
      and binding.status = 'ACTIVE'
      and lower(behavior.measurement_type) <> 'abc'

    union

    -- An immutable behavior decision already made inside this session wins even
    -- if the administrative behavior->target mapping is archived afterwards.
    select distinct session_binding.target_id
    from public.aba_session_behavior_collection_bindings_v3 session_binding
    where session_binding.organization_id = p_organization_id
      and session_binding.patient_id = p_patient_id
      and session_binding.session_id = p_session_id
      and session_binding.measurement_model_version = 'V3'
      and session_binding.target_id is not null
  ), target_scope as (
    select
      target.id,
      target.program_id,
      lower(target.target_type) as target_type,
      requested.target_id is not null as requested_by_ui
    from public.aba_targets target
    left join requested_ids requested on requested.target_id = target.id
    where target.patient_id = p_patient_id
      and target.clinic_id = p_organization_id::text
      and (
        requested.target_id is not null
        or target.id in (select target_id from behavior_target_ids)
      )
  ), rollout_state_at as (
    -- Load the historical gate once for the whole session instead of resolving
    -- CLINIC/PATIENT/PROGRAM/TARGET separately for every target (no DB N+1).
    select distinct on (
      state.scope_type, state.patient_id, state.program_id, state.target_id
    )
      state.scope_type,
      state.patient_id,
      state.program_id,
      state.target_id,
      event.after_state
    from public.aba_measurement_rollout_events_v3 event
    join public.aba_measurement_rollout_states_v3 state
      on state.id = event.rollout_state_id
     and state.organization_id = event.organization_id
    where event.organization_id = p_organization_id
      and (state.scope_type = 'CLINIC' or state.patient_id = p_patient_id)
      and event.occurred_at <= v_session.started_at
      and coalesce(
        nullif(event.after_state ->> 'effective_from', '')::timestamptz,
        event.occurred_at
      ) <= v_session.started_at
    order by
      state.scope_type, state.patient_id, state.program_id, state.target_id,
      coalesce(
        nullif(event.after_state ->> 'effective_from', '')::timestamptz,
        event.occurred_at
      ) desc,
      event.state_version desc,
      event.occurred_at desc
  ), rollout_targets as (
    select
      target.*,
      coalesce((clinic_rollout.after_state ->> 'allow_new_v3_sessions')::boolean, false)
        and coalesce((patient_rollout.after_state ->> 'allow_new_v3_sessions')::boolean, false)
        and coalesce((coalesce(target_rollout.after_state, program_rollout.after_state) ->> 'allow_new_v3_sessions')::boolean, false)
        as rollout_allow,
      coalesce((clinic_rollout.after_state ->> 'accept_v3_sync')::boolean, false)
        and coalesce((patient_rollout.after_state ->> 'accept_v3_sync')::boolean, false)
        and coalesce((coalesce(target_rollout.after_state, program_rollout.after_state) ->> 'accept_v3_sync')::boolean, false)
        as rollout_accept
    from target_scope target
    left join rollout_state_at clinic_rollout
      on clinic_rollout.scope_type = 'CLINIC'
     and clinic_rollout.patient_id is null
     and clinic_rollout.program_id is null
     and clinic_rollout.target_id is null
    left join rollout_state_at patient_rollout
      on patient_rollout.scope_type = 'PATIENT'
     and patient_rollout.patient_id = p_patient_id
     and patient_rollout.program_id is null
     and patient_rollout.target_id is null
    left join rollout_state_at program_rollout
      on program_rollout.scope_type = 'PROGRAM'
     and program_rollout.patient_id = p_patient_id
     and program_rollout.program_id = target.program_id
     and program_rollout.target_id is null
    left join rollout_state_at target_rollout
      on target_rollout.scope_type = 'TARGET'
     and target_rollout.patient_id = p_patient_id
     and target_rollout.program_id = target.program_id
     and target_rollout.target_id = target.id
  ), decisions as (
    select
      target.id as target_id,
      target.program_id,
      target.target_type,
      target.requested_by_ui,
      existing.id as binding_id,
      existing.measurement_model_version as existing_model,
      bridge.id as emergency_bridge_id,
      definition.id as collection_definition_version_id,
      phase.id as target_phase_assignment_id,
      case
        when existing.id is not null then existing.measurement_model_version
        when bridge.id is not null then 'EMERGENCY_LEGACY_BRIDGE'
        -- Rollback semantics: stopping NEW V3 sessions while keeping sync on
        -- must make new/unbound targets Legacy, while already-bound V3 stays V3.
        when target.rollout_allow = false then 'LEGACY_V2'
        when target.rollout_accept = false then 'V3_BLOCKED'
        when target.target_type in ('dtt','net','probe','behavior','task_analysis')
         and definition.id is not null
         and phase.id is not null
         and (
           target.target_type <> 'task_analysis'
           or exists (
             select 1 from public.aba_task_analysis_step_definitions_v3 step
             where step.collection_definition_version_id = definition.id
           )
         ) then 'V3'
        else 'V3_BLOCKED'
      end as planned_model,
      case
        when existing.id is not null then 'EXISTING_IMMUTABLE_BINDING'
        when bridge.id is not null then 'ACTIVE_EMERGENCY_LEGACY_BRIDGE'
        when target.rollout_allow = false
          then 'ROLLOUT_NOT_ENABLED_AT_SESSION_START'
        when target.rollout_accept = false
          then 'SYNC_NOT_ENABLED_AT_SESSION_START'
        when definition.id is null then 'PUBLISHED_COLLECTION_DEFINITION_MISSING'
        when phase.id is null then 'ACTIVE_TARGET_PHASE_MISSING'
        when target.target_type = 'task_analysis' and not exists (
          select 1 from public.aba_task_analysis_step_definitions_v3 step
          where step.collection_definition_version_id = definition.id
        ) then 'TASK_ANALYSIS_STEPS_MISSING'
        else 'ROLLOUT_READY_PREVIEW'
      end as plan_reason
    from rollout_targets target
    left join public.aba_session_target_measurement_bindings existing
      on existing.organization_id = p_organization_id
     and existing.patient_id = p_patient_id
     and existing.session_id = p_session_id
     and existing.target_id = target.id
    left join lateral (
      select emergency.id
      from public.aba_emergency_legacy_bridges_v3 emergency
      where emergency.organization_id = p_organization_id
        and emergency.patient_id = p_patient_id
        and emergency.target_id = target.id
        and emergency.status = 'ACTIVE'
        and emergency.starts_at <= v_session.started_at
        and (emergency.ends_at is null or v_session.started_at < emergency.ends_at)
      order by emergency.starts_at desc
      limit 1
    ) bridge on true
    left join lateral (
      select definition_row.id
      from public.aba_collection_definition_versions_v3 definition_row
      where definition_row.organization_id = p_organization_id
        and definition_row.patient_id = p_patient_id
        and definition_row.target_id = target.id
        and definition_row.program_id = target.program_id
        and definition_row.published_at <= v_session.started_at
        and (
          definition_row.deprecated_at is null
          or v_session.started_at < definition_row.deprecated_at
        )
      order by definition_row.version desc
      limit 1
    ) definition on true
    left join lateral (
      select phase_row.id
      from public.aba_target_phase_assignments_v3 phase_row
      where phase_row.organization_id = p_organization_id
        and phase_row.patient_id = p_patient_id
        and phase_row.target_id = target.id
        and phase_row.program_id = target.program_id
        and phase_row.effective_from <= v_session.started_at
        and (
          phase_row.effective_until is null
          or v_session.started_at < phase_row.effective_until
        )
      order by phase_row.effective_from desc, phase_row.created_at desc
      limit 1
    ) phase on true
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'target_id', decision.target_id,
          'program_id', decision.program_id,
          'target_type', decision.target_type,
          'measurement_model_version', decision.planned_model,
          'binding_id', decision.binding_id,
          'binding_source', case when decision.binding_id is null then 'PREVIEW' else 'BOUND' end,
          'reason', decision.plan_reason
        ) order by decision.program_id, decision.target_id
      ) filter (where decision.requested_by_ui),
      '[]'::jsonb
    ),
    coalesce((
      select jsonb_agg(distinct behavior_scope.behavior_id)
      from (
        -- Existing immutable session decisions win over current configuration.
        select session_binding.behavior_id
        from public.aba_session_behavior_collection_bindings_v3 session_binding
        where session_binding.organization_id = p_organization_id
          and session_binding.patient_id = p_patient_id
          and session_binding.session_id = p_session_id
          and session_binding.measurement_model_version = 'V3'

        union

        -- A current mapping previews V3 only when this behavior has not already
        -- frozen a different model decision in this same session.
        select behavior_binding.behavior_id
        from public.aba_behavior_target_bindings_v3 behavior_binding
        join decisions behavior_decision
          on behavior_decision.target_id = behavior_binding.target_id
         and behavior_decision.planned_model = 'V3'
        join public.aba_behavior_definitions behavior
          on behavior.id = behavior_binding.behavior_id
         and behavior.patient_id = behavior_binding.patient_id
         and behavior.clinic_id = behavior_binding.organization_id::text
        where behavior_binding.organization_id = p_organization_id
          and behavior_binding.patient_id = p_patient_id
          and behavior_binding.status = 'ACTIVE'
          and lower(behavior.measurement_type) <> 'abc'
          and not exists (
            select 1
            from public.aba_session_behavior_collection_bindings_v3 frozen
            where frozen.organization_id = p_organization_id
              and frozen.patient_id = p_patient_id
              and frozen.session_id = p_session_id
              and frozen.behavior_id = behavior_binding.behavior_id
          )
      ) behavior_scope
    ), '[]'::jsonb),
    count(*) filter (where decision.requested_by_ui)::integer
  into v_targets, v_v3_behavior_ids, v_found_requested_count
  from decisions decision;

  return jsonb_build_object(
    'session_id', p_session_id,
    'patient_id', p_patient_id,
    'decision_at', v_session.started_at,
    'requested_target_count', v_requested_count,
    'resolved_target_count', v_found_requested_count,
    'complete', v_requested_count = v_found_requested_count,
    'targets', v_targets,
    'v3_behavior_ids', v_v3_behavior_ids
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Drain status used before accept_v3_sync is disabled. It only considers open /
-- unresolved facts; completed historical V3 data is not a blocker.
-- ---------------------------------------------------------------------------
create or replace function public.get_aba_v3_rollout_drain_status(
  p_organization_id uuid,
  p_scope_type text,
  p_patient_id uuid default null,
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
  v_scope text := upper(btrim(coalesce(p_scope_type, '')));
  v_open_v3_sessions integer := 0;
  v_open_interval_runs integer := 0;
  v_open_behavior_slices integer := 0;
  v_open_duration_events integer := 0;
  v_unresolved_quarantine integer := 0;
  v_blockers jsonb := '[]'::jsonb;
begin
  if p_organization_id is null or v_scope not in ('CLINIC','PATIENT','PROGRAM','TARGET') then
    raise exception 'ABA_V3_DRAIN_SCOPE_INVALID';
  end if;
  if (v_scope = 'CLINIC' and (p_patient_id is not null or p_program_id is not null or p_target_id is not null))
     or (v_scope = 'PATIENT' and (p_patient_id is null or p_program_id is not null or p_target_id is not null))
     or (v_scope = 'PROGRAM' and (p_patient_id is null or p_program_id is null or p_target_id is not null))
     or (v_scope = 'TARGET' and (p_patient_id is null or p_program_id is null or p_target_id is null)) then
    raise exception 'ABA_V3_DRAIN_SCOPE_SHAPE_INVALID';
  end if;

  select count(distinct binding.session_id)::integer
  into v_open_v3_sessions
  from public.aba_session_target_measurement_bindings binding
  join public.aba_targets target
    on target.id = binding.target_id
   and target.patient_id = binding.patient_id
   and target.clinic_id = binding.organization_id::text
  join public.aba_sessions session_row
    on session_row.id = binding.session_id
   and session_row.patient_id = binding.patient_id
   and session_row.clinic_id = binding.organization_id::text
  where binding.organization_id = p_organization_id
    and binding.measurement_model_version = 'V3'
    and lower(coalesce(session_row.status, '')) in ('active','in_progress')
    and (v_scope = 'CLINIC' or binding.patient_id = p_patient_id)
    and (v_scope not in ('PROGRAM','TARGET') or target.program_id = p_program_id)
    and (v_scope <> 'TARGET' or binding.target_id = p_target_id);

  select count(*)::integer
  into v_open_interval_runs
  from public.aba_interval_runs_v3 run
  join public.aba_session_behavior_collection_bindings_v3 behavior_binding
    on behavior_binding.organization_id = run.organization_id
   and behavior_binding.patient_id = run.patient_id
   and behavior_binding.session_id = run.session_id
   and behavior_binding.behavior_id = run.behavior_id
   and behavior_binding.measurement_model_version = 'V3'
  join public.aba_targets target
    on target.id = behavior_binding.target_id
   and target.patient_id = behavior_binding.patient_id
   and target.clinic_id = behavior_binding.organization_id::text
  where run.organization_id = p_organization_id
    and run.lifecycle_status = 'OPEN'
    and (v_scope = 'CLINIC' or run.patient_id = p_patient_id)
    and (v_scope not in ('PROGRAM','TARGET') or target.program_id = p_program_id)
    and (v_scope <> 'TARGET' or target.id = p_target_id);

  select count(*)::integer
  into v_open_behavior_slices
  from public.aba_behavior_observation_slices_v3 slice
  join public.aba_session_behavior_collection_bindings_v3 behavior_binding
    on behavior_binding.organization_id = slice.organization_id
   and behavior_binding.patient_id = slice.patient_id
   and behavior_binding.session_id = slice.session_id
   and behavior_binding.behavior_id = slice.behavior_id
   and behavior_binding.measurement_model_version = 'V3'
  join public.aba_targets target
    on target.id = behavior_binding.target_id
   and target.patient_id = behavior_binding.patient_id
   and target.clinic_id = behavior_binding.organization_id::text
  where slice.organization_id = p_organization_id
    and slice.status = 'ACTIVE'
    and slice.ended_at is null
    and (v_scope = 'CLINIC' or slice.patient_id = p_patient_id)
    and (v_scope not in ('PROGRAM','TARGET') or target.program_id = p_program_id)
    and (v_scope <> 'TARGET' or target.id = p_target_id);

  select count(*)::integer
  into v_open_duration_events
  from public.aba_behavior_events_v3 event
  join public.aba_session_behavior_collection_bindings_v3 behavior_binding
    on behavior_binding.organization_id = event.organization_id
   and behavior_binding.patient_id = event.patient_id
   and behavior_binding.session_id = event.session_id
   and behavior_binding.behavior_id = event.behavior_id
   and behavior_binding.measurement_model_version = 'V3'
  join public.aba_targets target
    on target.id = behavior_binding.target_id
   and target.patient_id = behavior_binding.patient_id
   and target.clinic_id = behavior_binding.organization_id::text
  where event.organization_id = p_organization_id
    and event.status = 'ACTIVE'
    and event.measurement_kind = 'DURATION'
    and event.ended_at is null
    and (v_scope = 'CLINIC' or event.patient_id = p_patient_id)
    and (v_scope not in ('PROGRAM','TARGET') or target.program_id = p_program_id)
    and (v_scope <> 'TARGET' or target.id = p_target_id);

  select count(*)::integer
  into v_unresolved_quarantine
  from public.aba_sync_quarantine_v3 quarantine
  left join public.aba_targets target
    on target.id = quarantine.target_id
   and target.patient_id = quarantine.patient_id
   and target.clinic_id = quarantine.organization_id::text
  where quarantine.organization_id = p_organization_id
    and quarantine.status in ('OPEN','READY_FOR_RETRY')
    and (v_scope = 'CLINIC' or quarantine.patient_id = p_patient_id)
    and (
      v_scope not in ('PROGRAM','TARGET')
      or (quarantine.target_id is not null and target.program_id = p_program_id)
    )
    and (v_scope <> 'TARGET' or quarantine.target_id = p_target_id);

  if v_open_v3_sessions > 0 then v_blockers := v_blockers || jsonb_build_array('OPEN_V3_SESSIONS'); end if;
  if v_open_interval_runs > 0 then v_blockers := v_blockers || jsonb_build_array('OPEN_INTERVAL_RUNS'); end if;
  if v_open_behavior_slices > 0 then v_blockers := v_blockers || jsonb_build_array('OPEN_BEHAVIOR_OBSERVATION_SLICES'); end if;
  if v_open_duration_events > 0 then v_blockers := v_blockers || jsonb_build_array('OPEN_DURATION_EVENTS'); end if;
  if v_unresolved_quarantine > 0 then v_blockers := v_blockers || jsonb_build_array('UNRESOLVED_SYNC_QUARANTINE'); end if;

  return jsonb_build_object(
    'drained', jsonb_array_length(v_blockers) = 0,
    'scope_type', v_scope,
    'patient_id', p_patient_id,
    'program_id', p_program_id,
    'target_id', p_target_id,
    'counts', jsonb_build_object(
      'open_v3_sessions', v_open_v3_sessions,
      'open_interval_runs', v_open_interval_runs,
      'open_behavior_observation_slices', v_open_behavior_slices,
      'open_duration_events', v_open_duration_events,
      'unresolved_sync_quarantine', v_unresolved_quarantine
    ),
    'blockers', v_blockers
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Harden the PR10 writer. New V3 sessions can never be enabled without sync,
-- and sync cannot be turned off while the requested scope still has open V3
-- clinical work or unresolved quarantine.
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
    where patient.id = p_patient_id and patient.clinic_id = p_organization_id::text
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

revoke all on function public.get_aba_v3_session_collection_plan(uuid,uuid,text,text[]) from public, anon, authenticated;
revoke all on function public.get_aba_v3_rollout_drain_status(uuid,text,uuid,text,text) from public, anon, authenticated;
revoke all on function public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint) from public, anon, authenticated;

grant execute on function public.get_aba_v3_session_collection_plan(uuid,uuid,text,text[]) to service_role;
grant execute on function public.get_aba_v3_rollout_drain_status(uuid,text,uuid,text,text) to service_role;
grant execute on function public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint) to service_role;

commit;

-- Staging verification only. This migration never enables rollout.
select
  to_regprocedure('public.get_aba_v3_session_collection_plan(uuid,uuid,text,text[])') is not null as session_collection_plan_ready,
  to_regprocedure('public.get_aba_v3_rollout_drain_status(uuid,text,uuid,text,text)') is not null as rollout_drain_status_ready,
  to_regprocedure('public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint)') is not null as hardened_rollout_writer_ready,
  not exists (
    select 1 from public.aba_measurement_rollout_states_v3
    where allow_new_v3_sessions or accept_v3_sync
  ) as no_v3_rollout_enabled;
