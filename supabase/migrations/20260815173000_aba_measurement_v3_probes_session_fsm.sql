-- ABA Measurement V3 - PR6 maintenance probes, session finalization and clinical FSM.
-- Additive/dark only. ABA Legacy V2 remains authoritative for its own data.
-- V3 summaries are never supplied by the browser; V3 finalization derives from raw facts.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Immutable criterion snapshots. No implicit 80% exists in V3.
-- Automatic mastery evaluation is disabled unless its explicit fields are complete.
-- ---------------------------------------------------------------------------
create table if not exists public.aba_mastery_criterion_versions_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  program_id text not null references public.aba_programs(id) on delete restrict,
  target_id text not null references public.aba_targets(id) on delete restrict,
  version integer not null check (version > 0),
  metric_key text not null default 'PRIMARY_INDEPENDENCE_PERCENT'
    check (metric_key in ('PRIMARY_INDEPENDENCE_PERCENT')),
  auto_mastery_enabled boolean not null default false,
  mastery_min_eligible_trials integer check (mastery_min_eligible_trials is null or mastery_min_eligible_trials > 0),
  mastery_threshold_percent numeric(7,4)
    check (mastery_threshold_percent is null or (mastery_threshold_percent >= 0 and mastery_threshold_percent <= 100)),
  mastery_consecutive_sessions integer
    check (mastery_consecutive_sessions is null or mastery_consecutive_sessions > 0),
  maintenance_enabled boolean not null default false,
  maintenance_min_eligible_trials integer
    check (maintenance_min_eligible_trials is null or maintenance_min_eligible_trials > 0),
  maintenance_threshold_percent numeric(7,4)
    check (maintenance_threshold_percent is null or (maintenance_threshold_percent >= 0 and maintenance_threshold_percent <= 100)),
  maintenance_consecutive_below integer not null default 2
    check (maintenance_consecutive_below > 0),
  definition jsonb not null default '{}'::jsonb,
  definition_hash text not null,
  published_at timestamptz not null default now(),
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint aba_mastery_criterion_versions_v3_definition_object
    check (jsonb_typeof(definition) = 'object'),
  constraint aba_mastery_criterion_versions_v3_hash
    check (definition_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_mastery_criterion_versions_v3_mastery_shape check (
    not auto_mastery_enabled
    or (
      mastery_min_eligible_trials is not null
      and mastery_threshold_percent is not null
      and mastery_consecutive_sessions is not null
    )
  ),
  constraint aba_mastery_criterion_versions_v3_maintenance_shape check (
    not maintenance_enabled
    or (
      maintenance_min_eligible_trials is not null
      and maintenance_threshold_percent is not null
    )
  ),
  unique (organization_id, target_id, version),
  unique (id, organization_id, patient_id, target_id)
);

create index if not exists idx_aba_mastery_criterion_versions_v3_target
  on public.aba_mastery_criterion_versions_v3
  (organization_id, patient_id, target_id, version desc);

create or replace function public.validate_aba_mastery_criterion_scope_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
begin
  if new.definition_hash is distinct from encode(
    digest(convert_to(new.definition::text, 'UTF8'), 'sha256'),
    'hex'
  ) then
    raise exception 'ABA_V3_CRITERION_DEFINITION_HASH_INVALID';
  end if;

  if not exists (
    select 1
    from public.aba_targets target
    where target.id = new.target_id
      and target.patient_id = new.patient_id
      and target.clinic_id = new.organization_id::text
      and target.program_id = new.program_id
  ) then
    raise exception 'ABA_V3_CRITERION_TARGET_SCOPE_INVALID';
  end if;
  return new;
end;
$function$;

drop trigger if exists validate_aba_mastery_criterion_scope_v3
  on public.aba_mastery_criterion_versions_v3;
create trigger validate_aba_mastery_criterion_scope_v3
before insert on public.aba_mastery_criterion_versions_v3
for each row execute function public.validate_aba_mastery_criterion_scope_v3();

create or replace function public.guard_aba_mastery_criterion_version_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'ABA_V3_CRITERION_VERSION_IMMUTABLE';
end;
$function$;

drop trigger if exists guard_aba_mastery_criterion_version_v3
  on public.aba_mastery_criterion_versions_v3;
create trigger guard_aba_mastery_criterion_version_v3
before update or delete on public.aba_mastery_criterion_versions_v3
for each row execute function public.guard_aba_mastery_criterion_version_v3();

-- ---------------------------------------------------------------------------
-- Maintenance probe lifecycle is distinct from its clinical interpretation.
-- INCOMPLETE is never treated as failure. Only COMPLETE + ELIGIBLE can feed FSM.
-- ---------------------------------------------------------------------------
create table if not exists public.aba_maintenance_probes_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text not null references public.aba_sessions(id) on delete restrict,
  program_id text not null references public.aba_programs(id) on delete restrict,
  target_id text not null references public.aba_targets(id) on delete restrict,
  target_phase_assignment_id uuid not null
    references public.aba_target_phase_assignments_v3(id) on delete restrict,
  criterion_version_id uuid not null
    references public.aba_mastery_criterion_versions_v3(id) on delete restrict,
  probe_key text not null,
  lifecycle_status text not null default 'OPEN'
    check (lifecycle_status in ('OPEN','COMPLETE','INCOMPLETE','CANCELLED')),
  eligibility_status text not null default 'PENDING'
    check (eligibility_status in ('PENDING','ELIGIBLE','INELIGIBLE')),
  evaluation_result text not null default 'NOT_EVALUATED'
    check (evaluation_result in ('NOT_EVALUATED','PASSED','BELOW_CRITERION')),
  required_eligible_trials_snapshot integer not null check (required_eligible_trials_snapshot > 0),
  threshold_percent_snapshot numeric(7,4) not null
    check (threshold_percent_snapshot >= 0 and threshold_percent_snapshot <= 100),
  consecutive_below_snapshot integer not null default 2 check (consecutive_below_snapshot > 0),
  eligible_trial_count integer not null default 0 check (eligible_trial_count >= 0),
  primary_correct_count integer not null default 0 check (primary_correct_count >= 0),
  primary_independence_percent numeric(7,4)
    check (primary_independence_percent is null or (primary_independence_percent >= 0 and primary_independence_percent <= 100)),
  source_projection_hash text,
  evidence_status text not null default 'CURRENT'
    check (evidence_status in ('CURRENT','STALE_REVIEW_REQUIRED')),
  requires_review boolean not null default false,
  last_evidence_revision_at timestamptz,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  close_reason text check (close_reason is null or close_reason in ('SESSION_COMPLETION','MANUAL_CLOSE','MANUAL_CANCEL')),
  opened_by uuid,
  closed_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aba_maintenance_probes_v3_probe_key_nonempty check (length(trim(probe_key)) between 1 and 180),
  constraint aba_maintenance_probes_v3_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint aba_maintenance_probes_v3_projection_hash
    check (source_projection_hash is null or source_projection_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_maintenance_probes_v3_evidence_review_shape
    check ((evidence_status = 'CURRENT' and not requires_review) or (evidence_status = 'STALE_REVIEW_REQUIRED' and requires_review)),
  foreign key (criterion_version_id, organization_id, patient_id, target_id)
    references public.aba_mastery_criterion_versions_v3(id, organization_id, patient_id, target_id) on delete restrict,
  foreign key (target_phase_assignment_id, organization_id, patient_id, target_id)
    references public.aba_target_phase_assignments_v3(id, organization_id, patient_id, target_id) on delete restrict,
  constraint aba_maintenance_probes_v3_close_shape check (
    (lifecycle_status = 'OPEN' and closed_at is null and close_reason is null and eligibility_status = 'PENDING' and evaluation_result = 'NOT_EVALUATED')
    or
    (lifecycle_status = 'COMPLETE' and closed_at is not null and eligibility_status = 'ELIGIBLE' and evaluation_result in ('PASSED','BELOW_CRITERION'))
    or
    (lifecycle_status = 'INCOMPLETE' and closed_at is not null and eligibility_status = 'INELIGIBLE' and evaluation_result = 'NOT_EVALUATED')
    or
    (lifecycle_status = 'CANCELLED' and closed_at is not null and eligibility_status = 'INELIGIBLE' and evaluation_result = 'NOT_EVALUATED')
  ),
  unique (organization_id, probe_key),
  unique (id, organization_id, patient_id, session_id, target_id)
);

create unique index if not exists ux_aba_maintenance_probes_v3_one_open_per_target_session
  on public.aba_maintenance_probes_v3(session_id, target_id)
  where lifecycle_status = 'OPEN';

create index if not exists idx_aba_maintenance_probes_v3_target_timeline
  on public.aba_maintenance_probes_v3
  (organization_id, patient_id, target_id, closed_at desc, opened_at desc);

create table if not exists public.aba_maintenance_probe_trials_v3 (
  probe_id uuid not null references public.aba_maintenance_probes_v3(id) on delete restrict,
  trial_id uuid not null references public.aba_trials_v3(id) on delete restrict,
  linked_at timestamptz not null default now(),
  linked_by uuid,
  primary key (probe_id, trial_id),
  unique (trial_id)
);

create index if not exists idx_aba_maintenance_probe_trials_v3_probe
  on public.aba_maintenance_probe_trials_v3(probe_id, trial_id);

create or replace function public.validate_aba_maintenance_probe_trial_link_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_probe public.aba_maintenance_probes_v3%rowtype;
  v_trial public.aba_trials_v3%rowtype;
begin
  select * into v_probe from public.aba_maintenance_probes_v3 where id = new.probe_id;
  select * into v_trial from public.aba_trials_v3 where id = new.trial_id;

  if v_probe.id is null or v_trial.id is null
     or v_probe.lifecycle_status <> 'OPEN'
     or v_trial.organization_id is distinct from v_probe.organization_id
     or v_trial.patient_id is distinct from v_probe.patient_id
     or v_trial.session_id is distinct from v_probe.session_id
     or v_trial.target_id is distinct from v_probe.target_id
     or v_trial.target_phase_assignment_id is distinct from v_probe.target_phase_assignment_id
     or v_trial.trial_type <> 'MAINTENANCE_PROBE' then
    raise exception 'ABA_V3_PROBE_TRIAL_SCOPE_INVALID';
  end if;
  return new;
end;
$function$;

drop trigger if exists validate_aba_maintenance_probe_trial_link_v3
  on public.aba_maintenance_probe_trials_v3;
create trigger validate_aba_maintenance_probe_trial_link_v3
before insert on public.aba_maintenance_probe_trials_v3
for each row execute function public.validate_aba_maintenance_probe_trial_link_v3();

create or replace function public.guard_aba_maintenance_probe_trial_link_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'ABA_V3_PROBE_TRIAL_LINK_APPEND_ONLY';
end;
$function$;

drop trigger if exists guard_aba_maintenance_probe_trial_link_v3
  on public.aba_maintenance_probe_trials_v3;
create trigger guard_aba_maintenance_probe_trial_link_v3
before update or delete on public.aba_maintenance_probe_trials_v3
for each row execute function public.guard_aba_maintenance_probe_trial_link_v3();

-- ---------------------------------------------------------------------------
-- Explicit, versioned finite-state machine. No "regression" diagnosis is emitted.
-- Automatic transitions are limited to objective criteria-met / maintenance-alert.
-- Reacquisition is always a human decision.
-- ---------------------------------------------------------------------------
create table if not exists public.aba_target_clinical_states_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  program_id text not null references public.aba_programs(id) on delete restrict,
  target_id text not null references public.aba_targets(id) on delete restrict,
  state text not null check (state in (
    'ACQUISITION','MASTERY_CRITERIA_MET','MASTERED','MAINTENANCE',
    'MAINTENANCE_ALERT','REACQUISITION','PAUSED','DISCONTINUED'
  )),
  state_version bigint not null default 1 check (state_version > 0),
  criterion_version_id uuid references public.aba_mastery_criterion_versions_v3(id) on delete restrict,
  initialized_by uuid,
  updated_by uuid,
  initialized_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_reason text,
  foreign key (criterion_version_id, organization_id, patient_id, target_id)
    references public.aba_mastery_criterion_versions_v3(id, organization_id, patient_id, target_id) on delete restrict,
  unique (organization_id, patient_id, target_id),
  unique (id, organization_id, patient_id, target_id)
);

create table if not exists public.aba_target_clinical_state_events_v3 (
  id uuid primary key default gen_random_uuid(),
  clinical_state_id uuid not null references public.aba_target_clinical_states_v3(id) on delete restrict,
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  target_id text not null references public.aba_targets(id) on delete restrict,
  from_state text,
  to_state text not null,
  state_version bigint not null check (state_version > 0),
  transition_kind text not null check (transition_kind in ('INITIALIZE','AUTO','HUMAN')),
  reason_code text not null,
  reason_text text,
  criterion_version_id uuid references public.aba_mastery_criterion_versions_v3(id) on delete restrict,
  probe_id uuid references public.aba_maintenance_probes_v3(id) on delete restrict,
  session_id text references public.aba_sessions(id) on delete restrict,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  actor_id uuid,
  occurred_at timestamptz not null default now(),
  constraint aba_target_clinical_state_events_v3_evidence_object check (jsonb_typeof(evidence_snapshot) = 'object'),
  unique (clinical_state_id, state_version)
);

create index if not exists idx_aba_target_clinical_state_events_v3_timeline
  on public.aba_target_clinical_state_events_v3
  (organization_id, patient_id, target_id, state_version desc);

create or replace function public.guard_aba_target_clinical_state_event_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'ABA_V3_FSM_EVENT_APPEND_ONLY';
end;
$function$;

drop trigger if exists guard_aba_target_clinical_state_event_v3
  on public.aba_target_clinical_state_events_v3;
create trigger guard_aba_target_clinical_state_event_v3
before update or delete on public.aba_target_clinical_state_events_v3
for each row execute function public.guard_aba_target_clinical_state_event_v3();

-- Criterion publication is server-side: version number and hash are never trusted
-- from the browser/client. Publishing creates a new immutable row.
create or replace function public.publish_aba_mastery_criterion_version_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_target_id text,
  p_actor_id uuid,
  p_auto_mastery_enabled boolean,
  p_mastery_min_eligible_trials integer,
  p_mastery_threshold_percent numeric,
  p_mastery_consecutive_sessions integer,
  p_maintenance_enabled boolean,
  p_maintenance_min_eligible_trials integer,
  p_maintenance_threshold_percent numeric,
  p_maintenance_consecutive_below integer default 2,
  p_definition jsonb default '{}'::jsonb
)
returns public.aba_mastery_criterion_versions_v3
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_target public.aba_targets%rowtype;
  v_result public.aba_mastery_criterion_versions_v3%rowtype;
  v_role text;
  v_version integer;
  v_definition jsonb := coalesce(p_definition, '{}'::jsonb);
  v_hash text;
begin
  if p_actor_id is null or jsonb_typeof(v_definition) <> 'object' then
    raise exception 'ABA_V3_CRITERION_PUBLISH_INPUT_INVALID';
  end if;

  v_role := public.verto_clinic_actor_role_v1(p_actor_id, p_organization_id);
  if coalesce(v_role, '') not in ('owner','admin','director','coordinator') then
    raise exception 'ABA_V3_CRITERION_PUBLISH_ACCESS_DENIED';
  end if;

  select * into v_target
  from public.aba_targets target
  where target.id = p_target_id
    and target.patient_id = p_patient_id
    and target.clinic_id = p_organization_id::text;
  if not found or v_target.program_id is null then
    raise exception 'ABA_V3_CRITERION_TARGET_SCOPE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('aba-v3-criterion:' || p_organization_id::text || ':' || p_target_id, 0));

  select coalesce(max(criterion.version), 0) + 1
  into v_version
  from public.aba_mastery_criterion_versions_v3 criterion
  where criterion.organization_id = p_organization_id
    and criterion.target_id = p_target_id;

  v_hash := encode(digest(convert_to(v_definition::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.aba_mastery_criterion_versions_v3 (
    organization_id, patient_id, program_id, target_id, version,
    auto_mastery_enabled, mastery_min_eligible_trials, mastery_threshold_percent,
    mastery_consecutive_sessions, maintenance_enabled,
    maintenance_min_eligible_trials, maintenance_threshold_percent,
    maintenance_consecutive_below, definition, definition_hash, created_by
  ) values (
    p_organization_id, p_patient_id, v_target.program_id, p_target_id, v_version,
    coalesce(p_auto_mastery_enabled, false), p_mastery_min_eligible_trials, p_mastery_threshold_percent,
    p_mastery_consecutive_sessions, coalesce(p_maintenance_enabled, false),
    p_maintenance_min_eligible_trials, p_maintenance_threshold_percent,
    coalesce(p_maintenance_consecutive_below, 2), v_definition, v_hash, p_actor_id
  ) returning * into v_result;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Human initialization is explicit. V2 clinical state is never inferred/backfilled.
-- ---------------------------------------------------------------------------
create or replace function public.initialize_aba_target_clinical_state_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_target_id text,
  p_initial_state text,
  p_criterion_version_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns public.aba_target_clinical_states_v3
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_target public.aba_targets%rowtype;
  v_criterion public.aba_mastery_criterion_versions_v3%rowtype;
  v_result public.aba_target_clinical_states_v3%rowtype;
  v_role text;
  v_state text := upper(trim(coalesce(p_initial_state, '')));
begin
  if p_actor_id is null or nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'ABA_V3_FSM_INITIALIZATION_ACTOR_REASON_REQUIRED';
  end if;

  if v_state not in ('ACQUISITION','MASTERED','MAINTENANCE','PAUSED','DISCONTINUED') then
    raise exception 'ABA_V3_FSM_INITIAL_STATE_INVALID';
  end if;

  v_role := public.verto_clinic_actor_role_v1(p_actor_id, p_organization_id);
  if coalesce(v_role, '') not in ('owner','admin','director','coordinator') then
    raise exception 'ABA_V3_FSM_INITIALIZATION_ACCESS_DENIED';
  end if;

  select * into v_target
  from public.aba_targets target
  where target.id = p_target_id
    and target.patient_id = p_patient_id
    and target.clinic_id = p_organization_id::text;

  if not found or v_target.program_id is null then
    raise exception 'ABA_V3_FSM_TARGET_SCOPE_INVALID';
  end if;

  if p_criterion_version_id is not null then
    select * into v_criterion
    from public.aba_mastery_criterion_versions_v3 criterion
    where criterion.id = p_criterion_version_id
      and criterion.organization_id = p_organization_id
      and criterion.patient_id = p_patient_id
      and criterion.target_id = p_target_id;
    if not found then
      raise exception 'ABA_V3_FSM_CRITERION_SCOPE_INVALID';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('aba-v3-fsm:' || p_organization_id::text || ':' || p_target_id, 0));

  if exists (
    select 1 from public.aba_target_clinical_states_v3 state
    where state.organization_id = p_organization_id
      and state.patient_id = p_patient_id
      and state.target_id = p_target_id
  ) then
    raise exception 'ABA_V3_FSM_ALREADY_INITIALIZED';
  end if;

  insert into public.aba_target_clinical_states_v3 (
    organization_id, patient_id, program_id, target_id, state,
    criterion_version_id, initialized_by, updated_by, last_reason
  ) values (
    p_organization_id, p_patient_id, v_target.program_id, p_target_id, v_state,
    p_criterion_version_id, p_actor_id, p_actor_id, trim(p_reason)
  ) returning * into v_result;

  insert into public.aba_target_clinical_state_events_v3 (
    clinical_state_id, organization_id, patient_id, target_id,
    from_state, to_state, state_version, transition_kind,
    reason_code, reason_text, criterion_version_id, actor_id
  ) values (
    v_result.id, p_organization_id, p_patient_id, p_target_id,
    null, v_result.state, v_result.state_version, 'INITIALIZE',
    'EXPLICIT_V3_INITIALIZATION', trim(p_reason), p_criterion_version_id, p_actor_id
  );

  return v_result;
end;
$function$;

-- Human transitions use optimistic state_version and a closed transition graph.
create or replace function public.transition_aba_target_clinical_state_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_target_id text,
  p_to_state text,
  p_expected_state_version bigint,
  p_actor_id uuid,
  p_reason text,
  p_criterion_version_id uuid default null
)
returns public.aba_target_clinical_states_v3
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_current public.aba_target_clinical_states_v3%rowtype;
  v_result public.aba_target_clinical_states_v3%rowtype;
  v_role text;
  v_to text := upper(trim(coalesce(p_to_state, '')));
  v_allowed boolean := false;
begin
  if p_actor_id is null or nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'ABA_V3_FSM_HUMAN_TRANSITION_ACTOR_REASON_REQUIRED';
  end if;

  v_role := public.verto_clinic_actor_role_v1(p_actor_id, p_organization_id);
  if coalesce(v_role, '') not in ('owner','admin','director','coordinator') then
    raise exception 'ABA_V3_FSM_HUMAN_TRANSITION_ACCESS_DENIED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('aba-v3-fsm:' || p_organization_id::text || ':' || p_target_id, 0));

  select * into v_current
  from public.aba_target_clinical_states_v3 state
  where state.organization_id = p_organization_id
    and state.patient_id = p_patient_id
    and state.target_id = p_target_id
  for update;

  if not found then raise exception 'ABA_V3_FSM_NOT_INITIALIZED'; end if;
  if v_current.state_version is distinct from p_expected_state_version then
    raise exception 'ABA_V3_FSM_STATE_VERSION_CONFLICT';
  end if;
  if v_current.state = 'DISCONTINUED' then
    raise exception 'ABA_V3_FSM_DISCONTINUED_TERMINAL';
  end if;

  v_allowed := (
    v_to = v_current.state
    and v_current.state in ('ACQUISITION','REACQUISITION','MAINTENANCE','MAINTENANCE_ALERT','PAUSED')
    and p_criterion_version_id is not null
    and p_criterion_version_id is distinct from v_current.criterion_version_id
  ) or case v_current.state
    when 'ACQUISITION' then v_to in ('PAUSED','DISCONTINUED')
    when 'MASTERY_CRITERIA_MET' then v_to in ('MASTERED','ACQUISITION','PAUSED','DISCONTINUED')
    when 'MASTERED' then v_to in ('MAINTENANCE','PAUSED','DISCONTINUED')
    when 'MAINTENANCE' then v_to in ('PAUSED','DISCONTINUED')
    when 'MAINTENANCE_ALERT' then v_to in ('REACQUISITION','MAINTENANCE','PAUSED','DISCONTINUED')
    when 'REACQUISITION' then v_to in ('PAUSED','DISCONTINUED')
    when 'PAUSED' then v_to in ('ACQUISITION','MAINTENANCE','REACQUISITION','DISCONTINUED')
    else false
  end;

  if not v_allowed then
    raise exception 'ABA_V3_FSM_HUMAN_TRANSITION_INVALID';
  end if;

  if p_criterion_version_id is not null and not exists (
    select 1 from public.aba_mastery_criterion_versions_v3 criterion
    where criterion.id = p_criterion_version_id
      and criterion.organization_id = p_organization_id
      and criterion.patient_id = p_patient_id
      and criterion.target_id = p_target_id
  ) then
    raise exception 'ABA_V3_FSM_CRITERION_SCOPE_INVALID';
  end if;

  update public.aba_target_clinical_states_v3
  set state = v_to,
      state_version = state_version + 1,
      criterion_version_id = coalesce(p_criterion_version_id, criterion_version_id),
      updated_by = p_actor_id,
      updated_at = now(),
      last_reason = trim(p_reason)
  where id = v_current.id
  returning * into v_result;

  insert into public.aba_target_clinical_state_events_v3 (
    clinical_state_id, organization_id, patient_id, target_id,
    from_state, to_state, state_version, transition_kind,
    reason_code, reason_text, criterion_version_id, actor_id
  ) values (
    v_result.id, p_organization_id, p_patient_id, p_target_id,
    v_current.state, v_result.state, v_result.state_version, 'HUMAN',
    'HUMAN_CLINICAL_DECISION', trim(p_reason), v_result.criterion_version_id, p_actor_id
  );

  return v_result;
end;
$function$;

-- Internal automatic transition: only two transitions are permitted by design.
create or replace function public.apply_aba_target_auto_transition_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_target_id text,
  p_expected_from_state text,
  p_to_state text,
  p_reason_code text,
  p_session_id text default null,
  p_probe_id uuid default null,
  p_evidence jsonb default '{}'::jsonb
)
returns public.aba_target_clinical_states_v3
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_current public.aba_target_clinical_states_v3%rowtype;
  v_result public.aba_target_clinical_states_v3%rowtype;
  v_from text := upper(trim(coalesce(p_expected_from_state, '')));
  v_to text := upper(trim(coalesce(p_to_state, '')));
begin
  if not (
    (v_from in ('ACQUISITION','REACQUISITION') and v_to = 'MASTERY_CRITERIA_MET')
    or (v_from = 'MAINTENANCE' and v_to = 'MAINTENANCE_ALERT')
  ) then
    raise exception 'ABA_V3_FSM_AUTO_TRANSITION_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('aba-v3-fsm:' || p_organization_id::text || ':' || p_target_id, 0));

  select * into v_current
  from public.aba_target_clinical_states_v3 state
  where state.organization_id = p_organization_id
    and state.patient_id = p_patient_id
    and state.target_id = p_target_id
  for update;

  if not found then return null; end if;
  if v_current.state <> v_from then return v_current; end if;

  update public.aba_target_clinical_states_v3
  set state = v_to,
      state_version = state_version + 1,
      updated_at = now(),
      last_reason = p_reason_code
  where id = v_current.id
  returning * into v_result;

  insert into public.aba_target_clinical_state_events_v3 (
    clinical_state_id, organization_id, patient_id, target_id,
    from_state, to_state, state_version, transition_kind,
    reason_code, criterion_version_id, probe_id, session_id,
    evidence_snapshot
  ) values (
    v_result.id, p_organization_id, p_patient_id, p_target_id,
    v_current.state, v_result.state, v_result.state_version, 'AUTO',
    p_reason_code, v_result.criterion_version_id, p_probe_id, p_session_id,
    coalesce(p_evidence, '{}'::jsonb)
  );

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Probe creation/linking. Browser cannot write these tables directly.
-- ---------------------------------------------------------------------------
create or replace function public.open_aba_maintenance_probe_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_target_id text,
  p_probe_key text,
  p_actor_id uuid,
  p_opened_at timestamptz default null
)
returns public.aba_maintenance_probes_v3
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_binding public.aba_session_target_measurement_bindings%rowtype;
  v_session public.aba_sessions%rowtype;
  v_phase public.aba_target_phase_assignments_v3%rowtype;
  v_state public.aba_target_clinical_states_v3%rowtype;
  v_criterion public.aba_mastery_criterion_versions_v3%rowtype;
  v_existing public.aba_maintenance_probes_v3%rowtype;
  v_result public.aba_maintenance_probes_v3%rowtype;
  v_role text;
begin
  if p_actor_id is null or nullif(trim(coalesce(p_probe_key, '')), '') is null then
    raise exception 'ABA_V3_PROBE_ACTOR_KEY_REQUIRED';
  end if;

  v_role := public.verto_clinic_actor_role_v1(p_actor_id, p_organization_id);
  if coalesce(v_role, '') not in ('owner','admin','director','coordinator','therapist') then
    raise exception 'ABA_V3_PROBE_ACCESS_DENIED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('aba-v3-probe-open:' || p_organization_id::text || ':' || p_session_id || ':' || p_target_id, 0));

  select * into v_existing
  from public.aba_maintenance_probes_v3 probe
  where probe.organization_id = p_organization_id
    and probe.probe_key = trim(p_probe_key);
  if found then
    if v_existing.patient_id is distinct from p_patient_id
       or v_existing.session_id is distinct from p_session_id
       or v_existing.target_id is distinct from p_target_id then
      raise exception 'ABA_V3_PROBE_IDEMPOTENCY_CONFLICT';
    end if;
    return v_existing;
  end if;

  select * into v_binding
  from public.aba_session_target_measurement_bindings binding
  where binding.organization_id = p_organization_id
    and binding.patient_id = p_patient_id
    and binding.session_id = p_session_id
    and binding.target_id = p_target_id;

  if not found or v_binding.measurement_model_version <> 'V3' then
    raise exception 'ABA_V3_PROBE_REQUIRES_V3_BINDING';
  end if;

  select * into v_session
  from public.aba_sessions session_row
  where session_row.id = p_session_id
    and session_row.patient_id = p_patient_id
    and session_row.clinic_id = p_organization_id::text;
  if not found then raise exception 'ABA_V3_PROBE_SESSION_SCOPE_INVALID'; end if;
  if coalesce(p_opened_at, v_session.started_at) < v_session.started_at then
    raise exception 'ABA_V3_PROBE_OPENED_BEFORE_SESSION';
  end if;
  if v_session.ended_at is not null and coalesce(p_opened_at, now()) > v_session.ended_at then
    raise exception 'ABA_V3_PROBE_OPENED_AFTER_SESSION';
  end if;

  select * into v_phase
  from public.aba_target_phase_assignments_v3 phase
  where phase.id = v_binding.target_phase_assignment_id
    and phase.organization_id = p_organization_id
    and phase.patient_id = p_patient_id
    and phase.target_id = p_target_id;
  if not found or v_phase.phase_type <> 'maintenance' then
    raise exception 'ABA_V3_PROBE_REQUIRES_MAINTENANCE_PHASE';
  end if;

  select * into v_state
  from public.aba_target_clinical_states_v3 state
  where state.organization_id = p_organization_id
    and state.patient_id = p_patient_id
    and state.target_id = p_target_id;
  if not found or v_state.state not in ('MAINTENANCE','MAINTENANCE_ALERT') or v_state.criterion_version_id is null then
    raise exception 'ABA_V3_PROBE_CLINICAL_STATE_INVALID';
  end if;

  select * into v_criterion
  from public.aba_mastery_criterion_versions_v3 criterion
  where criterion.id = v_state.criterion_version_id
    and criterion.organization_id = p_organization_id
    and criterion.patient_id = p_patient_id
    and criterion.target_id = p_target_id;
  if not found or not v_criterion.maintenance_enabled then
    raise exception 'ABA_V3_PROBE_MAINTENANCE_CRITERION_INCOMPLETE';
  end if;

  insert into public.aba_maintenance_probes_v3 (
    organization_id, patient_id, session_id, program_id, target_id,
    target_phase_assignment_id, criterion_version_id, probe_key,
    required_eligible_trials_snapshot, threshold_percent_snapshot,
    consecutive_below_snapshot, opened_by, opened_at
  ) values (
    p_organization_id, p_patient_id, p_session_id, v_binding.program_id, p_target_id,
    v_binding.target_phase_assignment_id, v_criterion.id, trim(p_probe_key),
    v_criterion.maintenance_min_eligible_trials,
    v_criterion.maintenance_threshold_percent,
    v_criterion.maintenance_consecutive_below,
    p_actor_id, coalesce(p_opened_at, now())
  ) returning * into v_result;

  return v_result;
exception
  when unique_violation then
    select * into v_existing
    from public.aba_maintenance_probes_v3 probe
    where probe.organization_id = p_organization_id
      and probe.probe_key = trim(p_probe_key);
    if found then
      if v_existing.patient_id is distinct from p_patient_id
         or v_existing.session_id is distinct from p_session_id
         or v_existing.target_id is distinct from p_target_id then
        raise exception 'ABA_V3_PROBE_IDEMPOTENCY_CONFLICT';
      end if;
      return v_existing;
    end if;
    raise;
end;
$function$;

create or replace function public.link_aba_trial_to_maintenance_probe_v3(
  p_probe_id uuid,
  p_trial_id uuid,
  p_actor_id uuid
)
returns public.aba_maintenance_probe_trials_v3
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_probe public.aba_maintenance_probes_v3%rowtype;
  v_trial public.aba_trials_v3%rowtype;
  v_result public.aba_maintenance_probe_trials_v3%rowtype;
  v_role text;
begin
  if p_actor_id is null then raise exception 'ABA_V3_PROBE_LINK_ACTOR_REQUIRED'; end if;

  select * into v_probe from public.aba_maintenance_probes_v3 where id = p_probe_id for update;
  if not found then raise exception 'ABA_V3_PROBE_NOT_FOUND'; end if;
  if v_probe.lifecycle_status <> 'OPEN' then raise exception 'ABA_V3_PROBE_NOT_OPEN'; end if;

  v_role := public.verto_clinic_actor_role_v1(p_actor_id, v_probe.organization_id);
  if coalesce(v_role, '') not in ('owner','admin','director','coordinator','therapist') then
    raise exception 'ABA_V3_PROBE_ACCESS_DENIED';
  end if;

  select * into v_trial from public.aba_trials_v3 where id = p_trial_id;
  if not found
     or v_trial.organization_id is distinct from v_probe.organization_id
     or v_trial.patient_id is distinct from v_probe.patient_id
     or v_trial.session_id is distinct from v_probe.session_id
     or v_trial.target_id is distinct from v_probe.target_id
     or v_trial.target_phase_assignment_id is distinct from v_probe.target_phase_assignment_id
     or v_trial.trial_type <> 'MAINTENANCE_PROBE' then
    raise exception 'ABA_V3_PROBE_TRIAL_SCOPE_INVALID';
  end if;

  select * into v_result
  from public.aba_maintenance_probe_trials_v3 link
  where link.probe_id = p_probe_id and link.trial_id = p_trial_id;
  if found then return v_result; end if;

  insert into public.aba_maintenance_probe_trials_v3(probe_id, trial_id, linked_by)
  values (p_probe_id, p_trial_id, p_actor_id)
  returning * into v_result;

  return v_result;
end;
$function$;

-- Finalize one probe from effective raw trials. No WATCH state exists here.
create or replace function public.finalize_aba_maintenance_probe_v3(
  p_probe_id uuid,
  p_close_reason text,
  p_actor_id uuid default null,
  p_closed_at timestamptz default null
)
returns public.aba_maintenance_probes_v3
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_probe public.aba_maintenance_probes_v3%rowtype;
  v_result public.aba_maintenance_probes_v3%rowtype;
  v_eligible integer := 0;
  v_correct integer := 0;
  v_percent numeric(7,4);
  v_evidence jsonb := '[]'::jsonb;
  v_projection_hash text;
  v_close_reason text := upper(trim(coalesce(p_close_reason, '')));
  v_closed_at timestamptz := coalesce(p_closed_at, now());
  v_recent_count integer := 0;
  v_recent_below integer := 0;
begin
  if v_close_reason not in ('SESSION_COMPLETION','MANUAL_CLOSE','MANUAL_CANCEL') then
    raise exception 'ABA_V3_PROBE_CLOSE_REASON_INVALID';
  end if;

  select * into v_probe
  from public.aba_maintenance_probes_v3 probe
  where probe.id = p_probe_id
  for update;
  if not found then raise exception 'ABA_V3_PROBE_NOT_FOUND'; end if;
  if v_probe.lifecycle_status <> 'OPEN' then return v_probe; end if;
  if v_closed_at < v_probe.opened_at then raise exception 'ABA_V3_PROBE_CLOSE_BEFORE_OPEN'; end if;

  if v_close_reason = 'MANUAL_CANCEL' then
    update public.aba_maintenance_probes_v3
    set lifecycle_status = 'CANCELLED', eligibility_status = 'INELIGIBLE',
        evaluation_result = 'NOT_EVALUATED', closed_at = v_closed_at, close_reason = v_close_reason,
        closed_by = p_actor_id, updated_at = now()
    where id = v_probe.id
    returning * into v_result;
    return v_result;
  end if;

  with effective_probe_trials as (
    select effective.id
    from public.aba_maintenance_probe_trials_v3 link
    join public.aba_effective_trials_v3 effective on effective.id = link.trial_id
    where link.probe_id = v_probe.id
  ), primary_steps as (
    select step.trial_id, step.outcome
    from public.aba_trial_steps_v3 step
    join effective_probe_trials trial on trial.id = step.trial_id
    where step.opportunity_role = 'PRIMARY_INDEPENDENT'
  )
  select
    count(*)::integer,
    count(*) filter (where outcome = 'CORRECT')::integer,
    coalesce(jsonb_agg(
      jsonb_build_object('trial_id', trial_id, 'outcome', outcome)
      order by trial_id
    ), '[]'::jsonb)
  into v_eligible, v_correct, v_evidence
  from primary_steps;

  v_projection_hash := encode(digest(convert_to(v_evidence::text, 'UTF8'), 'sha256'), 'hex');

  if v_eligible < v_probe.required_eligible_trials_snapshot then
    update public.aba_maintenance_probes_v3
    set lifecycle_status = 'INCOMPLETE', eligibility_status = 'INELIGIBLE',
        evaluation_result = 'NOT_EVALUATED', eligible_trial_count = v_eligible,
        primary_correct_count = v_correct, primary_independence_percent = null,
        source_projection_hash = v_projection_hash, evidence_status = 'CURRENT',
        requires_review = false, last_evidence_revision_at = null,
        closed_at = v_closed_at, close_reason = v_close_reason, closed_by = p_actor_id,
        updated_at = now()
    where id = v_probe.id
    returning * into v_result;
    return v_result;
  end if;

  v_percent := round((v_correct::numeric * 100.0) / v_eligible::numeric, 4);

  update public.aba_maintenance_probes_v3
  set lifecycle_status = 'COMPLETE', eligibility_status = 'ELIGIBLE',
      evaluation_result = case when v_percent >= threshold_percent_snapshot then 'PASSED' else 'BELOW_CRITERION' end,
      eligible_trial_count = v_eligible,
      primary_correct_count = v_correct,
      primary_independence_percent = v_percent,
      source_projection_hash = v_projection_hash, evidence_status = 'CURRENT',
      requires_review = false, last_evidence_revision_at = null,
      closed_at = v_closed_at, close_reason = v_close_reason, closed_by = p_actor_id,
      updated_at = now()
  where id = v_probe.id
  returning * into v_result;

  -- Only COMPLETE + ELIGIBLE below-criterion probes under the SAME frozen criterion
  -- can contribute to the consecutive maintenance alert. INCOMPLETE never counts.
  if v_result.evaluation_result = 'BELOW_CRITERION' then
    with recent as (
      select probe.evaluation_result
      from public.aba_maintenance_probes_v3 probe
      where probe.organization_id = v_result.organization_id
        and probe.patient_id = v_result.patient_id
        and probe.target_id = v_result.target_id
        and probe.criterion_version_id = v_result.criterion_version_id
        and probe.lifecycle_status = 'COMPLETE'
        and probe.eligibility_status = 'ELIGIBLE'
        and probe.evidence_status = 'CURRENT'
      order by probe.closed_at desc, probe.id desc
      limit v_result.consecutive_below_snapshot
    )
    select count(*)::integer,
           count(*) filter (where evaluation_result = 'BELOW_CRITERION')::integer
    into v_recent_count, v_recent_below
    from recent;

    if v_recent_count = v_result.consecutive_below_snapshot
       and v_recent_below = v_result.consecutive_below_snapshot then
      perform public.apply_aba_target_auto_transition_v3(
        v_result.organization_id,
        v_result.patient_id,
        v_result.target_id,
        'MAINTENANCE',
        'MAINTENANCE_ALERT',
        'CONSECUTIVE_COMPLETE_PROBES_BELOW_CRITERION',
        v_result.session_id,
        v_result.id,
        jsonb_build_object(
          'required_consecutive_below', v_result.consecutive_below_snapshot,
          'probe_independence_percent', v_result.primary_independence_percent,
          'threshold_percent', v_result.threshold_percent_snapshot,
          'eligible_trial_count', v_result.eligible_trial_count
        )
      );
    end if;
  end if;

  return v_result;
end;
$function$;

-- Trial revisions do not silently rewrite a closed clinical probe decision. They
-- invalidate its evidence snapshot so it cannot contribute to future consecutive
-- alerts until a clinician reviews it. For an OPEN probe, a correction/supersede
-- replacement is linked automatically when it remains a valid maintenance trial.
create or replace function public.reconcile_aba_maintenance_probe_after_revision_v3()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_link public.aba_maintenance_probe_trials_v3%rowtype;
  v_probe public.aba_maintenance_probes_v3%rowtype;
  v_replacement public.aba_trials_v3%rowtype;
begin
  if new.event_type = 'ANNOTATE' then return new; end if;

  select link.* into v_link
  from public.aba_maintenance_probe_trials_v3 link
  where link.trial_id = new.trial_id;
  if not found then return new; end if;

  select * into v_probe
  from public.aba_maintenance_probes_v3 probe
  where probe.id = v_link.probe_id
  for update;
  if not found then return new; end if;

  if v_probe.lifecycle_status = 'OPEN' and new.replacement_trial_id is not null then
    select * into v_replacement
    from public.aba_trials_v3 trial
    where trial.id = new.replacement_trial_id;

    if found
       and v_replacement.organization_id = v_probe.organization_id
       and v_replacement.patient_id = v_probe.patient_id
       and v_replacement.session_id = v_probe.session_id
       and v_replacement.target_id = v_probe.target_id
       and v_replacement.target_phase_assignment_id = v_probe.target_phase_assignment_id
       and v_replacement.trial_type = 'MAINTENANCE_PROBE' then
      insert into public.aba_maintenance_probe_trials_v3(probe_id, trial_id, linked_by)
      values (v_probe.id, v_replacement.id, new.actor_id)
      on conflict do nothing;
    end if;
  elsif v_probe.lifecycle_status in ('COMPLETE','INCOMPLETE') then
    update public.aba_maintenance_probes_v3
    set evidence_status = 'STALE_REVIEW_REQUIRED',
        requires_review = true,
        last_evidence_revision_at = new.occurred_at,
        updated_at = now(),
        metadata = metadata || jsonb_build_object(
          'stale_reason', 'LINKED_TRIAL_REVISED',
          'revision_id', new.id,
          'revision_event_type', new.event_type
        )
    where id = v_probe.id;
  end if;

  return new;
end;
$function$;

drop trigger if exists zz_reconcile_aba_maintenance_probe_after_revision_v3
  on public.aba_trial_revisions_v3;
create trigger zz_reconcile_aba_maintenance_probe_after_revision_v3
after insert on public.aba_trial_revisions_v3
for each row execute function public.reconcile_aba_maintenance_probe_after_revision_v3();

-- ---------------------------------------------------------------------------
-- Acquisition/reacquisition evaluator. It uses completed session summaries only,
-- never a single raw delta or an implicit significance threshold.
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_aba_target_mastery_after_session_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_target_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_state public.aba_target_clinical_states_v3%rowtype;
  v_criterion public.aba_mastery_criterion_versions_v3%rowtype;
  v_binding public.aba_session_target_measurement_bindings%rowtype;
  v_recent_count integer := 0;
  v_recent_passing integer := 0;
begin
  select * into v_state
  from public.aba_target_clinical_states_v3 state
  where state.organization_id = p_organization_id
    and state.patient_id = p_patient_id
    and state.target_id = p_target_id;

  if not found then
    return jsonb_build_object('evaluated', false, 'reason', 'STATE_UNINITIALIZED');
  end if;
  if v_state.state not in ('ACQUISITION','REACQUISITION') then
    return jsonb_build_object('evaluated', false, 'reason', 'STATE_NOT_AUTO_MASTERY_ELIGIBLE', 'state', v_state.state);
  end if;
  if v_state.criterion_version_id is null then
    return jsonb_build_object('evaluated', false, 'reason', 'CRITERION_NOT_CONFIGURED');
  end if;

  select * into v_criterion
  from public.aba_mastery_criterion_versions_v3 criterion
  where criterion.id = v_state.criterion_version_id;
  if not found or not v_criterion.auto_mastery_enabled then
    return jsonb_build_object('evaluated', false, 'reason', 'AUTO_MASTERY_DISABLED');
  end if;

  select * into v_binding
  from public.aba_session_target_measurement_bindings binding
  where binding.organization_id = p_organization_id
    and binding.patient_id = p_patient_id
    and binding.session_id = p_session_id
    and binding.target_id = p_target_id
    and binding.measurement_model_version = 'V3';
  if not found then
    return jsonb_build_object('evaluated', false, 'reason', 'V3_BINDING_NOT_FOUND');
  end if;

  -- Recent completed sessions under the same clinical phase segment. A phase change
  -- resets the consecutive-session evidence instead of joining unlike procedures.
  with recent as (
    select
      summary.session_id,
      summary.eligible_independent_opportunity_count,
      summary.primary_independence_percent,
      session_row.started_at,
      (
        summary.eligible_independent_opportunity_count >= v_criterion.mastery_min_eligible_trials
        and summary.primary_independence_percent is not null
        and summary.primary_independence_percent >= v_criterion.mastery_threshold_percent
      ) as passes
    from public.aba_session_target_summaries_v3 summary
    join public.aba_sessions session_row on session_row.id = summary.session_id
    where summary.organization_id = p_organization_id
      and summary.patient_id = p_patient_id
      and summary.target_id = p_target_id
      and summary.target_phase_assignment_id = v_binding.target_phase_assignment_id
      and lower(session_row.status) = 'completed'
    order by session_row.started_at desc, summary.session_id desc
    limit v_criterion.mastery_consecutive_sessions
  )
  select count(*)::integer, count(*) filter (where passes)::integer
  into v_recent_count, v_recent_passing
  from recent;

  if v_recent_count = v_criterion.mastery_consecutive_sessions
     and v_recent_passing = v_criterion.mastery_consecutive_sessions then
    perform public.apply_aba_target_auto_transition_v3(
      p_organization_id,
      p_patient_id,
      p_target_id,
      v_state.state,
      'MASTERY_CRITERIA_MET',
      'EXPLICIT_MASTERY_CRITERIA_MET',
      p_session_id,
      null,
      jsonb_build_object(
        'criterion_version_id', v_criterion.id,
        'consecutive_sessions_required', v_criterion.mastery_consecutive_sessions,
        'min_eligible_trials', v_criterion.mastery_min_eligible_trials,
        'threshold_percent', v_criterion.mastery_threshold_percent,
        'passing_sessions', v_recent_passing
      )
    );
    return jsonb_build_object('evaluated', true, 'criteria_met', true, 'passing_sessions', v_recent_passing);
  end if;

  return jsonb_build_object(
    'evaluated', true,
    'criteria_met', false,
    'recent_sessions', v_recent_count,
    'passing_sessions', v_recent_passing,
    'required_sessions', v_criterion.mastery_consecutive_sessions
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- V3 measurement finalizer. It is idempotent and derives every projection from raw.
-- The existing V2 session/appointment completion remains the outer transaction.
-- ---------------------------------------------------------------------------
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
  v_probe_id uuid;
  v_probe_count integer := 0;
  v_target_id text;
  v_target_count integer := 0;
  v_exposures_inserted integer := 0;
  v_exposures_closed integer := 0;
  v_effective_end timestamptz;
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

  -- No V3 facts/bindings means an immediate no-op for legacy-only sessions.
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

  -- Explicitly create NOT_COLLECTED only for V3 targets that had a frozen binding
  -- but no exposure row at all. Existing NO_OPPORTUNITY/INCOMPLETE states are kept.
  insert into public.aba_session_target_exposures_v3 (
    organization_id, patient_id, session_id, program_id, target_id,
    exposure_status, reason_code, reason_text, declared_by, updated_by,
    last_change_reason
  )
  select
    binding.organization_id, binding.patient_id, binding.session_id,
    binding.program_id, binding.target_id,
    case when raw.has_trials then 'COLLECTED' else 'NOT_COLLECTED' end,
    case when raw.has_trials then 'RAW_TRIALS_RECOVERED_AT_SESSION_COMPLETION' else 'SESSION_COMPLETED_WITHOUT_EXPOSURE' end,
    case when raw.has_trials then 'Exposure reconstruído a partir de trials V3 efetivos.' else 'Sessão encerrada sem coleta registrada para este alvo V3.' end,
    p_actor_id, p_actor_id, 'SESSION_COMPLETION'
  from public.aba_session_target_measurement_bindings binding
  cross join lateral (
    select exists (
      select 1 from public.aba_effective_trials_v3 trial
      where trial.organization_id = binding.organization_id
        and trial.patient_id = binding.patient_id
        and trial.session_id = binding.session_id
        and trial.target_id = binding.target_id
    ) as has_trials
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
  set exposure_status = case when resolved.has_trials then 'COLLECTED' else 'NOT_COLLECTED' end,
      reason_code = case when resolved.has_trials then 'RAW_TRIALS_RECOVERED_AT_SESSION_COMPLETION'
        else coalesce(exposure.reason_code, 'SESSION_COMPLETED_WITHOUT_COLLECTION') end,
      reason_text = case when resolved.has_trials then 'Exposure reconciliado com trials V3 efetivos.'
        else coalesce(exposure.reason_text, 'Sessão encerrada sem coleta registrada para este alvo V3.') end,
      state_version = exposure.state_version + 1,
      updated_by = p_actor_id,
      updated_at = now(),
      last_change_reason = 'SESSION_COMPLETION'
  from (
    select pending.id,
           exists (
             select 1 from public.aba_effective_trials_v3 trial
             where trial.organization_id = pending.organization_id
               and trial.patient_id = pending.patient_id
               and trial.session_id = pending.session_id
               and trial.target_id = pending.target_id
           ) as has_trials
    from public.aba_session_target_exposures_v3 pending
    where pending.organization_id = p_organization_id
      and pending.patient_id = p_patient_id
      and pending.session_id = p_session_id
      and pending.exposure_status = 'PENDING'
  ) resolved
  where exposure.id = resolved.id;
  get diagnostics v_exposures_closed = row_count;

  -- Probe barrier: no OPEN probe survives a completed session.
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

  -- Recompute + evaluate only each V3 target touched by this session.
  for v_target_id in
    select distinct binding.target_id
    from public.aba_session_target_measurement_bindings binding
    where binding.organization_id = p_organization_id
      and binding.patient_id = p_patient_id
      and binding.session_id = p_session_id
      and binding.measurement_model_version = 'V3'
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

  return jsonb_build_object(
    'finalized', true,
    'session_id', p_session_id,
    'behavior_finalization', v_behavior,
    'open_probes_closed', v_probe_count,
    'missing_exposures_created', v_exposures_inserted,
    'pending_exposures_closed', v_exposures_closed,
    'targets_reconciled', v_target_count
  );
end;
$function$;

-- Atomic hybrid wrapper for future PR9 routing. The V2 completion function remains
-- responsible for session/appointment/billing and any legacy V2 summary supplied by
-- the old UI. V3 measurements are finalized in the SAME PostgreSQL transaction and
-- never consume p_legacy_v2_summary.
create or replace function public.complete_aba_session_v3(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_appointment_id uuid,
  p_attendance_status text,
  p_ended_at timestamptz,
  p_session_note text,
  p_legacy_v2_summary jsonb,
  p_idempotency_key text,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_legacy_response jsonb;
  v_v3_response jsonb;
  v_session public.aba_sessions%rowtype;
  v_final_end timestamptz;
  v_probe_id uuid;
begin
  -- No new session semantics are invented here: preserve the existing authoritative
  -- V2 appointment/session completion and attach V3 finalization atomically.
  v_legacy_response := public.complete_aba_session_atomic_v1(
    p_actor_id,
    p_clinic_id,
    p_patient_id,
    p_session_id,
    p_appointment_id,
    p_attendance_status,
    p_ended_at,
    p_session_note,
    coalesce(p_legacy_v2_summary, '{}'::jsonb),
    p_idempotency_key,
    p_payload_hash
  );

  select * into v_session
  from public.aba_sessions session_row
  where session_row.id = p_session_id
    and session_row.patient_id = p_patient_id
    and session_row.clinic_id = p_clinic_id::text;

  if not found then raise exception 'ABA_V3_SESSION_NOT_FOUND_AFTER_LEGACY_COMPLETION'; end if;
  v_final_end := coalesce(v_session.ended_at, p_ended_at, now());

  if lower(coalesce(v_session.status, '')) = 'canceled' then
    if exists (
      select 1 from public.aba_trials_v3 trial
      where trial.organization_id = p_clinic_id and trial.patient_id = p_patient_id and trial.session_id = p_session_id
    ) or exists (
      select 1 from public.aba_behavior_events_v3 event
      where event.organization_id = p_clinic_id and event.patient_id = p_patient_id and event.session_id = p_session_id
    ) or exists (
      select 1 from public.aba_behavior_observation_slices_v3 slice
      where slice.organization_id = p_clinic_id and slice.patient_id = p_patient_id and slice.session_id = p_session_id
    ) then
      raise exception 'ABA_V3_CANCELLED_SESSION_HAS_CLINICAL_RECORDS';
    end if;

    for v_probe_id in
      select probe.id from public.aba_maintenance_probes_v3 probe
      where probe.organization_id = p_clinic_id
        and probe.patient_id = p_patient_id
        and probe.session_id = p_session_id
        and probe.lifecycle_status = 'OPEN'
    loop
      perform public.finalize_aba_maintenance_probe_v3(v_probe_id, 'MANUAL_CANCEL', p_actor_id, v_final_end);
    end loop;

    update public.aba_session_target_exposures_v3 exposure
    set exposure_status = 'NOT_APPLICABLE',
        reason_code = 'SESSION_CANCELLED',
        reason_text = coalesce(exposure.reason_text, 'Sessão cancelada; alvo V3 não aplicável.'),
        state_version = exposure.state_version + 1,
        updated_by = p_actor_id,
        updated_at = now(),
        last_change_reason = 'SESSION_CANCELLATION'
    where exposure.organization_id = p_clinic_id
      and exposure.patient_id = p_patient_id
      and exposure.session_id = p_session_id
      and exposure.exposure_status = 'PENDING';

    v_v3_response := jsonb_build_object('finalized', false, 'reason', 'SESSION_CANCELED');
  else
    v_v3_response := public.finalize_aba_session_measurements_v3(
      p_clinic_id, p_patient_id, p_session_id, v_final_end, p_actor_id
    );
  end if;

  return coalesce(v_legacy_response, '{}'::jsonb) || jsonb_build_object(
    'abaMeasurementV3', v_v3_response
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Privileges: dark/service-role only. No browser surface is opened in PR6.
-- ---------------------------------------------------------------------------

alter table public.aba_mastery_criterion_versions_v3 enable row level security;
alter table public.aba_maintenance_probes_v3 enable row level security;
alter table public.aba_maintenance_probe_trials_v3 enable row level security;
alter table public.aba_target_clinical_states_v3 enable row level security;
alter table public.aba_target_clinical_state_events_v3 enable row level security;

revoke all on table public.aba_mastery_criterion_versions_v3 from public, anon, authenticated;
revoke all on table public.aba_maintenance_probes_v3 from public, anon, authenticated;
revoke all on table public.aba_maintenance_probe_trials_v3 from public, anon, authenticated;
revoke all on table public.aba_target_clinical_states_v3 from public, anon, authenticated;
revoke all on table public.aba_target_clinical_state_events_v3 from public, anon, authenticated;

grant select on table public.aba_mastery_criterion_versions_v3 to service_role;
grant select on table public.aba_maintenance_probes_v3 to service_role;
grant select on table public.aba_maintenance_probe_trials_v3 to service_role;
grant select on table public.aba_target_clinical_states_v3 to service_role;
grant select on table public.aba_target_clinical_state_events_v3 to service_role;

revoke all on function public.publish_aba_mastery_criterion_version_v3(uuid,uuid,text,uuid,boolean,integer,numeric,integer,boolean,integer,numeric,integer,jsonb)
  from public, anon, authenticated;
revoke all on function public.initialize_aba_target_clinical_state_v3(uuid,uuid,text,text,uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.transition_aba_target_clinical_state_v3(uuid,uuid,text,text,bigint,uuid,text,uuid)
  from public, anon, authenticated;
revoke all on function public.apply_aba_target_auto_transition_v3(uuid,uuid,text,text,text,text,text,uuid,jsonb)
  from public, anon, authenticated;
revoke all on function public.open_aba_maintenance_probe_v3(uuid,uuid,text,text,text,uuid,timestamptz)
  from public, anon, authenticated;
revoke all on function public.link_aba_trial_to_maintenance_probe_v3(uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.finalize_aba_maintenance_probe_v3(uuid,text,uuid,timestamptz)
  from public, anon, authenticated;
revoke all on function public.evaluate_aba_target_mastery_after_session_v3(uuid,uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.finalize_aba_session_measurements_v3(uuid,uuid,text,timestamptz,uuid)
  from public, anon, authenticated;
revoke all on function public.complete_aba_session_v3(uuid,uuid,uuid,text,uuid,text,timestamptz,text,jsonb,text,text)
  from public, anon, authenticated;

grant execute on function public.publish_aba_mastery_criterion_version_v3(uuid,uuid,text,uuid,boolean,integer,numeric,integer,boolean,integer,numeric,integer,jsonb) to service_role;
grant execute on function public.initialize_aba_target_clinical_state_v3(uuid,uuid,text,text,uuid,uuid,text) to service_role;
grant execute on function public.transition_aba_target_clinical_state_v3(uuid,uuid,text,text,bigint,uuid,text,uuid) to service_role;
grant execute on function public.open_aba_maintenance_probe_v3(uuid,uuid,text,text,text,uuid,timestamptz) to service_role;
grant execute on function public.link_aba_trial_to_maintenance_probe_v3(uuid,uuid,uuid) to service_role;
grant execute on function public.finalize_aba_maintenance_probe_v3(uuid,text,uuid,timestamptz) to service_role;
grant execute on function public.evaluate_aba_target_mastery_after_session_v3(uuid,uuid,text,text) to service_role;
grant execute on function public.finalize_aba_session_measurements_v3(uuid,uuid,text,timestamptz,uuid) to service_role;
grant execute on function public.complete_aba_session_v3(uuid,uuid,uuid,text,uuid,text,timestamptz,text,jsonb,text,text) to service_role;

-- Immutable criterion/state event guards are not API surfaces.
revoke all on function public.validate_aba_mastery_criterion_scope_v3() from public, anon, authenticated;
revoke all on function public.guard_aba_mastery_criterion_version_v3() from public, anon, authenticated;
revoke all on function public.guard_aba_target_clinical_state_event_v3() from public, anon, authenticated;
revoke all on function public.validate_aba_maintenance_probe_trial_link_v3() from public, anon, authenticated;
revoke all on function public.guard_aba_maintenance_probe_trial_link_v3() from public, anon, authenticated;
revoke all on function public.reconcile_aba_maintenance_probe_after_revision_v3() from public, anon, authenticated;

commit;
