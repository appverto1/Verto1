do $test$
begin
  if to_regclass('public.clinical_measurement_shadow_mirror_links_v3') is null then raise exception 'CMV3_SHADOW_MIRROR_LINK_TABLE_MISSING'; end if;
  if to_regprocedure('public.run_clinical_measurement_v3_aba_shadow_mirror(uuid,uuid,text,date,date)') is null then raise exception 'CMV3_SHADOW_MIRROR_FUNCTION_MISSING'; end if;
  if pg_catalog.has_function_privilege('anon','public.run_clinical_measurement_v3_aba_shadow_mirror(uuid,uuid,text,date,date)','EXECUTE') then raise exception 'CMV3_SHADOW_MIRROR_EXPOSED_TO_ANON'; end if;
  if pg_catalog.has_function_privilege('authenticated','public.run_clinical_measurement_v3_aba_shadow_mirror(uuid,uuid,text,date,date)','EXECUTE') then raise exception 'CMV3_SHADOW_MIRROR_EXPOSED_TO_AUTHENTICATED'; end if;
  if not pg_catalog.has_function_privilege('service_role','public.run_clinical_measurement_v3_aba_shadow_mirror(uuid,uuid,text,date,date)','EXECUTE') then raise exception 'CMV3_SHADOW_MIRROR_SERVICE_ROLE_MISSING'; end if;
end;$test$;
select 'clinical_measurement_v3_dark_aba_shadow_mirror_test: ok' as result;
