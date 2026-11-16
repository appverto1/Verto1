-- IA-06: revoked/stale public.users.clinic_id cannot confer clinical RLS access.
-- Keep registered clinic owner_user_id and active clinic-membership authority.
BEGIN;
DO $ia06_pre$
DECLARE matched integer;
BEGIN
 SELECT count(*) INTO matched FROM (VALUES
  ('aba_can_read_recommendation_scope_v3','0ca4e92ba2a49c45196d3644423618f7'),
  ('therapeutic_plan_current_actor_can_access_v1','a3e56660f803a42a3623c154d1f91312')
 ) expected(name,hash)
 JOIN pg_catalog.pg_proc p ON p.proname=expected.name
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef AND p.prorettype='pg_catalog.bool'::regtype
   AND pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))=expected.hash;
 IF matched<>2 THEN RAISE EXCEPTION 'IA06_LEGACY_SCOPE_FUNCTION_DRIFT:%',matched; END IF;
 SELECT count(*) INTO matched FROM pg_catalog.pg_policy pol WHERE
  pg_catalog.pg_get_expr(pol.polqual,pol.polrelid) LIKE '%aba_can_read_recommendation_scope_v3%';
 IF matched<>3 THEN RAISE EXCEPTION 'IA06_ABA_POLICY_SCOPE_DRIFT:%',matched; END IF;
END $ia06_pre$;

CREATE OR REPLACE FUNCTION public.aba_can_read_recommendation_scope_v3(p_clinic_id text, p_organization_id text, p_patient_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_organization_id = p_clinic_id
    and exists (
      select 1
      from public.patients patient
      join public.users actor on actor.id = auth.uid()
      left join public.clinics clinic on clinic.id::text = p_clinic_id
      where patient.id = p_patient_id
        and patient.clinic_id::text = p_clinic_id
        and (
          (
            actor.role in ('owner', 'admin')
            and (
              clinic.owner_user_id = actor.id
              or exists (
                select 1
                from public.clinic_memberships membership
                where membership.user_id = actor.id
                  and membership.clinic_id::text = p_clinic_id
                  and membership.status = 'active'
                  and membership.role in ('owner', 'admin', 'director')
              )
            )
          )
          or (
            actor.role = 'coordinator'
            and (
              exists (
                select 1
                from public.clinic_memberships membership
                where membership.user_id = actor.id
                  and membership.clinic_id::text = p_clinic_id
                  and membership.status = 'active'
                  and membership.role = 'coordinator'
              )
            )
          )
          or (
            actor.role = 'therapist'
            and patient.therapist_id = actor.id
            and (
              exists (
                select 1
                from public.clinic_memberships membership
                where membership.user_id = actor.id
                  and membership.clinic_id::text = p_clinic_id
                  and membership.status = 'active'
                  and membership.role in ('therapist', 'coordinator')
              )
            )
          )
        )
    );
$function$;

CREATE OR REPLACE FUNCTION public.therapeutic_plan_current_actor_can_access_v1(p_patient_id uuid, p_organization_id text, p_clinic_id text, p_responsible_professional_id text, p_participant_professional_ids text[], p_required_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
  select
    p_required_permission in ('read', 'write')
    and exists (
      select 1
      from public.patients patient
      where patient.id = p_patient_id
        and patient.clinic_id::text = p_organization_id
        and patient.clinic_id::text = p_clinic_id
        and (
          exists (
            select 1
            from public.users actor
            where actor.id = auth.uid()
              and lower(actor.role) in ('admin', 'owner')
              and (
                exists (
                  select 1 from public.clinics scope_clinic
                  where scope_clinic.id = patient.clinic_id
                    and scope_clinic.owner_user_id = actor.id
                )
                or exists (
                  select 1 from public.clinic_memberships scoped_admin
                  where scoped_admin.user_id = actor.id
                    and scoped_admin.clinic_id = patient.clinic_id
                    and scoped_admin.status = 'active'
                    and lower(scoped_admin.role) in ('owner', 'admin', 'director')
                )
              )
          )
          or exists (
            select 1
            from public.clinic_memberships manager_membership
            where manager_membership.clinic_id = patient.clinic_id
              and manager_membership.user_id = auth.uid()
              and manager_membership.status = 'active'
              and manager_membership.role = 'coordinator'
          )
          or (
            auth.uid()::text = any(
              array[p_responsible_professional_id]
              || coalesce(p_participant_professional_ids, '{}'::text[])
            )
            and exists (
              select 1
              from public.clinic_memberships actor_membership
              join public.patient_professional_links link
                on link.patient_id = patient.id
               and link.professional_id = actor_membership.user_id::text
               and link.organization_id = patient.clinic_id::text
               and link.clinic_id = patient.clinic_id::text
               and link.status = 'active'
              where actor_membership.clinic_id = patient.clinic_id
                and actor_membership.user_id = auth.uid()
                and actor_membership.role = 'therapist'
                and actor_membership.status = 'active'
                and case p_required_permission
                  when 'read' then coalesce(link.permissions->'read', 'true'::jsonb) = 'true'::jsonb
                  when 'write' then coalesce(link.permissions->'write', 'true'::jsonb) = 'true'::jsonb
                  else false
                end
            )
          )
        )
    );
$function$;

DO $ia06_post$
DECLARE matched integer;
BEGIN
 SELECT count(*) INTO matched FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('aba_can_read_recommendation_scope_v3','therapeutic_plan_current_actor_can_access_v1')
   AND p.prosecdef AND p.prorettype='pg_catalog.bool'::regtype
   AND pg_catalog.pg_get_functiondef(p.oid) NOT ILIKE '%actor.clinic_id%';
 IF matched<>2 THEN RAISE EXCEPTION 'IA06_LEGACY_SCOPE_POSTCHECK:%',matched; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'EXECUTE'))
 THEN RAISE EXCEPTION 'IA06_ANON_SECDEF_ACL_REGRESSION'; END IF;
END $ia06_post$;
COMMIT;
