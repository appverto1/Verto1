-- Manual prospecting CRUD: atomic bulk capture, edits, soft deletion, and explicit loss choice.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Manually entered prospects have no self-declared contact consent; never fabricate consent dates.
alter table public.sales_leads alter column contact_consent_at drop not null;

create table if not exists public.sales_kanban_creation_batches (
  idempotency_key text primary key check (char_length(idempotency_key) between 12 and 120),
  actor_user_id uuid not null references public.users(id),
  fingerprint text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.sales_kanban_creation_batches enable row level security;
revoke all on public.sales_kanban_creation_batches from public, anon, authenticated;
grant select, insert on public.sales_kanban_creation_batches to service_role;

create or replace function public.create_sales_kanban_opportunities_v1(
  p_phones jsonb, p_actor_id uuid, p_action_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_entry jsonb;
  v_digits text;
  v_phones text[] := array[]::text[];
  v_fingerprint text;
  v_batch public.sales_kanban_creation_batches%rowtype;
  v_id uuid;
  v_result jsonb := '[]'::jsonb;
  v_at timestamptz := clock_timestamp();
  v_i integer := 0;
begin
  if p_actor_id is null or p_action_key is null or char_length(p_action_key) not between 12 and 120 then
    raise exception 'INVALID_CREATION_KEY';
  end if;
  if p_phones is null or jsonb_typeof(p_phones) <> 'array' then
    raise exception 'INVALID_PHONE_LIST';
  end if;
  if jsonb_array_length(p_phones) not between 1 and 100 then
    raise exception 'INVALID_PHONE_LIST';
  end if;
  for v_entry in select value from jsonb_array_elements(p_phones) loop
    if jsonb_typeof(v_entry) <> 'string' or char_length(v_entry #>> '{}') > 40 then
      raise exception 'INVALID_PHONE';
    end if;
    v_digits := regexp_replace(v_entry #>> '{}','[^0-9]','','g');
    if char_length(v_digits) in (10,11) then v_digits := '55' || v_digits; end if;
    if v_digits !~ '^55[1-9][0-9][0-9]{8,9}$' then
      raise exception 'INVALID_PHONE';
    end if;
    if v_digits = any(v_phones) then raise exception 'DUPLICATE_IN_BATCH'; end if;
    v_phones := array_append(v_phones,v_digits);
  end loop;
  v_fingerprint := md5(array_to_string(v_phones,','));
  perform pg_advisory_xact_lock(hashtextextended('sales-kanban-create:'||p_action_key,0));
  select * into v_batch from public.sales_kanban_creation_batches
    where idempotency_key=p_action_key;
  if found then
    if v_batch.actor_user_id is distinct from p_actor_id or v_batch.fingerprint <> v_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_batch.response;
  end if;
  foreach v_digits in array v_phones loop
    if exists(select 1 from public.sales_leads where normalized_phone=v_digits and deleted_at is null) then
      raise exception 'PHONE_ALREADY_EXISTS';
    end if;
    insert into public.sales_leads(
      name,phone,normalized_phone,operation_type,acquisition_channel,
      contact_consent_at,contact_consent_version,contact_consent_origin,contact_consent_purpose,
      status,created_at,updated_at
    ) values(
      'Oportunidade ' || right(v_digits,4), '+'||v_digits,v_digits,'clinic','manual_kanban',
      null,'not_collected','owner_manual_no_consent','sales_contact',
      'new',v_at,v_at
    ) returning id into v_id;
    v_i := v_i+1;
    insert into public.sales_lead_events(lead_id,event_type,actor_user_id,metadata,idempotency_key)
    values(v_id,'lead_created',p_actor_id,
      jsonb_build_object('source','owner_kanban','contact_consent','not_collected'),
      'sales-kanban-create:'||p_action_key||':'||v_i::text);
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'id',v_id,'name','Oportunidade '||right(v_digits,4),
      'phone','+'||v_digits,'status','new','createdAt',v_at,'updatedAt',v_at
    ));
  end loop;
  insert into public.sales_kanban_creation_batches(idempotency_key,actor_user_id,fingerprint,response)
    values(p_action_key,p_actor_id,v_fingerprint,v_result);
  return v_result;
end $$;

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
  if v_lead.status='converted' or v_lead.converted_user_id is not null
     or v_lead.converted_clinic_id is not null then raise exception 'LEAD_LOCKED'; end if;
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
  if v_lead.status='converted' or v_lead.converted_user_id is not null
     or v_lead.converted_clinic_id is not null or exists(
       select 1 from public.sales_offers
       where lead_id=p_lead_id and status not in ('cancelled','expired')
     ) then raise exception 'LEAD_LOCKED'; end if;
  update public.sales_leads set deleted_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=p_lead_id;
  insert into public.sales_lead_events(lead_id,event_type,actor_user_id,metadata,idempotency_key)
    values(p_lead_id,'lead_updated',p_actor_id,
      jsonb_build_object('source','owner_kanban','action','soft_delete'),v_key);
  return jsonb_build_object('deleted',true,'id',p_lead_id);
end $$;

create or replace function public.record_sales_prospecting_attempt_v1(
  p_lead_id uuid, p_channel text, p_outcome text, p_action_key text, p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_lead public.sales_leads%rowtype;
  v_existing public.sales_prospecting_attempts%rowtype;
  v_phone integer;
  v_whatsapp integer;
  v_total integer;
  v_reached boolean;
  v_at timestamptz := clock_timestamp();
  v_attempt_id uuid;
begin
  if p_channel not in ('phone','whatsapp_call') or p_outcome not in ('no_decisor','decisor_spoken')
     or p_action_key is null or char_length(p_action_key) not between 12 and 120 then
    raise exception 'INVALID_PROSPECTING_ATTEMPT';
  end if;
  -- Lead row lock serializes competing channels and replays for the same lead.
  select * into v_lead from public.sales_leads
  where id = p_lead_id and deleted_at is null for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;
  select * into v_existing from public.sales_prospecting_attempts
  where idempotency_key = p_action_key;
  if found then
    if v_existing.lead_id <> p_lead_id or v_existing.channel <> p_channel
       or v_existing.outcome <> p_outcome or v_existing.actor_user_id is distinct from p_actor_user_id then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    v_attempt_id := v_existing.id;
    v_at := v_existing.occurred_at;
  else
    if v_lead.status in ('lost','archived','converted')
       or v_lead.converted_user_id is not null or v_lead.converted_clinic_id is not null
       or v_lead.do_not_contact then
      raise exception 'PROSPECTING_NOT_ALLOWED';
    end if;
    if exists (
      select 1 from public.sales_prospecting_attempts
      where lead_id = p_lead_id and outcome = 'decisor_spoken'
    ) then
      raise exception 'DECISOR_ALREADY_CONTACTED';
    end if;
    select count(*) filter(where channel='phone')::integer,
           count(*) filter(where channel='whatsapp_call')::integer
      into v_phone,v_whatsapp
    from public.sales_prospecting_attempts where lead_id = p_lead_id;
    if (p_channel='phone' and v_phone >= 5) or
       (p_channel='whatsapp_call' and v_whatsapp >= 5) then
      raise exception 'CHANNEL_ATTEMPT_LIMIT';
    end if;
    insert into public.sales_prospecting_attempts
      (lead_id,actor_user_id,channel,outcome,idempotency_key,occurred_at)
    values(p_lead_id,p_actor_user_id,p_channel,p_outcome,p_action_key,v_at)
    returning id into v_attempt_id;
    if p_outcome = 'decisor_spoken' then
      -- Do not downgrade advanced funnel stages.
      update public.sales_leads
      set status = case when status='new' then 'contact_started'::public.sales_lead_status else status end,
          last_contact_at = v_at, updated_at = v_at
      where id=p_lead_id returning * into v_lead;
      insert into public.sales_lead_events(lead_id,event_type,actor_user_id,metadata,idempotency_key)
      values(p_lead_id,'contact_started',p_actor_user_id,jsonb_build_object('channel',p_channel,'attempt_id',v_attempt_id),
             'prospecting-contact:' || v_attempt_id::text);
    end if;
  end if;
  select count(*) filter(where channel='phone')::integer,
         count(*) filter(where channel='whatsapp_call')::integer,
         count(*)::integer,
         coalesce(bool_or(outcome='decisor_spoken'),false)
    into v_phone,v_whatsapp,v_total,v_reached
  from public.sales_prospecting_attempts where lead_id = p_lead_id;
  -- Ten attempts exhaust the counters; only a separate explicit confirmation can mark loss.
  return jsonb_build_object(
    'attemptId',v_attempt_id,'occurredAt',v_at,'status',v_lead.status,
    'lostAt',v_lead.lost_at,'updatedAt',v_lead.updated_at,
    'total',v_total,'needsLossDecision',(v_total = 10 and not v_reached),'phone',v_phone,'whatsappCall',v_whatsapp,'reachedDecisor',v_reached
  );
end $$;

revoke all on function public.create_sales_kanban_opportunities_v1(jsonb,uuid,text) from public,anon,authenticated;
revoke all on function public.update_sales_kanban_opportunity_v1(uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.delete_sales_kanban_opportunity_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.create_sales_kanban_opportunities_v1(jsonb,uuid,text) to service_role;
grant execute on function public.update_sales_kanban_opportunity_v1(uuid,uuid,jsonb,text) to service_role;
grant execute on function public.delete_sales_kanban_opportunity_v1(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
