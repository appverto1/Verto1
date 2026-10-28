-- Maintain owner call logging through every Kanban column and status, including past conversions.

-- Keep do-not-contact, hidden/deleted, business-date validity, uniqueness per day, audit and idempotency.

-- Ten calls are a cadence suggestion, not a reason to disable recording.

begin;

set local lock_timeout='5s';

set local statement_timeout='60s';

CREATE OR REPLACE FUNCTION public.record_sales_prospecting_attempt_v1(p_lead_id uuid, p_channel text, p_outcome text, p_action_key text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    if v_lead.do_not_contact or exists(
      select 1 from public.sales_kanban_opportunity_overrides h
      where h.lead_id=p_lead_id and h.hidden_at is not null
    ) then
      raise exception 'PROSPECTING_NOT_ALLOWED';
    end if;
    -- All ten attempts must be on separate local business dates and inside a reasonable window.
    if extract(isodow from v_at at time zone 'America/Sao_Paulo') not between 1 and 5
       or (v_at at time zone 'America/Sao_Paulo')::time < time '09:00'
       or (v_at at time zone 'America/Sao_Paulo')::time > time '17:30' then
      raise exception 'PROSPECTING_OUTSIDE_BUSINESS_HOURS';
    end if;
    if exists(select 1 from public.sales_prospecting_attempts
      where lead_id=p_lead_id
        and (occurred_at at time zone 'America/Sao_Paulo')::date =
            (v_at at time zone 'America/Sao_Paulo')::date) then
      raise exception 'PROSPECTING_ALREADY_TODAY';
    end if;
    select count(*) filter(where channel='phone')::integer,
           count(*) filter(where channel='whatsapp_call')::integer
      into v_phone,v_whatsapp
    from public.sales_prospecting_attempts where lead_id = p_lead_id;
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
  -- The ten-call cadence is a visual guideline, never a recording limit.
  return jsonb_build_object(
    'attemptId',v_attempt_id,'occurredAt',v_at,'status',v_lead.status,
    'lostAt',v_lead.lost_at,'updatedAt',v_lead.updated_at,
    'total',v_total,'needsLossDecision',(v_total = 10 and not v_reached),'phone',v_phone,'whatsappCall',v_whatsapp,'reachedDecisor',v_reached
  );
end $function$;

CREATE OR REPLACE FUNCTION public.save_sales_decisor_contact_v2(p_lead_id uuid, p_attempt_id uuid, p_channel text, p_occurred_at timestamp with time zone, p_action_key text, p_actor_user_id uuid, p_script_version_id uuid, p_contact_result text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  if p_attempt_id is null and p_contact_result not in ('interested','not_interested') then raise exception 'INVALID_CONTACT_RESULT'; end if;
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
    p_occurred_at::text||'|'||p_actor_user_id::text||'|'||coalesce(p_script_version_id::text,'none')||'|'||coalesce(p_contact_result,'none'));
  if p_attempt_id is not null then
    select * into v_attempt from public.sales_prospecting_attempts
      where id=p_attempt_id and lead_id=p_lead_id and outcome='decisor_spoken' for update;
    if not found or v_attempt.channel<>p_channel or v_attempt.script_version_id is distinct from p_script_version_id or v_attempt.contact_result is distinct from p_contact_result then raise exception 'CONTACT_NOT_FOUND'; end if;
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
        or v_attempt.occurred_at<>p_occurred_at or v_attempt.script_version_id is distinct from p_script_version_id or v_attempt.contact_result is distinct from p_contact_result then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      return jsonb_build_object('attemptId',v_attempt.id,'occurredAt',v_attempt.occurred_at,
        'channel',v_attempt.channel,'status',v_lead.status,'lostAt',v_lead.lost_at,
        'updatedAt',v_lead.updated_at,'corrected',false);
    end if;
    if v_lead.do_not_contact or exists(
      select 1 from public.sales_kanban_opportunity_overrides h
      where h.lead_id=p_lead_id and h.hidden_at is not null
    ) then raise exception 'PROSPECTING_NOT_ALLOWED'; end if;
    if p_channel <> 'whatsapp_message' and exists(select 1 from public.sales_prospecting_attempts
      where lead_id=p_lead_id
      and (occurred_at at time zone 'America/Sao_Paulo')::date=
        (p_occurred_at at time zone 'America/Sao_Paulo')::date)
      then raise exception 'PROSPECTING_ALREADY_TODAY'; end if;
    select count(*)::integer into v_count from public.sales_prospecting_attempts
      where lead_id=p_lead_id and channel=p_channel;
    insert into public.sales_prospecting_attempts(
      lead_id,actor_user_id,channel,outcome,idempotency_key,occurred_at,script_version_id,contact_result)
    values(p_lead_id,p_actor_user_id,p_channel,'decisor_spoken',p_action_key,p_occurred_at,p_script_version_id,p_contact_result)
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
    'updatedAt',v_lead.updated_at,'scriptVersionId',v_attempt.script_version_id,'contactResult',v_attempt.contact_result,'corrected',p_attempt_id is not null);
end $function$;

CREATE OR REPLACE FUNCTION public.save_sales_prospecting_attempt_time_v1(p_lead_id uuid, p_attempt_id uuid, p_channel text, p_occurred_at timestamp with time zone, p_action_key text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 v_lead public.sales_leads%rowtype;
 v_attempt public.sales_prospecting_attempts%rowtype;
 v_previous jsonb;
 v_old_at timestamptz;
 v_now timestamptz:=clock_timestamp();
 v_phone int;v_whatsapp int;v_total int;v_reached boolean;
 v_hash text;v_event_key text:='sales-attempt-time:'||p_action_key;
begin
 if p_actor_user_id is null or p_lead_id is null or
   not exists(select 1 from public.platform_admins where user_id=p_actor_user_id and active=true)
 then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
 if p_channel not in ('phone','whatsapp_call')
  or p_action_key is null or char_length(p_action_key) not between 12 and 120
  or p_occurred_at is null or p_occurred_at < timestamptz '2020-01-01T00:00:00Z'
  or p_occurred_at > v_now then raise exception 'INVALID_ATTEMPT_TIME'; end if;
 if extract(isodow from p_occurred_at at time zone 'America/Sao_Paulo') not between 1 and 5
  or (p_occurred_at at time zone 'America/Sao_Paulo')::time < time '09:00'
  or (p_occurred_at at time zone 'America/Sao_Paulo')::time > time '17:30'
 then raise exception 'PROSPECTING_OUTSIDE_BUSINESS_HOURS'; end if;
 select * into v_lead from public.sales_leads where id=p_lead_id and deleted_at is null for update;
 if not found then raise exception 'LEAD_NOT_FOUND'; end if;
 v_hash:=md5(coalesce(p_attempt_id::text,'new')||'|'||p_channel||'|'||
     p_occurred_at::text||'|'||p_actor_user_id::text);
 if p_attempt_id is not null then
   select * into v_attempt from public.sales_prospecting_attempts
   where id=p_attempt_id and lead_id=p_lead_id and outcome='no_decisor' for update;
   if not found or v_attempt.channel<>p_channel then raise exception 'ATTEMPT_NOT_FOUND'; end if;
   select metadata into v_previous from public.sales_lead_events where idempotency_key=v_event_key;
   if found then
     if v_previous->>'hash' is distinct from v_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
     return jsonb_build_object('attemptId',v_attempt.id,'occurredAt',v_previous->>'newAt',
       'status',v_lead.status,'lostAt',v_lead.lost_at,'updatedAt',v_lead.updated_at,'corrected',true);
   end if;
   if exists(select 1 from public.sales_prospecting_attempts
     where lead_id=p_lead_id and id<>p_attempt_id and channel in ('phone','whatsapp_call')
       and (occurred_at at time zone 'America/Sao_Paulo')::date=
           (p_occurred_at at time zone 'America/Sao_Paulo')::date)
   then raise exception 'PROSPECTING_ALREADY_TODAY'; end if;
   v_old_at:=v_attempt.occurred_at;
   update public.sales_prospecting_attempts set occurred_at=p_occurred_at where id=p_attempt_id;
   insert into public.sales_lead_events(lead_id,event_type,actor_user_id,metadata,idempotency_key)
   values(p_lead_id,'lead_updated',p_actor_user_id,
     jsonb_build_object('source','owner_kanban','action','attempt_time_corrected',
      'attemptId',p_attempt_id,'oldAt',v_old_at,'newAt',p_occurred_at,'hash',v_hash),v_event_key);
 else
   select * into v_attempt from public.sales_prospecting_attempts where idempotency_key=p_action_key;
   if found then
     if v_attempt.lead_id<>p_lead_id or v_attempt.channel<>p_channel
       or v_attempt.outcome<>'no_decisor'
       or v_attempt.actor_user_id is distinct from p_actor_user_id
       or v_attempt.occurred_at<>p_occurred_at
     then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
     return jsonb_build_object('attemptId',v_attempt.id,'occurredAt',v_attempt.occurred_at,
       'status',v_lead.status,'lostAt',v_lead.lost_at,'updatedAt',v_lead.updated_at,'corrected',false);
   end if;
   if v_lead.do_not_contact or exists(
       select 1 from public.sales_kanban_opportunity_overrides h
       where h.lead_id=p_lead_id and h.hidden_at is not null
     ) then raise exception 'PROSPECTING_NOT_ALLOWED'; end if;
   if exists(select 1 from public.sales_prospecting_attempts
     where lead_id=p_lead_id and channel in ('phone','whatsapp_call')
       and (occurred_at at time zone 'America/Sao_Paulo')::date=
           (p_occurred_at at time zone 'America/Sao_Paulo')::date)
   then raise exception 'PROSPECTING_ALREADY_TODAY'; end if;
   select count(*) filter(where channel='phone')::int,
          count(*) filter(where channel='whatsapp_call')::int
     into v_phone,v_whatsapp from public.sales_prospecting_attempts where lead_id=p_lead_id;
   insert into public.sales_prospecting_attempts(
     lead_id,actor_user_id,channel,outcome,idempotency_key,occurred_at)
   values(p_lead_id,p_actor_user_id,p_channel,'no_decisor',p_action_key,p_occurred_at)
   returning * into v_attempt;
 end if;
 select count(*) filter(where channel='phone')::int,
        count(*) filter(where channel='whatsapp_call')::int,
        count(*) filter(where channel in ('phone','whatsapp_call'))::int,
        coalesce(bool_or(outcome='decisor_spoken'),false)
 into v_phone,v_whatsapp,v_total,v_reached
 from public.sales_prospecting_attempts where lead_id=p_lead_id;
 return jsonb_build_object('attemptId',v_attempt.id,'occurredAt',p_occurred_at,
   'status',v_lead.status,'lostAt',v_lead.lost_at,'updatedAt',v_lead.updated_at,
   'total',v_total,'needsLossDecision',(v_total=10 and not v_reached),
   'phone',v_phone,'whatsappCall',v_whatsapp,'reachedDecisor',v_reached,
   'corrected',p_attempt_id is not null);
end $function$;

CREATE OR REPLACE FUNCTION public.save_sales_prospecting_attempt_time_v2(p_lead_id uuid, p_attempt_id uuid, p_channel text, p_occurred_at timestamp with time zone, p_action_key text, p_actor_user_id uuid, p_script_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 v_lead public.sales_leads%rowtype;
 v_attempt public.sales_prospecting_attempts%rowtype;
 v_previous jsonb;
 v_old_at timestamptz;
 v_now timestamptz:=clock_timestamp();
 v_phone int;v_whatsapp int;v_total int;v_reached boolean;
 v_hash text;v_event_key text:='sales-attempt-time:'||p_action_key;
begin
 if p_actor_user_id is null or p_lead_id is null or
   not exists(select 1 from public.platform_admins where user_id=p_actor_user_id and active=true)
 then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
 if p_channel not in ('phone','whatsapp_call')
  or p_action_key is null or char_length(p_action_key) not between 12 and 120
  or p_occurred_at is null or p_occurred_at < timestamptz '2020-01-01T00:00:00Z'
  or p_occurred_at > v_now then raise exception 'INVALID_ATTEMPT_TIME'; end if;
 if extract(isodow from p_occurred_at at time zone 'America/Sao_Paulo') not between 1 and 5
  or (p_occurred_at at time zone 'America/Sao_Paulo')::time < time '09:00'
  or (p_occurred_at at time zone 'America/Sao_Paulo')::time > time '17:30'
 then raise exception 'PROSPECTING_OUTSIDE_BUSINESS_HOURS'; end if;
 select * into v_lead from public.sales_leads where id=p_lead_id and deleted_at is null for update;
 if not found then raise exception 'LEAD_NOT_FOUND'; end if;
 v_hash:=md5(coalesce(p_attempt_id::text,'new')||'|'||p_channel||'|'||
     p_occurred_at::text||'|'||p_actor_user_id::text||'|'||coalesce(p_script_version_id::text,'none'));
 if p_attempt_id is not null then
   select * into v_attempt from public.sales_prospecting_attempts
   where id=p_attempt_id and lead_id=p_lead_id and outcome='no_decisor' for update;
   if not found or v_attempt.channel<>p_channel or v_attempt.script_version_id is distinct from p_script_version_id then raise exception 'ATTEMPT_NOT_FOUND'; end if;
   select metadata into v_previous from public.sales_lead_events where idempotency_key=v_event_key;
   if found then
     if v_previous->>'hash' is distinct from v_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
     return jsonb_build_object('attemptId',v_attempt.id,'occurredAt',v_previous->>'newAt',
       'status',v_lead.status,'lostAt',v_lead.lost_at,'updatedAt',v_lead.updated_at,'corrected',true);
   end if;
   if exists(select 1 from public.sales_prospecting_attempts
     where lead_id=p_lead_id and id<>p_attempt_id and channel in ('phone','whatsapp_call')
       and (occurred_at at time zone 'America/Sao_Paulo')::date=
           (p_occurred_at at time zone 'America/Sao_Paulo')::date)
   then raise exception 'PROSPECTING_ALREADY_TODAY'; end if;
   v_old_at:=v_attempt.occurred_at;
   update public.sales_prospecting_attempts set occurred_at=p_occurred_at where id=p_attempt_id;
   insert into public.sales_lead_events(lead_id,event_type,actor_user_id,metadata,idempotency_key)
   values(p_lead_id,'lead_updated',p_actor_user_id,
     jsonb_build_object('source','owner_kanban','action','attempt_time_corrected',
      'attemptId',p_attempt_id,'oldAt',v_old_at,'newAt',p_occurred_at,'hash',v_hash),v_event_key);
 else
   select * into v_attempt from public.sales_prospecting_attempts where idempotency_key=p_action_key;
   if found then
     if v_attempt.lead_id<>p_lead_id or v_attempt.channel<>p_channel
       or v_attempt.outcome<>'no_decisor'
       or v_attempt.actor_user_id is distinct from p_actor_user_id
       or v_attempt.occurred_at<>p_occurred_at or v_attempt.script_version_id is distinct from p_script_version_id
     then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
     return jsonb_build_object('attemptId',v_attempt.id,'occurredAt',v_attempt.occurred_at,
       'status',v_lead.status,'lostAt',v_lead.lost_at,'updatedAt',v_lead.updated_at,'corrected',false);
   end if;
   if v_lead.do_not_contact or exists(
       select 1 from public.sales_kanban_opportunity_overrides h
       where h.lead_id=p_lead_id and h.hidden_at is not null
     ) then raise exception 'PROSPECTING_NOT_ALLOWED'; end if;
   if exists(select 1 from public.sales_prospecting_attempts
     where lead_id=p_lead_id and channel in ('phone','whatsapp_call')
       and (occurred_at at time zone 'America/Sao_Paulo')::date=
           (p_occurred_at at time zone 'America/Sao_Paulo')::date)
   then raise exception 'PROSPECTING_ALREADY_TODAY'; end if;
   select count(*) filter(where channel='phone')::int,
          count(*) filter(where channel='whatsapp_call')::int
     into v_phone,v_whatsapp from public.sales_prospecting_attempts where lead_id=p_lead_id;
   insert into public.sales_prospecting_attempts(
     lead_id,actor_user_id,channel,outcome,idempotency_key,occurred_at,script_version_id,contact_result)
   values(p_lead_id,p_actor_user_id,p_channel,'no_decisor',p_action_key,p_occurred_at,p_script_version_id,'no_answer')
   returning * into v_attempt;
 end if;
 select count(*) filter(where channel='phone')::int,
        count(*) filter(where channel='whatsapp_call')::int,
        count(*) filter(where channel in ('phone','whatsapp_call'))::int,
        coalesce(bool_or(outcome='decisor_spoken'),false)
 into v_phone,v_whatsapp,v_total,v_reached
 from public.sales_prospecting_attempts where lead_id=p_lead_id;
 return jsonb_build_object('attemptId',v_attempt.id,'occurredAt',p_occurred_at,
   'status',v_lead.status,'lostAt',v_lead.lost_at,'updatedAt',v_lead.updated_at,
   'total',v_total,'needsLossDecision',(v_total=10 and not v_reached),
   'phone',v_phone,'whatsappCall',v_whatsapp,'reachedDecisor',v_reached,
   'scriptVersionId',v_attempt.script_version_id,'contactResult',v_attempt.contact_result,
   'corrected',p_attempt_id is not null);
end $function$;

revoke all on function public.record_sales_prospecting_attempt_v1(uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.record_sales_prospecting_attempt_v1(uuid,text,text,text,uuid) to service_role;
revoke all on function public.save_sales_prospecting_attempt_time_v1(uuid,uuid,text,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.save_sales_prospecting_attempt_time_v1(uuid,uuid,text,timestamptz,text,uuid) to service_role;
revoke all on function public.save_sales_prospecting_attempt_time_v2(uuid,uuid,text,timestamptz,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_sales_prospecting_attempt_time_v2(uuid,uuid,text,timestamptz,text,uuid,uuid) to service_role;
revoke all on function public.save_sales_decisor_contact_v2(uuid,uuid,text,timestamptz,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.save_sales_decisor_contact_v2(uuid,uuid,text,timestamptz,text,uuid,uuid,text) to service_role;

notify pgrst,'reload schema';

commit;
