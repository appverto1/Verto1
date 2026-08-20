-- Verto Clinical Measurement Engine V3
-- Production schema catch-up promotion after inventory U.
--
-- PURPOSE
--   Install ONLY the blocks proven absent by the production object inventory,
--   in dependency order, without enabling any ABA V3 rollout or browser writer.
--
-- SAFETY
--   * One transaction: any error rolls back the entire catch-up.
--   * Fail closed if the production state changed since the inventory.
--   * Fail closed if any ABA V3 rollout is currently enabled.
--   * Existing ABA V2 / already-installed ABA V3 clinical data is not backfilled,
--     reinterpreted or deleted by this operation.
--   * CMV3 shadow mirror is installed only; it is NOT executed here.
--
-- This is an operational promotion script, not a new migration identity. The
-- canonical migration files remain the source of truth and are embedded below.

begin;

set local lock_timeout = '5s';

do $cmv3_prod_promotion_preflight$
declare
  v_missing_prior text[] := '{}'::text[];
  v_unexpected_present text[] := '{}'::text[];
  v_enabled_rollouts bigint := 0;
begin
  -- Required prior ABA V3 foundation must already exist.
  if to_regclass('public.aba_measurement_rollout_states_v3') is null then
    v_missing_prior := array_append(v_missing_prior, 'public.aba_measurement_rollout_states_v3');
  end if;
  if to_regclass('public.aba_trials_v3') is null then
    v_missing_prior := array_append(v_missing_prior, 'public.aba_trials_v3');
  end if;
  if to_regprocedure('public.resolve_aba_session_target_measurement_binding_v1(uuid,uuid,text,text,uuid)') is null then
    v_missing_prior := array_append(v_missing_prior, 'public.resolve_aba_session_target_measurement_binding_v1(uuid,uuid,text,text,uuid)');
  end if;
  if to_regprocedure('public.get_aba_v3_pilot_readiness(uuid,uuid,text,text)') is null then
    v_missing_prior := array_append(v_missing_prior, 'public.get_aba_v3_pilot_readiness(uuid,uuid,text,text)');
  end if;
  if to_regprocedure('public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint)') is null then
    v_missing_prior := array_append(v_missing_prior, 'public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint)');
  end if;
  if to_regprocedure('public.get_aba_v3_session_collection_plan(uuid,uuid,text,text[])') is null then
    v_missing_prior := array_append(v_missing_prior, 'public.get_aba_v3_session_collection_plan(uuid,uuid,text,text[])');
  end if;
  if to_regprocedure('public.get_aba_v3_preflight_scope_snapshot(uuid,uuid)') is null then
    v_missing_prior := array_append(v_missing_prior, 'public.get_aba_v3_preflight_scope_snapshot(uuid,uuid)');
  end if;

  if cardinality(v_missing_prior) > 0 then
    raise exception 'CMV3_PRODUCTION_PROMOTION_PRIOR_BASELINE_MISSING:%', array_to_string(v_missing_prior, ', ');
  end if;

  -- Inventory U established these anchors as absent. Abort instead of guessing if
  -- production changed between inventory and promotion.
  if to_regprocedure('public.get_aba_session_read_bundle_v3(uuid,uuid,text)') is not null then
    v_unexpected_present := array_append(v_unexpected_present, 'get_aba_session_read_bundle_v3');
  end if;
  if to_regprocedure('public.record_aba_trial_action_v3(uuid,uuid,jsonb,text,uuid)') is not null then
    v_unexpected_present := array_append(v_unexpected_present, 'record_aba_trial_action_v3');
  end if;
  if to_regclass('public.clinical_measurement_targets_v3') is not null then
    v_unexpected_present := array_append(v_unexpected_present, 'clinical_measurement_targets_v3');
  end if;
  if to_regclass('public.clinical_measurement_projection_queue_v3') is not null then
    v_unexpected_present := array_append(v_unexpected_present, 'clinical_measurement_projection_queue_v3');
  end if;
  if to_regprocedure('public.get_clinical_measurement_v3_security_preflight()') is not null then
    v_unexpected_present := array_append(v_unexpected_present, 'get_clinical_measurement_v3_security_preflight');
  end if;

  if cardinality(v_unexpected_present) > 0 then
    raise exception 'CMV3_PRODUCTION_PROMOTION_STATE_CHANGED_RERUN_INVENTORY:%', array_to_string(v_unexpected_present, ', ');
  end if;

  select count(*)::bigint
    into v_enabled_rollouts
  from public.aba_measurement_rollout_states_v3
  where allow_new_v3_sessions is true;

  if v_enabled_rollouts <> 0 then
    raise exception 'CMV3_PRODUCTION_PROMOTION_ACTIVE_ABA_V3_ROLLOUT:%', v_enabled_rollouts;
  end if;
end;
$cmv3_prod_promotion_preflight$;


-- ===========================================================================
-- Embedded canonical block 01/12: 20260815193000_aba_measurement_v3_read_models_endpoints.sql
-- ===========================================================================
-- ABA Measurement V3 - PR8 canonical read models + server read RPCs.
-- Additive/dark only. Legacy V2 remains untouched and no rollout gate is enabled.
-- Browser roles do not receive direct access; Node service_role is the supported boundary.


-- Read-path indexes only on V3 tables. These support exact tenant/patient/session filters
-- without adding indexes to or changing the shape of any Legacy V2 table.
create index if not exists idx_aba_session_behavior_summaries_v3_scope
  on public.aba_session_behavior_summaries_v3
  (organization_id, patient_id, session_id, behavior_id, context_id);

create index if not exists idx_aba_interval_summaries_v3_scope
  on public.aba_interval_summaries_v3
  (organization_id, patient_id, session_id, behavior_id, context_id);

-- ---------------------------------------------------------------------------
-- Canonical read models. Views contain only display/context fields plus server-
-- derived projections; raw trial/event payloads and reliability observations never
-- become the official patient result.
-- ---------------------------------------------------------------------------
create or replace view public.aba_session_target_read_v3
with (security_invoker = true)
as
select
  summary.organization_id,
  summary.patient_id,
  summary.session_id,
  session_row.status as session_status,
  session_row.reference_date,
  session_row.started_at as session_started_at,
  session_row.ended_at as session_ended_at,
  summary.program_id,
  program.name as program_name,
  summary.target_id,
  target.name as target_name,
  target.target_type,
  summary.target_phase_assignment_id as phase_assignment_id,
  phase.phase_type,
  phase.phase_key,
  phase.label as phase_label,
  phase.effective_from as phase_effective_from,
  phase.effective_until as phase_effective_until,
  summary.effective_trial_count,
  summary.eligible_independent_opportunity_count,
  summary.primary_independent_correct_count,
  summary.primary_independent_incorrect_count,
  summary.primary_independent_no_response_count,
  summary.support_used_trial_count,
  summary.completed_after_support_count,
  summary.primary_independence_percent,
  summary.prompt_step_counts,
  summary.source_latest_occurred_at,
  summary.source_latest_revision_at,
  summary.updated_at
from public.aba_session_target_summaries_v3 summary
join public.aba_sessions session_row
  on session_row.id = summary.session_id
 and session_row.patient_id = summary.patient_id
 and session_row.clinic_id = summary.organization_id::text
join public.aba_programs program
  on program.id = summary.program_id
 and program.patient_id = summary.patient_id
 and program.clinic_id = summary.organization_id::text
join public.aba_targets target
  on target.id = summary.target_id
 and target.patient_id = summary.patient_id
 and target.clinic_id = summary.organization_id::text
join public.aba_target_phase_assignments_v3 phase
  on phase.id = summary.target_phase_assignment_id
 and phase.organization_id = summary.organization_id
 and phase.patient_id = summary.patient_id
 and phase.target_id = summary.target_id;

create or replace view public.aba_session_task_analysis_read_v3
with (security_invoker = true)
as
select
  summary.organization_id,
  summary.patient_id,
  summary.session_id,
  session_row.status as session_status,
  session_row.reference_date,
  session_row.started_at as session_started_at,
  session_row.ended_at as session_ended_at,
  summary.program_id,
  program.name as program_name,
  summary.target_id,
  target.name as target_name,
  summary.target_phase_assignment_id as phase_assignment_id,
  phase.phase_type,
  phase.phase_key,
  phase.label as phase_label,
  summary.run_count,
  summary.complete_run_count,
  summary.incomplete_run_count,
  summary.eligible_step_count,
  summary.independent_step_count,
  summary.prompted_step_count,
  summary.incorrect_step_count,
  summary.no_response_step_count,
  summary.not_observed_step_count,
  summary.not_applicable_step_count,
  summary.independent_steps_percent,
  summary.prompt_counts,
  summary.source_latest_at,
  summary.updated_at
from public.aba_session_task_analysis_summaries_v3 summary
join public.aba_sessions session_row
  on session_row.id = summary.session_id
 and session_row.patient_id = summary.patient_id
 and session_row.clinic_id = summary.organization_id::text
join public.aba_programs program
  on program.id = summary.program_id
 and program.patient_id = summary.patient_id
 and program.clinic_id = summary.organization_id::text
join public.aba_targets target
  on target.id = summary.target_id
 and target.patient_id = summary.patient_id
 and target.clinic_id = summary.organization_id::text
join public.aba_target_phase_assignments_v3 phase
  on phase.id = summary.target_phase_assignment_id
 and phase.organization_id = summary.organization_id
 and phase.patient_id = summary.patient_id
 and phase.target_id = summary.target_id;

create or replace view public.aba_session_behavior_read_v3
with (security_invoker = true)
as
select
  summary.organization_id,
  summary.patient_id,
  summary.session_id,
  session_row.status as session_status,
  session_row.reference_date,
  session_row.started_at as session_started_at,
  session_row.ended_at as session_ended_at,
  summary.behavior_id,
  behavior.name as behavior_name,
  behavior.measurement_type as configured_measurement_type,
  summary.context_id,
  context.context_key,
  context.label as context_label,
  summary.active_observation_seconds,
  summary.frequency_count,
  summary.rate_per_hour,
  summary.duration_episode_count,
  summary.completed_duration_seconds,
  summary.censored_duration_count,
  summary.open_duration_count,
  summary.source_latest_at,
  summary.updated_at
from public.aba_official_session_behavior_summaries_v3 summary
join public.aba_sessions session_row
  on session_row.id = summary.session_id
 and session_row.patient_id = summary.patient_id
 and session_row.clinic_id = summary.organization_id::text
join public.aba_behavior_definitions behavior
  on behavior.id = summary.behavior_id
 and behavior.patient_id = summary.patient_id
 and behavior.clinic_id = summary.organization_id::text
join public.aba_behavior_contexts_v3 context
  on context.id = summary.context_id
 and context.organization_id = summary.organization_id
 and context.patient_id = summary.patient_id
 and context.behavior_id = summary.behavior_id;

create or replace view public.aba_session_interval_read_v3
with (security_invoker = true)
as
select
  summary.organization_id,
  summary.patient_id,
  summary.session_id,
  session_row.status as session_status,
  session_row.reference_date,
  session_row.started_at as session_started_at,
  session_row.ended_at as session_ended_at,
  summary.behavior_id,
  behavior.name as behavior_name,
  summary.context_id,
  context.context_key,
  context.label as context_label,
  summary.interval_run_id,
  run.lifecycle_status as interval_run_status,
  run.started_at as interval_started_at,
  run.ended_at as interval_ended_at,
  run.interval_seconds,
  summary.measurement_method,
  summary.planned_intervals,
  summary.recorded_intervals,
  summary.observed_intervals,
  summary.occurred_intervals,
  summary.not_occurred_intervals,
  summary.not_observed_intervals,
  summary.occurrence_percent,
  summary.updated_at
from public.aba_official_interval_summaries_v3 summary
join public.aba_interval_runs_v3 run
  on run.id = summary.interval_run_id
 and run.organization_id = summary.organization_id
 and run.patient_id = summary.patient_id
 and run.session_id = summary.session_id
 and run.behavior_id = summary.behavior_id
 and run.context_id = summary.context_id
join public.aba_sessions session_row
  on session_row.id = summary.session_id
 and session_row.patient_id = summary.patient_id
 and session_row.clinic_id = summary.organization_id::text
join public.aba_behavior_definitions behavior
  on behavior.id = summary.behavior_id
 and behavior.patient_id = summary.patient_id
 and behavior.clinic_id = summary.organization_id::text
join public.aba_behavior_contexts_v3 context
  on context.id = summary.context_id
 and context.organization_id = summary.organization_id
 and context.patient_id = summary.patient_id
 and context.behavior_id = summary.behavior_id;

-- IOA deliberately stays in its own read model. Nothing from this view is merged
-- into the official patient behavior/interval summaries above.
create or replace view public.aba_session_ioa_read_v3
with (security_invoker = true)
as
select
  ioa.organization_id,
  ioa.patient_id,
  ioa.session_id,
  session_row.reference_date,
  session_row.started_at as session_started_at,
  ioa.behavior_id,
  behavior.name as behavior_name,
  ioa.context_id,
  context.context_key,
  context.label as context_label,
  ioa.measurement_family,
  ioa.ioa_method,
  ioa.interval_run_id,
  ioa.source_scope_key,
  ioa.comparable_units,
  ioa.agreement_units,
  ioa.primary_value,
  ioa.reliability_value,
  ioa.ioa_percent,
  ioa.requires_review,
  ioa.review_reason,
  ioa.updated_at
from public.aba_ioa_summaries_v3 ioa
join public.aba_sessions session_row
  on session_row.id = ioa.session_id
 and session_row.patient_id = ioa.patient_id
 and session_row.clinic_id = ioa.organization_id::text
join public.aba_behavior_definitions behavior
  on behavior.id = ioa.behavior_id
 and behavior.patient_id = ioa.patient_id
 and behavior.clinic_id = ioa.organization_id::text
join public.aba_behavior_contexts_v3 context
  on context.id = ioa.context_id
 and context.organization_id = ioa.organization_id
 and context.patient_id = ioa.patient_id
 and context.behavior_id = ioa.behavior_id;

create or replace view public.aba_maintenance_probe_read_v3
with (security_invoker = true)
as
select
  probe.organization_id,
  probe.patient_id,
  probe.id as probe_id,
  probe.session_id,
  session_row.reference_date,
  session_row.started_at as session_started_at,
  probe.program_id,
  program.name as program_name,
  probe.target_id,
  target.name as target_name,
  probe.target_phase_assignment_id as phase_assignment_id,
  phase.phase_type,
  phase.phase_key,
  phase.label as phase_label,
  probe.criterion_version_id,
  probe.lifecycle_status,
  probe.eligibility_status,
  probe.evaluation_result,
  probe.required_eligible_trials_snapshot,
  probe.threshold_percent_snapshot,
  probe.eligible_trial_count,
  probe.primary_correct_count,
  probe.primary_independence_percent,
  probe.evidence_status,
  probe.requires_review,
  probe.opened_at,
  probe.closed_at,
  probe.updated_at
from public.aba_maintenance_probes_v3 probe
join public.aba_sessions session_row
  on session_row.id = probe.session_id
 and session_row.patient_id = probe.patient_id
 and session_row.clinic_id = probe.organization_id::text
join public.aba_programs program
  on program.id = probe.program_id
 and program.patient_id = probe.patient_id
 and program.clinic_id = probe.organization_id::text
join public.aba_targets target
  on target.id = probe.target_id
 and target.patient_id = probe.patient_id
 and target.clinic_id = probe.organization_id::text
join public.aba_target_phase_assignments_v3 phase
  on phase.id = probe.target_phase_assignment_id
 and phase.organization_id = probe.organization_id
 and phase.patient_id = probe.patient_id
 and phase.target_id = probe.target_id;

create or replace view public.aba_target_state_read_v3
with (security_invoker = true)
as
select
  state.organization_id,
  state.patient_id,
  state.program_id,
  program.name as program_name,
  state.target_id,
  target.name as target_name,
  target.target_type,
  state.state,
  state.state_version,
  state.criterion_version_id,
  criterion.auto_mastery_enabled,
  criterion.mastery_min_eligible_trials,
  criterion.mastery_threshold_percent,
  criterion.mastery_consecutive_sessions,
  criterion.maintenance_enabled,
  criterion.maintenance_min_eligible_trials,
  criterion.maintenance_threshold_percent,
  criterion.maintenance_consecutive_below,
  state.last_reason,
  state.initialized_at,
  state.updated_at
from public.aba_target_clinical_states_v3 state
join public.aba_programs program
  on program.id = state.program_id
 and program.patient_id = state.patient_id
 and program.clinic_id = state.organization_id::text
join public.aba_targets target
  on target.id = state.target_id
 and target.patient_id = state.patient_id
 and target.clinic_id = state.organization_id::text
left join public.aba_mastery_criterion_versions_v3 criterion
  on criterion.id = state.criterion_version_id
 and criterion.organization_id = state.organization_id
 and criterion.patient_id = state.patient_id
 and criterion.target_id = state.target_id;

-- Immutable session configuration needed by the future PR9 collector UI. It is
-- read once per target binding; the browser still never reads this view directly.
create or replace view public.aba_session_target_binding_read_v3
with (security_invoker = true)
as
select
  binding.organization_id,
  binding.patient_id,
  binding.session_id,
  binding.id as binding_id,
  binding.program_id,
  program.name as program_name,
  binding.target_id,
  target.name as target_name,
  target.target_type,
  binding.collection_definition_version_id,
  definition.version as collection_definition_version,
  definition.status as collection_definition_status,
  definition.definition as collection_definition,
  binding.target_phase_assignment_id as phase_assignment_id,
  phase.phase_type,
  phase.phase_key,
  phase.label as phase_label,
  binding.binding_source,
  binding.bound_at
from public.aba_session_target_measurement_bindings binding
join public.aba_collection_definition_versions_v3 definition
  on definition.id = binding.collection_definition_version_id
 and definition.organization_id = binding.organization_id
 and definition.patient_id = binding.patient_id
 and definition.target_id = binding.target_id
join public.aba_target_phase_assignments_v3 phase
  on phase.id = binding.target_phase_assignment_id
 and phase.organization_id = binding.organization_id
 and phase.patient_id = binding.patient_id
 and phase.target_id = binding.target_id
left join public.aba_programs program
  on program.id = binding.program_id
 and program.patient_id = binding.patient_id
 and program.clinic_id = binding.organization_id::text
join public.aba_targets target
  on target.id = binding.target_id
 and target.patient_id = binding.patient_id
 and target.clinic_id = binding.organization_id::text
where binding.measurement_model_version = 'V3';

-- ---------------------------------------------------------------------------
-- One DB round-trip per server read use-case. SECURITY DEFINER is paired with
-- exact tenant/patient/session validation and browser execute revocation.
-- ---------------------------------------------------------------------------
create or replace function public.get_aba_session_read_bundle_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_session public.aba_sessions%rowtype;
begin
  if p_organization_id is null or p_patient_id is null
     or nullif(btrim(coalesce(p_session_id, '')), '') is null then
    raise exception 'ABA_V3_READ_SCOPE_REQUIRED';
  end if;

  select * into v_session
  from public.aba_sessions session_row
  where session_row.id = p_session_id
    and session_row.patient_id = p_patient_id
    and session_row.clinic_id = p_organization_id::text;

  if not found then
    raise exception 'ABA_V3_READ_SESSION_SCOPE_INVALID';
  end if;

  return jsonb_build_object(
    'session', jsonb_build_object(
      'id', v_session.id,
      'status', v_session.status,
      'reference_date', v_session.reference_date,
      'started_at', v_session.started_at,
      'ended_at', v_session.ended_at
    ),
    'bindings', coalesce((
      select jsonb_agg(
        (to_jsonb(binding_read) - 'organization_id' - 'patient_id' - 'session_id')
        order by binding_read.program_name, binding_read.target_name, binding_read.target_id
      )
      from public.aba_session_target_binding_read_v3 binding_read
      where binding_read.organization_id = p_organization_id
        and binding_read.patient_id = p_patient_id
        and binding_read.session_id = p_session_id
    ), '[]'::jsonb),
    'targets', coalesce((
      select jsonb_agg(
        (to_jsonb(target_read) - 'organization_id' - 'patient_id' - 'session_id')
        order by target_read.program_name, target_read.target_name, target_read.phase_effective_from
      )
      from public.aba_session_target_read_v3 target_read
      where target_read.organization_id = p_organization_id
        and target_read.patient_id = p_patient_id
        and target_read.session_id = p_session_id
    ), '[]'::jsonb),
    'task_analysis', coalesce((
      select jsonb_agg(
        (to_jsonb(task_read) - 'organization_id' - 'patient_id' - 'session_id')
        order by task_read.program_name, task_read.target_name, task_read.phase_assignment_id
      )
      from public.aba_session_task_analysis_read_v3 task_read
      where task_read.organization_id = p_organization_id
        and task_read.patient_id = p_patient_id
        and task_read.session_id = p_session_id
    ), '[]'::jsonb),
    'behaviors', coalesce((
      select jsonb_agg(
        (to_jsonb(behavior_read) - 'organization_id' - 'patient_id' - 'session_id')
        order by behavior_read.behavior_name, behavior_read.context_label
      )
      from public.aba_session_behavior_read_v3 behavior_read
      where behavior_read.organization_id = p_organization_id
        and behavior_read.patient_id = p_patient_id
        and behavior_read.session_id = p_session_id
    ), '[]'::jsonb),
    'intervals', coalesce((
      select jsonb_agg(
        (to_jsonb(interval_read) - 'organization_id' - 'patient_id' - 'session_id')
        order by interval_read.interval_started_at, interval_read.interval_run_id
      )
      from public.aba_session_interval_read_v3 interval_read
      where interval_read.organization_id = p_organization_id
        and interval_read.patient_id = p_patient_id
        and interval_read.session_id = p_session_id
    ), '[]'::jsonb),
    'ioa', coalesce((
      select jsonb_agg(
        (to_jsonb(ioa_read) - 'organization_id' - 'patient_id' - 'session_id')
        order by ioa_read.behavior_name, ioa_read.context_label, ioa_read.measurement_family
      )
      from public.aba_session_ioa_read_v3 ioa_read
      where ioa_read.organization_id = p_organization_id
        and ioa_read.patient_id = p_patient_id
        and ioa_read.session_id = p_session_id
    ), '[]'::jsonb),
    'maintenance_probes', coalesce((
      select jsonb_agg(
        (to_jsonb(probe_read) - 'organization_id' - 'patient_id' - 'session_id')
        order by probe_read.opened_at, probe_read.probe_id
      )
      from public.aba_maintenance_probe_read_v3 probe_read
      where probe_read.organization_id = p_organization_id
        and probe_read.patient_id = p_patient_id
        and probe_read.session_id = p_session_id
    ), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.get_aba_patient_overview_v3(
  p_organization_id uuid,
  p_patient_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_session_count bigint := 0;
  v_last_session_at timestamptz;
  v_probe_review_count bigint := 0;
  v_ioa_review_count bigint := 0;
begin
  if p_organization_id is null or p_patient_id is null then
    raise exception 'ABA_V3_READ_SCOPE_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.patients patient
    where patient.id = p_patient_id
      and patient.clinic_id = p_organization_id::text
  ) then
    raise exception 'ABA_V3_READ_PATIENT_SCOPE_INVALID';
  end if;

  select count(distinct binding.session_id), max(session_row.started_at)
    into v_session_count, v_last_session_at
  from public.aba_session_target_measurement_bindings binding
  join public.aba_sessions session_row
    on session_row.id = binding.session_id
   and session_row.patient_id = binding.patient_id
   and session_row.clinic_id = binding.organization_id::text
  where binding.organization_id = p_organization_id
    and binding.patient_id = p_patient_id
    and binding.measurement_model_version = 'V3';

  select count(*) into v_probe_review_count
  from public.aba_maintenance_probes_v3 probe
  where probe.organization_id = p_organization_id
    and probe.patient_id = p_patient_id
    and probe.requires_review;

  select count(*) into v_ioa_review_count
  from public.aba_ioa_summaries_v3 ioa
  where ioa.organization_id = p_organization_id
    and ioa.patient_id = p_patient_id
    and ioa.requires_review;

  return jsonb_build_object(
    'v3_session_count', v_session_count,
    'last_v3_session_at', v_last_session_at,
    'review_counts', jsonb_build_object(
      'maintenance_probes', v_probe_review_count,
      'ioa', v_ioa_review_count
    ),
    'targets', coalesce((
      select jsonb_agg(
        (to_jsonb(state_read) - 'organization_id' - 'patient_id')
        order by state_read.program_name, state_read.target_name, state_read.target_id
      )
      from public.aba_target_state_read_v3 state_read
      where state_read.organization_id = p_organization_id
        and state_read.patient_id = p_patient_id
    ), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.get_aba_target_history_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_target_id text,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_limit integer := greatest(1, least(coalesce(p_limit, 90), 180));
begin
  if p_organization_id is null or p_patient_id is null
     or nullif(btrim(coalesce(p_target_id, '')), '') is null then
    raise exception 'ABA_V3_READ_SCOPE_REQUIRED';
  end if;
  if v_to < v_from then
    raise exception 'ABA_V3_READ_WINDOW_INVALID';
  end if;
  if v_to - v_from > interval '366 days' then
    raise exception 'ABA_V3_READ_WINDOW_TOO_LARGE';
  end if;

  if not exists (
    select 1
    from public.aba_targets target
    where target.id = p_target_id
      and target.patient_id = p_patient_id
      and target.clinic_id = p_organization_id::text
  ) then
    raise exception 'ABA_V3_READ_TARGET_SCOPE_INVALID';
  end if;

  return jsonb_build_object(
    'target_id', p_target_id,
    'from', v_from,
    'to', v_to,
    'limit', v_limit,
    'dtt', coalesce((
      select jsonb_agg(to_jsonb(history_row) order by history_row.session_started_at, history_row.session_id)
      from (
        select
          read_row.session_id,
          read_row.session_status,
          read_row.reference_date,
          read_row.session_started_at,
          read_row.session_ended_at,
          read_row.program_id,
          read_row.program_name,
          read_row.target_id,
          read_row.target_name,
          read_row.target_type,
          read_row.phase_assignment_id,
          read_row.phase_type,
          read_row.phase_key,
          read_row.phase_label,
          read_row.effective_trial_count,
          read_row.eligible_independent_opportunity_count,
          read_row.primary_independent_correct_count,
          read_row.primary_independent_incorrect_count,
          read_row.primary_independent_no_response_count,
          read_row.support_used_trial_count,
          read_row.completed_after_support_count,
          read_row.primary_independence_percent,
          read_row.prompt_step_counts,
          read_row.updated_at
        from public.aba_session_target_read_v3 read_row
        where read_row.organization_id = p_organization_id
          and read_row.patient_id = p_patient_id
          and read_row.target_id = p_target_id
          and read_row.session_started_at >= v_from
          and read_row.session_started_at <= v_to
        order by read_row.session_started_at desc, read_row.session_id desc
        limit v_limit
      ) history_row
    ), '[]'::jsonb),
    'task_analysis', coalesce((
      select jsonb_agg(to_jsonb(history_row) order by history_row.session_started_at, history_row.session_id)
      from (
        select
          read_row.session_id,
          read_row.session_status,
          read_row.reference_date,
          read_row.session_started_at,
          read_row.session_ended_at,
          read_row.program_id,
          read_row.program_name,
          read_row.target_id,
          read_row.target_name,
          read_row.phase_assignment_id,
          read_row.phase_type,
          read_row.phase_key,
          read_row.phase_label,
          read_row.run_count,
          read_row.complete_run_count,
          read_row.incomplete_run_count,
          read_row.eligible_step_count,
          read_row.independent_step_count,
          read_row.prompted_step_count,
          read_row.incorrect_step_count,
          read_row.no_response_step_count,
          read_row.not_observed_step_count,
          read_row.not_applicable_step_count,
          read_row.independent_steps_percent,
          read_row.prompt_counts,
          read_row.updated_at
        from public.aba_session_task_analysis_read_v3 read_row
        where read_row.organization_id = p_organization_id
          and read_row.patient_id = p_patient_id
          and read_row.target_id = p_target_id
          and read_row.session_started_at >= v_from
          and read_row.session_started_at <= v_to
        order by read_row.session_started_at desc, read_row.session_id desc
        limit v_limit
      ) history_row
    ), '[]'::jsonb),
    'maintenance_probes', coalesce((
      select jsonb_agg(to_jsonb(history_row) order by history_row.session_started_at, history_row.probe_id)
      from (
        select
          read_row.probe_id,
          read_row.session_id,
          read_row.reference_date,
          read_row.session_started_at,
          read_row.program_id,
          read_row.program_name,
          read_row.target_id,
          read_row.target_name,
          read_row.phase_assignment_id,
          read_row.phase_type,
          read_row.phase_key,
          read_row.phase_label,
          read_row.lifecycle_status,
          read_row.eligibility_status,
          read_row.evaluation_result,
          read_row.required_eligible_trials_snapshot,
          read_row.threshold_percent_snapshot,
          read_row.eligible_trial_count,
          read_row.primary_correct_count,
          read_row.primary_independence_percent,
          read_row.evidence_status,
          read_row.requires_review,
          read_row.opened_at,
          read_row.closed_at,
          read_row.updated_at
        from public.aba_maintenance_probe_read_v3 read_row
        where read_row.organization_id = p_organization_id
          and read_row.patient_id = p_patient_id
          and read_row.target_id = p_target_id
          and read_row.session_started_at >= v_from
          and read_row.session_started_at <= v_to
        order by read_row.session_started_at desc, read_row.probe_id desc
        limit v_limit
      ) history_row
    ), '[]'::jsonb)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Fail closed. The Node server uses service_role and performs a second layer of
-- capability/patient checks before invoking these exact-scope functions.
-- ---------------------------------------------------------------------------
revoke all on public.aba_session_target_read_v3 from public, anon, authenticated;
revoke all on public.aba_session_task_analysis_read_v3 from public, anon, authenticated;
revoke all on public.aba_session_behavior_read_v3 from public, anon, authenticated;
revoke all on public.aba_session_interval_read_v3 from public, anon, authenticated;
revoke all on public.aba_session_ioa_read_v3 from public, anon, authenticated;
revoke all on public.aba_maintenance_probe_read_v3 from public, anon, authenticated;
revoke all on public.aba_target_state_read_v3 from public, anon, authenticated;
revoke all on public.aba_session_target_binding_read_v3 from public, anon, authenticated;

revoke all on function public.get_aba_session_read_bundle_v3(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.get_aba_patient_overview_v3(uuid,uuid) from public, anon, authenticated;
revoke all on function public.get_aba_target_history_v3(uuid,uuid,text,timestamptz,timestamptz,integer) from public, anon, authenticated;

grant select on public.aba_session_target_read_v3 to service_role;
grant select on public.aba_session_task_analysis_read_v3 to service_role;
grant select on public.aba_session_behavior_read_v3 to service_role;
grant select on public.aba_session_interval_read_v3 to service_role;
grant select on public.aba_session_ioa_read_v3 to service_role;
grant select on public.aba_maintenance_probe_read_v3 to service_role;
grant select on public.aba_target_state_read_v3 to service_role;
grant select on public.aba_session_target_binding_read_v3 to service_role;

grant execute on function public.get_aba_session_read_bundle_v3(uuid,uuid,text) to service_role;
grant execute on function public.get_aba_patient_overview_v3(uuid,uuid) to service_role;
grant execute on function public.get_aba_target_history_v3(uuid,uuid,text,timestamptz,timestamptz,integer) to service_role;


-- Staging verification (read-only). This migration does not enable V3 collection.
select
  to_regclass('public.aba_session_target_read_v3') is not null as target_read_ready,
  to_regclass('public.aba_session_task_analysis_read_v3') is not null as task_read_ready,
  to_regclass('public.aba_session_behavior_read_v3') is not null as behavior_read_ready,
  to_regclass('public.aba_session_interval_read_v3') is not null as interval_read_ready,
  to_regclass('public.aba_session_ioa_read_v3') is not null as ioa_read_ready,
  to_regclass('public.aba_target_state_read_v3') is not null as target_state_read_ready,
  to_regprocedure('public.get_aba_session_read_bundle_v3(uuid,uuid,text)') is not null as session_bundle_rpc_ready,
  to_regprocedure('public.get_aba_patient_overview_v3(uuid,uuid)') is not null as patient_overview_rpc_ready,
  to_regprocedure('public.get_aba_target_history_v3(uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)') is not null as target_history_rpc_ready,
  not exists (
    select 1 from public.aba_measurement_rollout_states_v3
    where allow_new_v3_sessions
  ) as no_new_v3_sessions_enabled;

-- ===========================================================================
-- Embedded canonical block 02/12: 20260815203000_aba_measurement_v3_pr9a_atomic_trial_collection_bridge.sql
-- ===========================================================================
-- ABA Measurement V3 - PR9A atomic trial collection bridge.
-- Additive only. It composes existing PR3 trial persistence with PR6 maintenance
-- probe lifecycle so a maintenance trial can never commit without its probe link.
-- No Legacy V2 table, prompt score, rollout state or historical row is changed.


create or replace function public.record_aba_trial_action_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_trial jsonb,
  p_probe_key text default null,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_result jsonb;
  v_trial_id uuid;
  v_trial_type text := upper(trim(coalesce(p_trial ->> 'trial_type', '')));
  v_session_id text := trim(coalesce(p_trial ->> 'session_id', ''));
  v_target_id text := trim(coalesce(p_trial ->> 'target_id', ''));
  v_target_type text;
  v_binding public.aba_session_target_measurement_bindings%rowtype;
  v_effective_trial jsonb;
  v_probe public.aba_maintenance_probes_v3%rowtype;
  v_link public.aba_maintenance_probe_trials_v3%rowtype;
begin
  if p_actor_id is null then
    raise exception 'ABA_V3_COLLECTION_ACTOR_REQUIRED';
  end if;

  if jsonb_typeof(p_trial) is distinct from 'object' then
    raise exception 'ABA_V3_COLLECTION_TRIAL_OBJECT_REQUIRED';
  end if;

  if nullif(v_session_id, '') is null or nullif(v_target_id, '') is null then
    raise exception 'ABA_V3_COLLECTION_SCOPE_REQUIRED';
  end if;

  if p_probe_key is not null and nullif(trim(p_probe_key), '') is null then
    raise exception 'ABA_V3_PROBE_KEY_INVALID';
  end if;

  if nullif(trim(coalesce(p_probe_key, '')), '') is not null and v_trial_type <> 'MAINTENANCE_PROBE' then
    raise exception 'ABA_V3_PROBE_KEY_ONLY_FOR_MAINTENANCE';
  end if;

  if v_trial_type = 'MAINTENANCE_PROBE' and nullif(trim(coalesce(p_probe_key, '')), '') is null then
    raise exception 'ABA_V3_MAINTENANCE_PROBE_KEY_REQUIRED';
  end if;

  -- PR9A intentionally exposes only opportunity/trial families. Behavior,
  -- interval and task-analysis collection need their own canonical V3 UI/ingest
  -- boundaries and must never fall through to Legacy V2 by accident.
  select lower(trim(target.target_type))
  into v_target_type
  from public.aba_targets target
  where target.id = v_target_id
    and target.patient_id = p_patient_id
    and target.clinic_id = p_organization_id::text;

  if not found then
    raise exception 'ABA_V3_COLLECTION_SCOPE_INVALID';
  end if;

  if v_target_type not in ('dtt', 'net', 'probe') then
    raise exception 'ABA_V3_UI_MEASUREMENT_NOT_READY';
  end if;

  -- Resolve the immutable binding inside the same database transaction as the
  -- write. The browser/Node never owns definition or phase IDs. This keeps the
  -- Node write path to one RPC while PR3 still revalidates the binding/version
  -- during canonical ingestion.
  v_binding := public.resolve_aba_session_target_measurement_binding_v1(
    p_organization_id,
    p_patient_id,
    v_session_id,
    v_target_id,
    p_actor_id
  );

  if v_binding.measurement_model_version <> 'V3' then
    raise exception 'ABA_V3_TARGET_NOT_V3';
  end if;

  if v_binding.collection_definition_version_id is null
     or v_binding.target_phase_assignment_id is null then
    raise exception 'ABA_V3_CONFIGURATION_INCOMPLETE';
  end if;

  v_effective_trial := (
    p_trial
      - 'collection_definition_version_id'
      - 'target_phase_assignment_id'
  ) || jsonb_build_object(
    'collection_definition_version_id', v_binding.collection_definition_version_id,
    'target_phase_assignment_id', v_binding.target_phase_assignment_id
  );

  -- record_aba_trial_v3 performs the canonical scope/version/phase/idempotency
  -- validation from PR3 using the immutable IDs resolved above.
  v_result := public.record_aba_trial_v3(
    p_organization_id,
    p_patient_id,
    v_effective_trial,
    p_actor_id
  );

  if coalesce((v_result ->> 'quarantined')::integer, 0) > 0 then
    -- Do not create a probe for an event that was not accepted. Keeping the
    -- quarantine result is intentional and lets the client surface the reason.
    return v_result;
  end if;

  select nullif(item ->> 'trial_id', '')::uuid
  into v_trial_id
  from jsonb_array_elements(coalesce(v_result -> 'accepted', '[]'::jsonb)) item
  limit 1;

  if v_trial_id is null then
    raise exception 'ABA_V3_COLLECTION_ACCEPTED_TRIAL_MISSING';
  end if;

  if v_trial_type = 'MAINTENANCE_PROBE' then
    v_probe := public.open_aba_maintenance_probe_v3(
      p_organization_id,
      p_patient_id,
      v_session_id,
      v_target_id,
      trim(p_probe_key),
      p_actor_id,
      coalesce(public.aba_try_timestamptz_v3(p_trial ->> 'occurred_at'), now())
    );

    -- Replays may arrive after session finalization. If this exact trial was
    -- already linked while the probe was OPEN, treat the replay as idempotent
    -- instead of asking PR6 to reopen or mutate a closed clinical probe.
    select * into v_link
    from public.aba_maintenance_probe_trials_v3 link
    where link.probe_id = v_probe.id
      and link.trial_id = v_trial_id;

    if not found then
      v_link := public.link_aba_trial_to_maintenance_probe_v3(
        v_probe.id,
        v_trial_id,
        p_actor_id
      );
    end if;

    v_result := v_result || jsonb_build_object(
      'maintenance_probe_id', v_probe.id,
      'maintenance_probe_linked', v_link.trial_id = v_trial_id
    );
  end if;

  return v_result;
end;
$function$;

revoke all on function public.record_aba_trial_action_v3(uuid,uuid,jsonb,text,uuid)
  from public, anon, authenticated;
grant execute on function public.record_aba_trial_action_v3(uuid,uuid,jsonb,text,uuid)
  to service_role;

-- PR9A does not create or mutate rollout rows. New V3 sessions remain controlled
-- exclusively by the rollout state created in PR1/PR2.


select
  to_regprocedure('public.record_aba_trial_action_v3(uuid,uuid,jsonb,text,uuid)') is not null as trial_action_rpc_ready,
  to_regprocedure('public.resolve_aba_session_target_measurement_binding_v1(uuid,uuid,text,text,uuid)') is not null as binding_resolver_ready,
  to_regprocedure('public.record_aba_trial_v3(uuid,uuid,jsonb,uuid)') is not null as trial_engine_ready,
  to_regprocedure('public.open_aba_maintenance_probe_v3(uuid,uuid,text,text,text,uuid,timestamp with time zone)') is not null as maintenance_probe_ready,
  to_regprocedure('public.complete_aba_session_v3(uuid,uuid,uuid,text,uuid,text,timestamp with time zone,text,jsonb,text,text)') is not null as hybrid_completion_ready,
  not exists (
    select 1 from public.aba_measurement_rollout_states_v3
    where allow_new_v3_sessions
  ) as no_new_v3_sessions_enabled;

-- ===========================================================================
-- Embedded canonical block 03/12: 20260820130000_clinical_measurement_v3_identities_versioning.sql
-- ===========================================================================
-- Verto Clinical Measurement Engine V3 - Migration A: identities & versioning.
-- Additive/dark only. Creates the universal semantic identity layer without
-- mutating ABA V2, the existing ABA V3 implementation, routes, or live writers.


create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Stable target identity. This table does not copy clinical content from legacy
-- sources; it binds one universal measurement target to an existing source (or
-- to a standalone V3 target) while preserving tenant/patient scope.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_targets_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_key text not null,
  source_kind text not null
    check (source_kind in (
      'ABA_TARGET',
      'THERAPEUTIC_OBJECTIVE',
      'PLAN_TARGET',
      'PLAN_GOAL',
      'STANDALONE'
    )),
  aba_target_id text references public.aba_targets(id) on delete restrict,
  therapeutic_objective_id uuid
    references public.patient_therapeutic_objectives(id) on delete restrict,
  therapeutic_plan_id uuid
    references public.patient_therapeutic_plans(id) on delete restrict,
  source_goal_key text,
  specialty text,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'PAUSED', 'ARCHIVED')),
  archived_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_target_key_nonempty
    check (length(trim(target_key)) between 1 and 180),
  constraint cmv3_target_archive_shape
    check ((status = 'ARCHIVED' and archived_at is not null) or (status <> 'ARCHIVED' and archived_at is null)),
  constraint cmv3_target_source_shape check (
    (source_kind = 'ABA_TARGET'
      and aba_target_id is not null
      and therapeutic_objective_id is null
      and therapeutic_plan_id is null
      and source_goal_key is null)
    or
    (source_kind = 'THERAPEUTIC_OBJECTIVE'
      and aba_target_id is null
      and therapeutic_objective_id is not null
      and therapeutic_plan_id is null
      and source_goal_key is null)
    or
    (source_kind = 'PLAN_TARGET'
      and aba_target_id is null
      and therapeutic_objective_id is null
      and therapeutic_plan_id is not null
      and source_goal_key is null)
    or
    (source_kind = 'PLAN_GOAL'
      and aba_target_id is null
      and therapeutic_objective_id is null
      and therapeutic_plan_id is not null
      and nullif(trim(source_goal_key), '') is not null)
    or
    (source_kind = 'STANDALONE'
      and aba_target_id is null
      and therapeutic_objective_id is null
      and therapeutic_plan_id is null
      and source_goal_key is null)
  ),
  unique (organization_id, patient_id, target_key),
  unique (id, organization_id, patient_id)
);

create unique index if not exists ux_cmv3_target_aba_source
  on public.clinical_measurement_targets_v3 (organization_id, aba_target_id)
  where source_kind = 'ABA_TARGET';
create unique index if not exists ux_cmv3_target_objective_source
  on public.clinical_measurement_targets_v3 (organization_id, therapeutic_objective_id)
  where source_kind = 'THERAPEUTIC_OBJECTIVE';
create unique index if not exists ux_cmv3_target_plan_source
  on public.clinical_measurement_targets_v3 (organization_id, therapeutic_plan_id)
  where source_kind = 'PLAN_TARGET';
create unique index if not exists ux_cmv3_target_plan_goal_source
  on public.clinical_measurement_targets_v3 (organization_id, therapeutic_plan_id, source_goal_key)
  where source_kind = 'PLAN_GOAL';
create index if not exists idx_cmv3_targets_patient
  on public.clinical_measurement_targets_v3 (organization_id, patient_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Stable measurement identity. Mathematical family belongs to the identity and
-- cannot silently change between versions; a family change means a new identity.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_definitions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_key text not null,
  semantic_family text not null
    check (semantic_family in (
      'PROPORTION', 'RATE', 'COUNT', 'DURATION', 'LATENCY', 'IRT',
      'INTERVAL', 'ORDINAL', 'CONTINUOUS', 'TASK_ANALYSIS', 'CATEGORICAL'
    )),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'ARCHIVED')),
  archived_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_definition_key_nonempty
    check (length(trim(definition_key)) between 1 and 180),
  constraint cmv3_definition_archive_shape
    check ((status = 'ARCHIVED' and archived_at is not null) or (status <> 'ARCHIVED' and archived_at is null)),
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id)
    on delete restrict,
  unique (target_id, definition_key),
  unique (id, organization_id, patient_id, target_id)
);

create index if not exists idx_cmv3_definitions_target
  on public.clinical_measurement_definitions_v3
  (organization_id, patient_id, target_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Immutable semantic versions. Common semantics stay relational; family-specific
-- configuration is versioned in content JSON and remains server-hashed.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_definition_versions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_id uuid not null,
  version integer not null check (version > 0),
  schema_version integer not null default 3 check (schema_version = 3),
  unit_code text,
  unit_label text,
  directionality text not null default 'NO_DIRECTIONAL_JUDGMENT'
    check (directionality in (
      'INCREASE_IS_BETTER',
      'DECREASE_IS_BETTER',
      'TARGET_RANGE_IS_BETTER',
      'NO_DIRECTIONAL_JUDGMENT'
    )),
  content jsonb not null,
  aggregation_policy jsonb not null default '{}'::jsonb,
  definition_hash text not null,
  status text not null default 'PUBLISHED'
    check (status in ('PUBLISHED', 'DEPRECATED', 'ARCHIVED')),
  published_at timestamptz not null default now(),
  deprecated_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_definition_version_content_object
    check (jsonb_typeof(content) = 'object'),
  constraint cmv3_definition_version_aggregation_object
    check (jsonb_typeof(aggregation_policy) = 'object'),
  constraint cmv3_definition_version_hash_shape
    check (definition_hash ~ '^[0-9a-f]{64}$'),
  constraint cmv3_definition_version_lifecycle check (
    (status = 'PUBLISHED' and deprecated_at is null)
    or (status in ('DEPRECATED', 'ARCHIVED') and deprecated_at is not null)
  ),
  foreign key (definition_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definitions_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  unique (definition_id, version),
  unique (id, organization_id, patient_id, target_id),
  unique (id, organization_id, patient_id, target_id, definition_id)
);

create index if not exists idx_cmv3_definition_versions_lookup
  on public.clinical_measurement_definition_versions_v3
  (organization_id, patient_id, target_id, definition_id, version desc);

-- ---------------------------------------------------------------------------
-- Bitemporal activation of semantic versions. Rows are immutable facts except
-- for the single lifecycle annotation superseded_at. A retrospective correction
-- creates a replacement row and annotates the old knowledge row as superseded.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_definition_activations_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_id uuid not null,
  definition_version_id uuid not null,
  effective_from timestamptz not null,
  effective_until timestamptz,
  recorded_at timestamptz not null default now(),
  activation_mode text not null default 'PROSPECTIVE'
    check (activation_mode in ('PROSPECTIVE', 'RETROSPECTIVE_CORRECTION')),
  supersedes_activation_id uuid,
  superseded_at timestamptz,
  reason text,
  created_by text,
  constraint cmv3_definition_activation_window
    check (effective_until is null or effective_until > effective_from),
  constraint cmv3_definition_activation_supersession_time
    check (superseded_at is null or superseded_at >= recorded_at),
  constraint cmv3_definition_activation_not_self
    check (supersedes_activation_id is null or supersedes_activation_id <> id),
  foreign key (definition_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definitions_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  foreign key (definition_version_id, organization_id, patient_id, target_id, definition_id)
    references public.clinical_measurement_definition_versions_v3(
      id, organization_id, patient_id, target_id, definition_id
    ) on delete restrict,
  unique (id, organization_id, patient_id, target_id, definition_id),
  unique (id, organization_id, patient_id, target_id, definition_version_id),
  foreign key (
    supersedes_activation_id, organization_id, patient_id, target_id, definition_id
  ) references public.clinical_measurement_definition_activations_v3(
    id, organization_id, patient_id, target_id, definition_id
  ) on delete restrict
);

create index if not exists idx_cmv3_definition_activations_timeline
  on public.clinical_measurement_definition_activations_v3
  (organization_id, patient_id, target_id, definition_id, effective_from desc, recorded_at desc);
create index if not exists idx_cmv3_definition_activations_current
  on public.clinical_measurement_definition_activations_v3
  (organization_id, definition_id, effective_from desc)
  where superseded_at is null;

do $cmv3_definition_activation_overlap$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_definition_activations_v3'::regclass
      and conname = 'cmv3_definition_activation_no_overlap'
  ) then
    alter table public.clinical_measurement_definition_activations_v3
      add constraint cmv3_definition_activation_no_overlap
      exclude using gist (
        organization_id with =,
        definition_id with =,
        tstzrange(
          effective_from,
          coalesce(effective_until, 'infinity'::timestamptz),
          '[)'
        ) with &&
      ) where (superseded_at is null);
  end if;
end;
$cmv3_definition_activation_overlap$;

-- ---------------------------------------------------------------------------
-- Stable phase identity and immutable phase versions. Definition version changes
-- remain orthogonal to phase changes; neither dimension fabricates the other.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_phases_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  phase_key text not null,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'ARCHIVED')),
  archived_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_phase_key_nonempty
    check (length(trim(phase_key)) between 1 and 180),
  constraint cmv3_phase_archive_shape
    check ((status = 'ARCHIVED' and archived_at is not null) or (status <> 'ARCHIVED' and archived_at is null)),
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id)
    on delete restrict,
  unique (target_id, phase_key),
  unique (id, organization_id, patient_id, target_id)
);

create index if not exists idx_cmv3_phases_target
  on public.clinical_measurement_phases_v3
  (organization_id, patient_id, target_id, status, created_at desc);

create table if not exists public.clinical_measurement_phase_versions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  phase_id uuid not null,
  version integer not null check (version > 0),
  phase_type text not null
    check (phase_type in (
      'BASELINE', 'INTERVENTION', 'PROCEDURE_CHANGE', 'MAINTENANCE',
      'GENERALIZATION', 'PAUSE', 'GOAL_CHANGE', 'INSTRUMENT_CHANGE',
      'CONTEXT_EVENT'
    )),
  label text not null,
  content jsonb not null default '{}'::jsonb,
  phase_hash text not null,
  status text not null default 'PUBLISHED'
    check (status in ('PUBLISHED', 'DEPRECATED', 'ARCHIVED')),
  published_at timestamptz not null default now(),
  deprecated_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_phase_version_label_nonempty
    check (length(trim(label)) between 1 and 240),
  constraint cmv3_phase_version_content_object
    check (jsonb_typeof(content) = 'object'),
  constraint cmv3_phase_version_hash_shape
    check (phase_hash ~ '^[0-9a-f]{64}$'),
  constraint cmv3_phase_version_lifecycle check (
    (status = 'PUBLISHED' and deprecated_at is null)
    or (status in ('DEPRECATED', 'ARCHIVED') and deprecated_at is not null)
  ),
  foreign key (phase_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_phases_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  unique (phase_id, version),
  unique (id, organization_id, patient_id, target_id),
  unique (id, organization_id, patient_id, target_id, phase_id)
);

create index if not exists idx_cmv3_phase_versions_lookup
  on public.clinical_measurement_phase_versions_v3
  (organization_id, patient_id, target_id, phase_id, version desc);

-- ---------------------------------------------------------------------------
-- Bitemporal phase epochs. Current-truth epochs for one target cannot overlap.
-- Retrospective correction is represented by a new row that supersedes a prior
-- knowledge row; the original remains available for AS RECORDED reconstruction.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_phase_epochs_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  phase_id uuid not null,
  phase_version_id uuid not null,
  effective_from timestamptz not null,
  effective_until timestamptz,
  recorded_at timestamptz not null default now(),
  epoch_mode text not null default 'PROSPECTIVE'
    check (epoch_mode in ('PROSPECTIVE', 'RETROSPECTIVE_CORRECTION')),
  supersedes_epoch_id uuid,
  superseded_at timestamptz,
  reason text,
  created_by text,
  constraint cmv3_phase_epoch_window
    check (effective_until is null or effective_until > effective_from),
  constraint cmv3_phase_epoch_supersession_time
    check (superseded_at is null or superseded_at >= recorded_at),
  constraint cmv3_phase_epoch_not_self
    check (supersedes_epoch_id is null or supersedes_epoch_id <> id),
  foreign key (phase_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_phases_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  foreign key (phase_version_id, organization_id, patient_id, target_id, phase_id)
    references public.clinical_measurement_phase_versions_v3(
      id, organization_id, patient_id, target_id, phase_id
    ) on delete restrict,
  unique (id, organization_id, patient_id, target_id, phase_id),
  unique (id, organization_id, patient_id, target_id, phase_version_id),
  foreign key (supersedes_epoch_id, organization_id, patient_id, target_id, phase_id)
    references public.clinical_measurement_phase_epochs_v3(
      id, organization_id, patient_id, target_id, phase_id
    ) on delete restrict
);

create index if not exists idx_cmv3_phase_epochs_timeline
  on public.clinical_measurement_phase_epochs_v3
  (organization_id, patient_id, target_id, effective_from desc, recorded_at desc);
create index if not exists idx_cmv3_phase_epochs_current
  on public.clinical_measurement_phase_epochs_v3
  (organization_id, target_id, effective_from desc)
  where superseded_at is null;

do $cmv3_phase_epoch_overlap$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_phase_epochs_v3'::regclass
      and conname = 'cmv3_phase_epoch_no_overlap'
  ) then
    alter table public.clinical_measurement_phase_epochs_v3
      add constraint cmv3_phase_epoch_no_overlap
      exclude using gist (
        organization_id with =,
        target_id with =,
        tstzrange(
          effective_from,
          coalesce(effective_until, 'infinity'::timestamptz),
          '[)'
        ) with &&
      ) where (superseded_at is null);
  end if;
end;
$cmv3_phase_epoch_overlap$;

-- ---------------------------------------------------------------------------
-- Immutable server-side collection contract snapshot. Session binding arrives in
-- Migration B; this table only establishes the versioned identity needed by it.
-- phase_epoch_id is nullable because not every specialty metric requires phases.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_collection_protocol_snapshots_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_activation_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  phase_version_id uuid,
  schema_version integer not null default 3 check (schema_version = 3),
  snapshot jsonb not null,
  snapshot_hash text not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_protocol_snapshot_object
    check (jsonb_typeof(snapshot) = 'object'),
  constraint cmv3_protocol_snapshot_hash_shape
    check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  constraint cmv3_protocol_snapshot_phase_shape
    check ((phase_epoch_id is null and phase_version_id is null) or (phase_epoch_id is not null and phase_version_id is not null)),
  foreign key (definition_activation_id, organization_id, patient_id, target_id, definition_version_id)
    references public.clinical_measurement_definition_activations_v3(
      id, organization_id, patient_id, target_id, definition_version_id
    ) on delete restrict,
  foreign key (definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definition_versions_v3(
      id, organization_id, patient_id, target_id
    ) on delete restrict,
  foreign key (phase_epoch_id, organization_id, patient_id, target_id, phase_version_id)
    references public.clinical_measurement_phase_epochs_v3(
      id, organization_id, patient_id, target_id, phase_version_id
    ) on delete restrict,
  unique (id, organization_id, patient_id, target_id)
);

create index if not exists idx_cmv3_protocol_snapshots_target
  on public.clinical_collection_protocol_snapshots_v3
  (organization_id, patient_id, target_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Scope validation: polymorphic source references are checked against the tenant
-- and patient explicitly. IDs never confer authority or valid clinical scope.
-- ---------------------------------------------------------------------------
create or replace function public.validate_clinical_measurement_target_scope_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_patient_clinic_id uuid;
  v_source_patient_id uuid;
  v_source_org_text text;
  v_source_clinic_text text;
begin
  select patient.clinic_id
    into v_patient_clinic_id
  from public.patients patient
  where patient.id = new.patient_id;

  if not found or v_patient_clinic_id is distinct from new.organization_id then
    raise exception 'CMV3_PATIENT_SCOPE_INVALID';
  end if;

  if new.source_kind = 'ABA_TARGET' then
    select target.patient_id, target.clinic_id
      into v_source_patient_id, v_source_clinic_text
    from public.aba_targets target
    where target.id = new.aba_target_id;

    if not found
       or v_source_patient_id is distinct from new.patient_id
       or v_source_clinic_text is distinct from new.organization_id::text then
      raise exception 'CMV3_ABA_TARGET_SCOPE_INVALID';
    end if;
  elsif new.source_kind = 'THERAPEUTIC_OBJECTIVE' then
    select objective.patient_id, objective.organization_id
      into v_source_patient_id, v_source_org_text
    from public.patient_therapeutic_objectives objective
    where objective.id = new.therapeutic_objective_id;

    if not found
       or v_source_patient_id is distinct from new.patient_id
       or v_source_org_text is distinct from new.organization_id::text then
      raise exception 'CMV3_THERAPEUTIC_OBJECTIVE_SCOPE_INVALID';
    end if;
  elsif new.source_kind in ('PLAN_TARGET', 'PLAN_GOAL') then
    select plan.patient_id, plan.organization_id
      into v_source_patient_id, v_source_org_text
    from public.patient_therapeutic_plans plan
    where plan.id = new.therapeutic_plan_id;

    if not found
       or v_source_patient_id is distinct from new.patient_id
       or v_source_org_text is distinct from new.organization_id::text then
      raise exception 'CMV3_THERAPEUTIC_PLAN_SCOPE_INVALID';
    end if;
  end if;

  return new;
end;
$function$;

-- The server owns hashes and the semantic-family discriminator embedded in the
-- family-specific content object. Clients cannot forge either value.
create or replace function public.prepare_clinical_measurement_definition_version_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_family text;
begin
  select definition.semantic_family
    into v_family
  from public.clinical_measurement_definitions_v3 definition
  where definition.id = new.definition_id
    and definition.organization_id = new.organization_id
    and definition.patient_id = new.patient_id
    and definition.target_id = new.target_id;

  if not found then
    raise exception 'CMV3_DEFINITION_SCOPE_INVALID';
  end if;

  if upper(coalesce(new.content->>'kind', '')) is distinct from v_family then
    raise exception 'CMV3_DEFINITION_CONTENT_KIND_MISMATCH';
  end if;

  new.definition_hash := encode(
    digest(
      convert_to(
        jsonb_build_object(
          'semantic_family', v_family,
          'unit_code', new.unit_code,
          'unit_label', new.unit_label,
          'directionality', new.directionality,
          'content', new.content,
          'aggregation_policy', new.aggregation_policy
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$function$;

create or replace function public.prepare_clinical_measurement_phase_version_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
begin
  new.phase_hash := encode(
    digest(
      convert_to(
        jsonb_build_object(
          'phase_type', new.phase_type,
          'label', new.label,
          'content', new.content
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$function$;

create or replace function public.prepare_clinical_collection_protocol_snapshot_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
begin
  new.snapshot_hash := encode(
    digest(convert_to(new.snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );
  return new;
end;
$function$;

create or replace function public.prepare_clinical_measurement_bitemporal_record_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  -- recorded_at is system knowledge time. It is never accepted from a client.
  new.recorded_at := clock_timestamp();
  return new;
end;
$function$;

-- Stable identities may only be archived/paused through lifecycle fields; source,
-- scope, mathematical family and identity keys are immutable.
create or replace function public.guard_clinical_measurement_identity_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'CMV3_IDENTITY_DELETE_FORBIDDEN';
  end if;

  if (to_jsonb(old) - array['status', 'archived_at']::text[])
     is distinct from
     (to_jsonb(new) - array['status', 'archived_at']::text[]) then
    raise exception 'CMV3_IDENTITY_IMMUTABLE';
  end if;

  if old.status = 'ARCHIVED' and new.status <> 'ARCHIVED' then
    raise exception 'CMV3_IDENTITY_ARCHIVED_FINAL';
  end if;

  return new;
end;
$function$;

create or replace function public.guard_clinical_measurement_version_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'CMV3_VERSION_DELETE_FORBIDDEN';
  end if;

  if (to_jsonb(old) - array['status', 'deprecated_at']::text[])
     is distinct from
     (to_jsonb(new) - array['status', 'deprecated_at']::text[]) then
    raise exception 'CMV3_VERSION_IMMUTABLE';
  end if;

  if old.status = 'ARCHIVED' and new.status <> 'ARCHIVED' then
    raise exception 'CMV3_VERSION_ARCHIVED_FINAL';
  end if;

  if old.status = 'DEPRECATED' and new.status = 'PUBLISHED' then
    raise exception 'CMV3_VERSION_REACTIVATION_FORBIDDEN';
  end if;

  return new;
end;
$function$;

-- Bitemporal activation/epoch semantic fields are immutable. Only superseded_at
-- may be annotated once to close the knowledge interval of the old row.
create or replace function public.guard_clinical_measurement_bitemporal_record_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'CMV3_BITEMPORAL_DELETE_FORBIDDEN';
  end if;

  if (to_jsonb(old) - 'superseded_at')
     is distinct from
     (to_jsonb(new) - 'superseded_at') then
    raise exception 'CMV3_BITEMPORAL_RECORD_IMMUTABLE';
  end if;

  if old.superseded_at is not null then
    raise exception 'CMV3_BITEMPORAL_SUPERSESSION_FINAL';
  end if;

  if new.superseded_at is null or new.superseded_at < old.recorded_at then
    raise exception 'CMV3_BITEMPORAL_SUPERSESSION_INVALID';
  end if;

  return new;
end;
$function$;

create or replace function public.guard_clinical_collection_protocol_snapshot_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'CMV3_PROTOCOL_SNAPSHOT_IMMUTABLE';
end;
$function$;

-- Triggers ------------------------------------------------------------------
drop trigger if exists validate_clinical_measurement_target_scope_v3
  on public.clinical_measurement_targets_v3;
create trigger validate_clinical_measurement_target_scope_v3
before insert or update on public.clinical_measurement_targets_v3
for each row execute function public.validate_clinical_measurement_target_scope_v3();

drop trigger if exists prepare_clinical_measurement_definition_version_v3
  on public.clinical_measurement_definition_versions_v3;
create trigger prepare_clinical_measurement_definition_version_v3
before insert on public.clinical_measurement_definition_versions_v3
for each row execute function public.prepare_clinical_measurement_definition_version_v3();

drop trigger if exists prepare_clinical_measurement_phase_version_v3
  on public.clinical_measurement_phase_versions_v3;
create trigger prepare_clinical_measurement_phase_version_v3
before insert on public.clinical_measurement_phase_versions_v3
for each row execute function public.prepare_clinical_measurement_phase_version_v3();

drop trigger if exists prepare_clinical_collection_protocol_snapshot_v3
  on public.clinical_collection_protocol_snapshots_v3;
create trigger prepare_clinical_collection_protocol_snapshot_v3
before insert on public.clinical_collection_protocol_snapshots_v3
for each row execute function public.prepare_clinical_collection_protocol_snapshot_v3();

drop trigger if exists prepare_cmv3_definition_activation_recorded_at
  on public.clinical_measurement_definition_activations_v3;
create trigger prepare_cmv3_definition_activation_recorded_at
before insert on public.clinical_measurement_definition_activations_v3
for each row execute function public.prepare_clinical_measurement_bitemporal_record_v3();

drop trigger if exists prepare_cmv3_phase_epoch_recorded_at
  on public.clinical_measurement_phase_epochs_v3;
create trigger prepare_cmv3_phase_epoch_recorded_at
before insert on public.clinical_measurement_phase_epochs_v3
for each row execute function public.prepare_clinical_measurement_bitemporal_record_v3();


-- Identity immutability guards.
drop trigger if exists guard_cmv3_target_identity
  on public.clinical_measurement_targets_v3;
create trigger guard_cmv3_target_identity
before update or delete on public.clinical_measurement_targets_v3
for each row execute function public.guard_clinical_measurement_identity_v3();

drop trigger if exists guard_cmv3_definition_identity
  on public.clinical_measurement_definitions_v3;
create trigger guard_cmv3_definition_identity
before update or delete on public.clinical_measurement_definitions_v3
for each row execute function public.guard_clinical_measurement_identity_v3();

drop trigger if exists guard_cmv3_phase_identity
  on public.clinical_measurement_phases_v3;
create trigger guard_cmv3_phase_identity
before update or delete on public.clinical_measurement_phases_v3
for each row execute function public.guard_clinical_measurement_identity_v3();

-- Version immutability guards.
drop trigger if exists guard_cmv3_definition_version
  on public.clinical_measurement_definition_versions_v3;
create trigger guard_cmv3_definition_version
before update or delete on public.clinical_measurement_definition_versions_v3
for each row execute function public.guard_clinical_measurement_version_v3();

drop trigger if exists guard_cmv3_phase_version
  on public.clinical_measurement_phase_versions_v3;
create trigger guard_cmv3_phase_version
before update or delete on public.clinical_measurement_phase_versions_v3
for each row execute function public.guard_clinical_measurement_version_v3();

-- Bitemporal knowledge guards.
drop trigger if exists guard_cmv3_definition_activation
  on public.clinical_measurement_definition_activations_v3;
create trigger guard_cmv3_definition_activation
before update or delete on public.clinical_measurement_definition_activations_v3
for each row execute function public.guard_clinical_measurement_bitemporal_record_v3();

drop trigger if exists guard_cmv3_phase_epoch
  on public.clinical_measurement_phase_epochs_v3;
create trigger guard_cmv3_phase_epoch
before update or delete on public.clinical_measurement_phase_epochs_v3
for each row execute function public.guard_clinical_measurement_bitemporal_record_v3();

drop trigger if exists guard_cmv3_protocol_snapshot
  on public.clinical_collection_protocol_snapshots_v3;
create trigger guard_cmv3_protocol_snapshot
before update or delete on public.clinical_collection_protocol_snapshots_v3
for each row execute function public.guard_clinical_collection_protocol_snapshot_v3();

-- Dark-deploy security: Migration A intentionally exposes no browser table and
-- no browser RPC. RLS + revoked privileges fail closed; later migrations may
-- expose narrowly authorized server/RPC surfaces without reopening these tables.
alter table public.clinical_measurement_targets_v3 enable row level security;
alter table public.clinical_measurement_definitions_v3 enable row level security;
alter table public.clinical_measurement_definition_versions_v3 enable row level security;
alter table public.clinical_measurement_definition_activations_v3 enable row level security;
alter table public.clinical_measurement_phases_v3 enable row level security;
alter table public.clinical_measurement_phase_versions_v3 enable row level security;
alter table public.clinical_measurement_phase_epochs_v3 enable row level security;
alter table public.clinical_collection_protocol_snapshots_v3 enable row level security;

revoke all on table public.clinical_measurement_targets_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_definitions_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_definition_versions_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_definition_activations_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_phases_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_phase_versions_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_phase_epochs_v3 from public, anon, authenticated;
revoke all on table public.clinical_collection_protocol_snapshots_v3 from public, anon, authenticated;

grant all on table public.clinical_measurement_targets_v3 to service_role;
grant all on table public.clinical_measurement_definitions_v3 to service_role;
grant all on table public.clinical_measurement_definition_versions_v3 to service_role;
grant all on table public.clinical_measurement_definition_activations_v3 to service_role;
grant all on table public.clinical_measurement_phases_v3 to service_role;
grant all on table public.clinical_measurement_phase_versions_v3 to service_role;
grant all on table public.clinical_measurement_phase_epochs_v3 to service_role;
grant all on table public.clinical_collection_protocol_snapshots_v3 to service_role;

revoke all on function public.validate_clinical_measurement_target_scope_v3() from public, anon, authenticated;
revoke all on function public.prepare_clinical_measurement_definition_version_v3() from public, anon, authenticated;
revoke all on function public.prepare_clinical_measurement_phase_version_v3() from public, anon, authenticated;
revoke all on function public.prepare_clinical_collection_protocol_snapshot_v3() from public, anon, authenticated;
revoke all on function public.prepare_clinical_measurement_bitemporal_record_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_measurement_identity_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_measurement_version_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_measurement_bitemporal_record_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_collection_protocol_snapshot_v3() from public, anon, authenticated;

-- Explicit preservation invariant: no existing V2/ABA V3 row is inserted,
-- updated, deleted, backfilled, reinterpreted or exposed by this migration.


-- ===========================================================================
-- Embedded canonical block 04/12: 20260820144500_clinical_measurement_v3_sessions_expectations.sql
-- ===========================================================================
-- Verto Clinical Measurement Engine V3 - Migration B: sessions & expectations.
-- Additive/dark only. Creates the universal clinical-session identity, the frozen
-- expected measurement set for each session, and logical collection streams.
-- Does not mutate ABA V2, the existing ABA V3 implementation, routes, or writers.


create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Universal clinical measurement session.
-- clinical_date is derived exactly once from started_at + timezone_snapshot and
-- is then immutable. It is intentionally distinct from event occurrence dates.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_sessions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_key text not null,
  source_kind text not null default 'NATIVE_V3'
    check (source_kind in ('NATIVE_V3', 'ABA_SESSION')),
  aba_session_id text references public.aba_sessions(id) on delete restrict,
  status text not null default 'PREPARING'
    check (status in ('PREPARING', 'OPEN', 'FINALIZED', 'CANCELED')),
  started_at timestamptz not null,
  ended_at timestamptz,
  clinical_date date not null,
  clinical_date_policy text not null default 'SESSION_START_LOCAL_DATE'
    check (clinical_date_policy = 'SESSION_START_LOCAL_DATE'),
  timezone_snapshot text not null,
  timezone_offset_minutes integer not null
    check (timezone_offset_minutes between -900 and 900),
  recorded_at timestamptz not null default now(),
  expectations_sealed_at timestamptz,
  finalized_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_session_key_nonempty
    check (length(trim(session_key)) between 1 and 180),
  constraint cmv3_session_time_window
    check (ended_at is null or ended_at >= started_at),
  constraint cmv3_session_finalize_shape
    check (
      (status = 'FINALIZED' and ended_at is not null and finalized_at is not null)
      or (status <> 'FINALIZED' and finalized_at is null)
    ),
  constraint cmv3_session_expectation_seal_shape
    check (
      (status = 'PREPARING' and expectations_sealed_at is null)
      or (status in ('OPEN', 'FINALIZED') and expectations_sealed_at is not null)
      or status = 'CANCELED'
    ),
  constraint cmv3_session_source_shape check (
    (source_kind = 'NATIVE_V3' and aba_session_id is null)
    or (source_kind = 'ABA_SESSION' and aba_session_id is not null)
  ),
  unique (organization_id, patient_id, session_key),
  unique (id, organization_id, patient_id)
);

create unique index if not exists ux_cmv3_session_aba_source
  on public.clinical_measurement_sessions_v3 (organization_id, aba_session_id)
  where source_kind = 'ABA_SESSION';
create index if not exists idx_cmv3_sessions_patient_timeline
  on public.clinical_measurement_sessions_v3
  (organization_id, patient_id, clinical_date desc, started_at desc);
create index if not exists idx_cmv3_sessions_status
  on public.clinical_measurement_sessions_v3
  (organization_id, status, started_at desc);

-- ---------------------------------------------------------------------------
-- Frozen expected measurement set for a session.
-- A row means this measurement was explicitly expected for this session. We do
-- not materialize NOT_COLLECTED/NOT_SCHEDULED rows. Missingness is derived later
-- by comparing these expectations with accepted raw observations.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_session_expectations_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id uuid not null,
  target_id uuid not null,
  protocol_snapshot_id uuid not null,
  expectation_key text not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_expectation_key_nonempty
    check (length(trim(expectation_key)) between 1 and 180),
  foreign key (session_id, organization_id, patient_id)
    references public.clinical_measurement_sessions_v3(id, organization_id, patient_id)
    on delete restrict,
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id)
    on delete restrict,
  foreign key (protocol_snapshot_id, organization_id, patient_id, target_id)
    references public.clinical_collection_protocol_snapshots_v3(
      id, organization_id, patient_id, target_id
    ) on delete restrict,
  unique (session_id, expectation_key),
  unique (session_id, protocol_snapshot_id),
  unique (id, organization_id, patient_id, session_id, target_id)
);

create index if not exists idx_cmv3_expectations_session
  on public.clinical_measurement_session_expectations_v3
  (organization_id, patient_id, session_id, target_id);
create index if not exists idx_cmv3_expectations_target
  on public.clinical_measurement_session_expectations_v3
  (organization_id, patient_id, target_id, session_id);

-- ---------------------------------------------------------------------------
-- Logical collection stream. Device changes do not create a new PRIMARY stream.
-- Observation slices and raw events added later will bind to this stable identity.
-- One PRIMARY stream exists per expectation; RELIABILITY streams may be multiple
-- but must point to that expectation's PRIMARY stream.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_collection_streams_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id uuid not null,
  expectation_id uuid not null,
  target_id uuid not null,
  stream_key text not null,
  stream_role text not null
    check (stream_role in ('PRIMARY', 'RELIABILITY')),
  observer_membership_id uuid not null references public.clinic_memberships(id) on delete restrict,
  paired_primary_stream_id uuid,
  status text not null default 'OPEN'
    check (status in ('OPEN', 'CLOSED')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cmv3_stream_key_nonempty
    check (length(trim(stream_key)) between 1 and 180),
  constraint cmv3_stream_close_shape
    check ((status = 'OPEN' and closed_at is null) or (status = 'CLOSED' and closed_at is not null)),
  constraint cmv3_stream_pair_shape check (
    (stream_role = 'PRIMARY' and paired_primary_stream_id is null)
    or (stream_role = 'RELIABILITY' and paired_primary_stream_id is not null)
  ),
  foreign key (session_id, organization_id, patient_id)
    references public.clinical_measurement_sessions_v3(id, organization_id, patient_id)
    on delete restrict,
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(
      id, organization_id, patient_id, session_id, target_id
    ) on delete restrict,
  unique (session_id, expectation_id, stream_key),
  unique (id, organization_id, patient_id, session_id, expectation_id, target_id)
);

create unique index if not exists ux_cmv3_primary_stream_per_expectation
  on public.clinical_measurement_collection_streams_v3 (expectation_id)
  where stream_role = 'PRIMARY';
create unique index if not exists ux_cmv3_reliability_stream_per_observer
  on public.clinical_measurement_collection_streams_v3 (expectation_id, observer_membership_id)
  where stream_role = 'RELIABILITY';
create index if not exists idx_cmv3_streams_session
  on public.clinical_measurement_collection_streams_v3
  (organization_id, patient_id, session_id, expectation_id, stream_role);

-- Self-reference is added after table creation so RELIABILITY can point only to a
-- stream identity in the same tenant/session/expectation/target scope. Role is
-- additionally validated by trigger below.
do $cmv3_stream_pair_fk$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_collection_streams_v3'::regclass
      and conname = 'cmv3_stream_paired_primary_scope_fkey'
  ) then
    alter table public.clinical_measurement_collection_streams_v3
      add constraint cmv3_stream_paired_primary_scope_fkey
      foreign key (
        paired_primary_stream_id,
        organization_id,
        patient_id,
        session_id,
        expectation_id,
        target_id
      ) references public.clinical_measurement_collection_streams_v3 (
        id,
        organization_id,
        patient_id,
        session_id,
        expectation_id,
        target_id
      ) on delete restrict;
  end if;
end;
$cmv3_stream_pair_fk$;

-- ---------------------------------------------------------------------------
-- Server-owned temporal normalization and scope validation.
-- ---------------------------------------------------------------------------
create or replace function public.prepare_clinical_measurement_session_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_timezone text;
begin
  select zone.name
    into v_timezone
  from pg_catalog.pg_timezone_names zone
  where zone.name = nullif(trim(new.timezone_snapshot), '')
  limit 1;

  if v_timezone is null then
    raise exception 'CMV3_SESSION_TIMEZONE_INVALID';
  end if;

  new.timezone_snapshot := v_timezone;
  new.clinical_date := timezone(v_timezone, new.started_at)::date;
  new.timezone_offset_minutes := round(
    extract(epoch from (
      timezone(v_timezone, new.started_at)
      - timezone('UTC', new.started_at)
    )) / 60.0
  )::integer;
  new.recorded_at := clock_timestamp();
  new.created_at := new.recorded_at;

  if new.status <> 'PREPARING' then
    raise exception 'CMV3_SESSION_INSERT_MUST_PREPARE';
  end if;

  if new.ended_at is not null then
    raise exception 'CMV3_SESSION_PREPARING_END_FORBIDDEN';
  end if;

  new.expectations_sealed_at := null;
  new.finalized_at := null;

  return new;
end;
$function$;

create or replace function public.validate_clinical_measurement_session_scope_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_patient_clinic_id uuid;
  v_legacy_patient_id uuid;
  v_legacy_clinic_id text;
begin
  select patient.clinic_id
    into v_patient_clinic_id
  from public.patients patient
  where patient.id = new.patient_id;

  if not found or v_patient_clinic_id is distinct from new.organization_id then
    raise exception 'CMV3_SESSION_PATIENT_SCOPE_INVALID';
  end if;

  if new.source_kind = 'ABA_SESSION' then
    select session_row.patient_id, session_row.clinic_id
      into v_legacy_patient_id, v_legacy_clinic_id
    from public.aba_sessions session_row
    where session_row.id = new.aba_session_id;

    if not found
       or v_legacy_patient_id is distinct from new.patient_id
       or v_legacy_clinic_id is distinct from new.organization_id::text then
      raise exception 'CMV3_ABA_SESSION_SCOPE_INVALID';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.guard_clinical_measurement_session_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'CMV3_SESSION_DELETE_FORBIDDEN';
  end if;

  if (to_jsonb(old) - array['status', 'ended_at', 'expectations_sealed_at', 'finalized_at']::text[])
     is distinct from
     (to_jsonb(new) - array['status', 'ended_at', 'expectations_sealed_at', 'finalized_at']::text[]) then
    raise exception 'CMV3_SESSION_IDENTITY_IMMUTABLE';
  end if;

  if old.status in ('FINALIZED', 'CANCELED') then
    raise exception 'CMV3_SESSION_TERMINAL_STATE_IMMUTABLE';
  end if;

  if old.status = 'PREPARING' then
    if new.status = 'PREPARING' then
      if new.ended_at is not null
         or new.expectations_sealed_at is not null
         or new.finalized_at is not null then
        raise exception 'CMV3_SESSION_PREPARING_TEMPORAL_MUTATION_FORBIDDEN';
      end if;
      return new;
    end if;

    if new.status = 'OPEN' then
      if new.ended_at is not null or new.finalized_at is not null then
        raise exception 'CMV3_SESSION_OPEN_SHAPE_INVALID';
      end if;
      if not exists (
        select 1
        from public.clinical_measurement_session_expectations_v3 expectation
        where expectation.session_id = old.id
      ) then
        raise exception 'CMV3_SESSION_EXPECTATION_SET_EMPTY';
      end if;
      new.expectations_sealed_at := clock_timestamp();
      return new;
    end if;

    if new.status = 'CANCELED' then
      if exists (
        select 1
        from public.clinical_measurement_collection_streams_v3 stream
        where stream.session_id = old.id
          and stream.status = 'OPEN'
      ) then
        raise exception 'CMV3_SESSION_OPEN_STREAMS_EXIST';
      end if;
      new.expectations_sealed_at := old.expectations_sealed_at;
      new.finalized_at := null;
      return new;
    end if;

    raise exception 'CMV3_SESSION_STATUS_TRANSITION_INVALID';
  end if;

  if old.status = 'OPEN' then
    if new.status = 'OPEN' then
      if new.ended_at is distinct from old.ended_at
         or new.expectations_sealed_at is distinct from old.expectations_sealed_at
         or new.finalized_at is distinct from old.finalized_at then
        raise exception 'CMV3_SESSION_OPEN_TEMPORAL_MUTATION_FORBIDDEN';
      end if;
      return new;
    end if;

    if new.status in ('FINALIZED', 'CANCELED') and exists (
      select 1
      from public.clinical_measurement_collection_streams_v3 stream
      where stream.session_id = old.id
        and stream.status = 'OPEN'
    ) then
      raise exception 'CMV3_SESSION_OPEN_STREAMS_EXIST';
    end if;

    if new.status = 'FINALIZED' then
      if new.ended_at is null or new.ended_at < old.started_at then
        raise exception 'CMV3_SESSION_FINALIZED_END_INVALID';
      end if;
      new.expectations_sealed_at := old.expectations_sealed_at;
      new.finalized_at := clock_timestamp();
      return new;
    end if;

    if new.status = 'CANCELED' then
      new.expectations_sealed_at := old.expectations_sealed_at;
      new.finalized_at := null;
      return new;
    end if;

    raise exception 'CMV3_SESSION_STATUS_TRANSITION_INVALID';
  end if;

  raise exception 'CMV3_SESSION_STATUS_TRANSITION_INVALID';
end;
$function$;

create or replace function public.guard_clinical_measurement_expectation_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'CMV3_SESSION_EXPECTATION_IMMUTABLE';
end;
$function$;

create or replace function public.validate_clinical_measurement_expectation_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_session_status text;
begin
  select session_row.status
    into v_session_status
  from public.clinical_measurement_sessions_v3 session_row
  where session_row.id = new.session_id
    and session_row.organization_id = new.organization_id
    and session_row.patient_id = new.patient_id;

  if not found then
    raise exception 'CMV3_EXPECTATION_SESSION_SCOPE_INVALID';
  end if;

  if v_session_status <> 'PREPARING' then
    raise exception 'CMV3_EXPECTATION_SET_SEALED';
  end if;

  new.created_at := clock_timestamp();
  return new;
end;
$function$;

create or replace function public.validate_clinical_measurement_stream_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_session_status text;
  v_membership_clinic_id uuid;
  v_membership_status text;
  v_primary_role text;
  v_primary_observer_membership_id uuid;
begin
  select session_row.status
    into v_session_status
  from public.clinical_measurement_sessions_v3 session_row
  where session_row.id = new.session_id
    and session_row.organization_id = new.organization_id
    and session_row.patient_id = new.patient_id;

  if not found then
    raise exception 'CMV3_STREAM_SESSION_SCOPE_INVALID';
  end if;

  if tg_op = 'INSERT' and v_session_status not in ('PREPARING', 'OPEN') then
    raise exception 'CMV3_STREAM_SESSION_NOT_COLLECTABLE';
  end if;

  if new.status <> 'OPEN' then
    raise exception 'CMV3_STREAM_INSERT_MUST_OPEN';
  end if;

  new.opened_at := clock_timestamp();
  new.closed_at := null;
  new.created_at := new.opened_at;

  select membership.clinic_id, membership.status
    into v_membership_clinic_id, v_membership_status
  from public.clinic_memberships membership
  where membership.id = new.observer_membership_id;

  if not found
     or v_membership_clinic_id is distinct from new.organization_id
     or lower(coalesce(v_membership_status, '')) <> 'active' then
    raise exception 'CMV3_STREAM_OBSERVER_SCOPE_INVALID';
  end if;

  if new.stream_role = 'RELIABILITY' then
    select paired.stream_role, paired.observer_membership_id
      into v_primary_role, v_primary_observer_membership_id
    from public.clinical_measurement_collection_streams_v3 paired
    where paired.id = new.paired_primary_stream_id
      and paired.organization_id = new.organization_id
      and paired.patient_id = new.patient_id
      and paired.session_id = new.session_id
      and paired.expectation_id = new.expectation_id
      and paired.target_id = new.target_id;

    if not found or v_primary_role <> 'PRIMARY' then
      raise exception 'CMV3_STREAM_PRIMARY_PAIR_INVALID';
    end if;

    if v_primary_observer_membership_id is not distinct from new.observer_membership_id then
      raise exception 'CMV3_RELIABILITY_OBSERVER_MUST_DIFFER';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.guard_clinical_measurement_stream_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'CMV3_STREAM_DELETE_FORBIDDEN';
  end if;

  if (to_jsonb(old) - array['status', 'closed_at']::text[])
     is distinct from
     (to_jsonb(new) - array['status', 'closed_at']::text[]) then
    raise exception 'CMV3_STREAM_IDENTITY_IMMUTABLE';
  end if;

  if old.status = 'CLOSED' then
    raise exception 'CMV3_STREAM_CLOSED_FINAL';
  end if;

  if new.status = 'OPEN' then
    if new.closed_at is not null then
      raise exception 'CMV3_STREAM_OPEN_CLOSE_SHAPE_INVALID';
    end if;
    return new;
  end if;

  if new.status = 'CLOSED' then
    new.closed_at := clock_timestamp();
    return new;
  end if;

  raise exception 'CMV3_STREAM_STATUS_TRANSITION_INVALID';
end;
$function$;

-- Triggers ------------------------------------------------------------------
drop trigger if exists prepare_clinical_measurement_session_v3
  on public.clinical_measurement_sessions_v3;
create trigger prepare_clinical_measurement_session_v3
before insert on public.clinical_measurement_sessions_v3
for each row execute function public.prepare_clinical_measurement_session_v3();

drop trigger if exists validate_clinical_measurement_session_scope_v3
  on public.clinical_measurement_sessions_v3;
create trigger validate_clinical_measurement_session_scope_v3
before insert on public.clinical_measurement_sessions_v3
for each row execute function public.validate_clinical_measurement_session_scope_v3();

drop trigger if exists guard_clinical_measurement_session_v3
  on public.clinical_measurement_sessions_v3;
create trigger guard_clinical_measurement_session_v3
before update or delete on public.clinical_measurement_sessions_v3
for each row execute function public.guard_clinical_measurement_session_v3();

drop trigger if exists validate_clinical_measurement_expectation_v3
  on public.clinical_measurement_session_expectations_v3;
create trigger validate_clinical_measurement_expectation_v3
before insert on public.clinical_measurement_session_expectations_v3
for each row execute function public.validate_clinical_measurement_expectation_v3();

drop trigger if exists guard_clinical_measurement_expectation_v3
  on public.clinical_measurement_session_expectations_v3;
create trigger guard_clinical_measurement_expectation_v3
before update or delete on public.clinical_measurement_session_expectations_v3
for each row execute function public.guard_clinical_measurement_expectation_v3();

drop trigger if exists validate_clinical_measurement_stream_v3
  on public.clinical_measurement_collection_streams_v3;
create trigger validate_clinical_measurement_stream_v3
before insert on public.clinical_measurement_collection_streams_v3
for each row execute function public.validate_clinical_measurement_stream_v3();

drop trigger if exists guard_clinical_measurement_stream_v3
  on public.clinical_measurement_collection_streams_v3;
create trigger guard_clinical_measurement_stream_v3
before update or delete on public.clinical_measurement_collection_streams_v3
for each row execute function public.guard_clinical_measurement_stream_v3();

-- Dark-deploy security: no browser table or RPC is opened by Migration B.
alter table public.clinical_measurement_sessions_v3 enable row level security;
alter table public.clinical_measurement_session_expectations_v3 enable row level security;
alter table public.clinical_measurement_collection_streams_v3 enable row level security;

revoke all on table public.clinical_measurement_sessions_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_session_expectations_v3 from public, anon, authenticated;
revoke all on table public.clinical_measurement_collection_streams_v3 from public, anon, authenticated;

grant all on table public.clinical_measurement_sessions_v3 to service_role;
grant all on table public.clinical_measurement_session_expectations_v3 to service_role;
grant all on table public.clinical_measurement_collection_streams_v3 to service_role;

revoke all on function public.prepare_clinical_measurement_session_v3() from public, anon, authenticated;
revoke all on function public.validate_clinical_measurement_session_scope_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_measurement_session_v3() from public, anon, authenticated;
revoke all on function public.validate_clinical_measurement_expectation_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_measurement_expectation_v3() from public, anon, authenticated;
revoke all on function public.validate_clinical_measurement_stream_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_measurement_stream_v3() from public, anon, authenticated;

-- Explicit preservation invariant: this migration creates no expectations,
-- sessions, streams, backfills, browser writers, or mutations in V2/ABA V3.


-- ===========================================================================
-- Embedded canonical block 05/12: 20260820160000_clinical_measurement_v3_raw_primitives.sql
-- ===========================================================================
-- Verto Clinical Measurement Engine V3 - Raw Measurement Primitives.
-- Additive/dark only. Creates append-only accepted-event envelopes plus typed raw
-- primitives. Does not enable browser writers, projections, graphs or ABA V3 rollout.


create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Accepted raw-event envelope.
-- Scope, semantic family, protocol version and clinical calendar are resolved by
-- the server from the logical collection stream. The browser never writes here.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_raw_events_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id uuid not null,
  expectation_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  protocol_snapshot_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  phase_version_id uuid,
  semantic_family text not null
    check (semantic_family in (
      'PROPORTION', 'RATE', 'COUNT', 'DURATION', 'LATENCY', 'IRT',
      'INTERVAL', 'ORDINAL', 'CONTINUOUS', 'TASK_ANALYSIS', 'CATEGORICAL'
    )),
  client_event_id text not null,
  event_kind text not null default 'FACT'
    check (event_kind in ('FACT', 'CORRECTION', 'VOID', 'SUPERSEDE')),
  subject_event_id uuid,
  replacement_event_id uuid,
  ingestion_mode text not null
    check (ingestion_mode in ('LIVE', 'OFFLINE_SYNC', 'RETROSPECTIVE_ENTRY', 'CORRECTION')),
  occurred_at_utc timestamptz not null,
  clinical_date date not null,
  local_occurred_date date not null,
  timezone_snapshot text not null,
  timezone_offset_minutes integer not null
    check (timezone_offset_minutes between -900 and 900),
  actor_membership_id uuid not null references public.clinic_memberships(id) on delete restrict,
  reason_code text,
  payload_hash text not null,
  received_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint cmv3_raw_event_client_id_nonempty
    check (length(trim(client_event_id)) between 1 and 240),
  constraint cmv3_raw_event_hash_shape
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint cmv3_raw_event_reason_shape
    check (reason_code is null or length(trim(reason_code)) between 1 and 120),
  constraint cmv3_raw_event_temporal_shape
    check (received_at <= recorded_at and created_at = recorded_at),
  constraint cmv3_raw_event_phase_shape
    check (
      (phase_epoch_id is null and phase_version_id is null)
      or (phase_epoch_id is not null and phase_version_id is not null)
    ),
  constraint cmv3_raw_event_compensation_shape check (
    (event_kind = 'FACT'
      and subject_event_id is null
      and replacement_event_id is null
      and ingestion_mode <> 'CORRECTION'
      and reason_code is null)
    or
    (event_kind = 'CORRECTION'
      and subject_event_id is not null
      and replacement_event_id is null
      and ingestion_mode = 'CORRECTION'
      and reason_code is not null)
    or
    (event_kind = 'VOID'
      and subject_event_id is not null
      and replacement_event_id is null
      and ingestion_mode = 'CORRECTION'
      and reason_code is not null)
    or
    (event_kind = 'SUPERSEDE'
      and subject_event_id is not null
      and replacement_event_id is not null
      and ingestion_mode = 'CORRECTION'
      and reason_code is not null)
  ),
  foreign key (
    stream_id, organization_id, patient_id, session_id, expectation_id, target_id
  ) references public.clinical_measurement_collection_streams_v3 (
    id, organization_id, patient_id, session_id, expectation_id, target_id
  ) on delete restrict,
  foreign key (protocol_snapshot_id, organization_id, patient_id, target_id)
    references public.clinical_collection_protocol_snapshots_v3(
      id, organization_id, patient_id, target_id
    ) on delete restrict,
  foreign key (definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definition_versions_v3(
      id, organization_id, patient_id, target_id
    ) on delete restrict,
  foreign key (phase_epoch_id, organization_id, patient_id, target_id, phase_version_id)
    references public.clinical_measurement_phase_epochs_v3(
      id, organization_id, patient_id, target_id, phase_version_id
    ) on delete restrict,
  unique (organization_id, client_event_id),
  unique (id, organization_id, patient_id, session_id, target_id, stream_id),
  unique (id, organization_id, patient_id, session_id, expectation_id, target_id, stream_id)
);

create index if not exists idx_cmv3_raw_events_stream_timeline
  on public.clinical_measurement_raw_events_v3
  (organization_id, patient_id, stream_id, occurred_at_utc, recorded_at);
create index if not exists idx_cmv3_raw_events_target_timeline
  on public.clinical_measurement_raw_events_v3
  (organization_id, patient_id, target_id, clinical_date, occurred_at_utc);
create index if not exists idx_cmv3_raw_events_recorded
  on public.clinical_measurement_raw_events_v3
  (organization_id, recorded_at, id);
create index if not exists idx_cmv3_raw_events_subject
  on public.clinical_measurement_raw_events_v3(subject_event_id)
  where subject_event_id is not null;
create unique index if not exists ux_cmv3_raw_single_direct_compensation
  on public.clinical_measurement_raw_events_v3(subject_event_id)
  where event_kind in ('CORRECTION', 'VOID', 'SUPERSEDE');

-- One accepted FACT/CORRECTION envelope owns exactly one typed raw payload.
-- This prevents a single idempotency key from simultaneously becoming, for
-- example, both COUNT evidence and an explicit absence fact.
create table if not exists public.clinical_measurement_raw_event_payload_claims_v3 (
  event_id uuid primary key references public.clinical_measurement_raw_events_v3(id) on delete restrict,
  payload_kind text not null
    check (payload_kind in (
      'OBSERVATION_SLICE', 'COUNT', 'CATEGORY', 'SCALAR',
      'TEMPORAL_INTERVAL', 'INTERVAL_SAMPLE', 'EXPLICIT_ABSENCE'
    )),
  claimed_at timestamptz not null default now()
);

-- Self-scope FKs are added after the table exists.
do $cmv3_raw_self_fks$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_raw_events_v3'::regclass
      and conname = 'cmv3_raw_event_subject_scope_fkey'
  ) then
    alter table public.clinical_measurement_raw_events_v3
      add constraint cmv3_raw_event_subject_scope_fkey
      foreign key (
        subject_event_id, organization_id, patient_id, session_id,
        expectation_id, target_id, stream_id
      ) references public.clinical_measurement_raw_events_v3 (
        id, organization_id, patient_id, session_id,
        expectation_id, target_id, stream_id
      ) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_raw_events_v3'::regclass
      and conname = 'cmv3_raw_event_replacement_scope_fkey'
  ) then
    alter table public.clinical_measurement_raw_events_v3
      add constraint cmv3_raw_event_replacement_scope_fkey
      foreign key (
        replacement_event_id, organization_id, patient_id, session_id,
        expectation_id, target_id, stream_id
      ) references public.clinical_measurement_raw_events_v3 (
        id, organization_id, patient_id, session_id,
        expectation_id, target_id, stream_id
      ) on delete restrict;
  end if;
end;
$cmv3_raw_self_fks$;

-- ---------------------------------------------------------------------------
-- Closed active-observation slices. A slice is persisted only when its interval
-- is known, so raw evidence remains append-only. Open-timer UX is operational
-- state and is not a canonical raw observation row.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_observation_slices_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  expectation_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  semantic_family text not null
    check (semantic_family in (
      'PROPORTION', 'RATE', 'COUNT', 'DURATION', 'LATENCY', 'IRT',
      'INTERVAL', 'ORDINAL', 'CONTINUOUS', 'TASK_ANALYSIS', 'CATEGORICAL'
    )),
  lineage_root_event_id uuid not null references public.clinical_measurement_raw_events_v3(id) on delete restrict,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  close_reason text not null
    check (close_reason in (
      'USER_STOP', 'SESSION_FINALIZATION', 'OFFLINE_RECOVERY', 'OBSERVATION_INTERRUPTED'
    )),
  observation_range tstzrange generated always as (
    tstzrange(started_at, ended_at, '[)')
  ) stored,
  created_at timestamptz not null,
  constraint cmv3_observation_slice_time_order check (ended_at > started_at),
  foreign key (
    event_id, organization_id, patient_id, session_id, expectation_id, target_id, stream_id
  ) references public.clinical_measurement_raw_events_v3 (
    id, organization_id, patient_id, session_id, expectation_id, target_id, stream_id
  ) on delete restrict
);

-- A logical stream is the denominator identity. Device swaps do not produce a
-- second stream, therefore they cannot double-count overlapping observation time.
do $cmv3_observation_slice_overlap$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_observation_slices_v3'::regclass
      and conname = 'cmv3_observation_slices_no_overlap'
  ) then
    alter table public.clinical_measurement_observation_slices_v3
      add constraint cmv3_observation_slices_no_overlap
      exclude using gist (
        stream_id with =,
        observation_range with &&,
        lineage_root_event_id with <>
      );
  end if;
end;
$cmv3_observation_slice_overlap$;

create index if not exists idx_cmv3_observation_slices_stream
  on public.clinical_measurement_observation_slices_v3
  (organization_id, patient_id, stream_id, started_at);

-- ---------------------------------------------------------------------------
-- Typed mathematical raw primitives. They reference the accepted envelope and
-- intentionally do not collapse unlike measurement families into one sparse row.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_count_facts_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  semantic_family text not null check (semantic_family in ('COUNT', 'RATE')),
  count_delta integer not null check (count_delta between 1 and 1000000),
  created_at timestamptz not null,
  foreign key (event_id, organization_id, patient_id, session_id, target_id, stream_id)
    references public.clinical_measurement_raw_events_v3(
      id, organization_id, patient_id, session_id, target_id, stream_id
    ) on delete restrict
);

create index if not exists idx_cmv3_count_facts_stream
  on public.clinical_measurement_count_facts_v3
  (organization_id, patient_id, stream_id, event_id);

create table if not exists public.clinical_measurement_category_facts_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  semantic_family text not null
    check (semantic_family in ('PROPORTION', 'ORDINAL', 'CATEGORICAL')),
  category_key text not null,
  created_at timestamptz not null,
  constraint cmv3_category_fact_key_nonempty
    check (length(trim(category_key)) between 1 and 180),
  foreign key (event_id, organization_id, patient_id, session_id, target_id, stream_id)
    references public.clinical_measurement_raw_events_v3(
      id, organization_id, patient_id, session_id, target_id, stream_id
    ) on delete restrict
);

create index if not exists idx_cmv3_category_facts_stream
  on public.clinical_measurement_category_facts_v3
  (organization_id, patient_id, stream_id, event_id);

create table if not exists public.clinical_measurement_scalar_facts_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  semantic_family text not null check (semantic_family = 'CONTINUOUS'),
  numeric_value numeric not null,
  created_at timestamptz not null,
  constraint cmv3_scalar_fact_finite
    check (numeric_value::text not in ('NaN', 'Infinity', '-Infinity')),
  foreign key (event_id, organization_id, patient_id, session_id, target_id, stream_id)
    references public.clinical_measurement_raw_events_v3(
      id, organization_id, patient_id, session_id, target_id, stream_id
    ) on delete restrict
);

create index if not exists idx_cmv3_scalar_facts_stream
  on public.clinical_measurement_scalar_facts_v3
  (organization_id, patient_id, stream_id, event_id);

create table if not exists public.clinical_measurement_interval_facts_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  semantic_family text not null check (semantic_family in ('DURATION', 'LATENCY', 'IRT')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  is_censored boolean not null default false,
  censor_reason text,
  duration_ms bigint generated always as (
    floor(extract(epoch from (ended_at - started_at)) * 1000.0)::bigint
  ) stored,
  created_at timestamptz not null,
  constraint cmv3_interval_fact_time_order check (ended_at > started_at),
  constraint cmv3_interval_fact_censor_shape check (
    (not is_censored and censor_reason is null)
    or
    (is_censored and censor_reason in (
      'SESSION_FINALIZATION', 'OBSERVATION_INTERRUPTED', 'UNKNOWN_END'
    ))
  ),
  foreign key (event_id, organization_id, patient_id, session_id, target_id, stream_id)
    references public.clinical_measurement_raw_events_v3(
      id, organization_id, patient_id, session_id, target_id, stream_id
    ) on delete restrict
);

create index if not exists idx_cmv3_interval_facts_stream
  on public.clinical_measurement_interval_facts_v3
  (organization_id, patient_id, stream_id, started_at);

create table if not exists public.clinical_measurement_interval_samples_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  semantic_family text not null check (semantic_family = 'INTERVAL'),
  lineage_root_event_id uuid not null references public.clinical_measurement_raw_events_v3(id) on delete restrict,
  interval_index integer not null check (interval_index > 0),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  response_key text not null,
  sample_range tstzrange generated always as (
    tstzrange(started_at, ended_at, '[)')
  ) stored,
  created_at timestamptz not null,
  constraint cmv3_interval_sample_time_order check (ended_at > started_at),
  constraint cmv3_interval_sample_response_nonempty
    check (length(trim(response_key)) between 1 and 180),
  foreign key (event_id, organization_id, patient_id, session_id, target_id, stream_id)
    references public.clinical_measurement_raw_events_v3(
      id, organization_id, patient_id, session_id, target_id, stream_id
    ) on delete restrict
);

do $cmv3_interval_sample_overlap$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_interval_samples_v3'::regclass
      and conname = 'cmv3_interval_samples_no_overlap'
  ) then
    alter table public.clinical_measurement_interval_samples_v3
      add constraint cmv3_interval_samples_no_overlap
      exclude using gist (
        stream_id with =,
        sample_range with &&,
        lineage_root_event_id with <>
      );
  end if;
end;
$cmv3_interval_sample_overlap$;

do $cmv3_interval_sample_index_collision$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_interval_samples_v3'::regclass
      and conname = 'cmv3_interval_samples_index_lineage_guard'
  ) then
    alter table public.clinical_measurement_interval_samples_v3
      add constraint cmv3_interval_samples_index_lineage_guard
      exclude using gist (
        stream_id with =,
        interval_index with =,
        lineage_root_event_id with <>
      );
  end if;
end;
$cmv3_interval_sample_index_collision$;

create index if not exists idx_cmv3_interval_samples_stream
  on public.clinical_measurement_interval_samples_v3
  (organization_id, patient_id, stream_id, interval_index);

-- Explicit omission facts only. EXPECTED_NOT_COLLECTED and NOT_SCHEDULED remain
-- derived from expectations + accepted evidence and are never persisted as raw facts.
create table if not exists public.clinical_measurement_explicit_absence_facts_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  semantic_family text not null,
  absence_kind text not null
    check (absence_kind in (
      'NO_ELIGIBLE_OPPORTUNITY',
      'NO_VALID_OBSERVATION_WINDOW',
      'REFUSED_BY_PATIENT',
      'INTERRUPTED'
    )),
  reason_code text,
  created_at timestamptz not null,
  constraint cmv3_absence_reason_shape
    check (reason_code is null or length(trim(reason_code)) between 1 and 180),
  foreign key (event_id, organization_id, patient_id, session_id, target_id, stream_id)
    references public.clinical_measurement_raw_events_v3(
      id, organization_id, patient_id, session_id, target_id, stream_id
    ) on delete restrict
);

create index if not exists idx_cmv3_absence_facts_stream
  on public.clinical_measurement_explicit_absence_facts_v3
  (organization_id, patient_id, stream_id, event_id);

-- ---------------------------------------------------------------------------
-- Server-authoritative scope/time normalization for raw envelopes.
-- ---------------------------------------------------------------------------
create or replace function public.prepare_clinical_measurement_raw_event_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_stream public.clinical_measurement_collection_streams_v3%rowtype;
  v_expectation public.clinical_measurement_session_expectations_v3%rowtype;
  v_session public.clinical_measurement_sessions_v3%rowtype;
  v_snapshot public.clinical_collection_protocol_snapshots_v3%rowtype;
  v_definition_version public.clinical_measurement_definition_versions_v3%rowtype;
  v_family text;
  v_membership_clinic_id uuid;
  v_membership_status text;
  v_now timestamptz := clock_timestamp();
  v_subject_kind text;
  v_replacement_kind text;
begin
  select * into v_stream
  from public.clinical_measurement_collection_streams_v3 stream
  where stream.id = new.stream_id;

  if not found then
    raise exception 'CMV3_RAW_STREAM_NOT_FOUND';
  end if;

  select * into v_expectation
  from public.clinical_measurement_session_expectations_v3 expectation
  where expectation.id = v_stream.expectation_id
    and expectation.organization_id = v_stream.organization_id
    and expectation.patient_id = v_stream.patient_id
    and expectation.session_id = v_stream.session_id
    and expectation.target_id = v_stream.target_id;

  if not found then
    raise exception 'CMV3_RAW_EXPECTATION_SCOPE_INVALID';
  end if;

  select * into v_session
  from public.clinical_measurement_sessions_v3 session_row
  where session_row.id = v_stream.session_id
    and session_row.organization_id = v_stream.organization_id
    and session_row.patient_id = v_stream.patient_id;

  if not found or v_session.status = 'CANCELED' then
    raise exception 'CMV3_RAW_SESSION_NOT_COLLECTABLE';
  end if;

  select * into v_snapshot
  from public.clinical_collection_protocol_snapshots_v3 snapshot
  where snapshot.id = v_expectation.protocol_snapshot_id
    and snapshot.organization_id = v_stream.organization_id
    and snapshot.patient_id = v_stream.patient_id
    and snapshot.target_id = v_stream.target_id;

  if not found then
    raise exception 'CMV3_RAW_PROTOCOL_SNAPSHOT_INVALID';
  end if;

  select * into v_definition_version
  from public.clinical_measurement_definition_versions_v3 definition_version
  where definition_version.id = v_snapshot.definition_version_id
    and definition_version.organization_id = v_stream.organization_id
    and definition_version.patient_id = v_stream.patient_id
    and definition_version.target_id = v_stream.target_id;

  if not found then
    raise exception 'CMV3_RAW_DEFINITION_VERSION_INVALID';
  end if;

  select definition.semantic_family
    into v_family
  from public.clinical_measurement_definitions_v3 definition
  where definition.id = v_definition_version.definition_id
    and definition.organization_id = v_stream.organization_id
    and definition.patient_id = v_stream.patient_id
    and definition.target_id = v_stream.target_id;

  if not found then
    raise exception 'CMV3_RAW_DEFINITION_INVALID';
  end if;

  select membership.clinic_id, membership.status
    into v_membership_clinic_id, v_membership_status
  from public.clinic_memberships membership
  where membership.id = new.actor_membership_id;

  if not found
     or v_membership_clinic_id is distinct from v_stream.organization_id
     or lower(coalesce(v_membership_status, '')) <> 'active' then
    raise exception 'CMV3_RAW_ACTOR_SCOPE_INVALID';
  end if;

  -- LIVE facts require an actually open stream/session. Offline/retrospective
  -- arrivals may legitimately be accepted after logical closure/finalization.
  if new.event_kind = 'FACT' and new.ingestion_mode = 'LIVE' then
    if v_session.status <> 'OPEN' or v_stream.status <> 'OPEN' then
      raise exception 'CMV3_RAW_LIVE_STREAM_NOT_OPEN';
    end if;
  end if;

  if new.event_kind <> 'FACT' and new.ingestion_mode <> 'CORRECTION' then
    raise exception 'CMV3_RAW_COMPENSATION_MODE_INVALID';
  end if;

  if new.event_kind = 'FACT' and new.ingestion_mode = 'CORRECTION' then
    raise exception 'CMV3_RAW_FACT_CORRECTION_KIND_REQUIRED';
  end if;

  if new.occurred_at_utc < v_session.started_at then
    raise exception 'CMV3_RAW_OCCURRED_BEFORE_SESSION';
  end if;

  if v_session.ended_at is not null and new.occurred_at_utc > v_session.ended_at then
    raise exception 'CMV3_RAW_OCCURRED_AFTER_SESSION';
  end if;

  new.organization_id := v_stream.organization_id;
  new.patient_id := v_stream.patient_id;
  new.session_id := v_stream.session_id;
  new.expectation_id := v_stream.expectation_id;
  new.target_id := v_stream.target_id;
  new.protocol_snapshot_id := v_expectation.protocol_snapshot_id;
  new.definition_version_id := v_snapshot.definition_version_id;
  new.phase_epoch_id := v_snapshot.phase_epoch_id;
  new.phase_version_id := v_snapshot.phase_version_id;
  new.semantic_family := v_family;
  new.clinical_date := v_session.clinical_date;
  new.timezone_snapshot := v_session.timezone_snapshot;
  new.local_occurred_date := timezone(v_session.timezone_snapshot, new.occurred_at_utc)::date;
  new.timezone_offset_minutes := round(
    extract(epoch from (
      timezone(v_session.timezone_snapshot, new.occurred_at_utc)
      - timezone('UTC', new.occurred_at_utc)
    )) / 60.0
  )::integer;
  new.received_at := v_now;
  new.recorded_at := v_now;
  new.created_at := v_now;

  if new.subject_event_id is not null then
    select event.event_kind into v_subject_kind
    from public.clinical_measurement_raw_events_v3 event
    where event.id = new.subject_event_id
      and event.organization_id = new.organization_id
      and event.patient_id = new.patient_id
      and event.session_id = new.session_id
      and event.expectation_id = new.expectation_id
      and event.target_id = new.target_id
      and event.stream_id = new.stream_id;

    if not found or v_subject_kind not in ('FACT', 'CORRECTION', 'VOID') then
      raise exception 'CMV3_RAW_SUBJECT_EVENT_INVALID';
    end if;

    if new.subject_event_id = new.id then
      raise exception 'CMV3_RAW_SELF_REFERENCE_FORBIDDEN';
    end if;
  end if;

  if new.replacement_event_id is not null then
    select event.event_kind into v_replacement_kind
    from public.clinical_measurement_raw_events_v3 event
    where event.id = new.replacement_event_id
      and event.organization_id = new.organization_id
      and event.patient_id = new.patient_id
      and event.session_id = new.session_id
      and event.expectation_id = new.expectation_id
      and event.target_id = new.target_id
      and event.stream_id = new.stream_id;

    if not found or v_replacement_kind not in ('FACT', 'CORRECTION') then
      raise exception 'CMV3_RAW_REPLACEMENT_EVENT_INVALID';
    end if;

    if new.replacement_event_id = new.subject_event_id then
      raise exception 'CMV3_RAW_SUPERSEDE_REPLACEMENT_INVALID';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.claim_clinical_measurement_raw_payload_v3(
  p_event_id uuid,
  p_payload_kind text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_existing_kind text;
begin
  insert into public.clinical_measurement_raw_event_payload_claims_v3(
    event_id, payload_kind, claimed_at
  ) values (
    p_event_id, p_payload_kind, clock_timestamp()
  )
  on conflict (event_id) do nothing;

  select claim.payload_kind
    into v_existing_kind
  from public.clinical_measurement_raw_event_payload_claims_v3 claim
  where claim.event_id = p_event_id;

  if v_existing_kind is distinct from p_payload_kind then
    raise exception 'CMV3_RAW_EVENT_PAYLOAD_KIND_CONFLICT';
  end if;
end;
$function$;

create or replace function public.resolve_clinical_measurement_payload_event_v3(
  p_event_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  with recursive lineage as (
    select event.id, event.subject_event_id, 0 as depth
    from public.clinical_measurement_raw_events_v3 event
    where event.id = p_event_id

    union all

    select parent.id, parent.subject_event_id, lineage.depth + 1
    from lineage
    join public.clinical_measurement_raw_events_v3 parent
      on parent.id = lineage.subject_event_id
    where lineage.depth < 64
  )
  select lineage.id
  from lineage
  join public.clinical_measurement_raw_event_payload_claims_v3 claim
    on claim.event_id = lineage.id
  order by lineage.depth
  limit 1;
$function$;

create or replace function public.ensure_clinical_measurement_raw_payload_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_payload_kind text;
  v_subject_payload_kind text;
  v_replacement_payload_kind text;
  v_subject_payload_event_id uuid;
begin
  select claim.payload_kind
    into v_payload_kind
  from public.clinical_measurement_raw_event_payload_claims_v3 claim
  where claim.event_id = new.id;

  if new.event_kind in ('FACT', 'CORRECTION') and v_payload_kind is null then
    raise exception 'CMV3_RAW_EVENT_TYPED_PAYLOAD_REQUIRED';
  end if;

  if new.event_kind in ('VOID', 'SUPERSEDE') and v_payload_kind is not null then
    raise exception 'CMV3_RAW_COMPENSATION_PAYLOAD_FORBIDDEN';
  end if;

  if new.event_kind = 'CORRECTION' then
    v_subject_payload_event_id := public.resolve_clinical_measurement_payload_event_v3(new.subject_event_id);

    select claim.payload_kind
      into v_subject_payload_kind
    from public.clinical_measurement_raw_event_payload_claims_v3 claim
    where claim.event_id = v_subject_payload_event_id;

    if v_subject_payload_kind is null or v_subject_payload_kind is distinct from v_payload_kind then
      raise exception 'CMV3_RAW_CORRECTION_PAYLOAD_KIND_MISMATCH';
    end if;
  end if;

  if new.event_kind = 'SUPERSEDE' then
    select claim.payload_kind into v_subject_payload_kind
    from public.clinical_measurement_raw_event_payload_claims_v3 claim
    where claim.event_id = new.subject_event_id;

    select claim.payload_kind into v_replacement_payload_kind
    from public.clinical_measurement_raw_event_payload_claims_v3 claim
    where claim.event_id = new.replacement_event_id;

    if v_subject_payload_kind is null
       or v_replacement_payload_kind is null
       or v_subject_payload_kind is distinct from v_replacement_payload_kind then
      raise exception 'CMV3_RAW_SUPERSEDE_PAYLOAD_KIND_MISMATCH';
    end if;
  end if;

  return null;
end;
$function$;

create or replace function public.guard_clinical_measurement_raw_immutable_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'CMV3_RAW_APPEND_ONLY';
end;
$function$;

-- Resolve the accepted event into a typed primitive and derive all repeated
-- scope fields from the envelope instead of trusting caller-supplied values.
create or replace function public.prepare_clinical_measurement_primitive_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_event public.clinical_measurement_raw_events_v3%rowtype;
  v_session public.clinical_measurement_sessions_v3%rowtype;
  v_allowed text[];
  v_payload_kind text;
  v_subject_slice public.clinical_measurement_observation_slices_v3%rowtype;
  v_subject_sample public.clinical_measurement_interval_samples_v3%rowtype;
  v_subject_payload_event_id uuid;
begin
  select * into v_event
  from public.clinical_measurement_raw_events_v3 event
  where event.id = new.event_id;

  if not found then
    raise exception 'CMV3_PRIMITIVE_EVENT_NOT_FOUND';
  end if;

  if v_event.event_kind not in ('FACT', 'CORRECTION') then
    raise exception 'CMV3_PRIMITIVE_EVENT_KIND_INVALID';
  end if;

  if tg_table_name = 'clinical_measurement_count_facts_v3' then
    v_allowed := array['COUNT', 'RATE'];
  elsif tg_table_name = 'clinical_measurement_category_facts_v3' then
    v_allowed := array['PROPORTION', 'ORDINAL', 'CATEGORICAL'];
  elsif tg_table_name = 'clinical_measurement_scalar_facts_v3' then
    v_allowed := array['CONTINUOUS'];
  elsif tg_table_name = 'clinical_measurement_interval_facts_v3' then
    v_allowed := array['DURATION', 'LATENCY', 'IRT'];
  elsif tg_table_name = 'clinical_measurement_interval_samples_v3' then
    v_allowed := array['INTERVAL'];
  else
    v_allowed := null;
  end if;

  if v_allowed is not null and not (v_event.semantic_family = any(v_allowed)) then
    raise exception 'CMV3_PRIMITIVE_SEMANTIC_FAMILY_MISMATCH';
  end if;

  if tg_table_name = 'clinical_measurement_observation_slices_v3' then
    v_payload_kind := 'OBSERVATION_SLICE';
  elsif tg_table_name = 'clinical_measurement_count_facts_v3' then
    v_payload_kind := 'COUNT';
  elsif tg_table_name = 'clinical_measurement_category_facts_v3' then
    v_payload_kind := 'CATEGORY';
  elsif tg_table_name = 'clinical_measurement_scalar_facts_v3' then
    v_payload_kind := 'SCALAR';
  elsif tg_table_name = 'clinical_measurement_interval_facts_v3' then
    v_payload_kind := 'TEMPORAL_INTERVAL';
  elsif tg_table_name = 'clinical_measurement_interval_samples_v3' then
    v_payload_kind := 'INTERVAL_SAMPLE';
  else
    raise exception 'CMV3_PRIMITIVE_TABLE_UNSUPPORTED';
  end if;

  perform public.claim_clinical_measurement_raw_payload_v3(v_event.id, v_payload_kind);

  if tg_table_name = 'clinical_measurement_observation_slices_v3' then
    if v_event.event_kind = 'FACT' then
      new.lineage_root_event_id := v_event.id;
    else
      v_subject_payload_event_id := public.resolve_clinical_measurement_payload_event_v3(v_event.subject_event_id);

      select * into v_subject_slice
      from public.clinical_measurement_observation_slices_v3 slice
      where slice.event_id = v_subject_payload_event_id;

      if not found then
        raise exception 'CMV3_OBSERVATION_SLICE_CORRECTION_SUBJECT_INVALID';
      end if;

      new.lineage_root_event_id := v_subject_slice.lineage_root_event_id;
    end if;
  elsif tg_table_name = 'clinical_measurement_interval_samples_v3' then
    if v_event.event_kind = 'FACT' then
      new.lineage_root_event_id := v_event.id;
    else
      v_subject_payload_event_id := public.resolve_clinical_measurement_payload_event_v3(v_event.subject_event_id);

      select * into v_subject_sample
      from public.clinical_measurement_interval_samples_v3 sample
      where sample.event_id = v_subject_payload_event_id;

      if not found then
        raise exception 'CMV3_INTERVAL_SAMPLE_CORRECTION_SUBJECT_INVALID';
      end if;

      if new.interval_index is distinct from v_subject_sample.interval_index then
        raise exception 'CMV3_INTERVAL_SAMPLE_CORRECTION_INDEX_IMMUTABLE';
      end if;

      new.lineage_root_event_id := v_subject_sample.lineage_root_event_id;
    end if;
  end if;

  if tg_table_name in (
    'clinical_measurement_observation_slices_v3',
    'clinical_measurement_interval_facts_v3',
    'clinical_measurement_interval_samples_v3'
  ) then
    select * into v_session
    from public.clinical_measurement_sessions_v3 session_row
    where session_row.id = v_event.session_id
      and session_row.organization_id = v_event.organization_id
      and session_row.patient_id = v_event.patient_id;

    if not found then
      raise exception 'CMV3_PRIMITIVE_SESSION_SCOPE_INVALID';
    end if;

    if new.started_at < v_session.started_at then
      raise exception 'CMV3_PRIMITIVE_STARTED_BEFORE_SESSION';
    end if;

    if v_session.ended_at is not null and new.ended_at > v_session.ended_at then
      raise exception 'CMV3_PRIMITIVE_ENDED_AFTER_SESSION';
    end if;
  end if;

  new.organization_id := v_event.organization_id;
  new.patient_id := v_event.patient_id;
  new.session_id := v_event.session_id;
  new.target_id := v_event.target_id;
  new.stream_id := v_event.stream_id;
  new.semantic_family := v_event.semantic_family;
  new.created_at := v_event.recorded_at;

  if tg_table_name in ('clinical_measurement_observation_slices_v3', 'clinical_measurement_interval_facts_v3', 'clinical_measurement_interval_samples_v3') then
    if new.started_at is distinct from v_event.occurred_at_utc then
      raise exception 'CMV3_PRIMITIVE_START_MUST_MATCH_EVENT_TIME';
    end if;
  end if;

  return new;
end;
$function$;

-- Explicit absence is typed separately because it has no scalar/vector value.
create or replace function public.prepare_clinical_measurement_absence_fact_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_event public.clinical_measurement_raw_events_v3%rowtype;
begin
  select * into v_event
  from public.clinical_measurement_raw_events_v3 event
  where event.id = new.event_id;

  if not found then
    raise exception 'CMV3_ABSENCE_EVENT_NOT_FOUND';
  end if;

  if v_event.event_kind not in ('FACT', 'CORRECTION') then
    raise exception 'CMV3_ABSENCE_EVENT_KIND_INVALID';
  end if;

  perform public.claim_clinical_measurement_raw_payload_v3(v_event.id, 'EXPLICIT_ABSENCE');

  new.organization_id := v_event.organization_id;
  new.patient_id := v_event.patient_id;
  new.session_id := v_event.session_id;
  new.target_id := v_event.target_id;
  new.stream_id := v_event.stream_id;
  new.semantic_family := v_event.semantic_family;
  new.created_at := v_event.recorded_at;

  return new;
end;
$function$;

-- Triggers ------------------------------------------------------------------
drop trigger if exists prepare_clinical_measurement_raw_event_v3
  on public.clinical_measurement_raw_events_v3;
create trigger prepare_clinical_measurement_raw_event_v3
before insert on public.clinical_measurement_raw_events_v3
for each row execute function public.prepare_clinical_measurement_raw_event_v3();

drop trigger if exists ensure_clinical_measurement_raw_payload_v3
  on public.clinical_measurement_raw_events_v3;
create constraint trigger ensure_clinical_measurement_raw_payload_v3
after insert on public.clinical_measurement_raw_events_v3
deferrable initially deferred
for each row execute function public.ensure_clinical_measurement_raw_payload_v3();

drop trigger if exists guard_clinical_measurement_raw_events_v3
  on public.clinical_measurement_raw_events_v3;
create trigger guard_clinical_measurement_raw_events_v3
before update or delete on public.clinical_measurement_raw_events_v3
for each row execute function public.guard_clinical_measurement_raw_immutable_v3();

drop trigger if exists guard_cmv3_payload_claim_immutable
  on public.clinical_measurement_raw_event_payload_claims_v3;
create trigger guard_cmv3_payload_claim_immutable
before update or delete on public.clinical_measurement_raw_event_payload_claims_v3
for each row execute function public.guard_clinical_measurement_raw_immutable_v3();

-- Every typed primitive is server-derived from its event envelope and immutable.
do $cmv3_primitive_triggers$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinical_measurement_observation_slices_v3',
    'clinical_measurement_count_facts_v3',
    'clinical_measurement_category_facts_v3',
    'clinical_measurement_scalar_facts_v3',
    'clinical_measurement_interval_facts_v3',
    'clinical_measurement_interval_samples_v3'
  ] loop
    execute format('drop trigger if exists prepare_cmv3_primitive on public.%I', v_table);
    execute format(
      'create trigger prepare_cmv3_primitive before insert on public.%I for each row execute function public.prepare_clinical_measurement_primitive_v3()',
      v_table
    );
    execute format('drop trigger if exists guard_cmv3_raw_immutable on public.%I', v_table);
    execute format(
      'create trigger guard_cmv3_raw_immutable before update or delete on public.%I for each row execute function public.guard_clinical_measurement_raw_immutable_v3()',
      v_table
    );
  end loop;
end;
$cmv3_primitive_triggers$;

drop trigger if exists prepare_cmv3_absence_fact
  on public.clinical_measurement_explicit_absence_facts_v3;
create trigger prepare_cmv3_absence_fact
before insert on public.clinical_measurement_explicit_absence_facts_v3
for each row execute function public.prepare_clinical_measurement_absence_fact_v3();

drop trigger if exists guard_cmv3_absence_immutable
  on public.clinical_measurement_explicit_absence_facts_v3;
create trigger guard_cmv3_absence_immutable
before update or delete on public.clinical_measurement_explicit_absence_facts_v3
for each row execute function public.guard_clinical_measurement_raw_immutable_v3();

-- Dark-deploy security -------------------------------------------------------
do $cmv3_raw_security$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinical_measurement_raw_events_v3',
    'clinical_measurement_raw_event_payload_claims_v3',
    'clinical_measurement_observation_slices_v3',
    'clinical_measurement_count_facts_v3',
    'clinical_measurement_category_facts_v3',
    'clinical_measurement_scalar_facts_v3',
    'clinical_measurement_interval_facts_v3',
    'clinical_measurement_interval_samples_v3',
    'clinical_measurement_explicit_absence_facts_v3'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant all on table public.%I to service_role', v_table);
  end loop;
end;
$cmv3_raw_security$;

revoke all on function public.prepare_clinical_measurement_raw_event_v3() from public, anon, authenticated;
revoke all on function public.claim_clinical_measurement_raw_payload_v3(uuid, text) from public, anon, authenticated;
revoke all on function public.resolve_clinical_measurement_payload_event_v3(uuid) from public, anon, authenticated;
revoke all on function public.ensure_clinical_measurement_raw_payload_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_measurement_raw_immutable_v3() from public, anon, authenticated;
revoke all on function public.prepare_clinical_measurement_primitive_v3() from public, anon, authenticated;
revoke all on function public.prepare_clinical_measurement_absence_fact_v3() from public, anon, authenticated;

-- Explicit preservation invariant: no V2/legacy ABA table is mutated and no
-- authenticated writer is granted by this migration.


-- ===========================================================================
-- Embedded canonical block 06/12: 20260820173000_clinical_measurement_v3_aba_engine.sql
-- ===========================================================================
-- Verto Clinical Measurement Engine V3 - ABA specialized engine.
-- Additive/dark only. Adds categorical prompt hierarchies, versioned chaining,
-- ordered trials and Task Analysis on top of the universal raw layer.
-- No browser writer, rollout change, projection, graph, or legacy mutation.


create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Immutable ABA prompt hierarchy. No 0-100 prompt score exists in this model.
-- Legacy aba_prompt_types may be referenced only as a source identity/label.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_aba_prompt_hierarchies_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_id uuid not null,
  hierarchy_key text not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cabav3_prompt_hierarchy_key_nonempty
    check (length(trim(hierarchy_key)) between 1 and 180),
  foreign key (definition_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definitions_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  unique (definition_id, hierarchy_key),
  unique (id, organization_id, patient_id, target_id, definition_id)
);

create table if not exists public.clinical_aba_prompt_hierarchy_versions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_id uuid not null,
  hierarchy_id uuid not null,
  version integer not null check (version > 0),
  strategy text not null check (strategy in ('LEAST_TO_MOST','MOST_TO_LEAST','CUSTOM')),
  version_hash text,
  status text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED','DEPRECATED','ARCHIVED')),
  published_at timestamptz,
  deprecated_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cabav3_prompt_hierarchy_hash_shape check (version_hash is null or version_hash ~ '^[0-9a-f]{64}$'),
  constraint cabav3_prompt_hierarchy_lifecycle check (
    (status = 'DRAFT' and published_at is null and deprecated_at is null and version_hash is null)
    or (status = 'PUBLISHED' and published_at is not null and deprecated_at is null and version_hash is not null)
    or (status in ('DEPRECATED','ARCHIVED') and published_at is not null and deprecated_at is not null and version_hash is not null)
  ),
  foreign key (hierarchy_id, organization_id, patient_id, target_id, definition_id)
    references public.clinical_aba_prompt_hierarchies_v3(id, organization_id, patient_id, target_id, definition_id)
    on delete restrict,
  unique (hierarchy_id, version),
  unique (id, organization_id, patient_id, target_id, definition_id)
);

create table if not exists public.clinical_aba_prompt_hierarchy_levels_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_id uuid not null,
  hierarchy_version_id uuid not null,
  sequence_no integer not null check (sequence_no > 0),
  prompt_key text not null,
  label text not null,
  category text not null,
  is_independent boolean not null default false,
  legacy_prompt_type_id uuid references public.aba_prompt_types(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint cabav3_prompt_level_key_nonempty check (length(trim(prompt_key)) between 1 and 180),
  constraint cabav3_prompt_level_label_nonempty check (length(trim(label)) between 1 and 180),
  constraint cabav3_prompt_level_category_nonempty check (length(trim(category)) between 1 and 120),
  foreign key (hierarchy_version_id, organization_id, patient_id, target_id, definition_id)
    references public.clinical_aba_prompt_hierarchy_versions_v3(
      id, organization_id, patient_id, target_id, definition_id
    ) on delete restrict,
  unique (hierarchy_version_id, sequence_no),
  unique (hierarchy_version_id, prompt_key),
  unique (id, hierarchy_version_id, organization_id, patient_id, target_id, definition_id)
);

create unique index if not exists ux_cabav3_prompt_one_independent_level
  on public.clinical_aba_prompt_hierarchy_levels_v3(hierarchy_version_id)
  where is_independent;

-- ---------------------------------------------------------------------------
-- Task Analysis step definitions and versioned chaining policy. Eligibility is
-- materialized as a server-owned rule per step; tablets never submit it.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_aba_task_step_definitions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_version_id uuid not null,
  sequence_no integer not null check (sequence_no > 0),
  step_key text not null,
  label text not null,
  created_at timestamptz not null default now(),
  constraint cabav3_task_step_key_nonempty check (length(trim(step_key)) between 1 and 180),
  constraint cabav3_task_step_label_nonempty check (length(trim(label)) between 1 and 240),
  foreign key (definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definition_versions_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  unique (definition_version_id, sequence_no),
  unique (definition_version_id, step_key),
  unique (id, definition_version_id, organization_id, patient_id, target_id)
);

create table if not exists public.clinical_aba_chaining_policy_versions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_version_id uuid not null,
  policy_key text not null,
  version integer not null check (version > 0),
  strategy text not null check (strategy in ('FORWARD','BACKWARD','TOTAL_TASK','CUSTOM')),
  policy_hash text,
  status text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED','DEPRECATED','ARCHIVED')),
  published_at timestamptz,
  deprecated_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  constraint cabav3_chaining_policy_key_nonempty check (length(trim(policy_key)) between 1 and 180),
  constraint cabav3_chaining_policy_hash_shape check (policy_hash is null or policy_hash ~ '^[0-9a-f]{64}$'),
  constraint cabav3_chaining_policy_lifecycle check (
    (status = 'DRAFT' and published_at is null and deprecated_at is null and policy_hash is null)
    or (status = 'PUBLISHED' and published_at is not null and deprecated_at is null and policy_hash is not null)
    or (status in ('DEPRECATED','ARCHIVED') and published_at is not null and deprecated_at is not null and policy_hash is not null)
  ),
  foreign key (definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definition_versions_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  unique (definition_version_id, policy_key, version),
  unique (id, organization_id, patient_id, target_id, definition_version_id)
);

create table if not exists public.clinical_aba_chaining_step_rules_v3 (
  policy_version_id uuid not null,
  step_definition_id uuid not null,
  organization_id uuid not null,
  patient_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  sequence_no integer not null check (sequence_no > 0),
  eligibility text not null default 'NOT_ELIGIBLE'
    check (eligibility in ('ACQUISITION','MAINTENANCE','TRAINER_COMPLETED','NOT_ELIGIBLE')),
  created_at timestamptz not null default now(),
  primary key (policy_version_id, step_definition_id),
  foreign key (policy_version_id, organization_id, patient_id, target_id, definition_version_id)
    references public.clinical_aba_chaining_policy_versions_v3(
      id, organization_id, patient_id, target_id, definition_version_id
    ) on delete restrict,
  foreign key (step_definition_id, definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_aba_task_step_definitions_v3(
      id, definition_version_id, organization_id, patient_id, target_id
    ) on delete restrict,
  unique (policy_version_id, sequence_no)
);

-- One immutable server-owned ABA binding per protocol snapshot. It freezes the
-- hierarchy/chaining semantics used to resolve trial and TA eligibility.
create table if not exists public.clinical_aba_protocol_bindings_v3 (
  protocol_snapshot_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  prompt_hierarchy_version_id uuid,
  chaining_policy_version_id uuid,
  initial_opportunity_mode text not null default 'INDEPENDENT_ELIGIBLE'
    check (initial_opportunity_mode in ('INDEPENDENT_ELIGIBLE','ERRORLESS_NO_INDEPENDENT')),
  created_at timestamptz not null default now(),
  foreign key (protocol_snapshot_id, organization_id, patient_id, target_id)
    references public.clinical_collection_protocol_snapshots_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  foreign key (definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definition_versions_v3(id, organization_id, patient_id, target_id)
    on delete restrict,
  foreign key (chaining_policy_version_id, organization_id, patient_id, target_id, definition_version_id)
    references public.clinical_aba_chaining_policy_versions_v3(
      id, organization_id, patient_id, target_id, definition_version_id
    ) on delete restrict
);

-- Prompt hierarchy compatibility is definition-identity based (not definition-version
-- based), so it is validated explicitly by the server trigger below.

create index if not exists idx_cabav3_protocol_binding_prompt
  on public.clinical_aba_protocol_bindings_v3(prompt_hierarchy_version_id)
  where prompt_hierarchy_version_id is not null;
create index if not exists idx_cabav3_protocol_binding_chaining
  on public.clinical_aba_protocol_bindings_v3(chaining_policy_version_id)
  where chaining_policy_version_id is not null;

-- ---------------------------------------------------------------------------
-- ABA-specific payload claims remain mutually exclusive with universal raw
-- payload claims without changing the already-deployed generic claim enum.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_aba_raw_payload_claims_v3 (
  event_id uuid primary key references public.clinical_measurement_raw_events_v3(id) on delete restrict,
  payload_kind text not null check (payload_kind in ('ABA_TRIAL','ABA_TASK_ANALYSIS')),
  claimed_at timestamptz not null default now()
);

create or replace function public.guard_clinical_aba_payload_claim_exclusivity_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  -- Serialize generic-vs-ABA claim acquisition on the immutable raw envelope.
  -- This closes the cross-table write-skew race under concurrent ingestion.
  perform 1
  from public.clinical_measurement_raw_events_v3 event
  where event.id = new.event_id
  for update;
  if not found then
    raise exception 'CMV3_ABA_PAYLOAD_EVENT_NOT_FOUND';
  end if;

  if tg_table_name = 'clinical_aba_raw_payload_claims_v3' then
    if exists (select 1 from public.clinical_measurement_raw_event_payload_claims_v3 c where c.event_id = new.event_id) then
      raise exception 'CMV3_ABA_RAW_EVENT_ALREADY_HAS_GENERIC_PAYLOAD';
    end if;
  else
    if exists (select 1 from public.clinical_aba_raw_payload_claims_v3 c where c.event_id = new.event_id) then
      raise exception 'CMV3_RAW_EVENT_ALREADY_HAS_ABA_PAYLOAD';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists guard_cabav3_payload_claim on public.clinical_aba_raw_payload_claims_v3;
create trigger guard_cabav3_payload_claim
before insert on public.clinical_aba_raw_payload_claims_v3
for each row execute function public.guard_clinical_aba_payload_claim_exclusivity_v3();

drop trigger if exists guard_cmv3_generic_claim_against_aba on public.clinical_measurement_raw_event_payload_claims_v3;
create trigger guard_cmv3_generic_claim_against_aba
before insert on public.clinical_measurement_raw_event_payload_claims_v3
for each row execute function public.guard_clinical_aba_payload_claim_exclusivity_v3();

-- Extend the universal deferred payload validator so ABA specialized payloads
-- participate in the exact same one-event/one-payload and correction lineage rules.
create or replace function public.resolve_clinical_measurement_payload_kind_v3(p_event_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  with recursive lineage as (
    select event.id, event.subject_event_id, 0 as depth
    from public.clinical_measurement_raw_events_v3 event
    where event.id = p_event_id
    union all
    select parent.id, parent.subject_event_id, lineage.depth + 1
    from lineage
    join public.clinical_measurement_raw_events_v3 parent on parent.id = lineage.subject_event_id
    where lineage.depth < 64
  ), claims as (
    select lineage.id, lineage.depth, generic.payload_kind
    from lineage
    join public.clinical_measurement_raw_event_payload_claims_v3 generic on generic.event_id = lineage.id
    union all
    select lineage.id, lineage.depth, aba.payload_kind
    from lineage
    join public.clinical_aba_raw_payload_claims_v3 aba on aba.event_id = lineage.id
  )
  select claims.payload_kind from claims order by claims.depth limit 1;
$function$;

create or replace function public.ensure_clinical_measurement_raw_payload_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_payload_kind text;
  v_subject_payload_kind text;
  v_replacement_payload_kind text;
begin
  select coalesce(generic.payload_kind, aba.payload_kind)
    into v_payload_kind
  from (select new.id as event_id) source
  left join public.clinical_measurement_raw_event_payload_claims_v3 generic on generic.event_id = source.event_id
  left join public.clinical_aba_raw_payload_claims_v3 aba on aba.event_id = source.event_id;

  if new.event_kind in ('FACT','CORRECTION') and v_payload_kind is null then
    raise exception 'CMV3_RAW_EVENT_TYPED_PAYLOAD_REQUIRED';
  end if;
  if new.event_kind in ('VOID','SUPERSEDE') and v_payload_kind is not null then
    raise exception 'CMV3_RAW_COMPENSATION_PAYLOAD_FORBIDDEN';
  end if;

  if new.event_kind = 'CORRECTION' then
    v_subject_payload_kind := public.resolve_clinical_measurement_payload_kind_v3(new.subject_event_id);
    if v_subject_payload_kind is null or v_subject_payload_kind is distinct from v_payload_kind then
      raise exception 'CMV3_RAW_CORRECTION_PAYLOAD_KIND_MISMATCH';
    end if;
  end if;

  if new.event_kind = 'SUPERSEDE' then
    v_subject_payload_kind := public.resolve_clinical_measurement_payload_kind_v3(new.subject_event_id);
    v_replacement_payload_kind := public.resolve_clinical_measurement_payload_kind_v3(new.replacement_event_id);
    if v_subject_payload_kind is null or v_replacement_payload_kind is null
       or v_subject_payload_kind is distinct from v_replacement_payload_kind then
      raise exception 'CMV3_RAW_SUPERSEDE_PAYLOAD_KIND_MISMATCH';
    end if;
  end if;
  return null;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Ordered ABA trials. The trial owns no outcome score. Ordered steps are the raw
-- clinical evidence; opportunity_role is always derived by the server.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_aba_trials_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  expectation_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  protocol_snapshot_id uuid not null,
  definition_version_id uuid not null,
  trial_type text not null check (trial_type in (
    'TEACHING','PROBE','BASELINE_PROBE','MAINTENANCE_PROBE','GENERALIZATION','OTHER'
  )),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null,
  constraint cabav3_trial_time_shape check (
    started_at is null or completed_at is null or completed_at >= started_at
  ),
  foreign key (event_id, organization_id, patient_id, session_id, expectation_id, target_id, stream_id)
    references public.clinical_measurement_raw_events_v3(
      id, organization_id, patient_id, session_id, expectation_id, target_id, stream_id
    ) on delete restrict,
  foreign key (protocol_snapshot_id, organization_id, patient_id, target_id)
    references public.clinical_collection_protocol_snapshots_v3(
      id, organization_id, patient_id, target_id
    ) on delete restrict,
  unique (event_id, organization_id, patient_id, target_id, definition_version_id)
);

create index if not exists idx_cabav3_trials_session_target
  on public.clinical_measurement_aba_trials_v3(organization_id, patient_id, session_id, target_id, event_id);

create table if not exists public.clinical_measurement_aba_trial_steps_v3 (
  id uuid primary key default gen_random_uuid(),
  trial_event_id uuid not null,
  organization_id uuid not null,
  patient_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  sequence_no integer not null check (sequence_no > 0),
  client_step_id text not null,
  step_kind text not null check (step_kind in ('RESPONSE','PROMPT','CORRECTION','TRANSFER')),
  opportunity_role text not null default 'SUPPORT'
    check (opportunity_role in ('PRIMARY_INDEPENDENT','SUPPORT','CORRECTION','TRANSFER')),
  outcome text check (outcome is null or outcome in ('CORRECT','INCORRECT','NO_RESPONSE')),
  prompt_level_id uuid,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint cabav3_trial_step_client_id_nonempty check (length(trim(client_step_id)) between 1 and 240),
  constraint cabav3_trial_step_response_shape check (
    (step_kind = 'RESPONSE' and outcome is not null)
    or (step_kind <> 'RESPONSE' and outcome is null)
  ),
  constraint cabav3_trial_step_prompt_shape check (
    (step_kind = 'PROMPT' and prompt_level_id is not null)
    or (step_kind <> 'PROMPT' and prompt_level_id is null)
  ),
  foreign key (trial_event_id, organization_id, patient_id, target_id, definition_version_id)
    references public.clinical_measurement_aba_trials_v3(
      event_id, organization_id, patient_id, target_id, definition_version_id
    ) on delete restrict,
  unique (trial_event_id, sequence_no),
  unique (trial_event_id, client_step_id)
);

create unique index if not exists ux_cabav3_trial_one_primary_independent
  on public.clinical_measurement_aba_trial_steps_v3(trial_event_id)
  where opportunity_role = 'PRIMARY_INDEPENDENT';
create index if not exists idx_cabav3_trial_steps_timeline
  on public.clinical_measurement_aba_trial_steps_v3(trial_event_id, sequence_no);

-- ---------------------------------------------------------------------------
-- Task Analysis raw run + step results. Eligibility is looked up from the frozen
-- chaining policy and cannot be accepted from client payloads.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_aba_task_runs_v3 (
  event_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  expectation_id uuid not null,
  target_id uuid not null,
  stream_id uuid not null,
  protocol_snapshot_id uuid not null,
  definition_version_id uuid not null,
  chaining_policy_version_id uuid not null,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  created_at timestamptz not null,
  constraint cabav3_task_run_time_shape check (completed_at >= started_at),
  foreign key (event_id, organization_id, patient_id, session_id, expectation_id, target_id, stream_id)
    references public.clinical_measurement_raw_events_v3(
      id, organization_id, patient_id, session_id, expectation_id, target_id, stream_id
    ) on delete restrict,
  foreign key (chaining_policy_version_id, organization_id, patient_id, target_id, definition_version_id)
    references public.clinical_aba_chaining_policy_versions_v3(
      id, organization_id, patient_id, target_id, definition_version_id
    ) on delete restrict,
  unique (event_id, organization_id, patient_id, target_id, definition_version_id)
);

create index if not exists idx_cabav3_task_runs_session_target
  on public.clinical_measurement_aba_task_runs_v3(organization_id, patient_id, session_id, target_id, event_id);

create table if not exists public.clinical_measurement_aba_task_step_results_v3 (
  id uuid primary key default gen_random_uuid(),
  run_event_id uuid not null,
  organization_id uuid not null,
  patient_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  step_definition_id uuid not null,
  sequence_no integer not null check (sequence_no > 0),
  client_step_id text not null,
  eligibility text not null default 'NOT_ELIGIBLE'
    check (eligibility in ('ACQUISITION','MAINTENANCE','TRAINER_COMPLETED','NOT_ELIGIBLE')),
  performance_code text not null
    check (performance_code in ('INDEPENDENT','PROMPTED','INCORRECT','NO_RESPONSE','NOT_APPLICABLE','NOT_OBSERVED')),
  prompt_level_id uuid,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint cabav3_task_result_client_id_nonempty check (length(trim(client_step_id)) between 1 and 240),
  constraint cabav3_task_result_prompt_shape check (
    (performance_code = 'PROMPTED' and prompt_level_id is not null)
    or (performance_code <> 'PROMPTED' and prompt_level_id is null)
  ),
  foreign key (run_event_id, organization_id, patient_id, target_id, definition_version_id)
    references public.clinical_measurement_aba_task_runs_v3(
      event_id, organization_id, patient_id, target_id, definition_version_id
    ) on delete restrict,
  foreign key (step_definition_id, definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_aba_task_step_definitions_v3(
      id, definition_version_id, organization_id, patient_id, target_id
    ) on delete restrict,
  unique (run_event_id, sequence_no),
  unique (run_event_id, step_definition_id),
  unique (run_event_id, client_step_id)
);

-- ---------------------------------------------------------------------------
-- Scope/semantic validators. These are server-owned and intentionally do not
-- expose writer functions to authenticated/browser roles.
-- ---------------------------------------------------------------------------
create or replace function public.validate_clinical_aba_configuration_scope_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_family text;
  v_org uuid;
  v_patient uuid;
  v_target uuid;
begin
  if tg_table_name = 'clinical_aba_prompt_hierarchies_v3' then
    select d.semantic_family, d.organization_id, d.patient_id, d.target_id
      into v_family, v_org, v_patient, v_target
    from public.clinical_measurement_definitions_v3 d
    where d.id = new.definition_id;
    if not found or v_org is distinct from new.organization_id
       or v_patient is distinct from new.patient_id or v_target is distinct from new.target_id
       or v_family not in ('PROPORTION','TASK_ANALYSIS') then
      raise exception 'CMV3_ABA_PROMPT_HIERARCHY_DEFINITION_INVALID';
    end if;
  else
    select d.semantic_family, v.organization_id, v.patient_id, v.target_id
      into v_family, v_org, v_patient, v_target
    from public.clinical_measurement_definition_versions_v3 v
    join public.clinical_measurement_definitions_v3 d on d.id = v.definition_id
    where v.id = new.definition_version_id;
    if not found or v_org is distinct from new.organization_id
       or v_patient is distinct from new.patient_id or v_target is distinct from new.target_id
       or v_family <> 'TASK_ANALYSIS' then
      raise exception 'CMV3_ABA_TASK_ANALYSIS_DEFINITION_INVALID';
    end if;

    if tg_table_name = 'clinical_aba_task_step_definitions_v3' and exists (
      select 1
      from public.clinical_aba_chaining_policy_versions_v3 policy
      where policy.definition_version_id = new.definition_version_id
        and policy.status in ('PUBLISHED','DEPRECATED','ARCHIVED')
    ) then
      raise exception 'CMV3_ABA_TASK_STEP_SET_ALREADY_SEALED';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.validate_clinical_aba_protocol_binding_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_snapshot public.clinical_collection_protocol_snapshots_v3%rowtype;
  v_definition public.clinical_measurement_definition_versions_v3%rowtype;
  v_prompt public.clinical_aba_prompt_hierarchy_versions_v3%rowtype;
  v_chain public.clinical_aba_chaining_policy_versions_v3%rowtype;
begin
  select * into v_snapshot from public.clinical_collection_protocol_snapshots_v3 where id = new.protocol_snapshot_id;
  if not found
     or v_snapshot.organization_id is distinct from new.organization_id
     or v_snapshot.patient_id is distinct from new.patient_id
     or v_snapshot.target_id is distinct from new.target_id
     or v_snapshot.definition_version_id is distinct from new.definition_version_id then
    raise exception 'CMV3_ABA_PROTOCOL_SNAPSHOT_SCOPE_INVALID';
  end if;

  select * into v_definition from public.clinical_measurement_definition_versions_v3 where id = new.definition_version_id;
  if not found or v_definition.organization_id is distinct from new.organization_id
     or v_definition.patient_id is distinct from new.patient_id
     or v_definition.target_id is distinct from new.target_id then
    raise exception 'CMV3_ABA_PROTOCOL_DEFINITION_SCOPE_INVALID';
  end if;

  if new.prompt_hierarchy_version_id is not null then
    select * into v_prompt from public.clinical_aba_prompt_hierarchy_versions_v3 where id = new.prompt_hierarchy_version_id;
    if not found or v_prompt.organization_id is distinct from new.organization_id
       or v_prompt.patient_id is distinct from new.patient_id
       or v_prompt.target_id is distinct from new.target_id
       or v_prompt.definition_id is distinct from v_definition.definition_id
       or v_prompt.status <> 'PUBLISHED' then
      raise exception 'CMV3_ABA_PROMPT_HIERARCHY_SCOPE_INVALID';
    end if;
  end if;

  if new.chaining_policy_version_id is not null then
    select * into v_chain from public.clinical_aba_chaining_policy_versions_v3 where id = new.chaining_policy_version_id;
    if not found or v_chain.organization_id is distinct from new.organization_id
       or v_chain.patient_id is distinct from new.patient_id
       or v_chain.target_id is distinct from new.target_id
       or v_chain.definition_version_id is distinct from new.definition_version_id
       or v_chain.status <> 'PUBLISHED' then
      raise exception 'CMV3_ABA_CHAINING_POLICY_SCOPE_INVALID';
    end if;
  end if;

  if v_definition.content->>'kind' = 'TASK_ANALYSIS' and new.chaining_policy_version_id is null then
    raise exception 'CMV3_ABA_TASK_ANALYSIS_REQUIRES_CHAINING_POLICY';
  end if;

  return new;
end;
$function$;

create or replace function public.prepare_clinical_aba_trial_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_event public.clinical_measurement_raw_events_v3%rowtype;
  v_binding public.clinical_aba_protocol_bindings_v3%rowtype;
begin
  select * into v_event from public.clinical_measurement_raw_events_v3 where id = new.event_id;
  if not found or v_event.organization_id is distinct from new.organization_id
     or v_event.patient_id is distinct from new.patient_id
     or v_event.session_id is distinct from new.session_id
     or v_event.expectation_id is distinct from new.expectation_id
     or v_event.target_id is distinct from new.target_id
     or v_event.stream_id is distinct from new.stream_id
     or v_event.protocol_snapshot_id is distinct from new.protocol_snapshot_id
     or v_event.definition_version_id is distinct from new.definition_version_id
     or v_event.semantic_family <> 'PROPORTION'
     or v_event.event_kind not in ('FACT','CORRECTION') then
    raise exception 'CMV3_ABA_TRIAL_RAW_EVENT_INVALID';
  end if;

  select * into v_binding from public.clinical_aba_protocol_bindings_v3 where protocol_snapshot_id = new.protocol_snapshot_id;
  if not found then raise exception 'CMV3_ABA_TRIAL_PROTOCOL_BINDING_REQUIRED'; end if;

  new.created_at := v_event.recorded_at;
  insert into public.clinical_aba_raw_payload_claims_v3(event_id, payload_kind)
  values (new.event_id, 'ABA_TRIAL');
  return new;
end;
$function$;

create or replace function public.prepare_clinical_aba_trial_step_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_trial public.clinical_measurement_aba_trials_v3%rowtype;
  v_binding public.clinical_aba_protocol_bindings_v3%rowtype;
  v_level public.clinical_aba_prompt_hierarchy_levels_v3%rowtype;
begin
  select * into v_trial from public.clinical_measurement_aba_trials_v3 where event_id = new.trial_event_id;
  if not found then raise exception 'CMV3_ABA_TRIAL_STEP_TRIAL_NOT_FOUND'; end if;
  if (v_trial.started_at is not null and new.occurred_at < v_trial.started_at)
     or (v_trial.completed_at is not null and new.occurred_at > v_trial.completed_at) then
    raise exception 'CMV3_ABA_TRIAL_STEP_OUTSIDE_TRIAL_WINDOW';
  end if;
  new.organization_id := v_trial.organization_id;
  new.patient_id := v_trial.patient_id;
  new.target_id := v_trial.target_id;
  new.definition_version_id := v_trial.definition_version_id;

  select * into v_binding from public.clinical_aba_protocol_bindings_v3 where protocol_snapshot_id = v_trial.protocol_snapshot_id;
  if not found then raise exception 'CMV3_ABA_TRIAL_STEP_PROTOCOL_BINDING_REQUIRED'; end if;

  if new.prompt_level_id is not null then
    if v_binding.prompt_hierarchy_version_id is null then raise exception 'CMV3_ABA_PROMPT_NOT_CONFIGURED'; end if;
    select * into v_level from public.clinical_aba_prompt_hierarchy_levels_v3 level
    where level.id = new.prompt_level_id and level.hierarchy_version_id = v_binding.prompt_hierarchy_version_id;
    if not found or v_level.organization_id is distinct from v_trial.organization_id
       or v_level.patient_id is distinct from v_trial.patient_id
       or v_level.target_id is distinct from v_trial.target_id
       or v_level.is_independent then
      raise exception 'CMV3_ABA_PROMPT_LEVEL_SCOPE_INVALID';
    end if;
  end if;

  if new.step_kind = 'CORRECTION' then
    new.opportunity_role := 'CORRECTION';
  elsif new.step_kind = 'TRANSFER' then
    new.opportunity_role := 'TRANSFER';
  elsif new.step_kind = 'PROMPT' then
    new.opportunity_role := 'SUPPORT';
  elsif new.step_kind = 'RESPONSE'
        and new.sequence_no = 1
        and v_binding.initial_opportunity_mode = 'INDEPENDENT_ELIGIBLE' then
    new.opportunity_role := 'PRIMARY_INDEPENDENT';
  else
    new.opportunity_role := 'SUPPORT';
  end if;

  return new;
end;
$function$;

create or replace function public.prepare_clinical_aba_task_run_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_event public.clinical_measurement_raw_events_v3%rowtype;
  v_binding public.clinical_aba_protocol_bindings_v3%rowtype;
begin
  select * into v_event from public.clinical_measurement_raw_events_v3 where id = new.event_id;
  if not found or v_event.organization_id is distinct from new.organization_id
     or v_event.patient_id is distinct from new.patient_id
     or v_event.session_id is distinct from new.session_id
     or v_event.expectation_id is distinct from new.expectation_id
     or v_event.target_id is distinct from new.target_id
     or v_event.stream_id is distinct from new.stream_id
     or v_event.protocol_snapshot_id is distinct from new.protocol_snapshot_id
     or v_event.definition_version_id is distinct from new.definition_version_id
     or v_event.semantic_family <> 'TASK_ANALYSIS'
     or v_event.event_kind not in ('FACT','CORRECTION') then
    raise exception 'CMV3_ABA_TASK_RUN_RAW_EVENT_INVALID';
  end if;

  select * into v_binding from public.clinical_aba_protocol_bindings_v3 where protocol_snapshot_id = new.protocol_snapshot_id;
  if not found or v_binding.chaining_policy_version_id is null
     or v_binding.chaining_policy_version_id is distinct from new.chaining_policy_version_id then
    raise exception 'CMV3_ABA_TASK_RUN_CHAINING_BINDING_INVALID';
  end if;

  new.created_at := v_event.recorded_at;
  insert into public.clinical_aba_raw_payload_claims_v3(event_id, payload_kind)
  values (new.event_id, 'ABA_TASK_ANALYSIS');
  return new;
end;
$function$;

create or replace function public.prepare_clinical_aba_task_result_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_run public.clinical_measurement_aba_task_runs_v3%rowtype;
  v_rule public.clinical_aba_chaining_step_rules_v3%rowtype;
  v_binding public.clinical_aba_protocol_bindings_v3%rowtype;
  v_level public.clinical_aba_prompt_hierarchy_levels_v3%rowtype;
begin
  select * into v_run from public.clinical_measurement_aba_task_runs_v3 where event_id = new.run_event_id;
  if not found then raise exception 'CMV3_ABA_TASK_RESULT_RUN_NOT_FOUND'; end if;
  if new.occurred_at < v_run.started_at or new.occurred_at > v_run.completed_at then
    raise exception 'CMV3_ABA_TASK_RESULT_OUTSIDE_RUN_WINDOW';
  end if;
  new.organization_id := v_run.organization_id;
  new.patient_id := v_run.patient_id;
  new.target_id := v_run.target_id;
  new.definition_version_id := v_run.definition_version_id;

  select * into v_rule from public.clinical_aba_chaining_step_rules_v3 rule
  where rule.policy_version_id = v_run.chaining_policy_version_id
    and rule.step_definition_id = new.step_definition_id
    and rule.sequence_no = new.sequence_no;
  if not found then raise exception 'CMV3_ABA_TASK_STEP_NOT_IN_CHAINING_POLICY'; end if;
  new.eligibility := v_rule.eligibility;

  if new.prompt_level_id is not null then
    select * into v_binding from public.clinical_aba_protocol_bindings_v3 where protocol_snapshot_id = v_run.protocol_snapshot_id;
    if not found or v_binding.prompt_hierarchy_version_id is null then raise exception 'CMV3_ABA_TASK_PROMPT_NOT_CONFIGURED'; end if;
    select * into v_level from public.clinical_aba_prompt_hierarchy_levels_v3 level
    where level.id = new.prompt_level_id and level.hierarchy_version_id = v_binding.prompt_hierarchy_version_id;
    if not found or v_level.is_independent then raise exception 'CMV3_ABA_TASK_PROMPT_LEVEL_INVALID'; end if;
  end if;

  return new;
end;
$function$;

-- Draft configuration rows are populated first, then atomically published. The
-- server computes hashes from the complete ordered level/rule set at publication.
create or replace function public.guard_clinical_aba_config_child_insert_v3()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public set row_security = off
as $function$
declare
  v_status text;
  v_prompt_org uuid;
begin
  if tg_table_name = 'clinical_aba_prompt_hierarchy_levels_v3' then
    select status into v_status from public.clinical_aba_prompt_hierarchy_versions_v3 where id = new.hierarchy_version_id;
    if v_status is distinct from 'DRAFT' then raise exception 'CMV3_ABA_PROMPT_VERSION_NOT_DRAFT'; end if;
    if new.legacy_prompt_type_id is not null then
      select organization_id into v_prompt_org from public.aba_prompt_types where id = new.legacy_prompt_type_id;
      if not found or v_prompt_org is distinct from new.organization_id then
        raise exception 'CMV3_ABA_LEGACY_PROMPT_SCOPE_INVALID';
      end if;
    end if;
  else
    select status into v_status from public.clinical_aba_chaining_policy_versions_v3 where id = new.policy_version_id;
    if v_status is distinct from 'DRAFT' then raise exception 'CMV3_ABA_CHAINING_VERSION_NOT_DRAFT'; end if;
  end if;
  return new;
end;
$function$;

create or replace function public.publish_clinical_aba_prompt_hierarchy_version_v3(p_version_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public, extensions set row_security = off
as $function$
declare
  v_version public.clinical_aba_prompt_hierarchy_versions_v3%rowtype;
  v_levels jsonb;
  v_independent_count integer;
begin
  select * into v_version from public.clinical_aba_prompt_hierarchy_versions_v3 where id = p_version_id for update;
  if not found or v_version.status <> 'DRAFT' then raise exception 'CMV3_ABA_PROMPT_PUBLISH_REQUIRES_DRAFT'; end if;

  select jsonb_agg(jsonb_build_object(
           'sequence_no', l.sequence_no, 'prompt_key', l.prompt_key, 'label', l.label,
           'category', l.category, 'is_independent', l.is_independent
         ) order by l.sequence_no),
         count(*) filter (where l.is_independent)
    into v_levels, v_independent_count
  from public.clinical_aba_prompt_hierarchy_levels_v3 l
  where l.hierarchy_version_id = p_version_id;

  if jsonb_array_length(coalesce(v_levels, '[]'::jsonb)) < 2 then raise exception 'CMV3_ABA_PROMPT_HIERARCHY_TOO_SHORT'; end if;
  if v_independent_count <> 1 then raise exception 'CMV3_ABA_PROMPT_HIERARCHY_REQUIRES_ONE_INDEPENDENT'; end if;

  update public.clinical_aba_prompt_hierarchy_versions_v3
     set status = 'PUBLISHED', published_at = clock_timestamp(),
         version_hash = encode(digest(convert_to(jsonb_build_object(
           'hierarchy_id', v_version.hierarchy_id, 'version', v_version.version,
           'strategy', v_version.strategy, 'levels', v_levels
         )::text,'UTF8'),'sha256'),'hex')
   where id = p_version_id;
end;
$function$;

create or replace function public.publish_clinical_aba_chaining_policy_version_v3(p_version_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public, extensions set row_security = off
as $function$
declare
  v_version public.clinical_aba_chaining_policy_versions_v3%rowtype;
  v_rules jsonb;
  v_rule_count integer;
  v_step_count integer;
begin
  select * into v_version from public.clinical_aba_chaining_policy_versions_v3 where id = p_version_id for update;
  if not found or v_version.status <> 'DRAFT' then raise exception 'CMV3_ABA_CHAINING_PUBLISH_REQUIRES_DRAFT'; end if;

  select count(*) into v_step_count
  from public.clinical_aba_task_step_definitions_v3 s
  where s.definition_version_id = v_version.definition_version_id;
  select jsonb_agg(jsonb_build_object(
           'sequence_no', r.sequence_no, 'step_definition_id', r.step_definition_id,
           'eligibility', r.eligibility
         ) order by r.sequence_no), count(*)
    into v_rules, v_rule_count
  from public.clinical_aba_chaining_step_rules_v3 r
  where r.policy_version_id = p_version_id;

  if v_step_count = 0 or v_rule_count <> v_step_count then
    raise exception 'CMV3_ABA_CHAINING_RULE_COVERAGE_INCOMPLETE';
  end if;

  update public.clinical_aba_chaining_policy_versions_v3
     set status = 'PUBLISHED', published_at = clock_timestamp(),
         policy_hash = encode(digest(convert_to(jsonb_build_object(
           'definition_version_id', v_version.definition_version_id,
           'policy_key', v_version.policy_key, 'version', v_version.version,
           'strategy', v_version.strategy, 'rules', v_rules
         )::text,'UTF8'),'sha256'),'hex')
   where id = p_version_id;
end;
$function$;

create or replace function public.guard_clinical_aba_append_only_v3()
returns trigger language plpgsql set search_path = pg_catalog, public
as $function$
begin
  raise exception 'CMV3_ABA_APPEND_ONLY';
end;
$function$;

create or replace function public.guard_clinical_aba_version_lifecycle_v3()
returns trigger language plpgsql set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then raise exception 'CMV3_ABA_VERSION_DELETE_FORBIDDEN'; end if;

  if old.status = 'DRAFT' and new.status = 'PUBLISHED' then
    if (to_jsonb(old) - array['status','published_at','version_hash','policy_hash']::text[])
       is distinct from (to_jsonb(new) - array['status','published_at','version_hash','policy_hash']::text[]) then
      raise exception 'CMV3_ABA_VERSION_PUBLISH_MUTATION_INVALID';
    end if;
    return new;
  end if;

  if old.status = 'PUBLISHED' and new.status in ('DEPRECATED','ARCHIVED') then
    if (to_jsonb(old) - array['status','deprecated_at']::text[])
       is distinct from (to_jsonb(new) - array['status','deprecated_at']::text[]) then
      raise exception 'CMV3_ABA_VERSION_IMMUTABLE';
    end if;
    if new.deprecated_at is null then raise exception 'CMV3_ABA_VERSION_DEPRECATION_TIME_REQUIRED'; end if;
    return new;
  end if;

  raise exception 'CMV3_ABA_VERSION_TRANSITION_INVALID';
end;
$function$;

-- Validators/triggers.
drop trigger if exists validate_cabav3_prompt_hierarchy_scope on public.clinical_aba_prompt_hierarchies_v3;
create trigger validate_cabav3_prompt_hierarchy_scope
before insert on public.clinical_aba_prompt_hierarchies_v3
for each row execute function public.validate_clinical_aba_configuration_scope_v3();

drop trigger if exists validate_cabav3_task_step_scope on public.clinical_aba_task_step_definitions_v3;
create trigger validate_cabav3_task_step_scope
before insert on public.clinical_aba_task_step_definitions_v3
for each row execute function public.validate_clinical_aba_configuration_scope_v3();

drop trigger if exists validate_cabav3_chaining_scope on public.clinical_aba_chaining_policy_versions_v3;
create trigger validate_cabav3_chaining_scope
before insert on public.clinical_aba_chaining_policy_versions_v3
for each row execute function public.validate_clinical_aba_configuration_scope_v3();

drop trigger if exists validate_cabav3_protocol_binding on public.clinical_aba_protocol_bindings_v3;
create trigger validate_cabav3_protocol_binding
before insert on public.clinical_aba_protocol_bindings_v3
for each row execute function public.validate_clinical_aba_protocol_binding_v3();

drop trigger if exists guard_cabav3_prompt_level_insert on public.clinical_aba_prompt_hierarchy_levels_v3;
create trigger guard_cabav3_prompt_level_insert
before insert on public.clinical_aba_prompt_hierarchy_levels_v3
for each row execute function public.guard_clinical_aba_config_child_insert_v3();

drop trigger if exists guard_cabav3_chaining_rule_insert on public.clinical_aba_chaining_step_rules_v3;
create trigger guard_cabav3_chaining_rule_insert
before insert on public.clinical_aba_chaining_step_rules_v3
for each row execute function public.guard_clinical_aba_config_child_insert_v3();

drop trigger if exists prepare_cabav3_trial on public.clinical_measurement_aba_trials_v3;
create trigger prepare_cabav3_trial
before insert on public.clinical_measurement_aba_trials_v3
for each row execute function public.prepare_clinical_aba_trial_v3();

drop trigger if exists prepare_cabav3_trial_step on public.clinical_measurement_aba_trial_steps_v3;
create trigger prepare_cabav3_trial_step
before insert on public.clinical_measurement_aba_trial_steps_v3
for each row execute function public.prepare_clinical_aba_trial_step_v3();

drop trigger if exists prepare_cabav3_task_run on public.clinical_measurement_aba_task_runs_v3;
create trigger prepare_cabav3_task_run
before insert on public.clinical_measurement_aba_task_runs_v3
for each row execute function public.prepare_clinical_aba_task_run_v3();

drop trigger if exists prepare_cabav3_task_result on public.clinical_measurement_aba_task_step_results_v3;
create trigger prepare_cabav3_task_result
before insert on public.clinical_measurement_aba_task_step_results_v3
for each row execute function public.prepare_clinical_aba_task_result_v3();

-- All ABA V3 configuration/raw facts except version lifecycle rows are immutable.
do $cabav3_append_only_triggers$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinical_aba_prompt_hierarchies_v3',
    'clinical_aba_prompt_hierarchy_levels_v3',
    'clinical_aba_task_step_definitions_v3',
    'clinical_aba_chaining_step_rules_v3',
    'clinical_aba_protocol_bindings_v3',
    'clinical_aba_raw_payload_claims_v3',
    'clinical_measurement_aba_trials_v3',
    'clinical_measurement_aba_trial_steps_v3',
    'clinical_measurement_aba_task_runs_v3',
    'clinical_measurement_aba_task_step_results_v3'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'guard_' || v_table || '_append_only', v_table);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.guard_clinical_aba_append_only_v3()',
      'guard_' || v_table || '_append_only', v_table
    );
  end loop;
end;
$cabav3_append_only_triggers$;

drop trigger if exists guard_cabav3_prompt_hierarchy_version on public.clinical_aba_prompt_hierarchy_versions_v3;
create trigger guard_cabav3_prompt_hierarchy_version
before update or delete on public.clinical_aba_prompt_hierarchy_versions_v3
for each row execute function public.guard_clinical_aba_version_lifecycle_v3();

drop trigger if exists guard_cabav3_chaining_policy_version on public.clinical_aba_chaining_policy_versions_v3;
create trigger guard_cabav3_chaining_policy_version
before update or delete on public.clinical_aba_chaining_policy_versions_v3
for each row execute function public.guard_clinical_aba_version_lifecycle_v3();

-- RLS/dark surface. No browser role receives direct access.
do $cabav3_rls$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinical_aba_prompt_hierarchies_v3',
    'clinical_aba_prompt_hierarchy_versions_v3',
    'clinical_aba_prompt_hierarchy_levels_v3',
    'clinical_aba_task_step_definitions_v3',
    'clinical_aba_chaining_policy_versions_v3',
    'clinical_aba_chaining_step_rules_v3',
    'clinical_aba_protocol_bindings_v3',
    'clinical_aba_raw_payload_claims_v3',
    'clinical_measurement_aba_trials_v3',
    'clinical_measurement_aba_trial_steps_v3',
    'clinical_measurement_aba_task_runs_v3',
    'clinical_measurement_aba_task_step_results_v3'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant all on table public.%I to service_role', v_table);
  end loop;
end;
$cabav3_rls$;

-- Functions are service-only.
do $cabav3_function_acl$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.guard_clinical_aba_payload_claim_exclusivity_v3()',
    'public.resolve_clinical_measurement_payload_kind_v3(uuid)',
    'public.ensure_clinical_measurement_raw_payload_v3()',
    'public.validate_clinical_aba_configuration_scope_v3()',
    'public.validate_clinical_aba_protocol_binding_v3()',
    'public.prepare_clinical_aba_trial_v3()',
    'public.prepare_clinical_aba_trial_step_v3()',
    'public.prepare_clinical_aba_task_run_v3()',
    'public.prepare_clinical_aba_task_result_v3()',
    'public.guard_clinical_aba_config_child_insert_v3()',
    'public.publish_clinical_aba_prompt_hierarchy_version_v3(uuid)',
    'public.publish_clinical_aba_chaining_policy_version_v3(uuid)',
    'public.guard_clinical_aba_append_only_v3()',
    'public.guard_clinical_aba_version_lifecycle_v3()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end;
$cabav3_function_acl$;


-- ===========================================================================
-- Embedded canonical block 07/12: 20260820190000_clinical_measurement_v3_bulk_ingestion.sql
-- ===========================================================================
-- Verto Clinical Measurement Engine V3 - Bulk/offline ingestion.
-- Additive/dark only. Adds one server-only transactional entrypoint and set-based
-- payload handlers. No authenticated/browser grant and no rollout change.


create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Append-only ingestion provenance. Failed batches leave no row because the RPC
-- is atomic; accepted batches can be replayed exactly by client_batch_id + hash.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_sync_batches_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  actor_membership_id uuid not null references public.clinic_memberships(id) on delete restrict,
  client_batch_id text not null,
  payload_hash text not null,
  item_count integer not null check (item_count between 1 and 500),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint cmv3_sync_batch_client_id_shape check (length(trim(client_batch_id)) between 1 and 180),
  constraint cmv3_sync_batch_hash_shape check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint cmv3_sync_batch_clock_shape check (created_at = received_at),
  unique (organization_id, client_batch_id),
  unique (id, organization_id, patient_id)
);

create table if not exists public.clinical_measurement_sync_batch_events_v3 (
  batch_id uuid not null,
  ordinal integer not null check (ordinal > 0),
  organization_id uuid not null,
  patient_id uuid not null,
  event_id uuid not null,
  client_event_id text not null,
  created_at timestamptz not null default now(),
  primary key (batch_id, ordinal),
  foreign key (batch_id, organization_id, patient_id)
    references public.clinical_measurement_sync_batches_v3(id, organization_id, patient_id)
    on delete restrict,
  foreign key (event_id)
    references public.clinical_measurement_raw_events_v3(id)
    on delete restrict,
  unique (batch_id, client_event_id),
  unique (batch_id, event_id)
);

create index if not exists idx_cmv3_sync_batches_patient
  on public.clinical_measurement_sync_batches_v3(organization_id, patient_id, received_at desc);
create index if not exists idx_cmv3_sync_batch_events_event
  on public.clinical_measurement_sync_batch_events_v3(event_id, batch_id);

-- ABA trial intent is frozen server-side per protocol snapshot. The tablet may
-- record trial mechanics, but cannot declare whether a trial is teaching/probe.
create table if not exists public.clinical_aba_trial_protocol_intents_v3 (
  protocol_snapshot_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  trial_type text not null check (trial_type in (
    'TEACHING','PROBE','BASELINE_PROBE','MAINTENANCE_PROBE','GENERALIZATION','OTHER'
  )),
  created_at timestamptz not null default now(),
  foreign key (protocol_snapshot_id)
    references public.clinical_aba_protocol_bindings_v3(protocol_snapshot_id) on delete restrict,
  foreign key (protocol_snapshot_id, organization_id, patient_id, target_id)
    references public.clinical_collection_protocol_snapshots_v3(
      id, organization_id, patient_id, target_id
    ) on delete restrict,
  foreign key (definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definition_versions_v3(
      id, organization_id, patient_id, target_id
    ) on delete restrict
);

create or replace function public.prepare_clinical_aba_trial_protocol_intent_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_snapshot public.clinical_collection_protocol_snapshots_v3%rowtype;
  v_family text;
begin
  select * into v_snapshot
  from public.clinical_collection_protocol_snapshots_v3 snapshot
  where snapshot.id = new.protocol_snapshot_id;

  if not found then
    raise exception 'CMV3_ABA_TRIAL_INTENT_SNAPSHOT_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.clinical_aba_protocol_bindings_v3 binding
    where binding.protocol_snapshot_id = v_snapshot.id
  ) then
    raise exception 'CMV3_ABA_TRIAL_INTENT_BINDING_REQUIRED';
  end if;

  select definition.semantic_family into v_family
  from public.clinical_measurement_definition_versions_v3 version
  join public.clinical_measurement_definitions_v3 definition
    on definition.id = version.definition_id
   and definition.organization_id = version.organization_id
   and definition.patient_id = version.patient_id
   and definition.target_id = version.target_id
  where version.id = v_snapshot.definition_version_id;

  if v_family is distinct from 'PROPORTION' then
    raise exception 'CMV3_ABA_TRIAL_INTENT_REQUIRES_PROPORTION';
  end if;

  new.organization_id := v_snapshot.organization_id;
  new.patient_id := v_snapshot.patient_id;
  new.target_id := v_snapshot.target_id;
  new.definition_version_id := v_snapshot.definition_version_id;
  new.created_at := clock_timestamp();
  return new;
end;
$function$;

create or replace function public.guard_clinical_aba_trial_protocol_intent_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'CMV3_ABA_TRIAL_PROTOCOL_INTENT_IMMUTABLE';
end;
$function$;

create or replace function public.guard_clinical_measurement_sync_provenance_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'CMV3_SYNC_PROVENANCE_APPEND_ONLY';
end;
$function$;

-- ---------------------------------------------------------------------------
-- Shared validation helpers. They never trust organization/patient/scope fields
-- from the payload; stream scope and actor authority are resolved server-side.
-- ---------------------------------------------------------------------------
create or replace function public.validate_clinical_measurement_sync_batch_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_actor_membership_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_actor_role text;
  v_actor_status text;
  v_actor_clinic uuid;
  v_step_count bigint;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'CMV3_SYNC_ITEMS_ARRAY_REQUIRED';
  end if;

  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 500 then
    raise exception 'CMV3_SYNC_BATCH_SIZE_INVALID';
  end if;

  if octet_length(p_items::text) > 2000000 then
    raise exception 'CMV3_SYNC_BATCH_BYTES_EXCEEDED';
  end if;

  select membership.clinic_id, lower(coalesce(membership.status,'')), lower(coalesce(membership.role,''))
    into v_actor_clinic, v_actor_status, v_actor_role
  from public.clinic_memberships membership
  where membership.id = p_actor_membership_id;

  if not found or v_actor_clinic is distinct from p_organization_id or v_actor_status <> 'active' then
    raise exception 'CMV3_SYNC_ACTOR_SCOPE_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where nullif(trim(item->>'client_event_id'),'') is null
       or length(trim(item->>'client_event_id')) > 240
       or nullif(trim(item->>'stream_id'),'') is null
       or nullif(trim(item->>'occurred_at_utc'),'') is null
       or coalesce(item->>'event_kind','FACT') not in ('FACT','CORRECTION','VOID','SUPERSEDE')
       or coalesce(item->>'ingestion_mode','') not in ('LIVE','OFFLINE_SYNC','RETROSPECTIVE_ENTRY','CORRECTION')
  ) then
    raise exception 'CMV3_SYNC_ENVELOPE_SHAPE_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where item ?| array[
      'organization_id','patient_id','actor_membership_id','clinical_date',
      'local_occurred_date','timezone_snapshot','timezone_offset_minutes',
      'protocol_snapshot_id','definition_version_id','phase_epoch_id','semantic_family',
      'payload_hash','recorded_at','received_at'
    ]
  ) then
    raise exception 'CMV3_SYNC_SERVER_OWNED_FIELD_FORBIDDEN';
  end if;

  if exists (
    select 1
    from (
      select item->>'client_event_id' client_event_id, count(*) count_rows
      from jsonb_array_elements(p_items) item
      group by item->>'client_event_id'
    ) duplicate
    where duplicate.count_rows > 1
  ) then
    raise exception 'CMV3_SYNC_DUPLICATE_CLIENT_EVENT_IN_BATCH';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    left join public.clinical_measurement_collection_streams_v3 stream
      on stream.id = (item->>'stream_id')::uuid
     and stream.organization_id = p_organization_id
     and stream.patient_id = p_patient_id
    where stream.id is null
  ) then
    raise exception 'CMV3_SYNC_STREAM_SCOPE_INVALID';
  end if;

  -- Normal collection modes belong to the observer who owns the logical stream.
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    join public.clinical_measurement_collection_streams_v3 stream
      on stream.id = (item->>'stream_id')::uuid
    where coalesce(item->>'ingestion_mode','') in ('LIVE','OFFLINE_SYNC','RETROSPECTIVE_ENTRY')
      and stream.observer_membership_id is distinct from p_actor_membership_id
  ) then
    raise exception 'CMV3_SYNC_STREAM_OBSERVER_MISMATCH';
  end if;

  -- Corrections can be made by the original observer or clinical management.
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    join public.clinical_measurement_collection_streams_v3 stream
      on stream.id = (item->>'stream_id')::uuid
    where coalesce(item->>'ingestion_mode','') = 'CORRECTION'
      and stream.observer_membership_id is distinct from p_actor_membership_id
      and v_actor_role not in ('director','coordinator')
  ) then
    raise exception 'CMV3_SYNC_CORRECTION_AUTHORITY_REQUIRED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where (
      coalesce(item->>'event_kind','FACT') in ('FACT','CORRECTION')
      and jsonb_typeof(item->'payload') <> 'object'
    ) or (
      coalesce(item->>'event_kind','FACT') in ('VOID','SUPERSEDE')
      and item ? 'payload' and item->'payload' <> 'null'::jsonb
    )
  ) then
    raise exception 'CMV3_SYNC_PAYLOAD_EVENT_KIND_MISMATCH';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where coalesce(item->>'event_kind','FACT') in ('FACT','CORRECTION')
      and coalesce(item->'payload'->>'kind','') not in (
        'OBSERVATION_SLICE','COUNT','CATEGORY','SCALAR','TEMPORAL_INTERVAL',
        'INTERVAL_SAMPLE','EXPLICIT_ABSENCE','ABA_TRIAL','ABA_TASK_ANALYSIS'
      )
  ) then
    raise exception 'CMV3_SYNC_PAYLOAD_KIND_UNSUPPORTED';
  end if;

  select coalesce(sum(jsonb_array_length(coalesce(item->'payload'->'steps','[]'::jsonb))),0)
    into v_step_count
  from jsonb_array_elements(p_items) item
  where coalesce(item->'payload'->>'kind','') in ('ABA_TRIAL','ABA_TASK_ANALYSIS');

  if v_step_count > 5000 then
    raise exception 'CMV3_SYNC_STEP_LIMIT_EXCEEDED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where jsonb_array_length(coalesce(item->'payload'->'steps','[]'::jsonb)) > 200
  ) then
    raise exception 'CMV3_SYNC_EVENT_STEP_LIMIT_EXCEEDED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where coalesce(item->'payload'->>'kind','') in ('ABA_TRIAL','ABA_TASK_ANALYSIS')
      and (
        jsonb_typeof(item->'payload'->'steps') <> 'array'
        or jsonb_array_length(item->'payload'->'steps') < 1
      )
  ) then
    raise exception 'CMV3_SYNC_ABA_STEPS_REQUIRED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    left join lateral jsonb_array_elements(coalesce(item->'payload'->'steps','[]'::jsonb)) step on true
    where (coalesce(item->'payload'->>'kind','') = 'ABA_TRIAL' and (item->'payload' ? 'trial_type' or step ? 'opportunity_role'))
       or (coalesce(item->'payload'->>'kind','') = 'ABA_TASK_ANALYSIS' and (item->'payload' ? 'chaining_policy_version_id' or step ? 'eligibility'))
  ) then
    raise exception 'CMV3_SYNC_CLIENT_SEMANTIC_FIELD_FORBIDDEN';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    cross join lateral (
      select step->>'client_step_id' client_step_id, count(*) row_count
      from jsonb_array_elements(coalesce(item->'payload'->'steps','[]'::jsonb)) step
      group by step->>'client_step_id'
    ) duplicated
    where coalesce(item->'payload'->>'kind','') in ('ABA_TRIAL','ABA_TASK_ANALYSIS')
      and (nullif(trim(duplicated.client_step_id),'') is null or duplicated.row_count > 1)
  ) then
    raise exception 'CMV3_SYNC_DUPLICATE_OR_MISSING_CLIENT_STEP_ID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    cross join lateral (
      select step->>'sequence_no' sequence_no, count(*) row_count
      from jsonb_array_elements(coalesce(item->'payload'->'steps','[]'::jsonb)) step
      group by step->>'sequence_no'
    ) duplicated
    where coalesce(item->'payload'->>'kind','') in ('ABA_TRIAL','ABA_TASK_ANALYSIS')
      and (nullif(trim(duplicated.sequence_no),'') is null or duplicated.row_count > 1)
  ) then
    raise exception 'CMV3_SYNC_DUPLICATE_OR_MISSING_STEP_SEQUENCE';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    join public.clinical_measurement_collection_streams_v3 stream
      on stream.id = (item->>'stream_id')::uuid
    join public.clinical_measurement_session_expectations_v3 expectation
      on expectation.id = stream.expectation_id
    join public.clinical_collection_protocol_snapshots_v3 snapshot
      on snapshot.id = expectation.protocol_snapshot_id
    join public.clinical_measurement_definition_versions_v3 version
      on version.id = snapshot.definition_version_id
    join public.clinical_measurement_definitions_v3 definition
      on definition.id = version.definition_id
    where coalesce(item->'payload'->>'kind','') = 'EXPLICIT_ABSENCE'
      and (
        (item->'payload'->>'absence_kind' = 'NO_ELIGIBLE_OPPORTUNITY'
          and definition.semantic_family not in ('PROPORTION','CATEGORICAL','TASK_ANALYSIS'))
        or
        (item->'payload'->>'absence_kind' = 'NO_VALID_OBSERVATION_WINDOW'
          and definition.semantic_family not in ('RATE','DURATION','LATENCY','IRT','INTERVAL'))
      )
  ) then
    raise exception 'CMV3_SYNC_ABSENCE_KIND_SEMANTIC_FAMILY_MISMATCH';
  end if;

  -- Compensation references are expressed with client ids. Same-batch FACTs are
  -- supported; nested same-batch compensation chains are deliberately rejected.
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where coalesce(item->>'event_kind','FACT') <> 'FACT'
      and nullif(trim(item->>'subject_client_event_id'),'') is null
  ) then
    raise exception 'CMV3_SYNC_COMPENSATION_SUBJECT_REQUIRED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) compensation
    join jsonb_array_elements(p_items) subject
      on subject->>'client_event_id' = compensation->>'subject_client_event_id'
    where coalesce(compensation->>'event_kind','FACT') <> 'FACT'
      and coalesce(subject->>'event_kind','FACT') <> 'FACT'
  ) then
    raise exception 'CMV3_SYNC_NESTED_COMPENSATION_REQUIRES_ACCEPTED_SUBJECT';
  end if;
end;
$function$;

create or replace function public.accept_clinical_measurement_raw_envelopes_bulk_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_actor_membership_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  -- First accept FACTs, so a correction/void in the same offline batch may refer
  -- to a FACT that had not reached the server before this transaction.
  insert into public.clinical_measurement_raw_events_v3(
    stream_id, client_event_id, event_kind, subject_event_id, replacement_event_id,
    ingestion_mode, occurred_at_utc, actor_membership_id, reason_code, payload_hash
  )
  select
    (item->>'stream_id')::uuid,
    item->>'client_event_id',
    'FACT',
    null,
    null,
    item->>'ingestion_mode',
    (item->>'occurred_at_utc')::timestamptz,
    p_actor_membership_id,
    null,
    encode(digest(convert_to(item::text,'UTF8'),'sha256'),'hex')
  from jsonb_array_elements(p_items) item
  where coalesce(item->>'event_kind','FACT') = 'FACT'
  on conflict (organization_id, client_event_id) do nothing;

  -- Any replay collision must have byte-equivalent semantic input.
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    join public.clinical_measurement_raw_events_v3 event
      on event.organization_id = p_organization_id
     and event.client_event_id = item->>'client_event_id'
    where event.payload_hash is distinct from encode(digest(convert_to(item::text,'UTF8'),'sha256'),'hex')
  ) then
    raise exception 'CMV3_SYNC_CLIENT_EVENT_ID_COLLISION';
  end if;

  -- Validate compensation refs after FACT insertion. This also allows an offline
  -- correction/void to point at a FACT contained in this same batch.
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    left join public.clinical_measurement_raw_events_v3 subject
      on subject.organization_id = p_organization_id
     and subject.patient_id = p_patient_id
     and subject.client_event_id = item->>'subject_client_event_id'
    where coalesce(item->>'event_kind','FACT') <> 'FACT'
      and subject.id is null
  ) then
    raise exception 'CMV3_SYNC_COMPENSATION_SUBJECT_NOT_ACCEPTED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    left join public.clinical_measurement_raw_events_v3 replacement
      on replacement.organization_id = p_organization_id
     and replacement.patient_id = p_patient_id
     and replacement.client_event_id = item->>'replacement_client_event_id'
    where coalesce(item->>'event_kind','FACT') = 'SUPERSEDE'
      and (nullif(trim(item->>'replacement_client_event_id'),'') is null or replacement.id is null)
  ) then
    raise exception 'CMV3_SYNC_SUPERSEDE_REPLACEMENT_NOT_ACCEPTED';
  end if;

  insert into public.clinical_measurement_raw_events_v3(
    stream_id, client_event_id, event_kind, subject_event_id, replacement_event_id,
    ingestion_mode, occurred_at_utc, actor_membership_id, reason_code, payload_hash
  )
  select
    (item->>'stream_id')::uuid,
    item->>'client_event_id',
    item->>'event_kind',
    subject.id,
    replacement.id,
    item->>'ingestion_mode',
    (item->>'occurred_at_utc')::timestamptz,
    p_actor_membership_id,
    nullif(trim(item->>'reason_code'),''),
    encode(digest(convert_to(item::text,'UTF8'),'sha256'),'hex')
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 subject
    on subject.organization_id = p_organization_id
   and subject.patient_id = p_patient_id
   and subject.client_event_id = item->>'subject_client_event_id'
  left join public.clinical_measurement_raw_events_v3 replacement
    on replacement.organization_id = p_organization_id
   and replacement.patient_id = p_patient_id
   and replacement.client_event_id = item->>'replacement_client_event_id'
  where coalesce(item->>'event_kind','FACT') <> 'FACT'
  on conflict (organization_id, client_event_id) do nothing;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    join public.clinical_measurement_raw_events_v3 event
      on event.organization_id = p_organization_id
     and event.client_event_id = item->>'client_event_id'
    where event.patient_id is distinct from p_patient_id
       or event.payload_hash is distinct from encode(digest(convert_to(item::text,'UTF8'),'sha256'),'hex')
  ) then
    raise exception 'CMV3_SYNC_CLIENT_EVENT_REPLAY_SCOPE_OR_HASH_MISMATCH';
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Universal raw primitive handler. One set-based INSERT per physical family.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_clinical_measurement_primitives_bulk_v3(
  p_organization_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  insert into public.clinical_measurement_observation_slices_v3(event_id, started_at, ended_at, close_reason)
  select event.id,
         (item->'payload'->>'started_at')::timestamptz,
         (item->'payload'->>'ended_at')::timestamptz,
         item->'payload'->>'close_reason'
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  where coalesce(item->'payload'->>'kind','') = 'OBSERVATION_SLICE'
  on conflict (event_id) do nothing;

  insert into public.clinical_measurement_count_facts_v3(event_id, count_delta)
  select event.id, (item->'payload'->>'count_delta')::integer
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  where coalesce(item->'payload'->>'kind','') = 'COUNT'
  on conflict (event_id) do nothing;

  insert into public.clinical_measurement_category_facts_v3(event_id, category_key)
  select event.id, item->'payload'->>'category_key'
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  where coalesce(item->'payload'->>'kind','') = 'CATEGORY'
  on conflict (event_id) do nothing;

  insert into public.clinical_measurement_scalar_facts_v3(event_id, numeric_value)
  select event.id, (item->'payload'->>'numeric_value')::numeric
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  where coalesce(item->'payload'->>'kind','') = 'SCALAR'
  on conflict (event_id) do nothing;

  insert into public.clinical_measurement_interval_facts_v3(
    event_id, started_at, ended_at, is_censored, censor_reason
  )
  select event.id,
         (item->'payload'->>'started_at')::timestamptz,
         (item->'payload'->>'ended_at')::timestamptz,
         coalesce((item->'payload'->>'is_censored')::boolean,false),
         nullif(trim(item->'payload'->>'censor_reason'),'')
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  where coalesce(item->'payload'->>'kind','') = 'TEMPORAL_INTERVAL'
  on conflict (event_id) do nothing;

  insert into public.clinical_measurement_interval_samples_v3(
    event_id, interval_index, started_at, ended_at, response_key
  )
  select event.id,
         (item->'payload'->>'interval_index')::integer,
         (item->'payload'->>'started_at')::timestamptz,
         (item->'payload'->>'ended_at')::timestamptz,
         item->'payload'->>'response_key'
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  where coalesce(item->'payload'->>'kind','') = 'INTERVAL_SAMPLE'
  on conflict (event_id) do nothing;

  insert into public.clinical_measurement_explicit_absence_facts_v3(
    event_id, absence_kind, reason_code
  )
  select event.id,
         item->'payload'->>'absence_kind',
         nullif(trim(item->'payload'->>'reason_code'),'')
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  where coalesce(item->'payload'->>'kind','') = 'EXPLICIT_ABSENCE'
  on conflict (event_id) do nothing;
end;
$function$;

-- ---------------------------------------------------------------------------
-- ABA trial handler. The client submits only mechanical step facts. The existing
-- ABA triggers derive opportunity_role and validate prompt hierarchy server-side.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_clinical_aba_trials_bulk_v3(
  p_organization_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    join public.clinical_measurement_raw_events_v3 event
      on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
    left join public.clinical_aba_trial_protocol_intents_v3 intent
      on intent.protocol_snapshot_id = event.protocol_snapshot_id
    where coalesce(item->'payload'->>'kind','') = 'ABA_TRIAL'
      and intent.protocol_snapshot_id is null
  ) then
    raise exception 'CMV3_SYNC_ABA_TRIAL_INTENT_REQUIRED';
  end if;

  insert into public.clinical_measurement_aba_trials_v3(
    event_id, organization_id, patient_id, session_id, expectation_id, target_id,
    stream_id, protocol_snapshot_id, definition_version_id,
    trial_type, started_at, completed_at, created_at
  )
  select event.id, event.organization_id, event.patient_id, event.session_id,
         event.expectation_id, event.target_id, event.stream_id,
         event.protocol_snapshot_id, event.definition_version_id,
         intent.trial_type,
         nullif(item->'payload'->>'started_at','')::timestamptz,
         nullif(item->'payload'->>'completed_at','')::timestamptz,
         event.recorded_at
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  join public.clinical_aba_trial_protocol_intents_v3 intent
    on intent.protocol_snapshot_id = event.protocol_snapshot_id
   and intent.organization_id = event.organization_id
   and intent.patient_id = event.patient_id
   and intent.target_id = event.target_id
   and intent.definition_version_id = event.definition_version_id
  where coalesce(item->'payload'->>'kind','') = 'ABA_TRIAL'
  on conflict (event_id) do nothing;

  insert into public.clinical_measurement_aba_trial_steps_v3(
    trial_event_id, sequence_no, client_step_id, step_kind, outcome,
    prompt_level_id, latency_ms, occurred_at
  )
  select event.id,
         (step->>'sequence_no')::integer,
         step->>'client_step_id',
         step->>'step_kind',
         nullif(step->>'outcome',''),
         nullif(step->>'prompt_level_id','')::uuid,
         nullif(step->>'latency_ms','')::integer,
         (step->>'occurred_at')::timestamptz
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  cross join lateral jsonb_array_elements(coalesce(item->'payload'->'steps','[]'::jsonb)) step
  where coalesce(item->'payload'->>'kind','') = 'ABA_TRIAL'
  on conflict (trial_event_id, client_step_id) do nothing;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Task Analysis handler. Chaining policy and eligibility are server-owned.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_clinical_aba_task_runs_bulk_v3(
  p_organization_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  insert into public.clinical_measurement_aba_task_runs_v3(
    event_id, organization_id, patient_id, session_id, expectation_id, target_id,
    stream_id, protocol_snapshot_id, definition_version_id,
    chaining_policy_version_id, started_at, completed_at, created_at
  )
  select event.id, event.organization_id, event.patient_id, event.session_id,
         event.expectation_id, event.target_id, event.stream_id,
         event.protocol_snapshot_id, event.definition_version_id,
         binding.chaining_policy_version_id,
         (item->'payload'->>'started_at')::timestamptz,
         (item->'payload'->>'completed_at')::timestamptz,
         event.recorded_at
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  join public.clinical_aba_protocol_bindings_v3 binding
    on binding.protocol_snapshot_id = event.protocol_snapshot_id
  where coalesce(item->'payload'->>'kind','') = 'ABA_TASK_ANALYSIS'
  on conflict (event_id) do nothing;

  insert into public.clinical_measurement_aba_task_step_results_v3(
    run_event_id, step_definition_id, sequence_no, client_step_id,
    performance_code, prompt_level_id, occurred_at
  )
  select event.id,
         (step->>'step_definition_id')::uuid,
         (step->>'sequence_no')::integer,
         step->>'client_step_id',
         step->>'performance_code',
         nullif(step->>'prompt_level_id','')::uuid,
         (step->>'occurred_at')::timestamptz
  from jsonb_array_elements(p_items) item
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id and event.client_event_id = item->>'client_event_id'
  cross join lateral jsonb_array_elements(coalesce(item->'payload'->'steps','[]'::jsonb)) step
  where coalesce(item->'payload'->>'kind','') = 'ABA_TASK_ANALYSIS'
  on conflict (run_event_id, client_step_id) do nothing;

  if exists (
    select 1
    from public.clinical_measurement_aba_task_runs_v3 run
    join public.clinical_measurement_raw_events_v3 event on event.id = run.event_id
    where event.organization_id = p_organization_id
      and event.client_event_id in (
        select item->>'client_event_id'
        from jsonb_array_elements(p_items) item
        where coalesce(item->'payload'->>'kind','') = 'ABA_TASK_ANALYSIS'
      )
      and (
        (select count(*) from public.clinical_measurement_aba_task_step_results_v3 result where result.run_event_id = run.event_id)
        <>
        (select count(*) from public.clinical_aba_chaining_step_rules_v3 rule where rule.policy_version_id = run.chaining_policy_version_id)
      )
  ) then
    raise exception 'CMV3_SYNC_TASK_ANALYSIS_STEP_SET_INCOMPLETE';
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Single transactional entrypoint. One call = one atomic batch. All payload
-- handlers are invoked once per batch and operate set-wise.
-- ---------------------------------------------------------------------------
create or replace function public.sync_clinical_measurements_bulk_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_actor_membership_id uuid,
  p_client_batch_id text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_batch public.clinical_measurement_sync_batches_v3%rowtype;
  v_payload_hash text;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if p_organization_id is null or p_patient_id is null or p_actor_membership_id is null then
    raise exception 'CMV3_SYNC_SCOPE_REQUIRED';
  end if;
  if nullif(trim(p_client_batch_id),'') is null or length(trim(p_client_batch_id)) > 180 then
    raise exception 'CMV3_SYNC_BATCH_ID_INVALID';
  end if;

  perform public.validate_clinical_measurement_sync_batch_v3(
    p_organization_id, p_patient_id, p_actor_membership_id, p_items
  );

  v_payload_hash := encode(digest(convert_to(p_items::text,'UTF8'),'sha256'),'hex');

  -- Serialize only the same logical client batch, not the whole clinic.
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || trim(p_client_batch_id), 0)
  );

  select * into v_batch
  from public.clinical_measurement_sync_batches_v3 batch
  where batch.organization_id = p_organization_id
    and batch.client_batch_id = trim(p_client_batch_id);

  if found then
    if v_batch.patient_id is distinct from p_patient_id
       or v_batch.actor_membership_id is distinct from p_actor_membership_id
       or v_batch.payload_hash is distinct from v_payload_hash
       or v_batch.item_count is distinct from jsonb_array_length(p_items) then
      raise exception 'CMV3_SYNC_BATCH_ID_COLLISION';
    end if;

    select jsonb_build_object(
      'batch_id', v_batch.id,
      'client_batch_id', v_batch.client_batch_id,
      'status', 'IDEMPOTENT_REPLAY',
      'accepted_count', count(*),
      'events', coalesce(jsonb_agg(jsonb_build_object(
        'ordinal', link.ordinal,
        'client_event_id', link.client_event_id,
        'event_id', link.event_id
      ) order by link.ordinal), '[]'::jsonb)
    ) into v_result
    from public.clinical_measurement_sync_batch_events_v3 link
    where link.batch_id = v_batch.id;

    return v_result;
  end if;

  perform public.accept_clinical_measurement_raw_envelopes_bulk_v3(
    p_organization_id, p_patient_id, p_actor_membership_id, p_items
  );

  perform public.ingest_clinical_measurement_primitives_bulk_v3(p_organization_id, p_items);
  perform public.ingest_clinical_aba_trials_bulk_v3(p_organization_id, p_items);
  perform public.ingest_clinical_aba_task_runs_bulk_v3(p_organization_id, p_items);

  -- Force the deferred one-event/one-payload invariant before recording batch success.
  set constraints ensure_clinical_measurement_raw_payload_v3 immediate;
  set constraints ensure_clinical_measurement_raw_payload_v3 deferred;

  insert into public.clinical_measurement_sync_batches_v3(
    organization_id, patient_id, actor_membership_id, client_batch_id,
    payload_hash, item_count, received_at, created_at
  ) values (
    p_organization_id, p_patient_id, p_actor_membership_id, trim(p_client_batch_id),
    v_payload_hash, jsonb_array_length(p_items), v_now, v_now
  )
  returning * into v_batch;

  insert into public.clinical_measurement_sync_batch_events_v3(
    batch_id, ordinal, organization_id, patient_id, event_id, client_event_id, created_at
  )
  select v_batch.id,
         ordinality::integer,
         p_organization_id,
         p_patient_id,
         event.id,
         item->>'client_event_id',
         v_now
  from jsonb_array_elements(p_items) with ordinality input(item, ordinality)
  join public.clinical_measurement_raw_events_v3 event
    on event.organization_id = p_organization_id
   and event.patient_id = p_patient_id
   and event.client_event_id = item->>'client_event_id';

  select jsonb_build_object(
    'batch_id', v_batch.id,
    'client_batch_id', v_batch.client_batch_id,
    'status', 'ACCEPTED',
    'accepted_count', count(*),
    'events', coalesce(jsonb_agg(jsonb_build_object(
      'ordinal', link.ordinal,
      'client_event_id', link.client_event_id,
      'event_id', link.event_id
    ) order by link.ordinal), '[]'::jsonb)
  ) into v_result
  from public.clinical_measurement_sync_batch_events_v3 link
  where link.batch_id = v_batch.id;

  return v_result;
end;
$function$;

drop trigger if exists prepare_cabav3_trial_protocol_intent on public.clinical_aba_trial_protocol_intents_v3;
create trigger prepare_cabav3_trial_protocol_intent
before insert on public.clinical_aba_trial_protocol_intents_v3
for each row execute function public.prepare_clinical_aba_trial_protocol_intent_v3();

drop trigger if exists guard_cabav3_trial_protocol_intent_immutable on public.clinical_aba_trial_protocol_intents_v3;
create trigger guard_cabav3_trial_protocol_intent_immutable
before update or delete on public.clinical_aba_trial_protocol_intents_v3
for each row execute function public.guard_clinical_aba_trial_protocol_intent_v3();

-- Sync provenance is immutable.
drop trigger if exists guard_cmv3_sync_batches_immutable on public.clinical_measurement_sync_batches_v3;
create trigger guard_cmv3_sync_batches_immutable
before update or delete on public.clinical_measurement_sync_batches_v3
for each row execute function public.guard_clinical_measurement_sync_provenance_v3();

drop trigger if exists guard_cmv3_sync_batch_events_immutable on public.clinical_measurement_sync_batch_events_v3;
create trigger guard_cmv3_sync_batch_events_immutable
before update or delete on public.clinical_measurement_sync_batch_events_v3
for each row execute function public.guard_clinical_measurement_sync_provenance_v3();

-- Dark RLS: no direct browser table access. Writes occur only through server RPC.
do $cmv3_sync_security$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinical_measurement_sync_batches_v3',
    'clinical_measurement_sync_batch_events_v3',
    'clinical_aba_trial_protocol_intents_v3'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
  end loop;
end;
$cmv3_sync_security$;

revoke all on function public.guard_clinical_measurement_sync_provenance_v3() from public, anon, authenticated;
revoke all on function public.prepare_clinical_aba_trial_protocol_intent_v3() from public, anon, authenticated;
revoke all on function public.guard_clinical_aba_trial_protocol_intent_v3() from public, anon, authenticated;
revoke all on function public.validate_clinical_measurement_sync_batch_v3(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.accept_clinical_measurement_raw_envelopes_bulk_v3(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ingest_clinical_measurement_primitives_bulk_v3(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ingest_clinical_aba_trials_bulk_v3(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.ingest_clinical_aba_task_runs_bulk_v3(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.sync_clinical_measurements_bulk_v3(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.sync_clinical_measurements_bulk_v3(uuid, uuid, uuid, text, jsonb) to service_role;


-- ===========================================================================
-- Embedded canonical block 08/12: 20260820203000_clinical_measurement_v3_projection_read_models.sql
-- ===========================================================================
-- Verto Clinical Measurement Engine V3 - Projection Engine + family read models.
-- Additive/dark only. Raw accepted facts remain authority; all tables below are
-- rebuildable projections or operational queue state. No browser reads/writes.


create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Current-truth raw view. FACT/CORRECTION payloads are effective only while no
-- later direct compensation points to them. Historical/as-recorded reconstruction
-- continues to use the immutable raw tables, never this convenience view alone.
-- ---------------------------------------------------------------------------
create or replace view public.clinical_measurement_effective_raw_events_v3
with (security_barrier = true)
as
select event.*
from public.clinical_measurement_raw_events_v3 event
where event.event_kind in ('FACT','CORRECTION')
  and not exists (
    select 1
    from public.clinical_measurement_raw_events_v3 compensation
    where compensation.subject_event_id = event.id
  );

create or replace view public.clinical_measurement_projection_scope_v3
with (security_barrier = true)
as
select
  expectation.id as expectation_id,
  expectation.organization_id,
  expectation.patient_id,
  expectation.session_id,
  expectation.target_id,
  expectation.protocol_snapshot_id,
  snapshot.definition_version_id,
  snapshot.phase_epoch_id,
  snapshot.phase_version_id,
  definition.semantic_family,
  version.unit_code,
  version.unit_label,
  version.directionality,
  version.content as definition_content,
  version.aggregation_policy,
  session_row.status as session_status,
  session_row.clinical_date,
  session_row.started_at as session_started_at,
  session_row.ended_at as session_ended_at,
  session_row.finalized_at,
  primary_stream.id as primary_stream_id
from public.clinical_measurement_session_expectations_v3 expectation
join public.clinical_measurement_sessions_v3 session_row
  on session_row.id = expectation.session_id
 and session_row.organization_id = expectation.organization_id
 and session_row.patient_id = expectation.patient_id
join public.clinical_collection_protocol_snapshots_v3 snapshot
  on snapshot.id = expectation.protocol_snapshot_id
 and snapshot.organization_id = expectation.organization_id
 and snapshot.patient_id = expectation.patient_id
 and snapshot.target_id = expectation.target_id
join public.clinical_measurement_definition_versions_v3 version
  on version.id = snapshot.definition_version_id
 and version.organization_id = expectation.organization_id
 and version.patient_id = expectation.patient_id
 and version.target_id = expectation.target_id
join public.clinical_measurement_definitions_v3 definition
  on definition.id = version.definition_id
 and definition.organization_id = expectation.organization_id
 and definition.patient_id = expectation.patient_id
 and definition.target_id = expectation.target_id
left join public.clinical_measurement_collection_streams_v3 primary_stream
  on primary_stream.expectation_id = expectation.id
 and primary_stream.stream_role = 'PRIMARY';

create or replace view public.clinical_measurement_effective_primary_events_v3
with (security_barrier = true)
as
select event.*
from public.clinical_measurement_effective_raw_events_v3 event
join public.clinical_measurement_collection_streams_v3 stream
  on stream.id = event.stream_id
 and stream.stream_role = 'PRIMARY';

-- ---------------------------------------------------------------------------
-- Dirty-expectation queue. generation prevents lost updates. This is operational
-- mutable state, not clinical history.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_projection_queue_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  semantic_family text not null,
  generation bigint not null default 1 check (generation > 0),
  processed_generation bigint not null default 0 check (processed_generation >= 0),
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','DONE','FAILED')),
  latest_source_event_id uuid,
  latest_source_recorded_at timestamptz,
  latest_event_kind text,
  latest_ingestion_mode text,
  enqueued_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(
      id, organization_id, patient_id, session_id, target_id
    ) on delete cascade
);

create index if not exists idx_cmv3_projection_queue_pending
  on public.clinical_measurement_projection_queue_v3(status, enqueued_at, expectation_id)
  where status in ('PENDING','FAILED');

-- ---------------------------------------------------------------------------
-- Typed session read models. One expectation = one semantic definition snapshot
-- in one session. No cross-phase or cross-definition aggregation occurs here.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_session_count_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  total_count bigint not null default 0 check (total_count >= 0),
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

create table if not exists public.clinical_measurement_session_rate_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  event_count bigint not null default 0 check (event_count >= 0),
  observation_duration_ms bigint not null default 0 check (observation_duration_ms >= 0),
  rate_per_hour numeric,
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  constraint cmv3_rate_requires_window check (rate_per_hour is null or observation_duration_ms > 0),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

create table if not exists public.clinical_measurement_session_proportion_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  projection_status text not null default 'READY'
    check (projection_status in ('READY','SEMANTIC_CONFIG_REQUIRED','INVALID_MIXED_SOURCE')),
  source_kind text not null check (source_kind in ('ABA_TRIAL','CATEGORY','MIXED','NONE')),
  numerator integer,
  denominator integer,
  percent_value numeric(9,4),
  no_eligible_opportunity_count integer not null default 0 check (no_eligible_opportunity_count >= 0),
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  constraint cmv3_proportion_shape check (
    (numerator is null and denominator is null and percent_value is null)
    or (numerator >= 0 and denominator >= 0 and numerator <= denominator
        and ((denominator = 0 and percent_value is null)
          or (denominator > 0 and percent_value between 0 and 100)))
  ),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

create table if not exists public.clinical_measurement_session_temporal_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  semantic_family text not null check (semantic_family in ('DURATION','LATENCY','IRT')),
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  occurrence_count integer not null default 0 check (occurrence_count >= 0),
  censored_count integer not null default 0 check (censored_count >= 0),
  total_duration_ms bigint not null default 0 check (total_duration_ms >= 0),
  mean_duration_ms numeric,
  min_duration_ms bigint,
  max_duration_ms bigint,
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

create table if not exists public.clinical_measurement_session_continuous_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  observation_count integer not null default 0 check (observation_count >= 0),
  mean_value numeric,
  min_value numeric,
  max_value numeric,
  latest_value numeric,
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

create table if not exists public.clinical_measurement_session_interval_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  interval_count integer not null default 0 check (interval_count >= 0),
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

create table if not exists public.clinical_measurement_session_ordinal_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  observation_count integer not null default 0 check (observation_count >= 0),
  latest_category_key text,
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

create table if not exists public.clinical_measurement_session_categorical_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  observation_count integer not null default 0 check (observation_count >= 0),
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

create table if not exists public.clinical_measurement_session_task_analysis_summaries_v3 (
  expectation_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  clinical_date date not null,
  session_status text not null,
  coverage_status text not null,
  run_count integer not null default 0 check (run_count >= 0),
  acquisition_eligible_count integer not null default 0 check (acquisition_eligible_count >= 0),
  acquisition_independent_count integer not null default 0 check (acquisition_independent_count >= 0),
  maintenance_eligible_count integer not null default 0 check (maintenance_eligible_count >= 0),
  maintenance_independent_count integer not null default 0 check (maintenance_independent_count >= 0),
  trainer_completed_count integer not null default 0 check (trainer_completed_count >= 0),
  not_eligible_count integer not null default 0 check (not_eligible_count >= 0),
  acquisition_independence_percent numeric(9,4),
  maintenance_independence_percent numeric(9,4),
  source_effective_event_count integer not null default 0 check (source_effective_event_count >= 0),
  source_latest_occurred_at timestamptz,
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null default now(),
  foreign key (expectation_id, organization_id, patient_id, session_id, target_id)
    references public.clinical_measurement_session_expectations_v3(id, organization_id, patient_id, session_id, target_id)
    on delete cascade
);

-- Narrow relational breakdowns; no analytical JSONB in the hot read path.
create table if not exists public.clinical_measurement_session_category_breakdown_v3 (
  expectation_id uuid not null references public.clinical_measurement_session_expectations_v3(id) on delete cascade,
  category_domain text not null check (category_domain in ('PROPORTION','ORDINAL','CATEGORICAL')),
  category_key text not null,
  occurrence_count integer not null check (occurrence_count >= 0),
  primary key (expectation_id, category_domain, category_key)
);

create table if not exists public.clinical_measurement_session_interval_breakdown_v3 (
  expectation_id uuid not null references public.clinical_measurement_session_expectations_v3(id) on delete cascade,
  response_key text not null,
  occurrence_count integer not null check (occurrence_count >= 0),
  primary key (expectation_id, response_key)
);

create table if not exists public.clinical_measurement_session_prompt_distribution_v3 (
  expectation_id uuid not null references public.clinical_measurement_session_expectations_v3(id) on delete cascade,
  source_kind text not null check (source_kind in ('ABA_TRIAL','TASK_ANALYSIS')),
  prompt_level_id uuid not null references public.clinical_aba_prompt_hierarchy_levels_v3(id) on delete restrict,
  occurrence_count integer not null check (occurrence_count >= 0),
  primary key (expectation_id, source_kind, prompt_level_id)
);

create table if not exists public.clinical_measurement_session_task_step_summaries_v3 (
  expectation_id uuid not null references public.clinical_measurement_session_expectations_v3(id) on delete cascade,
  step_definition_id uuid not null references public.clinical_aba_task_step_definitions_v3(id) on delete restrict,
  sequence_no integer not null,
  acquisition_observation_count integer not null default 0,
  acquisition_independent_count integer not null default 0,
  maintenance_observation_count integer not null default 0,
  maintenance_independent_count integer not null default 0,
  prompted_count integer not null default 0,
  incorrect_count integer not null default 0,
  no_response_count integer not null default 0,
  primary key (expectation_id, step_definition_id)
);

-- Hot read indexes: target timeline first, no full-patient/full-table load required.
create index if not exists idx_cmv3_count_summary_target_time on public.clinical_measurement_session_count_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);
create index if not exists idx_cmv3_rate_summary_target_time on public.clinical_measurement_session_rate_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);
create index if not exists idx_cmv3_proportion_summary_target_time on public.clinical_measurement_session_proportion_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);
create index if not exists idx_cmv3_temporal_summary_target_time on public.clinical_measurement_session_temporal_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);
create index if not exists idx_cmv3_continuous_summary_target_time on public.clinical_measurement_session_continuous_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);
create index if not exists idx_cmv3_interval_summary_target_time on public.clinical_measurement_session_interval_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);
create index if not exists idx_cmv3_ordinal_summary_target_time on public.clinical_measurement_session_ordinal_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);
create index if not exists idx_cmv3_categorical_summary_target_time on public.clinical_measurement_session_categorical_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);
create index if not exists idx_cmv3_task_summary_target_time on public.clinical_measurement_session_task_analysis_summaries_v3(organization_id,patient_id,target_id,clinical_date,session_id);

-- ---------------------------------------------------------------------------
-- Projection revision ledger. Current hot tables remain typed; compact JSON is
-- stored only on this cold audit path so late sync/corrections remain explainable.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_measurement_session_projection_heads_v3 (
  expectation_id uuid primary key references public.clinical_measurement_session_expectations_v3(id) on delete cascade,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  semantic_family text not null,
  revision_number integer not null check (revision_number > 0),
  projection_hash text not null check (projection_hash ~ '^[0-9a-f]{64}$'),
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.clinical_measurement_session_projection_revisions_v3 (
  id uuid primary key default gen_random_uuid(),
  expectation_id uuid not null references public.clinical_measurement_session_expectations_v3(id) on delete restrict,
  organization_id uuid not null,
  patient_id uuid not null,
  session_id uuid not null,
  target_id uuid not null,
  semantic_family text not null,
  revision_number integer not null check (revision_number > 0),
  revision_reason text not null check (revision_reason in (
    'INITIAL','SESSION_FINALIZED','LATE_DATA_INCORPORATED','AUDIT_CORRECTION','SOURCE_DATA_CHANGED','MANUAL_REBUILD'
  )),
  projection_hash text not null check (projection_hash ~ '^[0-9a-f]{64}$'),
  projection_payload jsonb not null check (jsonb_typeof(projection_payload)='object'),
  source_latest_recorded_at timestamptz,
  computed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (expectation_id, revision_number)
);

-- ---------------------------------------------------------------------------
-- Common helpers.
-- ---------------------------------------------------------------------------
create or replace function public.cmv3_projection_coverage_status(
  p_expectation_id uuid,
  p_session_status text
)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select case
    when exists (
      select 1 from public.clinical_measurement_effective_primary_events_v3 e
      where e.expectation_id = p_expectation_id
        and exists (
          select 1 from public.clinical_measurement_raw_event_payload_claims_v3 c where c.event_id=e.id
          union all
          select 1 from public.clinical_aba_raw_payload_claims_v3 c where c.event_id=e.id
        )
        and not exists (
          select 1 from public.clinical_measurement_explicit_absence_facts_v3 a where a.event_id=e.id
        )
    ) then 'OBSERVED'
    when exists (
      select 1
      from public.clinical_measurement_effective_primary_events_v3 e
      join public.clinical_measurement_explicit_absence_facts_v3 a on a.event_id=e.id
      where e.expectation_id = p_expectation_id
    ) then 'EXPLICIT_ABSENCE'
    when p_session_status = 'FINALIZED' then 'EXPECTED_NOT_COLLECTED'
    else 'PENDING'
  end;
$function$;

create or replace function public.build_clinical_measurement_projection_snapshot_v3(p_expectation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'expectation_id', scope.expectation_id,
    'semantic_family', scope.semantic_family,
    'session_status', scope.session_status,
    'clinical_date', scope.clinical_date,
    'summary', case scope.semantic_family
      when 'COUNT' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_count_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'RATE' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_rate_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'PROPORTION' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_proportion_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'DURATION' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_temporal_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'LATENCY' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_temporal_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'IRT' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_temporal_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'CONTINUOUS' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_continuous_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'INTERVAL' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_interval_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'ORDINAL' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_ordinal_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'CATEGORICAL' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_categorical_summaries_v3 s where s.expectation_id=scope.expectation_id)
      when 'TASK_ANALYSIS' then (select to_jsonb(s)-'organization_id'-'patient_id'-'computed_at' from public.clinical_measurement_session_task_analysis_summaries_v3 s where s.expectation_id=scope.expectation_id)
    end,
    'category_breakdown', (
      select coalesce(jsonb_agg(jsonb_build_object('domain',b.category_domain,'key',b.category_key,'count',b.occurrence_count)
        order by b.category_domain,b.category_key),'[]'::jsonb)
      from public.clinical_measurement_session_category_breakdown_v3 b where b.expectation_id=scope.expectation_id
    ),
    'interval_breakdown', (
      select coalesce(jsonb_agg(jsonb_build_object('key',b.response_key,'count',b.occurrence_count) order by b.response_key),'[]'::jsonb)
      from public.clinical_measurement_session_interval_breakdown_v3 b where b.expectation_id=scope.expectation_id
    ),
    'prompt_distribution', (
      select coalesce(jsonb_agg(jsonb_build_object('source_kind',b.source_kind,'prompt_level_id',b.prompt_level_id,'count',b.occurrence_count)
        order by b.source_kind,b.prompt_level_id),'[]'::jsonb)
      from public.clinical_measurement_session_prompt_distribution_v3 b where b.expectation_id=scope.expectation_id
    ),
    'task_steps', (
      select coalesce(jsonb_agg(to_jsonb(b)-'expectation_id' order by b.sequence_no,b.step_definition_id),'[]'::jsonb)
      from public.clinical_measurement_session_task_step_summaries_v3 b where b.expectation_id=scope.expectation_id
    )
  ))
  from public.clinical_measurement_projection_scope_v3 scope
  where scope.expectation_id=p_expectation_id;
$function$;

-- ---------------------------------------------------------------------------
-- Set-based recomputation for a bounded expectation batch. No per-expectation
-- INSERT loop and no network N+1 are required.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_clinical_measurement_projection_batch_v3(
  p_expectation_ids uuid[],
  p_revision_hint text default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_count integer := 0;
begin
  if coalesce(array_length(p_expectation_ids,1),0) = 0 then return 0; end if;
  if array_length(p_expectation_ids,1) > 250 then raise exception 'CMV3_PROJECTION_BATCH_TOO_LARGE'; end if;

  -- Projection cache is disposable. Clear only the affected expectation grains.
  delete from public.clinical_measurement_session_category_breakdown_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_interval_breakdown_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_prompt_distribution_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_task_step_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_count_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_rate_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_proportion_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_temporal_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_continuous_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_interval_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_ordinal_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_categorical_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_task_analysis_summaries_v3 where expectation_id=any(p_expectation_ids);

  -- COUNT.
  insert into public.clinical_measurement_session_count_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         coalesce(sum(f.count_delta),0)::bigint,
         count(distinct e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_count_facts_v3 f on f.event_id=e.id and f.semantic_family='COUNT'
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='COUNT'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  -- RATE: zero events + valid slice is a legitimate zero rate.
  insert into public.clinical_measurement_session_rate_summaries_v3
  with agg as (
    select scope.*,
      coalesce((select sum(f.count_delta)::bigint from public.clinical_measurement_effective_primary_events_v3 e
                join public.clinical_measurement_count_facts_v3 f on f.event_id=e.id and f.semantic_family='RATE'
                where e.expectation_id=scope.expectation_id),0) event_count,
      coalesce((select sum(floor(extract(epoch from (s.ended_at-s.started_at))*1000.0))::bigint
                from public.clinical_measurement_effective_primary_events_v3 e
                join public.clinical_measurement_observation_slices_v3 s on s.event_id=e.id
                where e.expectation_id=scope.expectation_id),0) observation_ms,
      (select count(*)::integer from public.clinical_measurement_effective_primary_events_v3 e where e.expectation_id=scope.expectation_id) src_count,
      (select max(e.occurred_at_utc) from public.clinical_measurement_effective_primary_events_v3 e where e.expectation_id=scope.expectation_id) src_occ,
      (select max(e.recorded_at) from public.clinical_measurement_effective_primary_events_v3 e where e.expectation_id=scope.expectation_id) src_rec
    from public.clinical_measurement_projection_scope_v3 scope
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='RATE'
  )
  select expectation_id,organization_id,patient_id,session_id,target_id,definition_version_id,phase_epoch_id,
         clinical_date,session_status,public.cmv3_projection_coverage_status(expectation_id,session_status),
         event_count,observation_ms,
         case when observation_ms>0 then (event_count::numeric*3600000::numeric)/observation_ms::numeric else null end,
         src_count,src_occ,src_rec,clock_timestamp()
  from agg;

  -- PROPORTION: ABA trials have fixed server semantics. Generic category-based
  -- proportions are computed only when the version explicitly declares both
  -- numerator_category_keys and denominator_category_keys.
  insert into public.clinical_measurement_session_proportion_summaries_v3
  with aba as (
    select scope.expectation_id,
      count(distinct trial.event_id) filter (where step.opportunity_role='PRIMARY_INDEPENDENT')::integer denominator,
      count(distinct trial.event_id) filter (where step.opportunity_role='PRIMARY_INDEPENDENT' and step.outcome='CORRECT')::integer numerator,
      (count(distinct trial.event_id)
       - count(distinct trial.event_id) filter (where step.opportunity_role='PRIMARY_INDEPENDENT'))::integer no_opp,
      count(distinct trial.event_id)::integer trial_count
    from public.clinical_measurement_projection_scope_v3 scope
    join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
    join public.clinical_measurement_aba_trials_v3 trial on trial.event_id=e.id
    left join public.clinical_measurement_aba_trial_steps_v3 step on step.trial_event_id=trial.event_id
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='PROPORTION'
    group by scope.expectation_id
  ), categories as (
    select scope.expectation_id,
      count(*) filter (where f.category_key in (
        select jsonb_array_elements_text(scope.definition_content #> '{proportion,numerator_category_keys}')
      ))::integer numerator,
      count(*) filter (where f.category_key in (
        select jsonb_array_elements_text(scope.definition_content #> '{proportion,denominator_category_keys}')
      ))::integer denominator,
      count(*)::integer category_count,
      (jsonb_typeof(scope.definition_content #> '{proportion,numerator_category_keys}')='array'
       and jsonb_typeof(scope.definition_content #> '{proportion,denominator_category_keys}')='array'
       and (scope.definition_content #> '{proportion,denominator_category_keys}') @> (scope.definition_content #> '{proportion,numerator_category_keys}')) config_ready
    from public.clinical_measurement_projection_scope_v3 scope
    join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
    join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='PROPORTION'
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='PROPORTION'
    group by scope.expectation_id,scope.definition_content
  ), source_meta as (
    select scope.expectation_id,count(e.id)::integer src_count,max(e.occurred_at_utc) src_occ,max(e.recorded_at) src_rec
    from public.clinical_measurement_projection_scope_v3 scope
    left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='PROPORTION'
    group by scope.expectation_id
  )
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then 'INVALID_MIXED_SOURCE'
           when coalesce(aba.trial_count,0)>0 or coalesce(categories.config_ready,false) then 'READY'
           else 'SEMANTIC_CONFIG_REQUIRED' end,
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then 'MIXED'
           when coalesce(aba.trial_count,0)>0 then 'ABA_TRIAL'
           when coalesce(categories.category_count,0)>0 then 'CATEGORY' else 'NONE' end,
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then null
           when coalesce(aba.trial_count,0)>0 then aba.numerator
           when coalesce(categories.config_ready,false) then categories.numerator else null end,
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then null
           when coalesce(aba.trial_count,0)>0 then aba.denominator
           when coalesce(categories.config_ready,false) then categories.denominator else null end,
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then null
           when coalesce(aba.trial_count,0)>0 and aba.denominator>0 then (aba.numerator::numeric*100)/aba.denominator
           when coalesce(aba.trial_count,0)=0 and coalesce(categories.config_ready,false) and categories.denominator>0 then (categories.numerator::numeric*100)/categories.denominator
           else null end,
         coalesce(aba.no_opp,0),meta.src_count,meta.src_occ,meta.src_rec,clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join aba on aba.expectation_id=scope.expectation_id
  left join categories on categories.expectation_id=scope.expectation_id
  join source_meta meta on meta.expectation_id=scope.expectation_id
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='PROPORTION';

  insert into public.clinical_measurement_session_category_breakdown_v3(expectation_id,category_domain,category_key,occurrence_count)
  select e.expectation_id,'PROPORTION',f.category_key,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='PROPORTION'
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,f.category_key;

  insert into public.clinical_measurement_session_prompt_distribution_v3(expectation_id,source_kind,prompt_level_id,occurrence_count)
  select e.expectation_id,'ABA_TRIAL',step.prompt_level_id,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_aba_trials_v3 trial on trial.event_id=e.id
  join public.clinical_measurement_aba_trial_steps_v3 step on step.trial_event_id=trial.event_id
  where e.expectation_id=any(p_expectation_ids) and step.prompt_level_id is not null
  group by e.expectation_id,step.prompt_level_id;

  -- DURATION / LATENCY / IRT remain temporal, never coerced to score.
  insert into public.clinical_measurement_session_temporal_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.semantic_family,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,count(f.event_id) filter(where f.is_censored)::integer,
         coalesce(sum(f.duration_ms),0)::bigint,avg(f.duration_ms)::numeric,min(f.duration_ms),max(f.duration_ms),
         count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_interval_facts_v3 f on f.event_id=e.id
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family in ('DURATION','LATENCY','IRT')
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.semantic_family,scope.clinical_date,scope.session_status;

  -- CONTINUOUS.
  insert into public.clinical_measurement_session_continuous_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,avg(f.numeric_value),min(f.numeric_value),max(f.numeric_value),
         (array_agg(f.numeric_value order by e.occurred_at_utc desc,e.id desc) filter(where f.event_id is not null))[1],
         count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_scalar_facts_v3 f on f.event_id=e.id
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='CONTINUOUS'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  -- INTERVAL + relational response breakdown.
  insert into public.clinical_measurement_session_interval_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_interval_samples_v3 f on f.event_id=e.id
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='INTERVAL'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  insert into public.clinical_measurement_session_interval_breakdown_v3(expectation_id,response_key,occurrence_count)
  select e.expectation_id,f.response_key,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_interval_samples_v3 f on f.event_id=e.id
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,f.response_key;

  -- ORDINAL: order is preserved as category identity; no mean/percent is invented.
  insert into public.clinical_measurement_session_ordinal_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,
         (array_agg(f.category_key order by e.occurred_at_utc desc,e.id desc) filter(where f.event_id is not null))[1],
         count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='ORDINAL'
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='ORDINAL'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  insert into public.clinical_measurement_session_category_breakdown_v3(expectation_id,category_domain,category_key,occurrence_count)
  select e.expectation_id,'ORDINAL',f.category_key,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='ORDINAL'
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,f.category_key;

  -- CATEGORICAL.
  insert into public.clinical_measurement_session_categorical_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='CATEGORICAL'
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='CATEGORICAL'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  insert into public.clinical_measurement_session_category_breakdown_v3(expectation_id,category_domain,category_key,occurrence_count)
  select e.expectation_id,'CATEGORICAL',f.category_key,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='CATEGORICAL'
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,f.category_key;

  -- TASK ANALYSIS: acquisition and maintenance denominators remain separate.
  insert into public.clinical_measurement_session_task_analysis_summaries_v3
  with agg as (
    select scope.*,
      count(distinct run.event_id)::integer run_count,
      count(result.id) filter(where result.eligibility='ACQUISITION')::integer acq_n,
      count(result.id) filter(where result.eligibility='ACQUISITION' and result.performance_code='INDEPENDENT')::integer acq_i,
      count(result.id) filter(where result.eligibility='MAINTENANCE')::integer maint_n,
      count(result.id) filter(where result.eligibility='MAINTENANCE' and result.performance_code='INDEPENDENT')::integer maint_i,
      count(result.id) filter(where result.eligibility='TRAINER_COMPLETED')::integer trainer_n,
      count(result.id) filter(where result.eligibility='NOT_ELIGIBLE')::integer not_eligible_n,
      count(distinct e.id)::integer src_count,max(e.occurred_at_utc) src_occ,max(e.recorded_at) src_rec
    from public.clinical_measurement_projection_scope_v3 scope
    left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
    left join public.clinical_measurement_aba_task_runs_v3 run on run.event_id=e.id
    left join public.clinical_measurement_aba_task_step_results_v3 result on result.run_event_id=run.event_id
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='TASK_ANALYSIS'
    group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
             scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
             scope.protocol_snapshot_id,scope.semantic_family,scope.unit_code,scope.unit_label,scope.directionality,
             scope.definition_content,scope.aggregation_policy,scope.session_started_at,scope.session_ended_at,
             scope.finalized_at,scope.primary_stream_id
  )
  select expectation_id,organization_id,patient_id,session_id,target_id,definition_version_id,phase_epoch_id,
         clinical_date,session_status,public.cmv3_projection_coverage_status(expectation_id,session_status),
         run_count,acq_n,acq_i,maint_n,maint_i,trainer_n,not_eligible_n,
         case when acq_n>0 then acq_i::numeric*100/acq_n else null end,
         case when maint_n>0 then maint_i::numeric*100/maint_n else null end,
         src_count,src_occ,src_rec,clock_timestamp()
  from agg;

  insert into public.clinical_measurement_session_task_step_summaries_v3(
    expectation_id,step_definition_id,sequence_no,acquisition_observation_count,acquisition_independent_count,
    maintenance_observation_count,maintenance_independent_count,prompted_count,incorrect_count,no_response_count
  )
  select e.expectation_id,result.step_definition_id,result.sequence_no,
         count(*) filter(where result.eligibility='ACQUISITION')::integer,
         count(*) filter(where result.eligibility='ACQUISITION' and result.performance_code='INDEPENDENT')::integer,
         count(*) filter(where result.eligibility='MAINTENANCE')::integer,
         count(*) filter(where result.eligibility='MAINTENANCE' and result.performance_code='INDEPENDENT')::integer,
         count(*) filter(where result.performance_code='PROMPTED')::integer,
         count(*) filter(where result.performance_code='INCORRECT')::integer,
         count(*) filter(where result.performance_code='NO_RESPONSE')::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_aba_task_runs_v3 run on run.event_id=e.id
  join public.clinical_measurement_aba_task_step_results_v3 result on result.run_event_id=run.event_id
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,result.step_definition_id,result.sequence_no;

  insert into public.clinical_measurement_session_prompt_distribution_v3(expectation_id,source_kind,prompt_level_id,occurrence_count)
  select e.expectation_id,'TASK_ANALYSIS',result.prompt_level_id,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_aba_task_runs_v3 run on run.event_id=e.id
  join public.clinical_measurement_aba_task_step_results_v3 result on result.run_event_id=run.event_id
  where e.expectation_id=any(p_expectation_ids) and result.prompt_level_id is not null
  group by e.expectation_id,result.prompt_level_id;

  -- Append a revision only when the semantic projection actually changed.
  with snapshots as (
    select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,scope.semantic_family,
           public.build_clinical_measurement_projection_snapshot_v3(scope.expectation_id) payload,
           (select max(e.recorded_at) from public.clinical_measurement_raw_events_v3 e where e.expectation_id=scope.expectation_id) latest_recorded,
           clock_timestamp() computed_at
    from public.clinical_measurement_projection_scope_v3 scope
    where scope.expectation_id=any(p_expectation_ids)
  ), hashed as (
    select s.*,encode(digest(convert_to(s.payload::text,'UTF8'),'sha256'),'hex') projection_hash
    from snapshots s
  ), changed as (
    select h.*,head.revision_number old_revision,head.projection_hash old_hash,head.source_latest_recorded_at old_source,
      case
        when head.expectation_id is null then 'INITIAL'
        when p_revision_hint='MANUAL_REBUILD' then 'MANUAL_REBUILD'
        when exists (select 1 from public.clinical_measurement_raw_events_v3 e
                     where e.expectation_id=h.expectation_id
                       and e.recorded_at>coalesce(head.source_latest_recorded_at,'-infinity'::timestamptz)
                       and e.event_kind in ('CORRECTION','VOID','SUPERSEDE')) then 'AUDIT_CORRECTION'
        when exists (select 1 from public.clinical_measurement_raw_events_v3 e
                     where e.expectation_id=h.expectation_id
                       and e.recorded_at>coalesce(head.source_latest_recorded_at,'-infinity'::timestamptz)
                       and e.ingestion_mode='OFFLINE_SYNC') then 'LATE_DATA_INCORPORATED'
        when exists (select 1 from public.clinical_measurement_sessions_v3 s2
                     where s2.id=h.session_id and s2.status='FINALIZED'
                       and (head.expectation_id is null or head.computed_at<s2.finalized_at)) then 'SESSION_FINALIZED'
        else 'SOURCE_DATA_CHANGED' end revision_reason
    from hashed h
    left join public.clinical_measurement_session_projection_heads_v3 head on head.expectation_id=h.expectation_id
    where head.expectation_id is null or head.projection_hash is distinct from h.projection_hash
  ), inserted_revisions as (
    insert into public.clinical_measurement_session_projection_revisions_v3(
      expectation_id,organization_id,patient_id,session_id,target_id,semantic_family,revision_number,
      revision_reason,projection_hash,projection_payload,source_latest_recorded_at,computed_at
    )
    select expectation_id,organization_id,patient_id,session_id,target_id,semantic_family,coalesce(old_revision,0)+1,
           revision_reason,projection_hash,payload,latest_recorded,computed_at
    from changed
    returning expectation_id,revision_number,projection_hash,source_latest_recorded_at,computed_at
  )
  insert into public.clinical_measurement_session_projection_heads_v3(
    expectation_id,organization_id,patient_id,session_id,target_id,semantic_family,revision_number,
    projection_hash,source_latest_recorded_at,computed_at,updated_at
  )
  select c.expectation_id,c.organization_id,c.patient_id,c.session_id,c.target_id,c.semantic_family,
         r.revision_number,r.projection_hash,r.source_latest_recorded_at,r.computed_at,clock_timestamp()
  from changed c join inserted_revisions r using(expectation_id)
  on conflict(expectation_id) do update set
    revision_number=excluded.revision_number,
    projection_hash=excluded.projection_hash,
    source_latest_recorded_at=excluded.source_latest_recorded_at,
    computed_at=excluded.computed_at,
    updated_at=excluded.updated_at;

  select count(*) into v_count from unnest(p_expectation_ids) id;
  return v_count;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Statement-level enqueue: one bulk INSERT statement generates at most one queue
-- upsert per affected expectation, not one write per event.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_clinical_measurement_projection_from_raw_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  insert into public.clinical_measurement_projection_queue_v3(
    expectation_id,organization_id,patient_id,session_id,target_id,semantic_family,
    generation,processed_generation,status,latest_source_event_id,latest_source_recorded_at,
    latest_event_kind,latest_ingestion_mode,enqueued_at
  )
  select distinct on (event.expectation_id)
    event.expectation_id,event.organization_id,event.patient_id,event.session_id,event.target_id,event.semantic_family,
    1,0,'PENDING',event.id,event.recorded_at,event.event_kind,event.ingestion_mode,clock_timestamp()
  from inserted_events event
  join public.clinical_measurement_collection_streams_v3 stream on stream.id=event.stream_id and stream.stream_role='PRIMARY'
  order by event.expectation_id,event.recorded_at desc,event.id desc
  on conflict(expectation_id) do update set
    generation=public.clinical_measurement_projection_queue_v3.generation+1,
    status='PENDING',latest_source_event_id=excluded.latest_source_event_id,
    latest_source_recorded_at=greatest(public.clinical_measurement_projection_queue_v3.latest_source_recorded_at,excluded.latest_source_recorded_at),
    latest_event_kind=excluded.latest_event_kind,latest_ingestion_mode=excluded.latest_ingestion_mode,
    enqueued_at=excluded.enqueued_at,last_error=null;
  return null;
end;
$function$;

create or replace function public.enqueue_clinical_measurement_projection_on_session_finalization_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  if old.status is distinct from 'FINALIZED' and new.status='FINALIZED' then
    insert into public.clinical_measurement_projection_queue_v3(
      expectation_id,organization_id,patient_id,session_id,target_id,semantic_family,
      generation,processed_generation,status,enqueued_at
    )
    select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,scope.semantic_family,
           1,0,'PENDING',clock_timestamp()
    from public.clinical_measurement_projection_scope_v3 scope
    where scope.session_id=new.id
    on conflict(expectation_id) do update set
      generation=public.clinical_measurement_projection_queue_v3.generation+1,
      status='PENDING',enqueued_at=excluded.enqueued_at,last_error=null;
  end if;
  return null;
end;
$function$;

-- Claim + process a bounded queue batch without per-expectation SQL calls.
create or replace function public.process_clinical_measurement_projection_queue_v3(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_ids uuid[];
  v_count integer;
begin
  if p_limit < 1 or p_limit > 250 then raise exception 'CMV3_PROJECTION_LIMIT_INVALID'; end if;

  with candidates as (
    select expectation_id
    from public.clinical_measurement_projection_queue_v3
    where status in ('PENDING','FAILED')
    order by enqueued_at,expectation_id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.clinical_measurement_projection_queue_v3 queue
    set status='PROCESSING',processing_started_at=clock_timestamp(),attempt_count=attempt_count+1,last_error=null
    from candidates
    where queue.expectation_id=candidates.expectation_id
    returning queue.expectation_id
  )
  select array_agg(expectation_id order by expectation_id),count(*)::integer into v_ids,v_count from claimed;

  if coalesce(v_count,0)=0 then return jsonb_build_object('processed',0); end if;

  perform public.recompute_clinical_measurement_projection_batch_v3(v_ids,null);

  update public.clinical_measurement_projection_queue_v3
  set processed_generation=generation,status='DONE',processed_at=clock_timestamp(),processing_started_at=null,last_error=null
  where expectation_id=any(v_ids);

  return jsonb_build_object('processed',v_count,'expectation_ids',to_jsonb(v_ids));
end;
$function$;

-- Manual deterministic rebuild. It never touches raw facts.
create or replace function public.rebuild_clinical_measurement_projection_v3(p_expectation_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  return public.recompute_clinical_measurement_projection_batch_v3(p_expectation_ids,'MANUAL_REBUILD');
end;
$function$;

-- Projection revision history itself is append-only.
create or replace function public.guard_clinical_measurement_projection_revision_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'CMV3_PROJECTION_REVISION_APPEND_ONLY';
end;
$function$;

drop trigger if exists enqueue_cmv3_projection_raw on public.clinical_measurement_raw_events_v3;
create trigger enqueue_cmv3_projection_raw
after insert on public.clinical_measurement_raw_events_v3
referencing new table as inserted_events
for each statement execute function public.enqueue_clinical_measurement_projection_from_raw_v3();

drop trigger if exists enqueue_cmv3_projection_session_finalized on public.clinical_measurement_sessions_v3;
create trigger enqueue_cmv3_projection_session_finalized
after update of status on public.clinical_measurement_sessions_v3
for each row execute function public.enqueue_clinical_measurement_projection_on_session_finalization_v3();

drop trigger if exists guard_cmv3_projection_revision_immutable on public.clinical_measurement_session_projection_revisions_v3;
create trigger guard_cmv3_projection_revision_immutable
before update or delete on public.clinical_measurement_session_projection_revisions_v3
for each row execute function public.guard_clinical_measurement_projection_revision_v3();

-- ---------------------------------------------------------------------------
-- Dark RLS and privileges. API/read endpoints arrive later; browser roles cannot
-- query these internal projections directly.
-- ---------------------------------------------------------------------------
do $cmv3_projection_rls$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinical_measurement_projection_queue_v3',
    'clinical_measurement_session_count_summaries_v3',
    'clinical_measurement_session_rate_summaries_v3',
    'clinical_measurement_session_proportion_summaries_v3',
    'clinical_measurement_session_temporal_summaries_v3',
    'clinical_measurement_session_continuous_summaries_v3',
    'clinical_measurement_session_interval_summaries_v3',
    'clinical_measurement_session_ordinal_summaries_v3',
    'clinical_measurement_session_categorical_summaries_v3',
    'clinical_measurement_session_task_analysis_summaries_v3',
    'clinical_measurement_session_category_breakdown_v3',
    'clinical_measurement_session_interval_breakdown_v3',
    'clinical_measurement_session_prompt_distribution_v3',
    'clinical_measurement_session_task_step_summaries_v3',
    'clinical_measurement_session_projection_heads_v3',
    'clinical_measurement_session_projection_revisions_v3'
  ] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated',v_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role',v_table);
  end loop;
end;
$cmv3_projection_rls$;

-- Cold revision ledger is append-only even for service_role; only SELECT/INSERT are needed.
revoke update, delete on table public.clinical_measurement_session_projection_revisions_v3 from service_role;

revoke all on public.clinical_measurement_effective_raw_events_v3 from public,anon,authenticated;
revoke all on public.clinical_measurement_projection_scope_v3 from public,anon,authenticated;
revoke all on public.clinical_measurement_effective_primary_events_v3 from public,anon,authenticated;
grant select on public.clinical_measurement_effective_raw_events_v3 to service_role;
grant select on public.clinical_measurement_projection_scope_v3 to service_role;
grant select on public.clinical_measurement_effective_primary_events_v3 to service_role;

revoke all on function public.cmv3_projection_coverage_status(uuid,text) from public,anon,authenticated;
revoke all on function public.build_clinical_measurement_projection_snapshot_v3(uuid) from public,anon,authenticated;
revoke all on function public.recompute_clinical_measurement_projection_batch_v3(uuid[],text) from public,anon,authenticated;
revoke all on function public.process_clinical_measurement_projection_queue_v3(integer) from public,anon,authenticated;
revoke all on function public.rebuild_clinical_measurement_projection_v3(uuid[]) from public,anon,authenticated;
grant execute on function public.cmv3_projection_coverage_status(uuid,text) to service_role;
grant execute on function public.build_clinical_measurement_projection_snapshot_v3(uuid) to service_role;
grant execute on function public.recompute_clinical_measurement_projection_batch_v3(uuid[],text) to service_role;
grant execute on function public.process_clinical_measurement_projection_queue_v3(integer) to service_role;
grant execute on function public.rebuild_clinical_measurement_projection_v3(uuid[]) to service_role;


-- ===========================================================================
-- Embedded canonical block 09/12: 20260820220000_clinical_measurement_v3_semantic_api_decisions.sql
-- ===========================================================================
-- Verto Clinical Measurement Engine V3 - Migration G
-- Semantic decision/evidence state foundation. Additive/dark only.


create unique index if not exists ux_cmv3_phase_epoch_scope_id
  on public.clinical_measurement_phase_epochs_v3(id, organization_id, patient_id, target_id);

create table if not exists public.clinical_measurement_criterion_epochs_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  definition_version_id uuid not null,
  phase_epoch_id uuid,
  criterion_key text not null,
  criterion_type text not null check (criterion_type in ('MASTERY','MAINTENANCE','GENERALIZATION','CUSTOM')),
  rule jsonb not null check (jsonb_typeof(rule)='object'),
  rule_hash text not null default repeat('0',64) check (rule_hash ~ '^[0-9a-f]{64}$'),
  effective_from timestamptz not null,
  effective_until timestamptz,
  recorded_at timestamptz not null default now(),
  supersedes_criterion_epoch_id uuid,
  superseded_at timestamptz,
  created_by text,
  constraint cmv3_criterion_epoch_window check (effective_until is null or effective_until > effective_from),
  constraint cmv3_criterion_epoch_key_nonempty check (length(trim(criterion_key)) between 1 and 180),
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id) on delete restrict,
  foreign key (definition_version_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_definition_versions_v3(id, organization_id, patient_id, target_id) on delete restrict,
  foreign key (phase_epoch_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_phase_epochs_v3(id, organization_id, patient_id, target_id) on delete restrict,
  unique (id, organization_id, patient_id, target_id),
  foreign key (supersedes_criterion_epoch_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_criterion_epochs_v3(id, organization_id, patient_id, target_id) on delete restrict
);

create index if not exists idx_cmv3_criterion_epochs_target
  on public.clinical_measurement_criterion_epochs_v3(organization_id,patient_id,target_id,effective_from desc,recorded_at desc);

do $cmv3_criterion_overlap$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.clinical_measurement_criterion_epochs_v3'::regclass and conname='cmv3_criterion_epoch_no_overlap') then
    alter table public.clinical_measurement_criterion_epochs_v3 add constraint cmv3_criterion_epoch_no_overlap
      exclude using gist (organization_id with =, target_id with =, criterion_key with =,
        tstzrange(effective_from,coalesce(effective_until,'infinity'::timestamptz),'[)') with &&)
      where (superseded_at is null);
  end if;
end;$cmv3_criterion_overlap$;

create table if not exists public.clinical_measurement_evidence_revisions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  criterion_epoch_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  evidence_support_state text not null check (evidence_support_state in ('NOT_EVALUATED','INSUFFICIENT','SUFFICIENT','CHANGED_SINCE_DECISION','INVALIDATED')),
  evaluation_status text not null check (evaluation_status in ('NOT_EVALUATED','CRITERION_NOT_MET','CRITERION_MET','INDETERMINATE')),
  evaluation jsonb not null default '{}'::jsonb check (jsonb_typeof(evaluation)='object'),
  evidence_hash text not null default repeat('0',64) check (evidence_hash ~ '^[0-9a-f]{64}$'),
  projection_watermark timestamptz,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (criterion_epoch_id, revision_number),
  unique (id, organization_id, patient_id, target_id),
  foreign key (criterion_epoch_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_criterion_epochs_v3(id, organization_id, patient_id, target_id) on delete restrict,
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id) on delete restrict
);

create index if not exists idx_cmv3_evidence_revisions_latest
  on public.clinical_measurement_evidence_revisions_v3(organization_id,patient_id,target_id,criterion_epoch_id,revision_number desc);

create table if not exists public.clinical_measurement_clinical_decision_events_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id uuid not null,
  decision_type text not null check (decision_type in ('CLINICIAN_CONFIRMED_MASTERY','CLINICIAN_REVOKED_MASTERY','CLINICIAN_CONFIRMED_MAINTENANCE','CLINICIAN_REOPENED_ACQUISITION')),
  evidence_revision_id uuid,
  actor_membership_id uuid not null references public.clinic_memberships(id) on delete restrict,
  reason text,
  decided_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  supersedes_decision_event_id uuid,
  unique (id, organization_id, patient_id, target_id),
  foreign key (supersedes_decision_event_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_clinical_decision_events_v3(id, organization_id, patient_id, target_id) on delete restrict,
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id) on delete restrict,
  foreign key (evidence_revision_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_evidence_revisions_v3(id, organization_id, patient_id, target_id) on delete restrict
);

create index if not exists idx_cmv3_decisions_target
  on public.clinical_measurement_clinical_decision_events_v3(organization_id,patient_id,target_id,decided_at desc,recorded_at desc);


create or replace function public.prepare_clinical_measurement_criterion_epoch_v3()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,extensions set row_security=off as $function$
begin
  new.recorded_at := clock_timestamp();
  new.rule_hash := encode(digest(convert_to(new.rule::text,'UTF8'),'sha256'),'hex');
  return new;
end;$function$;
drop trigger if exists cmv3_prepare_criterion_epoch on public.clinical_measurement_criterion_epochs_v3;
create trigger cmv3_prepare_criterion_epoch before insert on public.clinical_measurement_criterion_epochs_v3
for each row execute function public.prepare_clinical_measurement_criterion_epoch_v3();

create or replace function public.prepare_clinical_measurement_evidence_revision_v3()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,extensions set row_security=off as $function$
begin
  new.evaluated_at := clock_timestamp(); new.created_at := new.evaluated_at;
  new.evidence_hash := encode(digest(convert_to(jsonb_build_object(
    'criterion_epoch_id',new.criterion_epoch_id,'revision_number',new.revision_number,
    'support',new.evidence_support_state,'status',new.evaluation_status,
    'evaluation',new.evaluation
  )::text,'UTF8'),'sha256'),'hex');
  return new;
end;$function$;
drop trigger if exists cmv3_prepare_evidence_revision on public.clinical_measurement_evidence_revisions_v3;
create trigger cmv3_prepare_evidence_revision before insert on public.clinical_measurement_evidence_revisions_v3
for each row execute function public.prepare_clinical_measurement_evidence_revision_v3();

create or replace function public.validate_clinical_measurement_decision_actor_v3()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public set row_security=off as $function$
declare v_ok boolean;
begin
  select exists(select 1 from public.clinic_memberships m where m.id=new.actor_membership_id and m.clinic_id=new.organization_id and lower(coalesce(m.status,''))='active') into v_ok;
  if not v_ok then raise exception 'CMV3_DECISION_ACTOR_SCOPE_INVALID'; end if;
  new.recorded_at := clock_timestamp();
  return new;
end;$function$;
drop trigger if exists cmv3_validate_decision_actor on public.clinical_measurement_clinical_decision_events_v3;
create trigger cmv3_validate_decision_actor before insert on public.clinical_measurement_clinical_decision_events_v3
for each row execute function public.validate_clinical_measurement_decision_actor_v3();

create table if not exists public.clinical_measurement_target_states_v3 (
  target_id uuid primary key,
  organization_id uuid not null,
  patient_id uuid not null,
  clinical_state text not null default 'ACTIVE' check (clinical_state in ('ACTIVE','MASTERED','MAINTENANCE','REOPENED_ACQUISITION')),
  evidence_support_state text not null default 'NOT_EVALUATED' check (evidence_support_state in ('NOT_EVALUATED','INSUFFICIENT','SUFFICIENT','CHANGED_SINCE_DECISION','INVALIDATED')),
  workflow_attention_state text not null default 'NONE' check (workflow_attention_state in ('NONE','REVIEW_REQUIRED')),
  latest_decision_event_id uuid,
  latest_evidence_revision_id uuid,
  updated_at timestamptz not null default now(),
  foreign key (target_id, organization_id, patient_id)
    references public.clinical_measurement_targets_v3(id, organization_id, patient_id) on delete cascade,
  foreign key (latest_decision_event_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_clinical_decision_events_v3(id, organization_id, patient_id, target_id) on delete restrict,
  foreign key (latest_evidence_revision_id, organization_id, patient_id, target_id)
    references public.clinical_measurement_evidence_revisions_v3(id, organization_id, patient_id, target_id) on delete restrict
);


create or replace function public.evaluate_clinical_measurement_criterion_v3(p_criterion_epoch_id uuid)
returns public.clinical_measurement_evidence_revisions_v3
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
set row_security=off
as $function$
declare
  c public.clinical_measurement_criterion_epochs_v3;
  d public.clinical_measurement_definitions_v3;
  v_size integer;
  v_min_den integer;
  v_operator text;
  v_threshold numeric;
  v_points jsonb := '[]'::jsonb;
  v_eligible integer := 0;
  v_passing integer := 0;
  v_eval_status text := 'INDETERMINATE';
  v_support text := 'INSUFFICIENT';
  v_evaluation jsonb;
  v_watermark timestamptz;
  v_latest public.clinical_measurement_evidence_revisions_v3;
  v_result public.clinical_measurement_evidence_revisions_v3;
begin
  select * into strict c from public.clinical_measurement_criterion_epochs_v3 where id=p_criterion_epoch_id for update;
  select def.* into strict d from public.clinical_measurement_definition_versions_v3 ver
    join public.clinical_measurement_definitions_v3 def on def.id=ver.definition_id
    where ver.id=c.definition_version_id and def.target_id=c.target_id;
  v_size := greatest(1,least(100,coalesce((c.rule#>>'{window,size}')::integer,1)));
  v_min_den := greatest(0,coalesce((c.rule->>'minimum_denominator_per_point')::integer,0));
  v_operator := upper(coalesce(c.rule->>'operator',''));
  v_threshold := nullif(c.rule->>'threshold','')::numeric;
  if v_operator not in ('GREATER_THAN_OR_EQUAL','GREATER_THAN','LESS_THAN_OR_EQUAL','LESS_THAN','EQUAL') or v_threshold is null then
    raise exception 'CMV3_CRITERION_RULE_UNSUPPORTED';
  end if;
  if upper(coalesce(c.rule#>>'{window,unit}','SESSION')) <> 'SESSION'
     or coalesce((c.rule#>>'{window,consecutive}')::boolean,true) is not true then
    raise exception 'CMV3_CRITERION_WINDOW_UNSUPPORTED';
  end if;
  if (d.semantic_family in ('PROPORTION','TASK_ANALYSIS') and upper(coalesce(c.rule->>'threshold_unit','')) <> 'PERCENT')
     or (d.semantic_family='RATE' and upper(coalesce(c.rule->>'threshold_unit','')) <> 'EVENTS_PER_HOUR')
     or (d.semantic_family='COUNT' and upper(coalesce(c.rule->>'threshold_unit','')) <> 'COUNT')
     or (d.semantic_family in ('DURATION','LATENCY','IRT') and upper(coalesce(c.rule->>'threshold_unit','')) <> 'MILLISECOND')
     or (d.semantic_family='CONTINUOUS' and nullif(c.rule->>'threshold_unit','') is null) then
    raise exception 'CMV3_CRITERION_THRESHOLD_UNIT_REQUIRED';
  end if;

  if d.semantic_family='CONTINUOUS' and upper(c.rule->>'threshold_unit') is distinct from upper(coalesce((select unit_code from public.clinical_measurement_definition_versions_v3 where id=c.definition_version_id),'')) then
    raise exception 'CMV3_CRITERION_THRESHOLD_UNIT_MISMATCH';
  end if;

  if d.semantic_family='PROPORTION' then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,
        (s.coverage_status='OBSERVED' and s.denominator is not null and s.denominator>=v_min_den and s.percent_value is not null) eligible,
        case v_operator when 'GREATER_THAN_OR_EQUAL' then s.percent_value>=v_threshold when 'GREATER_THAN' then s.percent_value>v_threshold when 'LESS_THAN_OR_EQUAL' then s.percent_value<=v_threshold when 'LESS_THAN' then s.percent_value<v_threshold else s.percent_value=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,
        jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.percent_value,'numerator',s.numerator,'denominator',s.denominator) point
      from public.clinical_measurement_session_proportion_summaries_v3 s
      where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  elsif d.semantic_family='RATE' then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,(s.coverage_status='OBSERVED' and s.rate_per_hour is not null) eligible,
        case v_operator when 'GREATER_THAN_OR_EQUAL' then s.rate_per_hour>=v_threshold when 'GREATER_THAN' then s.rate_per_hour>v_threshold when 'LESS_THAN_OR_EQUAL' then s.rate_per_hour<=v_threshold when 'LESS_THAN' then s.rate_per_hour<v_threshold else s.rate_per_hour=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.rate_per_hour,'event_count',s.event_count,'observation_duration_ms',s.observation_duration_ms) point
      from public.clinical_measurement_session_rate_summaries_v3 s where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  elsif d.semantic_family='COUNT' then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,(s.coverage_status='OBSERVED') eligible,
        (s.coverage_status='OBSERVED') and case v_operator when 'GREATER_THAN_OR_EQUAL' then s.total_count>=v_threshold when 'GREATER_THAN' then s.total_count>v_threshold when 'LESS_THAN_OR_EQUAL' then s.total_count<=v_threshold when 'LESS_THAN' then s.total_count<v_threshold else s.total_count=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.total_count) point
      from public.clinical_measurement_session_count_summaries_v3 s where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  elsif d.semantic_family in ('DURATION','LATENCY','IRT') then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,(s.coverage_status='OBSERVED' and s.mean_duration_ms is not null) eligible,
        case v_operator when 'GREATER_THAN_OR_EQUAL' then s.mean_duration_ms>=v_threshold when 'GREATER_THAN' then s.mean_duration_ms>v_threshold when 'LESS_THAN_OR_EQUAL' then s.mean_duration_ms<=v_threshold when 'LESS_THAN' then s.mean_duration_ms<v_threshold else s.mean_duration_ms=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.mean_duration_ms,'unit','MILLISECOND') point
      from public.clinical_measurement_session_temporal_summaries_v3 s where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id and s.semantic_family=d.semantic_family
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  elsif d.semantic_family='CONTINUOUS' then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,(s.coverage_status='OBSERVED' and s.latest_value is not null) eligible,
        case v_operator when 'GREATER_THAN_OR_EQUAL' then s.latest_value>=v_threshold when 'GREATER_THAN' then s.latest_value>v_threshold when 'LESS_THAN_OR_EQUAL' then s.latest_value<=v_threshold when 'LESS_THAN' then s.latest_value<v_threshold else s.latest_value=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.latest_value) point
      from public.clinical_measurement_session_continuous_summaries_v3 s where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  elsif d.semantic_family='TASK_ANALYSIS' then
    select coalesce(jsonb_agg(x.point order by x.rn),'[]'::jsonb),count(*) filter(where x.eligible),count(*) filter(where x.eligible and x.passing),max(x.recorded_at)
    into v_points,v_eligible,v_passing,v_watermark from (
      select row_number() over(order by s.clinical_date desc,s.session_id desc) rn,(s.coverage_status='OBSERVED' and s.acquisition_eligible_count>=v_min_den and s.acquisition_independence_percent is not null) eligible,
        case v_operator when 'GREATER_THAN_OR_EQUAL' then s.acquisition_independence_percent>=v_threshold when 'GREATER_THAN' then s.acquisition_independence_percent>v_threshold when 'LESS_THAN_OR_EQUAL' then s.acquisition_independence_percent<=v_threshold when 'LESS_THAN' then s.acquisition_independence_percent<v_threshold else s.acquisition_independence_percent=v_threshold end passing,
        s.source_latest_recorded_at recorded_at,jsonb_build_object('session_id',s.session_id,'clinical_date',s.clinical_date,'value',s.acquisition_independence_percent,'eligible_steps',s.acquisition_eligible_count) point
      from public.clinical_measurement_session_task_analysis_summaries_v3 s where s.organization_id=c.organization_id and s.patient_id=c.patient_id and s.target_id=c.target_id and s.definition_version_id=c.definition_version_id
        and s.clinical_date>=c.effective_from::date and (c.effective_until is null or s.clinical_date<c.effective_until::date)
      order by s.clinical_date desc,s.session_id desc limit v_size
    ) x;
  else
    v_eval_status := 'INDETERMINATE'; v_support := 'INSUFFICIENT';
  end if;

  if d.semantic_family in ('PROPORTION','RATE','COUNT','DURATION','LATENCY','IRT','CONTINUOUS','TASK_ANALYSIS') then
    if v_eligible < v_size then v_eval_status:='INDETERMINATE'; v_support:='INSUFFICIENT';
    elsif v_passing=v_size then v_eval_status:='CRITERION_MET'; v_support:='SUFFICIENT';
    else v_eval_status:='CRITERION_NOT_MET'; v_support:='INSUFFICIENT'; end if;
  end if;
  v_evaluation := jsonb_build_object('eligible_points',v_eligible,'required_points',v_size,'passing_points',v_passing,'points',v_points,'rule',c.rule);
  select * into v_latest from public.clinical_measurement_evidence_revisions_v3 e where e.criterion_epoch_id=c.id order by e.revision_number desc limit 1;
  if v_latest.id is not null and v_latest.evidence_support_state=v_support and v_latest.evaluation_status=v_eval_status and v_latest.evaluation=v_evaluation then return v_latest; end if;
  insert into public.clinical_measurement_evidence_revisions_v3(organization_id,patient_id,target_id,criterion_epoch_id,revision_number,evidence_support_state,evaluation_status,evaluation,projection_watermark)
  values(c.organization_id,c.patient_id,c.target_id,c.id,coalesce(v_latest.revision_number,0)+1,v_support,v_eval_status,v_evaluation,v_watermark)
  returning * into v_result;
  return v_result;
end;$function$;

create or replace function public.refresh_clinical_measurement_target_state_v3(p_target_id uuid)
returns public.clinical_measurement_target_states_v3
language plpgsql
security definer
set search_path=pg_catalog,public
set row_security=off
as $function$
declare
  v_target public.clinical_measurement_targets_v3;
  v_decision public.clinical_measurement_clinical_decision_events_v3;
  v_evidence public.clinical_measurement_evidence_revisions_v3;
  v_clinical text := 'ACTIVE';
  v_evidence_state text := 'NOT_EVALUATED';
  v_workflow text := 'NONE';
  v_result public.clinical_measurement_target_states_v3;
begin
  select * into strict v_target from public.clinical_measurement_targets_v3 where id=p_target_id;
  select * into v_decision from public.clinical_measurement_clinical_decision_events_v3 d
    where d.target_id=p_target_id order by d.decided_at desc,d.recorded_at desc,d.id desc limit 1;
  if v_decision.id is not null and v_decision.evidence_revision_id is not null then
    select current_e.* into v_evidence
    from public.clinical_measurement_evidence_revisions_v3 decided_e
    join public.clinical_measurement_evidence_revisions_v3 current_e
      on current_e.criterion_epoch_id=decided_e.criterion_epoch_id
    where decided_e.id=v_decision.evidence_revision_id and current_e.target_id=p_target_id
    order by current_e.revision_number desc,current_e.evaluated_at desc,current_e.id desc limit 1;
  else
    select * into v_evidence from public.clinical_measurement_evidence_revisions_v3 e
      where e.target_id=p_target_id order by e.evaluated_at desc,e.revision_number desc,e.id desc limit 1;
  end if;

  if v_decision.id is not null then
    v_clinical := case v_decision.decision_type
      when 'CLINICIAN_CONFIRMED_MASTERY' then 'MASTERED'
      when 'CLINICIAN_REVOKED_MASTERY' then 'ACTIVE'
      when 'CLINICIAN_CONFIRMED_MAINTENANCE' then 'MAINTENANCE'
      when 'CLINICIAN_REOPENED_ACQUISITION' then 'REOPENED_ACQUISITION'
      else 'ACTIVE' end;
  end if;
  if v_evidence.id is not null then v_evidence_state := v_evidence.evidence_support_state; end if;
  if v_decision.id is not null and v_evidence.id is not null
     and (v_decision.evidence_revision_id is distinct from v_evidence.id)
     and v_evidence.evidence_support_state in ('INSUFFICIENT','CHANGED_SINCE_DECISION','INVALIDATED') then
    v_workflow := 'REVIEW_REQUIRED';
  end if;

  insert into public.clinical_measurement_target_states_v3(
    target_id,organization_id,patient_id,clinical_state,evidence_support_state,workflow_attention_state,
    latest_decision_event_id,latest_evidence_revision_id,updated_at)
  values (v_target.id,v_target.organization_id,v_target.patient_id,v_clinical,v_evidence_state,v_workflow,
    v_decision.id,v_evidence.id,clock_timestamp())
  on conflict (target_id) do update set
    clinical_state=excluded.clinical_state,
    evidence_support_state=excluded.evidence_support_state,
    workflow_attention_state=excluded.workflow_attention_state,
    latest_decision_event_id=excluded.latest_decision_event_id,
    latest_evidence_revision_id=excluded.latest_evidence_revision_id,
    updated_at=excluded.updated_at
  returning * into v_result;
  return v_result;
end;
$function$;


create or replace function public.cmv3_refresh_target_state_after_append()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public set row_security=off as $function$
begin
  perform public.refresh_clinical_measurement_target_state_v3(new.target_id);
  return new;
end;$function$;
drop trigger if exists cmv3_refresh_state_after_evidence on public.clinical_measurement_evidence_revisions_v3;
create trigger cmv3_refresh_state_after_evidence after insert on public.clinical_measurement_evidence_revisions_v3
for each row execute function public.cmv3_refresh_target_state_after_append();
drop trigger if exists cmv3_refresh_state_after_decision on public.clinical_measurement_clinical_decision_events_v3;
create trigger cmv3_refresh_state_after_decision after insert on public.clinical_measurement_clinical_decision_events_v3
for each row execute function public.cmv3_refresh_target_state_after_append();

create or replace function public.cmv3_criterion_epoch_mutation_guard()
returns trigger language plpgsql as $function$
begin
  if tg_op='DELETE' then raise exception 'CMV3_CRITERION_EPOCH_DELETE_FORBIDDEN'; end if;
  if (to_jsonb(new)-'superseded_at') is distinct from (to_jsonb(old)-'superseded_at') then
    raise exception 'CMV3_CRITERION_EPOCH_IMMUTABLE';
  end if;
  if new.superseded_at is not null and new.superseded_at < old.recorded_at then raise exception 'CMV3_CRITERION_SUPERSEDED_TIME_INVALID'; end if;
  return new;
end;$function$;
drop trigger if exists cmv3_criterion_epoch_mutation_guard on public.clinical_measurement_criterion_epochs_v3;
create trigger cmv3_criterion_epoch_mutation_guard before update or delete on public.clinical_measurement_criterion_epochs_v3
for each row execute function public.cmv3_criterion_epoch_mutation_guard();

create or replace function public.cmv3_append_only_guard()
returns trigger language plpgsql as $function$
begin
  raise exception 'CMV3_APPEND_ONLY_ENTITY';
end;$function$;

do $guards$
declare t text;
begin
  foreach t in array array['clinical_measurement_evidence_revisions_v3','clinical_measurement_clinical_decision_events_v3'] loop
    execute format('drop trigger if exists cmv3_append_only_guard on public.%I',t);
    execute format('create trigger cmv3_append_only_guard before update or delete on public.%I for each row execute function public.cmv3_append_only_guard()',t);
  end loop;
end;$guards$;

-- Browser remains closed. Server/service role is the only path during dark rollout.
do $rls$
declare t text;
begin
  foreach t in array array[
    'clinical_measurement_criterion_epochs_v3','clinical_measurement_evidence_revisions_v3',
    'clinical_measurement_clinical_decision_events_v3','clinical_measurement_target_states_v3'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
  end loop;
end;$rls$;

revoke all on function public.evaluate_clinical_measurement_criterion_v3(uuid) from public, anon, authenticated;
grant execute on function public.evaluate_clinical_measurement_criterion_v3(uuid) to service_role;
revoke all on function public.refresh_clinical_measurement_target_state_v3(uuid) from public, anon, authenticated;
grant execute on function public.refresh_clinical_measurement_target_state_v3(uuid) to service_role;


-- ===========================================================================
-- Embedded canonical block 10/12: 20260820233000_clinical_measurement_v3_security_shadow_hardening.sql
-- ===========================================================================
-- Verto Clinical Measurement Engine V3 - Migration I: security hardening + shadow comparison.
-- Additive/dark only. Closes implicit PUBLIC EXECUTE on CMV3 functions, adds a
-- service-only security attestation, and provides read-only shadow comparison
-- across Universal V3, canonical ABA V3 and observational Legacy V2.


-- ---------------------------------------------------------------------------
-- Deny-by-default function execution.
-- PostgreSQL grants EXECUTE on newly-created functions to PUBLIC by default.
-- Because several CMV3 helpers are SECURITY DEFINER, table RLS alone is not a
-- sufficient boundary. Revoke browser/public execution from every CMV3 function
-- family and explicitly grant only intended service-role entrypoints below.
-- ---------------------------------------------------------------------------
do $cmv3_revoke_browser_function_execute$
declare
  fn record;
begin
  for fn in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like 'clinical_measurement\_%\_v3' escape '\'
        or p.proname like 'clinical_aba\_%\_v3' escape '\'
        or p.proname like 'cmv3\_%' escape '\'
      )
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public, anon, authenticated',
      fn.schema_name,
      fn.function_name,
      fn.identity_args
    );
  end loop;
end;
$cmv3_revoke_browser_function_execute$;

-- These publication operations are server-owned lifecycle transitions. They were
-- intentionally not browser routes, but previously inherited PUBLIC EXECUTE.
grant execute on function public.publish_clinical_aba_prompt_hierarchy_version_v3(uuid) to service_role;
grant execute on function public.publish_clinical_aba_chaining_policy_version_v3(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Schema-level security attestation. This is intentionally service-role only and
-- checks both relation grants and function execution. RLS is expected on every
-- physical CMV3/Clinical ABA V3 table; browser roles should have no direct CRUD.
-- ---------------------------------------------------------------------------
create or replace function public.get_clinical_measurement_v3_security_preflight()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_relation_issues jsonb;
  v_function_issues jsonb;
  v_table_count integer;
  v_function_count integer;
begin
  select
    count(*) filter (where c.relkind in ('r','p')),
    coalesce(jsonb_agg(jsonb_build_object(
      'relation', c.relname,
      'relkind', c.relkind,
      'rls_enabled', c.relrowsecurity,
      'anon_select', pg_catalog.has_table_privilege('anon', c.oid, 'SELECT'),
      'anon_insert', pg_catalog.has_table_privilege('anon', c.oid, 'INSERT'),
      'anon_update', pg_catalog.has_table_privilege('anon', c.oid, 'UPDATE'),
      'anon_delete', pg_catalog.has_table_privilege('anon', c.oid, 'DELETE'),
      'authenticated_select', pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT'),
      'authenticated_insert', pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT'),
      'authenticated_update', pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE'),
      'authenticated_delete', pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE')
    ) order by c.relname) filter (
      where
        (c.relkind in ('r','p') and not c.relrowsecurity)
        or pg_catalog.has_table_privilege('anon', c.oid, 'SELECT')
        or pg_catalog.has_table_privilege('anon', c.oid, 'INSERT')
        or pg_catalog.has_table_privilege('anon', c.oid, 'UPDATE')
        or pg_catalog.has_table_privilege('anon', c.oid, 'DELETE')
        or pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT')
        or pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT')
        or pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE')
        or pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE')
    ), '[]'::jsonb)
  into v_table_count, v_relation_issues
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r','p','v','m')
    and (
      c.relname like 'clinical_measurement\_%\_v3' escape '\'
      or c.relname like 'clinical_aba\_%\_v3' escape '\'
    );

  select
    count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'function', p.proname,
      'identity_args', pg_catalog.pg_get_function_identity_arguments(p.oid),
      'security_definer', p.prosecdef,
      'anon_execute', pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_execute', pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) order by p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)) filter (
      where pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
         or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ), '[]'::jsonb)
  into v_function_count, v_function_issues
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (
      p.proname like 'clinical_measurement\_%\_v3' escape '\'
      or p.proname like 'clinical_aba\_%\_v3' escape '\'
      or p.proname like 'cmv3\_%' escape '\'
    );

  return jsonb_build_object(
    'ok', jsonb_array_length(v_relation_issues) = 0 and jsonb_array_length(v_function_issues) = 0,
    'checked_table_count', v_table_count,
    'checked_function_count', v_function_count,
    'relation_issues', v_relation_issues,
    'function_issues', v_function_issues,
    'checked_at', clock_timestamp()
  );
end;
$function$;

revoke all on function public.get_clinical_measurement_v3_security_preflight() from public, anon, authenticated;
grant execute on function public.get_clinical_measurement_v3_security_preflight() to service_role;

-- ---------------------------------------------------------------------------
-- Read-only shadow comparison for ABA-backed PROPORTION definitions.
-- Strong parity is Universal V3 vs the existing canonical ABA V3 summary because
-- both preserve PRIMARY_INDEPENDENT semantics. Legacy V2 is deliberately marked
-- OBSERVATIONAL_ONLY: its one-row-per-trial shape cannot represent every complex
-- V3 protocol without semantic loss and therefore never blocks canonical rollout.
-- ---------------------------------------------------------------------------
create or replace function public.get_clinical_measurement_v3_shadow_comparison(
  p_organization_id uuid,
  p_patient_id uuid,
  p_target_id uuid,
  p_definition_id uuid,
  p_period_start date default (current_date - 90),
  p_period_end date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_aba_target_id text;
  v_semantic_family text;
  v_rows jsonb;
  v_compared integer;
  v_matches integer;
  v_mismatches integer;
  v_incomplete integer;
  v_multi_segment integer;
begin
  if p_organization_id is null or p_patient_id is null or p_target_id is null or p_definition_id is null then
    raise exception 'CMV3_SHADOW_SCOPE_REQUIRED';
  end if;
  if p_period_start is null or p_period_end is null or p_period_start > p_period_end
     or (p_period_end - p_period_start) > 366 then
    raise exception 'CMV3_SHADOW_PERIOD_INVALID';
  end if;

  select t.aba_target_id
    into v_aba_target_id
  from public.clinical_measurement_targets_v3 t
  where t.id = p_target_id
    and t.organization_id = p_organization_id
    and t.patient_id = p_patient_id
    and t.source_kind = 'ABA_TARGET';
  if v_aba_target_id is null then
    raise exception 'CMV3_SHADOW_ABA_TARGET_REQUIRED';
  end if;

  select d.semantic_family
    into v_semantic_family
  from public.clinical_measurement_definitions_v3 d
  where d.id = p_definition_id
    and d.organization_id = p_organization_id
    and d.patient_id = p_patient_id
    and d.target_id = p_target_id;
  if v_semantic_family is null then
    raise exception 'CMV3_SHADOW_DEFINITION_SCOPE_INVALID';
  end if;
  if v_semantic_family <> 'PROPORTION' then
    raise exception 'CMV3_SHADOW_ONLY_PROPORTION_SUPPORTED';
  end if;

  with session_scope as (
    select
      s.id as aba_session_id,
      coalesce(s.reference_date, s.started_at::date) as session_date
    from public.aba_sessions s
    where s.patient_id = p_patient_id
      and s.clinic_id = p_organization_id::text
      and coalesce(s.reference_date, s.started_at::date) between p_period_start and p_period_end
  ), universal_v3 as (
    select
      cms.aba_session_id,
      count(*) as segment_count,
      sum(p.numerator)::integer as numerator,
      sum(p.denominator)::integer as denominator
    from public.clinical_measurement_session_proportion_summaries_v3 p
    join public.clinical_measurement_sessions_v3 cms
      on cms.id = p.session_id
     and cms.organization_id = p.organization_id
     and cms.patient_id = p.patient_id
    join public.clinical_measurement_definition_versions_v3 dv
      on dv.id = p.definition_version_id
     and dv.organization_id = p.organization_id
     and dv.patient_id = p.patient_id
     and dv.target_id = p.target_id
    where p.organization_id = p_organization_id
      and p.patient_id = p_patient_id
      and p.target_id = p_target_id
      and dv.definition_id = p_definition_id
      and cms.source_kind = 'ABA_SESSION'
      and cms.aba_session_id is not null
      and p.clinical_date between p_period_start and p_period_end
      and p.projection_status = 'READY'
    group by cms.aba_session_id
  ), canonical_aba_v3 as (
    select
      a.session_id as aba_session_id,
      count(*) as segment_count,
      sum(a.primary_independent_correct_count)::integer as numerator,
      sum(a.eligible_independent_opportunity_count)::integer as denominator
    from public.aba_session_target_summaries_v3 a
    join session_scope ss on ss.aba_session_id = a.session_id
    where a.organization_id = p_organization_id
      and a.patient_id = p_patient_id
      and a.target_id = v_aba_target_id
    group by a.session_id
  ), legacy_v2 as (
    select
      t.session_id as aba_session_id,
      count(*)::integer as trial_count,
      count(*) filter (where t.independent)::integer as independent_count
    from public.aba_trials t
    join session_scope ss on ss.aba_session_id = t.session_id
    where t.patient_id = p_patient_id
      and t.clinic_id = p_organization_id::text
      and t.target_id = v_aba_target_id
    group by t.session_id
  ), rows as (
    select
      ss.aba_session_id,
      ss.session_date,
      coalesce(u.segment_count, 0)::integer as universal_segment_count,
      u.numerator as universal_numerator,
      u.denominator as universal_denominator,
      coalesce(c.segment_count, 0)::integer as canonical_aba_v3_segment_count,
      c.numerator as canonical_aba_v3_numerator,
      c.denominator as canonical_aba_v3_denominator,
      l.trial_count as legacy_v2_trial_count,
      l.independent_count as legacy_v2_independent_count,
      case
        when coalesce(u.segment_count,0) > 1 or coalesce(c.segment_count,0) > 1 then 'NOT_DIRECTLY_COMPARABLE_MULTI_SEGMENT'
        when u.aba_session_id is null and c.aba_session_id is null then 'NO_CANONICAL_DATA'
        when u.aba_session_id is null then 'MISSING_UNIVERSAL_V3'
        when c.aba_session_id is null then 'MISSING_CANONICAL_ABA_V3'
        when u.numerator = c.numerator and u.denominator = c.denominator then 'MATCH'
        else 'MISMATCH'
      end as canonical_parity_status
    from session_scope ss
    left join universal_v3 u on u.aba_session_id = ss.aba_session_id
    left join canonical_aba_v3 c on c.aba_session_id = ss.aba_session_id
    left join legacy_v2 l on l.aba_session_id = ss.aba_session_id
    where u.aba_session_id is not null or c.aba_session_id is not null or l.aba_session_id is not null
    order by ss.session_date, ss.aba_session_id
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'session_id', r.aba_session_id,
      'clinical_date', r.session_date,
      'canonical_parity_status', r.canonical_parity_status,
      'universal_v3', jsonb_build_object(
        'segment_count', r.universal_segment_count,
        'numerator', r.universal_numerator,
        'denominator', r.universal_denominator,
        'percent', case when r.universal_denominator > 0 then round(100.0*r.universal_numerator/r.universal_denominator,4) else null end
      ),
      'canonical_aba_v3', jsonb_build_object(
        'segment_count', r.canonical_aba_v3_segment_count,
        'numerator', r.canonical_aba_v3_numerator,
        'denominator', r.canonical_aba_v3_denominator,
        'percent', case when r.canonical_aba_v3_denominator > 0 then round(100.0*r.canonical_aba_v3_numerator/r.canonical_aba_v3_denominator,4) else null end
      ),
      'legacy_v2', jsonb_build_object(
        'authority', 'OBSERVATIONAL_ONLY',
        'trial_count', r.legacy_v2_trial_count,
        'independent_count', r.legacy_v2_independent_count,
        'percent', case when r.legacy_v2_trial_count > 0 then round(100.0*r.legacy_v2_independent_count/r.legacy_v2_trial_count,4) else null end
      )
    ) order by r.session_date, r.aba_session_id), '[]'::jsonb),
    count(*) filter (where r.canonical_parity_status in ('MATCH','MISMATCH')),
    count(*) filter (where r.canonical_parity_status = 'MATCH'),
    count(*) filter (where r.canonical_parity_status = 'MISMATCH'),
    count(*) filter (where r.canonical_parity_status in ('MISSING_UNIVERSAL_V3','MISSING_CANONICAL_ABA_V3')),
    count(*) filter (where r.canonical_parity_status = 'NOT_DIRECTLY_COMPARABLE_MULTI_SEGMENT')
  into v_rows, v_compared, v_matches, v_mismatches, v_incomplete, v_multi_segment
  from rows r;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'patient_id', p_patient_id,
    'target_id', p_target_id,
    'definition_id', p_definition_id,
    'semantic_family', v_semantic_family,
    'period_start', p_period_start,
    'period_end', p_period_end,
    'canonical_comparison', jsonb_build_object(
      'authority', 'SHADOW_VALIDATION',
      'compared_session_count', coalesce(v_compared,0),
      'match_count', coalesce(v_matches,0),
      'mismatch_count', coalesce(v_mismatches,0),
      'incomplete_count', coalesce(v_incomplete,0),
      'multi_segment_not_directly_comparable_count', coalesce(v_multi_segment,0),
      'parity_clean', coalesce(v_compared,0) > 0 and coalesce(v_mismatches,0) = 0 and coalesce(v_incomplete,0) = 0 and coalesce(v_multi_segment,0) = 0
    ),
    'legacy_v2_policy', 'OBSERVATIONAL_ONLY_NOT_A_RELEASE_BLOCKER',
    'rows', v_rows,
    'computed_at', clock_timestamp()
  );
end;
$function$;

revoke all on function public.get_clinical_measurement_v3_shadow_comparison(uuid,uuid,uuid,uuid,date,date)
  from public, anon, authenticated;
grant execute on function public.get_clinical_measurement_v3_shadow_comparison(uuid,uuid,uuid,uuid,date,date)
  to service_role;


-- ===========================================================================
-- Embedded canonical block 11/12: 20260821001000_clinical_measurement_v3_dark_aba_shadow_mirror.sql
-- ===========================================================================
-- Clinical Measurement Engine V3 - controlled ABA V3 dark shadow mirror.
-- This migration DOES NOT backfill data automatically. It only installs a
-- service-role-only, idempotent mirror function and provenance surface.
-- Source is current-effective immutable ABA V3 raw, never legacy summaries.


-- Preserve operational provenance. A shadow mirror is neither a live collection,
-- an offline sync nor a clinician retrospective entry.
alter table public.clinical_measurement_raw_events_v3
  drop constraint if exists clinical_measurement_raw_events_v3_ingestion_mode_check;
alter table public.clinical_measurement_raw_events_v3
  add constraint clinical_measurement_raw_events_v3_ingestion_mode_check
  check (ingestion_mode in ('LIVE','OFFLINE_SYNC','RETROSPECTIVE_ENTRY','CORRECTION','SHADOW_MIRROR'));

create table if not exists public.clinical_measurement_shadow_mirror_links_v3 (
  source_engine text not null default 'ABA_V3' check (source_engine='ABA_V3'),
  source_trial_id uuid primary key references public.aba_trials_v3(id) on delete restrict,
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  source_session_id text not null references public.aba_sessions(id) on delete restrict,
  source_target_id text not null references public.aba_targets(id) on delete restrict,
  source_collection_definition_version_id uuid not null references public.aba_collection_definition_versions_v3(id) on delete restrict,
  source_target_phase_assignment_id uuid not null references public.aba_target_phase_assignments_v3(id) on delete restrict,
  observed_opportunity_mode text not null check (observed_opportunity_mode in ('INDEPENDENT_ELIGIBLE','ERRORLESS_NO_INDEPENDENT')),
  universal_target_id uuid not null references public.clinical_measurement_targets_v3(id) on delete restrict,
  universal_definition_id uuid not null references public.clinical_measurement_definitions_v3(id) on delete restrict,
  universal_session_id uuid not null references public.clinical_measurement_sessions_v3(id) on delete restrict,
  universal_expectation_id uuid not null references public.clinical_measurement_session_expectations_v3(id) on delete restrict,
  universal_event_id uuid not null unique references public.clinical_measurement_raw_events_v3(id) on delete restrict,
  source_latest_revision_id uuid references public.aba_trial_revisions_v3(id) on delete restrict,
  source_latest_revision_at timestamptz,
  source_step_hash text not null check (source_step_hash ~ '^[0-9a-f]{64}$'),
  mirrored_at timestamptz not null default now(),
  unique (organization_id, universal_event_id)
);

create index if not exists idx_cmv3_shadow_mirror_target
  on public.clinical_measurement_shadow_mirror_links_v3
  (organization_id, patient_id, source_target_id, source_session_id);

create or replace function public.guard_clinical_measurement_shadow_mirror_link_v3()
returns trigger language plpgsql set search_path=pg_catalog,public as $f$
begin
  raise exception 'CMV3_SHADOW_MIRROR_LINK_APPEND_ONLY';
end;$f$;

drop trigger if exists guard_cmv3_shadow_mirror_link on public.clinical_measurement_shadow_mirror_links_v3;
create trigger guard_cmv3_shadow_mirror_link
before update or delete on public.clinical_measurement_shadow_mirror_links_v3
for each row execute function public.guard_clinical_measurement_shadow_mirror_link_v3();

alter table public.clinical_measurement_shadow_mirror_links_v3 enable row level security;
revoke all on table public.clinical_measurement_shadow_mirror_links_v3 from public,anon,authenticated;
grant all on table public.clinical_measurement_shadow_mirror_links_v3 to service_role;

-- Comparator segmentation must mean clinical phase, not "number of expectation
-- rows". Shadow expectations may be split by observed opportunity mode/observer
-- while still belonging to one source phase. This fixes a semantic bug in the
-- previous comparator without changing any canonical summary math.
create or replace function public.get_clinical_measurement_v3_shadow_comparison(
  p_organization_id uuid,
  p_patient_id uuid,
  p_target_id uuid,
  p_definition_id uuid,
  p_period_start date default (current_date - 90),
  p_period_end date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_aba_target_id text;
  v_semantic_family text;
  v_rows jsonb;
  v_compared integer;
  v_matches integer;
  v_mismatches integer;
  v_incomplete integer;
  v_multi_segment integer;
begin
  if p_organization_id is null or p_patient_id is null or p_target_id is null or p_definition_id is null then
    raise exception 'CMV3_SHADOW_SCOPE_REQUIRED';
  end if;
  if p_period_start is null or p_period_end is null or p_period_start > p_period_end or (p_period_end-p_period_start)>366 then
    raise exception 'CMV3_SHADOW_PERIOD_INVALID';
  end if;

  select t.aba_target_id into v_aba_target_id
  from public.clinical_measurement_targets_v3 t
  where t.id=p_target_id and t.organization_id=p_organization_id and t.patient_id=p_patient_id and t.source_kind='ABA_TARGET';
  if v_aba_target_id is null then raise exception 'CMV3_SHADOW_ABA_TARGET_REQUIRED'; end if;

  select d.semantic_family into v_semantic_family
  from public.clinical_measurement_definitions_v3 d
  where d.id=p_definition_id and d.organization_id=p_organization_id and d.patient_id=p_patient_id and d.target_id=p_target_id;
  if v_semantic_family is null then raise exception 'CMV3_SHADOW_DEFINITION_SCOPE_INVALID'; end if;
  if v_semantic_family<>'PROPORTION' then raise exception 'CMV3_SHADOW_ONLY_PROPORTION_SUPPORTED'; end if;

  with session_scope as (
    select s.id aba_session_id,coalesce(s.reference_date,s.started_at::date) session_date
    from public.aba_sessions s
    where s.patient_id=p_patient_id and s.clinic_id=p_organization_id::text
      and coalesce(s.reference_date,s.started_at::date) between p_period_start and p_period_end
  ), universal_v3 as (
    select cms.aba_session_id,
      count(distinct coalesce(
        nullif(snapshot.snapshot->>'source_target_phase_assignment_id',''),
        p.phase_epoch_id::text,
        'NO_PHASE'
      ))::integer segment_count,
      sum(p.numerator)::integer numerator,
      sum(p.denominator)::integer denominator
    from public.clinical_measurement_session_proportion_summaries_v3 p
    join public.clinical_measurement_sessions_v3 cms
      on cms.id=p.session_id and cms.organization_id=p.organization_id and cms.patient_id=p.patient_id
    join public.clinical_measurement_definition_versions_v3 dv
      on dv.id=p.definition_version_id and dv.organization_id=p.organization_id and dv.patient_id=p.patient_id and dv.target_id=p.target_id
    join public.clinical_measurement_session_expectations_v3 ex on ex.id=p.expectation_id
    join public.clinical_collection_protocol_snapshots_v3 snapshot on snapshot.id=ex.protocol_snapshot_id
    where p.organization_id=p_organization_id and p.patient_id=p_patient_id and p.target_id=p_target_id
      and dv.definition_id=p_definition_id and cms.source_kind='ABA_SESSION' and cms.aba_session_id is not null
      and p.clinical_date between p_period_start and p_period_end and p.projection_status='READY'
    group by cms.aba_session_id
  ), canonical_aba_v3 as (
    select a.session_id aba_session_id,count(distinct a.target_phase_assignment_id)::integer segment_count,
      sum(a.primary_independent_correct_count)::integer numerator,
      sum(a.eligible_independent_opportunity_count)::integer denominator
    from public.aba_session_target_summaries_v3 a join session_scope ss on ss.aba_session_id=a.session_id
    where a.organization_id=p_organization_id and a.patient_id=p_patient_id and a.target_id=v_aba_target_id
    group by a.session_id
  ), legacy_v2 as (
    select t.session_id aba_session_id,count(*)::integer trial_count,count(*) filter(where t.independent)::integer independent_count
    from public.aba_trials t join session_scope ss on ss.aba_session_id=t.session_id
    where t.patient_id=p_patient_id and t.clinic_id=p_organization_id::text and t.target_id=v_aba_target_id
    group by t.session_id
  ), rows as (
    select ss.aba_session_id,ss.session_date,
      coalesce(u.segment_count,0) universal_segment_count,u.numerator universal_numerator,u.denominator universal_denominator,
      coalesce(c.segment_count,0) canonical_aba_v3_segment_count,c.numerator canonical_aba_v3_numerator,c.denominator canonical_aba_v3_denominator,
      l.trial_count legacy_v2_trial_count,l.independent_count legacy_v2_independent_count,
      case
        when coalesce(u.segment_count,0)>1 or coalesce(c.segment_count,0)>1 then 'NOT_DIRECTLY_COMPARABLE_MULTI_SEGMENT'
        when u.aba_session_id is null and c.aba_session_id is null then 'NO_CANONICAL_DATA'
        when u.aba_session_id is null then 'MISSING_UNIVERSAL_V3'
        when c.aba_session_id is null then 'MISSING_CANONICAL_ABA_V3'
        when u.numerator=c.numerator and u.denominator=c.denominator then 'MATCH' else 'MISMATCH' end canonical_parity_status
    from session_scope ss
    left join universal_v3 u on u.aba_session_id=ss.aba_session_id
    left join canonical_aba_v3 c on c.aba_session_id=ss.aba_session_id
    left join legacy_v2 l on l.aba_session_id=ss.aba_session_id
    where u.aba_session_id is not null or c.aba_session_id is not null or l.aba_session_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'session_id',r.aba_session_id,'clinical_date',r.session_date,'canonical_parity_status',r.canonical_parity_status,
      'universal_v3',jsonb_build_object('segment_count',r.universal_segment_count,'numerator',r.universal_numerator,'denominator',r.universal_denominator,'percent',case when r.universal_denominator>0 then round(100.0*r.universal_numerator/r.universal_denominator,4) end),
      'canonical_aba_v3',jsonb_build_object('segment_count',r.canonical_aba_v3_segment_count,'numerator',r.canonical_aba_v3_numerator,'denominator',r.canonical_aba_v3_denominator,'percent',case when r.canonical_aba_v3_denominator>0 then round(100.0*r.canonical_aba_v3_numerator/r.canonical_aba_v3_denominator,4) end),
      'legacy_v2',jsonb_build_object('authority','OBSERVATIONAL_ONLY','trial_count',r.legacy_v2_trial_count,'independent_count',r.legacy_v2_independent_count,'percent',case when r.legacy_v2_trial_count>0 then round(100.0*r.legacy_v2_independent_count/r.legacy_v2_trial_count,4) end)
    ) order by r.session_date,r.aba_session_id),'[]'::jsonb),
    count(*) filter(where r.canonical_parity_status in ('MATCH','MISMATCH')),
    count(*) filter(where r.canonical_parity_status='MATCH'),
    count(*) filter(where r.canonical_parity_status='MISMATCH'),
    count(*) filter(where r.canonical_parity_status in ('MISSING_UNIVERSAL_V3','MISSING_CANONICAL_ABA_V3')),
    count(*) filter(where r.canonical_parity_status='NOT_DIRECTLY_COMPARABLE_MULTI_SEGMENT')
  into v_rows,v_compared,v_matches,v_mismatches,v_incomplete,v_multi_segment from rows r;

  return jsonb_build_object('organization_id',p_organization_id,'patient_id',p_patient_id,'target_id',p_target_id,
    'definition_id',p_definition_id,'semantic_family',v_semantic_family,'period_start',p_period_start,'period_end',p_period_end,
    'canonical_comparison',jsonb_build_object('authority','SHADOW_VALIDATION','compared_session_count',coalesce(v_compared,0),'match_count',coalesce(v_matches,0),'mismatch_count',coalesce(v_mismatches,0),'incomplete_count',coalesce(v_incomplete,0),'multi_segment_not_directly_comparable_count',coalesce(v_multi_segment,0),'parity_clean',coalesce(v_compared,0)>0 and coalesce(v_mismatches,0)=0 and coalesce(v_incomplete,0)=0 and coalesce(v_multi_segment,0)=0),
    'legacy_v2_policy','OBSERVATIONAL_ONLY_NOT_A_RELEASE_BLOCKER','rows',v_rows,'computed_at',clock_timestamp());
end;$function$;

create or replace function public.run_clinical_measurement_v3_aba_shadow_mirror(
  p_organization_id uuid,
  p_patient_id uuid,
  p_aba_target_id text,
  p_period_start date default (current_date-90),
  p_period_end date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
set row_security=off
as $function$
declare
  v_target_id uuid;
  v_definition_id uuid;
  v_definition_version_id uuid;
  v_activation_id uuid;
  v_source_definition_id uuid;
  v_source_definition_version integer;
  v_source_phase_id uuid;
  v_source_count integer;
  v_prompt_hierarchy_id uuid;
  v_prompt_version_id uuid;
  v_expectation_ids uuid[];
  v_compare jsonb;
  v_tz text;
begin
  if p_organization_id is null or p_patient_id is null or nullif(trim(p_aba_target_id),'') is null then raise exception 'CMV3_SHADOW_MIRROR_SCOPE_REQUIRED'; end if;
  if p_period_start is null or p_period_end is null or p_period_start>p_period_end or (p_period_end-p_period_start)>366 then raise exception 'CMV3_SHADOW_MIRROR_PERIOD_INVALID'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_patient_id::text||':'||p_aba_target_id,0));

  create temporary table cmv3_shadow_source on commit drop as
  select t.*, s.started_at session_started_at,s.ended_at session_ended_at,s.reference_date,s.therapist_id,
    coalesce(cm_collector.id,cm_session.id) actor_membership_id,
    coalesce(cm_collector.availability_timezone,cm_session.availability_timezone,'America/Sao_Paulo') actor_timezone,
    case when exists(select 1 from public.aba_trial_steps_v3 st where st.trial_id=t.id and st.opportunity_role='PRIMARY_INDEPENDENT') then 'INDEPENDENT_ELIGIBLE' else 'ERRORLESS_NO_INDEPENDENT' end observed_opportunity_mode,
    t.latest_revision_id source_latest_revision_id,t.latest_revision_at source_latest_revision_at
  from public.aba_effective_trials_v3 t
  join public.aba_sessions s on s.id=t.session_id and s.patient_id=t.patient_id and s.clinic_id=t.organization_id::text
  left join lateral (
    select cm.id,cm.availability_timezone from public.clinic_memberships cm
    where cm.clinic_id=t.organization_id and cm.user_id=t.collector_user_id and lower(coalesce(cm.status,''))='active'
    order by cm.created_at,cm.id limit 1
  ) cm_collector on true
  left join lateral (
    select cm.id,cm.availability_timezone from public.clinic_memberships cm
    where cm.clinic_id=t.organization_id
      and s.therapist_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and cm.user_id=s.therapist_id::uuid and lower(coalesce(cm.status,''))='active'
    order by cm.created_at,cm.id limit 1
  ) cm_session on true
  where t.organization_id=p_organization_id and t.patient_id=p_patient_id and t.target_id=p_aba_target_id
    and coalesce(s.reference_date,s.started_at::date) between p_period_start and p_period_end
    and s.status='completed' and s.ended_at is not null and t.trial_type<>'TASK_ANALYSIS';

  select count(*) into v_source_count from cmv3_shadow_source;
  if v_source_count=0 then raise exception 'CMV3_SHADOW_MIRROR_NO_EFFECTIVE_COMPLETED_TRIALS'; end if;
  if v_source_count>500 then raise exception 'CMV3_SHADOW_MIRROR_LIMIT_EXCEEDED'; end if;
  if exists(select 1 from cmv3_shadow_source where actor_membership_id is null) then raise exception 'CMV3_SHADOW_MIRROR_ACTOR_UNRESOLVED'; end if;
  if (select count(distinct collection_definition_version_id) from cmv3_shadow_source)<>1 then raise exception 'CMV3_SHADOW_MIRROR_MULTIPLE_DEFINITION_VERSIONS_UNSUPPORTED'; end if;
  if (select count(distinct target_phase_assignment_id) from cmv3_shadow_source)<>1 then raise exception 'CMV3_SHADOW_MIRROR_MULTIPLE_PHASES_NOT_DIRECTLY_COMPARABLE'; end if;
  if exists(select 1 from cmv3_shadow_source where occurred_at<session_started_at or occurred_at>session_ended_at) then raise exception 'CMV3_SHADOW_MIRROR_TRIAL_OUTSIDE_SESSION'; end if;
  if exists(select 1 from cmv3_shadow_source where reference_date is not null and timezone(actor_timezone,session_started_at)::date<>reference_date) then raise exception 'CMV3_SHADOW_MIRROR_CLINICAL_DATE_TIMEZONE_UNRESOLVED'; end if;
  if exists(select 1 from public.aba_trial_steps_v3 st join cmv3_shadow_source src on src.id=st.trial_id where st.step_type='OTHER' or (st.step_type='PROMPT' and nullif(trim(st.prompt_key),'') is null)) then raise exception 'CMV3_SHADOW_MIRROR_UNSUPPORTED_STEP_SHAPE'; end if;
  if exists(
    select 1 from cmv3_shadow_source src
    left join public.aba_trial_steps_v3 first_step on first_step.trial_id=src.id and first_step.sequence_no=1
    left join public.aba_trial_steps_v3 primary_step on primary_step.trial_id=src.id and primary_step.opportunity_role='PRIMARY_INDEPENDENT'
    where (src.observed_opportunity_mode='INDEPENDENT_ELIGIBLE' and (primary_step.sequence_no is distinct from 1 or first_step.step_type is distinct from 'RESPONSE'))
       or (src.observed_opportunity_mode='ERRORLESS_NO_INDEPENDENT' and first_step.step_type='RESPONSE')
  ) then raise exception 'CMV3_SHADOW_MIRROR_STEP_ORDER_CANNOT_PRESERVE_OPPORTUNITY_ROLE'; end if;

  select collection_definition_version_id,target_phase_assignment_id into v_source_definition_id,v_source_phase_id from cmv3_shadow_source limit 1;
  select version into v_source_definition_version from public.aba_collection_definition_versions_v3 where id=v_source_definition_id;

  select id into v_target_id from public.clinical_measurement_targets_v3
   where organization_id=p_organization_id and patient_id=p_patient_id and source_kind='ABA_TARGET' and aba_target_id=p_aba_target_id;
  if v_target_id is null then
    insert into public.clinical_measurement_targets_v3(organization_id,patient_id,target_key,source_kind,aba_target_id,status,created_by)
    select p_organization_id,p_patient_id,left('shadow:aba-v3:'||t.id,180),'ABA_TARGET',t.id,'PAUSED','CMV3_SHADOW_MIRROR'
    from public.aba_targets t where t.id=p_aba_target_id and t.patient_id=p_patient_id and t.clinic_id=p_organization_id::text
    returning id into v_target_id;
  end if;
  if v_target_id is null then raise exception 'CMV3_SHADOW_MIRROR_TARGET_SCOPE_INVALID'; end if;

  select id into v_definition_id from public.clinical_measurement_definitions_v3
   where target_id=v_target_id and definition_key='shadow_aba_v3_primary_independence';
  if v_definition_id is null then
    insert into public.clinical_measurement_definitions_v3(organization_id,patient_id,target_id,definition_key,semantic_family,status,archived_at,created_by)
    values(p_organization_id,p_patient_id,v_target_id,'shadow_aba_v3_primary_independence','PROPORTION','ARCHIVED',clock_timestamp(),'CMV3_SHADOW_MIRROR') returning id into v_definition_id;
  end if;

  select id into v_definition_version_id from public.clinical_measurement_definition_versions_v3
   where definition_id=v_definition_id and (content->>'source_collection_definition_version_id')=v_source_definition_id::text limit 1;
  if v_definition_version_id is null then
    insert into public.clinical_measurement_definition_versions_v3(organization_id,patient_id,target_id,definition_id,version,unit_code,unit_label,directionality,content,aggregation_policy,definition_hash,status,published_at,deprecated_at,created_by)
    values(p_organization_id,p_patient_id,v_target_id,v_definition_id,v_source_definition_version,'PERCENT','% Independência','INCREASE_IS_BETTER',
      jsonb_build_object('kind','PROPORTION','shadow_mirror',true,'source_engine','ABA_V3','source_collection_definition_version_id',v_source_definition_id,'semantic_basis','EXPLICIT_STEP_OPPORTUNITY_ROLE_CURRENT_TRUTH'),
      jsonb_build_object('across_sessions','FORBIDDEN','across_phases','FORBIDDEN'),repeat('0',64),'ARCHIVED',clock_timestamp(),clock_timestamp(),'CMV3_SHADOW_MIRROR')
    returning id into v_definition_version_id;
  end if;

  select id into v_activation_id from public.clinical_measurement_definition_activations_v3
   where definition_id=v_definition_id and definition_version_id=v_definition_version_id and reason='CMV3_SHADOW_MIRROR' and superseded_at is null limit 1;
  if v_activation_id is null then
    insert into public.clinical_measurement_definition_activations_v3(organization_id,patient_id,target_id,definition_id,definition_version_id,effective_from,activation_mode,reason,created_by)
    values(p_organization_id,p_patient_id,v_target_id,v_definition_id,v_definition_version_id,clock_timestamp(),'PROSPECTIVE','CMV3_SHADOW_MIRROR','CMV3_SHADOW_MIRROR') returning id into v_activation_id;
  end if;

  -- Optional categorical prompt hierarchy derived only from effective raw prompt keys.
  if exists(select 1 from public.aba_trial_steps_v3 st join cmv3_shadow_source src on src.id=st.trial_id where st.prompt_key is not null) then
    select id into v_prompt_hierarchy_id from public.clinical_aba_prompt_hierarchies_v3 where definition_id=v_definition_id and hierarchy_key='shadow_aba_v3_prompts';
    if v_prompt_hierarchy_id is null then
      insert into public.clinical_aba_prompt_hierarchies_v3(organization_id,patient_id,target_id,definition_id,hierarchy_key,created_by)
      values(p_organization_id,p_patient_id,v_target_id,v_definition_id,'shadow_aba_v3_prompts','CMV3_SHADOW_MIRROR') returning id into v_prompt_hierarchy_id;
    end if;
    select id into v_prompt_version_id from public.clinical_aba_prompt_hierarchy_versions_v3 where hierarchy_id=v_prompt_hierarchy_id and version=1 and status='PUBLISHED';
    if v_prompt_version_id is null then
      insert into public.clinical_aba_prompt_hierarchy_versions_v3(organization_id,patient_id,target_id,definition_id,hierarchy_id,version,strategy,status,created_by)
      values(p_organization_id,p_patient_id,v_target_id,v_definition_id,v_prompt_hierarchy_id,1,'CUSTOM','DRAFT','CMV3_SHADOW_MIRROR') returning id into v_prompt_version_id;
      insert into public.clinical_aba_prompt_hierarchy_levels_v3(organization_id,patient_id,target_id,definition_id,hierarchy_version_id,sequence_no,prompt_key,label,category,is_independent)
      values(p_organization_id,p_patient_id,v_target_id,v_definition_id,v_prompt_version_id,1,'__INDEPENDENT__','Independente','INDEPENDENT',true);
      insert into public.clinical_aba_prompt_hierarchy_levels_v3(organization_id,patient_id,target_id,definition_id,hierarchy_version_id,sequence_no,prompt_key,label,category,is_independent,legacy_prompt_type_id)
      select p_organization_id,p_patient_id,v_target_id,v_definition_id,v_prompt_version_id,
        row_number() over(order by coalesce(pt.intrusiveness_order,9999),st.prompt_key)::integer+1,
        st.prompt_key,coalesce(pt.name,st.prompt_key),coalesce(pt.category,'SHADOW_SOURCE'),false,pt.id
      from (select distinct s.prompt_key from public.aba_trial_steps_v3 s join cmv3_shadow_source src on src.id=s.trial_id where s.prompt_key is not null) st
      left join lateral (
        select p.id,p.name,p.category,p.intrusiveness_order from public.aba_prompt_types p
        where p.organization_id=p_organization_id and p.key=st.prompt_key
        order by p.active desc,p.updated_at desc,p.id limit 1
      ) pt on true;
      perform public.publish_clinical_aba_prompt_hierarchy_version_v3(v_prompt_version_id);
    end if;
  end if;

  create temporary table cmv3_shadow_protocol_map on commit drop as
  select distinct observed_opportunity_mode,actor_membership_id from cmv3_shadow_source;
  alter table cmv3_shadow_protocol_map add column protocol_snapshot_id uuid;

  -- Reuse any prior identical shadow snapshot; insert only missing groups.
  update cmv3_shadow_protocol_map m set protocol_snapshot_id=sp.id
  from public.clinical_collection_protocol_snapshots_v3 sp
  where sp.organization_id=p_organization_id and sp.patient_id=p_patient_id and sp.target_id=v_target_id
    and sp.definition_version_id=v_definition_version_id
    and sp.snapshot->>'shadow_mirror'='true'
    and sp.snapshot->>'source_collection_definition_version_id'=v_source_definition_id::text
    and sp.snapshot->>'source_target_phase_assignment_id'=v_source_phase_id::text
    and sp.snapshot->>'observed_opportunity_mode'=m.observed_opportunity_mode
    and sp.snapshot->>'observer_membership_id'=m.actor_membership_id::text;

  insert into public.clinical_collection_protocol_snapshots_v3(organization_id,patient_id,target_id,definition_activation_id,definition_version_id,snapshot,snapshot_hash,created_by)
  select p_organization_id,p_patient_id,v_target_id,v_activation_id,v_definition_version_id,
    jsonb_build_object('shadow_mirror',true,'source_engine','ABA_V3','source_collection_definition_version_id',v_source_definition_id,
      'source_target_phase_assignment_id',v_source_phase_id,'observed_opportunity_mode',m.observed_opportunity_mode,
      'observer_membership_id',m.actor_membership_id,'semantic_basis','EXPLICIT_STEP_OPPORTUNITY_ROLE_CURRENT_TRUTH','historical_protocol_intent_inferred',false),
    repeat('0',64),'CMV3_SHADOW_MIRROR'
  from cmv3_shadow_protocol_map m where m.protocol_snapshot_id is null;

  update cmv3_shadow_protocol_map m set protocol_snapshot_id=sp.id
  from public.clinical_collection_protocol_snapshots_v3 sp
  where m.protocol_snapshot_id is null and sp.organization_id=p_organization_id and sp.patient_id=p_patient_id and sp.target_id=v_target_id
    and sp.definition_version_id=v_definition_version_id and sp.snapshot->>'shadow_mirror'='true'
    and sp.snapshot->>'source_collection_definition_version_id'=v_source_definition_id::text
    and sp.snapshot->>'source_target_phase_assignment_id'=v_source_phase_id::text
    and sp.snapshot->>'observed_opportunity_mode'=m.observed_opportunity_mode and sp.snapshot->>'observer_membership_id'=m.actor_membership_id::text;

  insert into public.clinical_aba_protocol_bindings_v3(protocol_snapshot_id,organization_id,patient_id,target_id,definition_version_id,prompt_hierarchy_version_id,initial_opportunity_mode)
  select protocol_snapshot_id,p_organization_id,p_patient_id,v_target_id,v_definition_version_id,v_prompt_version_id,observed_opportunity_mode
  from cmv3_shadow_protocol_map on conflict(protocol_snapshot_id) do nothing;

  -- Sessions remain hidden shadow identities. Their clinical date is server-derived
  -- from the observer timezone and was preflighted against legacy reference_date.
  insert into public.clinical_measurement_sessions_v3(organization_id,patient_id,session_key,source_kind,aba_session_id,status,started_at,clinical_date,timezone_snapshot,timezone_offset_minutes,created_by)
  select distinct p_organization_id,p_patient_id,left('shadow:aba-v3:'||src.session_id,180),'ABA_SESSION',src.session_id,'PREPARING',src.session_started_at,
    coalesce(src.reference_date,timezone(src.actor_timezone,src.session_started_at)::date),src.actor_timezone,0,'CMV3_SHADOW_MIRROR'
  from cmv3_shadow_source src
  where not exists(select 1 from public.clinical_measurement_sessions_v3 s where s.organization_id=p_organization_id and s.aba_session_id=src.session_id);

  insert into public.clinical_measurement_session_expectations_v3(organization_id,patient_id,session_id,target_id,protocol_snapshot_id,expectation_key,created_by)
  select distinct p_organization_id,p_patient_id,s.id,v_target_id,m.protocol_snapshot_id,
    left('shadow:'||src.observed_opportunity_mode||':'||src.actor_membership_id::text,180),'CMV3_SHADOW_MIRROR'
  from cmv3_shadow_source src
  join public.clinical_measurement_sessions_v3 s on s.organization_id=p_organization_id and s.aba_session_id=src.session_id
  join cmv3_shadow_protocol_map m on m.observed_opportunity_mode=src.observed_opportunity_mode and m.actor_membership_id=src.actor_membership_id
  where s.status='PREPARING'
    and not exists(select 1 from public.clinical_measurement_session_expectations_v3 e where e.session_id=s.id and e.protocol_snapshot_id=m.protocol_snapshot_id);

  update public.clinical_measurement_sessions_v3 s set status='OPEN'
  where s.organization_id=p_organization_id and s.patient_id=p_patient_id and s.status='PREPARING'
    and s.aba_session_id in (select distinct session_id from cmv3_shadow_source);

  insert into public.clinical_measurement_collection_streams_v3(organization_id,patient_id,session_id,expectation_id,target_id,stream_key,stream_role,observer_membership_id,status,created_by)
  select p_organization_id,p_patient_id,e.session_id,e.id,v_target_id,'shadow-primary','PRIMARY',src.actor_membership_id,'OPEN','CMV3_SHADOW_MIRROR'
  from (select distinct session_id,observed_opportunity_mode,actor_membership_id from cmv3_shadow_source) src
  join public.clinical_measurement_sessions_v3 s on s.organization_id=p_organization_id and s.aba_session_id=src.session_id
  join cmv3_shadow_protocol_map m on m.observed_opportunity_mode=src.observed_opportunity_mode and m.actor_membership_id=src.actor_membership_id
  join public.clinical_measurement_session_expectations_v3 e on e.session_id=s.id and e.protocol_snapshot_id=m.protocol_snapshot_id
  where not exists(select 1 from public.clinical_measurement_collection_streams_v3 st where st.expectation_id=e.id and st.stream_role='PRIMARY');

  insert into public.clinical_measurement_raw_events_v3(stream_id,client_event_id,event_kind,ingestion_mode,occurred_at_utc,actor_membership_id,payload_hash)
  select st.id,'shadow:aba-v3:'||src.id::text,'FACT','SHADOW_MIRROR',src.occurred_at,src.actor_membership_id,
    encode(digest(convert_to(jsonb_build_object('source_trial_id',src.id,'payload_hash',src.payload_hash,'mode',src.observed_opportunity_mode)::text,'UTF8'),'sha256'),'hex')
  from cmv3_shadow_source src
  join public.clinical_measurement_sessions_v3 s on s.organization_id=p_organization_id and s.aba_session_id=src.session_id
  join cmv3_shadow_protocol_map m on m.observed_opportunity_mode=src.observed_opportunity_mode and m.actor_membership_id=src.actor_membership_id
  join public.clinical_measurement_session_expectations_v3 e on e.session_id=s.id and e.protocol_snapshot_id=m.protocol_snapshot_id
  join public.clinical_measurement_collection_streams_v3 st on st.expectation_id=e.id and st.stream_role='PRIMARY'
  where not exists(select 1 from public.clinical_measurement_raw_events_v3 re where re.organization_id=p_organization_id and re.client_event_id='shadow:aba-v3:'||src.id::text);

  insert into public.clinical_measurement_aba_trials_v3(event_id,organization_id,patient_id,session_id,expectation_id,target_id,stream_id,protocol_snapshot_id,definition_version_id,trial_type,started_at,completed_at,created_at)
  select re.id,re.organization_id,re.patient_id,re.session_id,re.expectation_id,re.target_id,re.stream_id,re.protocol_snapshot_id,re.definition_version_id,src.trial_type,src.started_at,src.completed_at,re.recorded_at
  from cmv3_shadow_source src join public.clinical_measurement_raw_events_v3 re on re.organization_id=p_organization_id and re.client_event_id='shadow:aba-v3:'||src.id::text
  where not exists(select 1 from public.clinical_measurement_aba_trials_v3 t where t.event_id=re.id);

  -- RESPONSE steps map 1:1. Non-response legacy steps carry an outcome in the old
  -- schema, so the mirror expands them into action + SUPPORT response; this
  -- preserves final outcome without manufacturing an independent opportunity.
  insert into public.clinical_measurement_aba_trial_steps_v3(trial_event_id,sequence_no,client_step_id,step_kind,outcome,prompt_level_id,latency_ms,occurred_at)
  select re.id,st.sequence_no*2-1,'shadow:'||st.id::text||':a',st.step_type,
    case when st.step_type='RESPONSE' then st.outcome else null end,
    case when st.step_type='PROMPT' then pl.id else null end,
    st.latency_ms,coalesce(st.occurred_at,src.occurred_at)
  from public.aba_trial_steps_v3 st
  join cmv3_shadow_source src on src.id=st.trial_id
  join public.clinical_measurement_raw_events_v3 re on re.organization_id=p_organization_id and re.client_event_id='shadow:aba-v3:'||src.id::text
  left join public.clinical_aba_prompt_hierarchy_levels_v3 pl on pl.hierarchy_version_id=v_prompt_version_id and pl.prompt_key=st.prompt_key
  where not exists(select 1 from public.clinical_measurement_aba_trial_steps_v3 x where x.trial_event_id=re.id and x.client_step_id='shadow:'||st.id::text||':a');

  insert into public.clinical_measurement_aba_trial_steps_v3(trial_event_id,sequence_no,client_step_id,step_kind,outcome,latency_ms,occurred_at)
  select re.id,st.sequence_no*2,'shadow:'||st.id::text||':r','RESPONSE',st.outcome,null,coalesce(st.occurred_at,src.occurred_at)
  from public.aba_trial_steps_v3 st
  join cmv3_shadow_source src on src.id=st.trial_id
  join public.clinical_measurement_raw_events_v3 re on re.organization_id=p_organization_id and re.client_event_id='shadow:aba-v3:'||src.id::text
  where st.step_type<>'RESPONSE' and st.outcome is not null
    and not exists(select 1 from public.clinical_measurement_aba_trial_steps_v3 x where x.trial_event_id=re.id and x.client_step_id='shadow:'||st.id::text||':r');

  insert into public.clinical_measurement_shadow_mirror_links_v3(source_trial_id,organization_id,patient_id,source_session_id,source_target_id,source_collection_definition_version_id,source_target_phase_assignment_id,observed_opportunity_mode,universal_target_id,universal_definition_id,universal_session_id,universal_expectation_id,universal_event_id,source_latest_revision_id,source_latest_revision_at,source_step_hash)
  select src.id,p_organization_id,p_patient_id,src.session_id,p_aba_target_id,src.collection_definition_version_id,src.target_phase_assignment_id,src.observed_opportunity_mode,v_target_id,v_definition_id,re.session_id,re.expectation_id,re.id,src.source_latest_revision_id,src.source_latest_revision_at,
    encode(digest(convert_to(coalesce((select jsonb_agg(jsonb_build_object('sequence_no',st.sequence_no,'step_type',st.step_type,'opportunity_role',st.opportunity_role,'outcome',st.outcome,'prompt_key',st.prompt_key) order by st.sequence_no) from public.aba_trial_steps_v3 st where st.trial_id=src.id),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex')
  from cmv3_shadow_source src join public.clinical_measurement_raw_events_v3 re on re.organization_id=p_organization_id and re.client_event_id='shadow:aba-v3:'||src.id::text
  where not exists(select 1 from public.clinical_measurement_shadow_mirror_links_v3 l where l.source_trial_id=src.id);

  update public.clinical_measurement_collection_streams_v3 st set status='CLOSED'
  where st.organization_id=p_organization_id and st.status='OPEN' and st.expectation_id in (
    select e.id from public.clinical_measurement_session_expectations_v3 e join public.clinical_measurement_sessions_v3 s on s.id=e.session_id
    where s.aba_session_id in(select distinct session_id from cmv3_shadow_source) and e.target_id=v_target_id
  );

  update public.clinical_measurement_sessions_v3 s set status='FINALIZED',ended_at=src.ended_at
  from (select session_id,max(session_ended_at) ended_at from cmv3_shadow_source group by session_id) src
  where s.organization_id=p_organization_id and s.aba_session_id=src.session_id and s.status='OPEN';

  select array_agg(e.id) into v_expectation_ids
  from public.clinical_measurement_session_expectations_v3 e join public.clinical_measurement_sessions_v3 s on s.id=e.session_id
  where s.organization_id=p_organization_id and s.patient_id=p_patient_id and s.aba_session_id in(select distinct session_id from cmv3_shadow_source)
    and e.target_id=v_target_id;
  perform public.recompute_clinical_measurement_projection_batch_v3(v_expectation_ids,'SHADOW_MIRROR');

  v_compare:=public.get_clinical_measurement_v3_shadow_comparison(p_organization_id,p_patient_id,v_target_id,v_definition_id,p_period_start,p_period_end);
  if coalesce((v_compare#>>'{canonical_comparison,parity_clean}')::boolean,false) is not true then
    raise exception 'CMV3_SHADOW_MIRROR_PARITY_FAILED: %',left(v_compare::text,3000);
  end if;

  return jsonb_build_object('gate','PASS','source_engine','ABA_V3_EFFECTIVE_RAW','source_trial_count',v_source_count,
    'universal_target_id',v_target_id,'universal_definition_id',v_definition_id,'expectation_count',coalesce(array_length(v_expectation_ids,1),0),
    'comparison',v_compare,'mirrored_at',clock_timestamp());
end;$function$;

revoke all on function public.run_clinical_measurement_v3_aba_shadow_mirror(uuid,uuid,text,date,date) from public,anon,authenticated;
grant execute on function public.run_clinical_measurement_v3_aba_shadow_mirror(uuid,uuid,text,date,date) to service_role;
revoke all on function public.guard_clinical_measurement_shadow_mirror_link_v3() from public,anon,authenticated;


-- ===========================================================================
-- Embedded canonical block 12/12: 20260821002000_clinical_measurement_v3_projection_task_analysis_groupby_hotfix.sql
-- ===========================================================================
-- Verto Clinical Measurement Engine V3
-- Hotfix: TASK_ANALYSIS projection recompute must group phase_version_id because
-- clinical_measurement_projection_scope_v3 exposes it via scope.*.
-- Additive/idempotent function replacement only; no raw data or legacy tables are changed.


create or replace function public.recompute_clinical_measurement_projection_batch_v3(
  p_expectation_ids uuid[],
  p_revision_hint text default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_count integer := 0;
begin
  if coalesce(array_length(p_expectation_ids,1),0) = 0 then return 0; end if;
  if array_length(p_expectation_ids,1) > 250 then raise exception 'CMV3_PROJECTION_BATCH_TOO_LARGE'; end if;

  -- Projection cache is disposable. Clear only the affected expectation grains.
  delete from public.clinical_measurement_session_category_breakdown_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_interval_breakdown_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_prompt_distribution_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_task_step_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_count_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_rate_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_proportion_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_temporal_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_continuous_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_interval_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_ordinal_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_categorical_summaries_v3 where expectation_id=any(p_expectation_ids);
  delete from public.clinical_measurement_session_task_analysis_summaries_v3 where expectation_id=any(p_expectation_ids);

  -- COUNT.
  insert into public.clinical_measurement_session_count_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         coalesce(sum(f.count_delta),0)::bigint,
         count(distinct e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_count_facts_v3 f on f.event_id=e.id and f.semantic_family='COUNT'
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='COUNT'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  -- RATE: zero events + valid slice is a legitimate zero rate.
  insert into public.clinical_measurement_session_rate_summaries_v3
  with agg as (
    select scope.*,
      coalesce((select sum(f.count_delta)::bigint from public.clinical_measurement_effective_primary_events_v3 e
                join public.clinical_measurement_count_facts_v3 f on f.event_id=e.id and f.semantic_family='RATE'
                where e.expectation_id=scope.expectation_id),0) event_count,
      coalesce((select sum(floor(extract(epoch from (s.ended_at-s.started_at))*1000.0))::bigint
                from public.clinical_measurement_effective_primary_events_v3 e
                join public.clinical_measurement_observation_slices_v3 s on s.event_id=e.id
                where e.expectation_id=scope.expectation_id),0) observation_ms,
      (select count(*)::integer from public.clinical_measurement_effective_primary_events_v3 e where e.expectation_id=scope.expectation_id) src_count,
      (select max(e.occurred_at_utc) from public.clinical_measurement_effective_primary_events_v3 e where e.expectation_id=scope.expectation_id) src_occ,
      (select max(e.recorded_at) from public.clinical_measurement_effective_primary_events_v3 e where e.expectation_id=scope.expectation_id) src_rec
    from public.clinical_measurement_projection_scope_v3 scope
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='RATE'
  )
  select expectation_id,organization_id,patient_id,session_id,target_id,definition_version_id,phase_epoch_id,
         clinical_date,session_status,public.cmv3_projection_coverage_status(expectation_id,session_status),
         event_count,observation_ms,
         case when observation_ms>0 then (event_count::numeric*3600000::numeric)/observation_ms::numeric else null end,
         src_count,src_occ,src_rec,clock_timestamp()
  from agg;

  -- PROPORTION: ABA trials have fixed server semantics. Generic category-based
  -- proportions are computed only when the version explicitly declares both
  -- numerator_category_keys and denominator_category_keys.
  insert into public.clinical_measurement_session_proportion_summaries_v3
  with aba as (
    select scope.expectation_id,
      count(distinct trial.event_id) filter (where step.opportunity_role='PRIMARY_INDEPENDENT')::integer denominator,
      count(distinct trial.event_id) filter (where step.opportunity_role='PRIMARY_INDEPENDENT' and step.outcome='CORRECT')::integer numerator,
      (count(distinct trial.event_id)
       - count(distinct trial.event_id) filter (where step.opportunity_role='PRIMARY_INDEPENDENT'))::integer no_opp,
      count(distinct trial.event_id)::integer trial_count
    from public.clinical_measurement_projection_scope_v3 scope
    join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
    join public.clinical_measurement_aba_trials_v3 trial on trial.event_id=e.id
    left join public.clinical_measurement_aba_trial_steps_v3 step on step.trial_event_id=trial.event_id
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='PROPORTION'
    group by scope.expectation_id
  ), categories as (
    select scope.expectation_id,
      count(*) filter (where f.category_key in (
        select jsonb_array_elements_text(scope.definition_content #> '{proportion,numerator_category_keys}')
      ))::integer numerator,
      count(*) filter (where f.category_key in (
        select jsonb_array_elements_text(scope.definition_content #> '{proportion,denominator_category_keys}')
      ))::integer denominator,
      count(*)::integer category_count,
      (jsonb_typeof(scope.definition_content #> '{proportion,numerator_category_keys}')='array'
       and jsonb_typeof(scope.definition_content #> '{proportion,denominator_category_keys}')='array'
       and (scope.definition_content #> '{proportion,denominator_category_keys}') @> (scope.definition_content #> '{proportion,numerator_category_keys}')) config_ready
    from public.clinical_measurement_projection_scope_v3 scope
    join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
    join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='PROPORTION'
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='PROPORTION'
    group by scope.expectation_id,scope.definition_content
  ), source_meta as (
    select scope.expectation_id,count(e.id)::integer src_count,max(e.occurred_at_utc) src_occ,max(e.recorded_at) src_rec
    from public.clinical_measurement_projection_scope_v3 scope
    left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='PROPORTION'
    group by scope.expectation_id
  )
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then 'INVALID_MIXED_SOURCE'
           when coalesce(aba.trial_count,0)>0 or coalesce(categories.config_ready,false) then 'READY'
           else 'SEMANTIC_CONFIG_REQUIRED' end,
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then 'MIXED'
           when coalesce(aba.trial_count,0)>0 then 'ABA_TRIAL'
           when coalesce(categories.category_count,0)>0 then 'CATEGORY' else 'NONE' end,
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then null
           when coalesce(aba.trial_count,0)>0 then aba.numerator
           when coalesce(categories.config_ready,false) then categories.numerator else null end,
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then null
           when coalesce(aba.trial_count,0)>0 then aba.denominator
           when coalesce(categories.config_ready,false) then categories.denominator else null end,
         case
           when coalesce(aba.trial_count,0)>0 and coalesce(categories.category_count,0)>0 then null
           when coalesce(aba.trial_count,0)>0 and aba.denominator>0 then (aba.numerator::numeric*100)/aba.denominator
           when coalesce(aba.trial_count,0)=0 and coalesce(categories.config_ready,false) and categories.denominator>0 then (categories.numerator::numeric*100)/categories.denominator
           else null end,
         coalesce(aba.no_opp,0),meta.src_count,meta.src_occ,meta.src_rec,clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join aba on aba.expectation_id=scope.expectation_id
  left join categories on categories.expectation_id=scope.expectation_id
  join source_meta meta on meta.expectation_id=scope.expectation_id
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='PROPORTION';

  insert into public.clinical_measurement_session_category_breakdown_v3(expectation_id,category_domain,category_key,occurrence_count)
  select e.expectation_id,'PROPORTION',f.category_key,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='PROPORTION'
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,f.category_key;

  insert into public.clinical_measurement_session_prompt_distribution_v3(expectation_id,source_kind,prompt_level_id,occurrence_count)
  select e.expectation_id,'ABA_TRIAL',step.prompt_level_id,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_aba_trials_v3 trial on trial.event_id=e.id
  join public.clinical_measurement_aba_trial_steps_v3 step on step.trial_event_id=trial.event_id
  where e.expectation_id=any(p_expectation_ids) and step.prompt_level_id is not null
  group by e.expectation_id,step.prompt_level_id;

  -- DURATION / LATENCY / IRT remain temporal, never coerced to score.
  insert into public.clinical_measurement_session_temporal_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.semantic_family,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,count(f.event_id) filter(where f.is_censored)::integer,
         coalesce(sum(f.duration_ms),0)::bigint,avg(f.duration_ms)::numeric,min(f.duration_ms),max(f.duration_ms),
         count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_interval_facts_v3 f on f.event_id=e.id
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family in ('DURATION','LATENCY','IRT')
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.semantic_family,scope.clinical_date,scope.session_status;

  -- CONTINUOUS.
  insert into public.clinical_measurement_session_continuous_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,avg(f.numeric_value),min(f.numeric_value),max(f.numeric_value),
         (array_agg(f.numeric_value order by e.occurred_at_utc desc,e.id desc) filter(where f.event_id is not null))[1],
         count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_scalar_facts_v3 f on f.event_id=e.id
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='CONTINUOUS'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  -- INTERVAL + relational response breakdown.
  insert into public.clinical_measurement_session_interval_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_interval_samples_v3 f on f.event_id=e.id
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='INTERVAL'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  insert into public.clinical_measurement_session_interval_breakdown_v3(expectation_id,response_key,occurrence_count)
  select e.expectation_id,f.response_key,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_interval_samples_v3 f on f.event_id=e.id
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,f.response_key;

  -- ORDINAL: order is preserved as category identity; no mean/percent is invented.
  insert into public.clinical_measurement_session_ordinal_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,
         (array_agg(f.category_key order by e.occurred_at_utc desc,e.id desc) filter(where f.event_id is not null))[1],
         count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='ORDINAL'
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='ORDINAL'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  insert into public.clinical_measurement_session_category_breakdown_v3(expectation_id,category_domain,category_key,occurrence_count)
  select e.expectation_id,'ORDINAL',f.category_key,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='ORDINAL'
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,f.category_key;

  -- CATEGORICAL.
  insert into public.clinical_measurement_session_categorical_summaries_v3
  select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
         scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
         public.cmv3_projection_coverage_status(scope.expectation_id,scope.session_status),
         count(f.event_id)::integer,count(e.id)::integer,max(e.occurred_at_utc),max(e.recorded_at),clock_timestamp()
  from public.clinical_measurement_projection_scope_v3 scope
  left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
  left join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='CATEGORICAL'
  where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='CATEGORICAL'
  group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
           scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status;

  insert into public.clinical_measurement_session_category_breakdown_v3(expectation_id,category_domain,category_key,occurrence_count)
  select e.expectation_id,'CATEGORICAL',f.category_key,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_category_facts_v3 f on f.event_id=e.id and f.semantic_family='CATEGORICAL'
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,f.category_key;

  -- TASK ANALYSIS: acquisition and maintenance denominators remain separate.
  insert into public.clinical_measurement_session_task_analysis_summaries_v3
  with agg as (
    select scope.*,
      count(distinct run.event_id)::integer run_count,
      count(result.id) filter(where result.eligibility='ACQUISITION')::integer acq_n,
      count(result.id) filter(where result.eligibility='ACQUISITION' and result.performance_code='INDEPENDENT')::integer acq_i,
      count(result.id) filter(where result.eligibility='MAINTENANCE')::integer maint_n,
      count(result.id) filter(where result.eligibility='MAINTENANCE' and result.performance_code='INDEPENDENT')::integer maint_i,
      count(result.id) filter(where result.eligibility='TRAINER_COMPLETED')::integer trainer_n,
      count(result.id) filter(where result.eligibility='NOT_ELIGIBLE')::integer not_eligible_n,
      count(distinct e.id)::integer src_count,max(e.occurred_at_utc) src_occ,max(e.recorded_at) src_rec
    from public.clinical_measurement_projection_scope_v3 scope
    left join public.clinical_measurement_effective_primary_events_v3 e on e.expectation_id=scope.expectation_id
    left join public.clinical_measurement_aba_task_runs_v3 run on run.event_id=e.id
    left join public.clinical_measurement_aba_task_step_results_v3 result on result.run_event_id=run.event_id
    where scope.expectation_id=any(p_expectation_ids) and scope.semantic_family='TASK_ANALYSIS'
    group by scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,
             scope.definition_version_id,scope.phase_epoch_id,scope.clinical_date,scope.session_status,
             scope.protocol_snapshot_id,scope.phase_version_id,scope.semantic_family,scope.unit_code,scope.unit_label,scope.directionality,
             scope.definition_content,scope.aggregation_policy,scope.session_started_at,scope.session_ended_at,
             scope.finalized_at,scope.primary_stream_id
  )
  select expectation_id,organization_id,patient_id,session_id,target_id,definition_version_id,phase_epoch_id,
         clinical_date,session_status,public.cmv3_projection_coverage_status(expectation_id,session_status),
         run_count,acq_n,acq_i,maint_n,maint_i,trainer_n,not_eligible_n,
         case when acq_n>0 then acq_i::numeric*100/acq_n else null end,
         case when maint_n>0 then maint_i::numeric*100/maint_n else null end,
         src_count,src_occ,src_rec,clock_timestamp()
  from agg;

  insert into public.clinical_measurement_session_task_step_summaries_v3(
    expectation_id,step_definition_id,sequence_no,acquisition_observation_count,acquisition_independent_count,
    maintenance_observation_count,maintenance_independent_count,prompted_count,incorrect_count,no_response_count
  )
  select e.expectation_id,result.step_definition_id,result.sequence_no,
         count(*) filter(where result.eligibility='ACQUISITION')::integer,
         count(*) filter(where result.eligibility='ACQUISITION' and result.performance_code='INDEPENDENT')::integer,
         count(*) filter(where result.eligibility='MAINTENANCE')::integer,
         count(*) filter(where result.eligibility='MAINTENANCE' and result.performance_code='INDEPENDENT')::integer,
         count(*) filter(where result.performance_code='PROMPTED')::integer,
         count(*) filter(where result.performance_code='INCORRECT')::integer,
         count(*) filter(where result.performance_code='NO_RESPONSE')::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_aba_task_runs_v3 run on run.event_id=e.id
  join public.clinical_measurement_aba_task_step_results_v3 result on result.run_event_id=run.event_id
  where e.expectation_id=any(p_expectation_ids)
  group by e.expectation_id,result.step_definition_id,result.sequence_no;

  insert into public.clinical_measurement_session_prompt_distribution_v3(expectation_id,source_kind,prompt_level_id,occurrence_count)
  select e.expectation_id,'TASK_ANALYSIS',result.prompt_level_id,count(*)::integer
  from public.clinical_measurement_effective_primary_events_v3 e
  join public.clinical_measurement_aba_task_runs_v3 run on run.event_id=e.id
  join public.clinical_measurement_aba_task_step_results_v3 result on result.run_event_id=run.event_id
  where e.expectation_id=any(p_expectation_ids) and result.prompt_level_id is not null
  group by e.expectation_id,result.prompt_level_id;

  -- Append a revision only when the semantic projection actually changed.
  with snapshots as (
    select scope.expectation_id,scope.organization_id,scope.patient_id,scope.session_id,scope.target_id,scope.semantic_family,
           public.build_clinical_measurement_projection_snapshot_v3(scope.expectation_id) payload,
           (select max(e.recorded_at) from public.clinical_measurement_raw_events_v3 e where e.expectation_id=scope.expectation_id) latest_recorded,
           clock_timestamp() computed_at
    from public.clinical_measurement_projection_scope_v3 scope
    where scope.expectation_id=any(p_expectation_ids)
  ), hashed as (
    select s.*,encode(digest(convert_to(s.payload::text,'UTF8'),'sha256'),'hex') projection_hash
    from snapshots s
  ), changed as (
    select h.*,head.revision_number old_revision,head.projection_hash old_hash,head.source_latest_recorded_at old_source,
      case
        when head.expectation_id is null then 'INITIAL'
        when p_revision_hint='MANUAL_REBUILD' then 'MANUAL_REBUILD'
        when exists (select 1 from public.clinical_measurement_raw_events_v3 e
                     where e.expectation_id=h.expectation_id
                       and e.recorded_at>coalesce(head.source_latest_recorded_at,'-infinity'::timestamptz)
                       and e.event_kind in ('CORRECTION','VOID','SUPERSEDE')) then 'AUDIT_CORRECTION'
        when exists (select 1 from public.clinical_measurement_raw_events_v3 e
                     where e.expectation_id=h.expectation_id
                       and e.recorded_at>coalesce(head.source_latest_recorded_at,'-infinity'::timestamptz)
                       and e.ingestion_mode='OFFLINE_SYNC') then 'LATE_DATA_INCORPORATED'
        when exists (select 1 from public.clinical_measurement_sessions_v3 s2
                     where s2.id=h.session_id and s2.status='FINALIZED'
                       and (head.expectation_id is null or head.computed_at<s2.finalized_at)) then 'SESSION_FINALIZED'
        else 'SOURCE_DATA_CHANGED' end revision_reason
    from hashed h
    left join public.clinical_measurement_session_projection_heads_v3 head on head.expectation_id=h.expectation_id
    where head.expectation_id is null or head.projection_hash is distinct from h.projection_hash
  ), inserted_revisions as (
    insert into public.clinical_measurement_session_projection_revisions_v3(
      expectation_id,organization_id,patient_id,session_id,target_id,semantic_family,revision_number,
      revision_reason,projection_hash,projection_payload,source_latest_recorded_at,computed_at
    )
    select expectation_id,organization_id,patient_id,session_id,target_id,semantic_family,coalesce(old_revision,0)+1,
           revision_reason,projection_hash,payload,latest_recorded,computed_at
    from changed
    returning expectation_id,revision_number,projection_hash,source_latest_recorded_at,computed_at
  )
  insert into public.clinical_measurement_session_projection_heads_v3(
    expectation_id,organization_id,patient_id,session_id,target_id,semantic_family,revision_number,
    projection_hash,source_latest_recorded_at,computed_at,updated_at
  )
  select c.expectation_id,c.organization_id,c.patient_id,c.session_id,c.target_id,c.semantic_family,
         r.revision_number,r.projection_hash,r.source_latest_recorded_at,r.computed_at,clock_timestamp()
  from changed c join inserted_revisions r using(expectation_id)
  on conflict(expectation_id) do update set
    revision_number=excluded.revision_number,
    projection_hash=excluded.projection_hash,
    source_latest_recorded_at=excluded.source_latest_recorded_at,
    computed_at=excluded.computed_at,
    updated_at=excluded.updated_at;

  select count(*) into v_count from unnest(p_expectation_ids) id;
  return v_count;
end;
$function$;

revoke all on function public.recompute_clinical_measurement_projection_batch_v3(uuid[],text) from public,anon,authenticated;
grant execute on function public.recompute_clinical_measurement_projection_batch_v3(uuid[],text) to service_role;


-- ---------------------------------------------------------------------------
-- Promotion postflight: hard failure means the whole transaction rolls back.
-- ---------------------------------------------------------------------------
do $cmv3_prod_promotion_postflight$
declare
  v_missing text[] := '{}'::text[];
  v_enabled_rollouts bigint := 0;
  v_security jsonb;
  v_raw_count bigint := 0;
  v_shadow_count bigint := 0;
begin
  if to_regprocedure('public.get_aba_session_read_bundle_v3(uuid,uuid,text)') is null then
    v_missing := array_append(v_missing, 'get_aba_session_read_bundle_v3');
  end if;
  if to_regprocedure('public.record_aba_trial_action_v3(uuid,uuid,jsonb,text,uuid)') is null then
    v_missing := array_append(v_missing, 'record_aba_trial_action_v3');
  end if;
  if to_regclass('public.clinical_measurement_targets_v3') is null then
    v_missing := array_append(v_missing, 'clinical_measurement_targets_v3');
  end if;
  if to_regclass('public.clinical_measurement_sessions_v3') is null then
    v_missing := array_append(v_missing, 'clinical_measurement_sessions_v3');
  end if;
  if to_regclass('public.clinical_measurement_raw_events_v3') is null then
    v_missing := array_append(v_missing, 'clinical_measurement_raw_events_v3');
  end if;
  if to_regclass('public.clinical_measurement_aba_trials_v3') is null then
    v_missing := array_append(v_missing, 'clinical_measurement_aba_trials_v3');
  end if;
  if to_regprocedure('public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)') is null then
    v_missing := array_append(v_missing, 'sync_clinical_measurements_bulk_v3');
  end if;
  if to_regclass('public.clinical_measurement_projection_queue_v3') is null then
    v_missing := array_append(v_missing, 'clinical_measurement_projection_queue_v3');
  end if;
  if to_regprocedure('public.process_clinical_measurement_projection_queue_v3(integer)') is null then
    v_missing := array_append(v_missing, 'process_clinical_measurement_projection_queue_v3');
  end if;
  if to_regclass('public.clinical_measurement_evidence_revisions_v3') is null then
    v_missing := array_append(v_missing, 'clinical_measurement_evidence_revisions_v3');
  end if;
  if to_regprocedure('public.get_clinical_measurement_v3_security_preflight()') is null then
    v_missing := array_append(v_missing, 'get_clinical_measurement_v3_security_preflight');
  end if;
  if to_regclass('public.clinical_measurement_shadow_mirror_links_v3') is null then
    v_missing := array_append(v_missing, 'clinical_measurement_shadow_mirror_links_v3');
  end if;
  if to_regprocedure('public.run_clinical_measurement_v3_aba_shadow_mirror(uuid,uuid,text,date,date)') is null then
    v_missing := array_append(v_missing, 'run_clinical_measurement_v3_aba_shadow_mirror');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'CMV3_PRODUCTION_PROMOTION_POSTFLIGHT_MISSING:%', array_to_string(v_missing, ', ');
  end if;

  select count(*)::bigint into v_enabled_rollouts
  from public.aba_measurement_rollout_states_v3
  where allow_new_v3_sessions is true;
  if v_enabled_rollouts <> 0 then
    raise exception 'CMV3_PRODUCTION_PROMOTION_CHANGED_ROLLOUT:%', v_enabled_rollouts;
  end if;

  v_security := public.get_clinical_measurement_v3_security_preflight();
  if coalesce((v_security ->> 'ok')::boolean, false) is false then
    raise exception 'CMV3_PRODUCTION_PROMOTION_SECURITY_PREFLIGHT_FAILED:%', v_security::text;
  end if;

  -- No automatic clinical backfill/mirror is permitted during schema promotion.
  select count(*)::bigint into v_raw_count from public.clinical_measurement_raw_events_v3;
  select count(*)::bigint into v_shadow_count from public.clinical_measurement_shadow_mirror_links_v3;
  if v_raw_count <> 0 or v_shadow_count <> 0 then
    raise exception 'CMV3_PRODUCTION_PROMOTION_UNEXPECTED_CMV3_DATA:raw=%,shadow=%', v_raw_count, v_shadow_count;
  end if;
end;
$cmv3_prod_promotion_postflight$;

commit;

select jsonb_build_object(
  'gate', 'PRODUCTION_SCHEMA_PROMOTED_DARK',
  'release_stage', 'PRODUCTION_SCHEMA_CATCHUP',
  'rollout_enabled', exists(
    select 1 from public.aba_measurement_rollout_states_v3 where allow_new_v3_sessions is true
  ),
  'cmv3_raw_event_count', (select count(*) from public.clinical_measurement_raw_events_v3),
  'shadow_mirror_link_count', (select count(*) from public.clinical_measurement_shadow_mirror_links_v3),
  'security_preflight', public.get_clinical_measurement_v3_security_preflight(),
  'next_step', 'RERUN_PRODUCTION_ACTIVATION_READINESS_GATE'
) as clinical_measurement_v3_production_schema_promotion_result;
