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
    check (legal_review_status in ('pending_review', 'owner_approved')),
  status text not null default 'draft' check (status in ('draft', 'offered', 'accepted')),
  terms_version smallint not null default 1 check (terms_version = 1),
  created_by uuid not null,
  -- Filled only when the Super Admin explicitly saves a complete offer.
  verto_legal_name text,
  verto_cnpj text,
  verto_address text,
  clinic_legal_name text,
  clinic_cnpj text,
  clinic_address text,
  benefit_description text,
  benefit_value_cents integer check (benefit_value_cents is null or benefit_value_cents > 0),
  benefit_conditions text,
  monthly_reference_cents integer check (monthly_reference_cents is null or monthly_reference_cents > 0),
  effective_start_date date,
  effective_end_date date,
  terms_text text,
  terms_sha256 text,
  offered_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references public.users(id) on delete restrict,
  accepted_by_name text,
  accepted_by_email text,
  constraint loyalty_accepted_complete check (
    status <> 'accepted'
    or (accepted_at is not null and accepted_by is not null
        and terms_sha256 is not null and effective_start_date is not null
        and effective_end_date is not null)
  ),
  created_at timestamptz not null default now(),
  unique (organization_id)
);

comment on table public.organization_loyalty_drafts is
  'Staging-only contract offer and accepted snapshot; never changes Stripe billing, access or clinical data. Owner saves completed offer, clinic director expressly accepts.';

alter table public.organization_loyalty_drafts enable row level security;
revoke all on table public.organization_loyalty_drafts from public, anon, authenticated;
grant select, insert, update on table public.organization_loyalty_drafts to service_role;

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


-- Contract offer is a single manual Save operation; no frontend field can
-- directly update the draft, dates, subscription or access grants.
create or replace function public.publish_organization_loyalty_offer_v1(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_verto_legal_name text,
  p_verto_cnpj text,
  p_verto_address text,
  p_clinic_legal_name text,
  p_clinic_cnpj text,
  p_clinic_address text,
  p_benefit_description text,
  p_benefit_value_cents integer,
  p_benefit_conditions text,
  p_monthly_reference_cents integer,
  p_effective_start_date date,
  p_terms_text text
) returns public.organization_loyalty_drafts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_draft public.organization_loyalty_drafts;
  v_current_subscription text;
  v_hash text;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_actor_user_id is null or not exists (
    select 1 from public.platform_admins pa
    where pa.user_id = p_actor_user_id and pa.active
  ) then raise exception 'LOYALTY_OWNER_REQUIRED'; end if;

  if length(trim(coalesce(p_verto_legal_name, ''))) not between 3 and 200
    or length(trim(coalesce(p_verto_address, ''))) not between 8 and 400
    or length(trim(coalesce(p_clinic_legal_name, ''))) not between 3 and 200
    or length(trim(coalesce(p_clinic_address, ''))) not between 8 and 400
    or regexp_replace(coalesce(p_verto_cnpj, ''), '[^0-9]', '', 'g') !~ '^[0-9]{14}$'    or regexp_replace(coalesce(p_clinic_cnpj, ''), '[^0-9]', '', 'g') !~ '^[0-9]{14}$'    or length(trim(coalesce(p_benefit_description, ''))) not between 10 and 500
    or length(trim(coalesce(p_benefit_conditions, ''))) not between 10 and 1000
    or p_benefit_value_cents is null or p_benefit_value_cents <= 0
    or p_monthly_reference_cents is null or p_monthly_reference_cents <= 0
    or p_effective_start_date is null or p_effective_start_date < v_today
    or length(coalesce(p_terms_text, '')) not between 3000 and 18000
    or position('{{' in p_terms_text) > 0
  then raise exception 'LOYALTY_OFFER_INCOMPLETE'; end if;

  select * into v_draft from public.organization_loyalty_drafts
  where organization_id = p_organization_id for update;
  if not found then raise exception 'LOYALTY_DRAFT_NOT_FOUND'; end if;

  select state.stripe_subscription_id into v_current_subscription
  from public.platform_subscription_financial_state state
  where state.organization_id = p_organization_id
    and state.stripe_status = 'active'
    and (state.first_paid_at is not null or state.last_paid_at is not null)
  limit 1 for share;
  if v_current_subscription is null
    or v_current_subscription is distinct from v_draft.stripe_subscription_id
  then raise exception 'LOYALTY_SUBSCRIPTION_INELIGIBLE'; end if;

  v_hash := encode(extensions.digest(convert_to(p_terms_text, 'UTF8'), 'sha256'), 'hex');
  if v_draft.status = 'offered' and v_draft.terms_sha256 = v_hash then return v_draft; end if;
  if v_draft.status <> 'draft' then raise exception 'LOYALTY_OFFER_ALREADY_FINALIZED'; end if;

  update public.organization_loyalty_drafts set
    verto_legal_name = trim(p_verto_legal_name),
    verto_cnpj = regexp_replace(p_verto_cnpj, '[^0-9]', '', 'g'),
    verto_address = trim(p_verto_address),
    clinic_legal_name = trim(p_clinic_legal_name),
    clinic_cnpj = regexp_replace(p_clinic_cnpj, '[^0-9]', '', 'g'),
    clinic_address = trim(p_clinic_address),
    benefit_description = trim(p_benefit_description),
    benefit_value_cents = p_benefit_value_cents,
    benefit_conditions = trim(p_benefit_conditions),
    monthly_reference_cents = p_monthly_reference_cents,
    effective_start_date = p_effective_start_date,
    effective_end_date = (p_effective_start_date + interval '12 months' - interval '1 day')::date,
    terms_text = p_terms_text,
    terms_sha256 = v_hash,
    status = 'offered',
    legal_review_status = 'owner_approved',
    offered_at = now()
  where id = v_draft.id
  returning * into v_draft;
  return v_draft;
end;
$function$;

-- Only a currently active director of THIS clinic can accept; web UI,
-- active workspace, session role and supplied IDs are not sufficient.
create or replace function public.accept_organization_loyalty_offer_v1(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_terms_sha256 text,
  p_confirmed boolean
) returns public.organization_loyalty_drafts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.organization_loyalty_drafts;
  v_actor_name text;
  v_actor_email text;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_confirmed is distinct from true or p_actor_user_id is null
    or not exists (
      select 1 from public.clinic_memberships cm
      where cm.clinic_id = p_organization_id and cm.user_id = p_actor_user_id
        and cm.role = 'director' and cm.status = 'active'
    )
  then raise exception 'LOYALTY_DIRECTOR_REQUIRED'; end if;

  select * into v_row from public.organization_loyalty_drafts
    where organization_id = p_organization_id for update;
  if not found then raise exception 'LOYALTY_OFFER_NOT_FOUND'; end if;
  if v_row.status = 'accepted' and v_row.accepted_by = p_actor_user_id
     and v_row.terms_sha256 = p_terms_sha256 then return v_row; end if;
  if v_row.status <> 'offered' or v_row.legal_review_status <> 'owner_approved'
     or v_row.terms_sha256 is distinct from p_terms_sha256
     or encode(extensions.digest(convert_to(v_row.terms_text, 'UTF8'), 'sha256'), 'hex') <> v_row.terms_sha256
     or v_row.effective_start_date < v_today
  then raise exception 'LOYALTY_OFFER_STALE_OR_NOT_APPROVED'; end if;
  if not exists (
    select 1 from public.platform_subscription_financial_state state
    where state.organization_id = p_organization_id
      and state.stripe_subscription_id = v_row.stripe_subscription_id
      and state.stripe_status = 'active'
      and (state.first_paid_at is not null or state.last_paid_at is not null)
  ) then raise exception 'LOYALTY_SUBSCRIPTION_INELIGIBLE'; end if;

  select u.name, u.email into v_actor_name, v_actor_email
  from public.users u where u.id = p_actor_user_id;
  if length(trim(coalesce(v_actor_name, ''))) < 2
    or length(trim(coalesce(v_actor_email, ''))) < 5
  then raise exception 'LOYALTY_ACTOR_IDENTITY_INCOMPLETE'; end if;

  update public.organization_loyalty_drafts
  set status = 'accepted', accepted_at = now(),
      accepted_by = p_actor_user_id,
      accepted_by_name = trim(v_actor_name),
      accepted_by_email = lower(trim(v_actor_email))
  where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$function$;

revoke all on function public.publish_organization_loyalty_offer_v1(uuid,uuid,text,text,text,text,text,text,text,integer,text,integer,date,text)
 from public, anon, authenticated;
grant execute on function public.publish_organization_loyalty_offer_v1(uuid,uuid,text,text,text,text,text,text,text,integer,text,integer,date,text)
 to service_role;
revoke all on function public.accept_organization_loyalty_offer_v1(uuid,uuid,text,boolean)
 from public, anon, authenticated;
grant execute on function public.accept_organization_loyalty_offer_v1(uuid,uuid,text,boolean)
 to service_role;

notify pgrst, 'reload schema';

commit;
