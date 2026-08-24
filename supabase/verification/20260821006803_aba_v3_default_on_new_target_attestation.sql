-- ABA V3 — read-only attestation for a brand-new target under DEFAULT_ON.
-- Verifies that protocol metadata was auto-bootstrapped and that the target
-- resolves to V3 without a target-level rollout enrollment row.

with target_scope as (
  select
    t.id as target_id,
    t.patient_id,
    t.program_id,
    t.clinic_id,
    t.name,
    t.target_type,
    t.phase,
    t.created_at
  from public.aba_targets t
  where t.patient_id = 'dc739da0-4626-4cf8-a339-30e431283a4a'::uuid
    and t.name ilike '%Canário V3 Default-On%'
  order by t.created_at desc
  limit 1
), inspected as (
  select
    ts.*,
    (
      select count(*)::integer
      from public.aba_collection_definition_versions_v3 d
      where d.organization_id = ts.clinic_id::uuid
        and d.patient_id = ts.patient_id
        and d.program_id = ts.program_id
        and d.target_id = ts.target_id
        and d.status = 'PUBLISHED'
        and d.deprecated_at is null
        and d.published_at <= clock_timestamp()
    ) as active_published_definition_count,
    (
      select count(*)::integer
      from public.aba_target_phase_assignments_v3 ph
      where ph.organization_id = ts.clinic_id::uuid
        and ph.patient_id = ts.patient_id
        and ph.program_id = ts.program_id
        and ph.target_id = ts.target_id
        and ph.effective_from <= clock_timestamp()
        and (ph.effective_until is null or clock_timestamp() < ph.effective_until)
    ) as active_phase_count,
    (
      select count(*)::integer
      from public.aba_measurement_rollout_states_v3 r
      where r.organization_id = ts.clinic_id::uuid
        and r.scope_type = 'TARGET'
        and r.patient_id = ts.patient_id
        and r.program_id = ts.program_id
        and r.target_id = ts.target_id
    ) as target_rollout_row_count,
    (
      select count(*)::integer
      from public.aba_session_target_measurement_bindings b
      where b.organization_id = ts.clinic_id::uuid
        and b.patient_id = ts.patient_id
        and b.program_id = ts.program_id
        and b.target_id = ts.target_id
    ) as existing_binding_count,
    public.resolve_aba_measurement_rollout_snapshot_v3(
      ts.clinic_id::uuid,
      ts.patient_id,
      ts.program_id,
      ts.target_id,
      clock_timestamp()
    ) as resolver_snapshot
  from target_scope ts
)
select jsonb_build_object(
  'gate', case
    when not exists (select 1 from inspected) then 'BLOCKED_NEW_TARGET_NOT_FOUND'
    when active_published_definition_count <> 1 then 'BLOCKED_AUTObootstrap_DEFINITION'
    when active_phase_count <> 1 then 'BLOCKED_AUTObootstrap_PHASE'
    when target_rollout_row_count <> 0 then 'BLOCKED_TARGET_LEVEL_ROLLOUT_ROW_EXISTS'
    when resolver_snapshot->>'policy_mode' <> 'V3_DEFAULT_ON' then 'BLOCKED_POLICY_NOT_DEFAULT_ON'
    when resolver_snapshot->>'policy_reason' <> 'DEFAULT_ON_ELIGIBLE' then 'BLOCKED_DEFAULT_ON_NOT_ELIGIBLE'
    when coalesce((resolver_snapshot->>'explicit_allow_kill_switch')::boolean,false) then 'BLOCKED_EXPLICIT_KILL_SWITCH'
    when coalesce((resolver_snapshot->>'allow_new_v3_sessions')::boolean,false) is not true then 'BLOCKED_V3_NOT_EFFECTIVE'
    when coalesce((resolver_snapshot->>'accept_v3_sync')::boolean,false) is not true then 'BLOCKED_V3_SYNC_NOT_ACCEPTED'
    else 'PASS_DEFAULT_ON_NEW_TARGET_READY'
  end,
  'writes', false,
  'target', jsonb_build_object(
    'target_id', target_id,
    'patient_id', patient_id,
    'program_id', program_id,
    'organization_id', clinic_id,
    'name', name,
    'target_type', target_type,
    'phase', phase,
    'created_at', created_at
  ),
  'autobootstrap', jsonb_build_object(
    'active_published_definition_count', active_published_definition_count,
    'active_phase_count', active_phase_count
  ),
  'rollout', jsonb_build_object(
    'target_rollout_row_count', target_rollout_row_count,
    'existing_binding_count', existing_binding_count,
    'policy_mode', resolver_snapshot->>'policy_mode',
    'policy_reason', resolver_snapshot->>'policy_reason',
    'enrollment_scope', resolver_snapshot->>'enrollment_scope',
    'explicit_allow_kill_switch', coalesce((resolver_snapshot->>'explicit_allow_kill_switch')::boolean,false),
    'allow_new_v3_sessions', coalesce((resolver_snapshot->>'allow_new_v3_sessions')::boolean,false),
    'accept_v3_sync', coalesce((resolver_snapshot->>'accept_v3_sync')::boolean,false),
    'blockers', coalesce(resolver_snapshot->'blockers','[]'::jsonb)
  ),
  'resolver_snapshot', resolver_snapshot
) as aba_v3_default_on_new_target_attestation
from inspected
union all
select jsonb_build_object(
  'gate','BLOCKED_NEW_TARGET_NOT_FOUND',
  'writes',false,
  'expected_patient_id','dc739da0-4626-4cf8-a339-30e431283a4a',
  'expected_target_name_like','%Canário V3 Default-On%'
)
where not exists (select 1 from inspected);
