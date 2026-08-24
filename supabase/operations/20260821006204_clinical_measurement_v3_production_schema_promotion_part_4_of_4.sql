-- Verto Clinical Measurement Engine V3
-- Production schema catch-up promotion — SPLIT EXECUTION
--
-- IMPORTANT
--   Execute the four parts in numerical order, in PRODUCTION.
--   Each part is its own transaction and is independently fail-closed.
--   If any part fails, stop and send the error before continuing.
--   No part enables ABA V3 rollout or performs clinical backfill/shadow execution.

-- PART 4/4

begin;
set local lock_timeout = '5s';

do $cmv3_prod_split_part4_preflight$
declare
  v_missing text[] := '{}'::text[];
  v_present text[] := '{}'::text[];
  v_enabled bigint := 0;
begin
  if to_regprocedure('public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)') is null then v_missing := array_append(v_missing,'part3:sync_clinical_measurements_bulk_v3'); end if;
  if to_regclass('public.clinical_measurement_projection_queue_v3') is null then v_missing := array_append(v_missing,'part3:clinical_measurement_projection_queue_v3'); end if;
  if to_regclass('public.clinical_measurement_evidence_revisions_v3') is null then v_missing := array_append(v_missing,'part3:clinical_measurement_evidence_revisions_v3'); end if;
  if cardinality(v_missing) > 0 then raise exception 'CMV3_SPLIT_PART4_REQUIRES_PART3:%', array_to_string(v_missing,', '); end if;

  if to_regprocedure('public.get_clinical_measurement_v3_security_preflight()') is not null then v_present := array_append(v_present,'get_clinical_measurement_v3_security_preflight'); end if;
  if to_regclass('public.clinical_measurement_shadow_mirror_links_v3') is not null then v_present := array_append(v_present,'clinical_measurement_shadow_mirror_links_v3'); end if;
  if cardinality(v_present) > 0 then raise exception 'CMV3_SPLIT_PART4_ALREADY_OR_PARTIALLY_APPLIED:%', array_to_string(v_present,', '); end if;

  select count(*) into v_enabled from public.aba_measurement_rollout_states_v3 where allow_new_v3_sessions is true;
  if v_enabled <> 0 then raise exception 'CMV3_SPLIT_PART4_ACTIVE_ROLLOUT:%', v_enabled; end if;
end;
$cmv3_prod_split_part4_preflight$;

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




-- Final full promotion postflight.
do $cmv3_prod_split_part4_postflight$
declare
  v_missing text[] := '{}'::text[];
  v_enabled bigint := 0;
  v_security jsonb;
  v_raw bigint := 0;
  v_shadow bigint := 0;
begin
  if to_regprocedure('public.get_aba_session_read_bundle_v3(uuid,uuid,text)') is null then v_missing := array_append(v_missing,'get_aba_session_read_bundle_v3'); end if;
  if to_regprocedure('public.record_aba_trial_action_v3(uuid,uuid,jsonb,text,uuid)') is null then v_missing := array_append(v_missing,'record_aba_trial_action_v3'); end if;
  if to_regclass('public.clinical_measurement_targets_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_targets_v3'); end if;
  if to_regclass('public.clinical_measurement_sessions_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_sessions_v3'); end if;
  if to_regclass('public.clinical_measurement_raw_events_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_raw_events_v3'); end if;
  if to_regclass('public.clinical_measurement_aba_trials_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_aba_trials_v3'); end if;
  if to_regprocedure('public.sync_clinical_measurements_bulk_v3(uuid,uuid,uuid,text,jsonb)') is null then v_missing := array_append(v_missing,'sync_clinical_measurements_bulk_v3'); end if;
  if to_regclass('public.clinical_measurement_projection_queue_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_projection_queue_v3'); end if;
  if to_regprocedure('public.process_clinical_measurement_projection_queue_v3(integer)') is null then v_missing := array_append(v_missing,'process_clinical_measurement_projection_queue_v3'); end if;
  if to_regclass('public.clinical_measurement_evidence_revisions_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_evidence_revisions_v3'); end if;
  if to_regprocedure('public.get_clinical_measurement_v3_security_preflight()') is null then v_missing := array_append(v_missing,'get_clinical_measurement_v3_security_preflight'); end if;
  if to_regclass('public.clinical_measurement_shadow_mirror_links_v3') is null then v_missing := array_append(v_missing,'clinical_measurement_shadow_mirror_links_v3'); end if;
  if to_regprocedure('public.run_clinical_measurement_v3_aba_shadow_mirror(uuid,uuid,text,date,date)') is null then v_missing := array_append(v_missing,'run_clinical_measurement_v3_aba_shadow_mirror'); end if;
  if cardinality(v_missing)>0 then raise exception 'CMV3_SPLIT_PART4_POSTFLIGHT_MISSING:%',array_to_string(v_missing,', '); end if;

  select count(*) into v_enabled from public.aba_measurement_rollout_states_v3 where allow_new_v3_sessions is true;
  if v_enabled<>0 then raise exception 'CMV3_SPLIT_PART4_CHANGED_ROLLOUT:%',v_enabled; end if;

  v_security := public.get_clinical_measurement_v3_security_preflight();
  if coalesce((v_security->>'ok')::boolean,false) is false then raise exception 'CMV3_SPLIT_PART4_SECURITY_PREFLIGHT_FAILED:%',v_security::text; end if;

  select count(*) into v_raw from public.clinical_measurement_raw_events_v3;
  select count(*) into v_shadow from public.clinical_measurement_shadow_mirror_links_v3;
  if v_raw<>0 or v_shadow<>0 then raise exception 'CMV3_SPLIT_PART4_UNEXPECTED_CMV3_DATA:raw=%,shadow=%',v_raw,v_shadow; end if;
end;
$cmv3_prod_split_part4_postflight$;
commit;

select jsonb_build_object(
  'gate','PRODUCTION_SCHEMA_PROMOTED_DARK',
  'release_stage','PRODUCTION_SCHEMA_CATCHUP',
  'rollout_enabled',exists(select 1 from public.aba_measurement_rollout_states_v3 where allow_new_v3_sessions is true),
  'cmv3_raw_event_count',(select count(*) from public.clinical_measurement_raw_events_v3),
  'shadow_mirror_link_count',(select count(*) from public.clinical_measurement_shadow_mirror_links_v3),
  'security_preflight',public.get_clinical_measurement_v3_security_preflight(),
  'next_step','RERUN_PRODUCTION_ACTIVATION_READINESS_GATE'
) as clinical_measurement_v3_production_schema_promotion_result;
