-- ABA V3 — default-on session collection-plan alignment hotfix.
--
-- Root cause fixed:
--   resolve_aba_measurement_rollout_snapshot_v3() was changed to V3 default-on,
--   but get_aba_v3_session_collection_plan() still required explicit positive
--   CLINIC + PATIENT + PROGRAM/TARGET rollout rows. The UI trusts this preview,
--   so a new default-on target could be previewed as Legacy V2 and written to
--   the legacy route even though the authoritative binding resolver would choose V3.
--
-- This migration aligns the read-only session plan with the same semantics:
--   missing rollout state => inherit ON; explicit false => kill switch;
--   readiness/unsupported semantics => fail-safe Legacy V2; sync false => blocked;
--   existing immutable binding and emergency bridge still win.
--
-- No rollout rows, bindings, sessions, trials or clinical facts are mutated.

begin;

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
      -- V3 default-on: missing rollout rows inherit ON. Only an explicit false
      -- at any applicable scope is a kill switch. This must stay aligned with
      -- resolve_aba_measurement_rollout_snapshot_v3().
      not (
        (clinic_rollout.after_state is not null and coalesce((clinic_rollout.after_state ->> 'allow_new_v3_sessions')::boolean, false) = false)
        or (patient_rollout.after_state is not null and coalesce((patient_rollout.after_state ->> 'allow_new_v3_sessions')::boolean, false) = false)
        or (program_rollout.after_state is not null and coalesce((program_rollout.after_state ->> 'allow_new_v3_sessions')::boolean, false) = false)
        or (target_rollout.after_state is not null and coalesce((target_rollout.after_state ->> 'allow_new_v3_sessions')::boolean, false) = false)
      ) as rollout_allow,
      not (
        (clinic_rollout.after_state is not null and coalesce((clinic_rollout.after_state ->> 'accept_v3_sync')::boolean, false) = false)
        or (patient_rollout.after_state is not null and coalesce((patient_rollout.after_state ->> 'accept_v3_sync')::boolean, false) = false)
        or (program_rollout.after_state is not null and coalesce((program_rollout.after_state ->> 'accept_v3_sync')::boolean, false) = false)
        or (target_rollout.after_state is not null and coalesce((target_rollout.after_state ->> 'accept_v3_sync')::boolean, false) = false)
      ) as rollout_accept
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
        -- Explicit kill switch is the only rollout-level reason to fall back.
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
         )
         and (
           target.target_type <> 'behavior'
           or (
             exists (
               select 1
               from public.aba_behavior_target_bindings_v3 behavior_binding
               join public.aba_behavior_definitions behavior
                 on behavior.id = behavior_binding.behavior_id
                and behavior.patient_id = behavior_binding.patient_id
                and behavior.clinic_id = behavior_binding.organization_id::text
               where behavior_binding.organization_id = p_organization_id
                 and behavior_binding.patient_id = p_patient_id
                 and behavior_binding.target_id = target.id
                 and behavior_binding.status = 'ACTIVE'
                 and behavior_binding.created_at <= v_session.started_at
                 and lower(coalesce(behavior.measurement_type,'')) <> 'abc'
             )
             and not exists (
               select 1
               from public.aba_behavior_target_bindings_v3 behavior_binding
               join public.aba_behavior_definitions behavior
                 on behavior.id = behavior_binding.behavior_id
                and behavior.patient_id = behavior_binding.patient_id
                and behavior.clinic_id = behavior_binding.organization_id::text
               where behavior_binding.organization_id = p_organization_id
                 and behavior_binding.patient_id = p_patient_id
                 and behavior_binding.target_id = target.id
                 and behavior_binding.status = 'ACTIVE'
                 and behavior_binding.created_at <= v_session.started_at
                 and lower(coalesce(behavior.measurement_type,'')) = 'abc'
             )
           )
         ) then 'V3'
        -- Default-on is fail-safe: unsupported/unready semantics fall back to V2,
        -- matching the authoritative binding resolver.
        else 'LEGACY_V2'
      end as planned_model,
      case
        when existing.id is not null then 'EXISTING_IMMUTABLE_BINDING'
        when bridge.id is not null then 'ACTIVE_EMERGENCY_LEGACY_BRIDGE'
        when target.rollout_allow = false then 'EXPLICIT_KILL_SWITCH_AT_SESSION_START'
        when target.rollout_accept = false then 'SYNC_KILL_SWITCH_AT_SESSION_START'
        when target.target_type not in ('dtt','net','probe','behavior','task_analysis') then 'UNSUPPORTED_TARGET_SEMANTICS_FALLBACK'
        when definition.id is null then 'PUBLISHED_COLLECTION_DEFINITION_MISSING_FALLBACK'
        when phase.id is null then 'ACTIVE_TARGET_PHASE_MISSING_FALLBACK'
        when target.target_type = 'task_analysis' and not exists (
          select 1 from public.aba_task_analysis_step_definitions_v3 step
          where step.collection_definition_version_id = definition.id
        ) then 'TASK_ANALYSIS_STEPS_MISSING_FALLBACK'
        when target.target_type = 'behavior' and not exists (
          select 1
          from public.aba_behavior_target_bindings_v3 behavior_binding
          join public.aba_behavior_definitions behavior
            on behavior.id = behavior_binding.behavior_id
           and behavior.patient_id = behavior_binding.patient_id
           and behavior.clinic_id = behavior_binding.organization_id::text
          where behavior_binding.organization_id = p_organization_id
            and behavior_binding.patient_id = p_patient_id
            and behavior_binding.target_id = target.id
            and behavior_binding.status = 'ACTIVE'
            and behavior_binding.created_at <= v_session.started_at
            and lower(coalesce(behavior.measurement_type,'')) <> 'abc'
        ) then 'BEHAVIOR_MAPPING_MISSING_FALLBACK'
        when target.target_type = 'behavior' and exists (
          select 1
          from public.aba_behavior_target_bindings_v3 behavior_binding
          join public.aba_behavior_definitions behavior
            on behavior.id = behavior_binding.behavior_id
           and behavior.patient_id = behavior_binding.patient_id
           and behavior.clinic_id = behavior_binding.organization_id::text
          where behavior_binding.organization_id = p_organization_id
            and behavior_binding.patient_id = p_patient_id
            and behavior_binding.target_id = target.id
            and behavior_binding.status = 'ACTIVE'
            and behavior_binding.created_at <= v_session.started_at
            and lower(coalesce(behavior.measurement_type,'')) = 'abc'
        ) then 'ABC_V3_MAPPING_FORBIDDEN_FALLBACK'
        else 'DEFAULT_ON_ELIGIBLE_PREVIEW'
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


revoke all on function public.get_aba_v3_session_collection_plan(uuid,uuid,text,text[]) from public, anon, authenticated;
grant execute on function public.get_aba_v3_session_collection_plan(uuid,uuid,text,text[]) to service_role;

do $hotfix$
declare
  v_browser_execute boolean;
  v_service_execute boolean;
begin
  if to_regprocedure('public.get_aba_v3_session_collection_plan(uuid,uuid,text,text[])') is null then
    raise exception 'ABA_V3_DEFAULT_ON_COLLECTION_PLAN_FUNCTION_MISSING';
  end if;

  select has_function_privilege('authenticated', 'public.get_aba_v3_session_collection_plan(uuid,uuid,text,text[])', 'EXECUTE')
    into v_browser_execute;
  select has_function_privilege('service_role', 'public.get_aba_v3_session_collection_plan(uuid,uuid,text,text[])', 'EXECUTE')
    into v_service_execute;

  if v_browser_execute then
    raise exception 'ABA_V3_DEFAULT_ON_COLLECTION_PLAN_BROWSER_EXECUTE_OPEN';
  end if;
  if not v_service_execute then
    raise exception 'ABA_V3_DEFAULT_ON_COLLECTION_PLAN_SERVICE_EXECUTE_MISSING';
  end if;
end;
$hotfix$;

select jsonb_build_object(
  'gate','ABA_V3_DEFAULT_ON_COLLECTION_PLAN_ALIGNED',
  'policy_mode','V3_DEFAULT_ON',
  'missing_rollout_state_means','INHERIT_ON_IF_READY',
  'explicit_false_means','KILL_SWITCH',
  'readiness_failure_means','LEGACY_V2_FAILSAFE',
  'browser_execute',has_function_privilege('authenticated','public.get_aba_v3_session_collection_plan(uuid,uuid,text,text[])','EXECUTE'),
  'service_role_execute',has_function_privilege('service_role','public.get_aba_v3_session_collection_plan(uuid,uuid,text,text[])','EXECUTE'),
  'rollout_rows_mutated',false,
  'bindings_rewritten',false,
  'clinical_rows_mutated',false
) as aba_v3_default_on_collection_plan_alignment_install;

commit;
