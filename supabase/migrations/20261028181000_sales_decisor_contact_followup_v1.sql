-- Owner CRM: correct the actual time of a decision-maker conversation and save a follow-up date.
-- NO notifications, patient jobs, push subscriptions, Stripe or clinic records are touched.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table if not exists public.sales_contact_followups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id),
  actor_user_id uuid not null references public.users(id),
  contact_due_at timestamptz not null,
  status text not null default 'scheduled' check(status in ('scheduled','canceled')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(lead_id,actor_user_id)
);
alter table public.sales_contact_followups enable row level security;
revoke all on table public.sales_contact_followups from public,anon,authenticated;
grant select,insert,update on table public.sales_contact_followups to service_role;

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
  if p_channel not in ('phone','whatsapp_call')
    or p_action_key is null or char_length(p_action_key) not between 12 and 120
    or p_occurred_at is null or p_occurred_at < timestamptz '2020-01-01T00:00:00Z'
    or p_occurred_at > v_now then raise exception 'INVALID_CONTACT_TIME'; end if;
  if extract(isodow from p_occurred_at at time zone 'America/Sao_Paulo') not between 1 and 5
    or (p_occurred_at at time zone 'America/Sao_Paulo')::time < time '09:00'
    or (p_occurred_at at time zone 'America/Sao_Paulo')::time > time '17:30'
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
    if exists(select 1 from public.sales_prospecting_attempts
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
    if exists(select 1 from public.sales_prospecting_attempts
      where lead_id=p_lead_id
      and (occurred_at at time zone 'America/Sao_Paulo')::date=
        (p_occurred_at at time zone 'America/Sao_Paulo')::date)
      then raise exception 'PROSPECTING_ALREADY_TODAY'; end if;
    select count(*)::integer into v_count from public.sales_prospecting_attempts
      where lead_id=p_lead_id and channel=p_channel;
    if v_count>=5 then raise exception 'CHANNEL_ATTEMPT_LIMIT'; end if;
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

create or replace function public.save_sales_contact_followup_v1(
  p_lead_id uuid,p_actor_user_id uuid,p_contact_due_at timestamptz,p_action_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_record public.sales_contact_followups%rowtype;
  v_event jsonb;
  v_now timestamptz:=clock_timestamp();
  v_hash text;
  v_event_key text:='sales-contact-followup:'||p_action_key;
begin
  if p_actor_user_id is null or p_lead_id is null
    or not exists(select 1 from public.platform_admins where user_id=p_actor_user_id and active=true)
  then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  if p_action_key is null or char_length(p_action_key) not between 12 and 120
    or (p_contact_due_at is not null and
      (p_contact_due_at<=v_now or p_contact_due_at>v_now+interval '366 days'))
    then raise exception 'INVALID_FOLLOWUP_DATE'; end if;
  perform 1 from public.sales_leads where id=p_lead_id and deleted_at is null for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;
  v_hash:=md5(p_lead_id::text||'|'||p_actor_user_id::text||'|'||
    coalesce(p_contact_due_at::text,'cancel'));
  select metadata into v_event from public.sales_lead_events where idempotency_key=v_event_key;
  if found then
    if v_event->>'hash' is distinct from v_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    select * into v_record from public.sales_contact_followups
      where lead_id=p_lead_id and actor_user_id=p_actor_user_id;
    if not found then raise exception 'FOLLOWUP_NOT_FOUND'; end if;
    return to_jsonb(v_record);
  end if;
  if p_contact_due_at is null then
    update public.sales_contact_followups
      set status='canceled',updated_at=v_now
      where lead_id=p_lead_id and actor_user_id=p_actor_user_id
      returning * into v_record;
    if not found then raise exception 'FOLLOWUP_NOT_FOUND'; end if;
  else
    insert into public.sales_contact_followups(lead_id,actor_user_id,contact_due_at,status)
      values(p_lead_id,p_actor_user_id,p_contact_due_at,'scheduled')
    on conflict(lead_id,actor_user_id) do update set
      contact_due_at=excluded.contact_due_at,status='scheduled',updated_at=v_now
    returning * into v_record;
  end if;
  insert into public.sales_lead_events(lead_id,event_type,actor_user_id,metadata,idempotency_key)
  values(p_lead_id,'lead_updated',p_actor_user_id,
    jsonb_build_object('source','owner_kanban','action',
      case when p_contact_due_at is null then 'followup_canceled' else 'followup_saved' end,
      'contactDueAt',p_contact_due_at,'hash',v_hash),v_event_key);
  return to_jsonb(v_record);
end $$;

revoke all on function public.save_sales_decisor_contact_v1(uuid,uuid,text,timestamptz,text,uuid)
  from public,anon,authenticated;
revoke all on function public.save_sales_contact_followup_v1(uuid,uuid,timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.save_sales_decisor_contact_v1(uuid,uuid,text,timestamptz,text,uuid)
  to service_role;
grant execute on function public.save_sales_contact_followup_v1(uuid,uuid,timestamptz,text)
  to service_role;
notify pgrst,'reload schema';
commit;
