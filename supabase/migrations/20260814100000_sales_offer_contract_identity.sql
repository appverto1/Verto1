begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $guard$
begin
  if to_regclass('public.sales_offers') is null
     or to_regclass('public.sales_leads') is null
     or to_regclass('public.sales_lead_events') is null then
    raise exception 'SALES_CONTRACT_IDENTITY_CANONICAL_SCHEMA_REQUIRED';
  end if;
end
$guard$;

alter table public.sales_offers
  add column if not exists contract_email text;

do $constraint$
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
$constraint$;

comment on column public.sales_offers.contract_email is
  'Immutable contracting identity frozen when a new modular public offer is created. Historical offers remain null and must not be backfilled from mutable lead data.';

-- Keep the existing modular offer immutability boundary and add contract_email to
-- the frozen commercial identity. Stripe linkage/status fields remain operational.
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

-- Versioned wrapper: the email chosen by Platform Admin is frozen atomically in
-- the same transaction as the modular offer. It never mutates sales_leads.
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
  'Creates/reuses a modular sales offer while freezing the contracting email without mutating lead identity.';

-- Reconcile payment against the immutable contract identity for new modular
-- offers. Legacy offers keep their prior lead-email adoption/mismatch behavior.
create or replace function public.confirm_sales_assisted_checkout_payment(
  p_offer_id uuid,
  p_lead_id uuid,
  p_checkout_session_id text,
  p_customer_email text,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_payment_status text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_offer public.sales_offers%rowtype;
  v_lead public.sales_leads%rowtype;
  v_customer_email text := nullif(lower(btrim(p_customer_email)), '');
  v_contract_email text;
  v_current_email text;
  v_email_state text := 'matched';
  v_email_collision boolean := false;
  v_email_mismatch boolean := false;
  v_offer_requires_review boolean := false;
  v_rows integer := 0;
begin
  if p_offer_id is null
     or p_lead_id is null
     or nullif(btrim(p_checkout_session_id), '') is null
     or v_customer_email is null
     or position('@' in v_customer_email) < 2
     or char_length(v_customer_email) > 254
     or char_length(coalesce(p_idempotency_key, '')) not between 12 and 240 then
    raise exception 'SALES_CHECKOUT_PAYMENT_INPUT_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('sales-checkout-offer:' || p_offer_id::text, 0)
  );

  select *
    into v_offer
    from public.sales_offers
   where id = p_offer_id
     and lead_id = p_lead_id
   for update;

  if not found then
    raise exception 'SALES_OFFER_NOT_FOUND' using errcode = 'P0002';
  end if;

  if nullif(btrim(v_offer.stripe_checkout_session_id), '') is not null
     and v_offer.stripe_checkout_session_id <> p_checkout_session_id then
    raise exception 'SALES_CHECKOUT_SESSION_MISMATCH' using errcode = '23514';
  end if;

  select *
    into v_lead
    from public.sales_leads
   where id = p_lead_id
     and deleted_at is null
   for update;

  if not found then
    raise exception 'SALES_LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_offer_requires_review := v_offer.revoked_at is not null
    or v_offer.status::text in ('cancelled', 'expired');

  update public.sales_offers
     set status = 'paid',
         stripe_customer_id = coalesce(nullif(btrim(p_stripe_customer_id), ''), stripe_customer_id),
         stripe_checkout_session_id = p_checkout_session_id,
         stripe_subscription_id = coalesce(nullif(btrim(p_stripe_subscription_id), ''), stripe_subscription_id),
         checkout_email = v_customer_email,
         payment_confirmed_at = coalesce(payment_confirmed_at, now()),
         accepted_at = coalesce(accepted_at, now()),
         provisioning_status = case when v_offer_requires_review then 'review_required' else 'pending' end,
         provisioning_error_code = case when v_offer_requires_review then 'OFFER_STATE_REVIEW_REQUIRED' else null end,
         provisioning_updated_at = now(),
         updated_at = now()
   where id = p_offer_id
     and lead_id = p_lead_id;

  update public.sales_leads
     set status = 'payment_pending', updated_at = now()
   where id = p_lead_id
     and deleted_at is null;

  insert into public.sales_lead_events (lead_id, event_type, metadata, idempotency_key)
  values (
    p_lead_id,
    'payment_completed',
    jsonb_build_object(
      'offer_id', p_offer_id,
      'checkout_session_id', p_checkout_session_id,
      'payment_status', left(coalesce(p_payment_status, 'paid'), 40)
    ),
    p_idempotency_key
  )
  on conflict (idempotency_key) do nothing;

  v_contract_email := nullif(lower(btrim(v_offer.contract_email)), '');

  if v_offer.offer_type = 'modular' and v_contract_email is not null then
    v_current_email := v_contract_email;
    if v_current_email <> v_customer_email then
      v_email_state := 'mismatch';
      v_email_mismatch := true;
    end if;
  else
    v_current_email := nullif(lower(btrim(coalesce(v_lead.normalized_email, v_lead.email, ''))), '');

    if v_current_email is null then
      perform pg_advisory_xact_lock(
        hashtextextended('sales-checkout-email:' || v_customer_email, 0)
      );

      select exists (
        select 1
        from public.sales_leads other_lead
        where other_lead.id <> p_lead_id
          and other_lead.deleted_at is null
          and lower(btrim(coalesce(other_lead.normalized_email, other_lead.email, ''))) = v_customer_email
      ) into v_email_collision;

      if not v_email_collision then
        begin
          update public.sales_leads
             set email = v_customer_email,
                 normalized_email = v_customer_email,
                 updated_at = now()
           where id = p_lead_id
             and deleted_at is null
             and nullif(btrim(coalesce(normalized_email, email, '')), '') is null;
          get diagnostics v_rows = row_count;
        exception when unique_violation then
          v_rows := 0;
          v_email_collision := true;
        end;

        if v_rows = 1 then
          v_email_state := 'adopted';
        else
          select nullif(lower(btrim(coalesce(normalized_email, email, ''))), '')
            into v_current_email
            from public.sales_leads
           where id = p_lead_id;
          if v_current_email = v_customer_email then
            v_email_state := 'matched';
          else
            v_email_collision := true;
          end if;
        end if;
      end if;

      if v_email_collision then
        v_email_state := 'collision';
        insert into public.sales_lead_events (lead_id, event_type, metadata, idempotency_key)
        values (
          p_lead_id,
          'lead_updated',
          jsonb_build_object(
            'offer_id', p_offer_id,
            'checkout_session_id', p_checkout_session_id,
            'review_reason', 'checkout_email_collision'
          ),
          'checkout-email-collision:' || p_checkout_session_id
        )
        on conflict (idempotency_key) do nothing;
      end if;
    elsif v_current_email <> v_customer_email then
      v_email_state := 'mismatch';
      v_email_mismatch := true;
    end if;
  end if;

  if v_email_mismatch then
    update public.sales_offers
       set provisioning_status = 'review_required',
           provisioning_error_code = 'CHECKOUT_EMAIL_MISMATCH',
           provisioning_updated_at = now(),
           updated_at = now()
     where id = p_offer_id;

    insert into public.sales_lead_events (lead_id, event_type, metadata, idempotency_key)
    values (
      p_lead_id,
      'lead_updated',
      jsonb_build_object(
        'offer_id', p_offer_id,
        'checkout_session_id', p_checkout_session_id,
        'review_reason', 'checkout_email_mismatch'
      ),
      'checkout-email-mismatch:' || p_checkout_session_id
    )
    on conflict (idempotency_key) do nothing;
  end if;

  return jsonb_build_object(
    'payment_persisted', true,
    'email_state', v_email_state,
    'email_collision', v_email_collision,
    'email_mismatch', v_email_mismatch,
    'review_required', v_offer_requires_review or v_email_mismatch
  );
end
$function$;

revoke all on function public.confirm_sales_assisted_checkout_payment(
  uuid, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.confirm_sales_assisted_checkout_payment(
  uuid, uuid, text, text, text, text, text, text
) to postgres, service_role;

comment on function public.confirm_sales_assisted_checkout_payment(
  uuid, uuid, text, text, text, text, text, text
) is 'Atomically persists assisted-sales Checkout. New modular offers reconcile against immutable sales_offers.contract_email; legacy offers preserve prior lead-email behavior.';

notify pgrst, 'reload schema';

commit;
