-- IA-05: least-privilege ACL for seven anonymous RPC helpers and eighteen
-- existing tables with SECURITY DEFINER triggers (Staging only).
-- No function body, installed trigger, RLS policy, application code or data changes.
DO $ia05$
DECLARE
  v_fn record;
  v_name text;
  v_oid oid;
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND p.prorettype <> 'pg_catalog.trigger'::regtype
    AND has_function_privilege('anon',p.oid,'EXECUTE');
  IF v_count <> 10 THEN
    RAISE EXCEPTION 'IA05_ANON_SECDEF_BASELINE_DRIFT:%',v_count;
  END IF;

  -- Validate every change before writing any ACL. Entire DO is transactional.
  FOR v_fn IN SELECT * FROM (VALUES
    ('is_admin_or_owner', 'uuid'),
    ('is_platform_sales_admin', ''),
    ('patient_file_current_actor_can_read_v1', 'uuid'),
    ('school_actor_can_access_patient', 'uuid, uuid, uuid'),
    ('school_actor_has_role', 'uuid, uuid, uuid, text[]'),
    ('therapeutic_plan_version_current_actor_can_read_v1', 'uuid, uuid, text, text[], timestamp with time zone'),
    ('therapeutic_program_row_actor_can_access_v1', 'uuid, text, text, uuid, text, text[], text')
  ) AS fn(name,argtypes) LOOP
    v_oid := to_regprocedure(format('public.%I(%s)',v_fn.name,v_fn.argtypes));
    IF v_oid IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid=v_oid AND p.prosecdef
        AND p.prorettype <> 'pg_catalog.trigger'::regtype
        AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
        AND has_function_privilege('anon',p.oid,'EXECUTE')
        AND has_function_privilege('authenticated',p.oid,'EXECUTE')
        AND has_function_privilege('service_role',p.oid,'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'IA05_RPC_DEFINITION_OR_GRANT_DRIFT:%',v_fn.name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies pol
      WHERE (coalesce(pol.qual,'') ILIKE '%'||v_fn.name||'%'
         OR coalesce(pol.with_check,'') ILIKE '%'||v_fn.name||'%')
      AND ('public'=ANY(pol.roles) OR 'anon'=ANY(pol.roles))
    ) THEN
      RAISE EXCEPTION 'IA05_PUBLIC_RLS_DEPENDENCY:%',v_fn.name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid <> v_oid AND NOT p.prosecdef
        AND p.prosrc ILIKE '%'||v_fn.name||'%'
    ) OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_views v
      WHERE v.definition ILIKE '%'||v_fn.name||'%'
    ) THEN
      RAISE EXCEPTION 'IA05_INVOKER_OR_VIEW_DEPENDENCY:%',v_fn.name;
    END IF;
  END LOOP;

  FOR v_name IN SELECT unnest(ARRAY[
    'aba_behavior_events',
    'aba_clinical_recommendation_audit_logs',
    'aba_interval_summaries',
    'aba_maintenance_probe_results',
    'aba_maintenance_schedules',
    'aba_regression_alerts',
    'aba_sessions',
    'aba_target_status_audit_logs',
    'aba_targets',
    'aba_trials',
    'appointments',
    'clinics',
    'patient_files',
    'patient_therapeutic_plans',
    'payment_appointment_items',
    'payment_audit_events',
    'payment_transactions',
    'payments'
  ]::text[]) LOOP
    SELECT c.oid INTO v_oid
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=v_name AND c.relkind IN ('r','p')
      AND pg_catalog.pg_get_userbyid(c.relowner)='postgres';
    IF v_oid IS NULL
       OR NOT has_table_privilege('anon',v_oid,'TRIGGER')
       OR NOT has_table_privilege('authenticated',v_oid,'TRIGGER')
       OR NOT has_table_privilege('service_role',v_oid,'TRIGGER')
       OR NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_trigger t
         JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
         WHERE t.tgrelid=v_oid AND NOT t.tgisinternal AND p.prosecdef
           AND p.prorettype='pg_catalog.trigger'::regtype
           AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
       )
    THEN
      RAISE EXCEPTION 'IA05_TABLE_TRIGGER_BASELINE_DRIFT:%',v_name;
    END IF;
  END LOOP;

  FOR v_fn IN SELECT * FROM (VALUES
    ('is_admin_or_owner', 'uuid'),
    ('is_platform_sales_admin', ''),
    ('patient_file_current_actor_can_read_v1', 'uuid'),
    ('school_actor_can_access_patient', 'uuid, uuid, uuid'),
    ('school_actor_has_role', 'uuid, uuid, uuid, text[]'),
    ('therapeutic_plan_version_current_actor_can_read_v1', 'uuid, uuid, text, text[], timestamp with time zone'),
    ('therapeutic_program_row_actor_can_access_v1', 'uuid, text, text, uuid, text, text[], text')
  ) AS fn(name,argtypes) LOOP
    v_oid := to_regprocedure(format('public.%I(%s)',v_fn.name,v_fn.argtypes));
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon',v_fn.name,v_fn.argtypes);
    IF has_function_privilege('anon',v_oid,'EXECUTE')
       OR NOT has_function_privilege('authenticated',v_oid,'EXECUTE')
       OR NOT has_function_privilege('service_role',v_oid,'EXECUTE')
    THEN
      RAISE EXCEPTION 'IA05_RPC_ACL_VERIFICATION_FAILED:%',v_fn.name;
    END IF;
  END LOOP;

  FOR v_name IN SELECT unnest(ARRAY[
    'aba_behavior_events',
    'aba_clinical_recommendation_audit_logs',
    'aba_interval_summaries',
    'aba_maintenance_probe_results',
    'aba_maintenance_schedules',
    'aba_regression_alerts',
    'aba_sessions',
    'aba_target_status_audit_logs',
    'aba_targets',
    'aba_trials',
    'appointments',
    'clinics',
    'patient_files',
    'patient_therapeutic_plans',
    'payment_appointment_items',
    'payment_audit_events',
    'payment_transactions',
    'payments'
  ]::text[]) LOOP
    SELECT c.oid INTO v_oid
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=v_name;
    EXECUTE format('REVOKE TRIGGER ON TABLE public.%I FROM PUBLIC, anon, authenticated',v_name);
    IF has_table_privilege('anon',v_oid,'TRIGGER')
       OR has_table_privilege('authenticated',v_oid,'TRIGGER')
       OR NOT has_table_privilege('service_role',v_oid,'TRIGGER')
    THEN
      RAISE EXCEPTION 'IA05_TABLE_ACL_VERIFICATION_FAILED:%',v_name;
    END IF;
  END LOOP;
END
$ia05$;
