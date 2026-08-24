-- Verto Clinical Measurement Engine V3
-- Production schema catch-up promotion — SPLIT EXECUTION
--
-- IMPORTANT
--   Execute the four parts in numerical order, in PRODUCTION.
--   Each part is its own transaction and is independently fail-closed.
--   If any part fails, stop and send the error before continuing.
--   No part enables ABA V3 rollout or performs clinical backfill/shadow execution.

-- PART 1/4

begin;
set local lock_timeout = '5s';

do $cmv3_prod_split_part1_preflight$
declare
  v_missing text[] := '{}'::text[];
  v_present text[] := '{}'::text[];
  v_enabled bigint := 0;
begin
  if to_regclass('public.aba_measurement_rollout_states_v3') is null then v_missing := array_append(v_missing,'aba_measurement_rollout_states_v3'); end if;
  if to_regclass('public.aba_trials_v3') is null then v_missing := array_append(v_missing,'aba_trials_v3'); end if;
  if to_regprocedure('public.resolve_aba_session_target_measurement_binding_v1(uuid,uuid,text,text,uuid)') is null then v_missing := array_append(v_missing,'resolve_aba_session_target_measurement_binding_v1'); end if;
  if to_regprocedure('public.get_aba_v3_pilot_readiness(uuid,uuid,text,text)') is null then v_missing := array_append(v_missing,'get_aba_v3_pilot_readiness'); end if;
  if to_regprocedure('public.set_aba_measurement_rollout_state_v3(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint)') is null then v_missing := array_append(v_missing,'set_aba_measurement_rollout_state_v3'); end if;
  if to_regprocedure('public.get_aba_v3_session_collection_plan(uuid,uuid,text,text[])') is null then v_missing := array_append(v_missing,'get_aba_v3_session_collection_plan'); end if;
  if to_regprocedure('public.get_aba_v3_preflight_scope_snapshot(uuid,uuid)') is null then v_missing := array_append(v_missing,'get_aba_v3_preflight_scope_snapshot'); end if;
  if cardinality(v_missing) > 0 then raise exception 'CMV3_SPLIT_PART1_PRIOR_BASELINE_MISSING:%', array_to_string(v_missing,', '); end if;

  if to_regprocedure('public.get_aba_session_read_bundle_v3(uuid,uuid,text)') is not null then v_present := array_append(v_present,'get_aba_session_read_bundle_v3'); end if;
  if to_regprocedure('public.record_aba_trial_action_v3(uuid,uuid,jsonb,text,uuid)') is not null then v_present := array_append(v_present,'record_aba_trial_action_v3'); end if;
  if to_regclass('public.clinical_measurement_targets_v3') is not null then v_present := array_append(v_present,'clinical_measurement_targets_v3'); end if;
  if cardinality(v_present) > 0 then raise exception 'CMV3_SPLIT_PART1_ALREADY_OR_PARTIALLY_APPLIED:%', array_to_string(v_present,', '); end if;

  select count(*) into v_enabled from public.aba_measurement_rollout_states_v3 where allow_new_v3_sessions is true;
  if v_enabled <> 0 then raise exception 'CMV3_SPLIT_PART1_ACTIVE_ROLLOUT:%', v_enabled; end if;
end;
$cmv3_prod_split_part1_preflight$;

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


do $cmv3_prod_split_part1_postflight$
declare v_missing text[] := '{}'::text[]; v_enabled bigint := 0;
begin
  if to_regprocedure('public.get_aba_session_read_bundle_v3(uuid,uuid,text)') is null then v_missing := array_append(v_missing,'get_aba_session_read_bundle_v3'); end if;
  if to_regprocedure('public.record_aba_trial_action_v3(uuid,uuid,jsonb,text,uuid)') is null then v_missing := array_append(v_missing,'record_aba_trial_action_v3'); end if;
  if to_regclass('public.clinical_measurement_targets_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_targets_v3'); end if;
  if to_regclass('public.clinical_measurement_definitions_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_definitions_v3'); end if;
  if to_regclass('public.clinical_collection_protocol_snapshots_v3') is null then v_missing := array_append(v_missing,'clinical_collection_protocol_snapshots_v3'); end if;
  if cardinality(v_missing)>0 then raise exception 'CMV3_SPLIT_PART1_POSTFLIGHT_MISSING:%',array_to_string(v_missing,', '); end if;
  select count(*) into v_enabled from public.aba_measurement_rollout_states_v3 where allow_new_v3_sessions is true;
  if v_enabled<>0 then raise exception 'CMV3_SPLIT_PART1_CHANGED_ROLLOUT:%',v_enabled; end if;
end;
$cmv3_prod_split_part1_postflight$;
commit;
select jsonb_build_object('gate','PRODUCTION_SCHEMA_PROMOTION_PART_1_PASS','next_step','RUN_PART_2','rollout_enabled',exists(select 1 from public.aba_measurement_rollout_states_v3 where allow_new_v3_sessions is true)) as result;
