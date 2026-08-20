-- ABA Measurement V3 — audited exact-target operational cohort control.
--
-- This migration turns the already validated low-level rollout primitives into a
-- single exact-cohort operational contract for the Super Admin UI.
--
-- Safety invariants:
--   * TARGET-only enrollment for this operational surface;
--   * CLINIC + PATIENT + TARGET writes are one database transaction;
--   * optimistic versions are required for all three hierarchy rows;
--   * activation is blocked when readiness fails or any ABA session is open;
--   * deactivation always keeps accept_v3_sync=true; draining is explicit;
--   * parent scopes are disabled only when no other enabled child cohort needs them;
--   * browser roles never receive EXECUTE; service_role only;
--   * underlying state writer keeps append-only rollout audit events.

begin;

create or replace function public.get_aba_v3_exact_target_cohort_snapshot_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_program_id text,
  p_target_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_readiness jsonb;
  v_drain jsonb;
  v_resolved jsonb;
  v_security jsonb := null;
  v_target jsonb;
  v_open_sessions integer := 0;
  v_clinic_state jsonb;
  v_patient_state jsonb;
  v_target_state jsonb;
begin
  if p_organization_id is null or p_patient_id is null
     or nullif(btrim(coalesce(p_program_id,'')), '') is null
     or nullif(btrim(coalesce(p_target_id,'')), '') is null then
    raise exception 'ABA_V3_COHORT_SCOPE_REQUIRED';
  end if;

  select jsonb_build_object(
    'clinic_id', t.clinic_id,
    'patient_id', t.patient_id,
    'program_id', t.program_id,
    'target_id', t.id,
    'target_name', t.name,
    'target_type', t.target_type,
    'target_phase', t.phase,
    'program_name', p.name,
    'program_status', p.status,
    'patient_name', patient.name,
    'clinic_name', clinic.name
  )
  into v_target
  from public.aba_targets t
  join public.aba_programs p
    on p.id = t.program_id
   and p.patient_id = t.patient_id
  join public.patients patient
    on patient.id = t.patient_id
  join public.clinics clinic
    on clinic.id = p_organization_id
  where t.id = p_target_id
    and t.program_id = p_program_id
    and t.patient_id = p_patient_id
    and t.clinic_id = p_organization_id::text
    and patient.clinic_id = p_organization_id
  limit 1;

  if v_target is null then
    raise exception 'ABA_V3_COHORT_TARGET_SCOPE_INVALID';
  end if;

  v_readiness := public.get_aba_v3_pilot_readiness(
    p_organization_id, p_patient_id, p_program_id, p_target_id
  );

  v_drain := public.get_aba_v3_rollout_drain_status(
    p_organization_id, 'TARGET', p_patient_id, p_program_id, p_target_id
  );

  v_resolved := public.resolve_aba_measurement_rollout_snapshot_v3(
    p_organization_id, p_patient_id, p_program_id, p_target_id, now()
  );

  select count(*)::integer
  into v_open_sessions
  from public.aba_sessions s
  where s.patient_id = p_patient_id
    and s.clinic_id = p_organization_id::text
    and lower(coalesce(s.status,'')) in ('active','in_progress');

  select to_jsonb(r) into v_clinic_state
  from public.aba_measurement_rollout_states_v3 r
  where r.organization_id = p_organization_id
    and r.scope_type = 'CLINIC'
  limit 1;

  select to_jsonb(r) into v_patient_state
  from public.aba_measurement_rollout_states_v3 r
  where r.organization_id = p_organization_id
    and r.scope_type = 'PATIENT'
    and r.patient_id = p_patient_id
  limit 1;

  select to_jsonb(r) into v_target_state
  from public.aba_measurement_rollout_states_v3 r
  where r.organization_id = p_organization_id
    and r.scope_type = 'TARGET'
    and r.patient_id = p_patient_id
    and r.program_id = p_program_id
    and r.target_id = p_target_id
  limit 1;

  if to_regprocedure('public.get_clinical_measurement_v3_security_preflight()') is not null then
    execute 'select public.get_clinical_measurement_v3_security_preflight()' into v_security;
  end if;

  return jsonb_build_object(
    'snapshot_version', 'ABA_V3_EXACT_TARGET_OPERATIONAL_V1',
    'checked_at', now(),
    'scope', jsonb_build_object(
      'organization_id', p_organization_id,
      'patient_id', p_patient_id,
      'program_id', p_program_id,
      'target_id', p_target_id
    ),
    'target', v_target,
    'readiness', v_readiness,
    'drain_status', v_drain,
    'resolved_rollout', v_resolved,
    'security_preflight', coalesce(v_security, 'null'::jsonb),
    'open_session_count', v_open_sessions,
    'states', jsonb_build_object(
      'clinic', coalesce(v_clinic_state, 'null'::jsonb),
      'patient', coalesce(v_patient_state, 'null'::jsonb),
      'target', coalesce(v_target_state, 'null'::jsonb)
    ),
    'expected_state_versions', jsonb_build_object(
      'clinic', coalesce((v_clinic_state->>'state_version')::bigint, 0),
      'patient', coalesce((v_patient_state->>'state_version')::bigint, 0),
      'target', coalesce((v_target_state->>'state_version')::bigint, 0)
    ),
    'effective_enabled', coalesce((v_resolved->>'allow_new_v3_sessions')::boolean, false),
    'writer_supported', lower(coalesce(v_target->>'target_type','')) in ('dtt','net','cold_probe','baseline_probe','maintenance_probe'),
    'can_enable',
      coalesce((v_readiness->>'ready')::boolean, false)
      and v_open_sessions = 0
      and lower(coalesce(v_target->>'target_type','')) in ('dtt','net','cold_probe','baseline_probe','maintenance_probe')
      and coalesce((v_security->>'ok')::boolean, true),
    'can_disable_new_sessions',
      coalesce((v_target_state->>'allow_new_v3_sessions')::boolean, false)
  );
end;
$function$;

create or replace function public.set_aba_v3_exact_target_cohort_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_program_id text,
  p_target_id text,
  p_enable boolean,
  p_reason text,
  p_actor_id uuid,
  p_expected_clinic_version bigint,
  p_expected_patient_version bigint,
  p_expected_target_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_reason text := btrim(coalesce(p_reason,''));
  v_before jsonb;
  v_after jsonb;
  v_readiness jsonb;
  v_current_clinic_version bigint := 0;
  v_current_patient_version bigint := 0;
  v_current_target_version bigint := 0;
  v_target_enabled boolean := false;
  v_other_patient_enrollment_count integer := 0;
  v_other_enabled_patient_count integer := 0;
  v_patient_state_version_after bigint := 0;
  v_clinic_state_version_after bigint := 0;
begin
  if p_organization_id is null or p_patient_id is null or p_actor_id is null
     or nullif(btrim(coalesce(p_program_id,'')), '') is null
     or nullif(btrim(coalesce(p_target_id,'')), '') is null then
    raise exception 'ABA_V3_COHORT_SCOPE_REQUIRED';
  end if;
  if length(v_reason) < 10 or length(v_reason) > 500 then
    raise exception 'ABA_V3_COHORT_REASON_INVALID';
  end if;
  if p_expected_clinic_version is null or p_expected_clinic_version < 0
     or p_expected_patient_version is null or p_expected_patient_version < 0
     or p_expected_target_version is null or p_expected_target_version < 0 then
    raise exception 'ABA_V3_COHORT_EXPECTED_VERSIONS_REQUIRED';
  end if;

  if not exists (
    select 1 from public.platform_admins pa
    where pa.user_id = p_actor_id and pa.active is true
  ) then
    raise exception 'ABA_V3_ROLLOUT_PLATFORM_ADMIN_REQUIRED';
  end if;

  -- One exact-target lock serializes hierarchy changes for this target. Parent rows
  -- are also protected by the lower-level writer's own advisory locks.
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':','aba-v3-exact-cohort',p_organization_id::text,p_patient_id::text,p_program_id,p_target_id), 0
  ));

  v_before := public.get_aba_v3_exact_target_cohort_snapshot_v1(
    p_organization_id, p_patient_id, p_program_id, p_target_id
  );

  v_current_clinic_version := coalesce((v_before #>> '{expected_state_versions,clinic}')::bigint, 0);
  v_current_patient_version := coalesce((v_before #>> '{expected_state_versions,patient}')::bigint, 0);
  v_current_target_version := coalesce((v_before #>> '{expected_state_versions,target}')::bigint, 0);

  if v_current_clinic_version <> p_expected_clinic_version
     or v_current_patient_version <> p_expected_patient_version
     or v_current_target_version <> p_expected_target_version then
    raise exception 'ABA_V3_COHORT_STATE_VERSION_CONFLICT';
  end if;

  v_target_enabled := coalesce((v_before #>> '{states,target,allow_new_v3_sessions}')::boolean, false);

  if p_enable then
    if coalesce((v_before->>'can_enable')::boolean, false) is false then
      raise exception 'ABA_V3_COHORT_PREFLIGHT_BLOCKED:%', left(v_before::text, 4000);
    end if;

    -- Idempotent if this exact target is already effectively enabled.
    if coalesce((v_before->>'effective_enabled')::boolean, false) is true and v_target_enabled is true then
      return jsonb_build_object('action','ENABLE','idempotent',true,'snapshot',v_before);
    end if;

    perform public.set_aba_measurement_rollout_state_v3(
      p_organization_id, 'CLINIC', null, null, null,
      true, true, v_reason, p_actor_id, v_current_clinic_version
    );
    perform public.set_aba_measurement_rollout_state_v3(
      p_organization_id, 'PATIENT', p_patient_id, null, null,
      true, true, v_reason, p_actor_id, v_current_patient_version
    );
    perform public.set_aba_measurement_rollout_state_v3(
      p_organization_id, 'TARGET', p_patient_id, p_program_id, p_target_id,
      true, true, v_reason, p_actor_id, v_current_target_version
    );
  else
    if v_current_target_version = 0 or v_target_enabled is false then
      return jsonb_build_object('action','DISABLE_NEW_SESSIONS','idempotent',true,'snapshot',v_before);
    end if;

    -- First close the exact enrollment. Sync deliberately stays open for drain.
    perform public.set_aba_measurement_rollout_state_v3(
      p_organization_id, 'TARGET', p_patient_id, p_program_id, p_target_id,
      false, true, v_reason, p_actor_id, v_current_target_version
    );

    -- Parent PATIENT is only closed when no other explicit PROGRAM/TARGET enrollment
    -- for this patient still requests new V3 sessions.
    select count(*)::integer into v_other_patient_enrollment_count
    from public.aba_measurement_rollout_states_v3 r
    where r.organization_id = p_organization_id
      and r.patient_id = p_patient_id
      and r.scope_type in ('PROGRAM','TARGET')
      and r.allow_new_v3_sessions is true;

    select coalesce(state_version,0) into v_patient_state_version_after
    from public.aba_measurement_rollout_states_v3
    where organization_id = p_organization_id
      and scope_type = 'PATIENT'
      and patient_id = p_patient_id
    limit 1;
    v_patient_state_version_after := coalesce(v_patient_state_version_after, 0);

    if v_other_patient_enrollment_count = 0 and v_patient_state_version_after > 0 then
      perform public.set_aba_measurement_rollout_state_v3(
        p_organization_id, 'PATIENT', p_patient_id, null, null,
        false, true, v_reason, p_actor_id, v_patient_state_version_after
      );
    end if;

    -- CLINIC remains open while any patient in the clinic still allows new V3.
    select count(*)::integer into v_other_enabled_patient_count
    from public.aba_measurement_rollout_states_v3 r
    where r.organization_id = p_organization_id
      and r.scope_type = 'PATIENT'
      and r.allow_new_v3_sessions is true;

    select coalesce(state_version,0) into v_clinic_state_version_after
    from public.aba_measurement_rollout_states_v3
    where organization_id = p_organization_id
      and scope_type = 'CLINIC'
    limit 1;
    v_clinic_state_version_after := coalesce(v_clinic_state_version_after, 0);

    if v_other_enabled_patient_count = 0 and v_clinic_state_version_after > 0 then
      perform public.set_aba_measurement_rollout_state_v3(
        p_organization_id, 'CLINIC', null, null, null,
        false, true, v_reason, p_actor_id, v_clinic_state_version_after
      );
    end if;
  end if;

  v_after := public.get_aba_v3_exact_target_cohort_snapshot_v1(
    p_organization_id, p_patient_id, p_program_id, p_target_id
  );

  if p_enable and coalesce((v_after->>'effective_enabled')::boolean,false) is not true then
    raise exception 'ABA_V3_COHORT_ENABLE_POSTCONDITION_FAILED:%', left(v_after::text,4000);
  end if;
  if not p_enable and coalesce((v_after->>'effective_enabled')::boolean,false) is true then
    raise exception 'ABA_V3_COHORT_DISABLE_POSTCONDITION_FAILED:%', left(v_after::text,4000);
  end if;

  return jsonb_build_object(
    'action', case when p_enable then 'ENABLE' else 'DISABLE_NEW_SESSIONS' end,
    'idempotent', false,
    'snapshot', v_after
  );
end;
$function$;

revoke all on function public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.set_aba_v3_exact_target_cohort_v1(uuid,uuid,text,text,boolean,text,uuid,bigint,bigint,bigint) from public, anon, authenticated;
grant execute on function public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text) to service_role;
grant execute on function public.set_aba_v3_exact_target_cohort_v1(uuid,uuid,text,text,boolean,text,uuid,bigint,bigint,bigint) to service_role;

commit;

select jsonb_build_object(
  'snapshot_rpc_ready', to_regprocedure('public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text)') is not null,
  'control_rpc_ready', to_regprocedure('public.set_aba_v3_exact_target_cohort_v1(uuid,uuid,text,text,boolean,text,uuid,bigint,bigint,bigint)') is not null,
  'browser_snapshot_execute', has_function_privilege('authenticated','public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text)','EXECUTE'),
  'browser_control_execute', has_function_privilege('authenticated','public.set_aba_v3_exact_target_cohort_v1(uuid,uuid,text,text,boolean,text,uuid,bigint,bigint,bigint)','EXECUTE')
) as aba_v3_operational_cohort_control_install;
