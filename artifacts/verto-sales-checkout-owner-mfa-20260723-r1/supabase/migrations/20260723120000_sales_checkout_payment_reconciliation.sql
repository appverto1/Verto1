-- Reconcile paid assisted-sales Checkouts with minimal leads.
-- Payment is persisted atomically before activation/email provisioning.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $guard$
begin
  if to_regclass('public.sales_leads') is null
     or to_regclass('public.sales_lead_events') is null
     or to_regclass('public.sales_offers') is null
     or to_regclass('public.pending_activations') is null
     or to_regclass('public.stripe_webhook_events') is null then
    raise exception 'SALES_CHECKOUT_CANONICAL_SCHEMA_REQUIRED';
  end if;
end
$guard$;

alter table public.sales_offers
  add column if not exists checkout_email text,
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists provisioning_status text not null default 'not_started',
  add column if not exists provisioning_error_code text,
  add column if not exists provisioning_updated_at timestamptz;

do $constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sales_offers'::regclass
      and conname = 'sales_offers_provisioning_status_check'
  ) then
    alter table public.sales_offers
      add constraint sales_offers_provisioning_status_check
      check (provisioning_status in (
        'not_started', 'pending', 'email_pending', 'completed',
        'review_required', 'failed'
      ));
  end if;
end
$constraint$;

alter table public.pending_activations
  add column if not exists activation_email_attempts integer not null default 0,
  add column if not exists activation_email_last_attempt_at timestamptz,
  add column if not exists activation_email_error_code text;

alter table public.stripe_webhook_events
  add column if not exists attempt_count integer not null default 1,
  add column if not exists last_error_code text,
  add column if not exists updated_at timestamptz not null default now();

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
         stripe_customer_id = coalesce(
           nullif(btrim(p_stripe_customer_id), ''),
           stripe_customer_id
         ),
         stripe_checkout_session_id = p_checkout_session_id,
         stripe_subscription_id = coalesce(
           nullif(btrim(p_stripe_subscription_id), ''),
           stripe_subscription_id
         ),
         checkout_email = v_customer_email,
         payment_confirmed_at = coalesce(payment_confirmed_at, now()),
         accepted_at = coalesce(accepted_at, now()),
         provisioning_status = case
           when v_offer_requires_review then 'review_required'
           else 'pending'
         end,
         provisioning_error_code = case
           when v_offer_requires_review then 'OFFER_STATE_REVIEW_REQUIRED'
           else null
         end,
         provisioning_updated_at = now(),
         updated_at = now()
   where id = p_offer_id
     and lead_id = p_lead_id;

  update public.sales_leads
     set status = 'payment_pending',
         updated_at = now()
   where id = p_lead_id
     and deleted_at is null;

  insert into public.sales_lead_events (
    lead_id, event_type, metadata, idempotency_key
  ) values (
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
      insert into public.sales_lead_events (
        lead_id, event_type, metadata, idempotency_key
      ) values (
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

    update public.sales_offers
       set provisioning_status = 'review_required',
           provisioning_error_code = 'CHECKOUT_EMAIL_MISMATCH',
           provisioning_updated_at = now(),
           updated_at = now()
     where id = p_offer_id;

    insert into public.sales_lead_events (
      lead_id, event_type, metadata, idempotency_key
    ) values (
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
) is 'Atomically persists a signed paid assisted-sales Checkout and safely adopts a missing lead email.';

notify pgrst, 'reload schema';

commit;
