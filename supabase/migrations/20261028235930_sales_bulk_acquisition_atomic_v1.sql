-- Atomic bulk Kanban creation and per-number acquisition attribution.
-- Preserves existing v1 callers and never touches clinic/client/payment data.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table public.sales_kanban_creation_channel_batches(
 idempotency_key text primary key,
 actor_user_id uuid not null,
 request_hash text not null,
 response jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.sales_kanban_creation_channel_batches enable row level security;
revoke all on public.sales_kanban_creation_channel_batches from public,anon,authenticated;
grant select,insert on public.sales_kanban_creation_channel_batches to service_role;

create or replace function public.create_sales_kanban_opportunities_v2(
 p_phones jsonb,p_actor_id uuid,p_action_key text,p_channels jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 v_batch public.sales_kanban_creation_channel_batches%rowtype;
 v_hash text;v_created jsonb;v_result jsonb:='[]'::jsonb;
 v_item jsonb;v_source jsonb;v_channel text;v_channels uuid[];
 v_lead uuid;v_idx integer;v_count integer;
begin
 if p_actor_id is null or not exists(select 1 from public.platform_admins where user_id=p_actor_id and active=true)
 then raise exception 'PLATFORM_ADMIN_REQUIRED';end if;
 if p_action_key is null or char_length(p_action_key) not between 12 and 120
 then raise exception 'INVALID_CREATION_KEY';end if;
 if jsonb_typeof(p_phones) is distinct from 'array' or
    jsonb_array_length(p_phones) not between 1 and 100 or
    jsonb_typeof(p_channels) is distinct from 'array' or
    jsonb_array_length(p_channels)<>jsonb_array_length(p_phones)
 then raise exception 'INVALID_BATCH_CHANNELS';end if;

 -- Validate every selected channel before creating even one lead.
 for v_source in select value from jsonb_array_elements(p_channels) loop
   if jsonb_typeof(v_source) is distinct from 'array' or
      jsonb_array_length(v_source)>20
   then raise exception 'INVALID_BATCH_CHANNELS';end if;
   v_channels:=array[]::uuid[];
   for v_item in select value from jsonb_array_elements(v_source) loop
     if jsonb_typeof(v_item) is distinct from 'string' then
       raise exception 'INVALID_BATCH_CHANNELS';end if;
     v_channel:=v_item #>> '{}';
     if v_channel !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     then raise exception 'INVALID_BATCH_CHANNELS';end if;
     if v_channel::uuid=any(v_channels) then raise exception 'DUPLICATE_BATCH_CHANNEL';end if;
     v_channels:=array_append(v_channels,v_channel::uuid);
   end loop;
   if exists(select 1 from unnest(v_channels) as requested(id)
     left join public.sales_acquisition_channels c on c.id=requested.id
     where c.id is null or c.is_active=false)
   then raise exception 'ACQUISITION_CHANNEL_UNAVAILABLE';end if;
 end loop;

 v_hash:=md5(p_phones::text||'|'||p_channels::text||'|'||p_actor_id::text);
 perform pg_advisory_xact_lock(hashtextextended('sales-kanban-acquisition-create:'||p_action_key,0));
 select * into v_batch from public.sales_kanban_creation_channel_batches
   where idempotency_key=p_action_key for update;
 if found then
   if v_batch.actor_user_id is distinct from p_actor_id or v_batch.request_hash<>v_hash
   then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   return v_batch.response;
 end if;

 -- Existing authority enforces phone validation, uniqueness and insertion audit.
 -- This call and all channel inserts share the SAME transaction.
 v_created:=public.create_sales_kanban_opportunities_v1(p_phones,p_actor_id,p_action_key);
 for v_item,v_idx in
   select value,ordinality::integer from jsonb_array_elements(v_created) with ordinality
 loop
   v_lead:=(v_item->>'id')::uuid;
   v_source:=p_channels->(v_idx-1);
   select coalesce(array_agg(id),'{}'::uuid[]) into v_channels
     from jsonb_array_elements_text(v_source) as selected(id_text)
     cross join lateral (select selected.id_text::uuid id) uu;
   insert into public.sales_lead_acquisition_channels(lead_id,channel_id,assigned_by)
     select v_lead,id,p_actor_id from unnest(v_channels) as id
     on conflict(lead_id,channel_id) do nothing;
   if cardinality(v_channels)>0 then
     insert into public.sales_lead_events(lead_id,event_type,actor_user_id,metadata,idempotency_key)
     values(v_lead,'lead_updated',p_actor_id,
       jsonb_build_object('source','owner_kanban','action','bulk_acquisition_assigned',
         'channelIds',to_jsonb(v_channels),'batch',p_action_key),
       'sales-kanban-acquisition:'||p_action_key||':'||v_idx::text);
   end if;
   v_result:=v_result||jsonb_build_array(v_item||
      jsonb_build_object('channelIds',to_jsonb(v_channels)));
 end loop;
 insert into public.sales_kanban_creation_channel_batches(
   idempotency_key,actor_user_id,request_hash,response)
 values(p_action_key,p_actor_id,v_hash,v_result);
 return v_result;
end $$;

revoke all on function public.create_sales_kanban_opportunities_v2(jsonb,uuid,text,jsonb)
 from public,anon,authenticated;
grant execute on function public.create_sales_kanban_opportunities_v2(jsonb,uuid,text,jsonb)
 to service_role;
notify pgrst,'reload schema';
commit;
