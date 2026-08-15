-- ABA Measurement V3 - PR4 canonical server-side summaries + reconciliation.
-- Additive only. ABA Legacy V2 remains untouched and V3 stays dark.
-- Raw V3 + append-only revisions are authority; summaries are rebuildable projections.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- One rebuildable projection per session + target + clinical phase segment.
-- No browser-supplied percentage is ever authoritative.
-- ---------------------------------------------------------------------------
create table if not exists public.aba_session_target_summaries_v3 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text not null references public.aba_sessions(id) on delete restrict,
  program_id text not null references public.aba_programs(id) on delete restrict,
  target_id text not null references public.aba_targets(id) on delete restrict,
  target_phase_assignment_id uuid not null
    references public.aba_target_phase_assignments_v3(id) on delete restrict,
  summary_definition_version integer not null default 1
    check (summary_definition_version > 0),

  -- Canonical counts. A complex trial counts at most once in every trial-level metric.
  effective_trial_count integer not null default 0 check (effective_trial_count >= 0),
  effective_step_count integer not null default 0 check (effective_step_count >= 0),
  eligible_independent_opportunity_count integer not null default 0
    check (eligible_independent_opportunity_count >= 0),
  primary_independent_correct_count integer not null default 0
    check (primary_independent_correct_count >= 0),
  primary_independent_incorrect_count integer not null default 0
    check (primary_independent_incorrect_count >= 0),
  primary_independent_no_response_count integer not null default 0
    check (primary_independent_no_response_count >= 0),
  no_primary_independent_opportunity_count integer not null default 0
    check (no_primary_independent_opportunity_count >= 0),
  support_used_trial_count integer not null default 0
    check (support_used_trial_count >= 0),
  final_completion_correct_count integer not null default 0
    check (final_completion_correct_count >= 0),
  completed_after_support_count integer not null default 0
    check (completed_after_support_count >= 0),

  -- Convenience projection only. NULL means independence was not evaluated because
  -- there were zero eligible PRIMARY_INDEPENDENT opportunities.
  primary_independence_percent numeric(7,4),

  trial_type_counts jsonb not null default '{}'::jsonb,
  prompt_step_counts jsonb not null default '{}'::jsonb,

  source_projection_hash text not null,
  source_latest_occurred_at timestamptz,
  source_latest_revision_at timestamptz,
  computed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint aba_session_target_summary_v3_hash
    check (source_projection_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_session_target_summary_v3_json_objects
    check (
      jsonb_typeof(trial_type_counts) = 'object'
      and jsonb_typeof(prompt_step_counts) = 'object'
    ),
  constraint aba_session_target_summary_v3_independence_bounds
    check (
      primary_independence_percent is null
      or (primary_independence_percent >= 0 and primary_independence_percent <= 100)
    ),
  constraint aba_session_target_summary_v3_independent_partition
    check (
      eligible_independent_opportunity_count =
        primary_independent_correct_count
        + primary_independent_incorrect_count
        + primary_independent_no_response_count
    ),
  constraint aba_session_target_summary_v3_trial_partition
    check (
      effective_trial_count =
        eligible_independent_opportunity_count
        + no_primary_independent_opportunity_count
    ),
  unique (session_id, target_id, target_phase_assignment_id),
  unique (id, organization_id, patient_id, session_id, target_id, target_phase_assignment_id),
  foreign key (
    target_phase_assignment_id,
    organization_id,
    patient_id,
    target_id
  ) references public.aba_target_phase_assignments_v3 (
    id,
    organization_id,
    patient_id,
    target_id
  ) on delete restrict
);

create index if not exists idx_aba_session_target_summaries_v3_patient
  on public.aba_session_target_summaries_v3
  (organization_id, patient_id, target_id, session_id, target_phase_assignment_id);

create index if not exists idx_aba_session_target_summaries_v3_phase
  on public.aba_session_target_summaries_v3
  (organization_id, patient_id, target_phase_assignment_id, session_id);

-- Defense-in-depth: even privileged/manual V3 writes cannot commit an orphan
-- envelope. The check is deferred because the canonical bulk RPC inserts envelope
-- first and ordered steps later in the same transaction.
create or replace function public.validate_aba_trial_v3_has_steps_at_commit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  if not exists (
    select 1
    from public.aba_trial_steps_v3 step
    where step.trial_id = new.id
  ) then
    raise exception 'ABA_V3_TRIAL_STEPS_REQUIRED_AT_COMMIT';
  end if;

  return new;
end;
$function$;

drop trigger if exists validate_aba_trial_v3_has_steps_at_commit
  on public.aba_trials_v3;
create constraint trigger validate_aba_trial_v3_has_steps_at_commit
after insert on public.aba_trials_v3
deferrable initially deferred
for each row execute function public.validate_aba_trial_v3_has_steps_at_commit();

-- ---------------------------------------------------------------------------
-- Effective raw projection.
-- Latest non-ANNOTATE revision controls each immutable trial:
--   no revision / RESTORE -> effective
--   VOID / CORRECT / SUPERSEDE -> ineffective original
-- Replacement trials are independent immutable envelopes and remain governed by
-- their own revision history.
-- ---------------------------------------------------------------------------
create index if not exists idx_aba_trial_revisions_v3_latest_effective
  on public.aba_trial_revisions_v3 (trial_id, occurred_at desc, id desc)
  where event_type <> 'ANNOTATE';

create or replace view public.aba_effective_trials_v3
with (security_barrier = true)
as
select
  trial.*,
  latest.latest_revision_id,
  latest.latest_revision_event_type,
  latest.latest_revision_at
from public.aba_trials_v3 trial
left join lateral (
  select
    revision.id as latest_revision_id,
    revision.event_type as latest_revision_event_type,
    revision.occurred_at as latest_revision_at
  from public.aba_trial_revisions_v3 revision
  where revision.trial_id = trial.id
    and revision.event_type <> 'ANNOTATE'
  order by revision.occurred_at desc, revision.id desc
  limit 1
) latest on true
where latest.latest_revision_event_type is null
   or latest.latest_revision_event_type = 'RESTORE';

-- ---------------------------------------------------------------------------
-- Pure projection calculator. It does not mutate the cache and is reused by both
-- recompute and verification so there is only one mathematical implementation.
-- ---------------------------------------------------------------------------
create or replace function public.compute_aba_session_target_summary_projection_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_target_id text,
  p_target_phase_assignment_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
with effective_trials as (
  select
    trial.id,
    trial.program_id,
    trial.trial_type,
    trial.occurred_at,
    trial.payload_hash,
    trial.latest_revision_id,
    trial.latest_revision_event_type,
    trial.latest_revision_at
  from public.aba_effective_trials_v3 trial
  where trial.organization_id = p_organization_id
    and trial.patient_id = p_patient_id
    and trial.session_id = p_session_id
    and trial.target_id = p_target_id
    and trial.target_phase_assignment_id = p_target_phase_assignment_id
),
trial_step_projection as (
  select
    trial.id as trial_id,
    trial.program_id,
    trial.trial_type,
    trial.occurred_at,
    trial.payload_hash,
    trial.latest_revision_id,
    trial.latest_revision_event_type,
    trial.latest_revision_at,
    count(step.id)::integer as step_count,
    bool_or(step.opportunity_role = 'PRIMARY_INDEPENDENT') as has_primary_independent,
    max(step.outcome) filter (
      where step.opportunity_role = 'PRIMARY_INDEPENDENT'
    ) as primary_independent_outcome,
    bool_or(
      step.opportunity_role in ('SUPPORT', 'CORRECTION', 'TRANSFER')
      or step.prompt_key is not null
      or step.step_type in ('PROMPT', 'CORRECTION', 'TRANSFER')
    ) as support_used,
    (array_agg(step.outcome order by step.sequence_no desc))[1] as final_outcome
  from effective_trials trial
  join public.aba_trial_steps_v3 step on step.trial_id = trial.id
  group by
    trial.id,
    trial.program_id,
    trial.trial_type,
    trial.occurred_at,
    trial.payload_hash,
    trial.latest_revision_id,
    trial.latest_revision_event_type,
    trial.latest_revision_at
),
counts as (
  select
    count(*)::integer as effective_trial_count,
    coalesce(sum(step_count), 0)::integer as effective_step_count,
    count(*) filter (where has_primary_independent)::integer
      as eligible_independent_opportunity_count,
    count(*) filter (
      where has_primary_independent and primary_independent_outcome = 'CORRECT'
    )::integer as primary_independent_correct_count,
    count(*) filter (
      where has_primary_independent and primary_independent_outcome = 'INCORRECT'
    )::integer as primary_independent_incorrect_count,
    count(*) filter (
      where has_primary_independent and primary_independent_outcome = 'NO_RESPONSE'
    )::integer as primary_independent_no_response_count,
    count(*) filter (where not has_primary_independent)::integer
      as no_primary_independent_opportunity_count,
    count(*) filter (where support_used)::integer as support_used_trial_count,
    count(*) filter (where final_outcome = 'CORRECT')::integer
      as final_completion_correct_count,
    count(*) filter (
      where final_outcome = 'CORRECT'
        and support_used
        and coalesce(primary_independent_outcome, '') <> 'CORRECT'
    )::integer as completed_after_support_count,
    max(occurred_at) as source_latest_occurred_at,
    max(latest_revision_at) as source_latest_revision_at
  from trial_step_projection
),
trial_types as (
  select coalesce(jsonb_object_agg(trial_type, trial_count order by trial_type), '{}'::jsonb)
    as trial_type_counts
  from (
    select trial_type, count(*)::integer as trial_count
    from trial_step_projection
    group by trial_type
  ) grouped
),
prompts as (
  select coalesce(jsonb_object_agg(prompt_key, prompt_step_count order by prompt_key), '{}'::jsonb)
    as prompt_step_counts
  from (
    select step.prompt_key, count(*)::integer as prompt_step_count
    from public.aba_trial_steps_v3 step
    join effective_trials trial on trial.id = step.trial_id
    where step.prompt_key is not null
    group by step.prompt_key
  ) grouped
),
projection_hash as (
  select encode(
    digest(
      coalesce(string_agg(
        trial.id::text || ':' || trial.payload_hash || ':' ||
        coalesce(trial.latest_revision_id::text, '-') || ':' ||
        coalesce(trial.latest_revision_event_type, '-'),
        '|' order by trial.occurred_at, trial.id
      ), ''),
      'sha256'
    ),
    'hex'
  ) as source_projection_hash
  from effective_trials trial
)
select jsonb_build_object(
  'summary_definition_version', 1,
  'effective_trial_count', coalesce(counts.effective_trial_count, 0),
  'effective_step_count', coalesce(counts.effective_step_count, 0),
  'eligible_independent_opportunity_count', coalesce(counts.eligible_independent_opportunity_count, 0),
  'primary_independent_correct_count', coalesce(counts.primary_independent_correct_count, 0),
  'primary_independent_incorrect_count', coalesce(counts.primary_independent_incorrect_count, 0),
  'primary_independent_no_response_count', coalesce(counts.primary_independent_no_response_count, 0),
  'no_primary_independent_opportunity_count', coalesce(counts.no_primary_independent_opportunity_count, 0),
  'support_used_trial_count', coalesce(counts.support_used_trial_count, 0),
  'final_completion_correct_count', coalesce(counts.final_completion_correct_count, 0),
  'completed_after_support_count', coalesce(counts.completed_after_support_count, 0),
  'primary_independence_percent', case
    when coalesce(counts.eligible_independent_opportunity_count, 0) = 0 then null
    else round(
      (counts.primary_independent_correct_count::numeric * 100)
      / counts.eligible_independent_opportunity_count::numeric,
      4
    )
  end,
  'trial_type_counts', trial_types.trial_type_counts,
  'prompt_step_counts', prompts.prompt_step_counts,
  'source_projection_hash', projection_hash.source_projection_hash,
  'source_latest_occurred_at', counts.source_latest_occurred_at,
  'source_latest_revision_at', counts.source_latest_revision_at
)
from counts
cross join trial_types
cross join prompts
cross join projection_hash;
$function$;

-- ---------------------------------------------------------------------------
-- Granular recompute: only one session + target + phase segment is locked/written.
-- This function is safe to call repeatedly and is the sole supported writer of the
-- summary projection table.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_aba_session_target_summary_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_target_id text,
  p_target_phase_assignment_id uuid
)
returns public.aba_session_target_summaries_v3
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_phase public.aba_target_phase_assignments_v3%rowtype;
  v_session_patient uuid;
  v_session_org text;
  v_target_patient uuid;
  v_target_org text;
  v_program_id text;
  v_projection jsonb;
  v_result public.aba_session_target_summaries_v3%rowtype;
begin
  if p_organization_id is null or p_patient_id is null
     or nullif(trim(p_session_id), '') is null
     or nullif(trim(p_target_id), '') is null
     or p_target_phase_assignment_id is null then
    raise exception 'ABA_V3_SUMMARY_SCOPE_REQUIRED';
  end if;

  -- Serialize only this summary segment. Unrelated targets/phases never contend.
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_session_id || ':' || p_target_id || ':' ||
      p_target_phase_assignment_id::text,
      0
    )
  );

  select session.patient_id, session.clinic_id
    into v_session_patient, v_session_org
  from public.aba_sessions session
  where session.id = p_session_id;

  if not found
     or v_session_patient is distinct from p_patient_id
     or v_session_org is distinct from p_organization_id::text then
    raise exception 'ABA_V3_SUMMARY_SESSION_SCOPE_INVALID';
  end if;

  select target.patient_id, target.clinic_id
    into v_target_patient, v_target_org
  from public.aba_targets target
  where target.id = p_target_id;

  if not found
     or v_target_patient is distinct from p_patient_id
     or v_target_org is distinct from p_organization_id::text then
    raise exception 'ABA_V3_SUMMARY_TARGET_SCOPE_INVALID';
  end if;

  select * into v_phase
  from public.aba_target_phase_assignments_v3 phase
  where phase.id = p_target_phase_assignment_id;

  if not found
     or v_phase.organization_id is distinct from p_organization_id
     or v_phase.patient_id is distinct from p_patient_id
     or v_phase.target_id is distinct from p_target_id
     or v_phase.program_id is null then
    raise exception 'ABA_V3_SUMMARY_PHASE_SCOPE_INVALID';
  end if;

  v_program_id := v_phase.program_id;

  v_projection := public.compute_aba_session_target_summary_projection_v3(
    p_organization_id,
    p_patient_id,
    p_session_id,
    p_target_id,
    p_target_phase_assignment_id
  );

  insert into public.aba_session_target_summaries_v3 (
    organization_id,
    patient_id,
    session_id,
    program_id,
    target_id,
    target_phase_assignment_id,
    summary_definition_version,
    effective_trial_count,
    effective_step_count,
    eligible_independent_opportunity_count,
    primary_independent_correct_count,
    primary_independent_incorrect_count,
    primary_independent_no_response_count,
    no_primary_independent_opportunity_count,
    support_used_trial_count,
    final_completion_correct_count,
    completed_after_support_count,
    primary_independence_percent,
    trial_type_counts,
    prompt_step_counts,
    source_projection_hash,
    source_latest_occurred_at,
    source_latest_revision_at,
    computed_at,
    updated_at
  ) values (
    p_organization_id,
    p_patient_id,
    p_session_id,
    v_program_id,
    p_target_id,
    p_target_phase_assignment_id,
    (v_projection ->> 'summary_definition_version')::integer,
    (v_projection ->> 'effective_trial_count')::integer,
    (v_projection ->> 'effective_step_count')::integer,
    (v_projection ->> 'eligible_independent_opportunity_count')::integer,
    (v_projection ->> 'primary_independent_correct_count')::integer,
    (v_projection ->> 'primary_independent_incorrect_count')::integer,
    (v_projection ->> 'primary_independent_no_response_count')::integer,
    (v_projection ->> 'no_primary_independent_opportunity_count')::integer,
    (v_projection ->> 'support_used_trial_count')::integer,
    (v_projection ->> 'final_completion_correct_count')::integer,
    (v_projection ->> 'completed_after_support_count')::integer,
    nullif(v_projection ->> 'primary_independence_percent', '')::numeric,
    coalesce(v_projection -> 'trial_type_counts', '{}'::jsonb),
    coalesce(v_projection -> 'prompt_step_counts', '{}'::jsonb),
    v_projection ->> 'source_projection_hash',
    nullif(v_projection ->> 'source_latest_occurred_at', '')::timestamptz,
    nullif(v_projection ->> 'source_latest_revision_at', '')::timestamptz,
    now(),
    now()
  )
  on conflict (session_id, target_id, target_phase_assignment_id) do update
    set organization_id = excluded.organization_id,
        patient_id = excluded.patient_id,
        program_id = excluded.program_id,
        summary_definition_version = excluded.summary_definition_version,
        effective_trial_count = excluded.effective_trial_count,
        effective_step_count = excluded.effective_step_count,
        eligible_independent_opportunity_count = excluded.eligible_independent_opportunity_count,
        primary_independent_correct_count = excluded.primary_independent_correct_count,
        primary_independent_incorrect_count = excluded.primary_independent_incorrect_count,
        primary_independent_no_response_count = excluded.primary_independent_no_response_count,
        no_primary_independent_opportunity_count = excluded.no_primary_independent_opportunity_count,
        support_used_trial_count = excluded.support_used_trial_count,
        final_completion_correct_count = excluded.final_completion_correct_count,
        completed_after_support_count = excluded.completed_after_support_count,
        primary_independence_percent = excluded.primary_independence_percent,
        trial_type_counts = excluded.trial_type_counts,
        prompt_step_counts = excluded.prompt_step_counts,
        source_projection_hash = excluded.source_projection_hash,
        source_latest_occurred_at = excluded.source_latest_occurred_at,
        source_latest_revision_at = excluded.source_latest_revision_at,
        computed_at = excluded.computed_at,
        updated_at = excluded.updated_at
  returning * into v_result;

  return v_result;
end;
$function$;

-- Recompute all phase segments that have raw V3 trials for one target/session.
-- This remains granular to one target and is useful for audited reconciliation.
create or replace function public.recompute_aba_session_target_summaries_v3(
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
  v_phase_id uuid;
  v_count integer := 0;
  v_hashes jsonb := '[]'::jsonb;
  v_summary public.aba_session_target_summaries_v3%rowtype;
begin
  for v_phase_id in
    select distinct trial.target_phase_assignment_id
    from public.aba_trials_v3 trial
    where trial.organization_id = p_organization_id
      and trial.patient_id = p_patient_id
      and trial.session_id = p_session_id
      and trial.target_id = p_target_id
    order by trial.target_phase_assignment_id
  loop
    v_summary := public.recompute_aba_session_target_summary_v3(
      p_organization_id,
      p_patient_id,
      p_session_id,
      p_target_id,
      v_phase_id
    );
    v_count := v_count + 1;
    v_hashes := v_hashes || jsonb_build_array(jsonb_build_object(
      'target_phase_assignment_id', v_phase_id,
      'source_projection_hash', v_summary.source_projection_hash
    ));
  end loop;

  return jsonb_build_object(
    'session_id', p_session_id,
    'target_id', p_target_id,
    'segments_recomputed', v_count,
    'segments', v_hashes
  );
end;
$function$;

-- Read-only consistency verifier. It never trusts the persisted summary blindly.
create or replace function public.verify_aba_session_target_summary_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_target_id text,
  p_target_phase_assignment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_projection jsonb;
  v_stored public.aba_session_target_summaries_v3%rowtype;
  v_match boolean := false;
begin
  v_projection := public.compute_aba_session_target_summary_projection_v3(
    p_organization_id,
    p_patient_id,
    p_session_id,
    p_target_id,
    p_target_phase_assignment_id
  );

  select * into v_stored
  from public.aba_session_target_summaries_v3 summary
  where summary.organization_id = p_organization_id
    and summary.patient_id = p_patient_id
    and summary.session_id = p_session_id
    and summary.target_id = p_target_id
    and summary.target_phase_assignment_id = p_target_phase_assignment_id;

  if found then
    v_match :=
      v_stored.summary_definition_version = (v_projection ->> 'summary_definition_version')::integer
      and v_stored.source_projection_hash = v_projection ->> 'source_projection_hash'
      and v_stored.effective_trial_count = (v_projection ->> 'effective_trial_count')::integer
      and v_stored.effective_step_count = (v_projection ->> 'effective_step_count')::integer
      and v_stored.eligible_independent_opportunity_count = (v_projection ->> 'eligible_independent_opportunity_count')::integer
      and v_stored.primary_independent_correct_count = (v_projection ->> 'primary_independent_correct_count')::integer
      and v_stored.primary_independent_incorrect_count = (v_projection ->> 'primary_independent_incorrect_count')::integer
      and v_stored.primary_independent_no_response_count = (v_projection ->> 'primary_independent_no_response_count')::integer
      and v_stored.no_primary_independent_opportunity_count = (v_projection ->> 'no_primary_independent_opportunity_count')::integer
      and v_stored.support_used_trial_count = (v_projection ->> 'support_used_trial_count')::integer
      and v_stored.final_completion_correct_count = (v_projection ->> 'final_completion_correct_count')::integer
      and v_stored.completed_after_support_count = (v_projection ->> 'completed_after_support_count')::integer
      and v_stored.trial_type_counts = coalesce(v_projection -> 'trial_type_counts', '{}'::jsonb)
      and v_stored.prompt_step_counts = coalesce(v_projection -> 'prompt_step_counts', '{}'::jsonb)
      and v_stored.primary_independence_percent is not distinct from
        nullif(v_projection ->> 'primary_independence_percent', '')::numeric;
  end if;

  return jsonb_build_object(
    'match', v_match,
    'stored_summary_exists', found,
    'stored_hash', case when found then v_stored.source_projection_hash else null end,
    'recomputed_hash', v_projection ->> 'source_projection_hash',
    'summary_definition_version', v_projection ->> 'summary_definition_version',
    'session_id', p_session_id,
    'target_id', p_target_id,
    'target_phase_assignment_id', p_target_phase_assignment_id
  );
end;
$function$;

-- Atomic correction/supersede writer. Future APIs should use this path instead of
-- creating a replacement in one transaction and linking it in another, which could
-- temporarily expose both envelopes in the summary.
create or replace function public.record_aba_trial_correction_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_original_trial_id uuid,
  p_event_type text,
  p_replacement_trial jsonb,
  p_reason text,
  p_client_revision_event_id text,
  p_actor_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_event_type text := upper(trim(coalesce(p_event_type, '')));
  v_ingest jsonb;
  v_replacement_trial_id uuid;
  v_revision public.aba_trial_revisions_v3%rowtype;
begin
  if v_event_type not in ('CORRECT', 'SUPERSEDE') then
    raise exception 'ABA_V3_ATOMIC_CORRECTION_EVENT_INVALID';
  end if;

  if p_actor_id is null then
    raise exception 'ABA_V3_ATOMIC_CORRECTION_ACTOR_REQUIRED';
  end if;

  if p_replacement_trial is null or jsonb_typeof(p_replacement_trial) <> 'object' then
    raise exception 'ABA_V3_ATOMIC_CORRECTION_REPLACEMENT_REQUIRED';
  end if;

  -- The original trial lock is acquired by record_aba_trial_revision_v3. Bulk
  -- persistence + revision execute inside this same outer transaction, so an error
  -- in either step rolls the replacement and all summary writes back together.
  v_ingest := public.record_aba_trials_bulk_v3(
    p_organization_id,
    p_patient_id,
    jsonb_build_array(p_replacement_trial),
    p_actor_id
  );

  if coalesce((v_ingest ->> 'quarantined')::integer, 0) <> 0
     or coalesce((v_ingest ->> 'received')::integer, 0) <> 1
     or jsonb_array_length(coalesce(v_ingest -> 'accepted', '[]'::jsonb)) <> 1 then
    raise exception 'ABA_V3_ATOMIC_CORRECTION_REPLACEMENT_NOT_ACCEPTED';
  end if;

  v_replacement_trial_id := nullif(
    v_ingest -> 'accepted' -> 0 ->> 'trial_id',
    ''
  )::uuid;

  if v_replacement_trial_id is null then
    raise exception 'ABA_V3_ATOMIC_CORRECTION_REPLACEMENT_ID_MISSING';
  end if;

  v_revision := public.record_aba_trial_revision_v3(
    p_organization_id,
    p_original_trial_id,
    v_event_type,
    v_replacement_trial_id,
    p_reason,
    p_client_revision_event_id,
    p_actor_id,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return jsonb_build_object(
    'replacement_trial_id', v_replacement_trial_id,
    'revision_id', v_revision.id,
    'revision_event_type', v_revision.event_type,
    'ingest', v_ingest
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Automatic reconciliation inside the same transaction that writes raw steps or
-- an audited revision. Statement-level step trigger makes bulk ingest O(targets)
-- for recompute, never O(trials).
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_aba_v3_summaries_after_steps_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_scope record;
begin
  for v_scope in
    select distinct
      trial.organization_id,
      trial.patient_id,
      trial.session_id,
      trial.target_id,
      trial.target_phase_assignment_id
    from new_steps step
    join public.aba_trials_v3 trial on trial.id = step.trial_id
    order by
      trial.organization_id,
      trial.patient_id,
      trial.session_id,
      trial.target_id,
      trial.target_phase_assignment_id
  loop
    perform public.recompute_aba_session_target_summary_v3(
      v_scope.organization_id,
      v_scope.patient_id,
      v_scope.session_id,
      v_scope.target_id,
      v_scope.target_phase_assignment_id
    );
  end loop;

  return null;
end;
$function$;

create or replace function public.reconcile_aba_v3_summary_after_revision_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_trial public.aba_trials_v3%rowtype;
  v_replacement public.aba_trials_v3%rowtype;
begin
  if new.event_type = 'ANNOTATE' then
    return new;
  end if;

  select * into v_trial
  from public.aba_trials_v3 trial
  where trial.id = new.trial_id;

  if found then
    perform public.recompute_aba_session_target_summary_v3(
      v_trial.organization_id,
      v_trial.patient_id,
      v_trial.session_id,
      v_trial.target_id,
      v_trial.target_phase_assignment_id
    );
  end if;

  if new.replacement_trial_id is not null then
    select * into v_replacement
    from public.aba_trials_v3 trial
    where trial.id = new.replacement_trial_id;

    if found and (
      v_trial.id is null
      or v_replacement.target_phase_assignment_id is distinct from v_trial.target_phase_assignment_id
    ) then
      perform public.recompute_aba_session_target_summary_v3(
        v_replacement.organization_id,
        v_replacement.patient_id,
        v_replacement.session_id,
        v_replacement.target_id,
        v_replacement.target_phase_assignment_id
      );
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists reconcile_aba_v3_summaries_after_steps_insert
  on public.aba_trial_steps_v3;
create trigger reconcile_aba_v3_summaries_after_steps_insert
after insert on public.aba_trial_steps_v3
referencing new table as new_steps
for each statement execute function public.reconcile_aba_v3_summaries_after_steps_insert();

drop trigger if exists reconcile_aba_v3_summary_after_revision_insert
  on public.aba_trial_revisions_v3;
create trigger reconcile_aba_v3_summary_after_revision_insert
after insert on public.aba_trial_revisions_v3
for each row execute function public.reconcile_aba_v3_summary_after_revision_insert();

-- Bootstrap any PR3 raw V3 rows that may already exist in staging/manual tests.
-- V3 is dark, so this is normally a zero-row pass and never touches Legacy V2.
do $bootstrap$
declare
  v_scope record;
begin
  for v_scope in
    select distinct
      trial.organization_id,
      trial.patient_id,
      trial.session_id,
      trial.target_id,
      trial.target_phase_assignment_id
    from public.aba_trials_v3 trial
    order by
      trial.organization_id,
      trial.patient_id,
      trial.session_id,
      trial.target_id,
      trial.target_phase_assignment_id
  loop
    perform public.recompute_aba_session_target_summary_v3(
      v_scope.organization_id,
      v_scope.patient_id,
      v_scope.session_id,
      v_scope.target_id,
      v_scope.target_phase_assignment_id
    );
  end loop;
end;
$bootstrap$;

-- ---------------------------------------------------------------------------
-- Projection table is server-only and fail-closed like the rest of dark V3.
-- ---------------------------------------------------------------------------
alter table public.aba_session_target_summaries_v3 enable row level security;

revoke all on table public.aba_session_target_summaries_v3 from public, anon, authenticated;
revoke all on table public.aba_effective_trials_v3 from public, anon, authenticated;
grant select on table public.aba_session_target_summaries_v3 to service_role;
grant select on table public.aba_effective_trials_v3 to service_role;

revoke all on function public.validate_aba_trial_v3_has_steps_at_commit()
  from public, anon, authenticated;
revoke all on function public.compute_aba_session_target_summary_projection_v3(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.recompute_aba_session_target_summary_v3(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.recompute_aba_session_target_summaries_v3(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.verify_aba_session_target_summary_v3(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.record_aba_trial_correction_v3(uuid, uuid, uuid, text, jsonb, text, text, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.reconcile_aba_v3_summaries_after_steps_insert()
  from public, anon, authenticated;
revoke all on function public.reconcile_aba_v3_summary_after_revision_insert()
  from public, anon, authenticated;

grant execute on function public.compute_aba_session_target_summary_projection_v3(uuid, uuid, text, text, uuid)
  to service_role;
grant execute on function public.recompute_aba_session_target_summary_v3(uuid, uuid, text, text, uuid)
  to service_role;
grant execute on function public.recompute_aba_session_target_summaries_v3(uuid, uuid, text, text)
  to service_role;
grant execute on function public.verify_aba_session_target_summary_v3(uuid, uuid, text, text, uuid)
  to service_role;
grant execute on function public.record_aba_trial_correction_v3(uuid, uuid, uuid, text, jsonb, text, text, uuid, jsonb)
  to service_role;

-- PR4 deliberately creates no rollout state, exposes no browser writer and alters
-- no ABA Legacy V2 table or route.

commit;
