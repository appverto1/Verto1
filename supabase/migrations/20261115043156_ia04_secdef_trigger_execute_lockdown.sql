-- IA-04: revoke external EXECUTE on existing SECURITY DEFINER trigger functions only.
-- PostgreSQL checks EXECUTE when CREATE TRIGGER is issued. Existing trigger bindings
-- remain in pg_trigger and continue to fire when their tables are written.
-- Do not alter triggers, function bodies, RLS policies, clinical records or grants on tables.
-- Reviewed against Staging's pg_proc/pg_trigger/pg_policies on 2026-11-15.
DO $ia04$
DECLARE
  v_name text;
  v_oid oid;
  v_count integer;
  v_trigger_count integer;
BEGIN
  -- Fail closed if this staging baseline changes; production has a different catalog.
  SELECT count(*) INTO v_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND p.prorettype = 'pg_catalog.trigger'::regtype
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_count <> 34 THEN
    RAISE EXCEPTION 'IA04_TRIGGER_BASELINE_DRIFT:%', v_count;
  END IF;

  FOR v_name IN SELECT unnest(ARRAY[
    'aba_audit_target_clinical_status_change',
    'aba_mark_pending_next_session_probe_candidate',
    'aba_recommendation_audit_append_only',
    'aba_refresh_maintenance_summary_trigger',
    'aba_regression_alert_after_probe_result',
    'aba_schedule_maintenance_after_mastery_audit',
    'aba_summary_after_behavior_insert',
    'aba_summary_after_duration_completed',
    'aba_summary_after_interval_summary_insert',
    'aba_summary_after_session_completed',
    'aba_summary_after_session_insert',
    'aba_summary_after_trial_insert',
    'assert_patient_finance_payment_reference',
    'assign_school_organization_to_clinic',
    'bind_aba_session_pts_context_after_insert_v1',
    'bootstrap_patient_pts_document_v2',
    'enforce_patient_file_acl_write_v1',
    'enforce_sales_script_attribution_v1',
    'enqueue_clinical_measurement_projection_from_raw_v3',
    'enqueue_clinical_measurement_projection_on_session_finalization',
    'enrich_sales_modular_offer_snapshot_v1',
    'guard_aba_behavior_v3_no_delete',
    'guard_aba_session_specialty_isolation_v1',
    'guard_aba_session_therapeutic_plan_binding_v1',
    'guard_aba_trial_specialty_isolation_v1',
    'guard_appointment_active_specialty_v1',
    'payment_transaction_refresh_charge',
    'persist_sales_offer_item_discount_v1',
    'prepare_clinical_measurement_criterion_epoch_v3',
    'prepare_clinical_measurement_evidence_revision_v3',
    'prevent_patient_finance_payment_delete',
    'reconcile_aba_behavior_summary_v3_after_fact',
    'schedule_offer_item_discount_notifications_v1',
    'validate_clinical_measurement_decision_actor_v3'
  ]::text[])
  LOOP
    SELECT count(*), (array_agg(p.oid))[1] INTO v_count, v_oid
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name;

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'IA04_MISSING_OR_OVERLOADED_TRIGGER:%:%', v_name, v_count;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid = v_oid AND p.prosecdef
        AND p.prorettype = 'pg_catalog.trigger'::regtype
        AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
        AND has_function_privilege('anon', p.oid, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'IA04_UNEXPECTED_TRIGGER_DEFINITION:%', v_name;
    END IF;
    SELECT count(*) INTO v_trigger_count
    FROM pg_catalog.pg_trigger t WHERE t.tgfoid = v_oid AND NOT t.tgisinternal;
    IF v_trigger_count < 1 THEN
      RAISE EXCEPTION 'IA04_MISSING_INSTALLED_TRIGGER:%', v_name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies pol
      WHERE coalesce(pol.qual, '') ILIKE '%' || v_name || '%'
        OR coalesce(pol.with_check, '') ILIKE '%' || v_name || '%'
    ) THEN
      RAISE EXCEPTION 'IA04_UNEXPECTED_POLICY_DEPENDENCY:%', v_name;
    END IF;

    EXECUTE format('REVOKE ALL ON FUNCTION public.%I() FROM PUBLIC, anon, authenticated', v_name);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I() TO service_role', v_name);

    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'IA04_TRIGGER_ACL_VERIFICATION_FAILED:%', v_name;
    END IF;
  END LOOP;
END
$ia04$;
