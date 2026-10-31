-- Owner DRE cost configuration. Does not update invoices, clinics, patients or Stripe.
begin;
create extension if not exists pgcrypto;
create table if not exists public.platform_dre_cost_rules (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  name text not null check (length(btrim(name)) between 2 and 120),
  cost_type text not null check (cost_type in ('fixed','variable')),
  category text not null default 'operating' check (category in ('operating','below_ebitda')),
  amount_cents integer not null default 0 check (amount_cents between 0 and 100000000),
  rate_basis_points integer not null default 0 check (rate_basis_points between 0 and 10000),
  starts_month date not null check (extract(day from starts_month) = 1),
  ends_month date check (ends_month is null or extract(day from ends_month) = 1),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_dre_rule_nonzero check (amount_cents > 0 or rate_basis_points > 0)
);
create index if not exists idx_platform_dre_cost_rules_months
 on public.platform_dre_cost_rules(starts_month,ends_month);
alter table public.platform_dre_cost_rules enable row level security;
revoke all on public.platform_dre_cost_rules from public,anon,authenticated;
grant select,insert,update on public.platform_dre_cost_rules to service_role;

-- These writes are atomic, validated by PostgreSQL and constrained to platform admins
-- with Supabase MFA AAL2. Client never receives service_role credentials.
create or replace function public.save_owner_dre_cost_rule_v1(
  p_action text, p_payload jsonb default '{}'::jsonb, p_rule_id uuid default null
) returns uuid language plpgsql security definer
set search_path = '' as $$
declare
 v_actor uuid := auth.uid();
 v_month date := date_trunc('month',timezone('America/Sao_Paulo',now()))::date;
 v_rule public.platform_dre_cost_rules%rowtype;
 v_id uuid;
 v_name text;
 v_type text;
 v_category text;
 v_amount integer;
 v_rate integer;
 v_start date;
 v_request uuid;
begin
 if v_actor is null or (auth.jwt()->>'aal') is distinct from 'aal2'
   or not exists(select 1 from public.platform_admins where user_id=v_actor and active=true)
 then raise exception 'DRE_ACCESS_DENIED' using errcode='42501'; end if;
 if p_action not in ('create','update','stop') or p_payload is null or jsonb_typeof(p_payload)<>'object'
 then raise exception 'DRE_INVALID_ACTION' using errcode='22023'; end if;
 if p_action='stop' then
   if p_rule_id is null then raise exception 'DRE_RULE_ID_REQUIRED' using errcode='22023'; end if;
   select * into v_rule from public.platform_dre_cost_rules where id=p_rule_id for update;
   if not found then raise exception 'DRE_RULE_NOT_FOUND' using errcode='22023'; end if;
   if v_rule.ends_month is null or v_rule.ends_month >= v_month then
     update public.platform_dre_cost_rules
       set ends_month=(v_month-interval '1 month')::date,updated_at=now()
       where id=p_rule_id;
   end if;
   return p_rule_id;
 end if;
 v_name=btrim(p_payload->>'name');
 v_type=p_payload->>'costType';
 v_category=p_payload->>'category';
 v_amount=(p_payload->>'amountCents')::integer;
 v_rate=(p_payload->>'rateBasisPoints')::integer;
 v_start=((p_payload->>'startsMonth')||'-01')::date;
 if v_start is null or v_start<v_month or extract(day from v_start)<>1
   or length(v_name) not between 2 and 120
   or v_type not in ('fixed','variable')
   or v_category not in ('operating','below_ebitda')
   or v_amount is null or v_rate is null or v_amount<0 or v_amount>100000000
   or v_rate<0 or v_rate>10000 or v_amount+v_rate=0
 then raise exception 'DRE_INVALID_COST' using errcode='22023'; end if;
 if p_action='create' then
   v_request=(p_payload->>'requestId')::uuid;
   if v_request is null then raise exception 'DRE_REQUEST_ID_REQUIRED' using errcode='22023'; end if;
   insert into public.platform_dre_cost_rules
    (request_id,name,cost_type,category,amount_cents,rate_basis_points,starts_month,created_by)
   values(v_request,v_name,v_type,v_category,v_amount,v_rate,v_start,v_actor)
   on conflict(request_id) do nothing returning id into v_id;
   if v_id is null then
     select * into v_rule from public.platform_dre_cost_rules where request_id=v_request;
     if v_rule.name is distinct from v_name or v_rule.cost_type is distinct from v_type
       or v_rule.category is distinct from v_category or v_rule.amount_cents is distinct from v_amount
       or v_rule.rate_basis_points is distinct from v_rate or v_rule.starts_month is distinct from v_start
     then raise exception 'DRE_IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
     return v_rule.id;
   end if;
   return v_id;
 end if;
 if p_rule_id is null then raise exception 'DRE_RULE_ID_REQUIRED' using errcode='22023'; end if;
 select * into v_rule from public.platform_dre_cost_rules where id=p_rule_id for update;
 if not found then raise exception 'DRE_RULE_NOT_FOUND' using errcode='22023'; end if;
 if v_rule.starts_month<v_month or v_rule.starts_month is distinct from v_start
   or (v_rule.ends_month is not null and v_rule.ends_month<v_month)
 then raise exception 'DRE_CLOSED_PERIOD_IMMUTABLE' using errcode='22023'; end if;
 update public.platform_dre_cost_rules set name=v_name,cost_type=v_type,category=v_category,
   amount_cents=v_amount,rate_basis_points=v_rate,updated_at=now() where id=p_rule_id;
 return p_rule_id;
end $$;
revoke all on function public.save_owner_dre_cost_rule_v1(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_owner_dre_cost_rule_v1(text,jsonb,uuid) to authenticated;
comment on table public.platform_dre_cost_rules is
 'Owner-only, version-effective cost rules for gross Stripe revenue DRE; not proof of actual processor settlement.';
commit;