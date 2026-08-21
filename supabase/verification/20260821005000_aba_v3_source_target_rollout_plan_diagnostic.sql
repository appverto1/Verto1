-- ABA Measurement V3 - source target rollout/plan diagnostic.
-- READ ONLY. No writes, no rollout mutation, no binding creation.
-- Purpose: explain why a fresh completed session for the shadow source target was persisted as Legacy V2.

with shadow_scope as (
  select
    link.organization_id,
    link.patient_id,
    link.source_target_id,
    max(link.mirrored_at) as last_mirrored_at
  from public.clinical_measurement_shadow_mirror_links_v3 link
  group by link.organization_id, link.patient_id, link.source_target_id
  order by max(link.mirrored_at) desc,
           link.organization_id::text,
           link.patient_id::text,
           link.source_target_id
  limit 1
),
target_scope as (
  select
    scope.organization_id,
    scope.patient_id,
    scope.source_target_id,
    scope.last_mirrored_at,
    target.program_id,
    target.name as target_name,
    target.target_type
  from shadow_scope scope
  join public.aba_targets target
    on target.id = scope.source_target_id
   and target.patient_id = scope.patient_id
   and target.clinic_id = scope.organization_id::text
),
latest_completed_source_session as (
  select
    session_row.id as session_id,
    session_row.started_at,
    session_row.ended_at,
    session_row.reference_date,
    session_row.status
  from target_scope scope
  join public.aba_sessions session_row
    on session_row.patient_id = scope.patient_id
   and session_row.clinic_id = scope.organization_id::text
  where lower(coalesce(session_row.status,'')) = 'completed'
    and session_row.ended_at is not null
    and session_row.started_at > scope.last_mirrored_at
    and exists (
      select 1
      from public.aba_trials trial
      where trial.session_id = session_row.id
        and trial.target_id = scope.source_target_id
    )
  order by session_row.started_at desc, session_row.id desc
  limit 1
),
resolved as (
  select
    scope.*,
    session_row.session_id,
    session_row.started_at,
    session_row.ended_at,
    session_row.reference_date,
    session_row.status,
    public.resolve_aba_measurement_rollout_snapshot_v3(
      scope.organization_id,
      scope.patient_id,
      scope.program_id,
      scope.source_target_id,
      session_row.started_at
    ) as rollout_snapshot,
    public.get_aba_v3_session_collection_plan(
      scope.organization_id,
      scope.patient_id,
      session_row.session_id,
      array[scope.source_target_id]::text[]
    ) as collection_plan
  from target_scope scope
  cross join latest_completed_source_session session_row
),
current_rollout_states as (
  select
    state.id,
    state.scope_type,
    state.patient_id,
    state.program_id,
    state.target_id,
    state.allow_new_v3_sessions,
    state.accept_v3_sync,
    state.effective_from,
    state.state_version,
    state.reason,
    state.updated_at
  from resolved scope
  join public.aba_measurement_rollout_states_v3 state
    on state.organization_id = scope.organization_id
   and (
     state.scope_type = 'CLINIC'
     or (state.scope_type = 'PATIENT' and state.patient_id = scope.patient_id)
     or (state.scope_type = 'PROGRAM' and state.patient_id = scope.patient_id and state.program_id = scope.program_id)
     or (state.scope_type = 'TARGET' and state.patient_id = scope.patient_id and state.program_id = scope.program_id and state.target_id = scope.source_target_id)
   )
),
rollout_events_at_session as (
  select distinct on (state.scope_type, state.patient_id, state.program_id, state.target_id)
    state.scope_type,
    state.patient_id,
    state.program_id,
    state.target_id,
    event.state_version,
    event.occurred_at,
    event.after_state
  from resolved scope
  join public.aba_measurement_rollout_states_v3 state
    on state.organization_id = scope.organization_id
   and (
     state.scope_type = 'CLINIC'
     or (state.scope_type = 'PATIENT' and state.patient_id = scope.patient_id)
     or (state.scope_type = 'PROGRAM' and state.patient_id = scope.patient_id and state.program_id = scope.program_id)
     or (state.scope_type = 'TARGET' and state.patient_id = scope.patient_id and state.program_id = scope.program_id and state.target_id = scope.source_target_id)
   )
  join public.aba_measurement_rollout_events_v3 event
    on event.rollout_state_id = state.id
   and event.organization_id = state.organization_id
  where event.occurred_at <= scope.started_at
    and coalesce(
      nullif(event.after_state ->> 'effective_from','')::timestamptz,
      event.occurred_at
    ) <= scope.started_at
  order by
    state.scope_type,
    state.patient_id,
    state.program_id,
    state.target_id,
    coalesce(
      nullif(event.after_state ->> 'effective_from','')::timestamptz,
      event.occurred_at
    ) desc,
    event.state_version desc,
    event.occurred_at desc
),
readiness as (
  select
    scope.organization_id,
    scope.patient_id,
    scope.source_target_id,
    scope.program_id,
    scope.session_id,
    scope.started_at,
    exists (
      select 1
      from public.aba_collection_definition_versions_v3 definition
      where definition.organization_id = scope.organization_id
        and definition.patient_id = scope.patient_id
        and definition.program_id = scope.program_id
        and definition.target_id = scope.source_target_id
        and definition.published_at <= scope.started_at
        and (definition.deprecated_at is null or scope.started_at < definition.deprecated_at)
    ) as definition_ready_at_session_start,
    exists (
      select 1
      from public.aba_target_phase_assignments_v3 phase
      where phase.organization_id = scope.organization_id
        and phase.patient_id = scope.patient_id
        and phase.program_id = scope.program_id
        and phase.target_id = scope.source_target_id
        and phase.effective_from <= scope.started_at
        and (phase.effective_until is null or scope.started_at < phase.effective_until)
    ) as phase_ready_at_session_start,
    exists (
      select 1
      from public.aba_session_target_measurement_bindings binding
      where binding.organization_id = scope.organization_id
        and binding.patient_id = scope.patient_id
        and binding.session_id = scope.session_id
        and binding.target_id = scope.source_target_id
    ) as binding_exists
  from resolved scope
),
plan_target as (
  select
    scope.collection_plan,
    scope.collection_plan -> 'targets' -> 0 as target_plan
  from resolved scope
),
summary as (
  select
    scope.*,
    readiness.definition_ready_at_session_start,
    readiness.phase_ready_at_session_start,
    readiness.binding_exists,
    plan.target_plan,
    coalesce(plan.target_plan ->> 'measurement_model_version','') as planned_model,
    coalesce(plan.target_plan ->> 'reason','') as plan_reason
  from resolved scope
  join readiness using (organization_id, patient_id, source_target_id, program_id, session_id, started_at)
  cross join plan_target plan
)
select jsonb_build_object(
  'diagnosis', case
    when summary.planned_model = 'LEGACY_V2' and summary.plan_reason = 'ROLLOUT_NOT_ENABLED_AT_SESSION_START'
      then 'ROLLOUT_NOT_ENABLED_FOR_SOURCE_TARGET_AT_SESSION_START'
    when summary.planned_model = 'V3_BLOCKED' and summary.plan_reason = 'SYNC_NOT_ENABLED_AT_SESSION_START'
      then 'ROLLOUT_SYNC_NOT_ENABLED_AT_SESSION_START'
    when summary.planned_model = 'V3_BLOCKED' and summary.plan_reason = 'PUBLISHED_COLLECTION_DEFINITION_MISSING'
      then 'COLLECTION_DEFINITION_MISSING_AT_SESSION_START'
    when summary.planned_model = 'V3_BLOCKED' and summary.plan_reason = 'ACTIVE_TARGET_PHASE_MISSING'
      then 'TARGET_PHASE_MISSING_AT_SESSION_START'
    when summary.planned_model = 'V3' and summary.binding_exists = false
      then 'PLAN_WAS_V3_BUT_UI_PERSISTED_LEGACY_WITHOUT_BINDING'
    when summary.planned_model = 'V3' and summary.binding_exists = true
      then 'PLAN_AND_BINDING_WERE_V3_REVIEW_RUNTIME_WRITE_PATH'
    else 'REVIEW_PLAN_AND_ROLLOUT_SNAPSHOT'
  end,
  'writes', false,
  'scope', jsonb_build_object(
    'organization_id', summary.organization_id,
    'patient_id', summary.patient_id,
    'target_id', summary.source_target_id,
    'target_name', summary.target_name,
    'target_type', summary.target_type,
    'program_id', summary.program_id,
    'session_id', summary.session_id,
    'session_started_at', summary.started_at,
    'session_ended_at', summary.ended_at,
    'reference_date', summary.reference_date
  ),
  'authoritative_plan', summary.target_plan,
  'resolved_rollout_snapshot', summary.rollout_snapshot,
  'readiness', jsonb_build_object(
    'definition_ready_at_session_start', summary.definition_ready_at_session_start,
    'phase_ready_at_session_start', summary.phase_ready_at_session_start,
    'binding_exists', summary.binding_exists
  ),
  'current_rollout_states', coalesce((
    select jsonb_agg(jsonb_build_object(
      'scope_type', state.scope_type,
      'patient_id', state.patient_id,
      'program_id', state.program_id,
      'target_id', state.target_id,
      'allow_new_v3_sessions', state.allow_new_v3_sessions,
      'accept_v3_sync', state.accept_v3_sync,
      'effective_from', state.effective_from,
      'state_version', state.state_version,
      'reason', state.reason,
      'updated_at', state.updated_at
    ) order by
      case state.scope_type when 'CLINIC' then 1 when 'PATIENT' then 2 when 'PROGRAM' then 3 when 'TARGET' then 4 else 5 end,
      state.scope_type
    )
    from current_rollout_states state
  ), '[]'::jsonb),
  'rollout_events_effective_at_session_start', coalesce((
    select jsonb_agg(jsonb_build_object(
      'scope_type', event.scope_type,
      'patient_id', event.patient_id,
      'program_id', event.program_id,
      'target_id', event.target_id,
      'state_version', event.state_version,
      'occurred_at', event.occurred_at,
      'after_state', event.after_state
    ) order by
      case event.scope_type when 'CLINIC' then 1 when 'PATIENT' then 2 when 'PROGRAM' then 3 when 'TARGET' then 4 else 5 end,
      event.scope_type
    )
    from rollout_events_at_session event
  ), '[]'::jsonb)
) as aba_v3_source_target_rollout_plan_diagnostic
from summary;
