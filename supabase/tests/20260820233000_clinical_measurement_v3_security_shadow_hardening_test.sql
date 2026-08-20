-- Clinical Measurement Engine V3 - Migration I executable security contracts.

do $test$
declare
  preflight jsonb;
  bad_browser_functions integer;
  bad_browser_relations integer;
begin
  if to_regprocedure('public.get_clinical_measurement_v3_security_preflight()') is null then
    raise exception 'TEST_CMV3_SECURITY_PREFLIGHT_MISSING';
  end if;
  if to_regprocedure('public.get_clinical_measurement_v3_shadow_comparison(uuid,uuid,uuid,uuid,date,date)') is null then
    raise exception 'TEST_CMV3_SHADOW_COMPARISON_MISSING';
  end if;

  if pg_catalog.has_function_privilege('authenticated', 'public.publish_clinical_aba_prompt_hierarchy_version_v3(uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.publish_clinical_aba_chaining_policy_version_v3(uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.resolve_clinical_measurement_payload_kind_v3(uuid)', 'EXECUTE') then
    raise exception 'TEST_CMV3_SECURITY_DEFINER_BROWSER_EXECUTE_OPEN';
  end if;

  select count(*) into bad_browser_functions
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and (
      p.proname like 'clinical_measurement\_%\_v3' escape '\'
      or p.proname like 'clinical_aba\_%\_v3' escape '\'
      or p.proname like 'cmv3\_%' escape '\'
    )
    and (
      pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
    );
  if bad_browser_functions <> 0 then
    raise exception 'TEST_CMV3_BROWSER_FUNCTION_EXECUTE_FOUND:%', bad_browser_functions;
  end if;

  select count(*) into bad_browser_relations
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relkind in ('r','p')
    and (c.relname like 'clinical_measurement\_%\_v3' escape '\' or c.relname like 'clinical_aba\_%\_v3' escape '\')
    and (
      not c.relrowsecurity
      or pg_catalog.has_table_privilege('anon',c.oid,'SELECT')
      or pg_catalog.has_table_privilege('anon',c.oid,'INSERT')
      or pg_catalog.has_table_privilege('anon',c.oid,'UPDATE')
      or pg_catalog.has_table_privilege('anon',c.oid,'DELETE')
      or pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT')
      or pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT')
      or pg_catalog.has_table_privilege('authenticated',c.oid,'UPDATE')
      or pg_catalog.has_table_privilege('authenticated',c.oid,'DELETE')
    );
  if bad_browser_relations <> 0 then
    raise exception 'TEST_CMV3_BROWSER_RELATION_ACCESS_FOUND:%', bad_browser_relations;
  end if;

  preflight := public.get_clinical_measurement_v3_security_preflight();
  if coalesce((preflight->>'ok')::boolean,false) is not true then
    raise exception 'TEST_CMV3_SECURITY_PREFLIGHT_NOT_CLEAN:%', preflight::text;
  end if;
end;
$test$;

select 'clinical_measurement_v3_security_shadow_hardening_test: ok' as result;
