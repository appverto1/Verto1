-- Verto security: reconcile production/staging callable SECURITY DEFINER and TRIGGER ACL.
-- Safe on production baseline (55 anon SECDEF, 349 tables) and staging baseline (0, 374).
-- No data writes; existing triggers, clinical policies and authenticated RPC access stay intact.
BEGIN;
DO $security_acl$
DECLARE
  v_secdef_total integer;
  v_anon_before integer;
  v_auth_before integer;
  v_auth_after integer;
  v_table_total integer;
  v_trigger_count integer;
  v_service_before integer;
  v_service_after integer;
  v_role oid[];
  v_using text;
  v_check text;
  v_table record;
  v_fn record;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')),
         count(*) FILTER (WHERE pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'))
    INTO v_secdef_total,v_anon_before,v_auth_before
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prosecdef;
  IF (v_secdef_total,v_anon_before) NOT IN ((481,55),(491,0)) THEN
    RAISE EXCEPTION 'SECURITY_ACL_UNEXPECTED_FUNCTION_BASELINE: total %, anon %',v_secdef_total,v_anon_before;
  END IF;
  SELECT pol.polroles,
         pg_catalog.pg_get_expr(pol.polqual,pol.polrelid),
         pg_catalog.pg_get_expr(pol.polwithcheck,pol.polrelid)
    INTO STRICT v_role,v_using,v_check
    FROM pg_catalog.pg_policy pol
    JOIN pg_catalog.pg_class c ON c.oid=pol.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='clinic_protocol_grants'
     AND pol.polname='clinic_protocol_grants_platform_admin_all'
     AND pol.polcmd='*';
  IF v_using IS DISTINCT FROM 'is_platform_admin(auth.uid())'
     OR v_check IS DISTINCT FROM 'is_platform_admin(auth.uid())'
     OR v_role NOT IN (ARRAY[0::oid],ARRAY['authenticated'::regrole::oid]) THEN
    RAISE EXCEPTION 'SECURITY_ACL_PLATFORM_ADMIN_POLICY_DRIFT';
  END IF;
  SELECT count(*),
         count(*) FILTER (WHERE pg_catalog.has_table_privilege('service_role',c.oid,'TRIGGER'))
    INTO v_table_total,v_service_before
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p');
  IF v_table_total NOT IN (349,374) THEN
    RAISE EXCEPTION 'SECURITY_ACL_UNEXPECTED_TABLE_BASELINE: %',v_table_total;
  END IF;
  SELECT count(*) INTO v_trigger_count
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND NOT t.tgisinternal;

  -- A PUBLIC RLS policy relying on this helper must not invoke it as anon.
  IF v_role=ARRAY[0::oid] THEN
    EXECUTE 'ALTER POLICY clinic_protocol_grants_platform_admin_all ON public.clinic_protocol_grants TO authenticated';
  END IF;
  FOR v_fn IN
    SELECT p.oid
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prosecdef
       AND pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
  LOOP
    EXECUTE pg_catalog.format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon',v_fn.oid::regprocedure);
    -- Preserve pre-existing authenticated/server access; no new application permissions.
    EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',v_fn.oid::regprocedure);
  END LOOP;

  -- TRIGGER table privilege is needed to CREATE triggers, not to fire installed triggers.
  FOR v_table IN
    SELECT c.oid,c.relname
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p')
       AND (pg_catalog.has_table_privilege('anon',c.oid,'TRIGGER')
         OR pg_catalog.has_table_privilege('authenticated',c.oid,'TRIGGER'))
  LOOP
    EXECUTE pg_catalog.format('REVOKE TRIGGER ON TABLE public.%I FROM PUBLIC, anon, authenticated',v_table.relname);
    IF pg_catalog.has_table_privilege('anon',v_table.oid,'TRIGGER')
       OR pg_catalog.has_table_privilege('authenticated',v_table.oid,'TRIGGER') THEN
      RAISE EXCEPTION 'SECURITY_ACL_TABLE_TRIGGER_REVOKE_FAILED:%',v_table.relname;
    END IF;
  END LOOP;
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRIGGER ON TABLES FROM PUBLIC, anon, authenticated';

  IF EXISTS(
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'SECURITY_ACL_ANON_SECDEF_POSTCHECK_FAILED';
  END IF;
  SELECT count(*) FILTER (WHERE pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'))
    INTO v_auth_after
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prosecdef;
  IF v_auth_after<>v_auth_before THEN
    RAISE EXCEPTION 'SECURITY_ACL_AUTHENTICATED_FUNCTION_REGRESSION: % -> %',v_auth_before,v_auth_after;
  END IF;
  IF EXISTS(
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND (pg_catalog.has_table_privilege('anon',c.oid,'TRIGGER')
        OR pg_catalog.has_table_privilege('authenticated',c.oid,'TRIGGER'))
  ) THEN
    RAISE EXCEPTION 'SECURITY_ACL_TABLE_TRIGGER_POSTCHECK_FAILED';
  END IF;
  SELECT count(*) FILTER (WHERE pg_catalog.has_table_privilege('service_role',c.oid,'TRIGGER'))
    INTO v_service_after
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p');
  IF v_service_after<>v_service_before THEN
    RAISE EXCEPTION 'SECURITY_ACL_SERVICE_TRIGGER_REGRESSION';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal) <> v_trigger_count THEN
    RAISE EXCEPTION 'SECURITY_ACL_EXISTING_TRIGGERS_CHANGED';
  END IF;
END
$security_acl$;
COMMIT;
