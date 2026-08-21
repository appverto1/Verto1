-- ABA Measurement V3 — operational snapshot clock hotfix.
--
-- Fixes same-transaction activation postcondition in the Super Admin Control Center.
-- The canonical rollout writer stamps effective_from with clock_timestamp(), while
-- PostgreSQL now() is frozen at transaction start. The operational snapshot is a
-- current-state view, so it must resolve rollout using the wall clock rather than
-- the transaction-start timestamp.
--
-- No rollout state is mutated by this migration.

begin;

create or replace function public.get_aba_v3_exact_target_cohort_snapshot_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_program_id text,
  p_target_id text
)
returns jsonb
language plpgsql
volatile
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
    p_organization_id, p_patient_id, p_program_id, p_target_id, clock_timestamp()
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
    'checked_at', clock_timestamp(),
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

revoke all on function public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text) to service_role;

commit;

select jsonb_build_object(
  'gate', case
    when to_regprocedure('public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text)') is null
      then 'BLOCKED_SNAPSHOT_RPC_MISSING'
    when has_function_privilege('authenticated','public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text)','EXECUTE')
      then 'BLOCKED_BROWSER_EXECUTE'
    when not has_function_privilege('service_role','public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text)','EXECUTE')
      then 'BLOCKED_SERVICE_ROLE_EXECUTE'
    else 'ABA_V3_OPERATIONAL_SNAPSHOT_CLOCK_HOTFIX_READY'
  end,
  'snapshot_rpc_ready', to_regprocedure('public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text)') is not null,
  'browser_snapshot_execute', has_function_privilege('authenticated','public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text)','EXECUTE'),
  'service_role_snapshot_execute', has_function_privilege('service_role','public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text)','EXECUTE'),
  'rollout_mutated', false
) as aba_v3_operational_snapshot_clock_hotfix_install;
