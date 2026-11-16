-- STAGING: immutable 6/9/12-month entitlement per qualified paid referral.
-- No payout, Stripe mutation, checkout change, or clinical data access.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.verto_partner_referral_terms (
  referral_id uuid primary key references public.verto_partner_referrals(id) on delete restrict,
  partner_id uuid not null references public.verto_partner_accounts(id) on delete restrict,
  stripe_subscription_id text not null,
  first_paid_at timestamptz not null,
  qualified_at timestamptz not null,
  term_months smallint not null check (term_months in (6,9,12)),
  commission_basis_points smallint not null default 1000
    check (commission_basis_points = 1000),
  term_ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint verto_partner_term_dates_check
    check (qualified_at >= first_paid_at and term_ends_at > first_paid_at)
);
create index if not exists verto_partner_referral_terms_partner_idx
  on public.verto_partner_referral_terms(partner_id,first_paid_at desc);
alter table public.verto_partner_referral_terms enable row level security;
revoke all on public.verto_partner_referral_terms from public, anon, authenticated;
grant select, insert on public.verto_partner_referral_terms to service_role;

-- A partner's tier is a pure function of the number of qualified clinics.
create or replace function public.verto_partner_term_for_count_v1(p_count integer)
returns smallint language sql immutable security invoker
set search_path=pg_catalog,public as $$
  select case when p_count >= 6 then 12::smallint
              when p_count >= 3 then 9::smallint
              else 6::smallint end
$$;

-- Only a qualified subscription contributes; a recent cancellation or
-- payment delay receives a 30-day grace on DOWNGRADES, never on commissions.
-- The extra 30 days around the 12-month performance window avoids flapping.
create or replace function public.verto_partner_qualified_active_count_v1(
  p_partner_id uuid, p_as_of timestamptz
) returns integer language sql stable security invoker
set search_path=pg_catalog,public as $$
  select count(*)::integer
  from public.verto_partner_referral_terms t
  join public.verto_partner_referrals r on r.id=t.referral_id
  join public.platform_subscription_financial_state s
    on s.stripe_subscription_id=t.stripe_subscription_id
   and s.sales_lead_id=r.sales_lead_id
  where t.partner_id=p_partner_id and t.qualified_at<=p_as_of
    and (
      t.first_paid_at >= p_as_of - interval '12 months'
      or (t.first_paid_at >= p_as_of - interval '12 months' - interval '30 days'
          and s.stripe_status='active'
          and (s.canceled_at is null or s.canceled_at > p_as_of))
    )
    and (
      (s.stripe_status='active'
        and (s.canceled_at is null or s.canceled_at > p_as_of))
      or (s.canceled_at is not null and s.canceled_at > p_as_of)
      or s.canceled_at between p_as_of - interval '30 days' and p_as_of
      or (s.stripe_status='past_due'
          and s.last_paid_at >= p_as_of - interval '30 days')
    );
$$;

-- Called only from canonical paid-invoice/subscription events via server role.
-- One immutable term is assigned on the SECOND distinct monthly paid period.
-- The promotion-causing conversion counts itself (5 + 1 => 12 months).
create or replace function public.verto_partner_try_grant_term_v1(
  p_lead_id uuid, p_subscription_id text
) returns void language plpgsql security invoker
set search_path=pg_catalog,public as $$
declare
  v_ref record;
  v_sub record;
  v_count integer;
  v_first_paid timestamptz;
  v_qualified timestamptz;
  v_term smallint;
  v_existing integer;
begin
  if p_lead_id is null or nullif(p_subscription_id,'') is null then return; end if;
  select r.id,r.partner_id into v_ref
    from public.verto_partner_referrals r
   where r.sales_lead_id=p_lead_id;
  if not found then return; end if;

  -- Serialize concurrent second-invoice events for this partner.
  perform pg_advisory_xact_lock(hashtextextended(v_ref.partner_id::text,0));
  if exists(select 1 from public.verto_partner_referral_terms
            where referral_id=v_ref.id) then return; end if;
  select s.organization_id,s.stripe_status,s.canceled_at into v_sub
    from public.platform_subscription_financial_state s
   where s.stripe_subscription_id=p_subscription_id
     and s.sales_lead_id=p_lead_id
   order by s.updated_at desc limit 1;
  if not found then return; end if;

  -- Do not grant on an unpaid, suspended or already canceled subscription.
  -- A cancellation AFTER the qualifying payment is tolerated for late events.
  with monthly as (
    select distinct on (i.period_start) i.paid_at,i.period_start
    from public.platform_billing_invoice_ledger i
    where i.stripe_subscription_id=p_subscription_id
      and i.organization_id is not distinct from v_sub.organization_id
      and (i.sales_lead_id=p_lead_id or i.sales_lead_id is null)
      and i.status='paid' and lower(i.currency)='brl'
      and i.billing_reason in ('subscription_create','subscription_cycle')
      and i.amount_paid_cents>0 and i.paid_at is not null
      and i.period_start is not null and i.period_end is not null
      and i.period_end >= i.period_start + interval '20 days'
      and i.period_end <= i.period_start + interval '40 days'
    order by i.period_start,i.paid_at
  ), first_two as (
    select paid_at from monthly order by paid_at limit 2
  )
  select count(*)::integer,min(paid_at),max(paid_at)
    into v_count,v_first_paid,v_qualified from first_two;
  if v_count<2 or v_first_paid is null or v_qualified is null then return; end if;
  if not (v_sub.stripe_status='active'
          or (v_sub.canceled_at is not null and v_sub.canceled_at>v_qualified)) then
    return;
  end if;
  v_existing:=public.verto_partner_qualified_active_count_v1(
    v_ref.partner_id,v_qualified);
  v_term:=public.verto_partner_term_for_count_v1(v_existing+1);
  insert into public.verto_partner_referral_terms
    (referral_id,partner_id,stripe_subscription_id,first_paid_at,qualified_at,
     term_months,term_ends_at)
  values
    (v_ref.id,v_ref.partner_id,p_subscription_id,v_first_paid,v_qualified,
     v_term,v_first_paid+make_interval(months=>v_term))
  on conflict (referral_id) do nothing;
end $$;

-- Never block Stripe ledger persistence for a partner-reporting failure.
create or replace function public.verto_partner_invoice_term_trigger_v1()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public as $$
begin
  if new.status='paid' and new.amount_paid_cents>0
    and new.paid_at is not null and new.stripe_subscription_id is not null
    and new.billing_reason in ('subscription_create','subscription_cycle')
  then
    perform public.verto_partner_try_grant_term_v1(
      coalesce(new.sales_lead_id,(select s.sales_lead_id
        from public.platform_subscription_financial_state s
        where s.stripe_subscription_id=new.stripe_subscription_id
          and s.organization_id is not distinct from new.organization_id
        limit 1)),new.stripe_subscription_id);
  end if;
  return new;
exception when others then
  raise warning 'PARTNER_TERM_INVOICE_SYNC_ERROR SQLSTATE %',sqlstate;
  return new;
end $$;
drop trigger if exists verto_partner_invoice_term_v1
  on public.platform_billing_invoice_ledger;
create trigger verto_partner_invoice_term_v1
after insert or update of status,paid_at,amount_paid_cents,
  sales_lead_id,stripe_subscription_id,period_start,period_end
on public.platform_billing_invoice_ledger for each row
execute function public.verto_partner_invoice_term_trigger_v1();

-- Subscription state may become ACTIVE after the paid-invoice webhook.
create or replace function public.verto_partner_subscription_term_trigger_v1()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public as $$
begin
  if new.stripe_status='active' and new.sales_lead_id is not null
    and new.stripe_subscription_id is not null then
    perform public.verto_partner_try_grant_term_v1(
      new.sales_lead_id,new.stripe_subscription_id);
  end if;
  return new;
exception when others then
  raise warning 'PARTNER_TERM_SUBSCRIPTION_SYNC_ERROR SQLSTATE %',sqlstate;
  return new;
end $$;
drop trigger if exists verto_partner_subscription_term_v1
  on public.platform_subscription_financial_state;
create trigger verto_partner_subscription_term_v1
after insert or update of stripe_status,sales_lead_id,stripe_subscription_id
on public.platform_subscription_financial_state for each row
execute function public.verto_partner_subscription_term_trigger_v1();

-- Existing referral response, plus immutable terms and current tier in ONE RPC.
create or replace function public.verto_partner_tier_dashboard_v1(
  p_partner_id uuid
) returns jsonb language sql stable security invoker
set search_path=pg_catalog,public as $$
  with current_level as (
    select public.verto_partner_qualified_active_count_v1(
      p_partner_id,now()) as qualified_active
  )
  select jsonb_build_object(
    'qualified_active',cl.qualified_active,
    'current_term_months',public.verto_partner_term_for_count_v1(cl.qualified_active),
    'referrals',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'referral_id',r.referral_id,
          'clinic_name',r.clinic_name,
          'lead_status',r.lead_status,
          'has_paid',r.has_paid,
          'referred_at',r.referred_at,
          'term_months',t.term_months,
          'first_paid_at',t.first_paid_at,
          'qualified_at',t.qualified_at,
          'term_ends_at',t.term_ends_at,
          'subscription_active',coalesce(
            s.stripe_status='active' and
            (s.canceled_at is null or s.canceled_at>now()),false)
        ) order by r.referred_at desc
      )
      from public.verto_partner_referral_overview_v1(
        p_partner_id,50,0) r
      left join public.verto_partner_referral_terms t
        on t.referral_id=r.referral_id
      left join public.platform_subscription_financial_state s
        on s.stripe_subscription_id=t.stripe_subscription_id
    ),'[]'::jsonb)
  ) from current_level cl;
$$;

revoke all on function public.verto_partner_term_for_count_v1(integer)
  from public,anon,authenticated;
revoke all on function public.verto_partner_qualified_active_count_v1(uuid,timestamptz)
  from public,anon,authenticated;
revoke all on function public.verto_partner_try_grant_term_v1(uuid,text)
  from public,anon,authenticated;
revoke all on function public.verto_partner_invoice_term_trigger_v1()
  from public,anon,authenticated;
revoke all on function public.verto_partner_subscription_term_trigger_v1()
  from public,anon,authenticated;
revoke all on function public.verto_partner_tier_dashboard_v1(uuid)
  from public,anon,authenticated;
grant execute on function public.verto_partner_term_for_count_v1(integer)
  to service_role;
grant execute on function public.verto_partner_qualified_active_count_v1(uuid,timestamptz)
  to service_role;
grant execute on function public.verto_partner_try_grant_term_v1(uuid,text)
  to service_role;
grant execute on function public.verto_partner_tier_dashboard_v1(uuid)
  to service_role;
comment on table public.verto_partner_referral_terms is
  'Immutable tier entitlement, not a payable commission or authorization for payout.';
notify pgrst,'reload schema';
commit;
