-- Align commercial analytics with the same visibility authority used by the owner Kanban.

-- Hidden converted leads retain canonical client/payment/offer data but must be excluded from live CRM metrics.

-- No UPDATE/DELETE to client records, payments, proposals or lead history.

begin;

set local lock_timeout='5s';

set local statement_timeout='60s';

-- sales_acquisition_channel_metrics_v1
CREATE OR REPLACE FUNCTION public.sales_acquisition_channel_metrics_v1(p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
   left join public.sales_leads l on l.id=sel.lead_id and l.deleted_at is null and not exists (select 1 from public.sales_kanban_opportunity_overrides hidden where hidden.lead_id=l.id and hidden.hidden_at is not null)
   group by c.id,c.name,c.is_active
 ) m;
 return v_metrics;
end $function$;

-- sales_prospecting_analytics_v1
CREATE OR REPLACE FUNCTION public.sales_prospecting_analytics_v1(p_days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_since timestamptz;
  v_overview jsonb;
  v_daily jsonb;
  v_hours jsonb;
  v_weekdays jsonb;
  v_channels jsonb;
  v_attempts jsonb;
  v_stages jsonb;
begin
  if p_days not in (7,30,90,365) then raise exception 'INVALID_ANALYTICS_WINDOW'; end if;
  v_since := now() - make_interval(days=>p_days);
  with scoped as (
    select lead_id,channel,outcome,occurred_at from public.sales_prospecting_attempts event
    where event.occurred_at >= v_since and exists (select 1 from public.sales_leads visible_lead where visible_lead.id=event.lead_id and visible_lead.deleted_at is null and not exists (select 1 from public.sales_kanban_opportunity_overrides hidden where hidden.lead_id=visible_lead.id and hidden.hidden_at is not null))
  )
  select jsonb_build_object(
    'totalLeads',(select count(*) from public.sales_leads visible_lead where visible_lead.deleted_at is null and not exists (select 1 from public.sales_kanban_opportunity_overrides hidden where hidden.lead_id=visible_lead.id and hidden.hidden_at is not null)),
    'attemptedLeads',(select count(distinct lead_id) from scoped where channel<>'whatsapp_message'),
    'contactedLeads',(select count(distinct lead_id) from scoped where outcome='decisor_spoken'),
    'callContactedLeads',(select count(distinct lead_id) from scoped where outcome='decisor_spoken' and channel<>'whatsapp_message'),
    'messageContacts',(select count(*) from scoped where outcome='decisor_spoken' and channel='whatsapp_message'),
    'totalCalls',(select count(*) from scoped where channel<>'whatsapp_message'),
    'successfulCalls',(select count(*) from scoped where outcome='decisor_spoken' and channel<>'whatsapp_message'),
    'convertedLeads',(select count(*) from public.sales_leads visible_lead where visible_lead.deleted_at is null and not exists (select 1 from public.sales_kanban_opportunity_overrides hidden where hidden.lead_id=visible_lead.id and hidden.hidden_at is not null) and status='converted'),
    'lostLeads',(select count(*) from public.sales_leads visible_lead where visible_lead.deleted_at is null and not exists (select 1 from public.sales_kanban_opportunity_overrides hidden where hidden.lead_id=visible_lead.id and hidden.hidden_at is not null) and status='lost')
  ) into v_overview;
  select coalesce(jsonb_agg(jsonb_build_object('day',day_bucket,'calls',calls,'conversations',conversations) order by day_bucket),'[]'::jsonb)
    into v_daily from (
      select to_char(occurred_at at time zone 'America/Sao_Paulo','YYYY-MM-DD') as day_bucket,
        count(*) calls,count(*) filter(where outcome='decisor_spoken') conversations
      from public.sales_prospecting_attempts event where event.occurred_at >= v_since and event.channel<>'whatsapp_message' and exists (select 1 from public.sales_leads visible_lead where visible_lead.id=event.lead_id and visible_lead.deleted_at is null and not exists (select 1 from public.sales_kanban_opportunity_overrides hidden where hidden.lead_id=visible_lead.id and hidden.hidden_at is not null)) group by 1
    ) x;
  select coalesce(jsonb_agg(jsonb_build_object('hour',hour_bucket,'calls',calls,'conversations',conversations) order by hour_bucket),'[]'::jsonb)
    into v_hours from (
      select extract(hour from occurred_at at time zone 'America/Sao_Paulo')::int as hour_bucket,
        count(*) calls,count(*) filter(where outcome='decisor_spoken') conversations
      from public.sales_prospecting_attempts event where event.occurred_at >= v_since and event.channel<>'whatsapp_message' and exists (select 1 from public.sales_leads visible_lead where visible_lead.id=event.lead_id and visible_lead.deleted_at is null and not exists (select 1 from public.sales_kanban_opportunity_overrides hidden where hidden.lead_id=visible_lead.id and hidden.hidden_at is not null)) group by 1
    ) x;
  select coalesce(jsonb_agg(jsonb_build_object('weekday',weekday_bucket,'calls',calls,'conversations',conversations) order by weekday_bucket),'[]'::jsonb)
    into v_weekdays from (
      select extract(isodow from occurred_at at time zone 'America/Sao_Paulo')::int as weekday_bucket,
        count(*) calls,count(*) filter(where outcome='decisor_spoken') conversations
      from public.sales_prospecting_attempts event where event.occurred_at >= v_since and event.channel<>'whatsapp_message' and exists (select 1 from public.sales_leads visible_lead where visible_lead.id=event.lead_id and visible_lead.deleted_at is null and not exists (select 1 from public.sales_kanban_opportunity_overrides hidden where hidden.lead_id=visible_lead.id and hidden.hidden_at is not null)) group by 1
    ) x;
  select coalesce(jsonb_agg(jsonb_build_object('channel',channel,'calls',calls,'conversations',conversations) order by channel),'[]'::jsonb)
    into v_channels from (
      select channel,count(*) calls,count(*) filter(where outcome='decisor_spoken') conversations
      from public.sales_prospecting_attempts event where event.occurred_at >= v_since and event.channel<>'whatsapp_message' and exists (select 1 from public.sales_leads visible_lead where visible_lead.id=event.lead_id and visible_lead.deleted_at is null and not exists (select 1 from public.sales_kanban_opportunity_overrides hidden where hidden.lead_id=visible_lead.id and hidden.hidden_at is not null)) group by channel
    ) x;
  select coalesce(jsonb_agg(jsonb_build_object('attempt',attempt_no,'calls',calls,'conversations',conversations) order by attempt_no),'[]'::jsonb)
    into v_attempts from (
      select attempt_no,count(*) calls,count(*) filter(where outcome='decisor_spoken') conversations
      from (
        select row_number() over(partition by lead_id order by occurred_at,id)::int as attempt_no,outcome
        from public.sales_prospecting_attempts event where event.occurred_at >= v_since and event.channel<>'whatsapp_message' and exists (select 1 from public.sales_leads visible_lead where visible_lead.id=event.lead_id and visible_lead.deleted_at is null and not exists (select 1 from public.sales_kanban_opportunity_overrides hidden where hidden.lead_id=visible_lead.id and hidden.hidden_at is not null))
      ) y group by attempt_no
    ) x;
  select coalesce(jsonb_agg(jsonb_build_object('status',status_key,'leads',leads) order by status_key),'[]'::jsonb)
    into v_stages from (
      select status::text as status_key,count(*) leads
      from public.sales_leads visible_lead where visible_lead.deleted_at is null and not exists (select 1 from public.sales_kanban_opportunity_overrides hidden where hidden.lead_id=visible_lead.id and hidden.hidden_at is not null) group by status
    ) x;
  return jsonb_build_object('days',p_days,'overview',v_overview,'daily',v_daily,
    'hours',v_hours,'weekdays',v_weekdays,'channels',v_channels,'attempts',v_attempts,'stages',v_stages);
end $function$;

-- sales_prospecting_drilldown_v1
CREATE OR REPLACE FUNCTION public.sales_prospecting_drilldown_v1(p_actor_user_id uuid, p_days integer, p_dimension text, p_value text, p_measure text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
   select count(*) into v_total from public.sales_leads l where l.deleted_at is null and not exists (select 1 from public.sales_kanban_opportunity_overrides hidden where hidden.lead_id=l.id and hidden.hidden_at is not null)
     and (p_value='all' and p_dimension='overview' or l.status::text=p_value);
   select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc,x.id),'[]'::jsonb)
     into v_rows from (
       select l.id,l.name,l.clinic_name,l.phone,l.email,l.status::text as status,
          l.created_at,l.updated_at,l.last_contact_at,
          l.converted_clinic_id,l.converted_user_id,0::bigint as matching_events
       from public.sales_leads l where l.deleted_at is null and not exists (select 1 from public.sales_kanban_opportunity_overrides hidden where hidden.lead_id=l.id and hidden.hidden_at is not null)
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
   where l.deleted_at is null and not exists (select 1 from public.sales_kanban_opportunity_overrides hidden where hidden.lead_id=l.id and hidden.hidden_at is not null) group by l.id
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
end $function$;

-- sales_script_metrics_v1
CREATE OR REPLACE FUNCTION public.sales_script_metrics_v1(p_actor_user_id uuid, p_days integer DEFAULT 365)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_results jsonb;
begin
  if not exists(select 1 from public.platform_admins where user_id=p_actor_user_id and active=true)
    then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  if p_days not in (30,90,365,0) then raise exception 'INVALID_ANALYTICS_WINDOW'; end if;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.name,m.version_label),'[]'::jsonb)
    into v_results from (
    select s.id,s.name,s.version_label,s.is_active,
      count(a.id)::int as total_attempts,
      count(a.id) filter(where a.contact_result='no_answer')::int as no_answer,
      count(a.id) filter(where a.contact_result='not_interested')::int as not_interested,
      count(a.id) filter(where a.contact_result='interested')::int as interested,
      count(a.id) filter(where a.outcome='decisor_spoken')::int as decision_conversations,
      count(distinct a.lead_id) filter(where a.contact_result='interested')::int as interested_leads
    from public.sales_script_versions s
    left join public.sales_prospecting_attempts a on a.script_version_id=s.id and exists (select 1 from public.sales_leads l where l.id=a.lead_id and l.deleted_at is null and not exists (select 1 from public.sales_kanban_opportunity_overrides hidden where hidden.lead_id=l.id and hidden.hidden_at is not null))
      and (p_days=0 or a.occurred_at>=clock_timestamp()-make_interval(days=>p_days))
    group by s.id,s.name,s.version_label,s.is_active
  ) m;
  return v_results;
end $function$;

revoke all on function public.sales_prospecting_analytics_v1(integer) from public,anon,authenticated;

grant execute on function public.sales_prospecting_analytics_v1(integer) to service_role;

revoke all on function public.sales_prospecting_drilldown_v1(uuid,integer,text,text,text,integer,integer) from public,anon,authenticated;

grant execute on function public.sales_prospecting_drilldown_v1(uuid,integer,text,text,text,integer,integer) to service_role;

revoke all on function public.sales_acquisition_channel_metrics_v1(uuid) from public,anon,authenticated;

grant execute on function public.sales_acquisition_channel_metrics_v1(uuid) to service_role;

revoke all on function public.sales_script_metrics_v1(uuid,integer) from public,anon,authenticated;

grant execute on function public.sales_script_metrics_v1(uuid,integer) to service_role;

notify pgrst,'reload schema';

commit;

