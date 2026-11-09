-- PEI assessment workspace v1: separate evaluation plans from patient demographics and therapeutic PTS.
-- Private service-role-only API; RLS remains enabled to prevent browser-side direct access.
create table if not exists public.patient_pei_assessment_plans_v1 (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  specialty text not null check (length(btrim(specialty)) between 2 and 100),
  responsible_professional_id uuid not null,
  protocol_id text not null check (length(btrim(protocol_id)) between 1 and 180),
  protocol_snapshot jsonb not null check (jsonb_typeof(protocol_snapshot) = 'object'),
  title text not null check (length(btrim(title)) between 2 and 180),
  content jsonb not null default '{"goals":[]}'::jsonb check (jsonb_typeof(content) = 'object'),
  status text not null default 'draft' check (status in ('draft','active','completed','archived')),
  revision integer not null default 1 check (revision >= 1),
  idempotency_key text not null check (length(idempotency_key) between 8 and 120),
  request_hash text not null,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, patient_id, idempotency_key)
);

create index if not exists patient_pei_assessment_plans_scope_v1_idx
  on public.patient_pei_assessment_plans_v1 (clinic_id, patient_id, updated_at desc);

create table if not exists public.patient_pei_assessment_plan_versions_v1 (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.patient_pei_assessment_plans_v1(id) on delete restrict,
  revision integer not null check (revision >= 1),
  event_kind text not null check (event_kind in ('create','save','activate','complete','archive')),
  snapshot jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (plan_id, revision)
);

create index if not exists patient_pei_assessment_versions_scope_v1_idx
  on public.patient_pei_assessment_plan_versions_v1(plan_id, revision desc);

alter table public.patient_pei_assessment_plans_v1 enable row level security;
alter table public.patient_pei_assessment_plan_versions_v1 enable row level security;
revoke all on public.patient_pei_assessment_plans_v1 from public, anon, authenticated;
revoke all on public.patient_pei_assessment_plan_versions_v1 from public, anon, authenticated;
grant select, insert, update on public.patient_pei_assessment_plans_v1 to service_role;
grant select, insert on public.patient_pei_assessment_plan_versions_v1 to service_role;

-- Only server-side service_role may call this RPC. It validates DB membership and
-- patient/clinic/specialty associations again, and updates snapshot+version atomically.
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

-- Resolve only the requested evaluation protocol, avoiding a full clinic protocol JSON download.
create or replace function public.get_clinic_pei_evaluation_protocol_v1(
  p_clinic_id uuid, p_protocol_id text
) returns jsonb
language sql stable security invoker
set search_path = public, pg_temp
as $query$
  select item.value
  from public.clinic_state cs
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(cs.protocols)='array' then cs.protocols else '[]'::jsonb end
  ) as item(value)
  where cs.clinic_id = p_clinic_id
    and (item.value->>'id' = p_protocol_id or item.value->>'canonicalKey'=p_protocol_id)
    and lower(coalesce(item.value->>'category','evaluation')) = 'evaluation'
    and jsonb_typeof(item.value->'data')='array'
  limit 1;
$query$;
revoke all on function public.get_clinic_pei_evaluation_protocol_v1(uuid,text)
  from public, anon, authenticated;
grant execute on function public.get_clinic_pei_evaluation_protocol_v1(uuid,text) to service_role;
