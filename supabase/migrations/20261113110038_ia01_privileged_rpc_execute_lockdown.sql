-- IA-01 (phase 1/58): deny direct public access to privileged ABA and billing helpers.
-- ABA helpers are called by SECURITY DEFINER trigger functions owned by postgres.
-- The billing queue claimer is reserved for the trusted service_role worker.
-- Do not modify function bodies, business logic, RLS, or trigger bindings here.

do $ia01_preflight$
declare
  v_signature text;
  v_function oid;
begin
  foreach v_signature in array array[
    'public.aba_touch_patient_summary(text,text,uuid,integer,integer,integer,timestamptz,text,timestamptz)',
    'public.aba_create_maintenance_schedules_for_mastery(text,text,uuid,text,text,timestamptz,jsonb)',
    'public.claim_active_patient_billing_sync_jobs(uuid,integer)'
  ] loop
    v_function := to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'IA01_PREFLIGHT_MISSING_FUNCTION: %', v_signature;
    end if;
    if not exists (
      select 1 from pg_proc p
      where p.oid = v_function and p.prosecdef
    ) then
      raise exception 'IA01_PREFLIGHT_EXPECTED_SECURITY_DEFINER: %', v_signature;
    end if;
  end loop;
end;
$ia01_preflight$;

revoke execute on function public.aba_touch_patient_summary(
  text, text, uuid, integer, integer, integer, timestamptz, text, timestamptz
) from public, anon, authenticated;

revoke execute on function public.aba_create_maintenance_schedules_for_mastery(
  text, text, uuid, text, text, timestamptz, jsonb
) from public, anon, authenticated;

revoke execute on function public.claim_active_patient_billing_sync_jobs(
  uuid, integer
) from public, anon, authenticated;

-- Keep the existing trusted backend service-role path explicit.
grant execute on function public.aba_touch_patient_summary(
  text, text, uuid, integer, integer, integer, timestamptz, text, timestamptz
) to service_role;
grant execute on function public.aba_create_maintenance_schedules_for_mastery(
  text, text, uuid, text, text, timestamptz, jsonb
) to service_role;
grant execute on function public.claim_active_patient_billing_sync_jobs(
  uuid, integer
) to service_role;

do $ia01_verify$
declare
  v_signature text;
  v_function oid;
begin
  foreach v_signature in array array[
    'public.aba_touch_patient_summary(text,text,uuid,integer,integer,integer,timestamptz,text,timestamptz)',
    'public.aba_create_maintenance_schedules_for_mastery(text,text,uuid,text,text,timestamptz,jsonb)',
    'public.claim_active_patient_billing_sync_jobs(uuid,integer)'
  ] loop
    v_function := to_regprocedure(v_signature);
    if has_function_privilege('anon', v_function, 'EXECUTE')
      or has_function_privilege('authenticated', v_function, 'EXECUTE')
      or not has_function_privilege('service_role', v_function, 'EXECUTE')
    then
      raise exception 'IA01_POSTCHECK_EXECUTE_GRANTS_FAILED: %', v_signature;
    end if;
  end loop;
end;
$ia01_verify$;

notify pgrst, 'reload schema';
