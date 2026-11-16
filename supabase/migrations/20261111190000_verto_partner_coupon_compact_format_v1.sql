-- Compact coupon format: uppercase letters and digits only, 4-24 characters.
-- Preserve legacy VERTO-* referral codes, attribution integrity and index.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.verto_partner_accounts
  drop constraint if exists verto_partner_referral_alias_format_chk;
alter table public.verto_partner_accounts
  add constraint verto_partner_referral_alias_format_chk
  check (referral_alias is null or referral_alias ~ '^[A-Z0-9]{4,24}$');

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
       or (p_referral_code ~ '^[A-Z0-9]{4,24}$'
           and p_referral_code !~ '^VERTO-')
     )
     or char_length(coalesce(p_idempotency_key,'')) < 12 then
    return false;
  end if;

  select p.id into v_partner_id
    from public.verto_partner_accounts p
   where (p.referral_code = p_referral_code or p.referral_alias = p_referral_code)
     and p.status = 'approved' and p.compliance_approved is true;
  if v_partner_id is null then return false; end if;

  -- Serialize attribution against concurrent claims and lead changes.
  select l.id into v_lead_id from public.sales_leads l
   where l.id = p_lead_id and l.deleted_at is null
   for update;
  if v_lead_id is null then return false; end if;

  -- No retroactive assignment of an existing lead, no post-payment claims.
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

  -- Prevent referral to a company registered with the partner's own email.
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

  insert into public.verto_partner_referrals (partner_id,sales_lead_id,attributed_by)
  values (v_partner_id,p_lead_id,'public_code')
  on conflict (sales_lead_id) do nothing;

  select partner_id into v_existing_partner_id
    from public.verto_partner_referrals where sales_lead_id = p_lead_id;
  return v_existing_partner_id = v_partner_id;
end;
$$;

revoke all on function public.verto_claim_partner_referral_v1(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.verto_claim_partner_referral_v1(uuid,text,text)
  to service_role;
notify pgrst, 'reload schema';
commit;
