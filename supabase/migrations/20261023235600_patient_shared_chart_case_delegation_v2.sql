-- P0 case-level authority for existing PLAN_PTS / ABA_V3 shared charts.
-- Uses the already provisioned per-case delegation table; does not require
-- or fabricate a global patient identity for existing clinic records.

create or replace function public.patient_shared_chart_case_authority_v1(
  p_actor_id uuid, p_clinic_id uuid, p_patient_id uuid
) returns jsonb language plpgsql stable security invoker
set search_path = pg_catalog, public
as $$
declare v_leader boolean := false; v_delegate boolean := false; v_live boolean := false;
begin
  if p_actor_id is null or p_clinic_id is null or p_patient_id is null then
    return jsonb_build_object('canPublish',false,'canDelegate',false);
  end if;
  select exists(
    select 1 from public.patients p
    where p.id=p_patient_id and p.clinic_id=p_clinic_id
      and p.is_active is true and p.deleted_at is null and p.archived_at is null
      and lower(coalesce(p.relationship_status,'active')) not in ('ended','inactive','terminated','revoked')
  ) into v_live;
  if not v_live then return jsonb_build_object('canPublish',false,'canDelegate',false); end if;

  select (
    exists(select 1 from public.clinics c where c.id=p_clinic_id and c.owner_user_id=p_actor_id)
    or exists (
      select 1 from public.clinic_memberships m
      where m.clinic_id=p_clinic_id and m.user_id=p_actor_id and m.status='active'
        and lower(m.role) in ('owner','admin','director','coordinator')
    )
    or exists (
      select 1 from public.clinic_memberships m
      join public.patient_professional_links l
        on l.patient_id=p_patient_id and l.organization_id=p_clinic_id::text
        and l.professional_id=m.user_id::text and l.status='active'
        and lower(coalesce(l.permissions->>'read','true'))<>'false'
      where m.clinic_id=p_clinic_id and m.user_id=p_actor_id and m.status='active'
        and lower(m.role)='supervisor'
    )
  ) into v_leader;

  if not v_leader then
    select exists(
      select 1 from public.patient_shared_graph_delegations g
      join public.clinic_memberships m
        on m.clinic_id=g.clinic_id and m.user_id=g.professional_user_id
        and m.status='active' and lower(m.role) in ('therapist','supervisor')
      join public.patient_professional_links l
        on l.patient_id=g.patient_id and l.organization_id=g.clinic_id::text
        and l.professional_id=g.professional_user_id::text and l.status='active'
        and lower(coalesce(l.permissions->>'read','true'))<>'false'
      where g.clinic_id=p_clinic_id and g.patient_id=p_patient_id
        and g.professional_user_id=p_actor_id and g.revoked_at is null
    ) into v_delegate;
  end if;
  return jsonb_build_object('canPublish',v_leader or v_delegate,'canDelegate',v_leader);
end
$$;
revoke execute on function public.patient_shared_chart_case_authority_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.patient_shared_chart_case_authority_v1(uuid,uuid,uuid) to service_role;

-- Atomic per-case grant/revocation; no global-ID prerequisite.
create or replace function public.set_patient_shared_chart_case_delegation_v2(
  p_actor_id uuid,p_clinic_id uuid,p_patient_id uuid,p_professional_id uuid,p_allow boolean
) returns boolean language plpgsql security invoker
set search_path = pg_catalog, public
as $$
begin
  if p_actor_id is null or p_clinic_id is null or p_patient_id is null
     or p_professional_id is null or p_actor_id=p_professional_id or p_allow is null then
    raise exception 'SHARED_CHART_DELEGATION_INVALID' using errcode='22023';
  end if;
  if (public.patient_shared_chart_case_authority_v1(p_actor_id,p_clinic_id,p_patient_id)->>'canDelegate') <> 'true' then
    raise exception 'SHARED_CHART_CASE_LEAD_REQUIRED' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.clinic_memberships m
    join public.patient_professional_links l
      on l.patient_id=p_patient_id and l.organization_id=p_clinic_id::text
      and l.professional_id=m.user_id::text and l.status='active'
      and lower(coalesce(l.permissions->>'read','true'))<>'false'
    where m.clinic_id=p_clinic_id and m.user_id=p_professional_id
      and m.status='active' and lower(m.role) in ('therapist','supervisor')
  ) then
    raise exception 'SHARED_CHART_CASE_PROFESSIONAL_REQUIRED' using errcode='42501';
  end if;
  insert into public.patient_shared_graph_delegations(
    clinic_id,patient_id,professional_user_id,granted_by,granted_at,revoked_at,revoked_by
  ) values(
    p_clinic_id,p_patient_id,p_professional_id,p_actor_id,now(),
    case when p_allow then null else now() end,
    case when p_allow then null else p_actor_id end
  )
  on conflict (patient_id,clinic_id,professional_user_id)
  do update set granted_by=excluded.granted_by,granted_at=excluded.granted_at,
    revoked_at=excluded.revoked_at,revoked_by=excluded.revoked_by;
  return true;
end
$$;
revoke execute on function public.set_patient_shared_chart_case_delegation_v2(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_patient_shared_chart_case_delegation_v2(uuid,uuid,uuid,uuid,boolean) to service_role;

-- Keep V2 RPC names, payload, format, and atomic upsert/clear unchanged;
-- add an independent, server-owned case/role/delegation gate before writes.
create or replace function public.set_patient_shared_chart_selection_v2(
 p_actor_id uuid,p_clinic_id uuid,p_patient_id uuid,p_chart_family text,p_chart_key text,
 p_reference_version integer default 1,p_chart_reference jsonb default '{}'::jsonb
) returns public.patient_shared_chart_selections
language plpgsql security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare v_result public.patient_shared_chart_selections;
begin
 if p_actor_id is null or p_clinic_id is null or p_patient_id is null then
   raise exception 'INVALID_SCOPE' using errcode='22023';
 end if;
 if not public.patient_file_actor_has_patient_access_v1(p_actor_id,p_clinic_id,p_patient_id) then
   raise exception 'PATIENT_ACCESS_DENIED' using errcode='42501';
 end if;
 if (public.patient_shared_chart_case_authority_v1(p_actor_id,p_clinic_id,p_patient_id)->>'canPublish') <> 'true' then
   raise exception 'SHARED_CHART_CASE_PUBLISH_DENIED' using errcode='42501';
 end if;
 if length(btrim(coalesce(p_chart_family,''))) not between 1 and 64
    or length(btrim(coalesce(p_chart_key,''))) not between 1 and 256
    or coalesce(p_reference_version,0)<=0
    or jsonb_typeof(coalesce(p_chart_reference,'{}'::jsonb))<>'object'
    or pg_column_size(coalesce(p_chart_reference,'{}'::jsonb))>8192 then
   raise exception 'INVALID_CHART_REFERENCE' using errcode='22023';
 end if;
 insert into public.patient_shared_chart_selections(
   clinic_id,patient_id,chart_family,chart_key,reference_version,chart_reference,created_by,updated_by
 ) values(
   p_clinic_id,p_patient_id,btrim(p_chart_family),btrim(p_chart_key),p_reference_version,
   coalesce(p_chart_reference,'{}'::jsonb),p_actor_id,p_actor_id
 )
 on conflict(clinic_id,patient_id) do update
   set chart_family=excluded.chart_family,chart_key=excluded.chart_key,
       reference_version=excluded.reference_version,chart_reference=excluded.chart_reference,
       updated_by=p_actor_id,updated_at=now()
 returning * into v_result;
 return v_result;
end
$$;
revoke execute on function public.set_patient_shared_chart_selection_v2(uuid,uuid,uuid,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.set_patient_shared_chart_selection_v2(uuid,uuid,uuid,text,text,integer,jsonb) to service_role;

create or replace function public.clear_patient_shared_chart_selection_v2(
 p_actor_id uuid,p_clinic_id uuid,p_patient_id uuid
) returns boolean language plpgsql security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare v_deleted_count integer:=0;
begin
 if p_actor_id is null or p_clinic_id is null or p_patient_id is null then
   raise exception 'INVALID_SCOPE' using errcode='22023';
 end if;
 if not public.patient_file_actor_has_patient_access_v1(p_actor_id,p_clinic_id,p_patient_id) then
   raise exception 'PATIENT_ACCESS_DENIED' using errcode='42501';
 end if;
 if (public.patient_shared_chart_case_authority_v1(p_actor_id,p_clinic_id,p_patient_id)->>'canPublish') <> 'true' then
   raise exception 'SHARED_CHART_CASE_PUBLISH_DENIED' using errcode='42501';
 end if;
 delete from public.patient_shared_chart_selections
 where clinic_id=p_clinic_id and patient_id=p_patient_id;
 get diagnostics v_deleted_count=row_count;
 return v_deleted_count>0;
end
$$;
revoke execute on function public.clear_patient_shared_chart_selection_v2(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.clear_patient_shared_chart_selection_v2(uuid,uuid,uuid) to service_role;
