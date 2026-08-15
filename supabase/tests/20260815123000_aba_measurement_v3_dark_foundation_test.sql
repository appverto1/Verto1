-- Structural regression test for 20260815123000_aba_measurement_v3_dark_foundation.sql.
-- Run only after the migration in staging/test. Rolls back its own probe rows.

begin;

do $assertions$
declare
  v_table text;
begin
  foreach v_table in array array[
    'aba_collection_definition_versions_v3',
    'aba_target_phase_assignments_v3',
    'aba_measurement_rollout_states_v3',
    'aba_measurement_rollout_events_v3',
    'aba_session_target_measurement_bindings'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'ABA_V3_DARK_TABLE_MISSING: %', v_table;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = v_table
        and relation.relrowsecurity
    ) then
      raise exception 'ABA_V3_DARK_RLS_MISSING: %', v_table;
    end if;

    if has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
       or has_table_privilege('anon', 'public.' || v_table, 'SELECT') then
      raise exception 'ABA_V3_DARK_BROWSER_PRIVILEGE_EXPOSED: %', v_table;
    end if;
  end loop;

  if exists (select 1 from public.aba_measurement_rollout_states_v3) then
    raise exception 'ABA_V3_DARK_ROLLOUT_SHOULD_START_EMPTY';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.aba_target_phase_assignments_v3'::regclass
      and conname = 'aba_target_phase_assignments_v3_no_overlap'
  ) then
    raise exception 'ABA_V3_PHASE_OVERLAP_CONSTRAINT_MISSING';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'aba_session_target_measurement_bindings'
      and indexdef ilike '%(session_id, target_id)%'
      and indexdef ilike 'CREATE UNIQUE INDEX%'
  ) then
    raise exception 'ABA_V3_SESSION_TARGET_BINDING_UNIQUENESS_MISSING';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'aba_target_phase_assignments_v3'
      and column_name = 'collection_definition_version_id'
  ) then
    raise exception 'ABA_V3_PHASE_AND_COLLECTION_VERSION_MUST_BE_ORTHOGONAL';
  end if;

  if not has_table_privilege(
    'service_role',
    'public.aba_session_target_measurement_bindings',
    'SELECT'
  ) then
    raise exception 'ABA_V3_DARK_SERVICE_ROLE_BINDING_ACCESS_MISSING';
  end if;
end;
$assertions$;

rollback;
