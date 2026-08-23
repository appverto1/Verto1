-- ABA V3 DEFAULT-ON — retire historical positive canary overrides back to DEFAULT/INHERIT.
--
-- Scope is intentionally exact: the two legacy positive canary states observed by 06809.
-- This is an operational transition, NOT a schema migration.
--
-- Safety:
--   * never DELETEs rollout state or event history;
--   * never writes false (false is a kill switch under V3_DEFAULT_ON);
--   * blocks if either active canary state changed since the 06809 inventory;
--   * idempotent after a successful first execution;
--   * validates post-state before COMMIT.

begin;

do $block$
declare
  v_org uuid := '79b1a8f9-ab9d-43dc-b57d-3afca67b553b'::uuid;
  v_patient uuid := 'dc739da0-4626-4cf8-a339-30e431283a4a'::uuid;
  v_actor uuid := '18cc7c5b-29d0-4e1a-b740-1143c71334be'::uuid;
  v_clinic_id uuid := '49a40cb3-143c-4802-9ac5-334298cc7a5f'::uuid;
  v_patient_state_id uuid := 'd0f1a614-0dc0-4862-b6d7-862728e0a1b0'::uuid;
  v_clinic public.aba_measurement_rollout_states_v3%rowtype;
  v_patient_state public.aba_measurement_rollout_states_v3%rowtype;
begin
  -- Serialize against concurrent rollout-control writes for these exact scopes.
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':','aba-v3-rollout',v_org::text,'CLINIC','-','-','-'), 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':','aba-v3-rollout',v_org::text,'PATIENT',v_patient::text,'-','-'), 0
  ));

  select * into v_clinic
  from public.aba_measurement_rollout_states_v3
  where id = v_clinic_id
    and organization_id = v_org
    and scope_type = 'CLINIC'
    and patient_id is null
    and program_id is null
    and target_id is null
  for update;

  if not found then
    raise exception 'ABA_V3_DEFAULT_ON_EXPECTED_CLINIC_CANARY_STATE_MISSING';
  end if;

  select * into v_patient_state
  from public.aba_measurement_rollout_states_v3
  where id = v_patient_state_id
    and organization_id = v_org
    and scope_type = 'PATIENT'
    and patient_id = v_patient
    and program_id is null
    and target_id is null
  for update;

  if not found then
    raise exception 'ABA_V3_DEFAULT_ON_EXPECTED_PATIENT_CANARY_STATE_MISSING';
  end if;

  -- First execution: require the exact positive-canary state observed by 06809.
  -- Re-execution after success: inactive state is accepted idempotently.
  if coalesce(v_clinic.override_active, true) is true then
    if v_clinic.state_version <> 7
       or v_clinic.allow_new_v3_sessions is not true
       or v_clinic.accept_v3_sync is not true then
      raise exception 'ABA_V3_DEFAULT_ON_CLINIC_CANARY_STATE_CHANGED_SINCE_06809';
    end if;

    perform public.clear_aba_measurement_rollout_override_v3(
      v_org,
      'CLINIC',
      null,
      null,
      null,
      'Aposenta override positivo do canário; política normal passa a ser V3 default-on por herança.',
      v_actor,
      v_clinic.state_version
    );
  end if;

  if coalesce(v_patient_state.override_active, true) is true then
    if v_patient_state.state_version <> 7
       or v_patient_state.allow_new_v3_sessions is not true
       or v_patient_state.accept_v3_sync is not true then
      raise exception 'ABA_V3_DEFAULT_ON_PATIENT_CANARY_STATE_CHANGED_SINCE_06809';
    end if;

    perform public.clear_aba_measurement_rollout_override_v3(
      v_org,
      'PATIENT',
      v_patient,
      null,
      null,
      'Aposenta override positivo do canário; política normal passa a ser V3 default-on por herança.',
      v_actor,
      v_patient_state.state_version
    );
  end if;
end;
$block$;

-- Hard postconditions. Any failure rolls back both transitions.
do $verify$
declare
  v_org uuid := '79b1a8f9-ab9d-43dc-b57d-3afca67b553b'::uuid;
  v_patient uuid := 'dc739da0-4626-4cf8-a339-30e431283a4a'::uuid;
  v_program text := '0098fd66-ea15-4c98-b77c-86e2aacf98ed';
  v_target text := 'bfe16695-72c9-4777-8f40-b39607683f70';
  v_clinic_id uuid := '49a40cb3-143c-4802-9ac5-334298cc7a5f'::uuid;
  v_patient_state_id uuid := 'd0f1a614-0dc0-4862-b6d7-862728e0a1b0'::uuid;
  v_resolved jsonb;
  v_active_positive integer;
  v_active_block integer;
  v_inactive_canary integer;
begin
  select count(*)::integer into v_inactive_canary
  from public.aba_measurement_rollout_states_v3 r
  where r.id in (v_clinic_id, v_patient_state_id)
    and r.organization_id = v_org
    and r.override_active is false
    and r.allow_new_v3_sessions is true
    and r.accept_v3_sync is true;

  if v_inactive_canary <> 2 then
    raise exception 'ABA_V3_DEFAULT_ON_CANARY_OVERRIDE_RETIREMENT_INCOMPLETE:%', v_inactive_canary;
  end if;

  select count(*)::integer into v_active_positive
  from public.aba_measurement_rollout_states_v3 r
  where r.organization_id = v_org
    and coalesce(r.override_active, true) is true
    and r.allow_new_v3_sessions is true
    and r.accept_v3_sync is true
    and (
      r.scope_type = 'CLINIC'
      or (r.scope_type = 'PATIENT' and r.patient_id = v_patient)
      or (r.scope_type = 'PROGRAM' and r.patient_id = v_patient and r.program_id = v_program)
      or (r.scope_type = 'TARGET' and r.patient_id = v_patient and r.program_id = v_program and r.target_id = v_target)
    );

  if v_active_positive <> 0 then
    raise exception 'ABA_V3_DEFAULT_ON_ACTIVE_POSITIVE_OVERRIDE_REMAINS:%', v_active_positive;
  end if;

  select count(*)::integer into v_active_block
  from public.aba_measurement_rollout_states_v3 r
  where r.organization_id = v_org
    and coalesce(r.override_active, true) is true
    and (r.allow_new_v3_sessions is false or r.accept_v3_sync is false)
    and (
      r.scope_type = 'CLINIC'
      or (r.scope_type = 'PATIENT' and r.patient_id = v_patient)
      or (r.scope_type = 'PROGRAM' and r.patient_id = v_patient and r.program_id = v_program)
      or (r.scope_type = 'TARGET' and r.patient_id = v_patient and r.program_id = v_program and r.target_id = v_target)
    );

  if v_active_block <> 0 then
    raise exception 'ABA_V3_DEFAULT_ON_UNEXPECTED_ACTIVE_KILL_SWITCH:%', v_active_block;
  end if;

  v_resolved := public.resolve_aba_measurement_rollout_snapshot_v3(
    v_org, v_patient, v_program, v_target, clock_timestamp()
  );

  if coalesce(v_resolved->>'policy_mode','') <> 'V3_DEFAULT_ON'
     or coalesce(v_resolved->>'policy_reason','') <> 'DEFAULT_ON_ELIGIBLE'
     or coalesce(v_resolved->>'enrollment_scope','') <> 'DEFAULT_ON'
     or coalesce((v_resolved->>'allow_new_v3_sessions')::boolean,false) is not true
     or coalesce((v_resolved->>'accept_v3_sync')::boolean,false) is not true
     or coalesce((v_resolved->>'explicit_allow_kill_switch')::boolean,false) is true
     or coalesce((v_resolved->>'explicit_sync_kill_switch')::boolean,false) is true
     or coalesce((v_resolved->>'readiness_green')::boolean,false) is not true then
    raise exception 'ABA_V3_DEFAULT_ON_INHERIT_POSTCONDITION_FAILED:%', left(v_resolved::text, 4000);
  end if;
end;
$verify$;

commit;

with scope as (
  select
    '79b1a8f9-ab9d-43dc-b57d-3afca67b553b'::uuid as organization_id,
    'dc739da0-4626-4cf8-a339-30e431283a4a'::uuid as patient_id,
    '0098fd66-ea15-4c98-b77c-86e2aacf98ed'::text as program_id,
    'bfe16695-72c9-4777-8f40-b39607683f70'::text as target_id
), resolved as (
  select public.resolve_aba_measurement_rollout_snapshot_v3(
    s.organization_id, s.patient_id, s.program_id, s.target_id, clock_timestamp()
  ) as snapshot
  from scope s
), retired as (
  select
    r.id,
    r.scope_type,
    r.override_active,
    r.allow_new_v3_sessions,
    r.accept_v3_sync,
    r.state_version,
    r.effective_from,
    r.reason,
    (
      select count(*)::integer
      from public.aba_measurement_rollout_events_v3 e
      where e.rollout_state_id = r.id
    ) as audit_event_count
  from public.aba_measurement_rollout_states_v3 r
  where r.id in (
    '49a40cb3-143c-4802-9ac5-334298cc7a5f'::uuid,
    'd0f1a614-0dc0-4862-b6d7-862728e0a1b0'::uuid
  )
)
select jsonb_build_object(
  'gate', case
    when (select count(*) from retired where override_active is false) = 2
      and coalesce((select snapshot->>'enrollment_scope' from resolved),'') = 'DEFAULT_ON'
      and coalesce((select (snapshot->>'allow_new_v3_sessions')::boolean from resolved),false) is true
      and coalesce((select (snapshot->>'explicit_allow_kill_switch')::boolean from resolved),false) is false
      then 'PASS_DEFAULT_ON_NO_POSITIVE_ENROLLMENT_STATE'
    else 'BLOCKED_DEFAULT_ON_OVERRIDE_RETIREMENT_POSTCHECK'
  end,
  'writes', jsonb_build_object(
    'rollout_state_rows_transitioned_to_inherit', 2,
    'deleted_rows', 0,
    'kill_switch_rows_created', 0,
    'clinical_rows_mutated', false,
    'bindings_rewritten', false
  ),
  'retired_canary_overrides', coalesce((
    select jsonb_agg(to_jsonb(retired) order by scope_type)
    from retired
  ), '[]'::jsonb),
  'resolver_now', (select snapshot from resolved),
  'proof', jsonb_build_object(
    'normal_enrollment_scope', (select snapshot->>'enrollment_scope' from resolved),
    'policy_mode', (select snapshot->>'policy_mode' from resolved),
    'policy_reason', (select snapshot->>'policy_reason' from resolved),
    'allow_new_v3_sessions', (select (snapshot->>'allow_new_v3_sessions')::boolean from resolved),
    'accept_v3_sync', (select (snapshot->>'accept_v3_sync')::boolean from resolved),
    'explicit_allow_kill_switch', (select (snapshot->>'explicit_allow_kill_switch')::boolean from resolved),
    'explicit_sync_kill_switch', (select (snapshot->>'explicit_sync_kill_switch')::boolean from resolved)
  ),
  'next_if_pass', 'CREATE ONE FRESH SESSION TO PROVE SESSION BINDING UNDER PURE DEFAULT_INHERIT; NO CONTROL-CENTER ENROLLMENT REQUIRED'
) as aba_v3_default_on_retire_legacy_positive_canary_overrides;
