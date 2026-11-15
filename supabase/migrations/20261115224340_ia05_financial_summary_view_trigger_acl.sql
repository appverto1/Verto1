-- IA-05 extension: remove the only remaining public-schema view TRIGGER ACL.
-- The financial summary view has zero installed triggers; no SELECT/DML ACL,
-- definition, RLS policy, underlying data or business behavior is modified.
DO $ia05_view$
DECLARE v_oid oid;
BEGIN
  SELECT c.oid INTO v_oid FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='patient_financial_appointment_summaries'
    AND c.relkind='v' AND pg_catalog.pg_get_userbyid(c.relowner)='postgres';
  IF v_oid IS NULL
     OR NOT has_table_privilege('anon',v_oid,'TRIGGER')
     OR NOT has_table_privilege('authenticated',v_oid,'TRIGGER')
     OR NOT has_table_privilege('service_role',v_oid,'TRIGGER')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=v_oid AND NOT t.tgisinternal)
  THEN
    RAISE EXCEPTION 'IA05_FINANCIAL_VIEW_TRIGGER_BASELINE_DRIFT';
  END IF;

  EXECUTE 'REVOKE TRIGGER ON TABLE public.patient_financial_appointment_summaries FROM PUBLIC, anon, authenticated';

  IF has_table_privilege('anon',v_oid,'TRIGGER')
     OR has_table_privilege('authenticated',v_oid,'TRIGGER')
     OR NOT has_table_privilege('service_role',v_oid,'TRIGGER')
  THEN
    RAISE EXCEPTION 'IA05_FINANCIAL_VIEW_TRIGGER_POSTCHECK_FAILED';
  END IF;
END
$ia05_view$;
