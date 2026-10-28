-- Register WhatsApp text conversation as a successful, non-call contact.
-- Preserve old call limits, canonical financial/clinical data and notifications.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table public.sales_prospecting_attempts drop constraint sales_prospecting_attempts_channel_check;
alter table public.sales_prospecting_attempts add constraint sales_prospecting_attempts_channel_check
  check (channel in ('phone','whatsapp_call','whatsapp_message'));
alter table public.sales_prospecting_attempts add constraint sales_prospecting_attempts_message_success_only_check
  check (channel <> 'whatsapp_message' or outcome = 'decisor_spoken');

create or replace function public.save_sales_decisor_contact_v1(
  p_lead_id uuid, p_attempt_id uuid, p_channel text, p_occurred_at timestamptz,
  p_action_key text, p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_lead public.sales_leads%rowtype;
  v_attempt public.sales_prospecting_attempts%rowtype;
  v_event jsonb;
  v_old_at timestamptz;
  v_now timestamptz:=clock_timestamp();
  v_count integer;
  v_hash text;
  v_event_key text:='sales-decisor-time:'||p_action_key;
begin
  if p_lead_id is null or p_actor_user_id is null
    or not exists(select 1 from public.platform_admins where user_id=p_actor_user_id and active=true)
    then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  if p_channel not in ('phone','whatsapp_call','whatsapp_message')
    or p_action_key is null or char_length(p_action_key) not between 12 and 120
    or p_occurred_at is null or p_occurred_at < timestamptz '2020-01-01T00:00:00Z'
    or p_occurred_at > v_now then raise exception 'INVALID_CONTACT_TIME'; end if;
  -- Only phone calls follow the office-hours cadence. A text conversation can
  -- happen at any hour and is not a phone attempt.
  if p_channel <> 'whatsapp_message' and (
    extract(isodow from p_occurred_at at time zone 'America/Sao_Paulo') not between 1 and 5
    or (p_occurred_at at time zone 'America/Sao_Paulo')::time < time '09:00'
    or (p_occurred_at at time zone 'America/Sao_Paulo')::time > time '17:30')
    then raise exception 'PROSPECTING_OUTSIDE_BUSINESS_HOURS'; end if;
  select * into v_lead from public.sales_leads
    where id=p_lead_id and deleted_at is null for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;
  v_hash:=md5(coalesce(p_attempt_id::text,'new')||'|'||p_channel||'|'||
    p_occurred_at::text||'|'||p_actor_user_id::text);
  if p_attempt_id is not null then
    select * into v_attempt from public.sales_prospecting_attempts
      where id=p_attempt_id and lead_id=p_lead_id and outcome='decisor_spoken' for update;
    if not found or v_attempt.channel<>p_channel then raise exception 'CONTACT_NOT_FOUND'; end if;
    select metadata into v_event from public.sales_lead_events where idempotency_key=v_event_key;
    if found then
      if v_event->>'hash' is distinct from v_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      return jsonb_build_object('attemptId',v_attempt.id,'occurredAt',v_event->>'newAt',
        'channel',v_attempt.channel,'status',v_lead.status,'lostAt',v_lead.lost_at,
        'updatedAt',v_lead.updated_at,'corrected',true);
    end if;
    if p_channel <> 'whatsapp_message' and exists(select 1 from public.sales_prospecting_attempts
      where lead_id=p_lead_id and id<>p_attempt_id
      and (occurred_at at time zone 'America/Sao_Paulo')::date=
          (p_occurred_at at time zone 'America/Sao_Paulo')::date)
      then raise exception 'PROSPECTING_ALREADY_TODAY'; end if;
    v_old_at:=v_attempt.occurred_at;
    update public.sales_prospecting_attempts set occurred_at=p_occurred_at where id=p_attempt_id;
    if v_lead.last_contact_at is not distinct from v_old_at then
      update public.sales_leads set last_contact_at=p_occurred_at,updated_at=v_now
        where id=p_lead_id returning * into v_lead;
    end if;
    insert into public.sales_lead_events(lead_id,event_type,actor_user_id,metadata,idempotency_key)
    values(p_lead_id,'lead_updated',p_actor_user_id,
      jsonb_build_object('source','owner_kanban','action','decisor_time_corrected',
       'attemptId',p_attempt_id,'oldAt',v_old_at,'newAt',p_occurred_at,'hash',v_hash),v_event_key);
  else
    select * into v_attempt from public.sales_prospecting_attempts
      where idempotency_key=p_action_key;
    if found then
      if v_attempt.lead_id<>p_lead_id or v_attempt.actor_user_id is distinct from p_actor_user_id
        or v_attempt.channel<>p_channel or v_attempt.outcome<>'decisor_spoken'
        or v_attempt.occurred_at<>p_occurred_at then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      return jsonb_build_object('attemptId',v_attempt.id,'occurredAt',v_attempt.occurred_at,
        'channel',v_attempt.channel,'status',v_lead.status,'lostAt',v_lead.lost_at,
        'updatedAt',v_lead.updated_at,'corrected',false);
    end if;
    if v_lead.status in ('lost','archived','converted')
      or v_lead.converted_user_id is not null or v_lead.converted_clinic_id is not null
      or v_lead.do_not_contact then raise exception 'PROSPECTING_NOT_ALLOWED'; end if;
    if exists(select 1 from public.sales_prospecting_attempts
      where lead_id=p_lead_id and outcome='decisor_spoken')
      then raise exception 'DECISOR_ALREADY_CONTACTED'; end if;
    if p_channel <> 'whatsapp_message' and exists(select 1 from public.sales_prospecting_attempts
      where lead_id=p_lead_id
      and (occurred_at at time zone 'America/Sao_Paulo')::date=
        (p_occurred_at at time zone 'America/Sao_Paulo')::date)
      then raise exception 'PROSPECTING_ALREADY_TODAY'; end if;
    select count(*)::integer into v_count from public.sales_prospecting_attempts
      where lead_id=p_lead_id and channel=p_channel;
    if p_channel <> 'whatsapp_message' and v_count>=5
      then raise exception 'CHANNEL_ATTEMPT_LIMIT'; end if;
    insert into public.sales_prospecting_attempts(
      lead_id,actor_user_id,channel,outcome,idempotency_key,occurred_at)
    values(p_lead_id,p_actor_user_id,p_channel,'decisor_spoken',p_action_key,p_occurred_at)
    returning * into v_attempt;
    update public.sales_leads set
      status=case when status='new' then 'contact_started'::public.sales_lead_status else status end,
      last_contact_at=p_occurred_at,updated_at=v_now
      where id=p_lead_id returning * into v_lead;
    insert into public.sales_lead_events(lead_id,event_type,actor_user_id,metadata,idempotency_key)
    values(p_lead_id,'contact_started',p_actor_user_id,
      jsonb_build_object('channel',p_channel,'attempt_id',v_attempt.id,'occurredAt',p_occurred_at),
      'prospecting-contact:'||v_attempt.id::text);
  end if;
  return jsonb_build_object('attemptId',v_attempt.id,'occurredAt',p_occurred_at,
    'channel',v_attempt.channel,'status',v_lead.status,'lostAt',v_lead.lost_at,
    'updatedAt',v_lead.updated_at,'corrected',p_attempt_id is not null);
end $$;

create or replace function public.sales_prospecting_analytics_v1(p_days integer default 90)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
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
    select lead_id,channel,outcome,occurred_at from public.sales_prospecting_attempts
    where occurred_at >= v_since
  )
  select jsonb_build_object(
    'totalLeads',(select count(*) from public.sales_leads where deleted_at is null),
    'attemptedLeads',(select count(distinct lead_id) from scoped where channel<>'whatsapp_message'),
    'contactedLeads',(select count(distinct lead_id) from scoped where outcome='decisor_spoken'),
    'callContactedLeads',(select count(distinct lead_id) from scoped where outcome='decisor_spoken' and channel<>'whatsapp_message'),
    'messageContacts',(select count(*) from scoped where outcome='decisor_spoken' and channel='whatsapp_message'),
    'totalCalls',(select count(*) from scoped where channel<>'whatsapp_message'),
    'successfulCalls',(select count(*) from scoped where outcome='decisor_spoken' and channel<>'whatsapp_message'),
    'convertedLeads',(select count(*) from public.sales_leads where deleted_at is null and status='converted'),
    'lostLeads',(select count(*) from public.sales_leads where deleted_at is null and status='lost')
  ) into v_overview;
  select coalesce(jsonb_agg(jsonb_build_object('day',day_bucket,'calls',calls,'conversations',conversations) order by day_bucket),'[]'::jsonb)
    into v_daily from (
      select to_char(occurred_at at time zone 'America/Sao_Paulo','YYYY-MM-DD') as day_bucket,
        count(*) calls,count(*) filter(where outcome='decisor_spoken') conversations
      from public.sales_prospecting_attempts where occurred_at >= v_since and channel<>'whatsapp_message' group by 1
    ) x;
  select coalesce(jsonb_agg(jsonb_build_object('hour',hour_bucket,'calls',calls,'conversations',conversations) order by hour_bucket),'[]'::jsonb)
    into v_hours from (
      select extract(hour from occurred_at at time zone 'America/Sao_Paulo')::int as hour_bucket,
        count(*) calls,count(*) filter(where outcome='decisor_spoken') conversations
      from public.sales_prospecting_attempts where occurred_at >= v_since and channel<>'whatsapp_message' group by 1
    ) x;
  select coalesce(jsonb_agg(jsonb_build_object('weekday',weekday_bucket,'calls',calls,'conversations',conversations) order by weekday_bucket),'[]'::jsonb)
    into v_weekdays from (
      select extract(isodow from occurred_at at time zone 'America/Sao_Paulo')::int as weekday_bucket,
        count(*) calls,count(*) filter(where outcome='decisor_spoken') conversations
      from public.sales_prospecting_attempts where occurred_at >= v_since and channel<>'whatsapp_message' group by 1
    ) x;
  select coalesce(jsonb_agg(jsonb_build_object('channel',channel,'calls',calls,'conversations',conversations) order by channel),'[]'::jsonb)
    into v_channels from (
      select channel,count(*) calls,count(*) filter(where outcome='decisor_spoken') conversations
      from public.sales_prospecting_attempts where occurred_at >= v_since and channel<>'whatsapp_message' group by channel
    ) x;
  select coalesce(jsonb_agg(jsonb_build_object('attempt',attempt_no,'calls',calls,'conversations',conversations) order by attempt_no),'[]'::jsonb)
    into v_attempts from (
      select attempt_no,count(*) calls,count(*) filter(where outcome='decisor_spoken') conversations
      from (
        select row_number() over(partition by lead_id order by occurred_at,id)::int as attempt_no,outcome
        from public.sales_prospecting_attempts where occurred_at >= v_since and channel<>'whatsapp_message'
      ) y group by attempt_no
    ) x;
  select coalesce(jsonb_agg(jsonb_build_object('status',status_key,'leads',leads) order by status_key),'[]'::jsonb)
    into v_stages from (
      select status::text as status_key,count(*) leads
      from public.sales_leads where deleted_at is null group by status
    ) x;
  return jsonb_build_object('days',p_days,'overview',v_overview,'daily',v_daily,
    'hours',v_hours,'weekdays',v_weekdays,'channels',v_channels,'attempts',v_attempts,'stages',v_stages);
end $$;

revoke all on function public.save_sales_decisor_contact_v1(uuid,uuid,text,timestamptz,text,uuid)
  from public,anon,authenticated;
revoke all on function public.sales_prospecting_analytics_v1(integer)
  from public,anon,authenticated;
grant execute on function public.save_sales_decisor_contact_v1(uuid,uuid,text,timestamptz,text,uuid)
  to service_role;
grant execute on function public.sales_prospecting_analytics_v1(integer)
  to service_role;
notify pgrst,'reload schema';
commit;
