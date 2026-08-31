begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Idempotent repair for environments where application code advanced ahead of
-- the database schema. No historical rows are rewritten.
do $guard$
begin
  if to_regclass('public.users') is null
     or to_regclass('public.sales_offers') is null
     or to_regclass('public.sales_leads') is null
     or to_regclass('public.sales_lead_events') is null then
    raise exception 'SALES_OWNER_FINANCE_CANONICAL_SCHEMA_REQUIRED';
  end if;

  if to_regprocedure('public.create_sales_modular_offer_v2(uuid,uuid,uuid,text,text,text,timestamptz)') is null then
    raise exception 'SALES_MODULAR_OFFER_V2_REQUIRED';
  end if;
end
$guard$;

-- Owner Finance / complimentary-plan metadata. These columns were already
-- consumed by the backend but had never been introduced by a migration.
alter table public.users
  add column if not exists billing_source text,
  add column if not exists complimentary_plan_granted_at timestamptz,
  add column if not exists complimentary_plan_granted_by uuid,
  add column if not exists complimentary_plan_note text;

do $users_constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.users'::regclass
      and conname = 'users_billing_source_check'
  ) then
    alter table public.users
      add constraint users_billing_source_check
      check (billing_source is null or billing_source in ('stripe', 'complimentary'));
  end if;
end
$users_constraint$;

comment on column public.users.billing_source is
  'Optional billing origin used by Owner Finance. Null is treated as ordinary Stripe/commercial billing; complimentary is explicit.';
comment on column public.users.complimentary_plan_granted_at is
  'Audit timestamp for an explicitly granted complimentary plan.';
comment on column public.users.complimentary_plan_granted_by is
  'Platform admin user id that explicitly granted a complimentary plan.';
comment on column public.users.complimentary_plan_note is
  'Administrative note for an explicitly granted complimentary plan.';

-- Contract identity required by the modular public-offer creation boundary.
alter table public.sales_offers
  add column if not exists contract_email text;

do $offer_constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sales_offers'::regclass
      and conname = 'sales_offers_contract_email_check'
  ) then
    alter table public.sales_offers
      add constraint sales_offers_contract_email_check
      check (
        contract_email is null
        or (
          contract_email = lower(btrim(contract_email))
          and char_length(contract_email) between 3 and 254
          and position('@' in contract_email) > 1
        )
      );
  end if;
end
$offer_constraint$;

comment on column public.sales_offers.contract_email is
  'Immutable contracting identity frozen when a new modular public offer is created. Historical offers remain null.';

-- Keep contract_email inside the same immutable commercial boundary as the
-- other modular snapshot fields.
create or replace function public.protect_sales_modular_offer_financials_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  creation_mode boolean := coalesce(current_setting('verto.modular_offer_creation', true), '') = 'on';
begin
  if tg_op = 'DELETE' and old.offer_type = 'modular' then
    raise exception 'SALES_MODULAR_OFFER_IMMUTABLE' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE'
     and (
       new.offer_type is distinct from old.offer_type
       or (
         old.offer_type = 'modular'
         and (
           new.lead_id is distinct from old.lead_id
           or new.simulation_id is distinct from old.simulation_id
           or new.simulation_snapshot is distinct from old.simulation_snapshot
           or new.base_unit_amount_cents is distinct from old.base_unit_amount_cents
           or new.currency is distinct from old.currency
           or new.initial_active_patient_quantity is distinct from old.initial_active_patient_quantity
           or new.discount_duration_months is distinct from old.discount_duration_months
           or new.discount_type is distinct from old.discount_type
           or new.discount_percentage is distinct from old.discount_percentage
           or new.promotional_monthly_amount_cents is distinct from old.promotional_monthly_amount_cents
           or new.post_discount_monthly_amount_cents is distinct from old.post_discount_monthly_amount_cents
           or new.internal_justification is distinct from old.internal_justification
           or new.public_token_hash is distinct from old.public_token_hash
           or new.expires_at is distinct from old.expires_at
           or new.created_by is distinct from old.created_by
           or new.idempotency_key is distinct from old.idempotency_key
           or new.catalog_version_id is distinct from old.catalog_version_id
           or new.proposal_name is distinct from old.proposal_name
           or new.public_notes is distinct from old.public_notes
           or (not creation_mode and new.modular_checkout_enabled is distinct from old.modular_checkout_enabled)
           or (not creation_mode and new.trial_days is distinct from old.trial_days)
           or (not creation_mode and new.modular_snapshot is distinct from old.modular_snapshot)
           or (not creation_mode and new.contract_email is distinct from old.contract_email)
           or new.request_hash is distinct from old.request_hash
         )
       )
     ) then
    raise exception 'SALES_MODULAR_OFFER_FINANCIALS_IMMUTABLE' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;

-- Restore the atomic wrapper used by POST /api/owner/sales/offers. The email is
-- frozen in the same database transaction as offer creation/reuse; there is no
-- unsafe server-side create-then-update fallback.
create or replace function public.create_sales_modular_offer_v3(
  p_simulation_id uuid,
  p_lead_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_public_token_hash text,
  p_expires_at timestamptz,
  p_contract_email text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  result jsonb;
  offer_id uuid;
  normalized_contract_email text := nullif(lower(btrim(p_contract_email)), '');
  refreshed_offer public.sales_offers%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SALES_MODULAR_OFFER_SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if normalized_contract_email is null
     or char_length(normalized_contract_email) > 254
     or position('@' in normalized_contract_email) < 2 then
    raise exception 'PROPOSAL_CONTRACT_EMAIL_REQUIRED' using errcode = '22023';
  end if;

  perform set_config('verto.modular_offer_creation', 'on', true);
  result := public.create_sales_modular_offer_v2(
    p_simulation_id,
    p_lead_id,
    p_actor_user_id,
    p_idempotency_key,
    p_request_hash,
    p_public_token_hash,
    p_expires_at
  );
  offer_id := nullif(result #>> '{offer,id}', '')::uuid;
  if offer_id is null then
    raise exception 'PROPOSAL_SNAPSHOT_CONFLICT' using errcode = 'P0001';
  end if;

  if coalesce((result->>'idempotent')::boolean, false) = false then
    update public.sales_offers
       set contract_email = normalized_contract_email,
           updated_at = now()
     where id = offer_id
       and offer_type = 'modular'
     returning * into refreshed_offer;
    if not found then
      raise exception 'PROPOSAL_SNAPSHOT_CONFLICT' using errcode = 'P0001';
    end if;
    result := jsonb_set(result, '{offer}', to_jsonb(refreshed_offer), true);
  else
    select * into refreshed_offer
      from public.sales_offers
     where id = offer_id;
    if not found
       or nullif(lower(btrim(refreshed_offer.contract_email)), '') is distinct from normalized_contract_email then
      raise exception 'PROPOSAL_CONTRACT_EMAIL_MISMATCH' using errcode = '23514';
    end if;
    result := jsonb_set(result, '{offer}', to_jsonb(refreshed_offer), true);
  end if;

  return result;
end
$function$;

revoke all on function public.create_sales_modular_offer_v3(uuid,uuid,uuid,text,text,text,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.create_sales_modular_offer_v3(uuid,uuid,uuid,text,text,text,timestamptz,text)
  to service_role;

comment on function public.create_sales_modular_offer_v3(uuid,uuid,uuid,text,text,text,timestamptz,text) is
  'Creates/reuses a modular sales offer while freezing the contracting email atomically.';

notify pgrst, 'reload schema';

commit;
