-- Verto Clinical Measurement Engine V3 - ABA specialized engine.
-- Additive/dark only. Adds categorical prompt hierarchies, versioned chaining,
-- ordered trials and Task Analysis on top of the universal raw layer.
-- No browser writer, rollout change, projection, graph, or legacy mutation.

begin;

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

commit;
