-- ABA V3 default-on — global production readiness inventory.
-- READ ONLY. No rollout, protocol, clinical or legacy data is mutated.
-- Purpose: quantify exactly what can move to V3-by-default before changing resolver semantics.

with
security as (
  select public.get_clinical_measurement_v3_security_preflight() as result
),
target_scope as (
  select
    t.id as target_id,
    t.patient_id,
    t.program_id,
    t.clinic_id,
    lower(coalesce(t.target_type, '')) as target_type,
    lower(coalesce(t.phase, '')) as target_phase,
    lower(coalesce(p.status, '')) as program_status,
    p.name as program_name,
    t.name as target_name
  from public.aba_targets t
  left join public.aba_programs p
    on p.id = t.program_id
   and p.patient_id = t.patient_id
   and p.clinic_id = t.clinic_id
),
target_health as (
  select
    ts.*,
    (ts.target_type in ('dtt','net','probe')) as atomic_trial_supported,
    (ts.target_type = 'task_analysis') as task_analysis_target,
    (ts.target_type = 'behavior') as behavior_target,
    exists (
      select 1
      from public.aba_collection_definition_versions_v3 d
      where d.patient_id = ts.patient_id
        and d.program_id = ts.program_id
        and d.target_id = ts.target_id
        and d.organization_id::text = ts.clinic_id
        and d.status = 'PUBLISHED'
        and d.deprecated_at is null
        and d.published_at <= clock_timestamp()
    ) as has_published_definition,
    exists (
      select 1
      from public.aba_target_phase_assignments_v3 ph
      where ph.patient_id = ts.patient_id
        and ph.program_id = ts.program_id
        and ph.target_id = ts.target_id
        and ph.organization_id::text = ts.clinic_id
        and ph.effective_from <= clock_timestamp()
        and (ph.effective_until is null or clock_timestamp() < ph.effective_until)
    ) as has_active_phase,
    exists (
      select 1
      from public.aba_collection_definition_versions_v3 d
      join public.aba_task_analysis_step_definitions_v3 st
        on st.collection_definition_version_id = d.id
      where d.patient_id = ts.patient_id
        and d.program_id = ts.program_id
        and d.target_id = ts.target_id
        and d.organization_id::text = ts.clinic_id
        and d.status = 'PUBLISHED'
        and d.deprecated_at is null
    ) as has_task_analysis_steps,
    exists (
      select 1
      from public.aba_behavior_target_bindings_v3 b
      where b.patient_id = ts.patient_id
        and b.target_id = ts.target_id
        and b.organization_id::text = ts.clinic_id
        and b.status = 'ACTIVE'
    ) as has_active_behavior_mapping
  from target_scope ts
),
rollout as (
  select
    count(*)::integer as state_count,
    count(*) filter (where allow_new_v3_sessions is true)::integer as enabled_count,
    count(*) filter (where allow_new_v3_sessions is false)::integer as explicit_disabled_count,
    count(*) filter (where accept_v3_sync is false)::integer as sync_disabled_count,
    count(*) filter (where scope_type = 'CLINIC')::integer as clinic_state_count,
    count(*) filter (where scope_type = 'PATIENT')::integer as patient_state_count,
    count(*) filter (where scope_type = 'PROGRAM')::integer as program_state_count,
    count(*) filter (where scope_type = 'TARGET')::integer as target_state_count
  from public.aba_measurement_rollout_states_v3
),
activity as (
  select
    (select count(*)::integer from public.aba_session_target_measurement_bindings where measurement_model_version = 'V3') as v3_binding_count,
    (select count(*)::integer from public.aba_session_target_measurement_bindings where measurement_model_version = 'LEGACY_V2') as frozen_v2_binding_count,
    (select count(*)::integer from public.aba_sessions where lower(coalesce(status,'')) in ('active','in_progress')) as open_session_count,
    (select count(*)::integer from public.aba_sync_quarantine_v3 where status in ('OPEN','READY_FOR_RETRY')) as unresolved_quarantine_count
),
summary as (
  select
    count(*)::integer as total_targets,
    count(distinct patient_id)::integer as patients_with_targets,
    count(distinct clinic_id)::integer as clinics_with_targets,
    count(*) filter (where atomic_trial_supported)::integer as atomic_trial_supported_targets,
    count(*) filter (where atomic_trial_supported and has_published_definition and has_active_phase)::integer as atomic_trial_ready_now,
    count(*) filter (where atomic_trial_supported and not has_published_definition)::integer as atomic_trial_missing_definition,
    count(*) filter (where atomic_trial_supported and not has_active_phase)::integer as atomic_trial_missing_phase,
    count(*) filter (where task_analysis_target)::integer as task_analysis_targets,
    count(*) filter (where task_analysis_target and has_published_definition and has_active_phase and has_task_analysis_steps)::integer as task_analysis_ready_now,
    count(*) filter (where behavior_target)::integer as behavior_targets,
    count(*) filter (where behavior_target and has_active_behavior_mapping and has_published_definition and has_active_phase)::integer as behavior_ready_now,
    count(*) filter (where target_type not in ('dtt','net','probe','task_analysis','behavior'))::integer as other_or_legacy_only_targets
  from target_health
),
type_counts as (
  select coalesce(jsonb_object_agg(target_type, cnt order by target_type), '{}'::jsonb) as value
  from (
    select coalesce(nullif(target_type,''),'unknown') as target_type, count(*)::integer as cnt
    from target_health
    group by 1
  ) x
),
blocker_examples as (
  select coalesce(jsonb_agg(to_jsonb(x) order by x.clinic_id, x.patient_id::text, x.program_id, x.target_id), '[]'::jsonb) as value
  from (
    select
      clinic_id,
      patient_id,
      program_id,
      target_id,
      target_name,
      target_type,
      program_status,
      has_published_definition,
      has_active_phase,
      case
        when atomic_trial_supported and not has_published_definition and not has_active_phase then 'MISSING_DEFINITION_AND_PHASE'
        when atomic_trial_supported and not has_published_definition then 'MISSING_DEFINITION'
        when atomic_trial_supported and not has_active_phase then 'MISSING_PHASE'
        when task_analysis_target and not has_task_analysis_steps then 'TASK_ANALYSIS_STEPS_MISSING'
        when behavior_target and not has_active_behavior_mapping then 'BEHAVIOR_MAPPING_MISSING'
        else 'OTHER'
      end as blocker
    from target_health
    where
      (atomic_trial_supported and (not has_published_definition or not has_active_phase))
      or (task_analysis_target and (not has_published_definition or not has_active_phase or not has_task_analysis_steps))
      or (behavior_target and (not has_published_definition or not has_active_phase or not has_active_behavior_mapping))
    limit 25
  ) x
)
select jsonb_build_object(
  'gate', case
    when coalesce((security.result->>'ok')::boolean,false) is false then 'BLOCKED_SECURITY_PREFLIGHT'
    when activity.unresolved_quarantine_count <> 0 then 'BLOCKED_SYNC_QUARANTINE'
    when summary.atomic_trial_supported_targets = 0 then 'BLOCKED_NO_ATOMIC_TRIAL_TARGETS'
    when summary.atomic_trial_missing_definition <> 0 or summary.atomic_trial_missing_phase <> 0 then 'PROTOCOL_BACKFILL_REQUIRED_BEFORE_DEFAULT_ON'
    else 'READY_TO_PREPARE_DEFAULT_ON_POLICY'
  end,
  'writes', false,
  'checked_at', clock_timestamp(),
  'policy_under_evaluation', jsonb_build_object(
    'normal', 'V3_BY_DEFAULT_FOR_ELIGIBLE_ABA_TARGETS',
    'legacy_v2', 'HISTORY_EXISTING_BINDINGS_AND_EXPLICIT_FALLBACK_ONLY',
    'exceptions', jsonb_build_array('EXPLICIT_KILL_SWITCH','EMERGENCY_LEGACY_BRIDGE','UNSUPPORTED_TARGET_SEMANTICS','READINESS_BLOCKER')
  ),
  'coverage', jsonb_build_object(
    'clinics_with_targets', summary.clinics_with_targets,
    'patients_with_targets', summary.patients_with_targets,
    'total_targets', summary.total_targets,
    'target_types', type_counts.value,
    'atomic_trial_supported_targets', summary.atomic_trial_supported_targets,
    'atomic_trial_ready_now', summary.atomic_trial_ready_now,
    'atomic_trial_missing_definition', summary.atomic_trial_missing_definition,
    'atomic_trial_missing_phase', summary.atomic_trial_missing_phase,
    'task_analysis_targets', summary.task_analysis_targets,
    'task_analysis_ready_now', summary.task_analysis_ready_now,
    'behavior_targets', summary.behavior_targets,
    'behavior_ready_now', summary.behavior_ready_now,
    'other_or_legacy_only_targets', summary.other_or_legacy_only_targets
  ),
  'current_rollout_state', to_jsonb(rollout),
  'current_activity', to_jsonb(activity),
  'security_preflight', security.result,
  'blocker_examples', blocker_examples.value,
  'next_if_protocol_backfill_required', 'CREATE_IDEMPOTENT_PROTOCOL_BACKFILL_AND_FUTURE_TARGET_BOOTSTRAP_WITHOUT_CHANGING_ROLLOUT_SEMANTICS',
  'next_if_ready', 'INSTALL_DEFAULT_ON_RESOLVER_POLICY_WITH_EXPLICIT_KILL_SWITCH_EXCEPTIONS'
) as aba_v3_default_on_global_readiness_inventory
from summary, type_counts, blocker_examples, rollout, activity, security;
