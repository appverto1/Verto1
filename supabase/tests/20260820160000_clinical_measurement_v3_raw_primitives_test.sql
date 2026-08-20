-- Structural regression test for Clinical Measurement Engine V3 Raw Primitives.
-- Run after the migration in staging/test. Read-only and rolled back.

begin;

do $assertions$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinical_measurement_raw_events_v3',
    'clinical_measurement_raw_event_payload_claims_v3',
    'clinical_measurement_observation_slices_v3',
    'clinical_measurement_count_facts_v3',
    'clinical_measurement_category_facts_v3',
    'clinical_measurement_scalar_facts_v3',
    'clinical_measurement_interval_facts_v3',
    'clinical_measurement_interval_samples_v3',
    'clinical_measurement_explicit_absence_facts_v3'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'CMV3_RAW_TABLE_MISSING: %', v_table;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = v_table
        and relation.relrowsecurity
    ) then
      raise exception 'CMV3_RAW_RLS_MISSING: %', v_table;
    end if;

    if has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
       or has_table_privilege('anon', 'public.' || v_table, 'SELECT') then
      raise exception 'CMV3_RAW_BROWSER_ACCESS_EXPOSED: %', v_table;
    end if;

    if not has_table_privilege('service_role', 'public.' || v_table, 'SELECT') then
      raise exception 'CMV3_RAW_SERVICE_ROLE_ACCESS_MISSING: %', v_table;
    end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_observation_slices_v3'::regclass
      and conname = 'cmv3_observation_slices_no_overlap'
      and contype = 'x'
  ) then
    raise exception 'CMV3_OBSERVATION_SLICE_OVERLAP_GUARD_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_interval_samples_v3'::regclass
      and conname = 'cmv3_interval_samples_no_overlap'
      and contype = 'x'
  ) then
    raise exception 'CMV3_INTERVAL_SAMPLE_OVERLAP_GUARD_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_raw_events_v3'::regclass
      and conname = 'cmv3_raw_event_subject_scope_fkey'
      and contype = 'f'
  ) then
    raise exception 'CMV3_RAW_SUBJECT_SCOPE_FK_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.clinical_measurement_raw_events_v3'::regclass
      and tgname = 'guard_clinical_measurement_raw_events_v3'
      and not tgisinternal
  ) then
    raise exception 'CMV3_RAW_APPEND_ONLY_TRIGGER_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.clinical_measurement_raw_events_v3'::regclass
      and tgname = 'ensure_clinical_measurement_raw_payload_v3'
      and not tgisinternal
  ) then
    raise exception 'CMV3_RAW_TYPED_PAYLOAD_CONSTRAINT_TRIGGER_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_interval_samples_v3'::regclass
      and conname = 'cmv3_interval_samples_index_lineage_guard'
      and contype = 'x'
  ) then
    raise exception 'CMV3_INTERVAL_SAMPLE_INDEX_LINEAGE_GUARD_MISSING';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'clinical_measurement_raw_events_v3'
      and indexname = 'idx_cmv3_raw_events_stream_timeline'
  ) then
    raise exception 'CMV3_RAW_STREAM_INDEX_MISSING';
  end if;
end;
$assertions$;

rollback;
