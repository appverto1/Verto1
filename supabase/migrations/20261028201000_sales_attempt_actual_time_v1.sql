-- Explicit actual date/time for telephone prospecting attempts.
-- Separate from text messages, which remain successful contact outcomes only.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function public.save_sales_prospecting_attempt_time_v1(
  p_lead_id uuid,p_attempt_id uuid,p_channel text,p_occurred_at timestamptz,
  p_action_key text,p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
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
   if v_lead.status in ('lost','archived','converted') or
      v_lead.converted_user_id is not null or v_lead.converted_clinic_id is not null
      or v_lead.do_not_contact then raise exception 'PROSPECTING_NOT_ALLOWED'; end if;
   if exists(select 1 from public.sales_prospecting_attempts
     where lead_id=p_lead_id and outcome='decisor_spoken')
   then raise exception 'DECISOR_ALREADY_CONTACTED'; end if;
   if exists(select 1 from public.sales_prospecting_attempts
     where lead_id=p_lead_id and channel in ('phone','whatsapp_call')
       and (occurred_at at time zone 'America/Sao_Paulo')::date=
           (p_occurred_at at time zone 'America/Sao_Paulo')::date)
   then raise exception 'PROSPECTING_ALREADY_TODAY'; end if;
   select count(*) filter(where channel='phone')::int,
          count(*) filter(where channel='whatsapp_call')::int
     into v_phone,v_whatsapp from public.sales_prospecting_attempts where lead_id=p_lead_id;
   if (p_channel='phone' and v_phone>=5) or
      (p_channel='whatsapp_call' and v_whatsapp>=5)
   then raise exception 'CHANNEL_ATTEMPT_LIMIT'; end if;
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
end $$;

revoke all on function public.save_sales_prospecting_attempt_time_v1(uuid,uuid,text,timestamptz,text,uuid)
  from public,anon,authenticated;
grant execute on function public.save_sales_prospecting_attempt_time_v1(uuid,uuid,text,timestamptz,text,uuid)
  to service_role;
notify pgrst,'reload schema';
commit;
