-- Owner-only commercial multi-touch acquisition sources; additive schema.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table public.sales_acquisition_channels(
 id uuid primary key default gen_random_uuid(),
 name text not null check(char_length(name) between 2 and 80),
 is_active boolean not null default true,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create unique index sales_acquisition_channels_name_uidx
 on public.sales_acquisition_channels(lower(btrim(name)));
alter table public.sales_acquisition_channels enable row level security;
revoke all on public.sales_acquisition_channels from public,anon,authenticated;
grant select,insert,update on public.sales_acquisition_channels to service_role;

create table public.sales_lead_acquisition_channels(
 lead_id uuid not null references public.sales_leads(id),
 channel_id uuid not null references public.sales_acquisition_channels(id),
 assigned_at timestamptz not null default clock_timestamp(),
 assigned_by uuid not null references public.users(id),
 primary key(lead_id,channel_id)
);
create index sales_lead_acquisition_channels_channel_idx
 on public.sales_lead_acquisition_channels(channel_id,lead_id);
alter table public.sales_lead_acquisition_channels enable row level security;
revoke all on public.sales_lead_acquisition_channels from public,anon,authenticated;
grant select,insert,delete on public.sales_lead_acquisition_channels to service_role;

insert into public.sales_acquisition_channels(name)
values('Evento'),('Tráfego pago'),('Indicação') on conflict do nothing;

create or replace function public.save_sales_lead_acquisition_channels_v1(
 p_lead_id uuid,p_actor_user_id uuid,p_channel_ids uuid[],p_action_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 v_lead public.sales_leads%rowtype;
 v_previous jsonb;
 v_ids uuid[];
 v_hash text;
 v_result jsonb;
 v_event_key text:='sales-acquisition:'||p_action_key;
begin
 if p_actor_user_id is null or not exists(
   select 1 from public.platform_admins where user_id=p_actor_user_id and active=true)
 then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
 if p_lead_id is null or p_channel_ids is null or p_action_key is null or
    char_length(p_action_key) not between 12 and 120 or
    coalesce(array_length(p_channel_ids,1),0)>20 or array_position(p_channel_ids,null) is not null
 then raise exception 'INVALID_ACQUISITION_SELECTION'; end if;
 select * into v_lead from public.sales_leads
 where id=p_lead_id and deleted_at is null for update;
 if not found or exists(select 1 from public.sales_kanban_opportunity_overrides
   where lead_id=p_lead_id and hidden_at is not null)
 then raise exception 'LEAD_NOT_FOUND'; end if;
 select coalesce(array_agg(x order by x),'{}'::uuid[]) into v_ids
 from (select distinct unnest(p_channel_ids) as x) dedup;
 v_hash:=md5(p_lead_id::text||'|'||p_actor_user_id::text||'|'||v_ids::text);
 select metadata into v_previous from public.sales_lead_events where idempotency_key=v_event_key;
 if found then
   if v_previous->>'hash' is distinct from v_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 else
   if exists(
      select 1 from unnest(v_ids) requested(id)
      left join public.sales_acquisition_channels ch on ch.id=requested.id
      left join public.sales_lead_acquisition_channels linked
       on linked.lead_id=p_lead_id and linked.channel_id=requested.id
      where ch.id is null or (ch.is_active=false and linked.channel_id is null)
   ) then raise exception 'ACQUISITION_CHANNEL_UNAVAILABLE'; end if;
   delete from public.sales_lead_acquisition_channels
    where lead_id=p_lead_id and channel_id<>all(v_ids);
   insert into public.sales_lead_acquisition_channels(lead_id,channel_id,assigned_by)
    select p_lead_id,x,p_actor_user_id from unnest(v_ids) as x
    on conflict(lead_id,channel_id) do nothing;
   insert into public.sales_lead_events(lead_id,event_type,actor_user_id,metadata,idempotency_key)
   values(p_lead_id,'lead_updated',p_actor_user_id,
     jsonb_build_object('source','owner_kanban','action','acquisition_channels_saved',
       'channelIds',to_jsonb(v_ids),'hash',v_hash),v_event_key);
 end if;
 select coalesce(jsonb_agg(channel_id order by channel_id),'[]'::jsonb)
 into v_result from public.sales_lead_acquisition_channels where lead_id=p_lead_id;
 return jsonb_build_object('leadId',p_lead_id,'channelIds',v_result);
end $$;

create or replace function public.sales_acquisition_channel_metrics_v1(
 p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_metrics jsonb;
begin
 if p_actor_user_id is null or not exists(
   select 1 from public.platform_admins where user_id=p_actor_user_id and active=true)
 then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
 select coalesce(jsonb_agg(to_jsonb(m) order by m.opportunities desc,m.name),'[]'::jsonb)
 into v_metrics from (
   select c.id,c.name,c.is_active,
      count(l.id)::int as opportunities,
      count(l.id) filter(where l.status='converted')::int as converted,
      count(l.id) filter(where l.status='lost')::int as lost,
      count(l.id) filter(where exists(
        select 1 from public.sales_prospecting_attempts a
        where a.lead_id=l.id and a.outcome='decisor_spoken'))::int as decision_contacts,
      count(l.id) filter(where exists(
        select 1 from public.sales_prospecting_attempts a
        where a.lead_id=l.id and a.contact_result='interested'))::int as interested_leads
   from public.sales_acquisition_channels c
   left join public.sales_lead_acquisition_channels sel on sel.channel_id=c.id
   left join public.sales_leads l on l.id=sel.lead_id and l.deleted_at is null
   group by c.id,c.name,c.is_active
 ) m;
 return v_metrics;
end $$;

revoke all on function public.save_sales_lead_acquisition_channels_v1(uuid,uuid,uuid[],text)
 from public,anon,authenticated;
revoke all on function public.sales_acquisition_channel_metrics_v1(uuid)
 from public,anon,authenticated;
grant execute on function public.save_sales_lead_acquisition_channels_v1(uuid,uuid,uuid[],text) to service_role;
grant execute on function public.sales_acquisition_channel_metrics_v1(uuid) to service_role;
notify pgrst,'reload schema';
commit;
