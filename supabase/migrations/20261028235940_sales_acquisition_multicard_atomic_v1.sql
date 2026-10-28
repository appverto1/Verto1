-- Atomic multi-card acquisition assignment for existing Kanban opportunities.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table public.sales_kanban_acquisition_bulk_batches(
 idempotency_key text primary key,
 actor_user_id uuid not null,
 request_hash text not null,
 response jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.sales_kanban_acquisition_bulk_batches enable row level security;
revoke all on public.sales_kanban_acquisition_bulk_batches from public,anon,authenticated;
grant select,insert on public.sales_kanban_acquisition_bulk_batches to service_role;

create or replace function public.save_sales_lead_acquisition_channels_bulk_v1(
 p_actor_user_id uuid,p_items jsonb,p_action_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 v_saved public.sales_kanban_acquisition_bulk_batches%rowtype;
 v_hash text;v_result jsonb:='[]'::jsonb;
 v_item jsonb;v_channels jsonb;v_channel jsonb;
 v_id uuid;v_seen uuid[]:=array[]::uuid[];
 v_ids uuid[];v_entry jsonb;v_index integer:=0;
begin
 if p_actor_user_id is null or not exists(select 1 from public.platform_admins
   where user_id=p_actor_user_id and active=true) then raise exception 'PLATFORM_ADMIN_REQUIRED';end if;
 if p_action_key is null or char_length(p_action_key) not between 12 and 120 or
    jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100
 then raise exception 'INVALID_ACQUISITION_BATCH';end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
   if jsonb_typeof(v_item) is distinct from 'object' or
      coalesce(v_item->>'leadId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or
      jsonb_typeof(v_item->'channelIds') is distinct from 'array' or
      jsonb_array_length(v_item->'channelIds')>20
   then raise exception 'INVALID_ACQUISITION_BATCH';end if;
   v_id:=(v_item->>'leadId')::uuid;
   if v_id=any(v_seen) then raise exception 'DUPLICATE_ACQUISITION_LEAD';end if;
   v_seen:=array_append(v_seen,v_id);
   v_channels:=v_item->'channelIds';
   v_ids:=array[]::uuid[];
   for v_channel in select value from jsonb_array_elements(v_channels) loop
     if jsonb_typeof(v_channel) is distinct from 'string' or
       (v_channel #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     then raise exception 'INVALID_ACQUISITION_BATCH';end if;
     if (v_channel #>> '{}')::uuid=any(v_ids) then raise exception 'DUPLICATE_BATCH_CHANNEL';end if;
     v_ids:=array_append(v_ids,(v_channel #>> '{}')::uuid);
   end loop;
 end loop;

 v_hash:=md5(p_items::text||'|'||p_actor_user_id::text);
 perform pg_advisory_xact_lock(hashtextextended('sales-kanban-bulk-acquisition:'||p_action_key,0));
 select * into v_saved from public.sales_kanban_acquisition_bulk_batches
   where idempotency_key=p_action_key for update;
 if found then
   if v_saved.actor_user_id is distinct from p_actor_user_id or v_saved.request_hash<>v_hash
   then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   return v_saved.response;
 end if;
 -- Sorted row locks prevent two concurrent bulk actions from deadlocking.
 for v_item in select value from jsonb_array_elements(p_items) order by value->>'leadId' loop
   v_index:=v_index+1;
   v_id:=(v_item->>'leadId')::uuid;
   select coalesce(array_agg(x::uuid),'{}'::uuid[]) into v_ids
    from jsonb_array_elements_text(v_item->'channelIds') x;
   v_entry:=public.save_sales_lead_acquisition_channels_v1(
     v_id,p_actor_user_id,v_ids,'bulk:'||md5(p_action_key)||':'||v_index);
   v_result:=v_result||jsonb_build_array(v_entry);
 end loop;
 insert into public.sales_kanban_acquisition_bulk_batches(
   idempotency_key,actor_user_id,request_hash,response)
 values(p_action_key,p_actor_user_id,v_hash,v_result);
 return v_result;
end $$;
revoke all on function public.save_sales_lead_acquisition_channels_bulk_v1(uuid,jsonb,text)
 from public,anon,authenticated;
grant execute on function public.save_sales_lead_acquisition_channels_bulk_v1(uuid,jsonb,text)
 to service_role;
notify pgrst,'reload schema';
commit;
