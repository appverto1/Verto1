-- IA-05 follow-up: eliminate the three remaining anon SECDEF RPC grants.
-- Fifteen RLS policies with PUBLIC roles can authorize no truly anonymous user:
-- each condition uses auth.uid() as its actor argument, which is NULL for anon.
-- Alter ONLY the policy role TO authenticated; preserve USING/WITH CHECK exactly.
-- Do not touch authenticated/service_role function grants, clinical data or runtime.
DO $ia05_auth$
DECLARE
  v_pol record;
  v_fn record;
  v_oid oid;
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND p.prorettype <> 'pg_catalog.trigger'::regtype
    AND has_function_privilege('anon',p.oid,'EXECUTE');
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'IA05_REMAINING_ANON_RPC_BASELINE_DRIFT:%',v_count;
  END IF;

  SELECT count(*) INTO v_count FROM pg_catalog.pg_policies pol
  WHERE pol.schemaname='public' AND 'public'=ANY(pol.roles)
    AND (coalesce(pol.qual,'') ILIKE '%can_access_clinic%'
      OR coalesce(pol.with_check,'') ILIKE '%can_access_clinic%'
      OR coalesce(pol.qual,'') ILIKE '%can_manage_clinic%'
      OR coalesce(pol.with_check,'') ILIKE '%can_manage_clinic%'
      OR coalesce(pol.qual,'') ILIKE '%is_platform_admin%'
      OR coalesce(pol.with_check,'') ILIKE '%is_platform_admin%');
  IF v_count <> 15 THEN
    RAISE EXCEPTION 'IA05_PUBLIC_POLICY_BASELINE_DRIFT:%',v_count;
  END IF;

  -- Exact policy identity, command, roles and expression fingerprint.
  -- Fail closed if any policy has changed since the independent read-only audit.
  FOR v_pol IN SELECT * FROM (VALUES
    ('aba_session_summaries','aba_session_summaries_patient_scope_rw','ALL','93582460a01507cfd5a6dd34272fa46e'),
    ('clinic_protocol_grants','clinic_protocol_grants_platform_admin_all','ALL','105dd33abf541e30d503a5a810c5eea7'),
    ('operational_closure_exports','operational_closure_exports_admin_rw','ALL','c0b4f388e1db7f22b9bfa043d4ca928d'),
    ('patient_access_grants','patient_access_grants_clinic_rw','ALL','c0b4f388e1db7f22b9bfa043d4ca928d'),
    ('patient_anamnesis_requests','patient_anamnesis_requests_clinic_rw','ALL','58a7b687a9c52140d521fed4d5d17036'),
    ('patient_anamnesis_responses','patient_anamnesis_responses_clinic_rw','ALL','58a7b687a9c52140d521fed4d5d17036'),
    ('patient_history_imports','patient_history_imports_clinic_rw','ALL','c0b4f388e1db7f22b9bfa043d4ca928d'),
    ('patient_longitudinal_timeline_items','patient_longitudinal_timeline_items_clinic_rw','ALL','58a7b687a9c52140d521fed4d5d17036'),
    ('patient_portability_requests','patient_portability_requests_clinic_admin_rw','ALL','9aa915e921e1f27c92792d416aef805f'),
    ('patient_portability_snapshots','patient_portability_snapshots_clinic_rw','ALL','fe29e0e5ab61c42e7cb19c25239e641c'),
    ('patient_relationship_confirmations','patient_relationship_confirmations_clinic_rw','ALL','9aa915e921e1f27c92792d416aef805f'),
    ('patient_shared_history_snapshots','patient_shared_history_snapshots_clinic_read','SELECT','01f0c03269c9dba3865621ce1975ac24'),
    ('protocol_import_requests','protocol_import_requests_owner_all','ALL','105dd33abf541e30d503a5a810c5eea7'),
    ('record_read_audit','record_read_audit_select_internal','SELECT','a82e6d1036391f6290f1435b87b29e45'),
    ('verto_canonical_protocols','verto_canonical_protocols_owner_all','ALL','105dd33abf541e30d503a5a810c5eea7')
  ) AS p(tablename,policyname,cmd,digest) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies pol
      JOIN pg_catalog.pg_class c
        ON c.oid=format('%I.%I',pol.schemaname,pol.tablename)::regclass
      WHERE pol.schemaname='public'
        AND pol.tablename=v_pol.tablename AND pol.policyname=v_pol.policyname
        AND pol.cmd=v_pol.cmd AND pol.roles='{public}'::name[]
        AND md5(coalesce(pol.qual,'')||'|'||coalesce(pol.with_check,''))=v_pol.digest
        AND coalesce(pol.qual,'') ILIKE '%auth.uid()%'
        AND (pol.with_check IS NULL OR pol.with_check ILIKE '%auth.uid()%')
        AND pg_catalog.pg_get_userbyid(c.relowner)='postgres'
        AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'IA05_POLICY_EXPRESSION_OR_OWNER_DRIFT:%:%',v_pol.tablename,v_pol.policyname;
    END IF;
  END LOOP;

  FOR v_fn IN SELECT * FROM (VALUES
    ('can_access_clinic','uuid, uuid'),
    ('can_manage_clinic','uuid, uuid'),
    ('is_platform_admin','uuid')
  ) AS f(name,argtypes) LOOP
    v_oid:=to_regprocedure(format('public.%I(%s)',v_fn.name,v_fn.argtypes));
    IF v_oid IS NULL OR NOT EXISTS(
      SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_oid
        AND p.prosecdef AND p.prorettype <> 'pg_catalog.trigger'::regtype
        AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
        AND has_function_privilege('anon',p.oid,'EXECUTE')
        AND has_function_privilege('authenticated',p.oid,'EXECUTE')
        AND has_function_privilege('service_role',p.oid,'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'IA05_AUTH_HELPER_BASELINE_DRIFT:%',v_fn.name;
    END IF;
  END LOOP;

  -- Explicitly preserve all RLS USING/WITH CHECK expressions and policy command.
  FOR v_pol IN SELECT * FROM (VALUES
    ('aba_session_summaries','aba_session_summaries_patient_scope_rw','ALL','93582460a01507cfd5a6dd34272fa46e'),
    ('clinic_protocol_grants','clinic_protocol_grants_platform_admin_all','ALL','105dd33abf541e30d503a5a810c5eea7'),
    ('operational_closure_exports','operational_closure_exports_admin_rw','ALL','c0b4f388e1db7f22b9bfa043d4ca928d'),
    ('patient_access_grants','patient_access_grants_clinic_rw','ALL','c0b4f388e1db7f22b9bfa043d4ca928d'),
    ('patient_anamnesis_requests','patient_anamnesis_requests_clinic_rw','ALL','58a7b687a9c52140d521fed4d5d17036'),
    ('patient_anamnesis_responses','patient_anamnesis_responses_clinic_rw','ALL','58a7b687a9c52140d521fed4d5d17036'),
    ('patient_history_imports','patient_history_imports_clinic_rw','ALL','c0b4f388e1db7f22b9bfa043d4ca928d'),
    ('patient_longitudinal_timeline_items','patient_longitudinal_timeline_items_clinic_rw','ALL','58a7b687a9c52140d521fed4d5d17036'),
    ('patient_portability_requests','patient_portability_requests_clinic_admin_rw','ALL','9aa915e921e1f27c92792d416aef805f'),
    ('patient_portability_snapshots','patient_portability_snapshots_clinic_rw','ALL','fe29e0e5ab61c42e7cb19c25239e641c'),
    ('patient_relationship_confirmations','patient_relationship_confirmations_clinic_rw','ALL','9aa915e921e1f27c92792d416aef805f'),
    ('patient_shared_history_snapshots','patient_shared_history_snapshots_clinic_read','SELECT','01f0c03269c9dba3865621ce1975ac24'),
    ('protocol_import_requests','protocol_import_requests_owner_all','ALL','105dd33abf541e30d503a5a810c5eea7'),
    ('record_read_audit','record_read_audit_select_internal','SELECT','a82e6d1036391f6290f1435b87b29e45'),
    ('verto_canonical_protocols','verto_canonical_protocols_owner_all','ALL','105dd33abf541e30d503a5a810c5eea7')
  ) AS p(tablename,policyname,cmd,digest) LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated',v_pol.policyname,v_pol.tablename);
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies pol
      WHERE pol.schemaname='public' AND pol.tablename=v_pol.tablename
        AND pol.policyname=v_pol.policyname AND pol.cmd=v_pol.cmd
        AND pol.roles='{authenticated}'::name[]
        AND md5(coalesce(pol.qual,'')||'|'||coalesce(pol.with_check,''))=v_pol.digest
    ) THEN
      RAISE EXCEPTION 'IA05_POLICY_POSTCHECK_FAILED:%:%',v_pol.tablename,v_pol.policyname;
    END IF;
  END LOOP;

  FOR v_fn IN SELECT * FROM (VALUES
    ('can_access_clinic','uuid, uuid'),
    ('can_manage_clinic','uuid, uuid'),
    ('is_platform_admin','uuid')
  ) AS f(name,argtypes) LOOP
    v_oid:=to_regprocedure(format('public.%I(%s)',v_fn.name,v_fn.argtypes));
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon',v_fn.name,v_fn.argtypes);
    IF has_function_privilege('anon',v_oid,'EXECUTE')
      OR NOT has_function_privilege('authenticated',v_oid,'EXECUTE')
      OR NOT has_function_privilege('service_role',v_oid,'EXECUTE')
    THEN
      RAISE EXCEPTION 'IA05_FINAL_RPC_ACL_FAILED:%',v_fn.name;
    END IF;
  END LOOP;
END
$ia05_auth$;
