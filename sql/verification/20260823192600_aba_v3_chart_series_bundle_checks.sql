-- ABA V3 simplified analytics bundle — read-only installation checks.
select jsonb_build_object(
  'gate', case
    when to_regprocedure('public.get_aba_chart_series_bundle_v3(uuid,uuid,text[],timestamp with time zone,timestamp with time zone,integer)') is null
      then 'BLOCKED_ABA_V3_CHART_BUNDLE_RPC_MISSING'
    when to_regprocedure('public.get_aba_patient_overview_v3(uuid,uuid)') is null
      then 'BLOCKED_ABA_V3_PATIENT_OVERVIEW_RPC_MISSING'
    when has_function_privilege('authenticated', 'public.get_aba_chart_series_bundle_v3(uuid,uuid,text[],timestamp with time zone,timestamp with time zone,integer)', 'EXECUTE')
      then 'BLOCKED_ABA_V3_CHART_BUNDLE_BROWSER_EXECUTE'
    when has_function_privilege('authenticated', 'public.get_aba_patient_overview_v3(uuid,uuid)', 'EXECUTE')
      then 'BLOCKED_ABA_V3_PATIENT_OVERVIEW_BROWSER_EXECUTE'
    when not has_function_privilege('service_role', 'public.get_aba_chart_series_bundle_v3(uuid,uuid,text[],timestamp with time zone,timestamp with time zone,integer)', 'EXECUTE')
      then 'BLOCKED_ABA_V3_CHART_BUNDLE_SERVICE_ROLE_EXECUTE'
    when not has_function_privilege('service_role', 'public.get_aba_patient_overview_v3(uuid,uuid)', 'EXECUTE')
      then 'BLOCKED_ABA_V3_PATIENT_OVERVIEW_SERVICE_ROLE_EXECUTE'
    else 'PASS_ABA_V3_SIMPLIFIED_ANALYTICS_READS'
  end,
  'bundle_function_ready', to_regprocedure('public.get_aba_chart_series_bundle_v3(uuid,uuid,text[],timestamp with time zone,timestamp with time zone,integer)') is not null,
  'overview_function_ready', to_regprocedure('public.get_aba_patient_overview_v3(uuid,uuid)') is not null,
  'bundle_authenticated_execute', has_function_privilege('authenticated', 'public.get_aba_chart_series_bundle_v3(uuid,uuid,text[],timestamp with time zone,timestamp with time zone,integer)', 'EXECUTE'),
  'overview_authenticated_execute', has_function_privilege('authenticated', 'public.get_aba_patient_overview_v3(uuid,uuid)', 'EXECUTE'),
  'bundle_service_role_execute', has_function_privilege('service_role', 'public.get_aba_chart_series_bundle_v3(uuid,uuid,text[],timestamp with time zone,timestamp with time zone,integer)', 'EXECUTE'),
  'overview_service_role_execute', has_function_privilege('service_role', 'public.get_aba_patient_overview_v3(uuid,uuid)', 'EXECUTE'),
  'writes', false
) as aba_v3_simplified_analytics_read_checks;
