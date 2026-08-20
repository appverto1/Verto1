-- Structural regression test for Clinical Measurement Engine V3 Migration B.
-- Run after Migration B in staging/test. Read-only and rolled back.

begin;

do $assertions$
declare
  v_table text;
  v_manaus_clinical_date date;
begin
  foreach v_table in array array[
    'clinical_measurement_sessions_v3',
    'clinical_measurement_session_expectations_v3',
    'clinical_measurement_collection_streams_v3'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'CMV3_MIGRATION_B_TABLE_MISSING: %', v_table;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = v_table
        and relation.relrowsecurity
    ) then
      raise exception 'CMV3_MIGRATION_B_RLS_MISSING: %', v_table;
    end if;

    if has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
       or has_table_privilege('anon', 'public.' || v_table, 'SELECT') then
      raise exception 'CMV3_MIGRATION_B_BROWSER_ACCESS_EXPOSED: %', v_table;
    end if;

    if not has_table_privilege('service_role', 'public.' || v_table, 'SELECT') then
      raise exception 'CMV3_MIGRATION_B_SERVICE_ROLE_ACCESS_MISSING: %', v_table;
    end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'clinical_measurement_collection_streams_v3'
      and indexname = 'ux_cmv3_primary_stream_per_expectation'
  ) then
    raise exception 'CMV3_PRIMARY_STREAM_UNIQUENESS_GUARD_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_collection_streams_v3'::regclass
      and conname = 'cmv3_stream_paired_primary_scope_fkey'
      and contype = 'f'
  ) then
    raise exception 'CMV3_STREAM_PAIR_SCOPE_FK_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.clinical_measurement_sessions_v3'::regclass
      and tgname = 'prepare_clinical_measurement_session_v3'
      and not tgisinternal
  ) then
    raise exception 'CMV3_SESSION_TIME_NORMALIZATION_TRIGGER_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.clinical_measurement_session_expectations_v3'::regclass
      and tgname = 'guard_clinical_measurement_expectation_v3'
      and not tgisinternal
  ) then
    raise exception 'CMV3_EXPECTATION_IMMUTABILITY_TRIGGER_MISSING';
  end if;

  -- The canonical edge case: 2026-03-11 03:30Z is still March 10 in Manaus.
  v_manaus_clinical_date := timezone(
    'America/Manaus',
    '2026-03-11 03:30:00+00'::timestamptz
  )::date;
  if v_manaus_clinical_date <> date '2026-03-10' then
    raise exception 'CMV3_CLINICAL_DATE_TIMEZONE_REGRESSION: %', v_manaus_clinical_date;
  end if;
end;
$assertions$;

rollback;
