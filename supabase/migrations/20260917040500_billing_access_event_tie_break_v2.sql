-- Issue #189: deterministic ordering for distinct Stripe events sharing event.created.
-- Additive only. Preserve the v1 signature and server-owned access model.
begin;

alter table public.organization_billing_access_state
  add column if not exists source_event_order_rank smallint not null default 0,
  add column if not exists source_event_order_key text not null default '';

alter table public.organization_billing_access_events
  add column if not exists source_event_order_rank smallint not null default 0,
  add column if not exists source_event_order_key text not null default '';

create index if not exists idx_organization_billing_access_events_order_v2
  on public.organization_billing_access_events(
    organization_id,
    source_event_created_at desc,
    source_event_order_rank desc,
    source_event_order_key desc
  );

create or replace function public.apply_organization_billing_access_event_v1(
  p_organization_id uuid,
  p_stripe_subscription_id text,
  p_source_event_id text,
  p_source_event_created_at timestamptz,
  p_target_state text,
  p_trigger_reason text default null,
  p_grace_started_at timestamptz default null,
  p_grace_ends_at timestamptz default null
) returns public.organization_billing_access_state
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.organization_billing_access_state%rowtype;
  v_result public.organization_billing_access_state%rowtype;
  v_existing public.organization_billing_access_events%rowtype;
  v_order_rank smallint;
  v_order_key text;
begin
  if p_organization_id is null or nullif(trim(p_stripe_subscription_id),'') is null
     or nullif(trim(p_source_event_id),'') is null or p_source_event_created_at is null then
    raise exception 'billing_access_missing_required_input';
  end if;
  if p_target_state not in ('ACTIVE','GRACE_PERIOD','SUSPENDED_BILLING','SUSPENDED_CANCELED') then
    raise exception 'billing_access_invalid_state';
  end if;
  if (p_target_state = 'GRACE_PERIOD') <> (p_grace_ends_at is not null) then
    raise exception 'billing_access_invalid_grace_deadline';
  end if;

  -- For equal Stripe event.created values, fail closed toward the more restrictive
  -- access state. The event id is a deterministic final tie-break within the same
  -- state class; it never overrides a genuinely newer timestamp.
  v_order_rank := case p_target_state
    when 'ACTIVE' then 10
    when 'GRACE_PERIOD' then 20
    when 'SUSPENDED_BILLING' then 30
    when 'SUSPENDED_CANCELED' then 40
    else 0
  end;
  v_order_key := trim(p_source_event_id);

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 0));
  select * into v_existing
  from public.organization_billing_access_events
  where source_event_id = p_source_event_id;
  if found then
    if v_existing.organization_id <> p_organization_id
       or v_existing.stripe_subscription_id <> p_stripe_subscription_id
       or v_existing.to_state <> p_target_state
       or v_existing.source_event_created_at <> p_source_event_created_at
       or v_existing.source_event_order_rank <> v_order_rank
       or v_existing.source_event_order_key <> v_order_key then
      raise exception 'billing_access_idempotency_conflict';
    end if;
    select * into v_result from public.organization_billing_access_state
      where organization_id = p_organization_id;
    return v_result;
  end if;

  select * into v_current from public.organization_billing_access_state
    where organization_id = p_organization_id for update;

  if found and (
    p_source_event_created_at < v_current.source_event_created_at
    or (
      p_source_event_created_at = v_current.source_event_created_at
      and (v_order_rank, v_order_key) <= (v_current.source_event_order_rank, v_current.source_event_order_key)
    )
  ) then
    insert into public.organization_billing_access_events (
      organization_id,stripe_subscription_id,source_event_id,source_event_created_at,
      source_event_order_rank,source_event_order_key,
      from_state,to_state,trigger_reason,grace_started_at,grace_ends_at,applied
    ) values (
      p_organization_id,p_stripe_subscription_id,p_source_event_id,p_source_event_created_at,
      v_order_rank,v_order_key,
      v_current.access_state,p_target_state,p_trigger_reason,p_grace_started_at,p_grace_ends_at,false
    );
    return v_current;
  end if;

  if found and v_current.access_state = 'SUSPENDED_CANCELED'
     and p_target_state = 'ACTIVE'
     and p_stripe_subscription_id = v_current.stripe_subscription_id then
    raise exception 'billing_access_canceled_subscription_cannot_reactivate';
  end if;

  insert into public.organization_billing_access_state (
    organization_id,stripe_subscription_id,access_state,trigger_reason,
    grace_started_at,grace_ends_at,source_event_id,source_event_created_at,
    source_event_order_rank,source_event_order_key
  ) values (
    p_organization_id,p_stripe_subscription_id,p_target_state,p_trigger_reason,
    p_grace_started_at,p_grace_ends_at,p_source_event_id,p_source_event_created_at,
    v_order_rank,v_order_key
  )
  on conflict (organization_id) do update set
    stripe_subscription_id = excluded.stripe_subscription_id,
    access_state = excluded.access_state,
    trigger_reason = excluded.trigger_reason,
    grace_started_at = excluded.grace_started_at,
    grace_ends_at = excluded.grace_ends_at,
    source_event_id = excluded.source_event_id,
    source_event_created_at = excluded.source_event_created_at,
    source_event_order_rank = excluded.source_event_order_rank,
    source_event_order_key = excluded.source_event_order_key,
    updated_at = now()
  returning * into v_result;

  insert into public.organization_billing_access_events (
    organization_id,stripe_subscription_id,source_event_id,source_event_created_at,
    source_event_order_rank,source_event_order_key,
    from_state,to_state,trigger_reason,grace_started_at,grace_ends_at,applied
  ) values (
    p_organization_id,p_stripe_subscription_id,p_source_event_id,p_source_event_created_at,
    v_order_rank,v_order_key,
    case when v_current.organization_id is null then null else v_current.access_state end,
    p_target_state,p_trigger_reason,p_grace_started_at,p_grace_ends_at,true
  );

  return v_result;
end;
$$;

revoke all on function public.apply_organization_billing_access_event_v1(
  uuid,text,text,timestamptz,text,text,timestamptz,timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_organization_billing_access_event_v1(
  uuid,text,text,timestamptz,text,text,timestamptz,timestamptz
) to service_role;

comment on column public.organization_billing_access_state.source_event_order_rank is
  'Deterministic equal-timestamp ordering rank; more restrictive billing-access states sort later.';
comment on column public.organization_billing_access_state.source_event_order_key is
  'Stable final tie-break for equal timestamp/rank, derived from Stripe event id.';

notify pgrst, 'reload schema';
commit;