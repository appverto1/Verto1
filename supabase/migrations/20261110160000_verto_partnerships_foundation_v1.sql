-- Verto partnerships foundation. Additive, server-owned and isolated from clinical data.
-- No payouts, Stripe mutations or existing clinic/patient table rewrites.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.verto_partner_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.users(id) on delete set null,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 180),
  contact_email text,
  partner_kind text not null check (partner_kind in ('professional','external')),
  referral_code text not null unique check (referral_code ~ '^VERTO-[A-F0-9]{18}$'),
  status text not null default 'pending'
    check (status in ('pending','approved','suspended')),
  compliance_approved boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_partner_user_required check (partner_kind <> 'professional' or user_id is not null),
  constraint approved_partner_requires_compliance check (status <> 'approved' or compliance_approved = true)
);

create index if not exists verto_partner_accounts_pending_idx
  on public.verto_partner_accounts(status, created_at desc);

create table if not exists public.verto_partner_referrals (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.verto_partner_accounts(id) on delete restrict,
  sales_lead_id uuid not null unique references public.sales_leads(id) on delete restrict,
  created_at timestamptz not null default now(),
  attributed_by text not null check (attributed_by in ('public_code','owner_review'))
);

create index if not exists verto_partner_referrals_partner_created_idx
  on public.verto_partner_referrals(partner_id, created_at desc);

-- Efficient EXISTS lookup for the paying/not-paying indicator; no invoice amount exposed.
create index if not exists verto_partner_paid_invoice_lead_idx
  on public.platform_billing_invoice_ledger(sales_lead_id)
  where status = 'paid' and amount_paid_cents > 0 and paid_at is not null;

alter table public.verto_partner_accounts enable row level security;
alter table public.verto_partner_referrals enable row level security;
revoke all on public.verto_partner_accounts from public, anon, authenticated;
revoke all on public.verto_partner_referrals from public, anon, authenticated;
grant select, insert, update on public.verto_partner_accounts to service_role;
grant select, insert on public.verto_partner_referrals to service_role;

-- Called ONLY from the service-role backend after the existing public lead RPC.
-- A fresh "lead_created" event with the SAME request idempotency key is required;
-- an old lead cannot be claimed by replaying another person's code.
create or replace function public.verto_claim_partner_referral_v1(
  p_lead_id uuid, p_referral_code text, p_idempotency_key text
) returns boolean
language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare v_partner_id uuid; v_existing_partner_id uuid; v_lead_id uuid;
begin
  if p_lead_id is null or p_referral_code is null
     or p_referral_code !~ '^VERTO-[A-F0-9]{18}$'
     or char_length(coalesce(p_idempotency_key,'')) < 12 then
    return false;
  end if;

  select p.id into v_partner_id
    from public.verto_partner_accounts p
   where p.referral_code = p_referral_code
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

-- Manual attribution is restricted to the existing platform-admin + TOTP HTTP guard.
-- This RPC still checks partner eligibility, lead eligibility and locks the lead.
create or replace function public.verto_owner_attach_partner_referral_v1(
  p_partner_id uuid, p_lead_id uuid
) returns boolean
language plpgsql security invoker
set search_path = pg_catalog, public
as $
declare v_partner_id uuid; v_attached uuid; v_lead_id uuid;
begin
  if p_partner_id is null or p_lead_id is null then return false; end if;
  select p.id into v_partner_id from public.verto_partner_accounts p
  where p.id = p_partner_id and p.status = 'approved'
    and p.compliance_approved is true;
  if v_partner_id is null then return false; end if;

  select l.id into v_lead_id from public.sales_leads l
  where l.id = p_lead_id and l.deleted_at is null
    and l.status not in ('converted','archived','lost')
  for update;
  if v_lead_id is null then return false; end if;
  if exists (
    select 1 from public.platform_billing_invoice_ledger il
    where il.sales_lead_id = p_lead_id
      and il.status='paid' and il.amount_paid_cents > 0
  ) then return false; end if;

  insert into public.verto_partner_referrals(partner_id,sales_lead_id,attributed_by)
  values (p_partner_id,p_lead_id,'owner_review')
  on conflict (sales_lead_id) do nothing;
  select partner_id into v_attached from public.verto_partner_referrals
  where sales_lead_id=p_lead_id;
  return v_attached = p_partner_id;
end;
$;

-- Return only clinic labels and payment status for the server-authorized partner account.
-- This is a server-only read RPC, not an RLS bypass exposed to browser roles.
create or replace function public.verto_partner_referral_overview_v1(
  p_partner_id uuid, p_limit integer default 50, p_offset integer default 0
) returns table (
  referral_id uuid, clinic_name text, lead_status text,
  has_paid boolean, referred_at timestamptz
)
language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select r.id, coalesce(nullif(btrim(l.clinic_name),''),'Clínica indicada'),
         l.status::text,
         exists (
           select 1 from public.platform_billing_invoice_ledger il
           where il.sales_lead_id = r.sales_lead_id and il.status='paid'
             and il.amount_paid_cents>0 and il.paid_at is not null
             and il.currency='brl'
         ),
         r.created_at
    from public.verto_partner_accounts p
    join public.verto_partner_referrals r on r.partner_id = p.id
    join public.sales_leads l on l.id = r.sales_lead_id
   where p.id = p_partner_id and l.deleted_at is null
   order by r.created_at desc, r.id desc
   limit least(greatest(coalesce(p_limit,50),1),50)
   offset least(greatest(coalesce(p_offset,0),0),5000);
$$;

revoke all on function public.verto_claim_partner_referral_v1(uuid,text,text) from public,anon,authenticated;
revoke all on function public.verto_owner_attach_partner_referral_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.verto_owner_attach_partner_referral_v1(uuid,uuid) to service_role;
revoke all on function public.verto_partner_referral_overview_v1(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.verto_claim_partner_referral_v1(uuid,text,text) to service_role;
grant execute on function public.verto_partner_referral_overview_v1(uuid,integer,integer) to service_role;

comment on table public.verto_partner_referrals is
  'Server-approved sales lead attribution only; never a patient or clinical referral.';
comment on table public.verto_partner_accounts is
  'Partners require platform review and legal/compliance approval before any code is valid. No automated payouts.';
notify pgrst, 'reload schema';
commit;
