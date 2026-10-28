-- Authenticated, paginated drill-down for owner commercial analytics.
-- Mirrors source metrics: stages are all current non-deleted leads; call charts
-- use only calls in the selected window; messages never count as calls.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function public.sales_prospecting_drilldown_v1(
  p_actor_user_id uuid,p_days integer,p_dimension text,p_value text,
  p_measure text,p_offset integer default 0,p_limit integer default 25
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 v_since timestamptz;
 v_total bigint:=0;
 v_events bigint:=0;
 v_rows jsonb:='[]'::jsonb;
begin
 if p_actor_user_id is null or not exists(
    select 1 from public.platform_admins where user_id=p_actor_user_id and active=true
 ) then raise exception 'PLATFORM_ADMIN_REQUIRED';end if;
 if p_days not in(7,30,90,365) or p_dimension not in
   ('stage','overview','daily','cumulative','hour','weekday','channel','attempt')
    or p_measure not in('leads','calls','conversations','failures','messages','attempted')
    or p_offset is null or p_offset<0 or p_offset>100000
    or p_limit is null or p_limit<1 or p_limit>50
    or p_value is null or char_length(p_value)>40
 then raise exception 'INVALID_DRILLDOWN_FILTER';end if;
 v_since:=now()-make_interval(days=>p_days);

 if p_dimension='stage' or
   (p_dimension='overview' and p_value in ('all','converted','lost')) then
   if p_dimension='stage' and p_value not in(
     'new','contact_started','demo_scheduled','demo_completed','proposal_preparing',
     'proposal_sent','checkout_sent','checkout_opened','payment_pending','converted','lost','archived'
   ) then raise exception 'INVALID_DRILLDOWN_FILTER';end if;
   select count(*) into v_total from public.sales_leads l where l.deleted_at is null
     and (p_value='all' and p_dimension='overview' or l.status::text=p_value);
   select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc,x.id),'[]'::jsonb)
     into v_rows from (
       select l.id,l.name,l.clinic_name,l.phone,l.email,l.status::text as status,
          l.created_at,l.updated_at,l.last_contact_at,
          l.converted_clinic_id,l.converted_user_id,0::bigint as matching_events
       from public.sales_leads l where l.deleted_at is null
        and (p_value='all' and p_dimension='overview' or l.status::text=p_value)
       order by l.updated_at desc,l.id limit p_limit offset p_offset
     ) x;
   return jsonb_build_object('totalLeads',v_total,'matchingEvents',v_total,
     'items',v_rows,'offset',p_offset,'limit',p_limit);
 end if;
 if p_dimension='overview' and p_value not in(
   'attempted','calls','contacted','messages','call_contacted')
 then raise exception 'INVALID_DRILLDOWN_FILTER';end if;
 if p_dimension='channel' and p_value not in('phone','whatsapp_call')
 then raise exception 'INVALID_DRILLDOWN_FILTER';end if;
 if p_dimension in('daily','cumulative') and
   (p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or
    p_value<'2020-01-01' or p_value>'2100-12-31')
 then raise exception 'INVALID_DRILLDOWN_FILTER';end if;
 if p_dimension='hour' and (p_value !~ '^[0-9]{1,2}$' or (case when p_value ~ '^[0-9]+$' then p_value::int else -1 end) not between 0 and 23)
 then raise exception 'INVALID_DRILLDOWN_FILTER';end if;
 if p_dimension='weekday' and (p_value !~ '^[1-7]$')
 then raise exception 'INVALID_DRILLDOWN_FILTER';end if;
 if p_dimension='attempt' and (p_value !~ '^([1-9]|10)$')
 then raise exception 'INVALID_DRILLDOWN_FILTER';end if;

 with scoped as (
   select a.id,a.lead_id,a.channel,a.outcome,a.occurred_at,
     row_number() over(partition by a.lead_id order by a.occurred_at,a.id)::int as attempt_number
   from public.sales_prospecting_attempts a where a.occurred_at>=v_since
     and (p_dimension='overview' and p_value in('contacted','messages')
       or a.channel in('phone','whatsapp_call'))
 ),
 matches as (
   select a.* from scoped a where
     (p_dimension='overview' and (
        p_value='attempted' and a.channel<>'whatsapp_message' or
        p_value='calls' and a.channel<>'whatsapp_message' or
        p_value='messages' and a.channel='whatsapp_message' or
        p_value='contacted' and a.outcome='decisor_spoken' or
        p_value='call_contacted' and a.channel<>'whatsapp_message' and a.outcome='decisor_spoken'
      ) or
      p_dimension='daily' and to_char(a.occurred_at at time zone 'America/Sao_Paulo','YYYY-MM-DD')=p_value or
      p_dimension='cumulative' and to_char(a.occurred_at at time zone 'America/Sao_Paulo','YYYY-MM-DD')<=p_value or
      p_dimension='hour' and extract(hour from a.occurred_at at time zone 'America/Sao_Paulo')::int=(case when p_value ~ '^[0-9]+$' then p_value::int else -1 end) or
      p_dimension='weekday' and extract(isodow from a.occurred_at at time zone 'America/Sao_Paulo')::int=(case when p_value ~ '^[0-9]+$' then p_value::int else -1 end) or
      p_dimension='channel' and a.channel=p_value or
      p_dimension='attempt' and a.attempt_number=(case when p_value ~ '^[0-9]+$' then p_value::int else -1 end))
     and (p_measure='calls' or p_measure='leads' or
       p_measure='attempted' and a.channel<>'whatsapp_message' or
       p_measure='messages' and a.channel='whatsapp_message' or
       p_measure='conversations' and a.outcome='decisor_spoken' or
       p_measure='failures' and a.outcome='no_decisor')
 ),
 grouped as (
   select l.id,l.name,l.clinic_name,l.phone,l.email,l.status::text as status,
     l.created_at,l.updated_at,l.last_contact_at,
     l.converted_clinic_id,l.converted_user_id,
     count(*)::bigint as matching_events,max(m.occurred_at) as matched_at
   from matches m join public.sales_leads l on l.id=m.lead_id
   where l.deleted_at is null group by l.id
 ),
 totals as (
   select count(*)::bigint leads,coalesce(sum(matching_events),0)::bigint events from grouped
 ),
 page as (
   select * from grouped order by matched_at desc,id limit p_limit offset p_offset
 )
 select totals.leads,totals.events,
   coalesce((select jsonb_agg(to_jsonb(page) order by page.matched_at desc,page.id) from page),'[]'::jsonb)
 into v_total,v_events,v_rows from totals;
 return jsonb_build_object('totalLeads',v_total,'matchingEvents',v_events,
   'items',v_rows,'offset',p_offset,'limit',p_limit);
end $$;

revoke all on function public.sales_prospecting_drilldown_v1(uuid,integer,text,text,text,integer,integer)
 from public,anon,authenticated;
grant execute on function public.sales_prospecting_drilldown_v1(uuid,integer,text,text,text,integer,integer)
 to service_role;
notify pgrst,'reload schema';
commit;
