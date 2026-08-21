-- ABA Measurement V3 - controlled Staging rollout enablement for the live canary.
--
-- Scope: one clinic + one patient + one target only.
-- Uses the supported audited rollout writer. No direct rollout UPDATE/INSERT.
-- Fail-closed protections:
--   * requires an active platform-admin actor already associated with this rollout;
--   * requires the target pilot-readiness preflight to be clean;
--   * aborts if any OTHER allow_new_v3_sessions=true cohort exists in this clinic;
--   * optimistic-locks all three existing rollout states by state_version;
--   * verifies the resolved rollout snapshot after mutation;
--   * all three scope changes are atomic in one transaction.
--
-- IMPORTANT: existing sessions keep the rollout decision from session.started_at.
-- After this script passes, create a BRAND-NEW session for the canary.

begin;

do $aba_v3_live_canary_rollout_enable$
declare
  v_organization_id constant uuid := '1bbf0c80-dfe0-4801-8a4f-7447e06cc0d6'::uuid;
  v_patient_id constant uuid := '1c4430cb-9d10-4469-84a9-278a4e05b65e'::uuid;
  v_program_id constant text := '01a8575c-9b30-4151-8ed8-9f4319011827';
  v_target_id constant text := 'ec2e6660-a988-46d6-ab6d-41073de6a30f';
  v_reason constant text := 'Staging live dark pilot canary after security and shadow parity gates passed.';

  v_actor_id uuid;
  v_clinic_version bigint;
  v_patient_version bigint;
  v_target_version bigint;
  v_readiness jsonb;
  v_conflicting_rollouts jsonb;
  v_snapshot jsonb;
begin
  -- Reuse the actor that performed the latest audited TARGET rollout transition,
  -- but only if that actor is still an active platform admin.
  select rollout.changed_by
    into v_actor_id
  from public.aba_measurement_rollout_states_v3 rollout
  where rollout.organization_id = v_organization_id
    and rollout.scope_type = 'TARGET'
    and rollout.patient_id = v_patient_id
    and rollout.program_id = v_program_id
    and rollout.target_id = v_target_id;

  if v_actor_id is null or not exists (
    select 1
    from public.platform_admins platform_admin
    where platform_admin.user_id = v_actor_id
      and platform_admin.active is true
  ) then
    raise exception 'ABA_V3_CANARY_ACTIVE_PLATFORM_ADMIN_REQUIRED';
  end if;

  -- Enabling CLINIC is necessary because rollout resolution is an AND across
  -- CLINIC + PATIENT + PROGRAM/TARGET. Fail if another cohort is already armed,
  -- so this operation cannot accidentally unlock a second patient/program/target.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'scope_type', rollout.scope_type,
        'patient_id', rollout.patient_id,
        'program_id', rollout.program_id,
        'target_id', rollout.target_id,
        'state_version', rollout.state_version,
        'reason', rollout.reason
      ) order by rollout.scope_type, rollout.patient_id::text, rollout.program_id, rollout.target_id
    ),
    '[]'::jsonb
  )
  into v_conflicting_rollouts
  from public.aba_measurement_rollout_states_v3 rollout
  where rollout.organization_id = v_organization_id
    and rollout.allow_new_v3_sessions is true
    and not (
      (rollout.scope_type = 'CLINIC'
        and rollout.patient_id is null
        and rollout.program_id is null
        and rollout.target_id is null)
      or
      (rollout.scope_type = 'PATIENT'
        and rollout.patient_id = v_patient_id
        and rollout.program_id is null
        and rollout.target_id is null)
      or
      (rollout.scope_type = 'TARGET'
        and rollout.patient_id = v_patient_id
        and rollout.program_id = v_program_id
        and rollout.target_id = v_target_id)
    );

  if jsonb_array_length(v_conflicting_rollouts) > 0 then
    raise exception 'ABA_V3_CANARY_BLAST_RADIUS_BLOCKED:%', v_conflicting_rollouts::text;
  end if;

  -- Clinical/configuration readiness must remain clean at the exact operation time.
  v_readiness := public.get_aba_v3_pilot_readiness(
    v_organization_id,
    v_patient_id,
    v_program_id,
    v_target_id
  );

  if coalesce((v_readiness ->> 'ready')::boolean, false) is false then
    raise exception 'ABA_V3_CANARY_PREFLIGHT_BLOCKED:%', v_readiness::text;
  end if;

  select rollout.state_version into v_clinic_version
  from public.aba_measurement_rollout_states_v3 rollout
  where rollout.organization_id = v_organization_id
    and rollout.scope_type = 'CLINIC'
    and rollout.patient_id is null
    and rollout.program_id is null
    and rollout.target_id is null;

  select rollout.state_version into v_patient_version
  from public.aba_measurement_rollout_states_v3 rollout
  where rollout.organization_id = v_organization_id
    and rollout.scope_type = 'PATIENT'
    and rollout.patient_id = v_patient_id
    and rollout.program_id is null
    and rollout.target_id is null;

  select rollout.state_version into v_target_version
  from public.aba_measurement_rollout_states_v3 rollout
  where rollout.organization_id = v_organization_id
    and rollout.scope_type = 'TARGET'
    and rollout.patient_id = v_patient_id
    and rollout.program_id = v_program_id
    and rollout.target_id = v_target_id;

  if v_clinic_version is null or v_patient_version is null or v_target_version is null then
    raise exception 'ABA_V3_CANARY_EXPECTED_ROLLOUT_STATES_MISSING';
  end if;

  -- Supported writer only. Each call is audited and optimistic-lock protected.
  perform public.set_aba_measurement_rollout_state_v3(
    p_organization_id => v_organization_id,
    p_scope_type => 'CLINIC',
    p_patient_id => null,
    p_program_id => null,
    p_target_id => null,
    p_allow_new_v3_sessions => true,
    p_accept_v3_sync => true,
    p_reason => v_reason,
    p_actor_id => v_actor_id,
    p_expected_state_version => v_clinic_version
  );

  perform public.set_aba_measurement_rollout_state_v3(
    p_organization_id => v_organization_id,
    p_scope_type => 'PATIENT',
    p_patient_id => v_patient_id,
    p_program_id => null,
    p_target_id => null,
    p_allow_new_v3_sessions => true,
    p_accept_v3_sync => true,
    p_reason => v_reason,
    p_actor_id => v_actor_id,
    p_expected_state_version => v_patient_version
  );

  perform public.set_aba_measurement_rollout_state_v3(
    p_organization_id => v_organization_id,
    p_scope_type => 'TARGET',
    p_patient_id => v_patient_id,
    p_program_id => v_program_id,
    p_target_id => v_target_id,
    p_allow_new_v3_sessions => true,
    p_accept_v3_sync => true,
    p_reason => v_reason,
    p_actor_id => v_actor_id,
    p_expected_state_version => v_target_version
  );

  v_snapshot := public.resolve_aba_measurement_rollout_snapshot_v3(
    v_organization_id,
    v_patient_id,
    v_program_id,
    v_target_id,
    clock_timestamp()
  );

  if coalesce((v_snapshot ->> 'allow_new_v3_sessions')::boolean, false) is false
     or coalesce((v_snapshot ->> 'accept_v3_sync')::boolean, false) is false then
    raise exception 'ABA_V3_CANARY_ROLLOUT_RESOLUTION_FAILED:%', v_snapshot::text;
  end if;
end;
$aba_v3_live_canary_rollout_enable$;

select jsonb_build_object(
  'gate', case
    when coalesce((resolved.snapshot ->> 'allow_new_v3_sessions')::boolean, false)
     and coalesce((resolved.snapshot ->> 'accept_v3_sync')::boolean, false)
    then 'READY_FOR_FRESH_CANARY_SESSION'
    else 'BLOCKED_ROLLOUT_NOT_RESOLVED'
  end,
  'release_stage', 'LIVE_DARK_PILOT_CANARY_ROLLOUT',
  'scope', jsonb_build_object(
    'organization_id', '1bbf0c80-dfe0-4801-8a4f-7447e06cc0d6',
    'patient_id', '1c4430cb-9d10-4469-84a9-278a4e05b65e',
    'program_id', '01a8575c-9b30-4151-8ed8-9f4319011827',
    'target_id', 'ec2e6660-a988-46d6-ab6d-41073de6a30f',
    'target_name', 'Olhar nos olhos'
  ),
  'fresh_session_required', true,
  'reuse_preexisting_session', false,
  'resolved_rollout_snapshot', resolved.snapshot,
  'states', (
    select jsonb_agg(
      jsonb_build_object(
        'scope_type', rollout.scope_type,
        'allow_new_v3_sessions', rollout.allow_new_v3_sessions,
        'accept_v3_sync', rollout.accept_v3_sync,
        'effective_from', rollout.effective_from,
        'state_version', rollout.state_version,
        'reason', rollout.reason
      ) order by
        case rollout.scope_type when 'CLINIC' then 1 when 'PATIENT' then 2 when 'TARGET' then 3 else 4 end
    )
    from public.aba_measurement_rollout_states_v3 rollout
    where rollout.organization_id = '1bbf0c80-dfe0-4801-8a4f-7447e06cc0d6'::uuid
      and (
        (rollout.scope_type = 'CLINIC' and rollout.patient_id is null and rollout.program_id is null and rollout.target_id is null)
        or
        (rollout.scope_type = 'PATIENT' and rollout.patient_id = '1c4430cb-9d10-4469-84a9-278a4e05b65e'::uuid and rollout.program_id is null and rollout.target_id is null)
        or
        (rollout.scope_type = 'TARGET'
          and rollout.patient_id = '1c4430cb-9d10-4469-84a9-278a4e05b65e'::uuid
          and rollout.program_id = '01a8575c-9b30-4151-8ed8-9f4319011827'
          and rollout.target_id = 'ec2e6660-a988-46d6-ab6d-41073de6a30f')
      )
  )
) as aba_v3_live_canary_rollout_enable_result
from lateral (
  select public.resolve_aba_measurement_rollout_snapshot_v3(
    '1bbf0c80-dfe0-4801-8a4f-7447e06cc0d6'::uuid,
    '1c4430cb-9d10-4469-84a9-278a4e05b65e'::uuid,
    '01a8575c-9b30-4151-8ed8-9f4319011827',
    'ec2e6660-a988-46d6-ab6d-41073de6a30f',
    clock_timestamp()
  ) as snapshot
) resolved;

commit;
