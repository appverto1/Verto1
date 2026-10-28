-- Keep owner Kanban presentation editable without rewriting subscribed customers,
-- active offers, Stripe contacts, or canonical identities.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table if not exists public.sales_kanban_opportunity_overrides (
  lead_id uuid primary key references public.sales_leads(id) on delete cascade,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
  hidden_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.sales_kanban_opportunity_overrides enable row level security;
revoke all on public.sales_kanban_opportunity_overrides from public, anon, authenticated;
grant select,insert,update,delete on public.sales_kanban_opportunity_overrides to service_role;

create or replace function public.update_sales_kanban_opportunity_v1(
  p_lead_id uuid, p_actor_id uuid, p_patch jsonb, p_action_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_lead public.sales_leads%rowtype;
  v_details jsonb := '{}'::jsonb;
  v_hidden timestamptz;
  v_existing jsonb;
  v_name text;
  v_phone text;
  v_email text;
  v_clinic text;
  v_notes text;
  v_isolated boolean;
  v_key text := 'sales-kanban-edit:'||p_action_key;
  v_result jsonb;
begin
  if p_lead_id is null or p_actor_id is null or p_action_key is null
     or char_length(p_action_key) not between 12 and 120 or p_patch is null
     or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb
     or exists(select 1 from jsonb_object_keys(p_patch) k
       where k not in ('name','phone','email','clinicName','notes'))
     or exists(select 1 from jsonb_each(p_patch) e
       where e.key in ('name','phone') and jsonb_typeof(e.value)<>'string')
     or exists(select 1 from jsonb_each(p_patch) e
       where e.key in ('email','clinicName','notes') and jsonb_typeof(e.value) not in ('string','null'))
  then raise exception 'INVALID_EDIT_FIELDS'; end if;

  select * into v_lead from public.sales_leads where id=p_lead_id for update;
  if not found or v_lead.deleted_at is not null then raise exception 'LEAD_NOT_FOUND'; end if;
  select details,hidden_at into v_details,v_hidden from public.sales_kanban_opportunity_overrides where lead_id=p_lead_id;
  if v_hidden is not null then raise exception 'LEAD_NOT_FOUND'; end if;
  v_details := coalesce(v_details,'{}'::jsonb);
  select metadata into v_existing from public.sales_lead_events where idempotency_key=v_key;
  if found then
    if v_existing->>'hash' <> md5(p_patch::text)
      or v_existing->>'leadId' <> p_lead_id::text
      or v_existing->>'actorId' <> p_actor_id::text then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('id',v_lead.id,
      'name',coalesce(v_details->>'name',v_lead.name),
      'phone',coalesce(v_details->>'phone',v_lead.phone),
      'email',case when v_details ? 'email' then v_details->>'email' else v_lead.email end,
      'clinicName',case when v_details ? 'clinicName' then v_details->>'clinicName' else v_lead.clinic_name end,
      'notes',case when v_details ? 'notes' then v_details->>'notes' else v_lead.notes end,
      'updatedAt',v_lead.updated_at,'kanbanOnly',coalesce((v_existing->>'kanbanOnly')::boolean,false));
  end if;

  v_name := case when p_patch ? 'name' then btrim(p_patch->>'name')
                  when v_details ? 'name' then v_details->>'name' else v_lead.name end;
  v_phone := case when p_patch ? 'phone' then regexp_replace(p_patch->>'phone','[^0-9]','','g')
                   when v_details ? 'phone' then regexp_replace(v_details->>'phone','[^0-9]','','g')
                   else v_lead.normalized_phone end;
  v_email := case when p_patch ? 'email' then nullif(lower(btrim(p_patch->>'email')),'')
                   when v_details ? 'email' then v_details->>'email' else v_lead.email end;
  v_clinic := case when p_patch ? 'clinicName' then nullif(btrim(p_patch->>'clinicName'),'')
                    when v_details ? 'clinicName' then v_details->>'clinicName' else v_lead.clinic_name end;
  v_notes := case when p_patch ? 'notes' then nullif(btrim(p_patch->>'notes'),'')
                   when v_details ? 'notes' then v_details->>'notes' else v_lead.notes end;
  if char_length(v_phone) in (10,11) then v_phone:='55'||v_phone; end if;
  if char_length(v_name) not between 2 and 180 or
     v_phone !~ '^55[1-9][0-9][0-9]{8,9}$' or
     (v_email is not null and (char_length(v_email) not between 3 and 254 or
       v_email !~ '^[^ @]+@[^ @]+[.][^ @]+$')) or
     char_length(coalesce(v_clinic,''))>180 or char_length(coalesce(v_notes,''))>1500
  then raise exception 'INVALID_EDIT_FIELDS'; end if;

  v_isolated := v_lead.status='converted' or v_lead.converted_user_id is not null
    or v_lead.converted_clinic_id is not null
    or exists(select 1 from public.sales_offers where lead_id=p_lead_id and status not in ('cancelled','expired'))
    or exists(select 1 from public.sales_leads where id<>p_lead_id and deleted_at is null and
      (normalized_phone=v_phone or (v_email is not null and normalized_email=v_email)));

  if not v_isolated then
    begin
      update public.sales_leads set name=v_name,phone='+'||v_phone,normalized_phone=v_phone,
        email=v_email,normalized_email=v_email,clinic_name=v_clinic,notes=v_notes,
        updated_at=clock_timestamp()
      where id=p_lead_id returning * into v_lead;
      delete from public.sales_kanban_opportunity_overrides where lead_id=p_lead_id;
    exception when unique_violation then
      v_isolated:=true; -- Parallel conflicting contact: preserve canonical uniqueness.
    end;
  end if;
  if v_isolated then
    insert into public.sales_kanban_opportunity_overrides(lead_id,details,updated_at)
    values(p_lead_id,jsonb_build_object('name',v_name,'phone','+'||v_phone,
      'email',v_email,'clinicName',v_clinic,'notes',v_notes),clock_timestamp())
    on conflict (lead_id) do update set
      details=excluded.details,updated_at=excluded.updated_at;
  end if;

  insert into public.sales_lead_events(lead_id,event_type,actor_user_id,metadata,idempotency_key)
  values(p_lead_id,'lead_updated',p_actor_id,
    jsonb_build_object('source','owner_kanban','leadId',p_lead_id,'actorId',p_actor_id,
      'hash',md5(p_patch::text),'kanbanOnly',v_isolated,
      'fields',(select jsonb_agg(k) from jsonb_object_keys(p_patch) k)),v_key);
  return jsonb_build_object('id',p_lead_id,'name',v_name,'phone','+'||v_phone,
    'email',v_email,'clinicName',v_clinic,'notes',v_notes,
    'updatedAt',clock_timestamp(),'kanbanOnly',v_isolated);
end $$;

create or replace function public.delete_sales_kanban_opportunity_v1(
  p_lead_id uuid, p_actor_id uuid, p_action_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_lead public.sales_leads%rowtype;
  v_hidden timestamptz;
  v_isolated boolean;
  v_key text := 'sales-kanban-delete:'||p_action_key;
begin
  if p_lead_id is null or p_actor_id is null or p_action_key is null
    or char_length(p_action_key) not between 12 and 120 then raise exception 'INVALID_DELETE'; end if;
  select * into v_lead from public.sales_leads where id=p_lead_id for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;
  select hidden_at into v_hidden from public.sales_kanban_opportunity_overrides where lead_id=p_lead_id;
  if v_lead.deleted_at is not null or v_hidden is not null then
    if exists(select 1 from public.sales_lead_events where idempotency_key=v_key
       and lead_id=p_lead_id and actor_user_id=p_actor_id) then
      return jsonb_build_object('deleted',true,'id',p_lead_id);
    end if;
    raise exception 'LEAD_NOT_FOUND';
  end if;

  v_isolated := v_lead.status='converted' or v_lead.converted_user_id is not null
     or v_lead.converted_clinic_id is not null
     or exists(select 1 from public.sales_offers
       where lead_id=p_lead_id and status not in ('cancelled','expired'));
  if v_isolated then
    insert into public.sales_kanban_opportunity_overrides(lead_id,hidden_at,updated_at)
    values(p_lead_id,clock_timestamp(),clock_timestamp())
    on conflict (lead_id) do update set
      hidden_at=excluded.hidden_at,updated_at=excluded.updated_at;
  else
    update public.sales_leads set deleted_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=p_lead_id;
  end if;
  insert into public.sales_lead_events(lead_id,event_type,actor_user_id,metadata,idempotency_key)
  values(p_lead_id,'lead_updated',p_actor_id,
    jsonb_build_object('source','owner_kanban','action',case when v_isolated then 'kanban_hide' else 'soft_delete' end),
    v_key);
  return jsonb_build_object('deleted',true,'id',p_lead_id,'kanbanOnly',v_isolated);
end $$;

revoke all on function public.update_sales_kanban_opportunity_v1(uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.delete_sales_kanban_opportunity_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.update_sales_kanban_opportunity_v1(uuid,uuid,jsonb,text) to service_role;
grant execute on function public.delete_sales_kanban_opportunity_v1(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
