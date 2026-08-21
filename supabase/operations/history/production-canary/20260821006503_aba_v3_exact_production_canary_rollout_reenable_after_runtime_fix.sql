-- ABA V3 exact production DEMO canary re-enable after runtime feature fix.
-- Scope: the SAME pre-existing CLINIC + PATIENT + TARGET rollout rows only.
-- Purpose: re-arm one fresh production canary session after the prior Legacy V2
-- session was ended and production runtime feature flags were rebuilt/redeployed.
-- No new rollout rows are created. Uses audited writer + optimistic locking.
-- Fail-closed and atomic.

begin;

do $reenable_exact_prod_canary$
declare
  v_org constant uuid := '79b1a8f9-ab9d-43dc-b57d-3afca67b553b'::uuid;
  v_patient constant uuid := 'dc739da0-4626-4cf8-a339-30e431283a4a'::uuid;
  v_program constant text := '4ff72c73-8588-4746-9d19-5ea3c7d4bbf2';
  v_target constant text := 'eff9b97f-948d-491e-9b9a-afdef276e2a5';
  v_reason constant text := 'Re-enable isolated production DEMO canary after production ABA V3 runtime feature flags were deployed and prior Legacy V2 canary session was ended.';

  v_actor uuid;
  v_security jsonb;
  v_readiness jsonb;
  v_snapshot jsonb;
  v_open_sessions integer;
  v_rollout_state_count integer;
  v_unexpected_rollout_count integer;
  v_v3_trials integer;
  v_v3_bindings integer;
  v_quarantine integer;
  v_bad_queue integer;
  v_clinic_version bigint;
  v_patient_version bigint;
  v_target_version bigint;
begin
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('ABA_V3_FIRST_PRODUCTION_CANARY_ACTIVATION', 0));

  v_security := public.get_clinical_measurement_v3_security_preflight();
  if coalesce((v_security ->> 'ok')::boolean, false) is false then
    raise exception 'ABA_V3_PROD_CANARY_REENABLE_SECURITY_PREFLIGHT_BLOCKED:%', v_security::text;
  end if;

  v_readiness := public.get_aba_v3_pilot_readiness(v_org, v_patient, v_program, v_target);
  if coalesce((v_readiness ->> 'ready')::boolean, false) is false then
    raise exception 'ABA_V3_PROD_CANARY_REENABLE_READINESS_BLOCKED:%', v_readiness::text;
  end if;

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
    raise exception 'ABA_V3_PROD_CANARY_REENABLE_EXACT_SCOPE_INVALID';
  end if;

  select count(*)::integer
    into v_open_sessions
  from public.aba_sessions s
  where s.patient_id = v_patient
    and s.clinic_id = v_org::text
    and lower(coalesce(s.status,'')) in ('active','in_progress');

  if v_open_sessions <> 0 then
    raise exception 'ABA_V3_PROD_CANARY_REENABLE_OPEN_SESSION_BLOCKED:%', v_open_sessions;
  end if;

  -- The emergency brake must have left exactly the original three rollout rows.
  select count(*)::integer
    into v_rollout_state_count
  from public.aba_measurement_rollout_states_v3;

  if v_rollout_state_count <> 3 then
    raise exception 'ABA_V3_PROD_CANARY_REENABLE_EXPECTED_EXACTLY_3_ROLLOUT_ROWS:%', v_rollout_state_count;
  end if;

  select count(*)::integer
    into v_unexpected_rollout_count
  from public.aba_measurement_rollout_states_v3 r
  where not (
    r.organization_id = v_org
    and r.accept_v3_sync is true
    and r.allow_new_v3_sessions is false
    and (
      (r.scope_type = 'CLINIC' and r.patient_id is null and r.program_id is null and r.target_id is null)
      or
      (r.scope_type = 'PATIENT' and r.patient_id = v_patient and r.program_id is null and r.target_id is null)
      or
      (r.scope_type = 'TARGET' and r.patient_id = v_patient and r.program_id = v_program and r.target_id = v_target)
    )
  );

  if v_unexpected_rollout_count <> 0 then
    raise exception 'ABA_V3_PROD_CANARY_REENABLE_PRESTATE_BLAST_RADIUS_BLOCKED:%', v_unexpected_rollout_count;
  end if;

  -- There must still be no live V3 facts from the failed pre-runtime-fix attempt.
  select count(*)::integer into v_v3_trials
  from public.aba_trials_v3;

  select count(*)::integer into v_v3_bindings
  from public.aba_session_target_measurement_bindings
  where measurement_model_version = 'V3';

  if v_v3_trials <> 0 or v_v3_bindings <> 0 then
    raise exception 'ABA_V3_PROD_CANARY_REENABLE_UNEXPECTED_PREEXISTING_V3_ACTIVITY:trials=%,bindings=%',
      v_v3_trials, v_v3_bindings;
  end if;

  select count(*)::integer into v_quarantine
  from public.aba_sync_quarantine_v3 q
  where q.resolved_at is null;

  if v_quarantine <> 0 then
    raise exception 'ABA_V3_PROD_CANARY_REENABLE_SYNC_QUARANTINE_BLOCKED:%', v_quarantine;
  end if;

  select count(*)::integer into v_bad_queue
  from public.clinical_measurement_projection_queue_v3 q
  where upper(coalesce(q.status,'')) in ('FAILED','PROCESSING','PENDING');

  if v_bad_queue <> 0 then
    raise exception 'ABA_V3_PROD_CANARY_REENABLE_PROJECTION_QUEUE_NOT_CLEAN:%', v_bad_queue;
  end if;

  select r.changed_by, r.state_version
    into v_actor, v_target_version
  from public.aba_measurement_rollout_states_v3 r
  where r.organization_id = v_org
    and r.scope_type = 'TARGET'
    and r.patient_id = v_patient
    and r.program_id = v_program
    and r.target_id = v_target;

  select r.state_version into v_patient_version
  from public.aba_measurement_rollout_states_v3 r
  where r.organization_id = v_org
    and r.scope_type = 'PATIENT'
    and r.patient_id = v_patient
    and r.program_id is null
    and r.target_id is null;

  select r.state_version into v_clinic_version
  from public.aba_measurement_rollout_states_v3 r
  where r.organization_id = v_org
    and r.scope_type = 'CLINIC'
    and r.patient_id is null
    and r.program_id is null
    and r.target_id is null;

  if v_actor is null
     or v_clinic_version is null
     or v_patient_version is null
     or v_target_version is null
     or not exists (
       select 1 from public.platform_admins pa
       where pa.user_id = v_actor and pa.active is true
     ) then
    raise exception 'ABA_V3_PROD_CANARY_REENABLE_AUDITED_ACTOR_OR_STATE_VERSION_INVALID';
  end if;

  -- Re-enable only the exact existing rows. Optimistic state_version locking
  -- guarantees the operation aborts if any rollout state changed meanwhile.
  perform public.set_aba_measurement_rollout_state_v3(
    v_org, 'CLINIC', null, null, null,
    true, true, v_reason, v_actor, v_clinic_version
  );

  perform public.set_aba_measurement_rollout_state_v3(
    v_org, 'PATIENT', v_patient, null, null,
    true, true, v_reason, v_actor, v_patient_version
  );

  perform public.set_aba_measurement_rollout_state_v3(
    v_org, 'TARGET', v_patient, v_program, v_target,
    true, true, v_reason, v_actor, v_target_version
  );

  -- Post-write blast-radius attestation.
  if (select count(*) from public.aba_measurement_rollout_states_v3) <> 3 then
    raise exception 'ABA_V3_PROD_CANARY_REENABLE_POSTSTATE_ROW_COUNT_FAILED';
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
    raise exception 'ABA_V3_PROD_CANARY_REENABLE_POSTSTATE_BLAST_RADIUS_FAILED';
  end if;

  v_snapshot := public.resolve_aba_measurement_rollout_snapshot_v3(
    v_org, v_patient, v_program, v_target, clock_timestamp()
  );

  if coalesce((v_snapshot ->> 'allow_new_v3_sessions')::boolean, false) is false
     or coalesce((v_snapshot ->> 'accept_v3_sync')::boolean, false) is false
     or coalesce(v_snapshot ->> 'enrollment_scope','') <> 'TARGET' then
    raise exception 'ABA_V3_PROD_CANARY_REENABLE_RESOLVED_SNAPSHOT_FAILED:%', v_snapshot::text;
  end if;
end;
$reenable_exact_prod_canary$;

select jsonb_build_object(
  'gate', 'READY_FOR_FRESH_PRODUCTION_DEMO_CANARY_SESSION_AFTER_RUNTIME_FIX',
  'release_stage', 'EXACT_PRODUCTION_DEMO_CANARY_REENABLE',
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
  'broad_rollout', false,
  'next_step', 'CREATE_BRAND_NEW_SESSION_AND_CONFIRM_ABA_V3_ERROR_MODAL_BEFORE_RECORDING_TRIALS'
) as exact_production_canary_rollout_reenablement;

commit;
