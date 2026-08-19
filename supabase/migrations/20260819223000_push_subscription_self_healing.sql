-- Push subscription self-healing for patient portal devices.
-- Keeps invalid endpoints long enough to be rebound securely by the service worker,
-- without requiring an authenticated page reload/F5.

alter table public.push_subscriptions
  add column if not exists renewal_token_hash text,
  add column if not exists renewal_token_created_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists invalidated_at timestamptz;

create unique index if not exists idx_push_subscriptions_renewal_token_hash
  on public.push_subscriptions(renewal_token_hash)
  where renewal_token_hash is not null;

create index if not exists idx_push_subscriptions_active_patient
  on public.push_subscriptions(patient_id, updated_at desc)
  where invalidated_at is null;

create index if not exists idx_push_subscriptions_invalidated_at
  on public.push_subscriptions(invalidated_at)
  where invalidated_at is not null;

-- Push subscriptions are backend-owned. Browser access goes through validated API routes.
alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;

-- Rotate a service-worker renewal token and rebind the browser endpoint atomically.
-- Any exception rolls the duplicate cleanup back, so a race cannot orphan the subscription.
create or replace function public.renew_push_subscription_v1(
  p_renewal_token_hash text,
  p_next_renewal_token_hash text,
  p_new_endpoint text,
  p_p256dh text,
  p_auth text,
  p_subscription jsonb
)
returns table(success boolean, patient_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription public.push_subscriptions%rowtype;
  v_owner_id uuid;
  v_owner_patient_id uuid;
  v_now timestamptz := now();
begin
  if p_renewal_token_hash is null
     or p_renewal_token_hash !~ '^[a-f0-9]{64}$'
     or p_next_renewal_token_hash is null
     or p_next_renewal_token_hash !~ '^[a-f0-9]{64}$'
     or coalesce(length(p_new_endpoint), 0) < 1
     or length(p_new_endpoint) > 2000
     or coalesce(length(p_p256dh), 0) < 1
     or length(p_p256dh) > 2000
     or coalesce(length(p_auth), 0) < 1
     or length(p_auth) > 2000
     or p_subscription is null
     or jsonb_typeof(p_subscription) <> 'object'
  then
    raise exception 'PUSH_RENEWAL_INVALID';
  end if;

  select ps.*
    into v_subscription
    from public.push_subscriptions ps
   where ps.renewal_token_hash = p_renewal_token_hash
   for update;

  if not found or v_subscription.patient_id is null then
    raise exception 'PUSH_RENEWAL_TOKEN_INVALID';
  end if;

  select ps.id, ps.patient_id
    into v_owner_id, v_owner_patient_id
    from public.push_subscriptions ps
   where ps.endpoint = p_new_endpoint
     and ps.id <> v_subscription.id
   for update;

  if found then
    if v_owner_patient_id is distinct from v_subscription.patient_id then
      raise exception 'PUSH_RENEWAL_ENDPOINT_OWNERSHIP_CONFLICT';
    end if;

    delete from public.push_subscriptions
     where id = v_owner_id
       and patient_id = v_subscription.patient_id;
  end if;

  update public.push_subscriptions
     set endpoint = p_new_endpoint,
         p256dh = p_p256dh,
         auth = p_auth,
         subscription = p_subscription,
         renewal_token_hash = p_next_renewal_token_hash,
         renewal_token_created_at = v_now,
         last_seen_at = v_now,
         invalidated_at = null,
         updated_at = v_now
   where id = v_subscription.id
     and renewal_token_hash = p_renewal_token_hash;

  if not found then
    raise exception 'PUSH_RENEWAL_RACE_LOST';
  end if;

  return query select true, v_subscription.patient_id;
end;
$$;

revoke all on function public.renew_push_subscription_v1(text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.renew_push_subscription_v1(text, text, text, text, text, jsonb) to service_role;
