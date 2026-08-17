-- ABA Measurement V3 - PR7 task analysis, interval recording and IOA.
-- Additive/dark only. Legacy V2 remains untouched and no rollout gate is enabled.

begin;

create extension if not exists pgcrypto;

-- ==========================================================================
-- TASK ANALYSIS
-- ==========================================================================
-- Task-analysis steps are immutable children of an immutable collection version.
-- They are not encoded as trial rows and they never use weighted prompt scores.
create table if not exists public.aba_task_analysis_step_definitions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  program_id text not null references public.aba_programs(id) on delete restrict,
  target_id text not null references public.aba_targets(id) on delete restrict,
  collection_definition_version_id uuid not null,
  sequence_no integer not null check (sequence_no > 0),
  step_key text not null,
  label text not null,
  description text,
  is_required boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint aba_task_analysis_step_v3_key_nonempty check (btrim(step_key) <> ''),
  constraint aba_task_analysis_step_v3_label_nonempty check (btrim(label) <> ''),
  constraint aba_task_analysis_step_v3_metadata_object check (jsonb_typeof(metadata) = 'object'),
  foreign key (
    collection_definition_version_id, organization_id, patient_id, target_id
  ) references public.aba_collection_definition_versions_v3(
    id, organization_id, patient_id, target_id
  ) on delete restrict,
  unique (collection_definition_version_id, sequence_no),
  unique (collection_definition_version_id, step_key),
  unique (id, collection_definition_version_id, sequence_no)
);

create index if not exists idx_aba_task_analysis_steps_v3_target
  on public.aba_task_analysis_step_definitions_v3(
    organization_id, patient_id, target_id, collection_definition_version_id, sequence_no
  );

create or replace function public.guard_aba_task_analysis_step_definition_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'ABA_V3_TASK_ANALYSIS_DEFINITION_IMMUTABLE';
end;
$function$;

drop trigger if exists guard_aba_task_analysis_step_definition_v3
  on public.aba_task_analysis_step_definitions_v3;
create trigger guard_aba_task_analysis_step_definition_v3
before update or delete on public.aba_task_analysis_step_definitions_v3
for each row execute function public.guard_aba_task_analysis_step_definition_v3();

create or replace function public.publish_aba_task_analysis_steps_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_target_id text,
  p_collection_definition_version_id uuid,
  p_steps jsonb,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_definition public.aba_collection_definition_versions_v3%rowtype;
  v_program public.aba_programs%rowtype;
  v_target public.aba_targets%rowtype;
  v_count integer;
  v_distinct integer;
  v_min integer;
  v_max integer;
begin
  if p_actor_id is null then raise exception 'ABA_V3_TASK_ANALYSIS_ACTOR_REQUIRED'; end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 then
    raise exception 'ABA_V3_TASK_ANALYSIS_STEPS_REQUIRED';
  end if;
  if jsonb_array_length(p_steps) > 250 then raise exception 'ABA_V3_TASK_ANALYSIS_STEP_LIMIT_EXCEEDED'; end if;

  select * into v_definition
  from public.aba_collection_definition_versions_v3 definition
  where definition.id = p_collection_definition_version_id
    and definition.organization_id = p_organization_id
    and definition.patient_id = p_patient_id
    and definition.target_id = p_target_id;
  if not found then raise exception 'ABA_V3_TASK_ANALYSIS_COLLECTION_VERSION_INVALID'; end if;

  select * into v_target
  from public.aba_targets target
  where target.id = p_target_id
    and target.patient_id = p_patient_id
    and target.clinic_id = p_organization_id::text;
  if not found then raise exception 'ABA_V3_TASK_ANALYSIS_TARGET_SCOPE_INVALID'; end if;

  if v_target.target_type <> 'task_analysis' then
    raise exception 'ABA_V3_TASK_ANALYSIS_TARGET_TYPE_REQUIRED';
  end if;
  if v_target.program_id is null then
    raise exception 'ABA_V3_TASK_ANALYSIS_PROGRAM_REQUIRED';
  end if;

  select * into v_program
  from public.aba_programs program
  where program.id = v_target.program_id
    and program.patient_id = p_patient_id
    and program.clinic_id = p_organization_id::text;
  if not found then raise exception 'ABA_V3_TASK_ANALYSIS_PROGRAM_SCOPE_INVALID'; end if;

  if exists (
    select 1 from public.aba_task_analysis_step_definitions_v3 step
    where step.collection_definition_version_id = p_collection_definition_version_id
  ) then
    raise exception 'ABA_V3_TASK_ANALYSIS_STEPS_ALREADY_PUBLISHED';
  end if;

  with parsed as (
    select *
    from jsonb_to_recordset(p_steps) as step(
      sequence_no integer,
      step_key text,
      label text,
      description text,
      is_required boolean,
      metadata jsonb
    )
  )
  select count(*), count(distinct sequence_no), min(sequence_no), max(sequence_no)
  into v_count, v_distinct, v_min, v_max
  from parsed;

  if v_count <> v_distinct or v_min <> 1 or v_max <> v_count then
    raise exception 'ABA_V3_TASK_ANALYSIS_SEQUENCE_MUST_BE_CONTIGUOUS';
  end if;

  if not exists (
    select 1
    from jsonb_to_recordset(p_steps) as step(
      sequence_no integer, step_key text, label text, description text, is_required boolean, metadata jsonb
    )
    where coalesce(step.is_required, true)
  ) then
    raise exception 'ABA_V3_TASK_ANALYSIS_REQUIRED_STEP_MISSING';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_steps) as step(
      sequence_no integer,
      step_key text,
      label text,
      description text,
      is_required boolean,
      metadata jsonb
    )
    where step.sequence_no is null
       or btrim(coalesce(step.step_key, '')) = ''
       or btrim(coalesce(step.label, '')) = ''
       or (step.metadata is not null and jsonb_typeof(step.metadata) <> 'object')
  ) then
    raise exception 'ABA_V3_TASK_ANALYSIS_STEP_PAYLOAD_INVALID';
  end if;

  insert into public.aba_task_analysis_step_definitions_v3 (
    organization_id, patient_id, program_id, target_id,
    collection_definition_version_id, sequence_no, step_key, label,
    description, is_required, metadata, created_by
  )
  select
    p_organization_id, p_patient_id, v_target.program_id, p_target_id,
    p_collection_definition_version_id, step.sequence_no, step.step_key,
    step.label, step.description, coalesce(step.is_required, true),
    coalesce(step.metadata, '{}'::jsonb), p_actor_id
  from jsonb_to_recordset(p_steps) as step(
    sequence_no integer,
    step_key text,
    label text,
    description text,
    is_required boolean,
    metadata jsonb
  )
  order by step.sequence_no;

  return jsonb_build_object(
    'published', true,
    'collection_definition_version_id', p_collection_definition_version_id,
    'step_count', v_count
  );
end;
$function$;

-- One run is one traversal/opportunity through a task-analysis chain. Clinical
-- outcome lives only in normalized step results, never duplicated in the envelope.
create table if not exists public.aba_task_analysis_runs_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text not null references public.aba_sessions(id) on delete restrict,
  program_id text not null references public.aba_programs(id) on delete restrict,
  target_id text not null references public.aba_targets(id) on delete restrict,
  session_target_binding_id uuid not null references public.aba_session_target_measurement_bindings(id) on delete restrict,
  target_phase_assignment_id uuid not null,
  collection_definition_version_id uuid not null,
  collector_user_id uuid,
  client_event_id text not null,
  occurred_at timestamptz not null,
  lifecycle_status text not null default 'COMPLETE'
    check (lifecycle_status in ('COMPLETE','INCOMPLETE','CANCELLED')),
  completed_at timestamptz,
  close_reason text check (close_reason is null or close_reason in ('CLIENT_COMPLETE','SESSION_FINALIZATION','MANUAL_CANCEL')),
  payload_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint aba_task_analysis_run_v3_client_event_nonempty check (btrim(client_event_id) <> ''),
  constraint aba_task_analysis_run_v3_hash check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_task_analysis_run_v3_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint aba_task_analysis_run_v3_close_shape check (
    completed_at is not null and close_reason is not null
  ),
  foreign key (
    collection_definition_version_id, organization_id, patient_id, target_id
  ) references public.aba_collection_definition_versions_v3(
    id, organization_id, patient_id, target_id
  ) on delete restrict,
  foreign key (
    target_phase_assignment_id, organization_id, patient_id, target_id
  ) references public.aba_target_phase_assignments_v3(
    id, organization_id, patient_id, target_id
  ) on delete restrict,
  unique (organization_id, client_event_id),
  unique (id, organization_id, patient_id, session_id, target_id, target_phase_assignment_id)
);

create index if not exists idx_aba_task_analysis_runs_v3_segment
  on public.aba_task_analysis_runs_v3(
    organization_id, patient_id, session_id, target_id, target_phase_assignment_id, occurred_at
  );

create or replace function public.validate_aba_task_analysis_run_scope_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_binding public.aba_session_target_measurement_bindings%rowtype;
  v_phase public.aba_target_phase_assignments_v3%rowtype;
  v_session public.aba_sessions%rowtype;
begin
  select * into v_session from public.aba_sessions session_row
  where session_row.id = new.session_id
    and session_row.patient_id = new.patient_id
    and session_row.clinic_id = new.organization_id::text;
  if not found then raise exception 'ABA_V3_TASK_RUN_SESSION_SCOPE_INVALID'; end if;
  if new.occurred_at < v_session.started_at
     or new.completed_at < new.occurred_at
     or (v_session.ended_at is not null and new.completed_at > v_session.ended_at) then
    raise exception 'ABA_V3_TASK_RUN_OUTSIDE_SESSION_WINDOW';
  end if;

  select * into v_binding from public.aba_session_target_measurement_bindings
  where id = new.session_target_binding_id;
  if not found
     or v_binding.organization_id is distinct from new.organization_id
     or v_binding.patient_id is distinct from new.patient_id
     or v_binding.session_id is distinct from new.session_id
     or v_binding.program_id is distinct from new.program_id
     or v_binding.target_id is distinct from new.target_id
     or v_binding.measurement_model_version <> 'V3'
     or v_binding.collection_definition_version_id is distinct from new.collection_definition_version_id
     or v_binding.target_phase_assignment_id is distinct from new.target_phase_assignment_id then
    raise exception 'ABA_V3_TASK_RUN_BINDING_SCOPE_INVALID';
  end if;

  select * into v_phase from public.aba_target_phase_assignments_v3 where id = new.target_phase_assignment_id;
  if not found
     or new.occurred_at < v_phase.effective_from
     or (v_phase.effective_until is not null and new.occurred_at >= v_phase.effective_until) then
    raise exception 'ABA_V3_TASK_RUN_OCCURRED_AT_OUTSIDE_PHASE';
  end if;
  return new;
end;
$function$;

drop trigger if exists validate_aba_task_analysis_run_scope_v3 on public.aba_task_analysis_runs_v3;
create trigger validate_aba_task_analysis_run_scope_v3
before insert on public.aba_task_analysis_runs_v3
for each row execute function public.validate_aba_task_analysis_run_scope_v3();

create table if not exists public.aba_task_analysis_step_results_v3 (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.aba_task_analysis_runs_v3(id) on delete restrict,
  step_definition_id uuid not null,
  sequence_no integer not null check (sequence_no > 0),
  performance_code text not null
    check (performance_code in (
      'INDEPENDENT','PROMPTED','INCORRECT','NO_RESPONSE','NOT_APPLICABLE','NOT_OBSERVED'
    )),
  prompt_key text,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint aba_task_analysis_result_v3_prompt_shape check (
    (performance_code = 'PROMPTED' and prompt_key is not null and btrim(prompt_key) <> '')
    or (performance_code <> 'PROMPTED' and prompt_key is null)
  ),
  constraint aba_task_analysis_result_v3_metadata_object check (jsonb_typeof(metadata) = 'object'),
  unique (run_id, sequence_no),
  unique (run_id, step_definition_id)
);

create index if not exists idx_aba_task_analysis_results_v3_run
  on public.aba_task_analysis_step_results_v3(run_id, sequence_no);

create or replace function public.validate_aba_task_analysis_result_scope_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_run public.aba_task_analysis_runs_v3%rowtype;
  v_step public.aba_task_analysis_step_definitions_v3%rowtype;
begin
  select * into v_run from public.aba_task_analysis_runs_v3 where id = new.run_id;
  select * into v_step from public.aba_task_analysis_step_definitions_v3 where id = new.step_definition_id;
  if v_run.id is null or v_step.id is null
     or v_step.collection_definition_version_id is distinct from v_run.collection_definition_version_id
     or v_step.target_id is distinct from v_run.target_id
     or v_step.organization_id is distinct from v_run.organization_id
     or v_step.patient_id is distinct from v_run.patient_id
     or v_step.sequence_no is distinct from new.sequence_no then
    raise exception 'ABA_V3_TASK_ANALYSIS_RESULT_SCOPE_INVALID';
  end if;
  if new.occurred_at < v_run.occurred_at or new.occurred_at > v_run.completed_at then
    raise exception 'ABA_V3_TASK_ANALYSIS_RESULT_OUTSIDE_RUN_WINDOW';
  end if;
  return new;
end;
$function$;

drop trigger if exists validate_aba_task_analysis_result_scope_v3
  on public.aba_task_analysis_step_results_v3;
create trigger validate_aba_task_analysis_result_scope_v3
before insert on public.aba_task_analysis_step_results_v3
for each row execute function public.validate_aba_task_analysis_result_scope_v3();

create or replace function public.guard_aba_task_analysis_raw_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'ABA_V3_TASK_ANALYSIS_RAW_APPEND_ONLY';
end;
$function$;

drop trigger if exists guard_aba_task_analysis_run_v3 on public.aba_task_analysis_runs_v3;
create trigger guard_aba_task_analysis_run_v3
before update or delete on public.aba_task_analysis_runs_v3
for each row execute function public.guard_aba_task_analysis_raw_v3();

drop trigger if exists guard_aba_task_analysis_result_v3 on public.aba_task_analysis_step_results_v3;
create trigger guard_aba_task_analysis_result_v3
before update or delete on public.aba_task_analysis_step_results_v3
for each row execute function public.guard_aba_task_analysis_raw_v3();

-- Corrections remain append-only. A run can be voided/restored/superseded without
-- mutating its original step observations.
create table if not exists public.aba_task_analysis_run_revisions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  run_id uuid not null references public.aba_task_analysis_runs_v3(id) on delete restrict,
  event_type text not null check (event_type in ('VOID','RESTORE','SUPERSEDE','ANNOTATE')),
  replacement_run_id uuid references public.aba_task_analysis_runs_v3(id) on delete restrict,
  reason text not null,
  actor_id uuid,
  client_revision_event_id text not null,
  revision_hash text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint aba_task_analysis_run_revision_v3_reason check (btrim(reason) <> ''),
  constraint aba_task_analysis_run_revision_v3_client_event check (btrim(client_revision_event_id) <> ''),
  constraint aba_task_analysis_run_revision_v3_hash check (revision_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_task_analysis_run_revision_v3_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint aba_task_analysis_run_revision_v3_replacement_shape check (
    (event_type = 'SUPERSEDE' and replacement_run_id is not null and replacement_run_id <> run_id)
    or (event_type <> 'SUPERSEDE' and replacement_run_id is null)
  ),
  unique (organization_id, client_revision_event_id)
);

create index if not exists idx_aba_task_analysis_run_revisions_v3_latest
  on public.aba_task_analysis_run_revisions_v3(run_id, occurred_at desc, id desc)
  where event_type <> 'ANNOTATE';

drop trigger if exists guard_aba_task_analysis_run_revision_v3 on public.aba_task_analysis_run_revisions_v3;
create trigger guard_aba_task_analysis_run_revision_v3
before update or delete on public.aba_task_analysis_run_revisions_v3
for each row execute function public.guard_aba_v3_append_only_raw();

create or replace view public.aba_effective_task_analysis_runs_v3
with (security_barrier = true)
as
select run.*, latest.latest_revision_id, latest.latest_revision_event_type, latest.latest_revision_at
from public.aba_task_analysis_runs_v3 run
left join lateral (
  select revision.id as latest_revision_id,
         revision.event_type as latest_revision_event_type,
         revision.occurred_at as latest_revision_at
  from public.aba_task_analysis_run_revisions_v3 revision
  where revision.run_id = run.id and revision.event_type <> 'ANNOTATE'
  order by revision.occurred_at desc, revision.id desc
  limit 1
) latest on true
where latest.latest_revision_event_type is null
   or latest.latest_revision_event_type = 'RESTORE';

create table if not exists public.aba_session_task_analysis_summaries_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text not null references public.aba_sessions(id) on delete restrict,
  program_id text not null references public.aba_programs(id) on delete restrict,
  target_id text not null references public.aba_targets(id) on delete restrict,
  target_phase_assignment_id uuid not null references public.aba_target_phase_assignments_v3(id) on delete restrict,
  summary_definition_version integer not null default 1 check (summary_definition_version > 0),
  run_count integer not null default 0 check (run_count >= 0),
  complete_run_count integer not null default 0 check (complete_run_count >= 0),
  incomplete_run_count integer not null default 0 check (incomplete_run_count >= 0),
  eligible_step_count integer not null default 0 check (eligible_step_count >= 0),
  independent_step_count integer not null default 0 check (independent_step_count >= 0),
  prompted_step_count integer not null default 0 check (prompted_step_count >= 0),
  incorrect_step_count integer not null default 0 check (incorrect_step_count >= 0),
  no_response_step_count integer not null default 0 check (no_response_step_count >= 0),
  not_observed_step_count integer not null default 0 check (not_observed_step_count >= 0),
  not_applicable_step_count integer not null default 0 check (not_applicable_step_count >= 0),
  independent_steps_percent numeric(7,4),
  prompt_counts jsonb not null default '{}'::jsonb,
  source_projection_hash text not null,
  source_latest_at timestamptz,
  computed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aba_task_analysis_summary_v3_hash check (source_projection_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_task_analysis_summary_v3_prompt_object check (jsonb_typeof(prompt_counts) = 'object'),
  constraint aba_task_analysis_summary_v3_percent check (
    independent_steps_percent is null or (independent_steps_percent >= 0 and independent_steps_percent <= 100)
  ),
  constraint aba_task_analysis_summary_v3_partition check (
    eligible_step_count = independent_step_count + prompted_step_count + incorrect_step_count + no_response_step_count
  ),
  unique (session_id, target_id, target_phase_assignment_id)
);

create index if not exists idx_aba_task_analysis_summary_v3_patient
  on public.aba_session_task_analysis_summaries_v3(
    organization_id, patient_id, target_id, session_id, target_phase_assignment_id
  );

create or replace function public.recompute_aba_session_task_analysis_summary_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_target_id text,
  p_target_phase_assignment_id uuid
)
returns public.aba_session_task_analysis_summaries_v3
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_program_id text;
  v_run_count integer := 0;
  v_complete integer := 0;
  v_incomplete integer := 0;
  v_eligible integer := 0;
  v_independent integer := 0;
  v_prompted integer := 0;
  v_incorrect integer := 0;
  v_no_response integer := 0;
  v_not_observed integer := 0;
  v_not_applicable integer := 0;
  v_percent numeric(7,4);
  v_prompt_counts jsonb := '{}'::jsonb;
  v_latest timestamptz;
  v_hash text;
  v_result public.aba_session_task_analysis_summaries_v3%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', 'aba-v3-task-summary', p_organization_id::text, p_session_id, p_target_id, p_target_phase_assignment_id::text), 0
  ));

  select max(run.program_id)
  into v_program_id
  from public.aba_effective_task_analysis_runs_v3 run
  where run.organization_id = p_organization_id
    and run.patient_id = p_patient_id
    and run.session_id = p_session_id
    and run.target_id = p_target_id
    and run.target_phase_assignment_id = p_target_phase_assignment_id
    and run.lifecycle_status <> 'CANCELLED';

  if v_program_id is null then
    select binding.program_id into v_program_id
    from public.aba_session_target_measurement_bindings binding
    where binding.organization_id = p_organization_id
      and binding.patient_id = p_patient_id
      and binding.session_id = p_session_id
      and binding.target_id = p_target_id
      and binding.measurement_model_version = 'V3';
  end if;
  if v_program_id is null then raise exception 'ABA_V3_TASK_ANALYSIS_SUMMARY_SCOPE_INVALID'; end if;

  select
    count(*)::integer,
    count(*) filter (where run.lifecycle_status = 'COMPLETE')::integer,
    count(*) filter (where run.lifecycle_status = 'INCOMPLETE')::integer,
    max(coalesce(run.completed_at, run.occurred_at))
  into v_run_count, v_complete, v_incomplete, v_latest
  from public.aba_effective_task_analysis_runs_v3 run
  where run.organization_id = p_organization_id
    and run.patient_id = p_patient_id
    and run.session_id = p_session_id
    and run.target_id = p_target_id
    and run.target_phase_assignment_id = p_target_phase_assignment_id
    and run.lifecycle_status <> 'CANCELLED';

  select
    count(*) filter (where result.performance_code in ('INDEPENDENT','PROMPTED','INCORRECT','NO_RESPONSE'))::integer,
    count(*) filter (where result.performance_code = 'INDEPENDENT')::integer,
    count(*) filter (where result.performance_code = 'PROMPTED')::integer,
    count(*) filter (where result.performance_code = 'INCORRECT')::integer,
    count(*) filter (where result.performance_code = 'NO_RESPONSE')::integer,
    count(*) filter (where result.performance_code = 'NOT_OBSERVED')::integer,
    count(*) filter (where result.performance_code = 'NOT_APPLICABLE')::integer,
    greatest(v_latest, max(result.occurred_at))
  into v_eligible, v_independent, v_prompted, v_incorrect, v_no_response,
       v_not_observed, v_not_applicable, v_latest
  from public.aba_task_analysis_step_results_v3 result
  join public.aba_effective_task_analysis_runs_v3 run on run.id = result.run_id
  where run.organization_id = p_organization_id
    and run.patient_id = p_patient_id
    and run.session_id = p_session_id
    and run.target_id = p_target_id
    and run.target_phase_assignment_id = p_target_phase_assignment_id
    and run.lifecycle_status <> 'CANCELLED';

  select coalesce(jsonb_object_agg(prompt_key, prompt_count order by prompt_key), '{}'::jsonb)
  into v_prompt_counts
  from (
    select result.prompt_key, count(*)::integer as prompt_count
    from public.aba_task_analysis_step_results_v3 result
    join public.aba_effective_task_analysis_runs_v3 run on run.id = result.run_id
    where run.organization_id = p_organization_id
      and run.patient_id = p_patient_id
      and run.session_id = p_session_id
      and run.target_id = p_target_id
      and run.target_phase_assignment_id = p_target_phase_assignment_id
      and run.lifecycle_status <> 'CANCELLED'
      and result.performance_code = 'PROMPTED'
      and result.prompt_key is not null
    group by result.prompt_key
  ) prompt_projection;

  v_percent := case when v_eligible > 0
    then round((v_independent::numeric * 100.0) / v_eligible::numeric, 4)
    else null
  end;

  v_hash := encode(digest(convert_to(concat_ws('|',
    p_organization_id::text, p_session_id, p_target_id, p_target_phase_assignment_id::text,
    v_run_count::text, v_complete::text, v_incomplete::text, v_eligible::text,
    v_independent::text, v_prompted::text, v_incorrect::text, v_no_response::text,
    v_not_observed::text, v_not_applicable::text, coalesce(v_percent::text, 'NULL'),
    v_prompt_counts::text, coalesce(v_latest::text, 'NULL')
  ), 'UTF8'), 'sha256'), 'hex');

  insert into public.aba_session_task_analysis_summaries_v3 (
    organization_id, patient_id, session_id, program_id, target_id,
    target_phase_assignment_id, run_count, complete_run_count, incomplete_run_count,
    eligible_step_count, independent_step_count, prompted_step_count,
    incorrect_step_count, no_response_step_count, not_observed_step_count,
    not_applicable_step_count, independent_steps_percent, prompt_counts,
    source_projection_hash, source_latest_at, computed_at, updated_at
  ) values (
    p_organization_id, p_patient_id, p_session_id, v_program_id, p_target_id,
    p_target_phase_assignment_id, v_run_count, v_complete, v_incomplete,
    v_eligible, v_independent, v_prompted, v_incorrect, v_no_response,
    v_not_observed, v_not_applicable, v_percent, v_prompt_counts,
    v_hash, v_latest, now(), now()
  )
  on conflict (session_id, target_id, target_phase_assignment_id) do update set
    run_count = excluded.run_count,
    complete_run_count = excluded.complete_run_count,
    incomplete_run_count = excluded.incomplete_run_count,
    eligible_step_count = excluded.eligible_step_count,
    independent_step_count = excluded.independent_step_count,
    prompted_step_count = excluded.prompted_step_count,
    incorrect_step_count = excluded.incorrect_step_count,
    no_response_step_count = excluded.no_response_step_count,
    not_observed_step_count = excluded.not_observed_step_count,
    not_applicable_step_count = excluded.not_applicable_step_count,
    independent_steps_percent = excluded.independent_steps_percent,
    prompt_counts = excluded.prompt_counts,
    source_projection_hash = excluded.source_projection_hash,
    source_latest_at = excluded.source_latest_at,
    computed_at = excluded.computed_at,
    updated_at = excluded.updated_at
  returning * into v_result;

  return v_result;
end;
$function$;

create or replace function public.record_aba_task_analysis_run_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_target_id text,
  p_client_event_id text,
  p_occurred_at timestamptz,
  p_completed_at timestamptz,
  p_results jsonb,
  p_actor_id uuid default null,
  p_lifecycle_status text default 'COMPLETE',
  p_metadata jsonb default '{}'::jsonb
)
returns public.aba_task_analysis_runs_v3
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_binding public.aba_session_target_measurement_bindings%rowtype;
  v_existing public.aba_task_analysis_runs_v3%rowtype;
  v_run public.aba_task_analysis_runs_v3%rowtype;
  v_hash text;
  v_expected_steps integer;
  v_result_steps integer;
  v_required_steps integer;
  v_observed_required integer;
  v_final_status text;
  v_close_reason text;
begin
  if p_actor_id is null then raise exception 'ABA_V3_TASK_ANALYSIS_ACTOR_REQUIRED'; end if;
  if btrim(coalesce(p_client_event_id, '')) = '' then raise exception 'ABA_V3_TASK_ANALYSIS_CLIENT_EVENT_REQUIRED'; end if;
  if jsonb_typeof(p_results) <> 'array' then raise exception 'ABA_V3_TASK_ANALYSIS_RESULTS_ARRAY_REQUIRED'; end if;
  if jsonb_array_length(p_results) > 250 then raise exception 'ABA_V3_TASK_ANALYSIS_RESULT_LIMIT_EXCEEDED'; end if;
  if p_lifecycle_status not in ('COMPLETE','INCOMPLETE') then raise exception 'ABA_V3_TASK_ANALYSIS_RECORD_STATUS_INVALID'; end if;
  if p_completed_at is null or p_completed_at < p_occurred_at then raise exception 'ABA_V3_TASK_ANALYSIS_COMPLETION_TIME_INVALID'; end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then raise exception 'ABA_V3_TASK_ANALYSIS_METADATA_INVALID'; end if;

  select * into v_binding
  from public.aba_session_target_measurement_bindings binding
  where binding.organization_id = p_organization_id
    and binding.patient_id = p_patient_id
    and binding.session_id = p_session_id
    and binding.target_id = p_target_id
    and binding.measurement_model_version = 'V3';
  if not found then raise exception 'ABA_V3_TASK_ANALYSIS_BINDING_NOT_FOUND'; end if;
  if v_binding.program_id is null then raise exception 'ABA_V3_TASK_ANALYSIS_PROGRAM_REQUIRED'; end if;

  if not exists (
    select 1 from public.aba_target_phase_assignments_v3 phase
    where phase.id = v_binding.target_phase_assignment_id
      and p_occurred_at >= phase.effective_from
      and (phase.effective_until is null or p_occurred_at < phase.effective_until)
  ) then raise exception 'ABA_V3_TASK_ANALYSIS_OCCURRED_AT_OUTSIDE_PHASE'; end if;

  v_hash := encode(digest(convert_to(jsonb_build_object(
    'organization_id', p_organization_id,
    'patient_id', p_patient_id,
    'session_id', p_session_id,
    'target_id', p_target_id,
    'collection_definition_version_id', v_binding.collection_definition_version_id,
    'target_phase_assignment_id', v_binding.target_phase_assignment_id,
    'occurred_at', p_occurred_at,
    'completed_at', p_completed_at,
    'results', p_results,
    'lifecycle_status', p_lifecycle_status,
    'metadata', p_metadata
  )::text, 'UTF8'), 'sha256'), 'hex');

  select * into v_existing
  from public.aba_task_analysis_runs_v3 run
  where run.organization_id = p_organization_id
    and run.client_event_id = p_client_event_id;
  if found then
    if v_existing.payload_hash <> v_hash then raise exception 'ABA_V3_TASK_ANALYSIS_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing;
  end if;

  select count(*), count(*) filter (where step.is_required)
  into v_expected_steps, v_required_steps
  from public.aba_task_analysis_step_definitions_v3 step
  where step.collection_definition_version_id = v_binding.collection_definition_version_id;
  if v_expected_steps = 0 then raise exception 'ABA_V3_TASK_ANALYSIS_DEFINITION_STEPS_MISSING'; end if;

  with parsed as (
    select * from jsonb_to_recordset(p_results) as result(
      sequence_no integer,
      performance_code text,
      prompt_key text,
      occurred_at timestamptz,
      metadata jsonb
    )
  )
  select count(*), count(distinct sequence_no)
  into v_result_steps, v_observed_required
  from parsed;
  if v_result_steps <> v_observed_required then raise exception 'ABA_V3_TASK_ANALYSIS_DUPLICATE_RESULT_SEQUENCE'; end if;
  if v_result_steps > v_expected_steps then raise exception 'ABA_V3_TASK_ANALYSIS_TOO_MANY_RESULTS'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_results) as result(
      sequence_no integer,
      performance_code text,
      prompt_key text,
      occurred_at timestamptz,
      metadata jsonb
    )
    left join public.aba_task_analysis_step_definitions_v3 step
      on step.collection_definition_version_id = v_binding.collection_definition_version_id
     and step.sequence_no = result.sequence_no
    where step.id is null
       or result.performance_code not in ('INDEPENDENT','PROMPTED','INCORRECT','NO_RESPONSE','NOT_APPLICABLE','NOT_OBSERVED')
       or (result.performance_code = 'PROMPTED' and btrim(coalesce(result.prompt_key, '')) = '')
       or (result.performance_code <> 'PROMPTED' and result.prompt_key is not null)
       or (result.metadata is not null and jsonb_typeof(result.metadata) <> 'object')
  ) then raise exception 'ABA_V3_TASK_ANALYSIS_RESULT_PAYLOAD_INVALID'; end if;

  select count(*)
  into v_observed_required
  from public.aba_task_analysis_step_definitions_v3 step
  join jsonb_to_recordset(p_results) as result(
    sequence_no integer,
    performance_code text,
    prompt_key text,
    occurred_at timestamptz,
    metadata jsonb
  ) on result.sequence_no = step.sequence_no
  where step.collection_definition_version_id = v_binding.collection_definition_version_id
    and step.is_required
    and result.performance_code not in ('NOT_OBSERVED');

  v_final_status := case
    when p_lifecycle_status = 'COMPLETE' and v_observed_required >= v_required_steps then 'COMPLETE'
    else 'INCOMPLETE'
  end;
  v_close_reason := 'CLIENT_COMPLETE';

  insert into public.aba_task_analysis_runs_v3 (
    organization_id, patient_id, session_id, program_id, target_id,
    session_target_binding_id, target_phase_assignment_id,
    collection_definition_version_id, collector_user_id, client_event_id,
    occurred_at, lifecycle_status, completed_at, close_reason,
    payload_hash, metadata
  ) values (
    p_organization_id, p_patient_id, p_session_id, v_binding.program_id, p_target_id,
    v_binding.id, v_binding.target_phase_assignment_id,
    v_binding.collection_definition_version_id, p_actor_id, p_client_event_id,
    p_occurred_at, v_final_status, p_completed_at, v_close_reason,
    v_hash, p_metadata
  ) returning * into v_run;

  insert into public.aba_task_analysis_step_results_v3 (
    run_id, step_definition_id, sequence_no, performance_code,
    prompt_key, occurred_at, metadata
  )
  select
    v_run.id, step.id, step.sequence_no, result.performance_code,
    result.prompt_key, coalesce(result.occurred_at, p_occurred_at),
    coalesce(result.metadata, '{}'::jsonb)
  from jsonb_to_recordset(p_results) as result(
    sequence_no integer,
    performance_code text,
    prompt_key text,
    occurred_at timestamptz,
    metadata jsonb
  )
  join public.aba_task_analysis_step_definitions_v3 step
    on step.collection_definition_version_id = v_binding.collection_definition_version_id
   and step.sequence_no = result.sequence_no
  order by step.sequence_no;

  -- A real task-analysis observation invalidates a previous NO_OPPORTUNITY state.
  -- The guarded upsert creates at most one exposure transition for this run.
  insert into public.aba_session_target_exposures_v3 (
    organization_id, patient_id, session_id, program_id, target_id,
    exposure_status, reason_code, reason_text, declared_by, updated_by,
    last_change_reason, triggering_trial_id
  ) values (
    p_organization_id, p_patient_id, p_session_id, v_binding.program_id, p_target_id,
    'COLLECTED', 'TASK_ANALYSIS_RECORDED', null, p_actor_id, p_actor_id,
    'VALID_TASK_ANALYSIS_RUN_PROMOTED_EXPOSURE', null
  )
  on conflict (session_id, target_id) do update
    set exposure_status = 'COLLECTED',
        reason_code = 'TASK_ANALYSIS_RECORDED',
        reason_text = null,
        state_version = public.aba_session_target_exposures_v3.state_version + 1,
        updated_by = excluded.updated_by,
        updated_at = now(),
        last_change_reason = 'VALID_TASK_ANALYSIS_RUN_PROMOTED_EXPOSURE',
        triggering_trial_id = null
  where public.aba_session_target_exposures_v3.exposure_status <> 'COLLECTED';

  perform public.recompute_aba_session_task_analysis_summary_v3(
    p_organization_id, p_patient_id, p_session_id, p_target_id, v_binding.target_phase_assignment_id
  );
  return v_run;
end;
$function$;

create or replace function public.revise_aba_task_analysis_run_v3(
  p_run_id uuid,
  p_event_type text,
  p_reason text,
  p_client_revision_event_id text,
  p_actor_id uuid default null,
  p_replacement_run_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_run public.aba_task_analysis_runs_v3%rowtype;
  v_replacement public.aba_task_analysis_runs_v3%rowtype;
  v_existing public.aba_task_analysis_run_revisions_v3%rowtype;
  v_revision_id uuid;
  v_revision_hash text;
begin
  if p_actor_id is null then raise exception 'ABA_V3_TASK_REVISION_ACTOR_REQUIRED'; end if;
  if btrim(coalesce(p_client_revision_event_id,'')) = '' then raise exception 'ABA_V3_TASK_REVISION_CLIENT_EVENT_REQUIRED'; end if;
  if p_event_type not in ('VOID','RESTORE','SUPERSEDE','ANNOTATE') then raise exception 'ABA_V3_TASK_REVISION_EVENT_INVALID'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'ABA_V3_TASK_REVISION_REASON_REQUIRED'; end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then raise exception 'ABA_V3_TASK_REVISION_METADATA_INVALID'; end if;

  select * into v_run from public.aba_task_analysis_runs_v3 where id = p_run_id;
  if not found then raise exception 'ABA_V3_TASK_RUN_NOT_FOUND'; end if;

  v_revision_hash := encode(digest(convert_to(jsonb_build_object(
    'run_id', p_run_id, 'event_type', p_event_type, 'reason', p_reason,
    'replacement_run_id', p_replacement_run_id, 'metadata', p_metadata
  )::text, 'UTF8'), 'sha256'), 'hex');

  select * into v_existing from public.aba_task_analysis_run_revisions_v3
  where organization_id = v_run.organization_id and client_revision_event_id = p_client_revision_event_id;
  if found then
    if v_existing.revision_hash <> v_revision_hash then raise exception 'ABA_V3_TASK_REVISION_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing.id;
  end if;

  if p_event_type = 'SUPERSEDE' then
    select * into v_replacement from public.aba_task_analysis_runs_v3 where id = p_replacement_run_id;
    if not found
       or v_replacement.organization_id is distinct from v_run.organization_id
       or v_replacement.patient_id is distinct from v_run.patient_id
       or v_replacement.session_id is distinct from v_run.session_id
       or v_replacement.target_id is distinct from v_run.target_id
       or v_replacement.target_phase_assignment_id is distinct from v_run.target_phase_assignment_id then
      raise exception 'ABA_V3_TASK_REPLACEMENT_SCOPE_INVALID';
    end if;
  elsif p_replacement_run_id is not null then
    raise exception 'ABA_V3_TASK_REPLACEMENT_ONLY_FOR_SUPERSEDE';
  end if;

  insert into public.aba_task_analysis_run_revisions_v3(
    organization_id, run_id, event_type, replacement_run_id, reason, actor_id,
    client_revision_event_id, revision_hash, metadata
  ) values (
    v_run.organization_id, v_run.id, p_event_type, p_replacement_run_id, p_reason, p_actor_id,
    p_client_revision_event_id, v_revision_hash, p_metadata
  ) returning id into v_revision_id;

  perform public.recompute_aba_session_task_analysis_summary_v3(
    v_run.organization_id, v_run.patient_id, v_run.session_id,
    v_run.target_id, v_run.target_phase_assignment_id
  );
  return v_revision_id;
end;
$function$;

-- ==========================================================================
-- INTERVAL RECORDING
-- ==========================================================================
-- One run defines the clock/method. Individual observers record against the same
-- interval grid, enabling IOA without double-counting official patient metrics.
create table if not exists public.aba_interval_runs_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text not null references public.aba_sessions(id) on delete restrict,
  behavior_id text not null references public.aba_behavior_definitions(id) on delete restrict,
  context_id uuid not null references public.aba_behavior_contexts_v3(id) on delete restrict,
  primary_collector_binding_id uuid not null references public.aba_behavior_collector_bindings_v3(id) on delete restrict,
  client_run_event_id text not null,
  payload_hash text not null,
  measurement_method text not null
    check (measurement_method in ('PARTIAL_INTERVAL','WHOLE_INTERVAL','MOMENTARY_TIME_SAMPLING')),
  interval_seconds integer not null check (interval_seconds > 0),
  planned_intervals integer not null check (planned_intervals > 0),
  started_at timestamptz not null,
  ended_at timestamptz,
  lifecycle_status text not null default 'OPEN'
    check (lifecycle_status in ('OPEN','COMPLETE','PARTIAL','CANCELLED')),
  close_reason text check (close_reason is null or close_reason in ('CLIENT_COMPLETE','SESSION_FINALIZATION','MANUAL_CANCEL')),
  created_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aba_interval_run_v3_time_order check (ended_at is null or ended_at > started_at),
  constraint aba_interval_run_v3_client_event check (btrim(client_run_event_id) <> ''),
  constraint aba_interval_run_v3_hash check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_interval_run_v3_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint aba_interval_run_v3_close_shape check (
    (lifecycle_status = 'OPEN' and ended_at is null and close_reason is null)
    or (lifecycle_status in ('COMPLETE','PARTIAL','CANCELLED') and ended_at is not null and close_reason is not null)
  ),
  unique (id, organization_id, patient_id, session_id, behavior_id, context_id),
  unique (organization_id, client_run_event_id)
);

create index if not exists idx_aba_interval_runs_v3_segment
  on public.aba_interval_runs_v3(organization_id, patient_id, session_id, behavior_id, context_id, started_at);

create or replace function public.validate_aba_interval_run_scope_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_binding public.aba_behavior_collector_bindings_v3%rowtype;
begin
  if not exists (
    select 1 from public.aba_sessions session_row
    where session_row.id = new.session_id
      and session_row.patient_id = new.patient_id
      and session_row.clinic_id = new.organization_id::text
  ) then raise exception 'ABA_V3_INTERVAL_RUN_SESSION_SCOPE_INVALID'; end if;

  if not exists (
    select 1 from public.aba_behavior_contexts_v3 context
    where context.id = new.context_id
      and context.organization_id = new.organization_id
      and context.patient_id = new.patient_id
      and context.behavior_id = new.behavior_id
  ) then raise exception 'ABA_V3_INTERVAL_RUN_CONTEXT_SCOPE_INVALID'; end if;

  select * into v_binding from public.aba_behavior_collector_bindings_v3
  where id = new.primary_collector_binding_id;
  if not found
     or v_binding.organization_id is distinct from new.organization_id
     or v_binding.patient_id is distinct from new.patient_id
     or v_binding.session_id is distinct from new.session_id
     or v_binding.behavior_id is distinct from new.behavior_id
     or v_binding.context_id is distinct from new.context_id
     or v_binding.collector_role <> 'PRIMARY'
     or v_binding.bound_at > new.started_at
     or (v_binding.ended_at is not null and new.started_at >= v_binding.ended_at) then
    raise exception 'ABA_V3_INTERVAL_RUN_PRIMARY_SCOPE_INVALID';
  end if;
  return new;
end;
$function$;

drop trigger if exists validate_aba_interval_run_scope_v3 on public.aba_interval_runs_v3;
create trigger validate_aba_interval_run_scope_v3
before insert or update on public.aba_interval_runs_v3
for each row execute function public.validate_aba_interval_run_scope_v3();

create table if not exists public.aba_interval_observations_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text not null references public.aba_sessions(id) on delete restrict,
  behavior_id text not null references public.aba_behavior_definitions(id) on delete restrict,
  context_id uuid not null references public.aba_behavior_contexts_v3(id) on delete restrict,
  interval_run_id uuid not null,
  collector_binding_id uuid not null,
  collector_user_id uuid not null,
  collector_role text not null check (collector_role in ('PRIMARY','RELIABILITY')),
  interval_index integer not null check (interval_index > 0),
  interval_started_at timestamptz not null,
  interval_ended_at timestamptz not null,
  sample_at timestamptz,
  observation_code text not null check (observation_code in ('OCCURRED','NOT_OCCURRED','NOT_OBSERVED')),
  client_event_id text not null,
  payload_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint aba_interval_observation_v3_time_order check (interval_ended_at > interval_started_at),
  constraint aba_interval_observation_v3_sample_shape check (
    sample_at is null or (sample_at >= interval_started_at and sample_at <= interval_ended_at)
  ),
  constraint aba_interval_observation_v3_hash check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_interval_observation_v3_event_nonempty check (btrim(client_event_id) <> ''),
  constraint aba_interval_observation_v3_metadata_object check (jsonb_typeof(metadata) = 'object'),
  foreign key (
    interval_run_id, organization_id, patient_id, session_id, behavior_id, context_id
  ) references public.aba_interval_runs_v3(
    id, organization_id, patient_id, session_id, behavior_id, context_id
  ) on delete restrict,
  foreign key (
    collector_binding_id, organization_id, patient_id, session_id,
    behavior_id, context_id, collector_user_id, collector_role
  ) references public.aba_behavior_collector_bindings_v3(
    id, organization_id, patient_id, session_id,
    behavior_id, context_id, collector_user_id, collector_role
  ) on delete restrict,
  unique (organization_id, client_event_id)
);

create index if not exists idx_aba_interval_observations_v3_run_collector
  on public.aba_interval_observations_v3(interval_run_id, collector_binding_id, interval_index);

create or replace function public.validate_aba_interval_observation_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_run public.aba_interval_runs_v3%rowtype;
  v_expected_start timestamptz;
  v_expected_end timestamptz;
begin
  select * into v_run from public.aba_interval_runs_v3 where id = new.interval_run_id;
  if not found then raise exception 'ABA_V3_INTERVAL_RUN_NOT_FOUND'; end if;
  if v_run.lifecycle_status <> 'OPEN' then raise exception 'ABA_V3_INTERVAL_RUN_CLOSED'; end if;
  if new.interval_index > v_run.planned_intervals then raise exception 'ABA_V3_INTERVAL_INDEX_OUT_OF_RANGE'; end if;
  if new.collector_role = 'PRIMARY' and new.collector_binding_id is distinct from v_run.primary_collector_binding_id then
    raise exception 'ABA_V3_INTERVAL_PRIMARY_COLLECTOR_MISMATCH';
  end if;

  v_expected_start := v_run.started_at + make_interval(secs => (new.interval_index - 1) * v_run.interval_seconds);
  v_expected_end := v_expected_start + make_interval(secs => v_run.interval_seconds);
  if new.interval_started_at is distinct from v_expected_start
     or new.interval_ended_at is distinct from v_expected_end then
    raise exception 'ABA_V3_INTERVAL_GRID_MISMATCH';
  end if;

  if v_run.measurement_method = 'MOMENTARY_TIME_SAMPLING' and new.observation_code <> 'NOT_OBSERVED' then
    if new.sample_at is distinct from v_expected_end then
      raise exception 'ABA_V3_INTERVAL_MTS_SAMPLE_MUST_MATCH_GRID';
    end if;
  elsif v_run.measurement_method <> 'MOMENTARY_TIME_SAMPLING' and new.sample_at is not null then
    raise exception 'ABA_V3_INTERVAL_SAMPLE_ONLY_FOR_MTS';
  end if;
  return new;
end;
$function$;

drop trigger if exists validate_aba_interval_observation_v3 on public.aba_interval_observations_v3;
create trigger validate_aba_interval_observation_v3
before insert on public.aba_interval_observations_v3
for each row execute function public.validate_aba_interval_observation_v3();

create or replace function public.guard_aba_interval_observation_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'ABA_V3_INTERVAL_OBSERVATION_APPEND_ONLY';
end;
$function$;

drop trigger if exists guard_aba_interval_observation_v3 on public.aba_interval_observations_v3;
create trigger guard_aba_interval_observation_v3
before update or delete on public.aba_interval_observations_v3
for each row execute function public.guard_aba_interval_observation_v3();

create table if not exists public.aba_interval_observation_revisions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  observation_id uuid not null references public.aba_interval_observations_v3(id) on delete restrict,
  event_type text not null check (event_type in ('VOID','RESTORE','ANNOTATE')),
  reason text not null,
  actor_id uuid,
  client_revision_event_id text not null,
  revision_hash text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint aba_interval_observation_revision_v3_reason check (btrim(reason) <> ''),
  constraint aba_interval_observation_revision_v3_client_event check (btrim(client_revision_event_id) <> ''),
  constraint aba_interval_observation_revision_v3_hash check (revision_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_interval_observation_revision_v3_metadata_object check (jsonb_typeof(metadata) = 'object'),
  unique (organization_id, client_revision_event_id)
);

create index if not exists idx_aba_interval_observation_revisions_v3_latest
  on public.aba_interval_observation_revisions_v3(observation_id, occurred_at desc, id desc)
  where event_type <> 'ANNOTATE';

drop trigger if exists guard_aba_interval_observation_revision_v3 on public.aba_interval_observation_revisions_v3;
create trigger guard_aba_interval_observation_revision_v3
before update or delete on public.aba_interval_observation_revisions_v3
for each row execute function public.guard_aba_v3_append_only_raw();

create or replace view public.aba_effective_interval_observations_v3
with (security_barrier = true)
as
select observation.*, latest.latest_revision_id, latest.latest_revision_event_type, latest.latest_revision_at
from public.aba_interval_observations_v3 observation
left join lateral (
  select revision.id as latest_revision_id,
         revision.event_type as latest_revision_event_type,
         revision.occurred_at as latest_revision_at
  from public.aba_interval_observation_revisions_v3 revision
  where revision.observation_id = observation.id and revision.event_type <> 'ANNOTATE'
  order by revision.occurred_at desc, revision.id desc
  limit 1
) latest on true
where latest.latest_revision_event_type is null
   or latest.latest_revision_event_type = 'RESTORE';

create index if not exists idx_aba_interval_observations_v3_cell
  on public.aba_interval_observations_v3(interval_run_id, collector_binding_id, interval_index, created_at, id);

create table if not exists public.aba_interval_summaries_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text not null references public.aba_sessions(id) on delete restrict,
  behavior_id text not null references public.aba_behavior_definitions(id) on delete restrict,
  context_id uuid not null references public.aba_behavior_contexts_v3(id) on delete restrict,
  interval_run_id uuid not null references public.aba_interval_runs_v3(id) on delete restrict,
  collector_binding_id uuid not null references public.aba_behavior_collector_bindings_v3(id) on delete restrict,
  collector_role text not null check (collector_role in ('PRIMARY','RELIABILITY')),
  measurement_method text not null
    check (measurement_method in ('PARTIAL_INTERVAL','WHOLE_INTERVAL','MOMENTARY_TIME_SAMPLING')),
  planned_intervals integer not null check (planned_intervals > 0),
  recorded_intervals integer not null default 0 check (recorded_intervals >= 0),
  observed_intervals integer not null default 0 check (observed_intervals >= 0),
  occurred_intervals integer not null default 0 check (occurred_intervals >= 0),
  not_occurred_intervals integer not null default 0 check (not_occurred_intervals >= 0),
  not_observed_intervals integer not null default 0 check (not_observed_intervals >= 0),
  occurrence_percent numeric(7,4),
  source_projection_hash text not null,
  computed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aba_interval_summary_v3_hash check (source_projection_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_interval_summary_v3_percent check (
    occurrence_percent is null or (occurrence_percent >= 0 and occurrence_percent <= 100)
  ),
  constraint aba_interval_summary_v3_observed_partition check (
    observed_intervals = occurred_intervals + not_occurred_intervals
  ),
  constraint aba_interval_summary_v3_recorded_partition check (
    recorded_intervals = observed_intervals + not_observed_intervals
  ),
  unique (interval_run_id, collector_binding_id)
);

create or replace view public.aba_official_interval_summaries_v3
with (security_invoker = true)
as
select summary.* from public.aba_interval_summaries_v3 summary
where summary.collector_role = 'PRIMARY';

create or replace function public.recompute_aba_interval_summary_v3(
  p_interval_run_id uuid,
  p_collector_binding_id uuid
)
returns public.aba_interval_summaries_v3
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_run public.aba_interval_runs_v3%rowtype;
  v_binding public.aba_behavior_collector_bindings_v3%rowtype;
  v_recorded integer := 0;
  v_observed integer := 0;
  v_occurred integer := 0;
  v_not_occurred integer := 0;
  v_not_observed integer := 0;
  v_percent numeric(7,4);
  v_hash text;
  v_result public.aba_interval_summaries_v3%rowtype;
begin
  select * into v_run from public.aba_interval_runs_v3 where id = p_interval_run_id;
  select * into v_binding from public.aba_behavior_collector_bindings_v3 where id = p_collector_binding_id;
  if v_run.id is null or v_binding.id is null
     or v_binding.organization_id is distinct from v_run.organization_id
     or v_binding.patient_id is distinct from v_run.patient_id
     or v_binding.session_id is distinct from v_run.session_id
     or v_binding.behavior_id is distinct from v_run.behavior_id
     or v_binding.context_id is distinct from v_run.context_id then
    raise exception 'ABA_V3_INTERVAL_SUMMARY_SCOPE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'aba-v3-interval-summary:' || p_interval_run_id::text || ':' || p_collector_binding_id::text, 0
  ));

  select
    count(*)::integer,
    count(*) filter (where observation_code <> 'NOT_OBSERVED')::integer,
    count(*) filter (where observation_code = 'OCCURRED')::integer,
    count(*) filter (where observation_code = 'NOT_OCCURRED')::integer,
    count(*) filter (where observation_code = 'NOT_OBSERVED')::integer
  into v_recorded, v_observed, v_occurred, v_not_occurred, v_not_observed
  from public.aba_effective_interval_observations_v3 observation
  where observation.interval_run_id = p_interval_run_id
    and observation.collector_binding_id = p_collector_binding_id;

  v_percent := case when v_observed > 0
    then round((v_occurred::numeric * 100.0) / v_observed::numeric, 4)
    else null
  end;
  v_hash := encode(digest(convert_to(concat_ws('|',
    p_interval_run_id::text, p_collector_binding_id::text,
    v_run.measurement_method, v_run.planned_intervals::text,
    v_recorded::text, v_observed::text, v_occurred::text,
    v_not_occurred::text, v_not_observed::text, coalesce(v_percent::text, 'NULL')
  ), 'UTF8'), 'sha256'), 'hex');

  insert into public.aba_interval_summaries_v3 (
    organization_id, patient_id, session_id, behavior_id, context_id,
    interval_run_id, collector_binding_id, collector_role, measurement_method,
    planned_intervals, recorded_intervals, observed_intervals, occurred_intervals,
    not_occurred_intervals, not_observed_intervals, occurrence_percent,
    source_projection_hash, computed_at, updated_at
  ) values (
    v_run.organization_id, v_run.patient_id, v_run.session_id, v_run.behavior_id, v_run.context_id,
    v_run.id, v_binding.id, v_binding.collector_role, v_run.measurement_method,
    v_run.planned_intervals, v_recorded, v_observed, v_occurred,
    v_not_occurred, v_not_observed, v_percent, v_hash, now(), now()
  )
  on conflict (interval_run_id, collector_binding_id) do update set
    recorded_intervals = excluded.recorded_intervals,
    observed_intervals = excluded.observed_intervals,
    occurred_intervals = excluded.occurred_intervals,
    not_occurred_intervals = excluded.not_occurred_intervals,
    not_observed_intervals = excluded.not_observed_intervals,
    occurrence_percent = excluded.occurrence_percent,
    source_projection_hash = excluded.source_projection_hash,
    computed_at = excluded.computed_at,
    updated_at = excluded.updated_at
  returning * into v_result;
  return v_result;
end;
$function$;

create or replace function public.create_aba_interval_run_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_behavior_id text,
  p_context_id uuid,
  p_primary_collector_binding_id uuid,
  p_client_run_event_id text,
  p_measurement_method text,
  p_interval_seconds integer,
  p_planned_intervals integer,
  p_started_at timestamptz,
  p_actor_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.aba_interval_runs_v3
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_session public.aba_sessions%rowtype;
  v_behavior public.aba_behavior_definitions%rowtype;
  v_primary_binding public.aba_behavior_collector_bindings_v3%rowtype;
  v_existing public.aba_interval_runs_v3%rowtype;
  v_run public.aba_interval_runs_v3%rowtype;
  v_hash text;
begin
  if p_actor_id is null then raise exception 'ABA_V3_INTERVAL_ACTOR_REQUIRED'; end if;
  if btrim(coalesce(p_client_run_event_id,'')) = '' then raise exception 'ABA_V3_INTERVAL_RUN_CLIENT_EVENT_REQUIRED'; end if;
  if p_measurement_method not in ('PARTIAL_INTERVAL','WHOLE_INTERVAL','MOMENTARY_TIME_SAMPLING') then
    raise exception 'ABA_V3_INTERVAL_METHOD_INVALID';
  end if;
  if p_interval_seconds < 1 or p_interval_seconds > 86400
     or p_planned_intervals < 1 or p_planned_intervals > 10000 then
    raise exception 'ABA_V3_INTERVAL_PLAN_INVALID';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then raise exception 'ABA_V3_INTERVAL_METADATA_INVALID'; end if;

  select * into v_session from public.aba_sessions session_row
  where session_row.id = p_session_id
    and session_row.patient_id = p_patient_id
    and session_row.clinic_id = p_organization_id::text;
  if not found then raise exception 'ABA_V3_INTERVAL_SESSION_SCOPE_INVALID'; end if;
  if lower(coalesce(v_session.status,'')) = 'canceled' then raise exception 'ABA_V3_INTERVAL_SESSION_CANCELLED'; end if;
  if p_started_at < v_session.started_at
     or (v_session.ended_at is not null and p_started_at >= v_session.ended_at) then
    raise exception 'ABA_V3_INTERVAL_START_OUTSIDE_SESSION';
  end if;

  select * into v_behavior from public.aba_behavior_definitions behavior
  where behavior.id = p_behavior_id
    and behavior.patient_id = p_patient_id
    and behavior.clinic_id = p_organization_id::text;
  if not found then raise exception 'ABA_V3_INTERVAL_BEHAVIOR_SCOPE_INVALID'; end if;
  if lower(v_behavior.measurement_type) not in ('partial_interval','whole_interval','momentary_time_sampling') then
    raise exception 'ABA_V3_INTERVAL_BEHAVIOR_METHOD_INVALID';
  end if;
  if upper(v_behavior.measurement_type) is distinct from p_measurement_method then
    raise exception 'ABA_V3_INTERVAL_METHOD_MUST_MATCH_BEHAVIOR_DEFINITION';
  end if;
  if not exists (
    select 1 from public.aba_behavior_contexts_v3 context
    where context.id = p_context_id
      and context.organization_id = p_organization_id
      and context.patient_id = p_patient_id
      and context.behavior_id = p_behavior_id
  ) then raise exception 'ABA_V3_INTERVAL_CONTEXT_SCOPE_INVALID'; end if;

  select * into v_primary_binding
  from public.aba_behavior_collector_bindings_v3 binding
  where binding.id = p_primary_collector_binding_id
    and binding.organization_id = p_organization_id
    and binding.patient_id = p_patient_id
    and binding.session_id = p_session_id
    and binding.behavior_id = p_behavior_id
    and binding.context_id = p_context_id
    and binding.collector_role = 'PRIMARY'
    and binding.bound_at <= p_started_at
    and (binding.ended_at is null or p_started_at < binding.ended_at);
  if not found then raise exception 'ABA_V3_INTERVAL_PRIMARY_COLLECTOR_INVALID'; end if;

  v_hash := encode(digest(convert_to(jsonb_build_object(
    'organization_id', p_organization_id, 'patient_id', p_patient_id, 'session_id', p_session_id,
    'behavior_id', p_behavior_id, 'context_id', p_context_id,
    'primary_collector_binding_id', p_primary_collector_binding_id,
    'measurement_method', p_measurement_method, 'interval_seconds', p_interval_seconds,
    'planned_intervals', p_planned_intervals, 'started_at', p_started_at, 'metadata', p_metadata
  )::text, 'UTF8'), 'sha256'), 'hex');

  select * into v_existing from public.aba_interval_runs_v3 run
  where run.organization_id = p_organization_id and run.client_run_event_id = p_client_run_event_id;
  if found then
    if v_existing.payload_hash <> v_hash then raise exception 'ABA_V3_INTERVAL_RUN_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing;
  end if;

  insert into public.aba_interval_runs_v3 (
    organization_id, patient_id, session_id, behavior_id, context_id, primary_collector_binding_id,
    client_run_event_id, payload_hash, measurement_method, interval_seconds, planned_intervals, started_at,
    created_by, metadata
  ) values (
    p_organization_id, p_patient_id, p_session_id, p_behavior_id, p_context_id, p_primary_collector_binding_id,
    p_client_run_event_id, v_hash, p_measurement_method, p_interval_seconds, p_planned_intervals, p_started_at,
    p_actor_id, p_metadata
  ) returning * into v_run;
  return v_run;
end;
$function$;

create or replace function public.record_aba_interval_observations_bulk_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_interval_run_id uuid,
  p_collector_binding_id uuid,
  p_observations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_run public.aba_interval_runs_v3%rowtype;
  v_binding public.aba_behavior_collector_bindings_v3%rowtype;
  v_inserted integer := 0;
  v_idempotent integer := 0;
  v_quarantined integer := 0;
begin
  if jsonb_typeof(p_observations) <> 'array' then
    raise exception 'ABA_V3_INTERVAL_OBSERVATIONS_ARRAY_REQUIRED';
  end if;
  if jsonb_array_length(p_observations) < 1 or jsonb_array_length(p_observations) > 2000 then
    raise exception 'ABA_V3_INTERVAL_BULK_SIZE_OUT_OF_RANGE';
  end if;

  select * into v_run from public.aba_interval_runs_v3 where id = p_interval_run_id;
  select * into v_binding from public.aba_behavior_collector_bindings_v3 where id = p_collector_binding_id;
  if v_run.id is null or v_binding.id is null
     or v_run.organization_id is distinct from p_organization_id
     or v_run.patient_id is distinct from p_patient_id
     or v_binding.organization_id is distinct from p_organization_id
     or v_binding.patient_id is distinct from p_patient_id
     or v_binding.session_id is distinct from v_run.session_id
     or v_binding.behavior_id is distinct from v_run.behavior_id
     or v_binding.context_id is distinct from v_run.context_id
     or v_binding.bound_at > v_run.started_at
     or (v_binding.ended_at is not null and v_run.started_at >= v_binding.ended_at)
     or (v_binding.collector_role = 'PRIMARY' and v_binding.id is distinct from v_run.primary_collector_binding_id) then
    raise exception 'ABA_V3_INTERVAL_BULK_SCOPE_INVALID';
  end if;
  create temporary table if not exists aba_interval_bulk_work_v3 (
    ordinal bigint,
    original_payload jsonb,
    interval_index integer,
    observation_code text,
    sample_at timestamptz,
    client_event_id text,
    metadata jsonb,
    payload_hash text,
    validation_error text
  ) on commit drop;
  truncate pg_temp.aba_interval_bulk_work_v3;

  insert into pg_temp.aba_interval_bulk_work_v3(
    ordinal, original_payload, interval_index, observation_code, sample_at,
    client_event_id, metadata, payload_hash, validation_error
  )
  select
    item.ordinality,
    item.value,
    public.aba_try_integer_v3(item.value ->> 'interval_index'),
    upper(coalesce(item.value ->> 'observation_code', '')),
    case
      when v_run.measurement_method = 'MOMENTARY_TIME_SAMPLING'
       and upper(coalesce(item.value ->> 'observation_code','')) <> 'NOT_OBSERVED'
        then v_run.started_at + make_interval(secs => public.aba_try_integer_v3(item.value ->> 'interval_index') * v_run.interval_seconds)
      else null
    end,
    item.value ->> 'client_event_id',
    case when jsonb_typeof(item.value -> 'metadata') = 'object' then item.value -> 'metadata' else '{}'::jsonb end,
    encode(digest(convert_to(jsonb_build_object(
      'interval_run_id', p_interval_run_id,
      'collector_binding_id', p_collector_binding_id,
      'interval_index', public.aba_try_integer_v3(item.value ->> 'interval_index'),
      'observation_code', upper(coalesce(item.value ->> 'observation_code', '')),
      'sample_at', case
        when v_run.measurement_method = 'MOMENTARY_TIME_SAMPLING'
         and upper(coalesce(item.value ->> 'observation_code','')) <> 'NOT_OBSERVED'
          then v_run.started_at + make_interval(secs => public.aba_try_integer_v3(item.value ->> 'interval_index') * v_run.interval_seconds)
        else null
      end,
      'metadata', case when jsonb_typeof(item.value -> 'metadata') = 'object' then item.value -> 'metadata' else '{}'::jsonb end
    )::text, 'UTF8'), 'sha256'), 'hex'),
    case
      when jsonb_typeof(item.value) <> 'object' then 'PAYLOAD_NOT_OBJECT'
      when public.aba_try_integer_v3(item.value ->> 'interval_index') is null then 'INTERVAL_INDEX_INVALID'
      when public.aba_try_integer_v3(item.value ->> 'interval_index') < 1
        or public.aba_try_integer_v3(item.value ->> 'interval_index') > v_run.planned_intervals then 'INTERVAL_INDEX_OUT_OF_RANGE'
      when upper(coalesce(item.value ->> 'observation_code', '')) not in ('OCCURRED','NOT_OCCURRED','NOT_OBSERVED') then 'OBSERVATION_CODE_INVALID'
      when btrim(coalesce(item.value ->> 'client_event_id','')) = '' then 'CLIENT_EVENT_ID_REQUIRED'
      when item.value ? 'metadata' and jsonb_typeof(item.value -> 'metadata') <> 'object' then 'METADATA_INVALID'
      else null
    end
  from jsonb_array_elements(p_observations) with ordinality as item(value, ordinality);

  -- Duplicate keys inside the same offline batch are isolated instead of aborting
  -- unrelated valid observations.
  update pg_temp.aba_interval_bulk_work_v3 item
  set validation_error = coalesce(item.validation_error, 'DUPLICATE_CLIENT_EVENT_IN_BATCH')
  where exists (
    select 1 from pg_temp.aba_interval_bulk_work_v3 duplicate
    where duplicate.client_event_id = item.client_event_id
      and duplicate.ordinal <> item.ordinal
  );

  update pg_temp.aba_interval_bulk_work_v3 item
  set validation_error = coalesce(item.validation_error, 'DUPLICATE_INTERVAL_INDEX_IN_BATCH')
  where exists (
    select 1 from pg_temp.aba_interval_bulk_work_v3 duplicate
    where duplicate.interval_index = item.interval_index
      and duplicate.ordinal <> item.ordinal
  );

  -- Existing event id with the same hash is a retry. Same event id with different
  -- payload, or a different event trying to rewrite the same interval grid cell,
  -- is quarantined and does not abort the rest of the batch.
  update pg_temp.aba_interval_bulk_work_v3 item
  set validation_error = case
    when existing.payload_hash = item.payload_hash then 'IDEMPOTENT_EXISTING'
    else coalesce(item.validation_error, 'IDEMPOTENCY_PAYLOAD_CONFLICT')
  end
  from public.aba_interval_observations_v3 existing
  where existing.organization_id = p_organization_id
    and existing.client_event_id = item.client_event_id;

  update pg_temp.aba_interval_bulk_work_v3 item
  set validation_error = case
    when existing.payload_hash = item.payload_hash then 'IDEMPOTENT_EXISTING'
    else coalesce(item.validation_error, 'INTERVAL_GRID_CONFLICT')
  end
  from public.aba_effective_interval_observations_v3 existing
  where existing.interval_run_id = v_run.id
    and existing.collector_binding_id = v_binding.id
    and existing.interval_index = item.interval_index
    and item.validation_error is distinct from 'IDEMPOTENT_EXISTING';

  if v_run.lifecycle_status <> 'OPEN' then
    update pg_temp.aba_interval_bulk_work_v3 item
    set validation_error = 'INTERVAL_RUN_CLOSED'
    where item.validation_error is null;
  end if;

  select count(*) into v_idempotent
  from pg_temp.aba_interval_bulk_work_v3 where validation_error = 'IDEMPOTENT_EXISTING';

  insert into public.aba_sync_quarantine_v3 (
    organization_id, patient_id, session_id, target_id, client_event_id,
    event_kind, reason_code, original_payload, payload_hash,
    behavior_id, behavior_context_id, status, first_seen_at, last_seen_at
  )
  select
    p_organization_id, p_patient_id, v_run.session_id, null,
    coalesce(nullif(item.client_event_id,''), 'interval-invalid-' || item.ordinal::text || '-' || p_interval_run_id::text),
    'INTERVAL_OBSERVATION', item.validation_error,
    jsonb_build_object(
      'interval_run_id', p_interval_run_id,
      'collector_binding_id', p_collector_binding_id,
      'payload', item.original_payload
    ),
    item.payload_hash,
    v_run.behavior_id, v_run.context_id, 'OPEN', now(), now()
  from pg_temp.aba_interval_bulk_work_v3 item
  where item.validation_error is not null
    and item.validation_error <> 'IDEMPOTENT_EXISTING'
  on conflict (organization_id, client_event_id, payload_hash, reason_code)
  do update set
    last_seen_at = now(),
    occurrence_count = public.aba_sync_quarantine_v3.occurrence_count + 1;
  get diagnostics v_quarantined = row_count;

  insert into public.aba_interval_observations_v3 (
    organization_id, patient_id, session_id, behavior_id, context_id,
    interval_run_id, collector_binding_id, collector_user_id, collector_role,
    interval_index, interval_started_at, interval_ended_at, sample_at,
    observation_code, client_event_id, payload_hash, metadata
  )
  select
    v_run.organization_id, v_run.patient_id, v_run.session_id, v_run.behavior_id, v_run.context_id,
    v_run.id, v_binding.id, v_binding.collector_user_id, v_binding.collector_role,
    item.interval_index,
    v_run.started_at + make_interval(secs => (item.interval_index - 1) * v_run.interval_seconds),
    v_run.started_at + make_interval(secs => item.interval_index * v_run.interval_seconds),
    item.sample_at, item.observation_code, item.client_event_id, item.payload_hash, item.metadata
  from pg_temp.aba_interval_bulk_work_v3 item
  where item.validation_error is null
  order by item.ordinal;
  get diagnostics v_inserted = row_count;

  perform public.recompute_aba_interval_summary_v3(v_run.id, v_binding.id);

  if v_binding.collector_role = 'RELIABILITY' then
    perform public.recompute_aba_interval_ioa_v3(v_run.id, v_binding.id);
  else
    perform public.recompute_aba_interval_ioa_v3(v_run.id, reliability.id)
    from public.aba_behavior_collector_bindings_v3 reliability
    where reliability.session_id = v_run.session_id
      and reliability.behavior_id = v_run.behavior_id
      and reliability.context_id = v_run.context_id
      and reliability.collector_role = 'RELIABILITY';
  end if;

  return jsonb_build_object(
    'interval_run_id', v_run.id,
    'inserted', v_inserted,
    'idempotent', v_idempotent,
    'quarantined', v_quarantined,
    'received', jsonb_array_length(p_observations)
  );
end;
$function$;

create or replace function public.finalize_aba_interval_run_v3(
  p_interval_run_id uuid,
  p_actor_id uuid default null,
  p_ended_at timestamptz default null,
  p_close_reason text default 'CLIENT_COMPLETE'
)
returns public.aba_interval_runs_v3
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_run public.aba_interval_runs_v3%rowtype;
  v_end timestamptz;
  v_primary_binding uuid;
  v_primary_recorded integer := 0;
  v_binding uuid;
begin
  select * into v_run from public.aba_interval_runs_v3 where id = p_interval_run_id for update;
  if not found then raise exception 'ABA_V3_INTERVAL_RUN_NOT_FOUND'; end if;
  if v_run.lifecycle_status <> 'OPEN' then return v_run; end if;
  if p_close_reason not in ('CLIENT_COMPLETE','SESSION_FINALIZATION','MANUAL_CANCEL') then
    raise exception 'ABA_V3_INTERVAL_CLOSE_REASON_INVALID';
  end if;

  v_end := coalesce(p_ended_at, now());
  if v_end <= v_run.started_at then raise exception 'ABA_V3_INTERVAL_END_INVALID'; end if;

  v_primary_binding := v_run.primary_collector_binding_id;

  if v_primary_binding is not null then
    select count(*) into v_primary_recorded
    from public.aba_effective_interval_observations_v3 observation
    where observation.interval_run_id = v_run.id
      and observation.collector_binding_id = v_primary_binding;
  end if;

  update public.aba_interval_runs_v3
  set lifecycle_status = case
        when p_close_reason = 'MANUAL_CANCEL' then 'CANCELLED'
        when v_primary_recorded >= planned_intervals then 'COMPLETE'
        else 'PARTIAL'
      end,
      ended_at = v_end,
      close_reason = p_close_reason,
      updated_at = now(),
      metadata = metadata || jsonb_build_object('closed_by', p_actor_id)
  where id = v_run.id
  returning * into v_run;

  for v_binding in
    select distinct observation.collector_binding_id
    from public.aba_effective_interval_observations_v3 observation
    where observation.interval_run_id = v_run.id
  loop
    perform public.recompute_aba_interval_summary_v3(v_run.id, v_binding);
  end loop;

  perform public.recompute_aba_interval_ioa_v3(v_run.id, reliability.id)
  from public.aba_behavior_collector_bindings_v3 reliability
  where reliability.session_id = v_run.session_id
    and reliability.behavior_id = v_run.behavior_id
    and reliability.context_id = v_run.context_id
    and reliability.collector_role = 'RELIABILITY';
  return v_run;
end;
$function$;

create or replace function public.finalize_aba_interval_runs_for_session_v3(
  p_session_id text,
  p_session_ended_at timestamptz,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_run_id uuid;
  v_count integer := 0;
begin
  for v_run_id in
    select run.id from public.aba_interval_runs_v3 run
    where run.session_id = p_session_id and run.lifecycle_status = 'OPEN'
    order by run.started_at, run.id
  loop
    perform public.finalize_aba_interval_run_v3(v_run_id, p_actor_id, p_session_ended_at, 'SESSION_FINALIZATION');
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('interval_runs_closed', v_count);
end;
$function$;

-- ==========================================================================
-- IOA / INTEROBSERVER AGREEMENT
-- ==========================================================================
-- Official patient summaries remain PRIMARY-only. Reliability observers are
-- compared in a separate projection and are never summed into patient counts/time.
create table if not exists public.aba_ioa_summaries_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text not null references public.aba_sessions(id) on delete restrict,
  behavior_id text not null references public.aba_behavior_definitions(id) on delete restrict,
  context_id uuid not null references public.aba_behavior_contexts_v3(id) on delete restrict,
  primary_collector_binding_id uuid not null references public.aba_behavior_collector_bindings_v3(id) on delete restrict,
  reliability_collector_binding_id uuid not null references public.aba_behavior_collector_bindings_v3(id) on delete restrict,
  measurement_family text not null check (measurement_family in ('FREQUENCY','DURATION','INTERVAL')),
  ioa_method text not null check (ioa_method in ('TOTAL_COUNT','TOTAL_DURATION','INTERVAL_BY_INTERVAL')),
  interval_run_id uuid references public.aba_interval_runs_v3(id) on delete restrict,
  source_scope_key text not null default 'SESSION',
  comparable_units integer not null default 0 check (comparable_units >= 0),
  agreement_units integer not null default 0 check (agreement_units >= 0),
  primary_value numeric(18,6),
  reliability_value numeric(18,6),
  ioa_percent numeric(7,4),
  requires_review boolean not null default false,
  review_reason text,
  source_projection_hash text not null,
  computed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aba_ioa_summary_v3_pair check (primary_collector_binding_id <> reliability_collector_binding_id),
  constraint aba_ioa_summary_v3_percent check (ioa_percent is null or (ioa_percent >= 0 and ioa_percent <= 100)),
  constraint aba_ioa_summary_v3_hash check (source_projection_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_ioa_summary_v3_interval_shape check (
    (measurement_family = 'INTERVAL' and ioa_method = 'INTERVAL_BY_INTERVAL' and interval_run_id is not null)
    or (measurement_family <> 'INTERVAL' and interval_run_id is null)
  ),
  constraint aba_ioa_summary_v3_scope_key_nonempty check (btrim(source_scope_key) <> ''),
  unique (primary_collector_binding_id, reliability_collector_binding_id, measurement_family, source_scope_key)
);

create index if not exists idx_aba_ioa_summaries_v3_session
  on public.aba_ioa_summaries_v3(organization_id, patient_id, session_id, behavior_id, context_id);

create or replace function public.recompute_aba_behavior_ioa_v3(
  p_session_id text,
  p_behavior_id text,
  p_context_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_primary public.aba_behavior_collector_bindings_v3%rowtype;
  v_reliability public.aba_behavior_collector_bindings_v3%rowtype;
  v_primary_summary public.aba_session_behavior_summaries_v3%rowtype;
  v_reliability_summary public.aba_session_behavior_summaries_v3%rowtype;
  v_family text;
  v_method text;
  v_primary_value numeric(18,6);
  v_reliability_value numeric(18,6);
  v_score numeric(7,4);
  v_requires_review boolean;
  v_review_reason text;
  v_windows_match boolean := false;
  v_primary_slice_count integer := 0;
  v_reliability_slice_count integer := 0;
  v_hash text;
  v_pairs integer := 0;
begin
  select * into v_primary
  from public.aba_behavior_collector_bindings_v3 binding
  where binding.session_id = p_session_id
    and binding.behavior_id = p_behavior_id
    and binding.context_id = p_context_id
    and binding.collector_role = 'PRIMARY'
  order by binding.bound_at
  limit 1;
  if not found then return jsonb_build_object('computed_pairs', 0, 'reason', 'NO_PRIMARY_COLLECTOR'); end if;

  v_primary_summary := public.recompute_aba_session_behavior_summary_v3(v_primary.id);

  for v_reliability in
    select * from public.aba_behavior_collector_bindings_v3 binding
    where binding.session_id = p_session_id
      and binding.behavior_id = p_behavior_id
      and binding.context_id = p_context_id
      and binding.collector_role = 'RELIABILITY'
    order by binding.bound_at, binding.id
  loop
    v_reliability_summary := public.recompute_aba_session_behavior_summary_v3(v_reliability.id);

    select count(*) into v_primary_slice_count
    from public.aba_behavior_observation_slices_v3 slice
    where slice.collector_binding_id = v_primary.id and slice.status = 'ACTIVE' and slice.ended_at is not null;
    select count(*) into v_reliability_slice_count
    from public.aba_behavior_observation_slices_v3 slice
    where slice.collector_binding_id = v_reliability.id and slice.status = 'ACTIVE' and slice.ended_at is not null;

    select (
      v_primary_slice_count > 0
      and v_primary_slice_count = v_reliability_slice_count
      and not exists (
        (select slice.started_at, slice.ended_at
         from public.aba_behavior_observation_slices_v3 slice
         where slice.collector_binding_id = v_primary.id and slice.status = 'ACTIVE' and slice.ended_at is not null)
        except
        (select slice.started_at, slice.ended_at
         from public.aba_behavior_observation_slices_v3 slice
         where slice.collector_binding_id = v_reliability.id and slice.status = 'ACTIVE' and slice.ended_at is not null)
      )
      and not exists (
        (select slice.started_at, slice.ended_at
         from public.aba_behavior_observation_slices_v3 slice
         where slice.collector_binding_id = v_reliability.id and slice.status = 'ACTIVE' and slice.ended_at is not null)
        except
        (select slice.started_at, slice.ended_at
         from public.aba_behavior_observation_slices_v3 slice
         where slice.collector_binding_id = v_primary.id and slice.status = 'ACTIVE' and slice.ended_at is not null)
      )
    ) into v_windows_match;

    -- Frequency: total-count IOA is only meaningful for the same observation window.
    -- Official values are never summed across observers.
    v_family := 'FREQUENCY'; v_method := 'TOTAL_COUNT';
    v_primary_value := v_primary_summary.frequency_count;
    v_reliability_value := v_reliability_summary.frequency_count;
    v_requires_review := not v_windows_match;
    v_review_reason := case when not v_windows_match then 'OBSERVATION_WINDOWS_NOT_ALIGNED' else null end;
    v_score := case
      when v_requires_review then null
      when greatest(v_primary_value, v_reliability_value) = 0 then 100.0
      else round(least(v_primary_value, v_reliability_value) * 100.0 /
                 greatest(v_primary_value, v_reliability_value), 4)
    end;
    v_hash := encode(digest(convert_to(concat_ws('|',
      v_primary.id::text, v_reliability.id::text, v_family,
      v_primary_value::text, v_reliability_value::text, v_score::text
    ), 'UTF8'), 'sha256'), 'hex');

    insert into public.aba_ioa_summaries_v3 (
      organization_id, patient_id, session_id, behavior_id, context_id,
      primary_collector_binding_id, reliability_collector_binding_id,
      measurement_family, ioa_method, source_scope_key, comparable_units, agreement_units,
      primary_value, reliability_value, ioa_percent, requires_review,
      review_reason, source_projection_hash, computed_at, updated_at
    ) values (
      v_primary.organization_id, v_primary.patient_id, v_primary.session_id,
      v_primary.behavior_id, v_primary.context_id, v_primary.id, v_reliability.id,
      v_family, v_method, 'SESSION', case when v_requires_review then 0 else 1 end, case when not v_requires_review and v_primary_value = v_reliability_value then 1 else 0 end,
      v_primary_value, v_reliability_value, v_score, v_requires_review,
      v_review_reason, v_hash, now(), now()
    )
    on conflict (primary_collector_binding_id, reliability_collector_binding_id, measurement_family, source_scope_key)
    do update set
      comparable_units = excluded.comparable_units,
      agreement_units = excluded.agreement_units,
      primary_value = excluded.primary_value,
      reliability_value = excluded.reliability_value,
      ioa_percent = excluded.ioa_percent,
      requires_review = excluded.requires_review,
      review_reason = excluded.review_reason,
      source_projection_hash = excluded.source_projection_hash,
      computed_at = excluded.computed_at,
      updated_at = excluded.updated_at;

    -- Duration: censored/open episodes invalidate total-duration IOA instead of
    -- pretending that an unknown ending is precise.
    v_family := 'DURATION'; v_method := 'TOTAL_DURATION';
    v_primary_value := v_primary_summary.completed_duration_seconds;
    v_reliability_value := v_reliability_summary.completed_duration_seconds;
    v_requires_review := (
      not v_windows_match
      or v_primary_summary.censored_duration_count > 0 or v_primary_summary.open_duration_count > 0
      or v_reliability_summary.censored_duration_count > 0 or v_reliability_summary.open_duration_count > 0
    );
    v_review_reason := case
      when not v_windows_match then 'OBSERVATION_WINDOWS_NOT_ALIGNED'
      when v_primary_summary.censored_duration_count > 0 or v_primary_summary.open_duration_count > 0
        or v_reliability_summary.censored_duration_count > 0 or v_reliability_summary.open_duration_count > 0
        then 'CENSORED_OR_OPEN_DURATION_EPISODE'
      else null
    end;
    v_score := case
      when v_requires_review then null
      when greatest(v_primary_value, v_reliability_value) = 0 then 100.0
      else round(least(v_primary_value, v_reliability_value) * 100.0 /
                 greatest(v_primary_value, v_reliability_value), 4)
    end;
    v_hash := encode(digest(convert_to(concat_ws('|',
      v_primary.id::text, v_reliability.id::text, v_family,
      v_primary_value::text, v_reliability_value::text,
      coalesce(v_score::text,'NULL'), v_requires_review::text
    ), 'UTF8'), 'sha256'), 'hex');

    insert into public.aba_ioa_summaries_v3 (
      organization_id, patient_id, session_id, behavior_id, context_id,
      primary_collector_binding_id, reliability_collector_binding_id,
      measurement_family, ioa_method, source_scope_key, comparable_units, agreement_units,
      primary_value, reliability_value, ioa_percent, requires_review,
      review_reason, source_projection_hash, computed_at, updated_at
    ) values (
      v_primary.organization_id, v_primary.patient_id, v_primary.session_id,
      v_primary.behavior_id, v_primary.context_id, v_primary.id, v_reliability.id,
      v_family, v_method, 'SESSION', case when v_requires_review then 0 else 1 end,
      case when not v_requires_review and v_primary_value = v_reliability_value then 1 else 0 end,
      v_primary_value, v_reliability_value, v_score, v_requires_review,
      v_review_reason, v_hash, now(), now()
    )
    on conflict (primary_collector_binding_id, reliability_collector_binding_id, measurement_family, source_scope_key)
    do update set
      comparable_units = excluded.comparable_units,
      agreement_units = excluded.agreement_units,
      primary_value = excluded.primary_value,
      reliability_value = excluded.reliability_value,
      ioa_percent = excluded.ioa_percent,
      requires_review = excluded.requires_review,
      review_reason = excluded.review_reason,
      source_projection_hash = excluded.source_projection_hash,
      computed_at = excluded.computed_at,
      updated_at = excluded.updated_at;

    v_pairs := v_pairs + 1;
  end loop;
  return jsonb_build_object('computed_pairs', v_pairs);
end;
$function$;

create or replace function public.recompute_aba_interval_ioa_v3(
  p_interval_run_id uuid,
  p_reliability_collector_binding_id uuid
)
returns public.aba_ioa_summaries_v3
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_run public.aba_interval_runs_v3%rowtype;
  v_primary public.aba_behavior_collector_bindings_v3%rowtype;
  v_reliability public.aba_behavior_collector_bindings_v3%rowtype;
  v_comparable integer := 0;
  v_agreements integer := 0;
  v_score numeric(7,4);
  v_hash text;
  v_result public.aba_ioa_summaries_v3%rowtype;
begin
  select * into v_run from public.aba_interval_runs_v3 where id = p_interval_run_id;
  select * into v_reliability from public.aba_behavior_collector_bindings_v3
  where id = p_reliability_collector_binding_id and collector_role = 'RELIABILITY';
  select * into v_primary
  from public.aba_behavior_collector_bindings_v3 binding
  where binding.id = v_run.primary_collector_binding_id
    and binding.collector_role = 'PRIMARY';

  if v_run.id is null or v_primary.id is null or v_reliability.id is null
     or v_reliability.session_id is distinct from v_run.session_id
     or v_reliability.behavior_id is distinct from v_run.behavior_id
     or v_reliability.context_id is distinct from v_run.context_id then
    raise exception 'ABA_V3_INTERVAL_IOA_SCOPE_INVALID';
  end if;

  perform public.recompute_aba_interval_summary_v3(v_run.id, v_primary.id);
  perform public.recompute_aba_interval_summary_v3(v_run.id, v_reliability.id);

  select
    count(*)::integer,
    count(*) filter (where primary_obs.observation_code = reliability_obs.observation_code)::integer
  into v_comparable, v_agreements
  from public.aba_effective_interval_observations_v3 primary_obs
  join public.aba_effective_interval_observations_v3 reliability_obs
    on reliability_obs.interval_run_id = primary_obs.interval_run_id
   and reliability_obs.interval_index = primary_obs.interval_index
   and reliability_obs.collector_binding_id = v_reliability.id
  where primary_obs.interval_run_id = v_run.id
    and primary_obs.collector_binding_id = v_primary.id
    and primary_obs.observation_code <> 'NOT_OBSERVED'
    and reliability_obs.observation_code <> 'NOT_OBSERVED';

  v_score := case when v_comparable > 0
    then round((v_agreements::numeric * 100.0) / v_comparable::numeric, 4)
    else null
  end;
  v_hash := encode(digest(convert_to(concat_ws('|',
    v_run.id::text, v_primary.id::text, v_reliability.id::text,
    v_comparable::text, v_agreements::text, coalesce(v_score::text,'NULL')
  ), 'UTF8'), 'sha256'), 'hex');

  insert into public.aba_ioa_summaries_v3 (
    organization_id, patient_id, session_id, behavior_id, context_id,
    primary_collector_binding_id, reliability_collector_binding_id,
    measurement_family, ioa_method, interval_run_id, source_scope_key,
    comparable_units, agreement_units, ioa_percent,
    source_projection_hash, computed_at, updated_at
  ) values (
    v_run.organization_id, v_run.patient_id, v_run.session_id, v_run.behavior_id, v_run.context_id,
    v_primary.id, v_reliability.id, 'INTERVAL', 'INTERVAL_BY_INTERVAL', v_run.id, v_run.id::text,
    v_comparable, v_agreements, v_score, v_hash, now(), now()
  )
  on conflict (primary_collector_binding_id, reliability_collector_binding_id, measurement_family, source_scope_key)
  do update set
    comparable_units = excluded.comparable_units,
    agreement_units = excluded.agreement_units,
    ioa_percent = excluded.ioa_percent,
    source_projection_hash = excluded.source_projection_hash,
    computed_at = excluded.computed_at,
    updated_at = excluded.updated_at
  returning * into v_result;
  return v_result;
end;
$function$;

create or replace function public.revise_aba_interval_observation_v3(
  p_observation_id uuid,
  p_event_type text,
  p_reason text,
  p_client_revision_event_id text,
  p_actor_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_observation public.aba_interval_observations_v3%rowtype;
  v_existing public.aba_interval_observation_revisions_v3%rowtype;
  v_revision_id uuid;
  v_revision_hash text;
begin
  if p_actor_id is null then raise exception 'ABA_V3_INTERVAL_REVISION_ACTOR_REQUIRED'; end if;
  if btrim(coalesce(p_client_revision_event_id,'')) = '' then raise exception 'ABA_V3_INTERVAL_REVISION_CLIENT_EVENT_REQUIRED'; end if;
  if p_event_type not in ('VOID','RESTORE','ANNOTATE') then raise exception 'ABA_V3_INTERVAL_REVISION_EVENT_INVALID'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'ABA_V3_INTERVAL_REVISION_REASON_REQUIRED'; end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then raise exception 'ABA_V3_INTERVAL_REVISION_METADATA_INVALID'; end if;

  select * into v_observation from public.aba_interval_observations_v3 where id = p_observation_id;
  if not found then raise exception 'ABA_V3_INTERVAL_OBSERVATION_NOT_FOUND'; end if;

  v_revision_hash := encode(digest(convert_to(jsonb_build_object(
    'observation_id', p_observation_id, 'event_type', p_event_type,
    'reason', p_reason, 'metadata', p_metadata
  )::text, 'UTF8'), 'sha256'), 'hex');

  select * into v_existing from public.aba_interval_observation_revisions_v3 revision
  where revision.organization_id = v_observation.organization_id
    and revision.client_revision_event_id = p_client_revision_event_id;
  if found then
    if v_existing.revision_hash <> v_revision_hash then raise exception 'ABA_V3_INTERVAL_REVISION_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing.id;
  end if;

  if p_event_type = 'RESTORE' and exists (
    select 1 from public.aba_effective_interval_observations_v3 other
    where other.interval_run_id = v_observation.interval_run_id
      and other.collector_binding_id = v_observation.collector_binding_id
      and other.interval_index = v_observation.interval_index
      and other.id <> v_observation.id
  ) then
    raise exception 'ABA_V3_INTERVAL_RESTORE_CELL_OCCUPIED';
  end if;

  insert into public.aba_interval_observation_revisions_v3(
    organization_id, observation_id, event_type, reason, actor_id,
    client_revision_event_id, revision_hash, metadata
  ) values (
    v_observation.organization_id, v_observation.id, p_event_type, p_reason, p_actor_id,
    p_client_revision_event_id, v_revision_hash, p_metadata
  ) returning id into v_revision_id;

  perform public.recompute_aba_interval_summary_v3(
    v_observation.interval_run_id, v_observation.collector_binding_id
  );
  if v_observation.collector_role = 'RELIABILITY' then
    perform public.recompute_aba_interval_ioa_v3(v_observation.interval_run_id, v_observation.collector_binding_id);
  else
    perform public.recompute_aba_interval_ioa_v3(v_observation.interval_run_id, reliability.id)
    from public.aba_behavior_collector_bindings_v3 reliability
    join public.aba_interval_runs_v3 run on run.id = v_observation.interval_run_id
    where reliability.session_id = run.session_id
      and reliability.behavior_id = run.behavior_id
      and reliability.context_id = run.context_id
      and reliability.collector_role = 'RELIABILITY';
  end if;
  return v_revision_id;
end;
$function$;

-- Expand shared quarantine kinds for future offline task/interval ingestion. Exact
-- original-version recovery remains the only valid version-resolution path.
alter table public.aba_sync_quarantine_v3
  drop constraint if exists aba_sync_quarantine_v3_event_kind_check;
alter table public.aba_sync_quarantine_v3
  add constraint aba_sync_quarantine_v3_event_kind_check
  check (event_kind in (
    'TRIAL','BEHAVIOR_OBSERVATION_SLICE','BEHAVIOR_EVENT',
    'TASK_ANALYSIS_RUN','INTERVAL_OBSERVATION'
  ));

-- ==========================================================================
-- SESSION FINALIZATION COMPOSITION
-- ==========================================================================
-- PR7 extends the V3-only finalizer so interval runs are never left OPEN. Task
-- analysis runs are atomically immutable records and therefore do not require
-- mutation at session close; incomplete payloads are persisted as INCOMPLETE.
create or replace function public.finalize_aba_session_measurements_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_session_ended_at timestamptz,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_session public.aba_sessions%rowtype;
  v_behavior jsonb := '{}'::jsonb;
  v_intervals jsonb := '{}'::jsonb;
  v_probe_id uuid;
  v_probe_count integer := 0;
  v_target_id text;
  v_target_count integer := 0;
  v_exposures_inserted integer := 0;
  v_exposures_closed integer := 0;
  v_effective_end timestamptz;
  v_task_segment record;
  v_behavior_segment record;
begin
  select * into v_session
  from public.aba_sessions session_row
  where session_row.id = p_session_id
    and session_row.patient_id = p_patient_id
    and session_row.clinic_id = p_organization_id::text
  for update;
  if not found then raise exception 'ABA_V3_SESSION_FINALIZATION_SCOPE_INVALID'; end if;
  if lower(coalesce(v_session.status, '')) <> 'completed' then
    raise exception 'ABA_V3_SESSION_FINALIZATION_REQUIRES_COMPLETED_SESSION';
  end if;
  v_effective_end := coalesce(v_session.ended_at, p_session_ended_at);
  if v_effective_end is null or v_effective_end < v_session.started_at then
    raise exception 'ABA_V3_SESSION_FINALIZATION_END_INVALID';
  end if;

  if not exists (
    select 1 from public.aba_session_target_measurement_bindings binding
    where binding.organization_id = p_organization_id
      and binding.patient_id = p_patient_id
      and binding.session_id = p_session_id
      and binding.measurement_model_version = 'V3'
  ) and not exists (
    select 1 from public.aba_behavior_collector_bindings_v3 binding
    where binding.organization_id = p_organization_id
      and binding.patient_id = p_patient_id
      and binding.session_id = p_session_id
  ) then
    return jsonb_build_object('finalized', false, 'reason', 'NO_V3_MEASUREMENT');
  end if;

  v_behavior := public.finalize_aba_behavior_timers_v3(p_session_id, v_effective_end);
  v_intervals := public.finalize_aba_interval_runs_for_session_v3(p_session_id, v_effective_end, p_actor_id);

  for v_behavior_segment in
    select distinct binding.behavior_id, binding.context_id
    from public.aba_behavior_collector_bindings_v3 binding
    where binding.organization_id = p_organization_id
      and binding.patient_id = p_patient_id
      and binding.session_id = p_session_id
      and exists (
        select 1 from public.aba_behavior_collector_bindings_v3 reliability
        where reliability.session_id = binding.session_id
          and reliability.behavior_id = binding.behavior_id
          and reliability.context_id = binding.context_id
          and reliability.collector_role = 'RELIABILITY'
      )
  loop
    perform public.recompute_aba_behavior_ioa_v3(
      p_session_id, v_behavior_segment.behavior_id, v_behavior_segment.context_id
    );
  end loop;

  insert into public.aba_session_target_exposures_v3 (
    organization_id, patient_id, session_id, program_id, target_id,
    exposure_status, reason_code, reason_text, declared_by, updated_by,
    last_change_reason
  )
  select
    binding.organization_id, binding.patient_id, binding.session_id,
    binding.program_id, binding.target_id,
    case when raw.has_data then 'COLLECTED' else 'NOT_COLLECTED' end,
    case when raw.has_data then 'RAW_V3_DATA_RECOVERED_AT_SESSION_COMPLETION' else 'SESSION_COMPLETED_WITHOUT_EXPOSURE' end,
    case when raw.has_data then 'Exposure reconstruído a partir de dados V3 efetivos.' else 'Sessão encerrada sem coleta registrada para este alvo V3.' end,
    p_actor_id, p_actor_id, 'SESSION_COMPLETION'
  from public.aba_session_target_measurement_bindings binding
  cross join lateral (
    select (
      exists (
        select 1 from public.aba_effective_trials_v3 trial
        where trial.organization_id = binding.organization_id
          and trial.patient_id = binding.patient_id
          and trial.session_id = binding.session_id
          and trial.target_id = binding.target_id
      )
      or exists (
        select 1 from public.aba_effective_task_analysis_runs_v3 task_run
        where task_run.organization_id = binding.organization_id
          and task_run.patient_id = binding.patient_id
          and task_run.session_id = binding.session_id
          and task_run.target_id = binding.target_id
          and task_run.lifecycle_status <> 'CANCELLED'
      )
    ) as has_data
  ) raw
  where binding.organization_id = p_organization_id
    and binding.patient_id = p_patient_id
    and binding.session_id = p_session_id
    and binding.measurement_model_version = 'V3'
    and binding.program_id is not null
    and not exists (
      select 1 from public.aba_session_target_exposures_v3 exposure
      where exposure.session_id = binding.session_id
        and exposure.target_id = binding.target_id
    )
  on conflict (session_id, target_id) do nothing;
  get diagnostics v_exposures_inserted = row_count;

  update public.aba_session_target_exposures_v3 exposure
  set exposure_status = case when resolved.has_data then 'COLLECTED' else 'NOT_COLLECTED' end,
      reason_code = case when resolved.has_data then 'RAW_V3_DATA_RECOVERED_AT_SESSION_COMPLETION'
        else coalesce(exposure.reason_code, 'SESSION_COMPLETED_WITHOUT_COLLECTION') end,
      reason_text = case when resolved.has_data then 'Exposure reconciliado com dados V3 efetivos.'
        else coalesce(exposure.reason_text, 'Sessão encerrada sem coleta registrada para este alvo V3.') end,
      state_version = exposure.state_version + 1,
      updated_by = p_actor_id,
      updated_at = now(),
      last_change_reason = 'SESSION_COMPLETION'
  from (
    select pending.id,
      (
        exists (
          select 1 from public.aba_effective_trials_v3 trial
          where trial.organization_id = pending.organization_id
            and trial.patient_id = pending.patient_id
            and trial.session_id = pending.session_id
            and trial.target_id = pending.target_id
        )
        or exists (
          select 1 from public.aba_effective_task_analysis_runs_v3 task_run
          where task_run.organization_id = pending.organization_id
            and task_run.patient_id = pending.patient_id
            and task_run.session_id = pending.session_id
            and task_run.target_id = pending.target_id
            and task_run.lifecycle_status <> 'CANCELLED'
        )
      ) as has_data
    from public.aba_session_target_exposures_v3 pending
    where pending.organization_id = p_organization_id
      and pending.patient_id = p_patient_id
      and pending.session_id = p_session_id
      and pending.exposure_status = 'PENDING'
  ) resolved
  where exposure.id = resolved.id;
  get diagnostics v_exposures_closed = row_count;

  for v_probe_id in
    select probe.id
    from public.aba_maintenance_probes_v3 probe
    where probe.organization_id = p_organization_id
      and probe.patient_id = p_patient_id
      and probe.session_id = p_session_id
      and probe.lifecycle_status = 'OPEN'
    order by probe.opened_at, probe.id
  loop
    perform public.finalize_aba_maintenance_probe_v3(v_probe_id, 'SESSION_COMPLETION', p_actor_id, v_effective_end);
    v_probe_count := v_probe_count + 1;
  end loop;

  for v_target_id in
    select distinct binding.target_id
    from public.aba_session_target_measurement_bindings binding
    where binding.organization_id = p_organization_id
      and binding.patient_id = p_patient_id
      and binding.session_id = p_session_id
      and binding.measurement_model_version = 'V3'
      and exists (
        select 1 from public.aba_targets target
        where target.id = binding.target_id and target.target_type <> 'task_analysis'
      )
    order by binding.target_id
  loop
    perform public.recompute_aba_session_target_summaries_v3(
      p_organization_id, p_patient_id, p_session_id, v_target_id
    );
    perform public.evaluate_aba_target_mastery_after_session_v3(
      p_organization_id, p_patient_id, p_session_id, v_target_id
    );
    v_target_count := v_target_count + 1;
  end loop;

  for v_task_segment in
    select distinct run.target_id, run.target_phase_assignment_id
    from public.aba_effective_task_analysis_runs_v3 run
    where run.organization_id = p_organization_id
      and run.patient_id = p_patient_id
      and run.session_id = p_session_id
      and run.lifecycle_status <> 'CANCELLED'
  loop
    perform public.recompute_aba_session_task_analysis_summary_v3(
      p_organization_id, p_patient_id, p_session_id,
      v_task_segment.target_id, v_task_segment.target_phase_assignment_id
    );
  end loop;

  return jsonb_build_object(
    'finalized', true,
    'session_id', p_session_id,
    'behavior_finalization', v_behavior,
    'interval_finalization', v_intervals,
    'open_probes_closed', v_probe_count,
    'missing_exposures_created', v_exposures_inserted,
    'pending_exposures_closed', v_exposures_closed,
    'targets_reconciled', v_target_count
  );
end;
$function$;

-- ==========================================================================
-- DARK ROLLOUT / RLS
-- ==========================================================================
alter table public.aba_task_analysis_step_definitions_v3 enable row level security;
alter table public.aba_task_analysis_runs_v3 enable row level security;
alter table public.aba_task_analysis_step_results_v3 enable row level security;
alter table public.aba_task_analysis_run_revisions_v3 enable row level security;
alter table public.aba_session_task_analysis_summaries_v3 enable row level security;
alter table public.aba_interval_runs_v3 enable row level security;
alter table public.aba_interval_observations_v3 enable row level security;
alter table public.aba_interval_observation_revisions_v3 enable row level security;
alter table public.aba_interval_summaries_v3 enable row level security;
alter table public.aba_ioa_summaries_v3 enable row level security;

revoke all on table public.aba_task_analysis_step_definitions_v3 from public, anon, authenticated;
revoke all on table public.aba_task_analysis_runs_v3 from public, anon, authenticated;
revoke all on table public.aba_task_analysis_step_results_v3 from public, anon, authenticated;
revoke all on table public.aba_task_analysis_run_revisions_v3 from public, anon, authenticated;
revoke all on public.aba_effective_task_analysis_runs_v3 from public, anon, authenticated;
revoke all on table public.aba_session_task_analysis_summaries_v3 from public, anon, authenticated;
revoke all on table public.aba_interval_runs_v3 from public, anon, authenticated;
revoke all on table public.aba_interval_observations_v3 from public, anon, authenticated;
revoke all on table public.aba_interval_observation_revisions_v3 from public, anon, authenticated;
revoke all on public.aba_effective_interval_observations_v3 from public, anon, authenticated;
revoke all on table public.aba_interval_summaries_v3 from public, anon, authenticated;
revoke all on table public.aba_ioa_summaries_v3 from public, anon, authenticated;
revoke all on public.aba_official_interval_summaries_v3 from public, anon, authenticated;

-- service_role may read raw/projections, but supported writes flow through RPCs.
grant select on table public.aba_task_analysis_step_definitions_v3 to service_role;
grant select on table public.aba_task_analysis_runs_v3 to service_role;
grant select on table public.aba_task_analysis_step_results_v3 to service_role;
grant select on table public.aba_task_analysis_run_revisions_v3 to service_role;
grant select on public.aba_effective_task_analysis_runs_v3 to service_role;
grant select on table public.aba_session_task_analysis_summaries_v3 to service_role;
grant select on table public.aba_interval_runs_v3 to service_role;
grant select on table public.aba_interval_observations_v3 to service_role;
grant select on table public.aba_interval_observation_revisions_v3 to service_role;
grant select on public.aba_effective_interval_observations_v3 to service_role;
grant select on table public.aba_interval_summaries_v3 to service_role;
grant select on table public.aba_ioa_summaries_v3 to service_role;
grant select on public.aba_official_interval_summaries_v3 to service_role;

revoke all on function public.publish_aba_task_analysis_steps_v3(uuid,uuid,text,uuid,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.record_aba_task_analysis_run_v3(uuid,uuid,text,text,text,timestamptz,timestamptz,jsonb,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.recompute_aba_session_task_analysis_summary_v3(uuid,uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.revise_aba_task_analysis_run_v3(uuid,text,text,text,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.create_aba_interval_run_v3(uuid,uuid,text,text,uuid,uuid,text,text,integer,integer,timestamptz,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.record_aba_interval_observations_bulk_v3(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.finalize_aba_interval_run_v3(uuid,uuid,timestamptz,text) from public, anon, authenticated;
revoke all on function public.finalize_aba_interval_runs_for_session_v3(text,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.recompute_aba_interval_summary_v3(uuid,uuid) from public, anon, authenticated;
revoke all on function public.recompute_aba_behavior_ioa_v3(text,text,uuid) from public, anon, authenticated;
revoke all on function public.recompute_aba_interval_ioa_v3(uuid,uuid) from public, anon, authenticated;
revoke all on function public.revise_aba_interval_observation_v3(uuid,text,text,text,uuid,jsonb) from public, anon, authenticated;

revoke all on function public.guard_aba_task_analysis_step_definition_v3() from public, anon, authenticated;
revoke all on function public.validate_aba_task_analysis_run_scope_v3() from public, anon, authenticated;
revoke all on function public.validate_aba_task_analysis_result_scope_v3() from public, anon, authenticated;
revoke all on function public.guard_aba_task_analysis_raw_v3() from public, anon, authenticated;
revoke all on function public.validate_aba_interval_run_scope_v3() from public, anon, authenticated;
revoke all on function public.validate_aba_interval_observation_v3() from public, anon, authenticated;
revoke all on function public.guard_aba_interval_observation_v3() from public, anon, authenticated;

 grant execute on function public.publish_aba_task_analysis_steps_v3(uuid,uuid,text,uuid,jsonb,uuid) to service_role;
 grant execute on function public.record_aba_task_analysis_run_v3(uuid,uuid,text,text,text,timestamptz,timestamptz,jsonb,uuid,text,jsonb) to service_role;
 grant execute on function public.recompute_aba_session_task_analysis_summary_v3(uuid,uuid,text,text,uuid) to service_role;
 grant execute on function public.revise_aba_task_analysis_run_v3(uuid,text,text,text,uuid,uuid,jsonb) to service_role;
 grant execute on function public.create_aba_interval_run_v3(uuid,uuid,text,text,uuid,uuid,text,text,integer,integer,timestamptz,uuid,jsonb) to service_role;
 grant execute on function public.record_aba_interval_observations_bulk_v3(uuid,uuid,uuid,uuid,jsonb) to service_role;
 grant execute on function public.finalize_aba_interval_run_v3(uuid,uuid,timestamptz,text) to service_role;
 grant execute on function public.finalize_aba_interval_runs_for_session_v3(text,timestamptz,uuid) to service_role;
 grant execute on function public.recompute_aba_interval_summary_v3(uuid,uuid) to service_role;
 grant execute on function public.recompute_aba_behavior_ioa_v3(text,text,uuid) to service_role;
 grant execute on function public.recompute_aba_interval_ioa_v3(uuid,uuid) to service_role;
 grant execute on function public.revise_aba_interval_observation_v3(uuid,text,text,text,uuid,jsonb) to service_role;

-- Existing V3 finalizer was replaced above; keep browser blocked and service_role executable.
revoke all on function public.finalize_aba_session_measurements_v3(uuid,uuid,text,timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.finalize_aba_session_measurements_v3(uuid,uuid,text,timestamptz,uuid) to service_role;

commit;

-- Staging verification (read-only). No rollout row is enabled by this migration.
select
  to_regclass('public.aba_task_analysis_step_definitions_v3') is not null as task_definitions_ready,
  to_regclass('public.aba_task_analysis_runs_v3') is not null as task_runs_ready,
  to_regclass('public.aba_task_analysis_step_results_v3') is not null as task_results_ready,
  to_regclass('public.aba_session_task_analysis_summaries_v3') is not null as task_summaries_ready,
  to_regclass('public.aba_interval_runs_v3') is not null as interval_runs_ready,
  to_regclass('public.aba_interval_observations_v3') is not null as interval_observations_ready,
  to_regclass('public.aba_interval_summaries_v3') is not null as interval_summaries_ready,
  to_regclass('public.aba_ioa_summaries_v3') is not null as ioa_summaries_ready,
  to_regprocedure('public.record_aba_task_analysis_run_v3(uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,uuid,text,jsonb)') is not null as task_record_rpc_ready,
  to_regprocedure('public.record_aba_interval_observations_bulk_v3(uuid,uuid,uuid,uuid,jsonb)') is not null as interval_bulk_rpc_ready,
  to_regprocedure('public.recompute_aba_interval_ioa_v3(uuid,uuid)') is not null as interval_ioa_rpc_ready,
  not exists (
    select 1 from public.aba_measurement_rollout_states_v3
    where allow_new_v3_sessions
  ) as no_new_v3_sessions_enabled;
