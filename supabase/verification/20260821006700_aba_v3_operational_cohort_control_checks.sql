-- Read-only verification for the ABA V3 exact-target operational rollout surface.
select jsonb_build_object(
  'gate', case
    when to_regprocedure('public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text)') is null
      or to_regprocedure('public.set_aba_v3_exact_target_cohort_v1(uuid,uuid,text,text,boolean,text,uuid,bigint,bigint,bigint)') is null
      then 'BLOCKED_OPERATIONAL_RPC_MISSING'
    when has_function_privilege('authenticated','public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text)','EXECUTE')
      or has_function_privilege('authenticated','public.set_aba_v3_exact_target_cohort_v1(uuid,uuid,text,text,boolean,text,uuid,bigint,bigint,bigint)','EXECUTE')
      then 'BLOCKED_BROWSER_EXECUTE'
    when not has_function_privilege('service_role','public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text)','EXECUTE')
      or not has_function_privilege('service_role','public.set_aba_v3_exact_target_cohort_v1(uuid,uuid,text,text,boolean,text,uuid,bigint,bigint,bigint)','EXECUTE')
      then 'BLOCKED_SERVICE_ROLE_EXECUTE'
    else 'PASS'
  end,
  'snapshot_rpc_ready', to_regprocedure('public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text)') is not null,
  'control_rpc_ready', to_regprocedure('public.set_aba_v3_exact_target_cohort_v1(uuid,uuid,text,text,boolean,text,uuid,bigint,bigint,bigint)') is not null,
  'browser_snapshot_execute', has_function_privilege('authenticated','public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text)','EXECUTE'),
  'browser_control_execute', has_function_privilege('authenticated','public.set_aba_v3_exact_target_cohort_v1(uuid,uuid,text,text,boolean,text,uuid,bigint,bigint,bigint)','EXECUTE'),
  'service_role_snapshot_execute', has_function_privilege('service_role','public.get_aba_v3_exact_target_cohort_snapshot_v1(uuid,uuid,text,text)','EXECUTE'),
  'service_role_control_execute', has_function_privilege('service_role','public.set_aba_v3_exact_target_cohort_v1(uuid,uuid,text,text,boolean,text,uuid,bigint,bigint,bigint)','EXECUTE'),
  'writes', false
) as aba_v3_operational_cohort_control_checks;
