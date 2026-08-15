-- ABA Measurement V3 - PR12 dark preflight attestation.
-- Read-only evidence for staging preflight. No rollout row is enabled and no
-- clinical fact is written by this migration or by the attestation function.

begin;

create extension if not exists pgcrypto;

create or replace function public.get_aba_v3_preflight_scope_snapshot(
  p_organization_id uuid,
  p_patient_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_metrics jsonb;
  v_fingerprint text;
  v_enabled_rollout_count integer := 0;
begin
  if p_organization_id is null or p_patient_id is null then
    raise exception 'ABA_V3_PREFLIGHT_SNAPSHOT_SCOPE_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.patients patient
    where patient.id = p_patient_id
      and patient.clinic_id = p_organization_id::text
  ) then
    raise exception 'ABA_V3_PREFLIGHT_SNAPSHOT_PATIENT_SCOPE_INVALID';
  end if;

  -- Fixed-size aggregate set: one read per canonical surface, never one query per
  -- target/behavior. These values are evidence that a dark preflight did not mutate
  -- the selected patient scope. They intentionally exclude display-only V2 data.
  select jsonb_build_object(
    'target_bindings', jsonb_build_object(
      'count', count(*)::bigint,
      'v3_count', count(*) filter (where measurement_model_version = 'V3')::bigint,
      'latest_created_at', max(created_at)
    )
  ) into v_metrics
  from public.aba_session_target_measurement_bindings
  where organization_id = p_organization_id
    and patient_id = p_patient_id;

  v_metrics := v_metrics || jsonb_build_object(
    'collection_definitions', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'published_count', count(*) filter (where status = 'PUBLISHED')::bigint,
        'deprecated_count', count(*) filter (where status in ('DEPRECATED','ARCHIVED'))::bigint,
        'latest_created_at', max(created_at),
        'latest_deprecated_at', max(deprecated_at)
      )
      from public.aba_collection_definition_versions_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'target_phases', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_count', count(*) filter (where effective_until is null)::bigint,
        'latest_created_at', max(created_at),
        'latest_effective_until', max(effective_until)
      )
      from public.aba_target_phase_assignments_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'task_analysis_definitions', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_created_at', max(created_at)
      )
      from public.aba_task_analysis_step_definitions_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'behavior_target_bindings', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'active_count', count(*) filter (where status = 'ACTIVE')::bigint,
        'archived_count', count(*) filter (where status = 'ARCHIVED')::bigint,
        'latest_created_at', max(created_at),
        'latest_archived_at', max(archived_at)
      )
      from public.aba_behavior_target_bindings_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'behavior_bindings', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_created_at', max(created_at)
      )
      from public.aba_session_behavior_collection_bindings_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'trials', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_created_at', max(created_at),
        'latest_occurred_at', max(occurred_at)
      )
      from public.aba_trials_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'behavior_events', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_duration_count', count(*) filter (where measurement_kind = 'DURATION' and ended_at is null and status = 'ACTIVE')::bigint,
        'void_count', count(*) filter (where status = 'VOID')::bigint,
        'latest_created_at', max(created_at),
        'latest_ended_at', max(ended_at)
      )
      from public.aba_behavior_events_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'behavior_observation_slices', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_count', count(*) filter (where ended_at is null and status = 'ACTIVE')::bigint,
        'void_count', count(*) filter (where status = 'VOID')::bigint,
        'latest_created_at', max(created_at),
        'latest_ended_at', max(ended_at)
      )
      from public.aba_behavior_observation_slices_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'interval_runs', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_count', count(*) filter (where lifecycle_status = 'OPEN')::bigint,
        'latest_created_at', max(created_at),
        'latest_updated_at', max(updated_at),
        'latest_ended_at', max(ended_at)
      )
      from public.aba_interval_runs_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'interval_observations', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_created_at', max(created_at),
        'latest_interval_ended_at', max(interval_ended_at)
      )
      from public.aba_interval_observations_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'task_analysis_runs', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'complete_count', count(*) filter (where lifecycle_status = 'COMPLETE')::bigint,
        'incomplete_count', count(*) filter (where lifecycle_status = 'INCOMPLETE')::bigint,
        'cancelled_count', count(*) filter (where lifecycle_status = 'CANCELLED')::bigint,
        'latest_created_at', max(created_at),
        'latest_completed_at', max(completed_at)
      )
      from public.aba_task_analysis_runs_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'maintenance_probes', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_count', count(*) filter (where lifecycle_status = 'OPEN')::bigint,
        'review_count', count(*) filter (where requires_review)::bigint,
        'latest_created_at', max(created_at),
        'latest_updated_at', max(updated_at),
        'latest_closed_at', max(closed_at)
      )
      from public.aba_maintenance_probes_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'target_summaries', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_session_target_summaries_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'behavior_summaries', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_session_behavior_summaries_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'task_summaries', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_session_task_analysis_summaries_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'interval_summaries', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_interval_summaries_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'ioa_summaries', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_ioa_summaries_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'clinical_state', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'state_version_sum', coalesce(sum(state_version), 0)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_target_clinical_states_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'sync_quarantine', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_count', count(*) filter (where status in ('OPEN','READY_FOR_RETRY'))::bigint,
        'occurrence_sum', coalesce(sum(occurrence_count), 0)::bigint,
        'latest_last_seen_at', max(last_seen_at),
        'latest_resolved_at', max(resolved_at)
      )
      from public.aba_sync_quarantine_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),
    'rollout_state', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'enabled_count', count(*) filter (where allow_new_v3_sessions or accept_v3_sync)::bigint,
        'state_version_sum', coalesce(sum(state_version), 0)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_measurement_rollout_states_v3 state
      where state.organization_id = p_organization_id
        and (
          state.scope_type = 'CLINIC'
          or state.patient_id = p_patient_id
        )
    ),
    'rollout_events', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'max_state_version', max(event.state_version),
        'latest_occurred_at', max(event.occurred_at)
      )
      from public.aba_measurement_rollout_events_v3 event
      join public.aba_measurement_rollout_states_v3 state
        on state.id = event.rollout_state_id
      where event.organization_id = p_organization_id
        and (
          state.scope_type = 'CLINIC'
          or state.patient_id = p_patient_id
        )
    )
  );

  select count(*)::integer into v_enabled_rollout_count
  from public.aba_measurement_rollout_states_v3 state
  where state.organization_id = p_organization_id
    and (state.scope_type = 'CLINIC' or state.patient_id = p_patient_id)
    and (state.allow_new_v3_sessions or state.accept_v3_sync);

  v_fingerprint := encode(
    digest(convert_to(v_metrics::text, 'UTF8'), 'sha256'),
    'hex'
  );

  return jsonb_build_object(
    'snapshot_version', 'PR12_V1',
    'organization_id', p_organization_id,
    'patient_id', p_patient_id,
    'scope_fingerprint', v_fingerprint,
    'rollout_dark', v_enabled_rollout_count = 0,
    'enabled_rollout_count', v_enabled_rollout_count,
    'metrics', v_metrics
  );
end;
$function$;

revoke all on function public.get_aba_v3_preflight_scope_snapshot(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_aba_v3_preflight_scope_snapshot(uuid,uuid) to service_role;

commit;

-- Staging verification only. The PR12 migration itself performs no rollout mutation.
select
  to_regprocedure('public.get_aba_v3_preflight_scope_snapshot(uuid,uuid)') is not null as preflight_snapshot_rpc_ready,
  not exists (
    select 1
    from public.aba_measurement_rollout_states_v3
    where allow_new_v3_sessions = true or accept_v3_sync = true
  ) as no_v3_rollout_enabled;
