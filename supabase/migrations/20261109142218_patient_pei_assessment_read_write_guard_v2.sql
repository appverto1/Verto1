-- PEI authorization hardening: an explicit revoked read permission must
-- also prevent a professional from creating or editing an evaluation plan.
-- Clinic managers retain their established case-scope authority.
-- Preserve the atomically versioned Save transaction from v1.
create or replace function public.write_patient_pei_assessment_plan_v1(
  p_operation text,
  p_clinic_id uuid,
  p_patient_id uuid,
  p_actor_id uuid,
  p_plan_id uuid,
  p_specialty text,
  p_responsible_professional_id uuid,
  p_protocol_id text,
  p_protocol_snapshot jsonb,
  p_content jsonb,
  p_title text,
  p_expected_revision integer,
  p_idempotency_key text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $body$
declare
  v_role text;
  v_row public.patient_pei_assessment_plans_v1%rowtype;
  v_next_status text;
  v_hash text;
  v_is_manager boolean;
  v_authorized_supervisor boolean;
  v_protocol jsonb;
begin
  if p_operation not in ('create','save','activate','complete','archive') then
    raise exception 'PEI_OPERATION_INVALID' using errcode = '22023';
  end if;
  if p_clinic_id is null or p_patient_id is null or p_actor_id is null then
    raise exception 'PEI_SCOPE_INVALID' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.patients p
    where p.id = p_patient_id and p.clinic_id = p_clinic_id
      and p.deleted_at is null
  ) then
    raise exception 'PEI_PATIENT_SCOPE_DENIED' using errcode = '42501';
  end if;
  select cm.role into v_role
    from public.clinic_memberships cm
    where cm.clinic_id = p_clinic_id and cm.user_id = p_actor_id and cm.status = 'active'
    limit 1;
  if v_role is null or v_role not in ('director','coordinator','supervisor','therapist') then
    raise exception 'PEI_MEMBERSHIP_DENIED' using errcode = '42501';
  end if;
  v_is_manager := v_role in ('director','coordinator');
  v_authorized_supervisor := exists (
    select 1 from public.patient_professional_links l
      where l.patient_id = p_patient_id and l.clinic_id = p_clinic_id::text
        and l.professional_id = p_actor_id::text and l.status = 'active'
        and l.case_role in ('supervisor','case_supervisor')
        and coalesce(l.permissions->>'read','true') <> 'false'
        and coalesce(l.permissions->>'write','true') <> 'false'
  );
  if p_operation = 'create' then
    if p_plan_id is not null or p_responsible_professional_id is null
       or p_protocol_id is null or length(btrim(p_protocol_id)) = 0
       or p_protocol_snapshot is null or jsonb_typeof(p_protocol_snapshot) <> 'object'
       or p_content is null or jsonb_typeof(p_content) <> 'object'
       or p_idempotency_key is null or length(p_idempotency_key) < 8
       or length(btrim(coalesce(p_title,''))) < 2
       or length(btrim(coalesce(p_specialty,''))) < 2
    then
      raise exception 'PEI_CREATE_INVALID' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.clinic_memberships cm
      join public.patient_professional_links l
        on l.professional_id = cm.user_id::text
        and l.patient_id = p_patient_id
        and l.clinic_id = p_clinic_id::text
        and l.status = 'active'
        and coalesce(l.permissions->>'read','true') <> 'false'
        and coalesce(l.permissions->>'write','true') <> 'false'
      where cm.clinic_id = p_clinic_id and cm.user_id = p_responsible_professional_id
        and cm.status = 'active'
        and lower(btrim(coalesce(cm.specialty,''))) = lower(btrim(p_specialty))
        and lower(btrim(l.specialty)) = lower(btrim(p_specialty))
    ) then
      raise exception 'PEI_RESPONSIBLE_SCOPE_DENIED' using errcode = '42501';
    end if;
    if not v_is_manager and not v_authorized_supervisor then
      if v_role <> 'therapist' or p_actor_id <> p_responsible_professional_id then
        raise exception 'PEI_ACTOR_SCOPE_DENIED' using errcode = '42501';
      end if;
    end if;
    -- Bind the uneditable method/reference to the clinic's approved evaluation
    -- protocol. Even a direct service RPC call cannot forge the source.
    select value into v_protocol
      from public.clinic_state cs
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(cs.protocols)='array' then cs.protocols else '[]'::jsonb end
      ) item(value)
      where cs.clinic_id=p_clinic_id
        and (item.value->>'id'=p_protocol_id or item.value->>'canonicalKey'=p_protocol_id)
        and lower(coalesce(item.value->>'category','evaluation'))='evaluation'
        and jsonb_typeof(item.value->'data')='array'
      limit 1;
    if v_protocol is null or p_protocol_snapshot <> v_protocol then
      raise exception 'PEI_PROTOCOL_SCOPE_DENIED' using errcode='42501';
    end if;
    if p_content <> '{"goals":[]}'::jsonb then
      raise exception 'PEI_INITIAL_CONTENT_INVALID' using errcode='22023';
    end if;
    v_hash := md5(p_clinic_id::text || p_patient_id::text ||
      p_responsible_professional_id::text || btrim(p_specialty) ||
      p_protocol_id || p_protocol_snapshot::text || p_content::text || p_title);
    insert into public.patient_pei_assessment_plans_v1 (
      clinic_id,patient_id,specialty,responsible_professional_id,protocol_id,
      protocol_snapshot,content,title,status,idempotency_key,request_hash,
      created_by,updated_by
    ) values (
      p_clinic_id,p_patient_id,btrim(p_specialty),p_responsible_professional_id,
      p_protocol_id,p_protocol_snapshot,p_content,btrim(p_title),'draft',
      p_idempotency_key,v_hash,p_actor_id,p_actor_id
    ) on conflict (clinic_id,patient_id,idempotency_key) do nothing
    returning * into v_row;
    if not found then
      select * into v_row from public.patient_pei_assessment_plans_v1
        where clinic_id=p_clinic_id and patient_id=p_patient_id and idempotency_key=p_idempotency_key;
      if not found or v_row.request_hash <> v_hash then
        raise exception 'PEI_IDEMPOTENCY_CONFLICT' using errcode='23505';
      end if;
      return to_jsonb(v_row);
    end if;
  else
    if p_plan_id is null or p_expected_revision is null or p_expected_revision < 1
      or p_content is null or jsonb_typeof(p_content) <> 'object'
      or length(btrim(coalesce(p_title,''))) < 2
    then
      raise exception 'PEI_UPDATE_INVALID' using errcode='22023';
    end if;
    select * into v_row from public.patient_pei_assessment_plans_v1
      where id=p_plan_id and clinic_id=p_clinic_id and patient_id=p_patient_id
      for update;
    if not found then
      raise exception 'PEI_PLAN_SCOPE_DENIED' using errcode='42501';
    end if;
    if not v_is_manager and not v_authorized_supervisor then
      if v_role <> 'therapist' or v_row.responsible_professional_id <> p_actor_id or not exists (
        select 1 from public.patient_professional_links l
        where l.patient_id=p_patient_id and l.clinic_id=p_clinic_id::text
          and l.professional_id=p_actor_id::text and l.status='active'
          and lower(btrim(l.specialty))=lower(btrim(v_row.specialty))
          and coalesce(l.permissions->>'read','true') <> 'false'
        and coalesce(l.permissions->>'write','true') <> 'false'
      ) then
        raise exception 'PEI_ACTOR_SCOPE_DENIED' using errcode='42501';
      end if;
    end if;
    if v_row.revision <> p_expected_revision then
      raise exception 'PEI_REVISION_CONFLICT' using errcode='40001';
    end if;
    if v_row.status = 'archived' or
      (v_row.status = 'completed' and p_operation not in ('archive')) then
      raise exception 'PEI_PLAN_CLOSED' using errcode='23514';
    end if;
    if p_operation='activate' and v_row.status <> 'draft' then
      raise exception 'PEI_STATUS_INVALID' using errcode='23514';
    end if;
    if p_operation='complete' and v_row.status <> 'active' then
      raise exception 'PEI_STATUS_INVALID' using errcode='23514';
    end if;
    v_next_status := case p_operation
      when 'activate' then 'active'
      when 'complete' then 'completed'
      when 'archive' then 'archived'
      else v_row.status end;
    update public.patient_pei_assessment_plans_v1
      set content=p_content, title=btrim(p_title),
          status=v_next_status, revision=revision+1,
          updated_by=p_actor_id, updated_at=now()
      where id=v_row.id returning * into v_row;
  end if;
  insert into public.patient_pei_assessment_plan_versions_v1
    (plan_id,revision,event_kind,snapshot,created_by)
    values (v_row.id,v_row.revision,p_operation,to_jsonb(v_row),p_actor_id);
  return to_jsonb(v_row);
end;
$body$;

revoke all on function public.write_patient_pei_assessment_plan_v1(
 text,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,jsonb,text,integer,text
) from public, anon, authenticated;
grant execute on function public.write_patient_pei_assessment_plan_v1(
 text,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,jsonb,text,integer,text
) to service_role;

