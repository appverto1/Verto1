-- Enforce weekday, daytime and at most one logged attempt per local day.
-- Preserve all existing attempts and monetary/customer status.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
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
    if exists (
      select 1 from public.sales_prospecting_attempts
      where lead_id = p_lead_id and outcome = 'decisor_spoken'
    ) then
      raise exception 'DECISOR_ALREADY_CONTACTED';
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
  -- Ten attempts exhaust the counters; only a separate explicit confirmation can mark loss.
  return jsonb_build_object(
    'attemptId',v_attempt_id,'occurredAt',v_at,'status',v_lead.status,
    'lostAt',v_lead.lost_at,'updatedAt',v_lead.updated_at,
    'total',v_total,'needsLossDecision',(v_total = 10 and not v_reached),'phone',v_phone,'whatsappCall',v_whatsapp,'reachedDecisor',v_reached
  );
end $$;

notify pgrst,'reload schema';
commit;
