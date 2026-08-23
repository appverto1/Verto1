-- ABA V3 — production health observability verification.
-- READ ONLY. Run after 20260823213000_aba_v3_production_health_snapshot.sql.

select jsonb_build_object(
  'gate', case
    when to_regprocedure('public.get_aba_v3_production_health_v1(uuid,integer)') is null
      then 'BLOCKED_ABA_V3_PRODUCTION_HEALTH_FUNCTION_MISSING'
    when has_function_privilege('authenticated', 'public.get_aba_v3_production_health_v1(uuid,integer)', 'EXECUTE')
      then 'BLOCKED_ABA_V3_PRODUCTION_HEALTH_BROWSER_EXECUTE'
    when has_function_privilege('anon', 'public.get_aba_v3_production_health_v1(uuid,integer)', 'EXECUTE')
      then 'BLOCKED_ABA_V3_PRODUCTION_HEALTH_ANON_EXECUTE'
    when not has_function_privilege('service_role', 'public.get_aba_v3_production_health_v1(uuid,integer)', 'EXECUTE')
      then 'BLOCKED_ABA_V3_PRODUCTION_HEALTH_SERVICE_ROLE_EXECUTE'
    else 'PASS_ABA_V3_PRODUCTION_OBSERVABILITY'
  end,
  'writes', false,
  'browser_execute_revoked',
    not has_function_privilege('authenticated', 'public.get_aba_v3_production_health_v1(uuid,integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_aba_v3_production_health_v1(uuid,integer)', 'EXECUTE'),
  'service_role_execute', has_function_privilege('service_role', 'public.get_aba_v3_production_health_v1(uuid,integer)', 'EXECUTE'),
  'live_health', public.get_aba_v3_production_health_v1(null, 7)
) as aba_v3_production_health_snapshot_check;
