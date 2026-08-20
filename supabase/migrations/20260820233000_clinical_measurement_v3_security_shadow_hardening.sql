-- Verto Clinical Measurement Engine V3 - Migration I: security hardening + shadow comparison.
-- Additive/dark only. Closes implicit PUBLIC EXECUTE on CMV3 functions, adds a
-- service-only security attestation, and provides read-only shadow comparison
-- across Universal V3, canonical ABA V3 and observational Legacy V2.

begin;

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

commit;
