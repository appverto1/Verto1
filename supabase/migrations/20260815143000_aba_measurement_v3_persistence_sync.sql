-- ABA Measurement V3 - PR3 persistence + resilient offline sync.
-- Additive only. ABA Legacy V2 remains untouched and V3 stays dark.
-- Browser roles have no direct access to the V3 persistence surface.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Immutable raw V3 trial envelope. Clinical outcome lives in ordered steps.
-- ---------------------------------------------------------------------------
create table if not exists public.aba_trials_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text not null references public.aba_sessions(id) on delete restrict,
  program_id text not null references public.aba_programs(id) on delete restrict,
  target_id text not null references public.aba_targets(id) on delete restrict,
  binding_id uuid not null references public.aba_session_target_measurement_bindings(id) on delete restrict,
  collection_definition_version_id uuid not null
    references public.aba_collection_definition_versions_v3(id) on delete restrict,
  target_phase_assignment_id uuid not null
    references public.aba_target_phase_assignments_v3(id) on delete restrict,
  client_event_id text not null,
  trial_type text not null
    check (trial_type in (
      'TEACHING', 'PROBE', 'BASELINE_PROBE', 'MAINTENANCE_PROBE',
      'GENERALIZATION', 'TASK_ANALYSIS', 'OTHER'
    )),
  occurred_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  collector_user_id uuid,
  source_device_id text,
  protocol_version_deprecated_at_sync boolean not null default false,
  payload_hash text not null,
  client_metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint aba_trials_v3_client_event_nonempty
    check (length(trim(client_event_id)) between 1 and 240),
  constraint aba_trials_v3_payload_hash
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_trials_v3_metadata_object
    check (jsonb_typeof(client_metadata) = 'object'),
  constraint aba_trials_v3_time_order
    check (
      (started_at is null or started_at <= occurred_at)
      and (completed_at is null or completed_at >= occurred_at)
      and (started_at is null or completed_at is null or completed_at >= started_at)
    ),
  unique (id, organization_id, patient_id, session_id, target_id),
  unique (organization_id, client_event_id)
);

create index if not exists idx_aba_trials_v3_session_target
  on public.aba_trials_v3
  (organization_id, patient_id, session_id, target_id, occurred_at, id);

create index if not exists idx_aba_trials_v3_phase
  on public.aba_trials_v3
  (organization_id, patient_id, target_id, target_phase_assignment_id, occurred_at);

create index if not exists idx_aba_trials_v3_binding
  on public.aba_trials_v3 (binding_id, occurred_at, id);

-- Ordered intra-trial chain. A trial has at most one primary independent
-- opportunity. Correction/support/transfer steps never inflate that denominator.
create table if not exists public.aba_trial_steps_v3 (
  id uuid primary key default gen_random_uuid(),
  trial_id uuid not null references public.aba_trials_v3(id) on delete restrict,
  sequence_no integer not null check (sequence_no > 0),
  client_step_event_id text,
  step_type text not null
    check (step_type in ('RESPONSE', 'PROMPT', 'CORRECTION', 'TRANSFER', 'OTHER')),
  opportunity_role text not null
    check (opportunity_role in (
      'PRIMARY_INDEPENDENT', 'SUPPORT', 'CORRECTION', 'TRANSFER', 'OTHER'
    )),
  outcome text not null
    check (outcome in ('CORRECT', 'INCORRECT', 'NO_RESPONSE')),
  prompt_key text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  occurred_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint aba_trial_steps_v3_client_step_nonempty
    check (client_step_event_id is null or length(trim(client_step_event_id)) between 1 and 240),
  constraint aba_trial_steps_v3_metadata_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint aba_trial_steps_v3_primary_shape
    check (
      opportunity_role <> 'PRIMARY_INDEPENDENT'
      or (step_type = 'RESPONSE' and prompt_key is null)
    ),
  unique (trial_id, sequence_no)
);

create unique index if not exists ux_aba_trial_steps_v3_client_step
  on public.aba_trial_steps_v3 (trial_id, client_step_event_id)
  where client_step_event_id is not null;

create unique index if not exists ux_aba_trial_steps_v3_primary_independent
  on public.aba_trial_steps_v3 (trial_id)
  where opportunity_role = 'PRIMARY_INDEPENDENT';

create index if not exists idx_aba_trial_steps_v3_trial_sequence
  on public.aba_trial_steps_v3 (trial_id, sequence_no);

-- ---------------------------------------------------------------------------
-- Explicit target exposure state. NO_OPPORTUNITY is not a fake trial.
-- ---------------------------------------------------------------------------
create table if not exists public.aba_session_target_exposures_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text not null references public.aba_sessions(id) on delete restrict,
  program_id text not null references public.aba_programs(id) on delete restrict,
  target_id text not null references public.aba_targets(id) on delete restrict,
  exposure_status text not null
    check (exposure_status in (
      'PENDING', 'COLLECTED', 'NO_OPPORTUNITY', 'NOT_COLLECTED',
      'NOT_APPLICABLE', 'INCOMPLETE'
    )),
  reason_code text,
  reason_text text,
  state_version bigint not null default 1 check (state_version > 0),
  declared_by uuid,
  declared_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  last_change_reason text,
  triggering_trial_id uuid references public.aba_trials_v3(id) on delete restrict,
  unique (session_id, target_id)
);

create index if not exists idx_aba_session_target_exposures_v3_patient
  on public.aba_session_target_exposures_v3
  (organization_id, patient_id, session_id, exposure_status, target_id);

create table if not exists public.aba_session_target_exposure_events_v3 (
  id uuid primary key default gen_random_uuid(),
  exposure_id uuid not null references public.aba_session_target_exposures_v3(id) on delete restrict,
  organization_id uuid not null references public.clinics(id) on delete restrict,
  from_status text,
  to_status text not null,
  state_version bigint not null check (state_version > 0),
  reason_code text,
  reason_text text,
  actor_id uuid,
  triggering_trial_id uuid references public.aba_trials_v3(id) on delete restrict,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_aba_exposure_events_v3_timeline
  on public.aba_session_target_exposure_events_v3
  (organization_id, exposure_id, state_version, occurred_at);

-- ---------------------------------------------------------------------------
-- Append-only clinical revisions. Original trial/steps remain immutable.
-- ---------------------------------------------------------------------------
create table if not exists public.aba_trial_revisions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  trial_id uuid not null references public.aba_trials_v3(id) on delete restrict,
  event_type text not null
    check (event_type in ('VOID', 'CORRECT', 'SUPERSEDE', 'RESTORE', 'ANNOTATE')),
  replacement_trial_id uuid references public.aba_trials_v3(id) on delete restrict,
  reason text not null,
  actor_id uuid,
  client_revision_event_id text not null,
  revision_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint aba_trial_revisions_v3_reason_nonempty
    check (length(trim(reason)) > 0),
  constraint aba_trial_revisions_v3_client_event_nonempty
    check (length(trim(client_revision_event_id)) between 1 and 240),
  constraint aba_trial_revisions_v3_hash
    check (revision_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_trial_revisions_v3_metadata_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint aba_trial_revisions_v3_replacement_shape
    check (
      (event_type in ('CORRECT', 'SUPERSEDE') and replacement_trial_id is not null)
      or (event_type not in ('CORRECT', 'SUPERSEDE') and replacement_trial_id is null)
    ),
  unique (organization_id, client_revision_event_id)
);

create index if not exists idx_aba_trial_revisions_v3_trial
  on public.aba_trial_revisions_v3 (organization_id, trial_id, occurred_at, id);

-- ---------------------------------------------------------------------------
-- Quarantine preserves uninterpretable client events without fabricating data.
-- A missing collection version can only be mapped to the exact original UUID.
-- ---------------------------------------------------------------------------
create table if not exists public.aba_sync_quarantine_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text,
  target_id text,
  client_event_id text not null,
  event_kind text not null default 'TRIAL'
    check (event_kind in ('TRIAL')),
  reason_code text not null,
  original_payload jsonb not null,
  payload_hash text not null,
  original_collection_definition_version_id uuid,
  original_target_phase_assignment_id uuid,
  status text not null default 'OPEN'
    check (status in ('OPEN', 'READY_FOR_RETRY', 'RESOLVED', 'DISCARDED')),
  resolved_collection_definition_version_id uuid
    references public.aba_collection_definition_versions_v3(id) on delete restrict,
  resolution_reason text,
  resolved_by uuid,
  resolved_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  constraint aba_sync_quarantine_v3_payload_object
    check (jsonb_typeof(original_payload) = 'object'),
  constraint aba_sync_quarantine_v3_hash
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_sync_quarantine_v3_original_version_only
    check (
      resolved_collection_definition_version_id is null
      or resolved_collection_definition_version_id = original_collection_definition_version_id
    ),
  constraint aba_sync_quarantine_v3_resolution_shape
    check (
      (status in ('OPEN', 'READY_FOR_RETRY') and resolved_at is null)
      or (status in ('RESOLVED', 'DISCARDED') and resolved_at is not null)
    ),
  unique (organization_id, client_event_id, payload_hash, reason_code)
);

create index if not exists idx_aba_sync_quarantine_v3_open
  on public.aba_sync_quarantine_v3
  (organization_id, patient_id, status, target_id, first_seen_at)
  where status in ('OPEN', 'READY_FOR_RETRY');

create table if not exists public.aba_sync_quarantine_events_v3 (
  id uuid primary key default gen_random_uuid(),
  quarantine_id uuid not null references public.aba_sync_quarantine_v3(id) on delete restrict,
  organization_id uuid not null references public.clinics(id) on delete restrict,
  from_status text,
  to_status text not null,
  actor_id uuid,
  reason text,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_aba_sync_quarantine_events_v3_timeline
  on public.aba_sync_quarantine_events_v3
  (organization_id, quarantine_id, occurred_at, id);

-- ---------------------------------------------------------------------------
-- Defense-in-depth guards.
-- ---------------------------------------------------------------------------
create or replace function public.guard_aba_v3_append_only_raw()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'ABA_V3_RAW_EVENT_APPEND_ONLY';
end;
$function$;

create or replace function public.validate_aba_trial_v3_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_session_patient uuid;
  v_session_org text;
  v_target_patient uuid;
  v_target_org text;
  v_target_program text;
  v_binding public.aba_session_target_measurement_bindings%rowtype;
  v_definition public.aba_collection_definition_versions_v3%rowtype;
  v_phase public.aba_target_phase_assignments_v3%rowtype;
begin
  select session.patient_id, session.clinic_id
    into v_session_patient, v_session_org
  from public.aba_sessions session
  where session.id = new.session_id;

  if not found
     or v_session_patient is distinct from new.patient_id
     or v_session_org is distinct from new.organization_id::text then
    raise exception 'ABA_V3_TRIAL_SESSION_SCOPE_INVALID';
  end if;

  select target.patient_id, target.clinic_id, target.program_id
    into v_target_patient, v_target_org, v_target_program
  from public.aba_targets target
  where target.id = new.target_id;

  if not found
     or v_target_patient is distinct from new.patient_id
     or v_target_org is distinct from new.organization_id::text
     or v_target_program is distinct from new.program_id then
    raise exception 'ABA_V3_TRIAL_TARGET_SCOPE_INVALID';
  end if;

  select * into v_binding
  from public.aba_session_target_measurement_bindings binding
  where binding.id = new.binding_id;

  if not found
     or v_binding.organization_id is distinct from new.organization_id
     or v_binding.patient_id is distinct from new.patient_id
     or v_binding.session_id is distinct from new.session_id
     or v_binding.target_id is distinct from new.target_id
     or v_binding.program_id is distinct from new.program_id
     or v_binding.measurement_model_version <> 'V3' then
    raise exception 'ABA_V3_TRIAL_BINDING_INVALID';
  end if;

  if v_binding.collection_definition_version_id is distinct from new.collection_definition_version_id then
    raise exception 'ABA_V3_TRIAL_COLLECTION_VERSION_BINDING_MISMATCH';
  end if;

  select * into v_definition
  from public.aba_collection_definition_versions_v3 definition
  where definition.id = new.collection_definition_version_id;

  if not found
     or v_definition.organization_id is distinct from new.organization_id
     or v_definition.patient_id is distinct from new.patient_id
     or v_definition.target_id is distinct from new.target_id
     or v_definition.program_id is distinct from new.program_id then
    raise exception 'ABA_V3_TRIAL_COLLECTION_VERSION_SCOPE_INVALID';
  end if;

  select * into v_phase
  from public.aba_target_phase_assignments_v3 phase
  where phase.id = new.target_phase_assignment_id;

  if not found
     or v_phase.organization_id is distinct from new.organization_id
     or v_phase.patient_id is distinct from new.patient_id
     or v_phase.target_id is distinct from new.target_id
     or v_phase.program_id is distinct from new.program_id then
    raise exception 'ABA_V3_TRIAL_PHASE_SCOPE_INVALID';
  end if;

  if v_phase.created_at > new.occurred_at then
    raise exception 'ABA_V3_TRIAL_PHASE_NOT_YET_DEFINED_AT_EVENT';
  end if;

  if new.occurred_at < v_phase.effective_from
     or (v_phase.effective_until is not null and new.occurred_at >= v_phase.effective_until) then
    raise exception 'ABA_V3_TRIAL_PHASE_WINDOW_INVALID';
  end if;

  return new;
end;
$function$;

create or replace function public.guard_aba_target_phase_assignment_history_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_latest_trial timestamptz;
begin
  if tg_op = 'DELETE' then
    raise exception 'ABA_V3_TARGET_PHASE_DELETE_FORBIDDEN';
  end if;

  if old.id is distinct from new.id
     or old.organization_id is distinct from new.organization_id
     or old.patient_id is distinct from new.patient_id
     or old.program_id is distinct from new.program_id
     or old.target_id is distinct from new.target_id
     or old.source_clinical_plan_phase_id is distinct from new.source_clinical_plan_phase_id
     or old.phase_type is distinct from new.phase_type
     or old.phase_key is distinct from new.phase_key
     or old.label is distinct from new.label
     or old.reason is distinct from new.reason
     or old.effective_from is distinct from new.effective_from
     or old.created_by is distinct from new.created_by
     or old.created_at is distinct from new.created_at then
    raise exception 'ABA_V3_TARGET_PHASE_IDENTITY_IMMUTABLE';
  end if;

  if old.effective_until is not null
     and new.effective_until is distinct from old.effective_until then
    raise exception 'ABA_V3_TARGET_PHASE_CLOSURE_IMMUTABLE';
  end if;

  if old.effective_until is null and new.effective_until is not null then
    select max(trial.occurred_at) into v_latest_trial
    from public.aba_trials_v3 trial
    where trial.target_phase_assignment_id = old.id;

    if v_latest_trial is not null and new.effective_until <= v_latest_trial then
      raise exception 'ABA_V3_TARGET_PHASE_CLOSURE_BEFORE_RECORDED_EVENT';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.validate_aba_v3_binding_temporal_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_definition public.aba_collection_definition_versions_v3%rowtype;
  v_phase public.aba_target_phase_assignments_v3%rowtype;
begin
  if new.measurement_model_version <> 'V3' then
    return new;
  end if;

  select * into v_definition
  from public.aba_collection_definition_versions_v3 definition
  where definition.id = new.collection_definition_version_id;

  if not found
     or v_definition.published_at > new.decision_at
     or (v_definition.deprecated_at is not null and new.decision_at >= v_definition.deprecated_at) then
    raise exception 'ABA_V3_BINDING_COLLECTION_VERSION_NOT_VALID_AT_SESSION_START';
  end if;

  select * into v_phase
  from public.aba_target_phase_assignments_v3 phase
  where phase.id = new.target_phase_assignment_id;

  if not found
     or v_phase.created_at > new.decision_at
     or v_phase.effective_from > new.decision_at
     or (v_phase.effective_until is not null and new.decision_at >= v_phase.effective_until) then
    raise exception 'ABA_V3_BINDING_PHASE_NOT_VALID_AT_SESSION_START';
  end if;

  return new;
end;
$function$;

create or replace function public.validate_aba_exposure_v3_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_session_patient uuid;
  v_session_org text;
  v_target_patient uuid;
  v_target_org text;
  v_target_program text;
begin
  select session.patient_id, session.clinic_id
    into v_session_patient, v_session_org
  from public.aba_sessions session
  where session.id = new.session_id;

  if not found
     or v_session_patient is distinct from new.patient_id
     or v_session_org is distinct from new.organization_id::text then
    raise exception 'ABA_V3_EXPOSURE_SESSION_SCOPE_INVALID';
  end if;

  select target.patient_id, target.clinic_id, target.program_id
    into v_target_patient, v_target_org, v_target_program
  from public.aba_targets target
  where target.id = new.target_id;

  if not found
     or v_target_patient is distinct from new.patient_id
     or v_target_org is distinct from new.organization_id::text
     or v_target_program is distinct from new.program_id then
    raise exception 'ABA_V3_EXPOSURE_TARGET_SCOPE_INVALID';
  end if;

  return new;
end;
$function$;

create or replace function public.audit_aba_exposure_state_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.aba_session_target_exposure_events_v3 (
      exposure_id, organization_id, from_status, to_status, state_version,
      reason_code, reason_text, actor_id, triggering_trial_id
    ) values (
      new.id, new.organization_id, null, new.exposure_status, new.state_version,
      new.reason_code, new.reason_text, coalesce(new.updated_by, new.declared_by),
      new.triggering_trial_id
    );
    return new;
  end if;

  if old.exposure_status is distinct from new.exposure_status
     or old.reason_code is distinct from new.reason_code
     or old.reason_text is distinct from new.reason_text then
    insert into public.aba_session_target_exposure_events_v3 (
      exposure_id, organization_id, from_status, to_status, state_version,
      reason_code, reason_text, actor_id, triggering_trial_id
    ) values (
      new.id, new.organization_id, old.exposure_status, new.exposure_status,
      new.state_version, new.reason_code, new.reason_text, new.updated_by,
      new.triggering_trial_id
    );
  end if;

  return new;
end;
$function$;

create or replace function public.guard_aba_sync_quarantine_v3()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'ABA_V3_QUARANTINE_DELETE_FORBIDDEN';
  end if;

  if old.id is distinct from new.id
     or old.organization_id is distinct from new.organization_id
     or old.patient_id is distinct from new.patient_id
     or old.session_id is distinct from new.session_id
     or old.target_id is distinct from new.target_id
     or old.client_event_id is distinct from new.client_event_id
     or old.event_kind is distinct from new.event_kind
     or old.reason_code is distinct from new.reason_code
     or old.original_payload is distinct from new.original_payload
     or old.payload_hash is distinct from new.payload_hash
     or old.original_collection_definition_version_id is distinct from new.original_collection_definition_version_id
     or old.original_target_phase_assignment_id is distinct from new.original_target_phase_assignment_id
     or old.first_seen_at is distinct from new.first_seen_at then
    raise exception 'ABA_V3_QUARANTINE_ORIGINAL_EVENT_IMMUTABLE';
  end if;

  if new.resolved_collection_definition_version_id is not null
     and new.resolved_collection_definition_version_id is distinct from new.original_collection_definition_version_id then
    raise exception 'ABA_V3_QUARANTINE_VERSION_REMAP_FORBIDDEN';
  end if;

  if old.status in ('RESOLVED', 'DISCARDED') and new.status is distinct from old.status then
    raise exception 'ABA_V3_QUARANTINE_FINAL_STATE_IMMUTABLE';
  end if;

  if new.status = 'RESOLVED' then
    if new.original_collection_definition_version_id is null
       or new.resolved_collection_definition_version_id is distinct from new.original_collection_definition_version_id then
      raise exception 'ABA_V3_QUARANTINE_ORIGINAL_VERSION_REQUIRED';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.audit_aba_sync_quarantine_state_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.aba_sync_quarantine_events_v3 (
      quarantine_id, organization_id, from_status, to_status, actor_id, reason
    ) values (
      new.id, new.organization_id, null, new.status, new.resolved_by, new.reason_code
    );
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.aba_sync_quarantine_events_v3 (
      quarantine_id, organization_id, from_status, to_status, actor_id, reason
    ) values (
      new.id, new.organization_id, old.status, new.status, new.resolved_by,
      new.resolution_reason
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists guard_aba_target_phase_assignment_history_v3
  on public.aba_target_phase_assignments_v3;
create trigger guard_aba_target_phase_assignment_history_v3
before update or delete on public.aba_target_phase_assignments_v3
for each row execute function public.guard_aba_target_phase_assignment_history_v3();

drop trigger if exists validate_aba_v3_binding_temporal_context
  on public.aba_session_target_measurement_bindings;
create trigger validate_aba_v3_binding_temporal_context
before insert on public.aba_session_target_measurement_bindings
for each row execute function public.validate_aba_v3_binding_temporal_context();

-- Immutable raw tables.
drop trigger if exists guard_aba_trials_v3_append_only on public.aba_trials_v3;
create trigger guard_aba_trials_v3_append_only
before update or delete on public.aba_trials_v3
for each row execute function public.guard_aba_v3_append_only_raw();

drop trigger if exists guard_aba_trial_steps_v3_append_only on public.aba_trial_steps_v3;
create trigger guard_aba_trial_steps_v3_append_only
before update or delete on public.aba_trial_steps_v3
for each row execute function public.guard_aba_v3_append_only_raw();

drop trigger if exists guard_aba_trial_revisions_v3_append_only on public.aba_trial_revisions_v3;
create trigger guard_aba_trial_revisions_v3_append_only
before update or delete on public.aba_trial_revisions_v3
for each row execute function public.guard_aba_v3_append_only_raw();

drop trigger if exists guard_aba_exposure_events_v3_append_only on public.aba_session_target_exposure_events_v3;
create trigger guard_aba_exposure_events_v3_append_only
before update or delete on public.aba_session_target_exposure_events_v3
for each row execute function public.guard_aba_v3_append_only_raw();

drop trigger if exists guard_aba_quarantine_events_v3_append_only on public.aba_sync_quarantine_events_v3;
create trigger guard_aba_quarantine_events_v3_append_only
before update or delete on public.aba_sync_quarantine_events_v3
for each row execute function public.guard_aba_v3_append_only_raw();

drop trigger if exists validate_aba_trial_v3_scope on public.aba_trials_v3;
create trigger validate_aba_trial_v3_scope
before insert on public.aba_trials_v3
for each row execute function public.validate_aba_trial_v3_scope();

drop trigger if exists validate_aba_exposure_v3_scope on public.aba_session_target_exposures_v3;
create trigger validate_aba_exposure_v3_scope
before insert or update on public.aba_session_target_exposures_v3
for each row execute function public.validate_aba_exposure_v3_scope();

drop trigger if exists audit_aba_exposure_state_v3 on public.aba_session_target_exposures_v3;
create trigger audit_aba_exposure_state_v3
after insert or update on public.aba_session_target_exposures_v3
for each row execute function public.audit_aba_exposure_state_v3();

drop trigger if exists guard_aba_sync_quarantine_v3 on public.aba_sync_quarantine_v3;
create trigger guard_aba_sync_quarantine_v3
before update or delete on public.aba_sync_quarantine_v3
for each row execute function public.guard_aba_sync_quarantine_v3();

drop trigger if exists audit_aba_sync_quarantine_state_v3 on public.aba_sync_quarantine_v3;
create trigger audit_aba_sync_quarantine_state_v3
after insert or update on public.aba_sync_quarantine_v3
for each row execute function public.audit_aba_sync_quarantine_state_v3();

-- ---------------------------------------------------------------------------
-- Safe parsers keep one malformed client UUID/timestamp from aborting a batch.
-- They are intentionally service-only helpers.
-- ---------------------------------------------------------------------------
create or replace function public.aba_try_uuid_v3(p_value text)
returns uuid
language plpgsql
immutable
set search_path = pg_catalog
as $function$
begin
  if nullif(trim(p_value), '') is null then
    return null;
  end if;
  return p_value::uuid;
exception when others then
  return null;
end;
$function$;

create or replace function public.aba_try_timestamptz_v3(p_value text)
returns timestamptz
language plpgsql
stable
set search_path = pg_catalog
as $function$
begin
  if nullif(trim(p_value), '') is null then
    return null;
  end if;
  return p_value::timestamptz;
exception when others then
  return null;
end;
$function$;

create or replace function public.aba_try_integer_v3(p_value text)
returns integer
language plpgsql
immutable
set search_path = pg_catalog
as $function$
begin
  if nullif(trim(p_value), '') is null then
    return null;
  end if;
  return p_value::integer;
exception when others then
  return null;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Explicit exposure writer for NO_OPPORTUNITY/other non-trial states.
-- A target that already has V3 trials cannot be relabelled NO_OPPORTUNITY.
-- ---------------------------------------------------------------------------
create or replace function public.set_aba_session_target_exposure_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_target_id text,
  p_status text,
  p_reason_code text default null,
  p_reason_text text default null,
  p_actor_id uuid default null
)
returns public.aba_session_target_exposures_v3
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_binding public.aba_session_target_measurement_bindings%rowtype;
  v_result public.aba_session_target_exposures_v3%rowtype;
  v_status text := upper(trim(coalesce(p_status, '')));
begin
  if p_actor_id is null then
    raise exception 'ABA_V3_EXPOSURE_ACTOR_REQUIRED';
  end if;

  if v_status not in ('PENDING', 'NO_OPPORTUNITY', 'NOT_COLLECTED', 'NOT_APPLICABLE', 'INCOMPLETE') then
    raise exception 'ABA_V3_EXPOSURE_STATUS_NOT_MANUALLY_SETTABLE';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_session_id || ':' || p_target_id, 0)
  );

  v_binding := public.resolve_aba_session_target_measurement_binding_v1(
    p_organization_id, p_patient_id, p_session_id, p_target_id, p_actor_id
  );

  if v_binding.measurement_model_version <> 'V3' then
    raise exception 'ABA_V3_EXPOSURE_REQUIRES_V3_BINDING';
  end if;

  if exists (
    select 1
    from public.aba_trials_v3 trial
    where trial.organization_id = p_organization_id
      and trial.patient_id = p_patient_id
      and trial.session_id = p_session_id
      and trial.target_id = p_target_id
  ) then
    raise exception 'ABA_V3_EXPOSURE_CONFLICTS_WITH_COLLECTED_TRIALS';
  end if;

  insert into public.aba_session_target_exposures_v3 (
    organization_id, patient_id, session_id, program_id, target_id,
    exposure_status, reason_code, reason_text, declared_by, updated_by,
    last_change_reason
  ) values (
    p_organization_id, p_patient_id, p_session_id, v_binding.program_id, p_target_id,
    v_status, nullif(trim(p_reason_code), ''), nullif(trim(p_reason_text), ''),
    p_actor_id, p_actor_id, 'MANUAL_EXPOSURE_STATE'
  )
  on conflict (session_id, target_id) do update
    set exposure_status = excluded.exposure_status,
        reason_code = excluded.reason_code,
        reason_text = excluded.reason_text,
        state_version = public.aba_session_target_exposures_v3.state_version + 1,
        updated_by = excluded.updated_by,
        updated_at = now(),
        last_change_reason = 'MANUAL_EXPOSURE_STATE',
        triggering_trial_id = null
  where public.aba_session_target_exposures_v3.exposure_status is distinct from excluded.exposure_status
     or public.aba_session_target_exposures_v3.reason_code is distinct from excluded.reason_code
     or public.aba_session_target_exposures_v3.reason_text is distinct from excluded.reason_text
  returning * into v_result;

  if v_result.id is null then
    select * into v_result
    from public.aba_session_target_exposures_v3 exposure
    where exposure.session_id = p_session_id
      and exposure.target_id = p_target_id;
  end if;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Append-only revision writer with idempotent client key.
-- ---------------------------------------------------------------------------
create or replace function public.record_aba_trial_revision_v3(
  p_organization_id uuid,
  p_trial_id uuid,
  p_event_type text,
  p_replacement_trial_id uuid,
  p_reason text,
  p_client_revision_event_id text,
  p_actor_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.aba_trial_revisions_v3
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_trial public.aba_trials_v3%rowtype;
  v_replacement public.aba_trials_v3%rowtype;
  v_existing public.aba_trial_revisions_v3%rowtype;
  v_result public.aba_trial_revisions_v3%rowtype;
  v_event_type text := upper(trim(coalesce(p_event_type, '')));
  v_latest_event text;
  v_hash text;
begin
  if p_actor_id is null then
    raise exception 'ABA_V3_REVISION_ACTOR_REQUIRED';
  end if;

  if v_event_type not in ('VOID', 'CORRECT', 'SUPERSEDE', 'RESTORE', 'ANNOTATE') then
    raise exception 'ABA_V3_REVISION_EVENT_INVALID';
  end if;

  if nullif(trim(p_reason), '') is null or nullif(trim(p_client_revision_event_id), '') is null then
    raise exception 'ABA_V3_REVISION_REASON_AND_IDEMPOTENCY_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text || ':' || p_trial_id::text, 0));

  select * into v_trial
  from public.aba_trials_v3 trial
  where trial.id = p_trial_id;

  if not found or v_trial.organization_id is distinct from p_organization_id then
    raise exception 'ABA_V3_REVISION_TRIAL_SCOPE_INVALID';
  end if;

  v_hash := encode(digest(
    jsonb_build_object(
      'trial_id', p_trial_id,
      'event_type', v_event_type,
      'replacement_trial_id', p_replacement_trial_id,
      'reason', trim(p_reason),
      'metadata', coalesce(p_metadata, '{}'::jsonb)
    )::text,
    'sha256'
  ), 'hex');

  select * into v_existing
  from public.aba_trial_revisions_v3 revision
  where revision.organization_id = p_organization_id
    and revision.client_revision_event_id = trim(p_client_revision_event_id);

  if found then
    if v_existing.revision_hash is distinct from v_hash then
      raise exception 'ABA_V3_REVISION_IDEMPOTENCY_CONFLICT';
    end if;
    return v_existing;
  end if;

  select revision.event_type into v_latest_event
  from public.aba_trial_revisions_v3 revision
  where revision.organization_id = p_organization_id
    and revision.trial_id = p_trial_id
    and revision.event_type <> 'ANNOTATE'
  order by revision.occurred_at desc, revision.id desc
  limit 1;

  if v_event_type = 'VOID' and v_latest_event in ('VOID', 'CORRECT', 'SUPERSEDE') then
    raise exception 'ABA_V3_REVISION_VOID_TRANSITION_INVALID';
  end if;

  if v_event_type = 'RESTORE' and coalesce(v_latest_event, '') <> 'VOID' then
    raise exception 'ABA_V3_REVISION_RESTORE_REQUIRES_VOID';
  end if;

  if v_event_type in ('CORRECT', 'SUPERSEDE') and v_latest_event in ('VOID', 'CORRECT', 'SUPERSEDE') then
    raise exception 'ABA_V3_REVISION_SUPERSEDE_TRANSITION_INVALID';
  end if;

  if v_event_type in ('CORRECT', 'SUPERSEDE') then
    select * into v_replacement
    from public.aba_trials_v3 trial
    where trial.id = p_replacement_trial_id;

    if p_replacement_trial_id = p_trial_id then
      raise exception 'ABA_V3_REVISION_REPLACEMENT_SELF_REFERENCE';
    end if;

    if not found
       or v_replacement.organization_id is distinct from v_trial.organization_id
       or v_replacement.patient_id is distinct from v_trial.patient_id
       or v_replacement.session_id is distinct from v_trial.session_id
       or v_replacement.target_id is distinct from v_trial.target_id then
      raise exception 'ABA_V3_REVISION_REPLACEMENT_SCOPE_INVALID';
    end if;
  elsif p_replacement_trial_id is not null then
    raise exception 'ABA_V3_REVISION_REPLACEMENT_NOT_ALLOWED';
  end if;

  insert into public.aba_trial_revisions_v3 (
    organization_id, trial_id, event_type, replacement_trial_id, reason,
    actor_id, client_revision_event_id, revision_hash, metadata
  ) values (
    p_organization_id, p_trial_id, v_event_type, p_replacement_trial_id,
    trim(p_reason), p_actor_id, trim(p_client_revision_event_id), v_hash,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_result;

  return v_result;
exception
  when unique_violation then
    select * into v_existing
    from public.aba_trial_revisions_v3 revision
    where revision.organization_id = p_organization_id
      and revision.client_revision_event_id = trim(p_client_revision_event_id);

    if found and v_existing.revision_hash = v_hash then
      return v_existing;
    end if;
    raise;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Quarantine resolver. No manual De/Para is possible: READY_FOR_RETRY requires
-- the exact original version UUID to exist. RESOLVED is normally set by ingest.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_aba_sync_quarantine_v3(
  p_quarantine_id uuid,
  p_action text,
  p_actor_id uuid,
  p_reason text default null
)
returns public.aba_sync_quarantine_v3
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_row public.aba_sync_quarantine_v3%rowtype;
  v_action text := upper(trim(coalesce(p_action, '')));
begin
  select * into v_row
  from public.aba_sync_quarantine_v3 quarantine
  where quarantine.id = p_quarantine_id
  for update;

  if not found then
    raise exception 'ABA_V3_QUARANTINE_NOT_FOUND';
  end if;

  if v_row.status in ('RESOLVED', 'DISCARDED') then
    return v_row;
  end if;

  if v_action = 'READY_FOR_RETRY' then
    if v_row.reason_code = 'COLLECTION_VERSION_MISSING' then
      if v_row.original_collection_definition_version_id is null
         or not exists (
           select 1
           from public.aba_collection_definition_versions_v3 definition
           where definition.id = v_row.original_collection_definition_version_id
             and definition.organization_id = v_row.organization_id
             and definition.patient_id = v_row.patient_id
             and (v_row.target_id is null or definition.target_id = v_row.target_id)
         ) then
        raise exception 'ABA_V3_ORIGINAL_COLLECTION_VERSION_STILL_MISSING';
      end if;
    elsif v_row.reason_code = 'SESSION_MISSING' then
      if v_row.session_id is null or not exists (
        select 1 from public.aba_sessions session
        where session.id = v_row.session_id
          and session.patient_id = v_row.patient_id
          and session.clinic_id = v_row.organization_id::text
      ) then
        raise exception 'ABA_V3_ORIGINAL_SESSION_STILL_MISSING';
      end if;
    elsif v_row.reason_code = 'TARGET_MISSING' then
      if v_row.target_id is null or not exists (
        select 1 from public.aba_targets target
        where target.id = v_row.target_id
          and target.patient_id = v_row.patient_id
          and target.clinic_id = v_row.organization_id::text
      ) then
        raise exception 'ABA_V3_ORIGINAL_TARGET_STILL_MISSING';
      end if;
    elsif v_row.reason_code in ('TARGET_PHASE_MISSING', 'TARGET_PHASE_WINDOW_MISMATCH') then
      if v_row.original_target_phase_assignment_id is null
         or not exists (
           select 1
           from public.aba_target_phase_assignments_v3 phase
           where phase.id = v_row.original_target_phase_assignment_id
             and phase.organization_id = v_row.organization_id
             and phase.patient_id = v_row.patient_id
             and phase.target_id = v_row.target_id
             and phase.created_at <= public.aba_try_timestamptz_v3(v_row.original_payload ->> 'occurred_at')
             and phase.effective_from <= public.aba_try_timestamptz_v3(v_row.original_payload ->> 'occurred_at')
             and (
               phase.effective_until is null
               or public.aba_try_timestamptz_v3(v_row.original_payload ->> 'occurred_at') < phase.effective_until
             )
         ) then
        raise exception 'ABA_V3_ORIGINAL_PHASE_NOT_RECOVERABLE';
      end if;
    else
      raise exception 'ABA_V3_QUARANTINE_REASON_NOT_RETRYABLE';
    end if;

    update public.aba_sync_quarantine_v3
      set status = 'READY_FOR_RETRY',
          resolved_collection_definition_version_id = (
            select definition.id
            from public.aba_collection_definition_versions_v3 definition
            where definition.id = public.aba_sync_quarantine_v3.original_collection_definition_version_id
              and definition.organization_id = public.aba_sync_quarantine_v3.organization_id
              and definition.patient_id = public.aba_sync_quarantine_v3.patient_id
              and (
                public.aba_sync_quarantine_v3.target_id is null
                or definition.target_id = public.aba_sync_quarantine_v3.target_id
              )
            limit 1
          ),
          resolution_reason = coalesce(nullif(trim(p_reason), ''), 'ORIGINAL_DEPENDENCY_RECOVERED'),
          resolved_by = p_actor_id,
          last_seen_at = now()
    where id = p_quarantine_id
    returning * into v_row;

    return v_row;
  end if;

  if v_action = 'DISCARD' then
    if nullif(trim(p_reason), '') is null then
      raise exception 'ABA_V3_QUARANTINE_DISCARD_REASON_REQUIRED';
    end if;

    update public.aba_sync_quarantine_v3
      set status = 'DISCARDED',
          resolution_reason = trim(p_reason),
          resolved_by = p_actor_id,
          resolved_at = now(),
          last_seen_at = now()
    where id = p_quarantine_id
    returning * into v_row;

    return v_row;
  end if;

  raise exception 'ABA_V3_QUARANTINE_ACTION_INVALID';
end;
$function$;

-- ---------------------------------------------------------------------------
-- Bulk ingest. One call handles many trials; invalid but non-malicious clinical
-- events are isolated into quarantine instead of aborting valid siblings.
-- Cross-tenant identity mismatches fail the whole transaction closed.
-- ---------------------------------------------------------------------------
create or replace function public.record_aba_trials_bulk_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_trials jsonb,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_received integer;
  v_inserted integer := 0;
  v_duplicates integer := 0;
  v_quarantined integer := 0;
  v_cross_scope integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  if p_organization_id is null or p_patient_id is null then
    raise exception 'ABA_V3_BULK_SCOPE_REQUIRED';
  end if;

  if p_actor_id is null then
    raise exception 'ABA_V3_BULK_ACTOR_REQUIRED';
  end if;

  if p_trials is null or jsonb_typeof(p_trials) <> 'array' then
    raise exception 'ABA_V3_BULK_TRIALS_ARRAY_REQUIRED';
  end if;

  v_received := jsonb_array_length(p_trials);
  if v_received < 1 or v_received > 500 then
    raise exception 'ABA_V3_BULK_SIZE_OUT_OF_RANGE';
  end if;

  create temporary table if not exists aba_v3_ingest_stage (
    ordinal integer,
    event jsonb,
    client_event_id text,
    session_id text,
    target_id text,
    definition_id uuid,
    requested_phase_id uuid,
    resolved_phase_id uuid,
    trial_type text,
    occurred_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    source_device_id text,
    client_metadata jsonb,
    steps jsonb,
    payload_hash text,
    binding_id uuid,
    binding_model text,
    binding_definition_id uuid,
    validation_error text,
    existing_trial_id uuid,
    final_trial_id uuid,
    inserted_new boolean not null default false,
    batch_duplicate boolean not null default false,
    protocol_deprecated boolean not null default false
  ) on commit drop;

  truncate table pg_temp.aba_v3_ingest_stage;

  insert into pg_temp.aba_v3_ingest_stage (
    ordinal, event, client_event_id, session_id, target_id,
    definition_id, requested_phase_id, trial_type, occurred_at,
    started_at, completed_at, source_device_id, client_metadata,
    steps, payload_hash, validation_error
  )
  select
    ordinality::integer,
    item,
    nullif(trim(item ->> 'client_event_id'), ''),
    nullif(trim(item ->> 'session_id'), ''),
    nullif(trim(item ->> 'target_id'), ''),
    public.aba_try_uuid_v3(item ->> 'collection_definition_version_id'),
    public.aba_try_uuid_v3(item ->> 'target_phase_assignment_id'),
    upper(coalesce(nullif(trim(item ->> 'trial_type'), ''), 'TEACHING')),
    public.aba_try_timestamptz_v3(item ->> 'occurred_at'),
    public.aba_try_timestamptz_v3(item ->> 'started_at'),
    public.aba_try_timestamptz_v3(item ->> 'completed_at'),
    nullif(trim(item ->> 'source_device_id'), ''),
    case
      when jsonb_typeof(item -> 'client_metadata') = 'object' then item -> 'client_metadata'
      else '{}'::jsonb
    end,
    item -> 'steps',
    encode(digest(item::text, 'sha256'), 'hex'),
    case
      when jsonb_typeof(item) <> 'object' then 'MALFORMED_EVENT'
      when nullif(trim(item ->> 'client_event_id'), '') is null then 'CLIENT_EVENT_ID_REQUIRED'
      when length(trim(item ->> 'client_event_id')) > 240 then 'CLIENT_EVENT_ID_TOO_LONG'
      when nullif(trim(item ->> 'session_id'), '') is null then 'SESSION_ID_REQUIRED'
      when nullif(trim(item ->> 'target_id'), '') is null then 'TARGET_ID_REQUIRED'
      when public.aba_try_uuid_v3(item ->> 'collection_definition_version_id') is null then 'COLLECTION_VERSION_MISSING'
      when public.aba_try_timestamptz_v3(item ->> 'occurred_at') is null then 'OCCURRED_AT_INVALID'
      when nullif(trim(item ->> 'started_at'), '') is not null
        and public.aba_try_timestamptz_v3(item ->> 'started_at') is null then 'STARTED_AT_INVALID'
      when nullif(trim(item ->> 'completed_at'), '') is not null
        and public.aba_try_timestamptz_v3(item ->> 'completed_at') is null then 'COMPLETED_AT_INVALID'
      when nullif(trim(item ->> 'target_phase_assignment_id'), '') is not null
        and public.aba_try_uuid_v3(item ->> 'target_phase_assignment_id') is null then 'TARGET_PHASE_ID_INVALID'
      when upper(coalesce(nullif(trim(item ->> 'trial_type'), ''), 'TEACHING')) not in (
        'TEACHING', 'PROBE', 'BASELINE_PROBE', 'MAINTENANCE_PROBE',
        'GENERALIZATION', 'TASK_ANALYSIS', 'OTHER'
      ) then 'TRIAL_TYPE_INVALID'
      when jsonb_typeof(item -> 'steps') <> 'array' or jsonb_array_length(item -> 'steps') < 1 then 'TRIAL_STEPS_REQUIRED'
      else null
    end
  from jsonb_array_elements(p_trials) with ordinality as payload(item, ordinality);

  -- Security boundary: an existing session/target/version/phase from another
  -- organization or patient is not a quarantine case; it is a hard scope failure.
  select count(*) into v_cross_scope
  from pg_temp.aba_v3_ingest_stage stage
  join public.aba_sessions session on session.id = stage.session_id
  where session.clinic_id is distinct from p_organization_id::text
     or session.patient_id is distinct from p_patient_id;

  if v_cross_scope > 0 then
    raise exception 'ABA_V3_BULK_SESSION_CROSS_TENANT';
  end if;

  select count(*) into v_cross_scope
  from pg_temp.aba_v3_ingest_stage stage
  join public.aba_targets target on target.id = stage.target_id
  where target.clinic_id is distinct from p_organization_id::text
     or target.patient_id is distinct from p_patient_id;

  if v_cross_scope > 0 then
    raise exception 'ABA_V3_BULK_TARGET_CROSS_TENANT';
  end if;

  select count(*) into v_cross_scope
  from pg_temp.aba_v3_ingest_stage stage
  join public.aba_collection_definition_versions_v3 definition on definition.id = stage.definition_id
  where definition.organization_id is distinct from p_organization_id
     or definition.patient_id is distinct from p_patient_id
     or definition.target_id is distinct from stage.target_id;

  if v_cross_scope > 0 then
    raise exception 'ABA_V3_BULK_COLLECTION_VERSION_CROSS_TENANT';
  end if;

  select count(*) into v_cross_scope
  from pg_temp.aba_v3_ingest_stage stage
  join public.aba_target_phase_assignments_v3 phase on phase.id = stage.requested_phase_id
  where phase.organization_id is distinct from p_organization_id
     or phase.patient_id is distinct from p_patient_id
     or phase.target_id is distinct from stage.target_id;

  if v_cross_scope > 0 then
    raise exception 'ABA_V3_BULK_PHASE_CROSS_TENANT';
  end if;

  update pg_temp.aba_v3_ingest_stage stage
  set validation_error = 'SESSION_MISSING'
  where stage.validation_error is null
    and not exists (
      select 1 from public.aba_sessions session where session.id = stage.session_id
    );

  update pg_temp.aba_v3_ingest_stage stage
  set validation_error = 'TARGET_MISSING'
  where stage.validation_error is null
    and not exists (
      select 1 from public.aba_targets target where target.id = stage.target_id
    );

  update pg_temp.aba_v3_ingest_stage stage
  set validation_error = 'SESSION_TIME_WINDOW_MISMATCH'
  where stage.validation_error is null
    and exists (
      select 1
      from public.aba_sessions session
      where session.id = stage.session_id
        and (
          stage.occurred_at < session.started_at
          or (session.ended_at is not null and stage.occurred_at > session.ended_at)
        )
    );

  update pg_temp.aba_v3_ingest_stage stage
  set validation_error = 'TRIAL_TIME_ORDER_INVALID'
  where stage.validation_error is null
    and (
      (stage.started_at is not null and stage.started_at > stage.occurred_at)
      or (stage.completed_at is not null and stage.completed_at < stage.occurred_at)
      or (stage.started_at is not null and stage.completed_at is not null and stage.completed_at < stage.started_at)
    );

  update pg_temp.aba_v3_ingest_stage stage
  set validation_error = 'COLLECTION_VERSION_MISSING'
  where stage.validation_error is null
    and not exists (
      select 1
      from public.aba_collection_definition_versions_v3 definition
      where definition.id = stage.definition_id
        and definition.organization_id = p_organization_id
        and definition.patient_id = p_patient_id
        and definition.target_id = stage.target_id
    );

  -- Validate step shapes set-wise before any raw insert.
  update pg_temp.aba_v3_ingest_stage stage
  set validation_error = 'TRIAL_STEPS_INVALID'
  where stage.validation_error is null
    and exists (
      select 1
      from jsonb_array_elements(stage.steps) as step(item)
      where public.aba_try_integer_v3(step.item ->> 'sequence_no') is null
         or public.aba_try_integer_v3(step.item ->> 'sequence_no') <= 0
         or length(coalesce(step.item ->> 'client_step_event_id', '')) > 240
         or upper(coalesce(step.item ->> 'step_type', '')) not in ('RESPONSE', 'PROMPT', 'CORRECTION', 'TRANSFER', 'OTHER')
         or upper(coalesce(step.item ->> 'opportunity_role', '')) not in ('PRIMARY_INDEPENDENT', 'SUPPORT', 'CORRECTION', 'TRANSFER', 'OTHER')
         or upper(coalesce(step.item ->> 'outcome', '')) not in ('CORRECT', 'INCORRECT', 'NO_RESPONSE')
         or (
           upper(coalesce(step.item ->> 'opportunity_role', '')) = 'PRIMARY_INDEPENDENT'
           and (
             upper(coalesce(step.item ->> 'step_type', '')) <> 'RESPONSE'
             or nullif(trim(step.item ->> 'prompt_key'), '') is not null
           )
         )
         or (
           upper(coalesce(step.item ->> 'step_type', '')) = 'PROMPT'
           and nullif(trim(step.item ->> 'prompt_key'), '') is null
         )
         or (
           nullif(trim(step.item ->> 'latency_ms'), '') is not null
           and (
             public.aba_try_integer_v3(step.item ->> 'latency_ms') is null
             or public.aba_try_integer_v3(step.item ->> 'latency_ms') < 0
           )
         )
         or (
           nullif(trim(step.item ->> 'occurred_at'), '') is not null
           and public.aba_try_timestamptz_v3(step.item ->> 'occurred_at') is null
         )
    );

  update pg_temp.aba_v3_ingest_stage stage
  set validation_error = 'TRIAL_STEP_SEQUENCE_DUPLICATE'
  where stage.validation_error is null
    and (
      select count(*)
      from jsonb_array_elements(stage.steps) as step(item)
    ) <> (
      select count(distinct public.aba_try_integer_v3(step.item ->> 'sequence_no'))
      from jsonb_array_elements(stage.steps) as step(item)
    );

  update pg_temp.aba_v3_ingest_stage stage
  set validation_error = 'TRIAL_STEP_CLIENT_ID_DUPLICATE'
  where stage.validation_error is null
    and (
      select count(*)
      from jsonb_array_elements(stage.steps) as step(item)
      where nullif(trim(step.item ->> 'client_step_event_id'), '') is not null
    ) <> (
      select count(distinct trim(step.item ->> 'client_step_event_id'))
      from jsonb_array_elements(stage.steps) as step(item)
      where nullif(trim(step.item ->> 'client_step_event_id'), '') is not null
    );

  update pg_temp.aba_v3_ingest_stage stage
  set validation_error = 'PRIMARY_INDEPENDENT_OPPORTUNITY_DUPLICATE'
  where stage.validation_error is null
    and (
      select count(*)
      from jsonb_array_elements(stage.steps) as step(item)
      where upper(coalesce(step.item ->> 'opportunity_role', '')) = 'PRIMARY_INDEPENDENT'
    ) > 1;

  update pg_temp.aba_v3_ingest_stage stage
  set validation_error = 'TRIAL_STEP_SEQUENCE_GAP'
  where stage.validation_error is null
    and (
      select coalesce(min(public.aba_try_integer_v3(step.item ->> 'sequence_no')), 0) <> 1
          or coalesce(max(public.aba_try_integer_v3(step.item ->> 'sequence_no')), 0) <> count(*)
      from jsonb_array_elements(stage.steps) as step(item)
    );

  -- Duplicate client keys inside the same offline batch need deterministic
  -- treatment before INSERT. Conflicting payload hashes quarantine the whole key;
  -- exact repeats keep only the first row as the write candidate.
  update pg_temp.aba_v3_ingest_stage stage
  set validation_error = 'IDEMPOTENCY_PAYLOAD_CONFLICT'
  where stage.validation_error is null
    and stage.client_event_id in (
      select grouped.client_event_id
      from pg_temp.aba_v3_ingest_stage grouped
      where grouped.validation_error is null
      group by grouped.client_event_id
      having count(distinct grouped.payload_hash) > 1
    );

  update pg_temp.aba_v3_ingest_stage stage
  set batch_duplicate = true
  where stage.validation_error is null
    and stage.ordinal > (
      select min(first_row.ordinal)
      from pg_temp.aba_v3_ingest_stage first_row
      where first_row.validation_error is null
        and first_row.client_event_id = stage.client_event_id
        and first_row.payload_hash = stage.payload_hash
    );

  -- Resolve immutable session-target bindings only once per distinct valid pair.
  create temporary table if not exists aba_v3_binding_stage (
    session_id text,
    target_id text,
    binding_id uuid,
    binding_model text,
    definition_id uuid,
    primary key (session_id, target_id)
  ) on commit drop;
  truncate table pg_temp.aba_v3_binding_stage;

  insert into pg_temp.aba_v3_binding_stage (
    session_id, target_id, binding_id, binding_model, definition_id
  )
  select pair.session_id, pair.target_id,
         binding.id, binding.measurement_model_version,
         binding.collection_definition_version_id
  from (
    select distinct stage.session_id, stage.target_id
    from pg_temp.aba_v3_ingest_stage stage
    where stage.validation_error is null
      and stage.batch_duplicate = false
    order by stage.session_id, stage.target_id
  ) pair
  cross join lateral public.resolve_aba_session_target_measurement_binding_v1(
    p_organization_id,
    p_patient_id,
    pair.session_id,
    pair.target_id,
    p_actor_id
  ) binding;

  update pg_temp.aba_v3_ingest_stage stage
  set binding_id = binding.binding_id,
      binding_model = binding.binding_model,
      binding_definition_id = binding.definition_id
  from pg_temp.aba_v3_binding_stage binding
  where stage.session_id = binding.session_id
    and stage.target_id = binding.target_id
    and stage.validation_error is null;

  -- The current accept_v3_sync kill switch is authoritative for transport.
  -- allow_new_v3_sessions may be false during rollback, but sync must remain true
  -- for already-bound V3 sessions. If sync is explicitly disabled, abort the
  -- transaction so the device can safely retry later without partial commits.
  if exists (
    select 1
    from pg_temp.aba_v3_binding_stage binding
    join public.aba_targets target on target.id = binding.target_id
    where binding.binding_model = 'V3'
      and coalesce((public.resolve_aba_measurement_rollout_snapshot_v3(
        p_organization_id,
        p_patient_id,
        target.program_id,
        binding.target_id,
        v_now
      ) ->> 'accept_v3_sync')::boolean, false) = false
  ) then
    raise exception 'ABA_V3_SYNC_CURRENTLY_DISABLED';
  end if;

  update pg_temp.aba_v3_ingest_stage
  set validation_error = 'BINDING_NOT_V3'
  where validation_error is null
    and binding_model <> 'V3';

  update pg_temp.aba_v3_ingest_stage
  set validation_error = 'COLLECTION_VERSION_BINDING_MISMATCH'
  where validation_error is null
    and binding_definition_id is distinct from definition_id;

  -- Resolve/validate phase using event occurred_at. A phase may already be closed
  -- at sync time and still be valid for this historical event.
  update pg_temp.aba_v3_ingest_stage stage
  set resolved_phase_id = coalesce(
    stage.requested_phase_id,
    (
      select phase.id
      from public.aba_target_phase_assignments_v3 phase
      where phase.organization_id = p_organization_id
        and phase.patient_id = p_patient_id
        and phase.target_id = stage.target_id
        and phase.program_id = (select target.program_id from public.aba_targets target where target.id = stage.target_id)
        and phase.created_at <= stage.occurred_at
        and phase.effective_from <= stage.occurred_at
        and (phase.effective_until is null or stage.occurred_at < phase.effective_until)
      order by phase.effective_from desc
      limit 1
    )
  )
  where stage.validation_error is null;

  update pg_temp.aba_v3_ingest_stage stage
  set validation_error = 'TARGET_PHASE_MISSING'
  where stage.validation_error is null
    and stage.resolved_phase_id is null;

  update pg_temp.aba_v3_ingest_stage stage
  set validation_error = 'TARGET_PHASE_WINDOW_MISMATCH'
  where stage.validation_error is null
    and not exists (
      select 1
      from public.aba_target_phase_assignments_v3 phase
      where phase.id = stage.resolved_phase_id
        and phase.organization_id = p_organization_id
        and phase.patient_id = p_patient_id
        and phase.target_id = stage.target_id
        and phase.program_id = (select target.program_id from public.aba_targets target where target.id = stage.target_id)
        and phase.created_at <= stage.occurred_at
        and phase.effective_from <= stage.occurred_at
        and (phase.effective_until is null or stage.occurred_at < phase.effective_until)
    );

  -- Current lifecycle status never reinterprets the old event. It is only an
  -- audit flag so reviewers know the original version was deprecated by sync.
  update pg_temp.aba_v3_ingest_stage stage
  set protocol_deprecated = (
    definition.status <> 'PUBLISHED'
    or (definition.deprecated_at is not null and definition.deprecated_at <= v_now)
  )
  from public.aba_collection_definition_versions_v3 definition
  where stage.validation_error is null
    and definition.id = stage.definition_id;

  -- Idempotency is scoped by organization. Same key + same payload is a no-op;
  -- same key + different payload is quarantined as a conflict.
  update pg_temp.aba_v3_ingest_stage stage
  set existing_trial_id = trial.id,
      final_trial_id = trial.id,
      validation_error = case
        when trial.payload_hash = stage.payload_hash then stage.validation_error
        else 'IDEMPOTENCY_PAYLOAD_CONFLICT'
      end
  from public.aba_trials_v3 trial
  where stage.validation_error is null
    and trial.organization_id = p_organization_id
    and trial.client_event_id = stage.client_event_id;

  -- Invalid rows are held in stage until race reconciliation completes;
  -- quarantine is written once near the end of the transaction.

  -- Generate IDs only for new valid events. Existing idempotent events are never
  -- rewritten and their steps are not reinserted.
  update pg_temp.aba_v3_ingest_stage stage
  set final_trial_id = gen_random_uuid()
  where stage.validation_error is null
    and stage.existing_trial_id is null
    and stage.batch_duplicate = false;

  with inserted as (
    insert into public.aba_trials_v3 (
      id, organization_id, patient_id, session_id, program_id, target_id,
      binding_id, collection_definition_version_id, target_phase_assignment_id,
      client_event_id, trial_type, occurred_at, started_at, completed_at,
      collector_user_id, source_device_id, protocol_version_deprecated_at_sync,
      payload_hash, client_metadata
    )
    select
      stage.final_trial_id,
      p_organization_id,
      p_patient_id,
      stage.session_id,
      target.program_id,
      stage.target_id,
      stage.binding_id,
      stage.definition_id,
      stage.resolved_phase_id,
      stage.client_event_id,
      stage.trial_type,
      stage.occurred_at,
      stage.started_at,
      stage.completed_at,
      p_actor_id,
      stage.source_device_id,
      stage.protocol_deprecated,
      stage.payload_hash,
      stage.client_metadata
    from pg_temp.aba_v3_ingest_stage stage
    join public.aba_targets target on target.id = stage.target_id
    where stage.validation_error is null
      and stage.existing_trial_id is null
      and stage.batch_duplicate = false
    on conflict (organization_id, client_event_id) do nothing
    returning id, organization_id, client_event_id, payload_hash
  )
  update pg_temp.aba_v3_ingest_stage stage
  set inserted_new = true,
      final_trial_id = inserted.id
  from inserted
  where inserted.organization_id = p_organization_id
    and inserted.client_event_id = stage.client_event_id
    and inserted.payload_hash = stage.payload_hash
    and stage.batch_duplicate = false;

  -- Race-safe reconciliation: another request may have won after our first
  -- duplicate check. Same payload becomes an idempotent duplicate; mismatch is
  -- quarantined and never receives steps.
  update pg_temp.aba_v3_ingest_stage stage
  set existing_trial_id = trial.id,
      final_trial_id = trial.id,
      validation_error = case
        when trial.payload_hash = stage.payload_hash then null
        else 'IDEMPOTENCY_PAYLOAD_CONFLICT'
      end
  from public.aba_trials_v3 trial
  where stage.validation_error is null
    and stage.inserted_new = false
    and trial.organization_id = p_organization_id
    and trial.client_event_id = stage.client_event_id;

  update pg_temp.aba_v3_ingest_stage duplicate_row
  set final_trial_id = canonical.final_trial_id,
      existing_trial_id = canonical.final_trial_id,
      protocol_deprecated = canonical.protocol_deprecated,
      validation_error = canonical.validation_error
  from pg_temp.aba_v3_ingest_stage canonical
  where duplicate_row.batch_duplicate = true
    and canonical.batch_duplicate = false
    and canonical.client_event_id = duplicate_row.client_event_id
    and canonical.payload_hash = duplicate_row.payload_hash;

  -- Write quarantine once after every deterministic validation/race decision.
  insert into public.aba_sync_quarantine_v3 (
    organization_id, patient_id, session_id, target_id, client_event_id, reason_code,
    original_payload, payload_hash,
    original_collection_definition_version_id,
    original_target_phase_assignment_id, occurrence_count
  )
  select
    p_organization_id, p_patient_id, min(stage.session_id), min(stage.target_id),
    coalesce(stage.client_event_id, 'missing:' || stage.payload_hash),
    stage.validation_error, min(stage.event::text)::jsonb, stage.payload_hash,
    min(stage.definition_id::text)::uuid, min(stage.requested_phase_id::text)::uuid,
    count(*)::integer
  from pg_temp.aba_v3_ingest_stage stage
  where stage.validation_error is not null
  group by stage.client_event_id, stage.validation_error, stage.payload_hash
  on conflict (organization_id, client_event_id, payload_hash, reason_code)
  do update set
    last_seen_at = now(),
    occurrence_count = public.aba_sync_quarantine_v3.occurrence_count + excluded.occurrence_count;

  -- Complex trial is atomic: all ordered steps for a newly inserted envelope are
  -- persisted in the same transaction. No partial chain can commit.
  insert into public.aba_trial_steps_v3 (
    trial_id, sequence_no, client_step_event_id, step_type, opportunity_role,
    outcome, prompt_key, latency_ms, occurred_at, metadata
  )
  select
    stage.final_trial_id,
    public.aba_try_integer_v3(step.item ->> 'sequence_no'),
    nullif(trim(step.item ->> 'client_step_event_id'), ''),
    upper(step.item ->> 'step_type'),
    upper(step.item ->> 'opportunity_role'),
    upper(step.item ->> 'outcome'),
    nullif(trim(step.item ->> 'prompt_key'), ''),
    public.aba_try_integer_v3(step.item ->> 'latency_ms'),
    coalesce(public.aba_try_timestamptz_v3(step.item ->> 'occurred_at'), stage.occurred_at),
    case
      when jsonb_typeof(step.item -> 'metadata') = 'object' then step.item -> 'metadata'
      else '{}'::jsonb
    end
  from pg_temp.aba_v3_ingest_stage stage
  cross join lateral jsonb_array_elements(stage.steps) as step(item)
  where stage.inserted_new = true
    and stage.validation_error is null
  order by stage.ordinal, public.aba_try_integer_v3(step.item ->> 'sequence_no');

  -- One exposure promotion per distinct session+target in this transaction. The
  -- WHERE guard prevents ten offline trials from generating ten audit transitions.
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || affected.session_id || ':' || affected.target_id,
      0
    )
  )
  from (
    select distinct stage.session_id, stage.target_id
    from pg_temp.aba_v3_ingest_stage stage
    where stage.inserted_new = true
      and stage.validation_error is null
  ) affected
  order by affected.session_id, affected.target_id;

  insert into public.aba_session_target_exposures_v3 (
    organization_id, patient_id, session_id, program_id, target_id,
    exposure_status, reason_code, reason_text, declared_by, updated_by,
    last_change_reason, triggering_trial_id
  )
  select
    p_organization_id,
    p_patient_id,
    affected.session_id,
    target.program_id,
    affected.target_id,
    'COLLECTED',
    'TRIAL_RECORDED',
    null,
    p_actor_id,
    p_actor_id,
    'FIRST_OR_NEW_VALID_TRIAL',
    affected.triggering_trial_id
  from (
    select distinct on (stage.session_id, stage.target_id)
      stage.session_id, stage.target_id, stage.final_trial_id as triggering_trial_id
    from pg_temp.aba_v3_ingest_stage stage
    where stage.inserted_new = true
      and stage.validation_error is null
    order by stage.session_id, stage.target_id, stage.ordinal
  ) affected
  join public.aba_targets target on target.id = affected.target_id
  on conflict (session_id, target_id) do update
    set exposure_status = 'COLLECTED',
        reason_code = 'TRIAL_RECORDED',
        reason_text = null,
        state_version = public.aba_session_target_exposures_v3.state_version + 1,
        updated_by = excluded.updated_by,
        updated_at = now(),
        last_change_reason = 'VALID_TRIAL_PROMOTED_EXPOSURE',
        triggering_trial_id = excluded.triggering_trial_id
  where public.aba_session_target_exposures_v3.exposure_status <> 'COLLECTED';

  -- If an item was previously quarantined only because an original version/phase
  -- was missing, a later successful retry resolves that exact original event. No
  -- version remapping is possible because the resolved UUID must equal original.
  update public.aba_sync_quarantine_v3 quarantine
  set status = 'RESOLVED',
      resolved_collection_definition_version_id = quarantine.original_collection_definition_version_id,
      resolution_reason = 'ORIGINAL_EVENT_ACCEPTED',
      resolved_by = p_actor_id,
      resolved_at = now(),
      last_seen_at = now()
  from pg_temp.aba_v3_ingest_stage stage
  where stage.validation_error is null
    and stage.final_trial_id is not null
    and quarantine.organization_id = p_organization_id
    and quarantine.patient_id = p_patient_id
    and quarantine.client_event_id = stage.client_event_id
    and quarantine.payload_hash = stage.payload_hash
    and quarantine.status in ('OPEN', 'READY_FOR_RETRY')
    and quarantine.original_collection_definition_version_id = stage.definition_id;

  select count(*) into v_inserted
  from pg_temp.aba_v3_ingest_stage stage
  where stage.inserted_new = true
    and stage.validation_error is null;

  select count(*) into v_duplicates
  from pg_temp.aba_v3_ingest_stage stage
  where stage.validation_error is null
    and stage.inserted_new = false
    and stage.final_trial_id is not null;

  select count(*) into v_quarantined
  from pg_temp.aba_v3_ingest_stage stage
  where stage.validation_error is not null;

  return jsonb_build_object(
    'received', v_received,
    'inserted', v_inserted,
    'duplicates', v_duplicates,
    'quarantined', v_quarantined,
    'accepted', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client_event_id', stage.client_event_id,
        'trial_id', stage.final_trial_id,
        'inserted', stage.inserted_new,
        'protocol_version_deprecated_at_sync', stage.protocol_deprecated
      ) order by stage.ordinal)
      from pg_temp.aba_v3_ingest_stage stage
      where stage.validation_error is null
        and stage.final_trial_id is not null
    ), '[]'::jsonb),
    'quarantine', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client_event_id', stage.client_event_id,
        'reason_code', stage.validation_error
      ) order by stage.ordinal)
      from pg_temp.aba_v3_ingest_stage stage
      where stage.validation_error is not null
    ), '[]'::jsonb)
  );
end;
$function$;

-- Single-event wrapper intentionally delegates to the exact same bulk engine.
create or replace function public.record_aba_trial_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_trial jsonb,
  p_actor_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select public.record_aba_trials_bulk_v3(
    p_organization_id,
    p_patient_id,
    jsonb_build_array(p_trial),
    p_actor_id
  );
$function$;

-- ---------------------------------------------------------------------------
-- RLS / grants: PR3 remains dark and service-role only.
-- ---------------------------------------------------------------------------
alter table public.aba_trials_v3 enable row level security;
alter table public.aba_trial_steps_v3 enable row level security;
alter table public.aba_session_target_exposures_v3 enable row level security;
alter table public.aba_session_target_exposure_events_v3 enable row level security;
alter table public.aba_trial_revisions_v3 enable row level security;
alter table public.aba_sync_quarantine_v3 enable row level security;
alter table public.aba_sync_quarantine_events_v3 enable row level security;

revoke all on table public.aba_trials_v3 from public, anon, authenticated;
revoke all on table public.aba_trial_steps_v3 from public, anon, authenticated;
revoke all on table public.aba_session_target_exposures_v3 from public, anon, authenticated;
revoke all on table public.aba_session_target_exposure_events_v3 from public, anon, authenticated;
revoke all on table public.aba_trial_revisions_v3 from public, anon, authenticated;
revoke all on table public.aba_sync_quarantine_v3 from public, anon, authenticated;
revoke all on table public.aba_sync_quarantine_events_v3 from public, anon, authenticated;

grant all on table public.aba_trials_v3 to service_role;
grant all on table public.aba_trial_steps_v3 to service_role;
grant all on table public.aba_session_target_exposures_v3 to service_role;
grant all on table public.aba_session_target_exposure_events_v3 to service_role;
grant all on table public.aba_trial_revisions_v3 to service_role;
grant all on table public.aba_sync_quarantine_v3 to service_role;
grant all on table public.aba_sync_quarantine_events_v3 to service_role;

revoke all on function public.guard_aba_v3_append_only_raw() from public, anon, authenticated;
revoke all on function public.validate_aba_trial_v3_scope() from public, anon, authenticated;
revoke all on function public.guard_aba_target_phase_assignment_history_v3() from public, anon, authenticated;
revoke all on function public.validate_aba_v3_binding_temporal_context() from public, anon, authenticated;
revoke all on function public.validate_aba_exposure_v3_scope() from public, anon, authenticated;
revoke all on function public.audit_aba_exposure_state_v3() from public, anon, authenticated;
revoke all on function public.guard_aba_sync_quarantine_v3() from public, anon, authenticated;
revoke all on function public.audit_aba_sync_quarantine_state_v3() from public, anon, authenticated;
revoke all on function public.aba_try_uuid_v3(text) from public, anon, authenticated;
revoke all on function public.aba_try_timestamptz_v3(text) from public, anon, authenticated;
revoke all on function public.aba_try_integer_v3(text) from public, anon, authenticated;
revoke all on function public.set_aba_session_target_exposure_v3(uuid, uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.record_aba_trial_revision_v3(uuid, uuid, text, uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.resolve_aba_sync_quarantine_v3(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.record_aba_trials_bulk_v3(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.record_aba_trial_v3(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

grant execute on function public.set_aba_session_target_exposure_v3(uuid, uuid, text, text, text, text, text, uuid) to service_role;
grant execute on function public.record_aba_trial_revision_v3(uuid, uuid, text, uuid, text, text, uuid, jsonb) to service_role;
grant execute on function public.resolve_aba_sync_quarantine_v3(uuid, text, uuid, text) to service_role;
grant execute on function public.record_aba_trials_bulk_v3(uuid, uuid, jsonb, uuid) to service_role;
grant execute on function public.record_aba_trial_v3(uuid, uuid, jsonb, uuid) to service_role;

-- PR3 deliberately creates no rollout state and changes no V2 table/route.

commit;
