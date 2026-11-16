-- IA-06, phase 4: close stale-membership and cross-clinic file policy access.
-- No clinical data changes; guards only.
BEGIN;
DO $ia06_preflight$
DECLARE v_fn record; v_policy record; v_oid oid;
BEGIN
 FOR v_fn IN SELECT * FROM (VALUES
 ('school_rls_meeting_access','1837040b7f21a165cfb6d8ca08ce8136'),
 ('school_rls_org_access','586940ad9a82c0306d74787b2e7f1f38'),
 ('school_rls_patient_access','090aecc2c7a41a36e1209fc27a56dc51'),
 ('patient_file_actor_has_patient_access_v1','38ce05a06f3066a1c389554f9794a2cf'),
 ('patient_file_current_actor_can_read_v1','712dbe7502435e85ada87f6c37df365a')
 ) t(name,md5) LOOP
   SELECT p.oid INTO STRICT v_oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname=v_fn.name AND p.prosecdef
   AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
   AND md5(pg_catalog.pg_get_functiondef(p.oid))=v_fn.md5
   AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
   AND has_function_privilege('authenticated',p.oid,'EXECUTE')
   AND has_function_privilege('service_role',p.oid,'EXECUTE');
 END LOOP;
 FOR v_policy IN SELECT * FROM (VALUES
 ('patient_files_delete','710fd32a166142ddb155669c33fb7c53'),
 ('patient_files_insert','d55d42c4e1ff91912a17b47c045549d8'),
 ('patient_files_update','1613df29c7914ea2124e86e55c1d3261')
 ) t(name,md5) LOOP
   IF NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_policies pol
     WHERE pol.schemaname='public' AND pol.tablename='patient_files'
     AND pol.policyname=v_policy.name AND pol.roles=ARRAY['authenticated']::name[]
     AND pol.permissive='PERMISSIVE'
     AND md5(coalesce(pol.qual,'')||'::'||coalesce(pol.with_check,''))=v_policy.md5
   ) THEN RAISE EXCEPTION 'IA06_FILE_POLICY_DRIFT:%',v_policy.name; END IF;
 END LOOP;
END $ia06_preflight$;


CREATE OR REPLACE FUNCTION public.school_rls_meeting_access(p_meeting_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.school_meetings m
    join public.clinics c on c.id::text = m.clinic_id
    where m.id = p_meeting_id
      and (
        public.school_actor_effective_role(auth.uid(), c.id) in ('owner','admin','coordinator','receptionist')
        or exists (
          select 1 from public.school_meeting_participants mp
          where mp.meeting_id = m.id
            and mp.removed_at is null
            and mp.professional_id = auth.uid()::text
            and exists (
              select 1 from public.clinic_memberships participant_membership
              where participant_membership.clinic_id = c.id
                and participant_membership.user_id = auth.uid()
                and participant_membership.status = 'active'
            )
        )
        or exists (
          select 1 from public.school_meeting_patients smp
          where smp.meeting_id = m.id
            and smp.participation_status <> 'REMOVED'
            and public.school_rls_patient_access(smp.patient_id)
        )
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.school_rls_org_access(p_organization_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.clinics c
    left join public.clinic_memberships cm
      on cm.clinic_id = c.id and cm.user_id = auth.uid() and cm.status = 'active'
    where c.school_organization_id::text = p_organization_id
      and (
        c.owner_user_id = auth.uid()
        or lower(cm.role) in ('owner','admin','coordinator','receptionist','therapist')
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.school_rls_patient_access(p_patient_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.patients p
    join public.clinics c on c.id = p.clinic_id
    left join public.clinic_memberships cm
      on cm.clinic_id = p.clinic_id and cm.user_id = auth.uid() and cm.status = 'active'
    where p.id = p_patient_id
      and (
        c.owner_user_id = auth.uid()
        or lower(cm.role) in ('admin','coordinator','receptionist')
        or (lower(cm.role) = 'therapist' and p.therapist_id = auth.uid())
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.patient_file_actor_has_patient_access_v1(p_actor_id uuid, p_clinic_id uuid, p_patient_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
  select
    (
      current_setting('request.jwt.claim.role', true) = 'service_role'
      or (
        current_setting('request.jwt.claim.role', true) = 'authenticated'
        and (select auth.uid()) is not null
        and p_actor_id = (select auth.uid())
      )
    )
    and exists (
      select 1
      from public.patients p
      where p.id = p_patient_id
        and p.clinic_id = p_clinic_id
        and (
          exists (
            select 1 from public.clinics c
            where c.id = p_clinic_id and c.owner_user_id = p_actor_id
          )
          or exists (
            select 1 from public.clinic_memberships cm
            where cm.user_id = p_actor_id and cm.clinic_id = p_clinic_id
              and cm.status = 'active'
              and lower(coalesce(cm.role, '')) in ('owner', 'admin', 'director', 'coordinator', 'receptionist')
          )
          or (
            p.therapist_id = p_actor_id
            and exists (
              select 1 from public.clinic_memberships direct_therapist
              where direct_therapist.user_id = p_actor_id
                and direct_therapist.clinic_id = p_clinic_id
                and direct_therapist.status = 'active'
            )
          )
          or exists (
            select 1 from public.patient_professional_links link
            where link.patient_id = p_patient_id
              and link.professional_id = p_actor_id::text
              and link.status = 'active'
              and link.organization_id = p_clinic_id::text
              and link.clinic_id = p_clinic_id::text
              and lower(coalesce(link.permissions->>'read', 'true')) <> 'false'
              and exists (
                select 1 from public.clinic_memberships case_membership
                where case_membership.user_id = p_actor_id
                  and case_membership.clinic_id = p_clinic_id
                  and case_membership.status = 'active'
              )
          )
        )
    );
$function$
;

CREATE OR REPLACE FUNCTION public.patient_file_current_actor_can_read_v1(p_file_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
  select exists (
    select 1
    from public.patient_files f
    where f.id = p_file_id
      and (
        (
          f.uploaded_by = auth.uid()
          and (
            public.patient_file_actor_has_patient_access_v1(auth.uid(), f.clinic_id, f.patient_id)
            or exists (
              select 1 from public.patients responsible_patient
              where responsible_patient.id = f.patient_id
                and responsible_patient.clinic_id = f.clinic_id
                and responsible_patient.responsible_user_id = auth.uid()
            )
          )
        )
        or (
          f.patient_portal_visible = true
          and exists (
            select 1
            from public.patients p
            where p.id = f.patient_id
              and p.responsible_user_id = auth.uid()
          )
        )
        or (
          f.access_scope = 'PATIENT_ACCESS'
          and public.patient_file_actor_has_patient_access_v1(auth.uid(), f.clinic_id, f.patient_id)
        )
        or (
          f.access_scope = 'CASE_TEAM'
          and exists (
            select 1
            from public.patient_professional_links link
            where link.patient_id = f.patient_id
              and link.professional_id = auth.uid()::text
              and link.status = 'active'
              and link.organization_id = f.clinic_id::text
              and link.clinic_id = f.clinic_id::text
              and lower(coalesce(link.permissions->>'read', 'true')) <> 'false'
              and exists (
                select 1 from public.patients scoped_patient
                where scoped_patient.id = f.patient_id
                  and scoped_patient.clinic_id = f.clinic_id
              )
              and exists (
                select 1 from public.clinic_memberships active_case_member
                where active_case_member.user_id = auth.uid()
                  and active_case_member.clinic_id = f.clinic_id
                  and active_case_member.status = 'active'
              )
          )
        )
        or (
          f.access_scope = 'SELECTED'
          and exists (
            select 1
            from public.patient_file_access_grants grant_row
            where grant_row.file_id = f.id
              and grant_row.grantee_user_id = auth.uid()
              and grant_row.clinic_id = f.clinic_id
              and grant_row.patient_id = f.patient_id
          )
        )
      )
  );
$function$
;


ALTER POLICY patient_files_insert ON public.patient_files WITH CHECK ((EXISTS (
 SELECT 1 FROM public.patients scope_patient
 WHERE scope_patient.id = patient_files.patient_id
 AND scope_patient.clinic_id = patient_files.clinic_id
)) AND (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (((u.role = ANY (ARRAY['owner'::text, 'admin'::text])) AND (
    u.clinic_id = patient_files.clinic_id
    OR EXISTS (
      SELECT 1 FROM public.clinics file_owner_clinic
      WHERE file_owner_clinic.id = patient_files.clinic_id
        AND file_owner_clinic.owner_user_id = u.id
    )
  )) OR ((u.role = ANY (ARRAY['coordinator'::text, 'receptionist'::text, 'therapist'::text])) AND (u.clinic_id = patient_files.clinic_id)))))) OR (EXISTS ( SELECT 1
   FROM clinic_memberships cm
  WHERE ((cm.user_id = auth.uid()) AND (cm.clinic_id = patient_files.clinic_id) AND (cm.status = 'active'::text) AND (cm.role = ANY (ARRAY['coordinator'::text, 'receptionist'::text, 'therapist'::text]))))))));
ALTER POLICY patient_files_update ON public.patient_files USING ((patient_file_current_actor_can_read_v1(id) AND ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (((u.role = ANY (ARRAY['owner'::text, 'admin'::text])) AND (
    u.clinic_id = patient_files.clinic_id
    OR EXISTS (
      SELECT 1 FROM public.clinics file_owner_clinic
      WHERE file_owner_clinic.id = patient_files.clinic_id
        AND file_owner_clinic.owner_user_id = u.id
    )
  )) OR ((u.role = ANY (ARRAY['coordinator'::text, 'receptionist'::text, 'therapist'::text])) AND (u.clinic_id = patient_files.clinic_id)))))) OR (EXISTS ( SELECT 1
   FROM clinic_memberships cm
  WHERE ((cm.user_id = auth.uid()) AND (cm.clinic_id = patient_files.clinic_id) AND (cm.status = 'active'::text) AND (cm.role = ANY (ARRAY['coordinator'::text, 'receptionist'::text, 'therapist'::text])))))))) WITH CHECK ((EXISTS (
 SELECT 1 FROM public.patients scope_patient
 WHERE scope_patient.id = patient_files.patient_id
 AND scope_patient.clinic_id = patient_files.clinic_id
)) AND ((patient_file_current_actor_can_read_v1(id) AND ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (((u.role = ANY (ARRAY['owner'::text, 'admin'::text])) AND (
    u.clinic_id = patient_files.clinic_id
    OR EXISTS (
      SELECT 1 FROM public.clinics file_owner_clinic
      WHERE file_owner_clinic.id = patient_files.clinic_id
        AND file_owner_clinic.owner_user_id = u.id
    )
  )) OR ((u.role = ANY (ARRAY['coordinator'::text, 'receptionist'::text, 'therapist'::text])) AND (u.clinic_id = patient_files.clinic_id)))))) OR (EXISTS ( SELECT 1
   FROM clinic_memberships cm
  WHERE ((cm.user_id = auth.uid()) AND (cm.clinic_id = patient_files.clinic_id) AND (cm.status = 'active'::text) AND (cm.role = ANY (ARRAY['coordinator'::text, 'receptionist'::text, 'therapist'::text])))))))));
ALTER POLICY patient_files_delete ON public.patient_files USING ((patient_file_current_actor_can_read_v1(id) AND ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (((u.role = ANY (ARRAY['owner'::text, 'admin'::text])) AND (
    u.clinic_id = patient_files.clinic_id
    OR EXISTS (
      SELECT 1 FROM public.clinics file_owner_clinic
      WHERE file_owner_clinic.id = patient_files.clinic_id
        AND file_owner_clinic.owner_user_id = u.id
    )
  )) OR ((u.role = ANY (ARRAY['coordinator'::text, 'receptionist'::text, 'therapist'::text])) AND (u.clinic_id = patient_files.clinic_id)))))) OR (EXISTS ( SELECT 1
   FROM clinic_memberships cm
  WHERE ((cm.user_id = auth.uid()) AND (cm.clinic_id = patient_files.clinic_id) AND (cm.status = 'active'::text) AND (cm.role = ANY (ARRAY['coordinator'::text, 'receptionist'::text, 'therapist'::text]))))))));


DO $ia06_postcheck$
DECLARE v_count integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.school_rls_meeting_access(uuid)'::regprocedure AND p.prosrc LIKE '%participant_membership.status = ''active''%')
 THEN RAISE EXCEPTION 'IA06_SCHOOL_MEMBERSHIP_POSTCHECK'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.patient_file_actor_has_patient_access_v1(uuid,uuid,uuid)'::regprocedure AND p.prosrc LIKE '%case_membership.status = ''active''%')
 THEN RAISE EXCEPTION 'IA06_FILE_MEMBERSHIP_POSTCHECK'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.patient_file_current_actor_can_read_v1(uuid)'::regprocedure AND p.prosrc LIKE '%active_case_member.status = ''active''%')
 THEN RAISE EXCEPTION 'IA06_FILE_READ_POSTCHECK'; END IF;
 SELECT count(*) INTO v_count FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('authenticated',p.oid,'EXECUTE');
 IF v_count<>43 THEN RAISE EXCEPTION 'IA06_SECDEF_COUNT_CHANGED:%',v_count; END IF;
END $ia06_postcheck$;
COMMIT;