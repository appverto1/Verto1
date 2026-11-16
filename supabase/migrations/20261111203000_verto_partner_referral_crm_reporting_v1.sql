-- Reuse canonical partner attribution for CRM and Super Admin reporting.
-- No Stripe writes, payouts, clinical data, or changes to existing referral owners.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Capture the code actually submitted by new website leads. Old rows stay valid.
alter table public.verto_partner_referrals
  add column if not exists entered_code text;
alter table public.verto_partner_referrals
  add constraint verto_partner_referrals_entered_code_check
  check (entered_code is null or entered_code ~ '^(VERTO-[A-F0-9]{18}|[A-Z0-9]{4,24})$');

-- Preserve the approved-partner, same-request event, age, paid-lead, lock,
-- duplicate-attribution, and self-referral protections from the existing RPC.
create or replace function public.verto_claim_partner_referral_v1(
  p_lead_id uuid, p_referral_code text, p_idempotency_key text
) returns boolean
language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare v_partner_id uuid; v_existing_partner_id uuid; v_lead_id uuid;
begin
  if p_lead_id is null or p_referral_code is null
     or not (
       p_referral_code ~ '^VERTO-[A-F0-9]{18}$'
       or (p_referral_code ~ '^[A-Z0-9]{4,24}$' and p_referral_code !~ '^VERTO-')
     )
     or char_length(coalesce(p_idempotency_key,'')) < 12 then
    return false;
  end if;

  select p.id into v_partner_id
    from public.verto_partner_accounts p
   where (p.referral_code = p_referral_code or p.referral_alias = p_referral_code)
     and p.status = 'approved' and p.compliance_approved is true;
  if v_partner_id is null then return false; end if;

  select l.id into v_lead_id from public.sales_leads l
   where l.id = p_lead_id and l.deleted_at is null
   for update;
  if v_lead_id is null then return false; end if;

  if not exists (
    select 1 from public.sales_leads l
    join public.sales_lead_events e on e.lead_id = l.id
    where l.id = p_lead_id and l.deleted_at is null
      and l.status not in ('converted','archived','lost')
      and l.created_at >= now() - interval '1 day'
      and e.event_type::text = 'lead_created'
      and e.idempotency_key = p_idempotency_key
  ) or exists (
    select 1 from public.platform_billing_invoice_ledger il
    where il.sales_lead_id = p_lead_id and il.status='paid'
      and il.amount_paid_cents > 0
  ) then return false; end if;

  if exists (
    select 1 from public.sales_leads l
    join public.verto_partner_accounts p on p.id = v_partner_id
    left join public.users u on u.id = p.user_id
    where l.id = p_lead_id
      and l.normalized_email is not null
      and l.normalized_email <> ''
      and (
        lower(l.normalized_email) = lower(coalesce(p.contact_email, ''))
        or lower(l.normalized_email) = lower(coalesce(u.email, ''))
      )
  ) then return false; end if;

  insert into public.verto_partner_referrals (partner_id,sales_lead_id,attributed_by,entered_code)
  values (v_partner_id,p_lead_id,'public_code',p_referral_code)
  on conflict (sales_lead_id) do nothing;

  select partner_id into v_existing_partner_id
    from public.verto_partner_referrals where sales_lead_id = p_lead_id;
  return v_existing_partner_id = v_partner_id;
end;
$$;
revoke all on function public.verto_claim_partner_referral_v1(uuid,text,text) from public,anon,authenticated;
grant execute on function public.verto_claim_partner_referral_v1(uuid,text,text) to service_role;

-- A confirmed new referral also classifies the CRM channel, atomically, once.
create or replace function public.verto_partner_referral_acquisition_v1()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $$
begin
  insert into public.sales_lead_acquisition_channels(lead_id,channel_id)
  select new.sales_lead_id,c.id
  from public.sales_acquisition_channels c
  where c.name = 'Indicação'
  on conflict (lead_id,channel_id) do nothing;
  return new;
end;
$$;
revoke all on function public.verto_partner_referral_acquisition_v1() from public,anon,authenticated;
drop trigger if exists verto_partner_referral_acquisition on public.verto_partner_referrals;
create trigger verto_partner_referral_acquisition
after insert on public.verto_partner_referrals
for each row execute function public.verto_partner_referral_acquisition_v1();

-- Backfill only the acquisition link for existing genuine referrals.
insert into public.sales_lead_acquisition_channels(lead_id,channel_id)
select r.sales_lead_id,c.id
from public.verto_partner_referrals r
join public.sales_acquisition_channels c on c.name='Indicação'
on conflict (lead_id,channel_id) do nothing;

-- One server-only indexed aggregate for all partners; no N+1 per partner.
-- "Paid" requires a real paid BRL invoice with a positive amount and paid_at.
create or replace function public.verto_owner_partner_referral_summary_v1()
returns table (
  partner_id uuid, total_referrals bigint, paid_referrals bigint,
  negotiating_referrals bigint, converted_unpaid_referrals bigint, lost_referrals bigint
)
language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select p.id,
    count(l.id),
    count(l.id) filter(where paid.confirmed),
    count(l.id) filter(where not paid.confirmed and l.status not in ('converted','lost','archived')),
    count(l.id) filter(where not paid.confirmed and l.status = 'converted'),
    count(l.id) filter(where not paid.confirmed and l.status in ('lost','archived'))
  from public.verto_partner_accounts p
  left join public.verto_partner_referrals r on r.partner_id=p.id
  left join public.sales_leads l on l.id=r.sales_lead_id and l.deleted_at is null
  left join lateral (
    select exists (
      select 1 from public.platform_billing_invoice_ledger il
      where il.sales_lead_id=l.id and il.status='paid'
        and il.amount_paid_cents>0 and il.paid_at is not null
        and il.currency='brl'
    ) as confirmed
  ) paid on true
  group by p.id;
$$;
revoke all on function public.verto_owner_partner_referral_summary_v1() from public,anon,authenticated;
grant execute on function public.verto_owner_partner_referral_summary_v1() to service_role;
notify pgrst, 'reload schema';
commit;
