-- ABA V3 — default-on resolver policy with explicit kill switches.
--
-- New policy:
--   * eligible/readiness-green ABA targets use V3 by default;
--   * absence of rollout rows is NOT a blocker anymore;
--   * any explicit allow_new_v3_sessions=false in CLINIC/PATIENT/PROGRAM/TARGET
--     is a kill switch and wins over default-on;
--   * accept_v3_sync defaults to true, but any explicit false blocks sync;
--   * unsupported/readiness-blocked targets remain on Legacy V2 (fail-safe),
--     never error merely because metadata is absent;
--   * existing immutable session bindings remain untouched forever;
--   * emergency legacy bridges remain authoritative in the binding resolver.
--
-- This migration changes resolver semantics only. It does NOT create/delete rollout
-- rows, does NOT rewrite bindings, does NOT backfill clinical facts and does NOT
-- mutate V2 history.

begin;

create or replace function public.resolve_aba_measurement_rollout_snapshot_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_program_id text,
  p_target_id text,
  p_decision_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_clinic jsonb;
  v_patient jsonb;
  v_program jsonb;
  v_target jsonb;
  v_enrollment jsonb;
  v_enrollment_scope text;

  v_target_type text;
  v_definition_id uuid;
  v_has_definition boolean := false;
  v_has_phase boolean := false;
  v_has_task_steps boolean := false;
  v_has_behavior_mapping boolean := false;
  v_has_abc_behavior_mapping boolean := false;
  v_semantics_supported boolean := false;
  v_readiness_green boolean := false;

  v_allow_kill_switch boolean := false;
  v_sync_kill_switch boolean := false;
  v_allow boolean := false;
  v_accept boolean := true;
  v_policy_reason text;
  v_blockers jsonb := '[]'::jsonb;
begin
  if p_organization_id is null
     or p_patient_id is null
     or nullif(btrim(coalesce(p_program_id,'')), '') is null
     or nullif(btrim(coalesce(p_target_id,'')), '') is null
     or p_decision_at is null then
    raise exception 'ABA_V3_DEFAULT_ON_SCOPE_REQUIRED';
  end if;

  -- Historical rollout state as-of session.started_at.
  v_clinic := public.get_aba_rollout_scope_state_at_v3(
    p_organization_id, 'CLINIC', null, null, null, p_decision_at
  );
  v_patient := public.get_aba_rollout_scope_state_at_v3(
    p_organization_id, 'PATIENT', p_patient_id, null, null, p_decision_at
  );
  v_program := public.get_aba_rollout_scope_state_at_v3(
    p_organization_id, 'PROGRAM', p_patient_id, p_program_id, null, p_decision_at
  );
  v_target := public.get_aba_rollout_scope_state_at_v3(
    p_organization_id, 'TARGET', p_patient_id, p_program_id, p_target_id, p_decision_at
  );

  -- Most-specific persisted state is retained only for audit lineage. It is no
  -- longer required for enrollment because DEFAULT_ON is the normal policy.
  if v_target is not null then
    v_enrollment := v_target;
    v_enrollment_scope := 'TARGET';
  elsif v_program is not null then
    v_enrollment := v_program;
    v_enrollment_scope := 'PROGRAM';
  elsif v_patient is not null then
    v_enrollment := v_patient;
    v_enrollment_scope := 'PATIENT';
  elsif v_clinic is not null then
    v_enrollment := v_clinic;
    v_enrollment_scope := 'CLINIC';
  else
    v_enrollment := null;
    v_enrollment_scope := 'DEFAULT_ON';
  end if;

  -- Any explicit false is a kill switch. Missing state means inherit default-on.
  v_allow_kill_switch :=
       (v_clinic is not null and coalesce((v_clinic ->> 'allow_new_v3_sessions')::boolean,false) = false)
    or (v_patient is not null and coalesce((v_patient ->> 'allow_new_v3_sessions')::boolean,false) = false)
    or (v_program is not null and coalesce((v_program ->> 'allow_new_v3_sessions')::boolean,false) = false)
    or (v_target is not null and coalesce((v_target ->> 'allow_new_v3_sessions')::boolean,false) = false);

  v_sync_kill_switch :=
       (v_clinic is not null and coalesce((v_clinic ->> 'accept_v3_sync')::boolean,false) = false)
    or (v_patient is not null and coalesce((v_patient ->> 'accept_v3_sync')::boolean,false) = false)
    or (v_program is not null and coalesce((v_program ->> 'accept_v3_sync')::boolean,false) = false)
    or (v_target is not null and coalesce((v_target ->> 'accept_v3_sync')::boolean,false) = false);

  v_accept := not v_sync_kill_switch;

  select lower(coalesce(t.target_type,''))
    into v_target_type
  from public.aba_targets t
  where t.id = p_target_id
    and t.patient_id = p_patient_id
    and t.program_id = p_program_id
    and t.clinic_id = p_organization_id::text;

  if not found then
    v_policy_reason := 'TARGET_SCOPE_INVALID';
    v_blockers := v_blockers || jsonb_build_array('TARGET_SCOPE_INVALID');
    return jsonb_build_object(
      'decision_at', p_decision_at,
      'policy_mode', 'V3_DEFAULT_ON',
      'policy_reason', v_policy_reason,
      'target_type', null,
      'semantics_supported', false,
      'readiness_green', false,
      'allow_new_v3_sessions', false,
      'accept_v3_sync', v_accept,
      'explicit_allow_kill_switch', v_allow_kill_switch,
      'explicit_sync_kill_switch', v_sync_kill_switch,
      'blockers', v_blockers,
      'clinic', coalesce(v_clinic, 'null'::jsonb),
      'patient', coalesce(v_patient, 'null'::jsonb),
      'program', coalesce(v_program, 'null'::jsonb),
      'target', coalesce(v_target, 'null'::jsonb),
      'enrollment_scope', v_enrollment_scope,
      'enrollment_state_id', nullif(v_enrollment ->> 'id', ''),
      'enrollment_state_version', nullif(v_enrollment ->> 'state_version', '')
    );
  end if;

  -- Definition valid for the exact session-start instant.
  select d.id
    into v_definition_id
  from public.aba_collection_definition_versions_v3 d
  where d.organization_id = p_organization_id
    and d.patient_id = p_patient_id
    and d.program_id = p_program_id
    and d.target_id = p_target_id
    and d.status in ('PUBLISHED','DEPRECATED','ARCHIVED')
    and d.published_at <= p_decision_at
    and (d.deprecated_at is null or p_decision_at < d.deprecated_at)
  order by d.version desc
  limit 1;
  v_has_definition := found;

  select exists (
    select 1
    from public.aba_target_phase_assignments_v3 ph
    where ph.organization_id = p_organization_id
      and ph.patient_id = p_patient_id
      and ph.program_id = p_program_id
      and ph.target_id = p_target_id
      and ph.effective_from <= p_decision_at
      and (ph.effective_until is null or p_decision_at < ph.effective_until)
  ) into v_has_phase;

  if v_target_type = 'task_analysis' and v_definition_id is not null then
    select exists (
      select 1
      from public.aba_task_analysis_step_definitions_v3 st
      where st.collection_definition_version_id = v_definition_id
    ) into v_has_task_steps;
  end if;

  if v_target_type = 'behavior' then
    select exists (
      select 1
      from public.aba_behavior_target_bindings_v3 b
      join public.aba_behavior_definitions bd
        on bd.id = b.behavior_id
       and bd.patient_id = b.patient_id
       and bd.clinic_id = b.organization_id::text
      where b.organization_id = p_organization_id
        and b.patient_id = p_patient_id
        and b.target_id = p_target_id
        and b.status = 'ACTIVE'
        and b.created_at <= p_decision_at
        and lower(coalesce(bd.measurement_type,'')) <> 'abc'
    ) into v_has_behavior_mapping;

    select exists (
      select 1
      from public.aba_behavior_target_bindings_v3 b
      join public.aba_behavior_definitions bd
        on bd.id = b.behavior_id
       and bd.patient_id = b.patient_id
       and bd.clinic_id = b.organization_id::text
      where b.organization_id = p_organization_id
        and b.patient_id = p_patient_id
        and b.target_id = p_target_id
        and b.status = 'ACTIVE'
        and b.created_at <= p_decision_at
        and lower(coalesce(bd.measurement_type,'')) = 'abc'
    ) into v_has_abc_behavior_mapping;
  end if;

  v_semantics_supported := v_target_type in ('dtt','net','probe','task_analysis','behavior');

  if not v_semantics_supported then
    v_blockers := v_blockers || jsonb_build_array('UNSUPPORTED_TARGET_SEMANTICS');
  end if;
  if not v_has_definition then
    v_blockers := v_blockers || jsonb_build_array('MISSING_PUBLISHED_COLLECTION_DEFINITION');
  end if;
  if not v_has_phase then
    v_blockers := v_blockers || jsonb_build_array('MISSING_ACTIVE_TARGET_PHASE');
  end if;
  if v_target_type = 'task_analysis' and not v_has_task_steps then
    v_blockers := v_blockers || jsonb_build_array('TASK_ANALYSIS_STEPS_MISSING');
  end if;
  if v_target_type = 'behavior' and not v_has_behavior_mapping then
    v_blockers := v_blockers || jsonb_build_array('BEHAVIOR_MAPPING_MISSING');
  end if;
  if v_target_type = 'behavior' and v_has_abc_behavior_mapping then
    v_blockers := v_blockers || jsonb_build_array('ABC_V3_MAPPING_FORBIDDEN');
  end if;

  v_readiness_green := jsonb_array_length(v_blockers) = 0;
  v_allow := v_readiness_green and not v_allow_kill_switch;

  v_policy_reason := case
    when v_allow_kill_switch then 'EXPLICIT_KILL_SWITCH'
    when not v_readiness_green then 'READINESS_OR_SEMANTICS_FALLBACK'
    else 'DEFAULT_ON_ELIGIBLE'
  end;

  return jsonb_build_object(
    'decision_at', p_decision_at,
    'policy_mode', 'V3_DEFAULT_ON',
    'policy_reason', v_policy_reason,
    'target_type', v_target_type,
    'semantics_supported', v_semantics_supported,
    'readiness_green', v_readiness_green,
    'allow_new_v3_sessions', v_allow,
    'accept_v3_sync', v_accept,
    'explicit_allow_kill_switch', v_allow_kill_switch,
    'explicit_sync_kill_switch', v_sync_kill_switch,
    'blockers', v_blockers,
    'clinic', coalesce(v_clinic, 'null'::jsonb),
    'patient', coalesce(v_patient, 'null'::jsonb),
    'program', coalesce(v_program, 'null'::jsonb),
    'target', coalesce(v_target, 'null'::jsonb),
    'enrollment_scope', v_enrollment_scope,
    'enrollment_state_id', nullif(v_enrollment ->> 'id', ''),
    'enrollment_state_version', nullif(v_enrollment ->> 'state_version', '')
  );
end;
$function$;

-- Preserve the hardened execution boundary.
revoke all on function public.resolve_aba_measurement_rollout_snapshot_v3(uuid,uuid,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.resolve_aba_measurement_rollout_snapshot_v3(uuid,uuid,text,text,timestamptz)
  to service_role;

-- Fail closed if the resolver or ACL disappeared during install.
do $attest$
begin
  if to_regprocedure('public.resolve_aba_measurement_rollout_snapshot_v3(uuid,uuid,text,text,timestamptz)') is null then
    raise exception 'ABA_V3_DEFAULT_ON_RESOLVER_MISSING';
  end if;
  if coalesce(pg_catalog.has_function_privilege(
      'anon',
      pg_catalog.to_regprocedure('public.resolve_aba_measurement_rollout_snapshot_v3(uuid,uuid,text,text,timestamptz)'),
      'EXECUTE'
    ), true)
    or coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      pg_catalog.to_regprocedure('public.resolve_aba_measurement_rollout_snapshot_v3(uuid,uuid,text,text,timestamptz)'),
      'EXECUTE'
    ), true) then
    raise exception 'ABA_V3_DEFAULT_ON_RESOLVER_BROWSER_EXECUTE_OPEN';
  end if;
  if coalesce(pg_catalog.has_function_privilege(
      'service_role',
      pg_catalog.to_regprocedure('public.resolve_aba_measurement_rollout_snapshot_v3(uuid,uuid,text,text,timestamptz)'),
      'EXECUTE'
    ), false) is false then
    raise exception 'ABA_V3_DEFAULT_ON_RESOLVER_SERVICE_ROLE_EXECUTE_MISSING';
  end if;
end;
$attest$;

commit;

-- Installation attestation. The currently disabled DEMO cohort should remain off;
-- this query intentionally does not create/enable/disable any rollout row.
with target_scope as (
  select
    t.id as target_id,
    t.patient_id,
    t.program_id,
    t.clinic_id,
    public.resolve_aba_measurement_rollout_snapshot_v3(
      t.clinic_id::uuid,
      t.patient_id,
      t.program_id,
      t.id,
      clock_timestamp()
    ) as snapshot
  from public.aba_targets t
), summary as (
  select
    count(*)::integer as target_count,
    count(*) filter (
      where coalesce((snapshot->>'allow_new_v3_sessions')::boolean,false)
    )::integer as effective_v3_default_on_count,
    count(*) filter (
      where coalesce((snapshot->>'explicit_allow_kill_switch')::boolean,false)
    )::integer as explicit_kill_switch_count,
    count(*) filter (
      where snapshot->>'policy_reason' = 'READINESS_OR_SEMANTICS_FALLBACK'
    )::integer as readiness_fallback_count
  from target_scope
)
select jsonb_build_object(
  'gate','ABA_V3_DEFAULT_ON_RESOLVER_POLICY_INSTALLED',
  'policy_mode','V3_DEFAULT_ON',
  'absence_of_rollout_state_means','DEFAULT_ON_IF_ELIGIBLE',
  'explicit_false_means','KILL_SWITCH',
  'legacy_v2_policy','EXISTING_BINDINGS_HISTORY_EMERGENCY_BRIDGE_AND_READINESS_FALLBACK_ONLY',
  'target_count',summary.target_count,
  'effective_v3_default_on_count',summary.effective_v3_default_on_count,
  'explicit_kill_switch_count',summary.explicit_kill_switch_count,
  'readiness_fallback_count',summary.readiness_fallback_count,
  'browser_execute',false,
  'rollout_rows_mutated',false,
  'bindings_rewritten',false
) as aba_v3_default_on_resolver_policy_install
from summary;
