-- IA-06 phase 2. Protect self-identity queries from arbitrary actor UUIDs.
-- SECURITY DEFINER/RLS helpers keep their signatures, result types, grants
-- and existing permission logic. Only a self-identity / service-role gate is added.
-- No policy, table, user, clinic, clinical record, Stripe or trigger changes.
BEGIN;
DO $ia06_guard_preflight$
DECLARE
  v_fn record;
  v_oid oid;
  v_total integer;
  v_matched integer;
  v_callers integer;
BEGIN
  SELECT count(*) INTO v_total
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND has_function_privilege('authenticated',p.oid,'EXECUTE');
  IF v_total <> 43 THEN
    RAISE EXCEPTION 'IA06_AUTH_FUNCTION_BASELINE_DRIFT:%',v_total;
  END IF;

  FOR v_fn IN SELECT * FROM (VALUES
    ('can_access_clinic','uuid, uuid','b0c6738b42c5cf90c86ed479299f43c6',50,0,'can_access_clinic\([^;]*?,[[:space:]]*auth\.uid\(\)\)'),
    ('can_manage_clinic','uuid, uuid','007e3319b7731c1b088ce63202383bb8',71,0,'can_manage_clinic\([^;]*?,[[:space:]]*auth\.uid\(\)\)'),
    ('is_platform_admin','uuid','a39f44e24825b13e1d4465a7ecc28797',12,5,'is_platform_admin\([[:space:]]*auth\.uid\(\)\)'),
    ('school_actor_effective_role','uuid, uuid','fe15e80060dec67455f90cbfde084a8d',6,4,'school_actor_effective_role\([[:space:]]*auth\.uid\(\)[[:space:]]*,')
  ) AS target(name,argtypes,definition_md5,expected_policy_count,expected_definer_callers,policy_actor_regex)
  LOOP
    v_oid := pg_catalog.to_regprocedure(format('public.%I(%s)',v_fn.name,v_fn.argtypes));
    IF v_oid IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid=v_oid AND p.prosecdef
        AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
        AND pg_catalog.pg_get_function_result(p.oid) IN ('boolean','text')
        AND pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))=v_fn.definition_md5
        AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
        AND has_function_privilege('authenticated',p.oid,'EXECUTE')
        AND has_function_privilege('service_role',p.oid,'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'IA06_AUTH_HELPER_DEFINITION_DRIFT:%',v_fn.name;
    END IF;

    SELECT count(*),count(*) FILTER (
      WHERE (coalesce(pol.qual,'')||' '||coalesce(pol.with_check,'')) ~ v_fn.policy_actor_regex
    )
    INTO v_total,v_matched
    FROM pg_catalog.pg_policies pol
    WHERE pol.schemaname='public' AND
      (coalesce(pol.qual,'') ILIKE '%'||v_fn.name||'%'
       OR coalesce(pol.with_check,'') ILIKE '%'||v_fn.name||'%');
    IF v_total<>v_fn.expected_policy_count OR v_matched<>v_total THEN
      RAISE EXCEPTION 'IA06_RLS_ACTOR_ARGUMENT_DRIFT:%:%:%',v_fn.name,v_total,v_matched;
    END IF;

    SELECT count(*) INTO v_callers FROM pg_catalog.pg_proc p
    WHERE p.oid<>v_oid AND p.prosecdef
      AND p.prosrc ILIKE '%'||v_fn.name||'%';
    IF v_callers<>v_fn.expected_definer_callers
       OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
                 WHERE p.oid<>v_oid AND NOT p.prosecdef
                   AND p.prosrc ILIKE '%'||v_fn.name||'%')
       OR EXISTS(SELECT 1 FROM pg_catalog.pg_views v
                 WHERE v.definition ILIKE '%'||v_fn.name||'%')
    THEN
      RAISE EXCEPTION 'IA06_UNEXPECTED_INVOKER_OR_VIEW:%',v_fn.name;
    END IF;
  END LOOP;
END
$ia06_guard_preflight$;

CREATE OR REPLACE FUNCTION public.can_access_clinic(
  target_clinic uuid,
  target_user uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT target_clinic IS NOT NULL
    AND (
        (auth.uid() IS NOT NULL AND target_user = auth.uid())
        OR current_setting('request.jwt.claim.role', true) = 'service_role'
      )
    AND EXISTS (
      SELECT 1
      FROM public.clinic_memberships cm
      WHERE cm.user_id=target_user
        AND cm.clinic_id=target_clinic
        AND cm.status='active'
    );
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_clinic(
  target_clinic uuid,
  target_user uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT target_clinic IS NOT NULL
    AND (
        (auth.uid() IS NOT NULL AND target_user = auth.uid())
        OR current_setting('request.jwt.claim.role', true) = 'service_role'
      )
    AND EXISTS (
      SELECT 1
      FROM public.clinic_memberships cm
      WHERE cm.user_id=target_user
        AND cm.clinic_id=target_clinic
        AND cm.status='active'
        AND cm.role='coordinator'
    );
$function$;

CREATE OR REPLACE FUNCTION public.is_platform_admin(
  target_user uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT target_user IS NOT NULL
    AND (
        (auth.uid() IS NOT NULL AND target_user = auth.uid())
        OR current_setting('request.jwt.claim.role', true) = 'service_role'
      )
    AND EXISTS (
      SELECT 1 FROM public.platform_admins pa
      WHERE pa.user_id=target_user AND pa.active=true
    );
$function$;

CREATE OR REPLACE FUNCTION public.school_actor_effective_role(
  p_actor_id uuid,
  p_clinic_id uuid
) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN (
        (auth.uid() IS NOT NULL AND p_actor_id = auth.uid())
        OR current_setting('request.jwt.claim.role', true) = 'service_role'
      )
  THEN coalesce(
    (select 'owner' from public.clinics c
     where c.id=p_clinic_id AND c.owner_user_id=p_actor_id limit 1),
    (select lower(cm.role) from public.clinic_memberships cm
     where cm.user_id=p_actor_id AND cm.clinic_id=p_clinic_id
       AND cm.status='active' limit 1),
    (select lower(u.role) from public.users u
     where u.id=p_actor_id AND u.clinic_id=p_clinic_id limit 1)
  )
  ELSE NULL::text END;
$function$;

DO $ia06_guard_postcheck$
DECLARE
  v_fn record;
  v_oid oid;
  v_count integer;
BEGIN
  FOR v_fn IN SELECT * FROM (VALUES
    ('can_access_clinic','uuid, uuid'),
    ('can_manage_clinic','uuid, uuid'),
    ('is_platform_admin','uuid'),
    ('school_actor_effective_role','uuid, uuid')
  ) AS target(name,argtypes) LOOP
    v_oid:=pg_catalog.to_regprocedure(format('public.%I(%s)',v_fn.name,v_fn.argtypes));
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_oid
        AND p.prosecdef
        AND p.prosrc LIKE '%request.jwt.claim.role%'
        AND p.prosrc LIKE '%auth.uid()%'
        AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
        AND has_function_privilege('authenticated',p.oid,'EXECUTE')
        AND has_function_privilege('service_role',p.oid,'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'IA06_SELF_ACTOR_GUARD_POSTCHECK_FAILED:%',v_fn.name;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_count
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef AND
    has_function_privilege('authenticated',p.oid,'EXECUTE');
  IF v_count<>43 THEN
    RAISE EXCEPTION 'IA06_AUTH_EXEC_COUNT_CHANGED:%',v_count;
  END IF;
END
$ia06_guard_postcheck$;
COMMIT;
