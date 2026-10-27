-- Commercial prospecting: auditable attempts, atomic ten-attempt stop and manual loss time.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.sales_leads add column if not exists lost_at timestamptz;
-- Existing PATCH routes already change status. Preserve exact loss time in DB,
-- including manual changes that do not yet call the new prospecting RPC.
create or replace function public.set_sales_lead_lost_at_v1()
returns trigger language plpgsql set search_path = pg_catalog, public as $
begin
  if new.status = 'lost' and (
    old.status = 'converted' or old.converted_user_id is not null or old.converted_clinic_id is not null
  ) then
    raise exception 'CONVERTED_LEAD_CANNOT_BE_LOST';
  end if;
  if new.status = 'lost' and old.status is distinct from 'lost' then
    new.lost_at := clock_timestamp();
  elsif new.status <> 'lost' then
    new.lost_at := null;
  end if;
  return new;
end $;
drop trigger if exists set_sales_lead_lost_at_v1 on public.sales_leads;
create trigger set_sales_lead_lost_at_v1
before update of status on public.sales_leads
for each row execute function public.set_sales_lead_lost_at_v1();


create table if not exists public.sales_prospecting_attempts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  channel text not null check (channel in ('phone', 'whatsapp_call')),
  outcome text not null check (outcome in ('no_decisor', 'decisor_spoken')),
  idempotency_key text not null unique check (char_length(idempotency_key) between 12 and 120),
  occurred_at timestamptz not null default clock_timestamp()
);
create index if not exists sales_prospecting_attempts_lead_idx
  on public.sales_prospecting_attempts (lead_id, occurred_at desc);

alter table public.sales_prospecting_attempts enable row level security;
revoke all on public.sales_prospecting_attempts from public, anon, authenticated;
grant select, insert on public.sales_prospecting_attempts to service_role;

create or replace function public.mark_sales_prospecting_lead_lost_v1(
  p_lead_id uuid, p_action_key text, p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_lead public.sales_leads%rowtype;
  v_at timestamptz := clock_timestamp();
begin
  if p_action_key is null or char_length(p_action_key) not between 12 and 120 then
    raise exception 'INVALID_ACTION_KEY';
  end if;
  select * into v_lead from public.sales_leads
  where id = p_lead_id and deleted_at is null for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;
  if v_lead.status = 'converted' or v_lead.converted_user_id is not null or v_lead.converted_clinic_id is not null then
    raise exception 'CONVERTED_LEAD_CANNOT_BE_LOST';
  end if;
  if v_lead.status <> 'lost' then
    update public.sales_leads set status = 'lost', lost_at = v_at, updated_at = v_at
    where id = p_lead_id returning * into v_lead;
    insert into public.sales_lead_events(lead_id,event_type,actor_user_id,metadata,idempotency_key)
    values(p_lead_id,'lead_lost',p_actor_user_id,jsonb_build_object('status','lost','reason','manual'),
           'prospecting-manual-lost:' || p_lead_id::text || ':' || p_action_key)
    on conflict (idempotency_key) do nothing;
  end if;
  return jsonb_build_object('status', v_lead.status, 'lostAt', v_lead.lost_at, 'updatedAt', v_lead.updated_at);
end $$;

create or replace function public.record_sales_prospecting_attempt_v1(
  p_lead_id uuid, p_channel text, p_outcome text, p_action_key text, p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
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
    if v_lead.status in ('lost','archived','converted')
       or v_lead.converted_user_id is not null or v_lead.converted_clinic_id is not null
       or v_lead.do_not_contact then
      raise exception 'PROSPECTING_NOT_ALLOWED';
    end if;
    select count(*) filter(where channel='phone')::integer,
           count(*) filter(where channel='whatsapp_call')::integer
      into v_phone,v_whatsapp
    from public.sales_prospecting_attempts where lead_id = p_lead_id;
    if (p_channel='phone' and v_phone >= 5) or
       (p_channel='whatsapp_call' and v_whatsapp >= 5) then
      raise exception 'CHANNEL_ATTEMPT_LIMIT';
    end if;
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
  -- Existing higher funnel statuses must never be demoted by stale attempts.
  if v_total = 10 and not v_reached and v_lead.status in ('new', 'contact_started') then
    update public.sales_leads
    set status='lost', lost_at=v_at, updated_at=v_at
    where id=p_lead_id and status in ('new', 'contact_started') returning * into v_lead;
    if found then
      insert into public.sales_lead_events(lead_id,event_type,actor_user_id,metadata,idempotency_key)
      values(p_lead_id,'lead_lost',p_actor_user_id,jsonb_build_object('reason','ten_unsuccessful_attempts','attempt_count',10),
             'prospecting-auto-lost:' || p_lead_id::text)
      on conflict (idempotency_key) do nothing;
    end if;
  end if;
  return jsonb_build_object(
    'attemptId',v_attempt_id,'occurredAt',v_at,'status',v_lead.status,
    'lostAt',v_lead.lost_at,'updatedAt',v_lead.updated_at,
    'total',v_total,'phone',v_phone,'whatsappCall',v_whatsapp,'reachedDecisor',v_reached
  );
end $$;

revoke all on function public.mark_sales_prospecting_lead_lost_v1(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.record_sales_prospecting_attempt_v1(uuid,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.mark_sales_prospecting_lead_lost_v1(uuid,text,uuid) to service_role;
grant execute on function public.record_sales_prospecting_attempt_v1(uuid,text,text,text,uuid) to service_role;
notify pgrst, 'reload schema';
commit;