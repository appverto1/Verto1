-- ABA V3 exact production canary rollout enablement.
-- Scope: ONE preselected DEMO clinic + patient + target only.
-- Purpose: arm a single fresh-session production canary after all readiness gates passed.
-- Uses ONLY the audited rollout writer; no direct INSERT/UPDATE into rollout state.
-- Fail-closed, atomic, optimistic-lock protected.
-- IMPORTANT: after PASS, create a BRAND-NEW session. Existing sessions keep their original binding decision.

begin;

do $enable_exact_prod_canary$
declare
  v_org constant uuid := '79b1a8f9-ab9d-43dc-b57d-3afca67b553b'::uuid;
  v_patient constant uuid := 'dc739da0-4626-4cf8-a339-30e431283a4a'::uuid;
  v_program constant text := '4ff72c73-8588-4746-9d19-5ea3c7d4bbf2';
  v_target constant text := 'eff9b97f-948d-491e-9b9a-afdef276e2a5';
  v_reason constant text := 'First isolated production DEMO writer canary after production schema, security, protocol and exact-cohort readiness gates passed.';

  v_actor uuid;
  v_admin_count integer;
  v_security jsonb;
  v_readiness jsonb;
  v_snapshot jsonb;
  v_open_sessions integer;
  v_rollout_state_count integer;
  v_existing_v3_trials integer;
  v_existing_v3_bindings integer;
  v_quarantine integer;
  v_bad_queue integer;
begin
  -- Serialize the first production activation as a global one-at-a-time gate.
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('ABA_V3_FIRST_PRODUCTION_CANARY_ACTIVATION', 0));

  -- The production DB gate must still be green immediately before any rollout write.
  v_security := public.get_clinical_measurement_v3_security_preflight();
  if coalesce((v_security ->> 'ok')::boolean, false) is false then
    raise exception 'ABA_V3_PROD_CANARY_SECURITY_PREFLIGHT_BLOCKED:%', v_security::text;
  end if;

  -- Exact scope must still be clinically ready.
  v_readiness := public.get_aba_v3_pilot_readiness(v_org, v_patient, v_program, v_target);
  if coalesce((v_readiness ->> 'ready')::boolean, false) is false then
    raise exception 'ABA_V3_PROD_CANARY_READINESS_BLOCKED:%', v_readiness::text;
  end if;

  -- Confirm exact relational scope and DTT target before any write.
  if not exists (
    select 1
    from public.aba_targets t
    join public.aba_programs p
      on p.id = t.program_id
     and p.patient_id = t.patient_id
     and p.clinic_id = t.clinic_id
    where t.id = v_target
      and t.patient_id = v_patient
      and t.program_id = v_program
      and t.clinic_id = v_org::text
      and lower(coalesce(t.target_type,'')) = 'dtt'
  ) then
    raise exception 'ABA_V3_PROD_CANARY_EXACT_SCOPE_INVALID';
  end if;

  select count(*)::integer
    into v_open_sessions
  from public.aba_sessions s
  where s.patient_id = v_patient
    and s.clinic_id = v_org::text
    and lower(coalesce(s.status,'')) in ('active','in_progress');

  if v_open_sessions <> 0 then
    raise exception 'ABA_V3_PROD_CANARY_OPEN_SESSION_BLOCKED:%', v_open_sessions;
  end if;

  -- This is the FIRST production rollout. Any pre-existing rollout row means the
  -- environment changed after the readiness gate and must be re-attested.
  select count(*)::integer
    into v_rollout_state_count
  from public.aba_measurement_rollout_states_v3;

  if v_rollout_state_count <> 0 then
    raise exception 'ABA_V3_PROD_CANARY_PREEXISTING_ROLLOUT_STATE_BLOCKED:%', v_rollout_state_count;
  end if;

  -- No live V3 writer activity may predate the first controlled canary.
  select count(*)::integer into v_existing_v3_trials
  from public.aba_trials_v3;

  select count(*)::integer into v_existing_v3_bindings
  from public.aba_session_target_measurement_bindings
  where measurement_model_version = 'ABA_V3';

  if v_existing_v3_trials <> 0 or v_existing_v3_bindings <> 0 then
    raise exception 'ABA_V3_PROD_CANARY_PREEXISTING_LIVE_V3_ACTIVITY_BLOCKED:trials=%,bindings=%',
      v_existing_v3_trials, v_existing_v3_bindings;
  end if;

  select count(*)::integer into v_quarantine
  from public.aba_sync_quarantine_v3 q
  where q.resolved_at is null;

  if v_quarantine <> 0 then
    raise exception 'ABA_V3_PROD_CANARY_SYNC_QUARANTINE_BLOCKED:%', v_quarantine;
  end if;

  select count(*)::integer into v_bad_queue
  from public.clinical_measurement_projection_queue_v3 q
  where upper(coalesce(q.status,'')) in ('FAILED','PROCESSING','PENDING');

  if v_bad_queue <> 0 then
    raise exception 'ABA_V3_PROD_CANARY_PROJECTION_QUEUE_NOT_CLEAN:%', v_bad_queue;
  end if;

  -- SQL Editor has no reliable request JWT identity. For this first audited canary,
  -- fail closed unless production has exactly ONE active platform admin, so the
  -- audit actor is deterministic and never guessed.
  select count(*)::integer
    into v_admin_count
  from public.platform_admins pa
  where pa.active is true;

  if v_admin_count <> 1 then
    raise exception 'ABA_V3_PROD_CANARY_REQUIRES_EXACTLY_ONE_ACTIVE_PLATFORM_ADMIN:%', v_admin_count;
  end if;

  select pa.user_id
    into v_actor
  from public.platform_admins pa
  where pa.active is true
  order by pa.user_id::text
  limit 1;

  -- Rollout resolution is CLINIC AND PATIENT AND TARGET/PROGRAM.
  -- Create exactly the three states required for this target, all through the
  -- official audited writer. expected_state_version=0 asserts no pre-existing row.
  perform public.set_aba_measurement_rollout_state_v3(
    p_organization_id => v_org,
    p_scope_type => 'CLINIC',
    p_patient_id => null,
    p_program_id => null,
    p_target_id => null,
    p_allow_new_v3_sessions => true,
    p_accept_v3_sync => true,
    p_reason => v_reason,
    p_actor_id => v_actor,
    p_expected_state_version => 0
  );

  perform public.set_aba_measurement_rollout_state_v3(
    p_organization_id => v_org,
    p_scope_type => 'PATIENT',
    p_patient_id => v_patient,
    p_program_id => null,
    p_target_id => null,
    p_allow_new_v3_sessions => true,
    p_accept_v3_sync => true,
    p_reason => v_reason,
    p_actor_id => v_actor,
    p_expected_state_version => 0
  );

  perform public.set_aba_measurement_rollout_state_v3(
    p_organization_id => v_org,
    p_scope_type => 'TARGET',
    p_patient_id => v_patient,
    p_program_id => v_program,
    p_target_id => v_target,
    p_allow_new_v3_sessions => true,
    p_accept_v3_sync => true,
    p_reason => v_reason,
    p_actor_id => v_actor,
    p_expected_state_version => 0
  );

  -- Exact blast-radius attestation: there must now be exactly 3 rollout rows,
  -- all enabled, and all belonging to this exact canary hierarchy.
  if (select count(*) from public.aba_measurement_rollout_states_v3) <> 3 then
    raise exception 'ABA_V3_PROD_CANARY_UNEXPECTED_ROLLOUT_ROW_COUNT';
  end if;

  if exists (
    select 1
    from public.aba_measurement_rollout_states_v3 r
    where not (
      r.organization_id = v_org
      and r.allow_new_v3_sessions is true
      and r.accept_v3_sync is true
      and (
        (r.scope_type = 'CLINIC' and r.patient_id is null and r.program_id is null and r.target_id is null)
        or
        (r.scope_type = 'PATIENT' and r.patient_id = v_patient and r.program_id is null and r.target_id is null)
        or
        (r.scope_type = 'TARGET' and r.patient_id = v_patient and r.program_id = v_program and r.target_id = v_target)
      )
    )
  ) then
    raise exception 'ABA_V3_PROD_CANARY_BLAST_RADIUS_ATTESTATION_FAILED';
  end if;

  v_snapshot := public.resolve_aba_measurement_rollout_snapshot_v3(
    v_org, v_patient, v_program, v_target, clock_timestamp()
  );

  if coalesce((v_snapshot ->> 'allow_new_v3_sessions')::boolean, false) is false
     or coalesce((v_snapshot ->> 'accept_v3_sync')::boolean, false) is false
     or coalesce(v_snapshot ->> 'enrollment_scope','') <> 'TARGET' then
    raise exception 'ABA_V3_PROD_CANARY_RESOLVED_SNAPSHOT_FAILED:%', v_snapshot::text;
  end if;
end;
$enable_exact_prod_canary$;

select jsonb_build_object(
  'gate', 'READY_FOR_FRESH_PRODUCTION_DEMO_CANARY_SESSION',
  'release_stage', 'EXACT_PRODUCTION_DEMO_CANARY_ROLLOUT',
  'scope', jsonb_build_object(
    'organization_id', '79b1a8f9-ab9d-43dc-b57d-3afca67b553b',
    'patient_id', 'dc739da0-4626-4cf8-a339-30e431283a4a',
    'program_id', '4ff72c73-8588-4746-9d19-5ea3c7d4bbf2',
    'target_id', 'eff9b97f-948d-491e-9b9a-afdef276e2a5'
  ),
  'fresh_session_required', true,
  'reuse_preexisting_session', false,
  'rollout_state_count', (select count(*) from public.aba_measurement_rollout_states_v3),
  'states', (
    select jsonb_agg(
      jsonb_build_object(
        'scope_type', r.scope_type,
        'patient_id', r.patient_id,
        'program_id', r.program_id,
        'target_id', r.target_id,
        'allow_new_v3_sessions', r.allow_new_v3_sessions,
        'accept_v3_sync', r.accept_v3_sync,
        'state_version', r.state_version,
        'effective_from', r.effective_from,
        'changed_by', r.changed_by
      ) order by case r.scope_type when 'CLINIC' then 1 when 'PATIENT' then 2 when 'TARGET' then 3 else 9 end
    )
    from public.aba_measurement_rollout_states_v3 r
  ),
  'resolved_snapshot', public.resolve_aba_measurement_rollout_snapshot_v3(
    '79b1a8f9-ab9d-43dc-b57d-3afca67b553b'::uuid,
    'dc739da0-4626-4cf8-a339-30e431283a4a'::uuid,
    '4ff72c73-8588-4746-9d19-5ea3c7d4bbf2'::text,
    'eff9b97f-948d-491e-9b9a-afdef276e2a5'::text,
    clock_timestamp()
  ),
  'writes', jsonb_build_array('CLINIC_ROLLOUT','PATIENT_ROLLOUT','TARGET_ROLLOUT'),
  'broad_rollout', false,
  'next_step', 'OPEN_TARGET_AND_CONFIRM_ABA_V3_UI_BEFORE_RECORDING_ANY_TRIAL'
) as exact_production_canary_rollout_enablement;

commit;
