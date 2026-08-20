-- Structural regression test for Clinical Measurement Engine V3 ABA specialized engine.
begin;

do $assertions$
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
    if to_regclass('public.' || v_table) is null then raise exception 'CMV3_ABA_TABLE_MISSING: %', v_table; end if;
    if not exists (
      select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relname=v_table and c.relrowsecurity
    ) then raise exception 'CMV3_ABA_RLS_MISSING: %', v_table; end if;
    if has_table_privilege('authenticated','public.' || v_table,'SELECT')
       or has_table_privilege('anon','public.' || v_table,'SELECT') then
      raise exception 'CMV3_ABA_BROWSER_ACCESS_EXPOSED: %', v_table;
    end if;
  end loop;

  if not exists (select 1 from pg_catalog.pg_indexes where schemaname='public'
      and tablename='clinical_measurement_aba_trial_steps_v3'
      and indexname='ux_cabav3_trial_one_primary_independent') then
    raise exception 'CMV3_ABA_PRIMARY_OPPORTUNITY_GUARD_MISSING';
  end if;

  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid='public.clinical_measurement_aba_trial_steps_v3'::regclass
      and tgname='prepare_cabav3_trial_step' and not tgisinternal) then
    raise exception 'CMV3_ABA_TRIAL_STEP_SERVER_DERIVATION_MISSING';
  end if;

  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid='public.clinical_measurement_aba_task_step_results_v3'::regclass
      and tgname='prepare_cabav3_task_result' and not tgisinternal) then
    raise exception 'CMV3_ABA_TASK_ELIGIBILITY_DERIVATION_MISSING';
  end if;

  if to_regprocedure('public.publish_clinical_aba_prompt_hierarchy_version_v3(uuid)') is null
     or to_regprocedure('public.publish_clinical_aba_chaining_policy_version_v3(uuid)') is null then
    raise exception 'CMV3_ABA_CONFIG_PUBLISH_FUNCTION_MISSING';
  end if;

  if to_regprocedure('public.resolve_clinical_measurement_payload_kind_v3(uuid)') is null then
    raise exception 'CMV3_ABA_UNIFIED_PAYLOAD_RESOLVER_MISSING';
  end if;
end;
$assertions$;

rollback;
