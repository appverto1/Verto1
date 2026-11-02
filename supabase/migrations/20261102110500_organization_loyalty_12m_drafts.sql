-- Staging-first 12-month Verto loyalty draft.
-- Records proposed terms for paid clinics; intentionally NEVER changes Stripe,
-- billing access, clinical data, or the existing capacity billing contracts.
-- There is no active/enforceable state until legal review + consent are built.

begin;

create table if not exists public.organization_loyalty_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  stripe_subscription_id text not null,
  duration_months smallint not null default 12 check (duration_months = 12),
  penalty_policy text not null default 'proportional_pending_legal_review'
    check (penalty_policy = 'proportional_pending_legal_review'),
  legal_review_status text not null default 'pending_review'
    check (legal_review_status = 'pending_review'),
  status text not null default 'draft' check (status = 'draft'),
  terms_version smallint not null default 1 check (terms_version = 1),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id)
);

comment on table public.organization_loyalty_drafts is
  'Non-binding owner-created loyalty proposals. No Stripe charge, renewal, suspension, or penalty enforcement. Separate legal approval and customer acceptance required.';

alter table public.organization_loyalty_drafts enable row level security;
revoke all on table public.organization_loyalty_drafts from public, anon, authenticated;
grant select, insert on table public.organization_loyalty_drafts to service_role;

-- One atomic, idempotent operation. Trust canonical paid subscription state,
-- never a caller-supplied subscription id, role, clinic name, or payment amount.
create or replace function public.create_organization_loyalty_draft_v1(
  p_organization_id uuid,
  p_actor_user_id uuid
) returns public.organization_loyalty_drafts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_subscription_id text;
  v_row public.organization_loyalty_drafts;
begin
  if p_organization_id is null or p_actor_user_id is null
     or not exists (
       select 1 from public.platform_admins pa
       where pa.user_id = p_actor_user_id and pa.active is true
     ) then
    raise exception 'LOYALTY_OWNER_REQUIRED';
  end if;

  -- The ledger is authoritative; no checkout, Stripe write or clinical query.
  select state.stripe_subscription_id into v_subscription_id
  from public.platform_subscription_financial_state state
  where state.organization_id = p_organization_id
    and state.stripe_status = 'active'
    and (state.first_paid_at is not null or state.last_paid_at is not null)
  limit 1
  for share;

  if v_subscription_id is null then
    raise exception 'LOYALTY_ACTIVE_PAID_SUBSCRIPTION_REQUIRED';
  end if;

  insert into public.organization_loyalty_drafts (
    organization_id, stripe_subscription_id, created_by
  )
  values (p_organization_id, v_subscription_id, p_actor_user_id)
  on conflict (organization_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
    from public.organization_loyalty_drafts
    where organization_id = p_organization_id;
  end if;

  if v_row.id is null or v_row.stripe_subscription_id is distinct from v_subscription_id then
    raise exception 'LOYALTY_SUBSCRIPTION_CHANGED';
  end if;
  return v_row;
end;
$function$;

revoke all on function public.create_organization_loyalty_draft_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_organization_loyalty_draft_v1(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';

commit;
