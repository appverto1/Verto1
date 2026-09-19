-- #191 contract v5: durable CAS/recovery state for upgrades of the existing Stripe subscription.
-- This is orchestration state only; sales_offers remain price/offer authority and entitlements remain access authority.
create table public.module_subscription_upgrade_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  sales_offer_id uuid not null references public.sales_offers(id) on delete restrict,
  stripe_subscription_id text not null,
  expected_access_profile_version bigint not null,
  expected_access_profile_mode text not null,
  idempotency_key text not null,
  intent_status text not null default 'claimed' check (intent_status in ('claimed','stripe_pending','requires_action','stripe_confirmed','provisioned','failed','cancelled','superseded')),
  claim_token uuid not null default gen_random_uuid(), claim_expires_at timestamptz not null,
  stripe_operation_id text, stripe_invoice_id text, stripe_event_id text, stripe_event_created_at timestamptz, last_error_code text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
  unique (organization_id, idempotency_key)
);
create unique index module_subscription_upgrade_one_live_per_subscription on public.module_subscription_upgrade_intents (organization_id,stripe_subscription_id) where intent_status in ('claimed','stripe_pending','requires_action','stripe_confirmed');
create index module_subscription_upgrade_offer_idx on public.module_subscription_upgrade_intents(sales_offer_id);
create index module_subscription_upgrade_recovery_idx on public.module_subscription_upgrade_intents(intent_status,claim_expires_at);
alter table public.module_subscription_upgrade_intents enable row level security;
revoke all on public.module_subscription_upgrade_intents from anon, authenticated;
grant select,insert,update on public.module_subscription_upgrade_intents to service_role;
create or replace function public.acquire_module_subscription_upgrade_intent_v1(p_organization_id uuid,p_sales_offer_id uuid,p_stripe_subscription_id text,p_expected_access_profile_version bigint,p_expected_access_profile_mode text,p_idempotency_key text,p_claim_ttl_seconds integer default 900) returns public.module_subscription_upgrade_intents language plpgsql security definer set search_path='' as $$
declare v_profile public.organization_module_access_profiles%rowtype; v_billing public.organization_billing_access_state%rowtype; v_existing public.module_subscription_upgrade_intents%rowtype; v_result public.module_subscription_upgrade_intents%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_idempotency_key is null or length(btrim(p_idempotency_key))<8 or length(p_idempotency_key)>200 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
 if p_claim_ttl_seconds<60 or p_claim_ttl_seconds>3600 then raise exception 'INVALID_CLAIM_TTL'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_stripe_subscription_id,0));
 select * into v_profile from public.organization_module_access_profiles where organization_id=p_organization_id for update;
 if not found then raise exception 'ACCESS_PROFILE_NOT_FOUND'; end if;
 if v_profile.version<>p_expected_access_profile_version or v_profile.mode<>p_expected_access_profile_mode or v_profile.stripe_subscription_id is distinct from p_stripe_subscription_id then raise exception 'STALE_ACCESS_PROFILE'; end if;
 select * into v_billing from public.organization_billing_access_state where organization_id=p_organization_id and stripe_subscription_id=p_stripe_subscription_id for update;
 if not found or v_billing.access_state<>'ACTIVE' then raise exception 'BILLING_NOT_ACTIVE'; end if;
 if not exists(select 1 from public.sales_offers so join public.sales_leads sl on sl.id=so.lead_id where so.id=p_sales_offer_id and sl.converted_clinic_id=p_organization_id and so.revoked_at is null) then raise exception 'OFFER_ORGANIZATION_MISMATCH'; end if;
 select * into v_existing from public.module_subscription_upgrade_intents where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
 if found then if v_existing.sales_offer_id<>p_sales_offer_id or v_existing.stripe_subscription_id<>p_stripe_subscription_id or v_existing.expected_access_profile_version<>p_expected_access_profile_version then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return v_existing; end if;
 update public.module_subscription_upgrade_intents set intent_status='superseded',updated_at=now(),completed_at=coalesce(completed_at,now()) where organization_id=p_organization_id and stripe_subscription_id=p_stripe_subscription_id and intent_status='claimed' and claim_expires_at<=now();
 insert into public.module_subscription_upgrade_intents(organization_id,sales_offer_id,stripe_subscription_id,expected_access_profile_version,expected_access_profile_mode,idempotency_key,claim_expires_at) values(p_organization_id,p_sales_offer_id,p_stripe_subscription_id,p_expected_access_profile_version,p_expected_access_profile_mode,p_idempotency_key,now()+make_interval(secs=>p_claim_ttl_seconds)) returning * into v_result;
 return v_result;
exception when unique_violation then raise exception 'UPGRADE_ALREADY_IN_PROGRESS'; end $$;
revoke all on function public.acquire_module_subscription_upgrade_intent_v1(uuid,uuid,text,bigint,text,text,integer) from public,anon,authenticated;
grant execute on function public.acquire_module_subscription_upgrade_intent_v1(uuid,uuid,text,bigint,text,text,integer) to service_role;
create or replace function public.advance_module_subscription_upgrade_intent_v1(p_intent_id uuid,p_claim_token uuid,p_expected_status text,p_next_status text,p_stripe_operation_id text default null,p_stripe_invoice_id text default null,p_stripe_event_id text default null,p_stripe_event_created_at timestamptz default null,p_error_code text default null) returns public.module_subscription_upgrade_intents language plpgsql security definer set search_path='' as $$
declare v_row public.module_subscription_upgrade_intents%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into v_row from public.module_subscription_upgrade_intents where id=p_intent_id for update; if not found then raise exception 'INTENT_NOT_FOUND'; end if;
 if v_row.claim_token<>p_claim_token then raise exception 'STALE_CLAIM'; end if; if v_row.intent_status<>p_expected_status then raise exception 'STALE_INTENT_STATUS'; end if;
 if p_next_status not in ('stripe_pending','requires_action','stripe_confirmed','provisioned','failed','cancelled') then raise exception 'INVALID_NEXT_STATUS'; end if;
 if p_stripe_event_created_at is not null and v_row.stripe_event_created_at is not null and p_stripe_event_created_at<v_row.stripe_event_created_at then raise exception 'STALE_STRIPE_EVENT'; end if;
 update public.module_subscription_upgrade_intents set intent_status=p_next_status,stripe_operation_id=coalesce(p_stripe_operation_id,stripe_operation_id),stripe_invoice_id=coalesce(p_stripe_invoice_id,stripe_invoice_id),stripe_event_id=coalesce(p_stripe_event_id,stripe_event_id),stripe_event_created_at=coalesce(p_stripe_event_created_at,stripe_event_created_at),last_error_code=p_error_code,updated_at=now(),completed_at=case when p_next_status in ('provisioned','failed','cancelled') then now() else completed_at end where id=p_intent_id returning * into v_row;
 return v_row;
end $$;
revoke all on function public.advance_module_subscription_upgrade_intent_v1(uuid,uuid,text,text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.advance_module_subscription_upgrade_intent_v1(uuid,uuid,text,text,text,text,text,timestamptz,text) to service_role;
