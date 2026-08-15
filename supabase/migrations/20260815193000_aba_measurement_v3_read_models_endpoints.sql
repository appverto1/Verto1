-- ABA Measurement V3 - PR8 canonical read models + server read RPCs.
-- Additive/dark only. Legacy V2 remains untouched and no rollout gate is enabled.
-- Browser roles do not receive direct access; Node service_role is the supported boundary.

begin;

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

commit;

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
