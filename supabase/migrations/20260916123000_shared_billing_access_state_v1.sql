-- Shared Stripe -> tenant billing-access projection for Issues #188/#189.
-- Server-owned only; financial facts remain in platform_subscription_financial_state.
begin;

create table if not exists public.organization_billing_access_state (
  organization_id uuid primary key references public.clinics(id) on delete cascade,
  stripe_subscription_id text not null,
  access_state text not null default 'ACTIVE'
    check (access_state in ('ACTIVE','GRACE_PERIOD','SUSPENDED_BILLING','SUSPENDED_CANCELED')),
  trigger_reason text,
  grace_started_at timestamptz,
  grace_ends_at timestamptz,
  source_event_id text not null,
  source_event_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((access_state = 'GRACE_PERIOD') = (grace_ends_at is not null)),
  check (grace_started_at is null or grace_ends_at is null or grace_started_at <= grace_ends_at)
);

create unique index if not exists ux_organization_billing_access_source_event
  on public.organization_billing_access_state(source_event_id);
create index if not exists idx_organization_billing_access_deadline
  on public.organization_billing_access_state(grace_ends_at, organization_id)
  where access_state = 'GRACE_PERIOD';

create table if not exists public.organization_billing_access_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  stripe_subscription_id text not null,
  source_event_id text not null unique,
  source_event_created_at timestamptz not null,
  from_state text,
  to_state text not null,
  trigger_reason text,
  grace_started_at timestamptz,
  grace_ends_at timestamptz,
  applied boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_organization_billing_access_events_scope
  on public.organization_billing_access_events(organization_id, source_event_created_at desc);

alter table public.organization_billing_access_state enable row level security;
alter table public.organization_billing_access_events enable row level security;
revoke all on table public.organization_billing_access_state from public, anon, authenticated;
revoke all on table public.organization_billing_access_events from public, anon, authenticated;
grant select, insert, update, delete on table public.organization_billing_access_state to service_role;
grant select, insert on table public.organization_billing_access_events to service_role;

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

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 0));
  select * into v_existing
  from public.organization_billing_access_events
  where source_event_id = p_source_event_id;
  if found then
    if v_existing.organization_id <> p_organization_id
       or v_existing.stripe_subscription_id <> p_stripe_subscription_id
       or v_existing.to_state <> p_target_state
       or v_existing.source_event_created_at <> p_source_event_created_at then
      raise exception 'billing_access_idempotency_conflict';
    end if;
    select * into v_result from public.organization_billing_access_state
      where organization_id = p_organization_id;
    return v_result;
  end if;

  select * into v_current from public.organization_billing_access_state
    where organization_id = p_organization_id for update;

  if found and p_source_event_created_at <= v_current.source_event_created_at then
    insert into public.organization_billing_access_events (
      organization_id,stripe_subscription_id,source_event_id,source_event_created_at,
      from_state,to_state,trigger_reason,grace_started_at,grace_ends_at,applied
    ) values (
      p_organization_id,p_stripe_subscription_id,p_source_event_id,p_source_event_created_at,
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
    grace_started_at,grace_ends_at,source_event_id,source_event_created_at
  ) values (
    p_organization_id,p_stripe_subscription_id,p_target_state,p_trigger_reason,
    p_grace_started_at,p_grace_ends_at,p_source_event_id,p_source_event_created_at
  )
  on conflict (organization_id) do update set
    stripe_subscription_id = excluded.stripe_subscription_id,
    access_state = excluded.access_state,
    trigger_reason = excluded.trigger_reason,
    grace_started_at = excluded.grace_started_at,
    grace_ends_at = excluded.grace_ends_at,
    source_event_id = excluded.source_event_id,
    source_event_created_at = excluded.source_event_created_at,
    updated_at = now()
  returning * into v_result;

  insert into public.organization_billing_access_events (
    organization_id,stripe_subscription_id,source_event_id,source_event_created_at,
    from_state,to_state,trigger_reason,grace_started_at,grace_ends_at,applied
  ) values (
    p_organization_id,p_stripe_subscription_id,p_source_event_id,p_source_event_created_at,
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

comment on table public.organization_billing_access_state is
  'Canonical server-owned tenant billing access projection shared by Stripe grace/cancellation flows.';
comment on table public.organization_billing_access_events is
  'Append-only audit/idempotency ledger for tenant billing access transitions.';

notify pgrst, 'reload schema';
commit;