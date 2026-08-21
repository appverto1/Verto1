-- ABA V3 exact production canary emergency brake.
-- DO NOT RUN as part of the happy path unless instructed.
-- Disables NEW V3 sessions for the exact DEMO canary while intentionally keeping
-- accept_v3_sync=true so already-started V3 work can drain safely.

begin;

do $disable_exact_prod_canary$
declare
  v_org constant uuid := '79b1a8f9-ab9d-43dc-b57d-3afca67b553b'::uuid;
  v_patient constant uuid := 'dc739da0-4626-4cf8-a339-30e431283a4a'::uuid;
  v_program constant text := '4ff72c73-8588-4746-9d19-5ea3c7d4bbf2';
  v_target constant text := 'eff9b97f-948d-491e-9b9a-afdef276e2a5';
  v_reason constant text := 'Emergency brake for isolated production DEMO canary; stop new V3 sessions while preserving sync drain.';
  v_actor uuid;
  v_clinic_version bigint;
  v_patient_version bigint;
  v_target_version bigint;
begin
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('ABA_V3_FIRST_PRODUCTION_CANARY_ACTIVATION', 0));

  select r.changed_by, r.state_version
    into v_actor, v_target_version
  from public.aba_measurement_rollout_states_v3 r
  where r.organization_id = v_org
    and r.scope_type = 'TARGET'
    and r.patient_id = v_patient
    and r.program_id = v_program
    and r.target_id = v_target;

  if v_actor is null or not exists (
    select 1 from public.platform_admins pa
    where pa.user_id = v_actor and pa.active is true
  ) then
    raise exception 'ABA_V3_PROD_CANARY_EMERGENCY_BRAKE_ACTIVE_ACTOR_REQUIRED';
  end if;

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

  if v_clinic_version is null or v_patient_version is null or v_target_version is null then
    raise exception 'ABA_V3_PROD_CANARY_EMERGENCY_BRAKE_STATES_MISSING';
  end if;

  -- Target first narrows the blast radius immediately, then patient and clinic.
  perform public.set_aba_measurement_rollout_state_v3(
    v_org, 'TARGET', v_patient, v_program, v_target,
    false, true, v_reason, v_actor, v_target_version
  );
  perform public.set_aba_measurement_rollout_state_v3(
    v_org, 'PATIENT', v_patient, null, null,
    false, true, v_reason, v_actor, v_patient_version
  );
  perform public.set_aba_measurement_rollout_state_v3(
    v_org, 'CLINIC', null, null, null,
    false, true, v_reason, v_actor, v_clinic_version
  );

  if exists (
    select 1 from public.aba_measurement_rollout_states_v3 r
    where r.organization_id = v_org
      and r.allow_new_v3_sessions is true
  ) then
    raise exception 'ABA_V3_PROD_CANARY_EMERGENCY_BRAKE_FAILED';
  end if;
end;
$disable_exact_prod_canary$;

select jsonb_build_object(
  'gate','NEW_V3_SESSIONS_DISABLED_SYNC_DRAIN_PRESERVED',
  'allow_new_v3_sessions',false,
  'accept_v3_sync',true,
  'drain_status', public.get_aba_v3_rollout_drain_status(
    '79b1a8f9-ab9d-43dc-b57d-3afca67b553b'::uuid,
    'TARGET',
    'dc739da0-4626-4cf8-a339-30e431283a4a'::uuid,
    '4ff72c73-8588-4746-9d19-5ea3c7d4bbf2'::text,
    'eff9b97f-948d-491e-9b9a-afdef276e2a5'::text
  )
) as exact_production_canary_emergency_brake;

commit;
