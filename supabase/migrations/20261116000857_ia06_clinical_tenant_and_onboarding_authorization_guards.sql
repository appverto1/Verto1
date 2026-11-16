-- IA-06 critical: tenant-clinical authorization and onboarding replay/ack authorization.
-- Staging only. No policy, DML grant, table, clinical record or UI changes.
BEGIN;
DO $ia06_preflight$
DECLARE v_name text; v_hash text; v_oid oid; v_count integer;
BEGIN
 FOR v_name,v_hash IN SELECT * FROM (VALUES
 ('therapeutic_plan_current_actor_can_access_v1','58f9a8168f228eb4da751e7e15c503f2'),
 ('ack_onboarding_response_v1','3c5fce12769f77b854a6efe02ee72b6c'),
 ('submit_onboarding_response_v1','0b37db13ff60cc3406069c40b3ec1434')
 ) AS t(name,hash) LOOP
 SELECT p.oid INTO STRICT v_oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname=v_name
 AND pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))=v_hash
 AND p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner)='postgres';
 END LOOP;
 SELECT count(*) INTO v_count FROM pg_catalog.pg_policies p WHERE p.schemaname='public' AND (coalesce(p.qual,'')||' '||coalesce(p.with_check,'')) ILIKE '%therapeutic_plan_current_actor_can_access_v1%';
 IF v_count<>8 THEN RAISE EXCEPTION 'IA06_CLINICAL_RLS_DEPENDENCY_DRIFT:%',v_count; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.ack_onboarding_response_current_v1(uuid)'::regprocedure AND has_function_privilege('authenticated',p.oid,'EXECUTE'))
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.submit_onboarding_response_current_v1(uuid,uuid,text[],text)'::regprocedure AND has_function_privilege('authenticated',p.oid,'EXECUTE'))
 THEN RAISE EXCEPTION 'IA06_ONBOARDING_RPC_BASELINE_DRIFT'; END IF;
END $ia06_preflight$;


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
                actor.clinic_id = patient.clinic_id
                or exists (
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
$function$
;

CREATE OR REPLACE FUNCTION public.ack_onboarding_response_v1(p_response_id uuid, p_actor_id uuid)
 RETURNS TABLE(response_id uuid, admin_ack_at timestamp with time zone, admin_ack_by uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
declare v_ack_at timestamptz; v_ack_by uuid;
begin
 if p_actor_id is null or not public.is_platform_admin(p_actor_id) then raise exception 'ONBOARDING_PLATFORM_ADMIN_REQUIRED' using errcode='42501'; end if;
 update public.onboarding_responses response set admin_ack_at=coalesce(response.admin_ack_at,now()),admin_ack_by=coalesce(response.admin_ack_by,p_actor_id) where response.id=p_response_id returning response.admin_ack_at,response.admin_ack_by into v_ack_at,v_ack_by;
 if not found then raise exception 'ONBOARDING_RESPONSE_NOT_FOUND' using errcode='P0002'; end if;
 return query select p_response_id,v_ack_at,v_ack_by;
end; $function$
;

CREATE OR REPLACE FUNCTION public.submit_onboarding_response_v1(p_publication_id uuid, p_slot_id uuid, p_participants text[], p_idempotency_key text, p_actor_id uuid)
 RETURNS TABLE(response_id uuid, publication_id uuid, slot_id uuid, clinic_id uuid, participants text[], responded_at timestamp with time zone, admin_ack_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
declare v_publication public.onboarding_publications%rowtype; v_slot public.onboarding_slots%rowtype; v_response public.onboarding_responses%rowtype; v_participants text[]; v_clinic_id uuid;
begin
 if p_actor_id is null or (p_actor_id <> auth.uid() and auth.role() <> 'service_role') then raise exception 'ONBOARDING_ACTOR_MISMATCH' using errcode='42501'; end if;
 if p_idempotency_key is null or char_length(p_idempotency_key) not between 12 and 160 then raise exception 'ONBOARDING_INVALID_IDEMPOTENCY_KEY' using errcode='22023'; end if;
 select array_agg(btrim(participant) order by ordinality) into v_participants from unnest(coalesce(p_participants,'{}'::text[])) with ordinality as input(participant,ordinality) where participant is not null and btrim(participant)<>'';
 if not public.onboarding_text_array_valid_v1(v_participants,1,20,120) then raise exception 'ONBOARDING_INVALID_PARTICIPANTS' using errcode='22023'; end if;
 select publication.clinic_id into v_clinic_id
 from public.onboarding_publications publication
 where publication.id = p_publication_id;
 if not found then raise exception 'ONBOARDING_PUBLICATION_NOT_FOUND' using errcode='P0002'; end if;
 if not public.onboarding_actor_can_respond_v1(p_actor_id,v_clinic_id)
 then raise exception 'ONBOARDING_FORBIDDEN' using errcode='42501'; end if;
 select * into v_response from public.onboarding_responses response where response.publication_id=p_publication_id and response.idempotency_key=p_idempotency_key and response.clinic_id=v_clinic_id and response.responded_by=p_actor_id order by response.created_at desc limit 1;
 if found then return query select v_response.id,v_response.publication_id,v_response.slot_id,v_response.clinic_id,v_response.participants,v_response.responded_at,v_response.admin_ack_at; return; end if;
 select * into v_publication from public.onboarding_publications publication where publication.id=p_publication_id for update;
 if not found then raise exception 'ONBOARDING_PUBLICATION_NOT_FOUND' using errcode='P0002'; end if;
 if not public.onboarding_actor_can_respond_v1(p_actor_id,v_publication.clinic_id) then raise exception 'ONBOARDING_FORBIDDEN' using errcode='42501'; end if;
 if v_publication.status='responded' then raise exception 'ONBOARDING_ALREADY_RESPONDED' using errcode='P0001'; end if;
 if v_publication.status not in ('published','viewed') then raise exception 'ONBOARDING_PUBLICATION_NOT_RESPONDABLE' using errcode='P0001'; end if;
 select * into v_slot from public.onboarding_slots slot where slot.id=p_slot_id and slot.publication_id=p_publication_id for update;
 if not found or v_slot.status<>'available' then raise exception 'SLOT_TAKEN' using errcode='P0001'; end if;
 insert into public.onboarding_responses(publication_id,clinic_id,slot_id,participants,idempotency_key,responded_by) values(v_publication.id,v_publication.clinic_id,v_slot.id,v_participants,p_idempotency_key,p_actor_id) returning * into v_response;
 update public.onboarding_slots set status='reserved',reserved_at=v_response.responded_at,updated_at=now() where id=v_slot.id;
 update public.onboarding_publications set status='responded',responded_at=v_response.responded_at where id=v_publication.id;
 return query select v_response.id,v_response.publication_id,v_response.slot_id,v_response.clinic_id,v_response.participants,v_response.responded_at,v_response.admin_ack_at;
exception when unique_violation then
 select * into v_response from public.onboarding_responses response where response.publication_id=p_publication_id and response.idempotency_key=p_idempotency_key and response.clinic_id=v_clinic_id and response.responded_by=p_actor_id limit 1;
 if found then return query select v_response.id,v_response.publication_id,v_response.slot_id,v_response.clinic_id,v_response.participants,v_response.responded_at,v_response.admin_ack_at; return; end if;
 raise exception 'SLOT_TAKEN' using errcode='P0001';
end; $function$
;

DO $ia06_postcheck$
DECLARE v_count integer;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.therapeutic_plan_current_actor_can_access_v1(uuid,text,text,text,text[],text)'::regprocedure AND p.prosrc LIKE '%scoped_admin.clinic_id = patient.clinic_id%' AND p.prosrc LIKE '%actor.clinic_id = patient.clinic_id%')
 THEN RAISE EXCEPTION 'IA06_CLINIC_SCOPE_POSTCHECK_FAILED'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.ack_onboarding_response_v1(uuid,uuid)'::regprocedure AND p.prosrc LIKE '%not public.is_platform_admin(p_actor_id)%')
 THEN RAISE EXCEPTION 'IA06_ACK_PLATFORM_ADMIN_POSTCHECK_FAILED'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid='public.submit_onboarding_response_v1(uuid,uuid,text[],text,uuid)'::regprocedure AND p.prosrc LIKE '%response.responded_by=p_actor_id%' AND p.prosrc LIKE '%onboarding_actor_can_respond_v1(p_actor_id,v_clinic_id)%')
 THEN RAISE EXCEPTION 'IA06_REPLAY_GUARD_POSTCHECK_FAILED'; END IF;
 SELECT count(*) INTO v_count FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('authenticated',p.oid,'EXECUTE');
 IF v_count<>43 THEN RAISE EXCEPTION 'IA06_AUTH_SECDEF_COUNT_DRIFT:%',v_count; END IF;
END $ia06_postcheck$;
COMMIT;