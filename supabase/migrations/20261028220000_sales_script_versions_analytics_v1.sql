-- Versioned commercial scripts and immutable attribution per prospecting event.
-- Existing events remain unassigned: their historical script was not known.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table public.sales_script_versions (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(name) between 2 and 120),
  version_label text not null check(length(version_label) between 1 and 40),
  source_kind text not null check(source_kind in ('text','url','file')),
  source_text text,
  source_url text,
  file_path text,
  file_name text,
  file_mime text,
  file_bytes integer,
  is_active boolean not null default true,
  created_by uuid not null references public.users(id),
  client_action_key text not null unique check(length(client_action_key) between 12 and 120),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint sales_script_source_shape check (
    (source_kind='text' and length(source_text) between 1 and 20000
      and source_url is null and file_path is null)
    or
    (source_kind='url' and length(source_url) between 9 and 2000
      and source_text is null and file_path is null)
    or
    (source_kind='file' and length(file_path) between 40 and 350 and length(file_name) between 1 and 180
      and file_mime in ('application/pdf','text/plain','image/png','image/jpeg','image/webp',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      and file_bytes between 1 and 4194304 and source_url is null and source_text is null)
  )
);
create unique index sales_script_versions_unique_name_version_idx
  on public.sales_script_versions (lower(name),lower(version_label));
create unique index sales_script_versions_file_path_uidx on public.sales_script_versions(file_path) where file_path is not null;
create index sales_script_versions_active_idx on public.sales_script_versions(id) where is_active=true;
alter table public.sales_script_versions enable row level security;
revoke all on table public.sales_script_versions from public,anon,authenticated;
grant select,insert,update on table public.sales_script_versions to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('sales-script-assets-private','sales-script-assets-private',false,4194304,
  array['application/pdf','text/plain','image/png','image/jpeg','image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do nothing;

alter table public.sales_prospecting_attempts
  add column script_version_id uuid references public.sales_script_versions(id),
  add column contact_result text check(contact_result in ('no_answer','not_interested','interested'));
create index sales_prospecting_attempts_script_metrics_idx
  on public.sales_prospecting_attempts(script_version_id,occurred_at)
  where script_version_id is not null;

create or replace function public.enforce_sales_script_attribution_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if tg_op='UPDATE' then
    if new.script_version_id is distinct from old.script_version_id
      or new.contact_result is distinct from old.contact_result
    then raise exception 'SCRIPT_ATTRIBUTION_IMMUTABLE'; end if;
    return new;
  end if;
  if new.outcome='no_decisor' and new.contact_result is distinct from 'no_answer'
    or new.outcome='decisor_spoken' and new.script_version_id is not null
      and new.contact_result not in ('interested','not_interested')
  then raise exception 'INVALID_CONTACT_RESULT'; end if;
  if new.script_version_id is not null then
    if not exists(select 1 from public.sales_script_versions
      where id=new.script_version_id and is_active=true)
      then raise exception 'SCRIPT_NOT_ACTIVE'; end if;
  elsif exists(select 1 from public.sales_script_versions where is_active=true) then
    raise exception 'SCRIPT_REQUIRED';
  end if;
  return new;
end $$;
create trigger sales_script_attempt_guard
before insert or update on public.sales_prospecting_attempts
for each row execute function public.enforce_sales_script_attribution_v1();

-- For a script version, success = explicit interested decision-maker conversation.
-- Contact rate and interest rate have different denominators.
create or replace function public.sales_script_metrics_v1(p_actor_user_id uuid,p_days integer default 365)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
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
    left join public.sales_prospecting_attempts a on a.script_version_id=s.id
      and (p_days=0 or a.occurred_at>=clock_timestamp()-make_interval(days=>p_days))
    group by s.id,s.name,s.version_label,s.is_active
  ) m;
  return v_results;
end $$;

create or replace function public.save_sales_prospecting_attempt_time_v2(
  p_lead_id uuid,p_attempt_id uuid,p_channel text,p_occurred_at timestamptz,
  p_action_key text,p_actor_user_id uuid,p_script_version_id uuid
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
end $$;

create or replace function public.save_sales_decisor_contact_v2(
  p_lead_id uuid, p_attempt_id uuid, p_channel text, p_occurred_at timestamptz,
  p_action_key text, p_actor_user_id uuid,p_script_version_id uuid,p_contact_result text
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
end $$;

revoke all on function public.sales_script_metrics_v1(uuid,integer) from public,anon,authenticated;
revoke all on function public.save_sales_prospecting_attempt_time_v2(uuid,uuid,text,timestamptz,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.save_sales_decisor_contact_v2(uuid,uuid,text,timestamptz,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.sales_script_metrics_v1(uuid,integer) to service_role;
grant execute on function public.save_sales_prospecting_attempt_time_v2(uuid,uuid,text,timestamptz,text,uuid,uuid) to service_role;
grant execute on function public.save_sales_decisor_contact_v2(uuid,uuid,text,timestamptz,text,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
