-- Permit the MFA-protected Super Admin to manage Kanban cards even after conversion
-- or proposal creation. This is a soft delete; financial and clinical links remain.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.update_sales_kanban_opportunity_v1(
  p_lead_id uuid, p_actor_id uuid, p_patch jsonb, p_action_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_lead public.sales_leads%rowtype;
  v_name text;
  v_phone text;
  v_email text;
  v_clinic text;
  v_notes text;
  v_existing jsonb;
  v_key text := 'sales-kanban-edit:'||p_action_key;
begin
  if p_lead_id is null or p_actor_id is null or p_action_key is null
     or char_length(p_action_key) not between 12 and 120
     or p_patch is null or jsonb_typeof(p_patch)<>'object'
     or p_patch='{}'::jsonb then raise exception 'INVALID_EDIT'; end if;
  if exists(select 1 from jsonb_object_keys(p_patch) k
            where k not in ('name','phone','email','clinicName','notes')) then
    raise exception 'INVALID_EDIT_FIELDS';
  end if;
  if exists(select 1 from jsonb_each(p_patch) e
            where e.key in ('name','phone') and jsonb_typeof(e.value)<>'string') then
    raise exception 'INVALID_EDIT_FIELDS';
  end if;
  if exists(select 1 from jsonb_each(p_patch) e
            where e.key in ('email','clinicName','notes')
              and jsonb_typeof(e.value) not in ('string','null')) then
    raise exception 'INVALID_EDIT_FIELDS';
  end if;
  select * into v_lead from public.sales_leads where id=p_lead_id for update;
  if not found or v_lead.deleted_at is not null then raise exception 'LEAD_NOT_FOUND'; end if;
  -- Linked conversions remain authoritative: edit only CRM contact fields below.
  select metadata into v_existing from public.sales_lead_events
   where idempotency_key=v_key;
  if found then
    if v_existing->>'hash' <> md5(p_patch::text)
       or v_existing->>'leadId' <> p_lead_id::text then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('id',v_lead.id,'name',v_lead.name,'phone',v_lead.phone,
      'clinicName',v_lead.clinic_name,'email',v_lead.email,'notes',v_lead.notes,
      'updatedAt',v_lead.updated_at);
  end if;
  v_name := case when p_patch ? 'name' then btrim(p_patch->>'name') else v_lead.name end;
  v_phone := case when p_patch ? 'phone' then regexp_replace(p_patch->>'phone','[^0-9]','','g')
                  else v_lead.normalized_phone end;
  v_email := case when p_patch ? 'email' then nullif(lower(btrim(p_patch->>'email')),'')
                  else v_lead.email end;
  v_clinic := case when p_patch ? 'clinicName' then nullif(btrim(p_patch->>'clinicName'),'')
                   else v_lead.clinic_name end;
  v_notes := case when p_patch ? 'notes' then nullif(btrim(p_patch->>'notes'),'')
                  else v_lead.notes end;
  if char_length(v_phone) in (10,11) then v_phone := '55'||v_phone; end if;
  if char_length(v_name) not between 2 and 180 or
     v_phone !~ '^55[1-9][0-9][0-9]{8,9}$' or
     (v_email is not null and (char_length(v_email) not between 3 and 254 or
      v_email !~ '^[^ @]+@[^ @]+[.][^ @]+$')) or
     char_length(coalesce(v_clinic,''))>180 or char_length(coalesce(v_notes,''))>1500
     then raise exception 'INVALID_EDIT_FIELDS'; end if;
  update public.sales_leads set
    name=v_name,phone='+'||v_phone,normalized_phone=v_phone,
    email=v_email,normalized_email=v_email,clinic_name=v_clinic,notes=v_notes,
    updated_at=clock_timestamp()
  where id=p_lead_id returning * into v_lead;
  insert into public.sales_lead_events(lead_id,event_type,actor_user_id,metadata,idempotency_key)
    values(p_lead_id,'lead_updated',p_actor_id,
      jsonb_build_object('source','owner_kanban','leadId',p_lead_id,'hash',md5(p_patch::text),'fields',
        (select jsonb_agg(k) from jsonb_object_keys(p_patch) k)),
      v_key);
  return jsonb_build_object('id',v_lead.id,'name',v_lead.name,'phone',v_lead.phone,
    'clinicName',v_lead.clinic_name,'email',v_lead.email,'notes',v_lead.notes,
    'updatedAt',v_lead.updated_at);
end $$;

create or replace function public.delete_sales_kanban_opportunity_v1(
  p_lead_id uuid, p_actor_id uuid, p_action_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_lead public.sales_leads%rowtype;
  v_key text := 'sales-kanban-delete:'||p_action_key;
begin
  if p_lead_id is null or p_actor_id is null or p_action_key is null
     or char_length(p_action_key) not between 12 and 120 then raise exception 'INVALID_DELETE'; end if;
  select * into v_lead from public.sales_leads where id=p_lead_id for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;
  if v_lead.deleted_at is not null then
    if exists(select 1 from public.sales_lead_events
       where idempotency_key=v_key and lead_id=p_lead_id and actor_user_id=p_actor_id) then
      return jsonb_build_object('deleted',true,'id',p_lead_id);
    end if;
    raise exception 'LEAD_NOT_FOUND';
  end if;
  -- Never delete linked offers, customers, payments or clinical records.
  -- Only hide this lead from the prospecting Kanban via deleted_at.
  update public.sales_leads set deleted_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=p_lead_id;
  insert into public.sales_lead_events(lead_id,event_type,actor_user_id,metadata,idempotency_key)
    values(p_lead_id,'lead_updated',p_actor_id,
      jsonb_build_object('source','owner_kanban','action','soft_delete'),v_key);
  return jsonb_build_object('deleted',true,'id',p_lead_id);
end $$;

revoke all on function public.update_sales_kanban_opportunity_v1(uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.delete_sales_kanban_opportunity_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.update_sales_kanban_opportunity_v1(uuid,uuid,jsonb,text) to service_role;
grant execute on function public.delete_sales_kanban_opportunity_v1(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
