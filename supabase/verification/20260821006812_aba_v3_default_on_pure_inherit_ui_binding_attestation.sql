-- ABA V3 DEFAULT-ON — pure DEFAULT/INHERIT UI binding attestation.
--
-- Exact purpose:
--   Prove that a fresh session created AFTER retiring the legacy positive canary
--   overrides binds to V3 with no active CLINIC/PATIENT/PROGRAM/TARGET enrollment
--   state. The user only opened the ABA V3 outcome modal; no clinical attempt is
--   required for this attestation.
--
-- Safety: READ ONLY. No rollout, binding, session, trial or clinical row is changed.

with scope as (
  select
    '79b1a8f9-ab9d-43dc-b57d-3afca67b553b'::uuid as organization_id,
    'dc739da0-4626-4cf8-a339-30e431283a4a'::uuid as patient_id,
    '0098fd66-ea15-4c98-b77c-86e2aacf98ed'::text as program_id,
    'bfe16695-72c9-4777-8f40-b39607683f70'::text as target_id
), retirement as (
  select
    max(r.effective_from) as retired_at,
    count(*) filter (where r.override_active is false)::integer as retired_override_count,
    count(*) filter (where coalesce(r.override_active, true) is true)::integer as still_active_legacy_override_count
  from public.aba_measurement_rollout_states_v3 r
  where r.id in (
    '49a40cb3-143c-4802-9ac5-334298cc7a5f'::uuid,
    'd0f1a614-0dc0-4862-b6d7-862728e0a1b0'::uuid
  )
), active_relevant_overrides as (
  select count(*)::integer as active_override_count
  from public.aba_measurement_rollout_states_v3 r
  cross join scope s
  where r.organization_id = s.organization_id
    and coalesce(r.override_active, true) is true
    and (
      r.scope_type = 'CLINIC'
      or (r.scope_type = 'PATIENT' and r.patient_id = s.patient_id)
      or (r.scope_type = 'PROGRAM' and r.patient_id = s.patient_id and r.program_id = s.program_id)
      or (r.scope_type = 'TARGET' and r.patient_id = s.patient_id and r.program_id = s.program_id and r.target_id = s.target_id)
    )
), resolver_now as (
  select public.resolve_aba_measurement_rollout_snapshot_v3(
    s.organization_id,
    s.patient_id,
    s.program_id,
    s.target_id,
    clock_timestamp()
  ) as snapshot
  from scope s
), candidate_sessions as (
  select
    s.id as session_id,
    s.started_at,
    s.ended_at,
    s.status,
    s.reference_date,
    b.id as binding_id,
    b.measurement_model_version,
    b.binding_source,
    b.binding_reason,
    b.rollout_state_id,
    b.rollout_state_version,
    b.rollout_snapshot,
    b.collection_definition_version_id,
    b.target_phase_assignment_id
  from scope sc
  cross join retirement rt
  join public.aba_sessions s
    on s.clinic_id = sc.organization_id::text
   and s.patient_id = sc.patient_id
   and s.started_at >= rt.retired_at
  join public.aba_session_target_measurement_bindings b
    on b.organization_id = sc.organization_id
   and b.patient_id = sc.patient_id
   and b.session_id = s.id
   and b.program_id = sc.program_id
   and b.target_id = sc.target_id
), selected as (
  select *
  from candidate_sessions
  order by started_at desc, session_id desc
  limit 1
), facts as (
  select
    sc.organization_id,
    sc.patient_id,
    sc.program_id,
    sc.target_id,
    rt.retired_at,
    rt.retired_override_count,
    rt.still_active_legacy_override_count,
    aro.active_override_count,
    rn.snapshot as resolver_snapshot,
    sel.*,
    (
      select count(*)::integer
      from public.aba_trials_v3 t
      where t.organization_id = sc.organization_id
        and t.patient_id = sc.patient_id
        and t.session_id = sel.session_id
        and t.target_id = sc.target_id
    ) as v3_trial_count,
    (
      select count(*)::integer
      from public.aba_trials t
      where t.clinic_id = sc.organization_id::text
        and t.patient_id::text = sc.patient_id::text
        and t.session_id = sel.session_id
        and t.target_id = sc.target_id
    ) as legacy_v2_trial_count,
    public.get_clinical_measurement_v3_security_preflight() as security_preflight
  from scope sc
  cross join retirement rt
  cross join active_relevant_overrides aro
  cross join resolver_now rn
  left join selected sel on true
), verdict as (
  select
    f.*,
    case
      when f.retired_override_count <> 2
        then jsonb_build_object('gate','BLOCKED_LEGACY_OVERRIDES_NOT_RETIRED','observed',f.retired_override_count,'required',2)
      when f.still_active_legacy_override_count <> 0
        then jsonb_build_object('gate','BLOCKED_LEGACY_OVERRIDE_STILL_ACTIVE','observed',f.still_active_legacy_override_count)
      when f.active_override_count <> 0
        then jsonb_build_object('gate','BLOCKED_RELEVANT_ACTIVE_OVERRIDE_EXISTS','observed',f.active_override_count)
      when coalesce(f.resolver_snapshot->>'policy_mode','') <> 'V3_DEFAULT_ON'
        then jsonb_build_object('gate','BLOCKED_RESOLVER_POLICY_MODE','snapshot',f.resolver_snapshot)
      when coalesce(f.resolver_snapshot->>'policy_reason','') <> 'DEFAULT_ON_ELIGIBLE'
        then jsonb_build_object('gate','BLOCKED_RESOLVER_POLICY_REASON','snapshot',f.resolver_snapshot)
      when coalesce(f.resolver_snapshot->>'enrollment_scope','') <> 'DEFAULT_ON'
        then jsonb_build_object('gate','BLOCKED_RESOLVER_NOT_PURE_DEFAULT_ON','snapshot',f.resolver_snapshot)
      when nullif(f.resolver_snapshot->>'enrollment_state_id','') is not null
        then jsonb_build_object('gate','BLOCKED_RESOLVER_HAS_ENROLLMENT_STATE','snapshot',f.resolver_snapshot)
      when coalesce((f.resolver_snapshot->>'explicit_allow_kill_switch')::boolean,false) is true
        then jsonb_build_object('gate','BLOCKED_RESOLVER_ALLOW_KILL_SWITCH','snapshot',f.resolver_snapshot)
      when coalesce((f.resolver_snapshot->>'explicit_sync_kill_switch')::boolean,false) is true
        then jsonb_build_object('gate','BLOCKED_RESOLVER_SYNC_KILL_SWITCH','snapshot',f.resolver_snapshot)
      when coalesce((f.resolver_snapshot->>'readiness_green')::boolean,false) is not true
        then jsonb_build_object('gate','BLOCKED_RESOLVER_READINESS','snapshot',f.resolver_snapshot)
      when f.session_id is null
        then jsonb_build_object('gate','BLOCKED_NO_FRESH_POST_RETIREMENT_SESSION')
      when f.measurement_model_version <> 'V3'
        then jsonb_build_object('gate','BLOCKED_FRESH_SESSION_BINDING_NOT_V3','observed',f.measurement_model_version)
      when f.binding_source <> 'SERVER_RESOLVER'
        then jsonb_build_object('gate','BLOCKED_FRESH_SESSION_BINDING_SOURCE','observed',f.binding_source)
      when f.rollout_state_id is not null or f.rollout_state_version is not null
        then jsonb_build_object('gate','BLOCKED_FRESH_BINDING_REFERENCES_ENROLLMENT_STATE','rollout_state_id',f.rollout_state_id,'rollout_state_version',f.rollout_state_version)
      when coalesce(f.rollout_snapshot->>'policy_mode','') <> 'V3_DEFAULT_ON'
        then jsonb_build_object('gate','BLOCKED_FROZEN_BINDING_POLICY_MODE','snapshot',f.rollout_snapshot)
      when coalesce(f.rollout_snapshot->>'policy_reason','') <> 'DEFAULT_ON_ELIGIBLE'
        then jsonb_build_object('gate','BLOCKED_FROZEN_BINDING_POLICY_REASON','snapshot',f.rollout_snapshot)
      when coalesce(f.rollout_snapshot->>'enrollment_scope','') <> 'DEFAULT_ON'
        then jsonb_build_object('gate','BLOCKED_FROZEN_BINDING_NOT_PURE_DEFAULT_ON','snapshot',f.rollout_snapshot)
      when nullif(f.rollout_snapshot->>'enrollment_state_id','') is not null
        then jsonb_build_object('gate','BLOCKED_FROZEN_BINDING_HAS_ENROLLMENT_STATE','snapshot',f.rollout_snapshot)
      when f.collection_definition_version_id is null or f.target_phase_assignment_id is null
        then jsonb_build_object('gate','BLOCKED_FRESH_BINDING_METADATA_INCOMPLETE')
      when f.v3_trial_count <> 0 or f.legacy_v2_trial_count <> 0
        then jsonb_build_object('gate','BLOCKED_UI_ONLY_PROBE_ALREADY_WROTE_TRIALS','v3_trial_count',f.v3_trial_count,'legacy_v2_trial_count',f.legacy_v2_trial_count)
      when coalesce((f.security_preflight->>'ok')::boolean,false) is not true
        then jsonb_build_object('gate','BLOCKED_SECURITY_PREFLIGHT','security_preflight',f.security_preflight)
      else jsonb_build_object('gate','PASS_PURE_DEFAULT_ON_FRESH_SESSION_BINDING')
    end as gate_result
  from facts f
)
select jsonb_build_object(
  'gate', gate_result->>'gate',
  'release_stage', 'ABA_V3_DEFAULT_ON_GLOBAL_PRODUCTION_FINAL',
  'scope', jsonb_build_object(
    'organization_id', organization_id,
    'patient_id', patient_id,
    'program_id', program_id,
    'target_id', target_id,
    'session_id', session_id,
    'session_started_at', started_at,
    'session_status', status,
    'clinical_date', reference_date
  ),
  'pure_default_on_proof', jsonb_build_object(
    'retired_override_count', retired_override_count,
    'active_relevant_override_count', active_override_count,
    'resolver_enrollment_scope', resolver_snapshot->>'enrollment_scope',
    'resolver_enrollment_state_id', resolver_snapshot->'enrollment_state_id',
    'resolver_policy_mode', resolver_snapshot->>'policy_mode',
    'resolver_policy_reason', resolver_snapshot->>'policy_reason',
    'binding_model', measurement_model_version,
    'binding_source', binding_source,
    'binding_reason', binding_reason,
    'binding_rollout_state_id', rollout_state_id,
    'binding_rollout_state_version', rollout_state_version,
    'binding_enrollment_scope', rollout_snapshot->>'enrollment_scope',
    'binding_enrollment_state_id', rollout_snapshot->'enrollment_state_id',
    'definition_pinned', collection_definition_version_id is not null,
    'phase_pinned', target_phase_assignment_id is not null
  ),
  'ui_probe_persistence', jsonb_build_object(
    'v3_trial_count', v3_trial_count,
    'legacy_v2_trial_count', legacy_v2_trial_count,
    'expected', 'ZERO_WRITES_BEFORE_MODAL_SELECTION'
  ),
  'security_preflight', security_preflight,
  'writes', false,
  'details_if_blocked', case when gate_result->>'gate' like 'PASS_%' then null else gate_result end
) as aba_v3_default_on_pure_inherit_ui_binding_attestation
from verdict;
