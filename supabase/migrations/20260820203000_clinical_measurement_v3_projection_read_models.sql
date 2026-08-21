-- Verto Clinical Measurement Engine V3 - Projection Engine + family read models.
-- Additive/dark only. Raw accepted facts remain authority; all tables below are
-- rebuildable projections or operational queue state. No browser reads/writes.

begin;

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

commit;
