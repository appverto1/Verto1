-- IA-03: tighten only reviewed direct-call SECURITY DEFINER writers/helpers.
-- All protected functions are used by server/service_role or owner-run SECURITY DEFINER callers,
-- not RLS policies. Do not revoke generic auth/RLS helpers or trigger functions.
-- No function body, data, trigger, RLS policy, index, or business flow is modified.
DO $ia03$
DECLARE
  v_name text;
  v_count integer;
  v_oid oid;
  v_signature text;
BEGIN
  FOR v_name IN SELECT unnest(ARRAY[
    'aba_refresh_patient_maintenance_summary',
    'aba_upsert_behavior_daily_duration',
    'complete_active_patient_billing_sync_job',
    'create_tiss_official_document',
    'enqueue_active_patient_billing_sync',
    'fail_active_patient_billing_sync_job',
    'reconcile_active_patient_billing_sync_queue',
    'school_assert_professional_availability',
    'school_audit_append',
    'school_idempotency_existing',
    'school_idempotency_store'
  ]::text[])
  LOOP
    SELECT count(*), (array_agg(p.oid))[1]
      INTO v_count, v_oid
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name;

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'IA03_EXPECTED_UNIQUE_FUNCTION:%:%', v_name, v_count;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid = v_oid AND p.prosecdef
        AND p.prorettype NOT IN ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
    ) THEN
      RAISE EXCEPTION 'IA03_UNEXPECTED_SIGNATURE_OR_SECURITY:%', v_name;
    END IF;

    SELECT format('public.%I(%s)', p.proname, pg_catalog.oidvectortypes(p.proargtypes))
      INTO v_signature FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;

    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);

    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'IA03_PRIVILEGE_VERIFICATION_FAILED:%', v_name;
    END IF;
  END LOOP;
END
$ia03$;
