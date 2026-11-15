-- IA-06, batch 1: remove authenticated direct EXECUTE on four internal
-- SECURITY DEFINER helper RPCs and one already-installed trigger function.
-- Preserve service_role and owner privileges, RLS policies, installed triggers,
-- all clinical/business writes, Stripe, and runtime code. Staging only.
DO $ia06$
DECLARE
  v_target record;
  v_oid oid;
  v_total integer;
  v_direct integer;
  v_trigger integer;
BEGIN
  -- Fail closed on baseline drift.
  SELECT count(*),
         count(*) FILTER (WHERE p.prorettype <> 'pg_catalog.trigger'::regtype),
         count(*) FILTER (WHERE p.prorettype = 'pg_catalog.trigger'::regtype)
  INTO v_total, v_direct, v_trigger
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND has_function_privilege('authenticated',p.oid,'EXECUTE');
  IF v_total <> 48 OR v_direct <> 47 OR v_trigger <> 1 THEN
    RAISE EXCEPTION 'IA06_AUTH_SECDEF_BASELINE_DRIFT:total=% direct=% trigger=%',
      v_total,v_direct,v_trigger;
  END IF;

  -- Validate EVERY function before revoking ANY grant. Transactional DO.
  FOR v_target IN SELECT * FROM (VALUES
    ('patient_case_team_actor_can_manage_v1','uuid, uuid, uuid','4a2f6c7bcda6443b01fac0135f920d4c',false,3),
    ('school_actor_can_access_patient','uuid, uuid, uuid','b9887899e542dea01914eb50c4deb902',false,9),
    ('school_actor_has_role','uuid, uuid, uuid, text[]','a124e1935eac3d672a17732a04767752',false,18),
    ('school_consent_current_status','text, uuid, uuid, text, timestamp with time zone','279b75cd83b443563db3814b14978079',false,5),
    ('guard_clinic_timezone_v1','','49d135135635138d4062f343699756e1',true,0)
  ) AS t(name,argtypes,definition_md5,is_trigger,expected_definer_callers)
  LOOP
    v_oid := pg_catalog.to_regprocedure(format('public.%I(%s)',v_target.name,v_target.argtypes));
    IF v_oid IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid=v_oid AND p.prosecdef
        AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
        AND (p.prorettype='pg_catalog.trigger'::regtype)=v_target.is_trigger
        AND pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))=v_target.definition_md5
        AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
        AND has_function_privilege('authenticated',p.oid,'EXECUTE')
        AND has_function_privilege('service_role',p.oid,'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'IA06_FUNCTION_SIGNATURE_BODY_OR_ACL_DRIFT:%',v_target.name;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies pol
      WHERE coalesce(pol.qual,'') ILIKE '%'||v_target.name||'%'
         OR coalesce(pol.with_check,'') ILIKE '%'||v_target.name||'%'
    ) OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid<>v_oid AND NOT p.prosecdef
        AND p.prosrc ILIKE '%'||v_target.name||'%'
    ) OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_views v
      WHERE v.definition ILIKE '%'||v_target.name||'%'
    ) THEN
      RAISE EXCEPTION 'IA06_POLICY_INVOKER_OR_VIEW_DEPENDENCY:%',v_target.name;
    END IF;

    SELECT count(*) INTO v_total FROM pg_catalog.pg_proc p
    WHERE p.oid<>v_oid AND p.prosecdef
      AND p.prosrc ILIKE '%'||v_target.name||'%';
    IF v_total <> v_target.expected_definer_callers THEN
      RAISE EXCEPTION 'IA06_DEFINER_CALLER_DRIFT:%:%',
        v_target.name,v_total;
    END IF;

    IF v_target.is_trigger THEN
      SELECT count(*) INTO v_total FROM pg_catalog.pg_trigger t
      WHERE t.tgfoid=v_oid AND NOT t.tgisinternal;
      IF v_total <> 1 THEN
        RAISE EXCEPTION 'IA06_INSTALLED_TRIGGER_DRIFT:%:%',
          v_target.name,v_total;
      END IF;
    END IF;
  END LOOP;

  FOR v_target IN SELECT * FROM (VALUES
    ('patient_case_team_actor_can_manage_v1','uuid, uuid, uuid'),
    ('school_actor_can_access_patient','uuid, uuid, uuid'),
    ('school_actor_has_role','uuid, uuid, uuid, text[]'),
    ('school_consent_current_status','text, uuid, uuid, text, timestamp with time zone'),
    ('guard_clinic_timezone_v1','')
  ) AS t(name,argtypes)
  LOOP
    v_oid := pg_catalog.to_regprocedure(format('public.%I(%s)',v_target.name,v_target.argtypes));
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      v_target.name,v_target.argtypes);
    IF has_function_privilege('anon',v_oid,'EXECUTE')
      OR has_function_privilege('authenticated',v_oid,'EXECUTE')
      OR NOT has_function_privilege('service_role',v_oid,'EXECUTE')
    THEN
      RAISE EXCEPTION 'IA06_ACL_POSTCHECK_FAILED:%',v_target.name;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_total FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND has_function_privilege('authenticated',p.oid,'EXECUTE');
  IF v_total<>43 THEN
    RAISE EXCEPTION 'IA06_AUTH_SECDEF_POSTCHECK_DRIFT:%',v_total;
  END IF;
END
$ia06$;
NOTIFY pgrst,'reload schema';
