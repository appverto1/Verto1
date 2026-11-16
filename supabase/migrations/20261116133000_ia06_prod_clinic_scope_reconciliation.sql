-- IA-06: reconcile legacy production authorization without changing clinical data.
-- Staging already has stronger variants: explicitly recognize and leave them unchanged.
BEGIN;
DO $guard$
DECLARE
 v_prod boolean;
 v_item record;
BEGIN
 FOR v_item IN
  SELECT p.proname,md5(pg_get_functiondef(p.oid)) hash
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN
    ('can_access_clinic','can_manage_clinic','is_admin_or_owner','is_platform_admin')
 LOOP
   IF v_item.proname='can_access_clinic' AND v_item.hash NOT IN ('cb4b954fe25040a92361497f88cec7da','13b575cb9f6e233440cef25e2db259d5') THEN RAISE EXCEPTION 'IA06_CLINIC_ACCESS_DRIFT'; END IF;
   IF v_item.proname='can_manage_clinic' AND v_item.hash NOT IN ('4b5af21c22b17ed4ab466859d1a6e652','6344827bc531720030937be778a65fb5') THEN RAISE EXCEPTION 'IA06_CLINIC_MANAGE_DRIFT'; END IF;
   IF v_item.proname='is_platform_admin' AND v_item.hash NOT IN ('a39f44e24825b13e1d4465a7ecc28797','31bdf1c3153f820310e535e54aa80047') THEN RAISE EXCEPTION 'IA06_PLATFORM_ADMIN_DRIFT'; END IF;
   IF v_item.proname='is_admin_or_owner' AND v_item.hash NOT IN ('e71542aa78a949aa95a6698ccc4ef46a','cd8d6cfa46d12d78ffad73f26d25e6c0') THEN RAISE EXCEPTION 'IA06_ADMIN_OWNER_DRIFT'; END IF;
 END LOOP;
 SELECT md5(pg_get_functiondef('public.can_access_clinic(uuid,uuid)'::regprocedure))='cb4b954fe25040a92361497f88cec7da' INTO v_prod;
 IF v_prod THEN
   IF (SELECT count(*) FROM public.clinics c WHERE c.owner_user_id IS NOT NULL AND NOT EXISTS
       (SELECT 1 FROM public.clinic_memberships m WHERE m.user_id=c.owner_user_id AND m.clinic_id=c.id AND m.status='active'))>0 THEN
      RAISE EXCEPTION 'IA06_OWNER_MEMBERSHIP_PREFLIGHT_FAILED';
   END IF;
   -- No user-provided target_user may be used to probe someone else's membership.
   -- Service-role backend is exempt; authenticated clients must match auth.uid().
   EXECUTE $fn$
     CREATE OR REPLACE FUNCTION public.can_access_clinic(target_clinic uuid,target_user uuid DEFAULT auth.uid())
     RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
     AS $body$
       SELECT target_clinic IS NOT NULL
         AND ((auth.uid() IS NOT NULL AND target_user=auth.uid())
           OR current_setting('request.jwt.claim.role',true)='service_role')
         AND EXISTS(SELECT 1 FROM public.clinic_memberships cm
                    WHERE cm.user_id=target_user AND cm.clinic_id=target_clinic AND cm.status='active');
     $body$;
   $fn$;
   EXECUTE $fn$
     CREATE OR REPLACE FUNCTION public.can_manage_clinic(target_clinic uuid,target_user uuid DEFAULT auth.uid())
     RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
     AS $body$
       SELECT target_clinic IS NOT NULL
         AND ((auth.uid() IS NOT NULL AND target_user=auth.uid())
           OR current_setting('request.jwt.claim.role',true)='service_role')
         AND EXISTS(SELECT 1 FROM public.clinic_memberships cm
                    WHERE cm.user_id=target_user AND cm.clinic_id=target_clinic
                      AND cm.status='active' AND cm.role='coordinator');
     $body$;
   $fn$;
   EXECUTE $fn$
     CREATE OR REPLACE FUNCTION public.is_platform_admin(target_user uuid DEFAULT auth.uid())
     RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
     AS $body$
       SELECT target_user IS NOT NULL
         AND ((auth.uid() IS NOT NULL AND target_user=auth.uid())
           OR current_setting('request.jwt.claim.role',true)='service_role')
         AND EXISTS(SELECT 1 FROM public.platform_admins pa
                    WHERE pa.user_id=target_user AND pa.active=true);
     $body$;
   $fn$;
   -- Keep production's real global admin, but forbid impersonating a third-party
   -- global admin through direct RPC. RLS policy calls use auth.uid() unchanged.
   EXECUTE $fn$
     CREATE OR REPLACE FUNCTION public.is_admin_or_owner(target_user uuid DEFAULT auth.uid())
     RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
     AS $body$
       SELECT target_user IS NOT NULL
         AND ((auth.uid() IS NOT NULL AND target_user=auth.uid())
           OR current_setting('request.jwt.claim.role',true)='service_role')
         AND EXISTS(SELECT 1 FROM public.users u
                    WHERE u.id=target_user AND u.role IN ('owner','admin'));
     $body$;
   $fn$;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname IN
             ('can_access_clinic','can_manage_clinic','is_admin_or_owner','is_platform_admin')
             AND has_function_privilege('anon',p.oid,'EXECUTE')) THEN
   RAISE EXCEPTION 'IA06_ANON_EXECUTE_REGRESSION';
 END IF;
END $guard$;
COMMIT;
