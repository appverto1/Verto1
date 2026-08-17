begin;

alter table public.organization_module_access_profiles
  add column if not exists last_stripe_event_created_at timestamptz;
alter table public.organization_module_access_profiles
  add column if not exists last_stripe_event_id text;

-- Stripe does not guarantee event ordering. Fence the organization-level
-- entitlement snapshot so a delayed event from an older offer/subscription
-- cannot replace or cancel the currently active contract.
create or replace function public.apply_sales_offer_module_entitlements_v1(
  p_offer_id uuid,
  p_organization_id uuid,
  p_stripe_subscription_id text,
  p_stripe_event_id text,
  p_status text default 'active'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  offer_row public.sales_offers%rowtype;
  lead_row public.sales_leads%rowtype;
  profile_row public.organization_module_access_profiles%rowtype;
  effective_status text := lower(coalesce(p_status, ''));
  event_key text;
  before_modules jsonb;
  after_modules jsonb;
  selected_modules jsonb;
  selected_count integer := 0;
  unknown_count integer := 0;
  effective_changed boolean := false;
  stale_reason text := null;
  current_offer_effective_at timestamptz := null;
  incoming_offer_effective_at timestamptz := null;
  current_link_created_at timestamptz := null;
  incoming_link_created_at timestamptz := null;
begin
  if auth.role() <> 'service_role' then
    raise exception 'MODULE_ENTITLEMENT_SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_offer_id is null or p_organization_id is null
     or char_length(coalesce(p_stripe_subscription_id, '')) < 3
     or char_length(coalesce(p_stripe_event_id, '')) < 3
     or effective_status not in ('active','trial','grace','suspended','cancelled') then
    raise exception 'MODULE_ENTITLEMENT_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  event_key := 'module-entitlement:' || p_offer_id::text || ':' || p_organization_id::text || ':'
    || left(encode(digest(p_stripe_subscription_id || ':' || p_stripe_event_id || ':' || effective_status, 'sha256'), 'hex'), 64);

  if exists (
    select 1 from public.organization_module_entitlement_events e
    where e.idempotency_key = event_key
  ) then
    select * into profile_row
      from public.organization_module_access_profiles
     where organization_id = p_organization_id;
    return jsonb_build_object(
      'idempotent', true,
      'mode', profile_row.mode,
      'version', profile_row.version,
      'modules', coalesce((
        select jsonb_agg(e.module_key order by e.module_key)
          from public.organization_module_entitlements e
         where e.organization_id = p_organization_id
           and e.status in ('active','trial','grace')
           and e.starts_at <= now()
           and (e.ends_at is null or e.ends_at > now())
      ), '[]'::jsonb)
    );
  end if;

  select * into offer_row
    from public.sales_offers
   where id = p_offer_id
   for update;
  if not found or offer_row.offer_type <> 'modular'
     or offer_row.accepted_at is null or offer_row.revoked_at is not null then
    raise exception 'MODULE_ENTITLEMENT_OFFER_INVALID' using errcode = 'P0001';
  end if;

  select * into lead_row
    from public.sales_leads
   where id = offer_row.lead_id and deleted_at is null
   for update;
  if not found or lead_row.converted_clinic_id is distinct from p_organization_id then
    raise exception 'MODULE_ENTITLEMENT_ORGANIZATION_MISMATCH' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.organization_module_access_profiles p
     where p.stripe_subscription_id = p_stripe_subscription_id
       and p.organization_id <> p_organization_id
  ) then
    raise exception 'MODULE_ENTITLEMENT_SUBSCRIPTION_TENANT_MISMATCH' using errcode = '42501';
  end if;

  -- Every clinic should already have a profile through the initialization
  -- trigger. This insert only closes the race if activation arrives during
  -- clinic creation; it never grants a module by itself.
  insert into public.organization_module_access_profiles (
    organization_id, mode, version, updated_at
  ) values (
    p_organization_id, 'legacy_full', 1, now()
  ) on conflict (organization_id) do nothing;

  select * into profile_row
    from public.organization_module_access_profiles
   where organization_id = p_organization_id
   for update;

  incoming_offer_effective_at := coalesce(offer_row.accepted_at, offer_row.created_at);

  if profile_row.mode = 'contract' then
    if profile_row.source_offer_id is not null then
      select coalesce(o.accepted_at, o.created_at)
        into current_offer_effective_at
        from public.sales_offers o
       where o.id = profile_row.source_offer_id;
    end if;

    -- A terminal lifecycle event may only affect the subscription that is
    -- currently bound to the organization. Delayed cancellations from an old
    -- contract are acknowledged and audited, but never mutate current access.
    if effective_status in ('suspended','cancelled')
       and nullif(profile_row.stripe_subscription_id, '') is not null
       and profile_row.stripe_subscription_id is distinct from p_stripe_subscription_id then
      stale_reason := 'terminal_event_for_non_current_subscription';

    -- An event from a superseded offer cannot roll the organization back to an
    -- older module snapshot even if Stripe delivers it after the replacement.
    elsif profile_row.source_offer_id is not null
       and profile_row.source_offer_id is distinct from p_offer_id
       and current_offer_effective_at is not null
       and incoming_offer_effective_at <= current_offer_effective_at then
      stale_reason := 'event_for_superseded_offer';

    -- Re-created Checkout links can produce more than one subscription for the
    -- same offer. Only a strictly newer evidenced link may replace the current
    -- subscription; duplicate/older subscriptions are ignored.
    elsif profile_row.source_offer_id = p_offer_id
       and nullif(profile_row.stripe_subscription_id, '') is not null
       and profile_row.stripe_subscription_id is distinct from p_stripe_subscription_id then
      select max(l.created_at)
        into current_link_created_at
        from public.sales_checkout_links l
       where l.offer_id = p_offer_id
         and l.stripe_subscription_id = profile_row.stripe_subscription_id;
      select max(l.created_at)
        into incoming_link_created_at
        from public.sales_checkout_links l
       where l.offer_id = p_offer_id
         and l.stripe_subscription_id = p_stripe_subscription_id;

      if incoming_link_created_at is null
         or (current_link_created_at is not null and incoming_link_created_at <= current_link_created_at) then
        stale_reason := 'duplicate_or_older_subscription_for_offer';
      end if;
    end if;
  end if;

  if stale_reason is not null then
    select coalesce(jsonb_agg(x.module_key order by x.module_key), '[]'::jsonb)
      into after_modules
      from (
        select e.module_key
          from public.organization_module_entitlements e
         where e.organization_id = p_organization_id
           and e.status in ('active','trial','grace')
           and e.starts_at <= now()
           and (e.ends_at is null or e.ends_at > now())
      ) x;

    insert into public.organization_module_entitlement_events (
      organization_id, module_key, event_type, source_offer_id,
      stripe_subscription_id, stripe_event_id, idempotency_key, payload
    ) values (
      p_organization_id,
      null,
      'STALE_IGNORED',
      p_offer_id,
      p_stripe_subscription_id,
      p_stripe_event_id,
      event_key,
      jsonb_build_object(
        'reason', stale_reason,
        'incomingStatus', effective_status,
        'currentSourceOfferId', profile_row.source_offer_id,
        'currentStripeSubscriptionId', profile_row.stripe_subscription_id,
        'effectiveModules', after_modules
      )
    ) on conflict (idempotency_key) do nothing;

    return jsonb_build_object(
      'idempotent', false,
      'ignoredStaleEvent', true,
      'reason', stale_reason,
      'mode', profile_row.mode,
      'version', profile_row.version,
      'modules', after_modules
    );
  end if;

  select count(*) into unknown_count
    from public.sales_offer_items i
   where i.offer_id = p_offer_id
     and i.item_key not in (
       'clinical_core','appointments_communication','financial_management','insurance_tiss','school_management',
       'platform_foundation','additional_storage','onboarding'
     );
  if unknown_count > 0 then
    raise exception 'MODULE_ENTITLEMENT_UNKNOWN_MODULE' using errcode = '22023';
  end if;

  select count(*) into selected_count
    from public.sales_offer_items i
   where i.offer_id = p_offer_id
     and i.item_key in ('clinical_core','appointments_communication','financial_management','insurance_tiss','school_management');
  if selected_count < 1 then
    raise exception 'MODULE_ENTITLEMENT_EMPTY_CONTRACT' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(x.module_key order by x.module_key), '[]'::jsonb)
    into before_modules
    from (
      select e.module_key
        from public.organization_module_entitlements e
       where e.organization_id = p_organization_id
         and e.status in ('active','trial','grace')
         and e.starts_at <= now()
         and (e.ends_at is null or e.ends_at > now())
    ) x;

  insert into public.organization_module_access_profiles (
    organization_id, mode, version, source_offer_id, stripe_subscription_id, activated_at, updated_at
  ) values (
    p_organization_id, 'contract', 1, p_offer_id, p_stripe_subscription_id,
    case when effective_status in ('active','trial','grace') then now() else null end, now()
  )
  on conflict (organization_id) do update set
    mode = 'contract',
    source_offer_id = excluded.source_offer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    activated_at = coalesce(public.organization_module_access_profiles.activated_at, excluded.activated_at),
    updated_at = now();

  insert into public.organization_module_entitlements (
    organization_id, module_key, status, source_offer_id, source_offer_item_id,
    stripe_subscription_id, starts_at, ends_at, created_at, updated_at
  )
  select
    p_organization_id,
    i.item_key,
    effective_status,
    p_offer_id,
    (array_agg(i.id order by i.sort_order, i.id))[1],
    p_stripe_subscription_id,
    now(),
    case when effective_status = 'cancelled' then now() else null end,
    now(),
    now()
  from public.sales_offer_items i
  where i.offer_id = p_offer_id
    and i.item_key in ('clinical_core','appointments_communication','financial_management','insurance_tiss','school_management')
  group by i.item_key
  on conflict (organization_id, module_key) do update set
    status = excluded.status,
    source_offer_id = excluded.source_offer_id,
    source_offer_item_id = excluded.source_offer_item_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    starts_at = case
      when excluded.status in ('active','trial','grace') then least(public.organization_module_entitlements.starts_at, now())
      else public.organization_module_entitlements.starts_at
    end,
    ends_at = case when excluded.status = 'cancelled' then now() else null end,
    updated_at = now();

  if effective_status in ('active','trial','grace') then
    update public.organization_module_entitlements e
       set status = 'cancelled', ends_at = now(), updated_at = now()
     where e.organization_id = p_organization_id
       and e.module_key not in (
         select i.item_key from public.sales_offer_items i
          where i.offer_id = p_offer_id
            and i.item_key in ('clinical_core','appointments_communication','financial_management','insurance_tiss','school_management')
       )
       and e.status <> 'cancelled';
  elsif effective_status in ('suspended','cancelled') then
    update public.organization_module_entitlements e
       set status = effective_status,
           ends_at = case when effective_status = 'cancelled' then now() else e.ends_at end,
           updated_at = now()
     where e.organization_id = p_organization_id
       and e.stripe_subscription_id = p_stripe_subscription_id;
  end if;

  select coalesce(jsonb_agg(x.module_key order by x.module_key), '[]'::jsonb)
    into after_modules
    from (
      select e.module_key
        from public.organization_module_entitlements e
       where e.organization_id = p_organization_id
         and e.status in ('active','trial','grace')
         and e.starts_at <= now()
         and (e.ends_at is null or e.ends_at > now())
    ) x;

  effective_changed := before_modules is distinct from after_modules;
  if effective_changed then
    update public.organization_module_access_profiles
       set version = version + 1, updated_at = now()
     where organization_id = p_organization_id;
  end if;

  select coalesce(jsonb_agg(i.item_key order by i.item_key), '[]'::jsonb)
    into selected_modules
    from (
      select distinct item_key
      from public.sales_offer_items
      where offer_id = p_offer_id
        and item_key in ('clinical_core','appointments_communication','financial_management','insurance_tiss','school_management')
    ) i;

  insert into public.organization_module_entitlement_events (
    organization_id, module_key, event_type, source_offer_id,
    stripe_subscription_id, stripe_event_id, idempotency_key, payload
  ) values (
    p_organization_id,
    null,
    upper(effective_status),
    p_offer_id,
    p_stripe_subscription_id,
    p_stripe_event_id,
    event_key,
    jsonb_build_object(
      'selectedModules', selected_modules,
      'effectiveModules', after_modules,
      'effectiveChanged', effective_changed
    )
  ) on conflict (idempotency_key) do nothing;

  select * into profile_row
    from public.organization_module_access_profiles
   where organization_id = p_organization_id;

  return jsonb_build_object(
    'idempotent', false,
    'mode', profile_row.mode,
    'version', profile_row.version,
    'modules', after_modules
  );
end
$function$;

revoke all on function public.apply_sales_offer_module_entitlements_v1(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.apply_sales_offer_module_entitlements_v1(uuid,uuid,text,text,text) to service_role;

-- v2 adds an event-time fence for out-of-order lifecycle events from the SAME
-- Stripe subscription. Keep v1 available during rolling deploys; application
-- code switches to v2 only after this migration is present.
create or replace function public.apply_sales_offer_module_entitlements_v2(
  p_offer_id uuid,
  p_organization_id uuid,
  p_stripe_subscription_id text,
  p_stripe_event_id text,
  p_stripe_event_created_at timestamptz,
  p_status text default 'active'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  profile_row public.organization_module_access_profiles%rowtype;
  result jsonb;
  stale_event_key text;
  effective_modules jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'MODULE_ENTITLEMENT_SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_offer_id is null or p_organization_id is null
     or char_length(coalesce(p_stripe_subscription_id, '')) < 3
     or char_length(coalesce(p_stripe_event_id, '')) < 3
     or p_stripe_event_created_at is null then
    raise exception 'MODULE_ENTITLEMENT_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  -- Close only the clinic-creation race. This row alone grants no contract
  -- module; v1 will validate the offer/tenant before changing access.
  insert into public.organization_module_access_profiles (
    organization_id, mode, version, updated_at
  ) values (
    p_organization_id, 'legacy_full', 1, now()
  ) on conflict (organization_id) do nothing;

  select * into profile_row
    from public.organization_module_access_profiles
   where organization_id = p_organization_id
   for update;

  if profile_row.mode = 'contract'
     and profile_row.source_offer_id = p_offer_id
     and profile_row.stripe_subscription_id = p_stripe_subscription_id
     and profile_row.last_stripe_event_created_at is not null
     and p_stripe_event_created_at < profile_row.last_stripe_event_created_at then
    select coalesce(jsonb_agg(x.module_key order by x.module_key), '[]'::jsonb)
      into effective_modules
      from (
        select e.module_key
          from public.organization_module_entitlements e
         where e.organization_id = p_organization_id
           and e.status in ('active','trial','grace')
           and e.starts_at <= now()
           and (e.ends_at is null or e.ends_at > now())
      ) x;

    stale_event_key := 'module-entitlement-stale-time:'
      || left(encode(digest(
        p_organization_id::text || ':' || p_stripe_subscription_id || ':' || p_stripe_event_id,
        'sha256'
      ), 'hex'), 64);

    insert into public.organization_module_entitlement_events (
      organization_id, module_key, event_type, source_offer_id,
      stripe_subscription_id, stripe_event_id, idempotency_key, payload
    ) values (
      p_organization_id, null, 'STALE_IGNORED', p_offer_id,
      p_stripe_subscription_id, p_stripe_event_id, stale_event_key,
      jsonb_build_object(
        'reason', 'older_event_for_current_subscription',
        'incomingStripeEventCreatedAt', p_stripe_event_created_at,
        'lastStripeEventCreatedAt', profile_row.last_stripe_event_created_at,
        'lastStripeEventId', profile_row.last_stripe_event_id,
        'effectiveModules', effective_modules
      )
    ) on conflict (idempotency_key) do nothing;

    return jsonb_build_object(
      'idempotent', false,
      'ignoredStaleEvent', true,
      'reason', 'older_event_for_current_subscription',
      'mode', profile_row.mode,
      'version', profile_row.version,
      'modules', effective_modules
    );
  end if;

  result := public.apply_sales_offer_module_entitlements_v1(
    p_offer_id,
    p_organization_id,
    p_stripe_subscription_id,
    p_stripe_event_id,
    p_status
  );

  -- Record ordering only when v1 actually left this offer/subscription as the
  -- current binding. A stale event for another offer/subscription must not
  -- advance the fence of the active contract.
  if coalesce((result ->> 'ignoredStaleEvent')::boolean, false) = false then
    update public.organization_module_access_profiles p
       set last_stripe_event_created_at = case
             when p.last_stripe_event_created_at is null
               or p_stripe_event_created_at >= p.last_stripe_event_created_at
             then p_stripe_event_created_at
             else p.last_stripe_event_created_at
           end,
           last_stripe_event_id = case
             when p.last_stripe_event_created_at is null
               or p_stripe_event_created_at >= p.last_stripe_event_created_at
             then p_stripe_event_id
             else p.last_stripe_event_id
           end,
           updated_at = now()
     where p.organization_id = p_organization_id
       and p.mode = 'contract'
       and p.source_offer_id = p_offer_id
       and p.stripe_subscription_id = p_stripe_subscription_id;
  end if;

  return result || jsonb_build_object(
    'stripeEventCreatedAt', p_stripe_event_created_at
  );
end
$function$;

revoke all on function public.apply_sales_offer_module_entitlements_v2(uuid,uuid,text,text,timestamptz,text) from public, anon, authenticated;
grant execute on function public.apply_sales_offer_module_entitlements_v2(uuid,uuid,text,text,timestamptz,text) to service_role;

notify pgrst, 'reload schema';
commit;

select
  position('STALE_IGNORED' in pg_get_functiondef('public.apply_sales_offer_module_entitlements_v1(uuid,uuid,text,text,text)'::regprocedure)) > 0
    as stale_event_fence_ready,
  position('for update' in lower(pg_get_functiondef('public.apply_sales_offer_module_entitlements_v1(uuid,uuid,text,text,text)'::regprocedure))) > 0
    as entitlement_profile_lock_ready,
  position('terminal_event_for_non_current_subscription' in pg_get_functiondef('public.apply_sales_offer_module_entitlements_v1(uuid,uuid,text,text,text)'::regprocedure)) > 0
    as stale_terminal_event_guard_ready,
  position('older_event_for_current_subscription' in pg_get_functiondef('public.apply_sales_offer_module_entitlements_v2(uuid,uuid,text,text,timestamptz,text)'::regprocedure)) > 0
    as same_subscription_event_time_fence_ready,
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'organization_module_access_profiles'
       and column_name = 'last_stripe_event_created_at'
  ) as stripe_event_order_checkpoint_ready;
