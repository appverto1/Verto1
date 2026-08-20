-- Structural database regression test for Clinical Measurement Engine V3 Migration A.
-- Run after the migration in staging/test. This test is read-only and rolls back.

begin;

do $assertions$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clinical_measurement_targets_v3',
    'clinical_measurement_definitions_v3',
    'clinical_measurement_definition_versions_v3',
    'clinical_measurement_definition_activations_v3',
    'clinical_measurement_phases_v3',
    'clinical_measurement_phase_versions_v3',
    'clinical_measurement_phase_epochs_v3',
    'clinical_collection_protocol_snapshots_v3'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'CMV3_MIGRATION_A_TABLE_MISSING: %', v_table;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = v_table
        and relation.relrowsecurity
    ) then
      raise exception 'CMV3_MIGRATION_A_RLS_MISSING: %', v_table;
    end if;

    if has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
       or has_table_privilege('anon', 'public.' || v_table, 'SELECT') then
      raise exception 'CMV3_MIGRATION_A_BROWSER_ACCESS_EXPOSED: %', v_table;
    end if;

    if not has_table_privilege('service_role', 'public.' || v_table, 'SELECT') then
      raise exception 'CMV3_MIGRATION_A_SERVICE_ROLE_ACCESS_MISSING: %', v_table;
    end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_definition_activations_v3'::regclass
      and conname = 'cmv3_definition_activation_no_overlap'
      and contype = 'x'
  ) then
    raise exception 'CMV3_DEFINITION_ACTIVATION_OVERLAP_GUARD_MISSING';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.clinical_measurement_phase_epochs_v3'::regclass
      and conname = 'cmv3_phase_epoch_no_overlap'
      and contype = 'x'
  ) then
    raise exception 'CMV3_PHASE_EPOCH_OVERLAP_GUARD_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clinical_measurement_definition_activations_v3'
      and column_name = 'recorded_at'
      and data_type = 'timestamp with time zone'
  ) then
    raise exception 'CMV3_DEFINITION_ACTIVATION_RECORDED_AT_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clinical_measurement_phase_epochs_v3'
      and column_name = 'recorded_at'
      and data_type = 'timestamp with time zone'
  ) then
    raise exception 'CMV3_PHASE_EPOCH_RECORDED_AT_MISSING';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.clinical_collection_protocol_snapshots_v3'::regclass
      and tgname = 'guard_cmv3_protocol_snapshot'
      and not tgisinternal
  ) then
    raise exception 'CMV3_PROTOCOL_SNAPSHOT_IMMUTABILITY_GUARD_MISSING';
  end if;

  if exists (
    select 1
    from public.clinical_measurement_targets_v3
  ) or exists (
    select 1
    from public.clinical_measurement_definitions_v3
  ) or exists (
    select 1
    from public.clinical_measurement_phases_v3
  ) then
    raise exception 'CMV3_MIGRATION_A_MUST_NOT_SEED_CLINICAL_IDENTITIES';
  end if;
end;
$assertions$;

rollback;
