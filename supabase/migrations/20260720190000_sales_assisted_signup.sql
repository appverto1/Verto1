-- Verto: fluxo comercial assistido, leads, ofertas e descontos temporários.
-- Migração aditiva e idempotente. Não altera dados históricos nem habilita Stripe real.

create extension if not exists pgcrypto;

do $$ begin
  create type public.sales_lead_status as enum (
    'new', 'contact_started', 'demo_scheduled', 'demo_completed',
    'proposal_preparing', 'proposal_sent', 'checkout_sent', 'checkout_opened',
    'payment_pending', 'converted', 'lost', 'archived'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.sales_lead_event_type as enum (
    'lead_created', 'lead_updated', 'google_interest_started', 'contact_started',
    'demo_scheduled', 'demo_completed', 'proposal_created', 'proposal_sent',
    'checkout_created', 'checkout_opened', 'checkout_expired', 'payment_completed',
    'activation_sent', 'activation_completed', 'lead_lost'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.sales_offer_status as enum (
    'draft', 'ready', 'sent', 'opened', 'checkout_created',
    'payment_pending', 'paid', 'expired', 'cancelled'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  normalized_email text not null,
  phone text not null,
  normalized_phone text not null,
  professional_registry text,
  clinic_name text,
  city text,
  state text,
  estimated_active_patients integer not null default 0,
  estimated_professionals integer,
  operation_type text not null,
  acquisition_channel text not null,
  job_title text,
  preferred_contact_period text,
  notes text,
  status public.sales_lead_status not null default 'new',
  contact_consent_at timestamptz not null,
  contact_consent_version text not null,
  contact_consent_origin text not null,
  contact_consent_purpose text not null default 'sales_contact',
  do_not_contact boolean not null default false,
  assigned_owner_id uuid references public.users(id) on delete set null,
  last_contact_at timestamptz,
  next_followup_at timestamptz,
  converted_user_id uuid references public.users(id) on delete set null,
  converted_clinic_id uuid references public.clinics(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint sales_leads_name_length check (char_length(name) between 2 and 180),
  constraint sales_leads_email_length check (char_length(email) between 3 and 254),
  constraint sales_leads_phone_length check (char_length(normalized_phone) between 10 and 20),
  constraint sales_leads_registry_length check (professional_registry is null or char_length(professional_registry) <= 80),
  constraint sales_leads_clinic_length check (clinic_name is null or char_length(clinic_name) <= 180),
  constraint sales_leads_city_length check (city is null or char_length(city) <= 120),
  constraint sales_leads_state_format check (state is null or state ~ '^[A-Z]{2}$'),
  constraint sales_leads_notes_length check (notes is null or char_length(notes) <= 1500),
  constraint sales_leads_patient_range check (estimated_active_patients between 0 and 100000),
  constraint sales_leads_professional_range check (estimated_professionals is null or estimated_professionals between 0 and 10000),
  constraint sales_leads_operation_type check (operation_type in ('independent_professional', 'clinic', 'multidisciplinary_team'))
);

create unique index if not exists sales_leads_normalized_email_uidx
  on public.sales_leads (normalized_email) where deleted_at is null;
create unique index if not exists sales_leads_normalized_phone_uidx
  on public.sales_leads (normalized_phone) where deleted_at is null;
create index if not exists sales_leads_status_created_idx
  on public.sales_leads (status, created_at desc) where deleted_at is null;
create index if not exists sales_leads_owner_followup_idx
  on public.sales_leads (assigned_owner_id, next_followup_at) where deleted_at is null;

create table if not exists public.sales_lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id) on delete cascade,
  event_type public.sales_lead_event_type not null,
  actor_user_id uuid references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint sales_lead_events_idempotency_length check (char_length(idempotency_key) between 12 and 240)
);

create unique index if not exists sales_lead_events_idempotency_uidx
  on public.sales_lead_events (idempotency_key);
create index if not exists sales_lead_events_lead_created_idx
  on public.sales_lead_events (lead_id, created_at desc);

create table if not exists public.sales_offers (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id) on delete restrict,
  status public.sales_offer_status not null default 'draft',
  base_unit_amount_cents integer not null,
  currency text not null default 'BRL',
  initial_active_patient_quantity integer not null,
  discount_duration_months integer,
  discount_type text not null default 'none',
  discount_percentage numeric(7,4),
  stripe_customer_id text,
  stripe_checkout_session_id text,
  stripe_subscription_id text,
  stripe_discount_id text,
  stripe_coupon_id text,
  stripe_promotion_code_id text,
  public_token_hash text not null,
  commercial_notes text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references public.users(id) on delete restrict,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint sales_offers_amount_positive check (base_unit_amount_cents > 0),
  constraint sales_offers_quantity_range check (initial_active_patient_quantity between 1 and 100000),
  constraint sales_offers_discount_type check (discount_type in ('none', 'coupon')),
  constraint sales_offers_discount_duration check (
    (discount_type = 'none' and discount_duration_months is null)
    or (discount_type = 'coupon' and discount_duration_months in (6, 12, 24))
  ),
  constraint sales_offers_percentage_range check (discount_percentage is null or discount_percentage between 0 and 100),
  constraint sales_offers_notes_length check (commercial_notes is null or char_length(commercial_notes) <= 1500)
);

alter table public.sales_offers add column if not exists idempotency_key text;
update public.sales_offers
set idempotency_key = 'legacy:' || id::text
where idempotency_key is null;
alter table public.sales_offers alter column idempotency_key set not null;

create unique index if not exists sales_offers_public_token_hash_uidx
  on public.sales_offers (public_token_hash);
create unique index if not exists sales_offers_creator_idempotency_uidx
  on public.sales_offers (created_by, idempotency_key);
create index if not exists sales_offers_lead_created_idx
  on public.sales_offers (lead_id, created_at desc);
create index if not exists sales_offers_status_expiry_idx
  on public.sales_offers (status, expires_at);

-- Mantém compatibilidade com a ativação já existente, acrescentando apenas o vínculo
-- comercial necessário. Tokens deste fluxo são armazenados como SHA-256 no campo token.
create table if not exists public.pending_activations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token text not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.pending_activations add column if not exists source text;
alter table public.pending_activations add column if not exists sales_offer_id uuid;
alter table public.pending_activations add column if not exists sales_lead_id uuid;
alter table public.pending_activations add column if not exists stripe_checkout_session_id text;
alter table public.pending_activations add column if not exists expires_at timestamptz;
alter table public.pending_activations add column if not exists activation_email_sent_at timestamptz;

create unique index if not exists pending_activations_sales_checkout_uidx
  on public.pending_activations (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create unique index if not exists pending_activations_sales_token_uidx
  on public.pending_activations (token)
  where source = 'sales_assisted_signup';
create index if not exists pending_activations_sales_lookup_idx
  on public.pending_activations (email, used, source, expires_at)
  where source = 'sales_assisted_signup';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pending_activations_sales_offer_fk'
      AND conrelid = 'public.pending_activations'::regclass
  ) THEN
    ALTER TABLE public.pending_activations
      ADD CONSTRAINT pending_activations_sales_offer_fk
      FOREIGN KEY (sales_offer_id) REFERENCES public.sales_offers(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pending_activations_sales_lead_fk'
      AND conrelid = 'public.pending_activations'::regclass
  ) THEN
    ALTER TABLE public.pending_activations
      ADD CONSTRAINT pending_activations_sales_lead_fk
      FOREIGN KEY (sales_lead_id) REFERENCES public.sales_leads(id) ON DELETE SET NULL;
  END IF;
END $$;

create table if not exists public.sales_subscription_discounts (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid references public.sales_offers(id) on delete set null,
  lead_id uuid references public.sales_leads(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  clinic_id uuid references public.clinics(id) on delete set null,
  stripe_subscription_id text not null,
  stripe_discount_id text,
  stripe_coupon_id text,
  stripe_promotion_code_id text,
  discount_type text not null default 'coupon',
  discount_percentage numeric(7,4),
  discount_duration_months integer,
  discount_started_at timestamptz,
  discount_ends_at timestamptz,
  next_billing_at timestamptz,
  post_discount_unit_amount_cents integer not null default 7990,
  estimated_next_invoice_amount_cents integer,
  discount_status text not null default 'pending_sync',
  last_discount_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_subscription_discounts_duration check (discount_duration_months is null or discount_duration_months in (6, 12, 24)),
  constraint sales_subscription_discounts_percentage check (discount_percentage is null or discount_percentage between 0 and 100)
);

create unique index if not exists sales_subscription_discounts_subscription_uidx
  on public.sales_subscription_discounts (stripe_subscription_id);
create index if not exists sales_subscription_discounts_expiry_idx
  on public.sales_subscription_discounts (discount_status, discount_ends_at)
  where discount_ends_at is not null;

create table if not exists public.sales_discount_notifications (
  id uuid primary key default gen_random_uuid(),
  subscription_discount_id uuid not null references public.sales_subscription_discounts(id) on delete cascade,
  notification_window text not null,
  idempotency_key text not null,
  internal_notification_sent_at timestamptz,
  email_sent_at timestamptz,
  email_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sales_discount_notifications_idempotency_uidx
  on public.sales_discount_notifications (idempotency_key);

create or replace function public.is_platform_sales_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_platform_sales_admin() from public;
grant execute on function public.is_platform_sales_admin() to authenticated, service_role;

alter table public.sales_leads enable row level security;
alter table public.sales_lead_events enable row level security;
alter table public.sales_offers enable row level security;
alter table public.sales_subscription_discounts enable row level security;
alter table public.sales_discount_notifications enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'sales_leads', 'sales_lead_events', 'sales_offers',
    'sales_subscription_discounts', 'sales_discount_notifications'
  ] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = table_name and policyname = table_name || '_platform_sales_admin_all'
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_platform_sales_admin()) with check (public.is_platform_sales_admin())',
        table_name || '_platform_sales_admin_all', table_name
      );
    end if;
  end loop;
end $$;

revoke all on public.sales_leads from anon, authenticated;
revoke all on public.sales_lead_events from anon, authenticated;
revoke all on public.sales_offers from anon, authenticated;
revoke all on public.sales_subscription_discounts from anon, authenticated;
revoke all on public.sales_discount_notifications from anon, authenticated;
grant select, insert, update on public.sales_leads to authenticated;
grant select, insert, update on public.sales_lead_events to authenticated;
grant select, insert, update on public.sales_offers to authenticated;
grant select, insert, update on public.sales_subscription_discounts to authenticated;
grant select, insert, update on public.sales_discount_notifications to authenticated;
grant all on public.sales_leads to service_role;
grant all on public.sales_lead_events to service_role;
grant all on public.sales_offers to service_role;
grant all on public.sales_subscription_discounts to service_role;
grant all on public.sales_discount_notifications to service_role;

create or replace function public.upsert_public_sales_lead(
  p_name text,
  p_email text,
  p_normalized_email text,
  p_phone text,
  p_normalized_phone text,
  p_professional_registry text,
  p_clinic_name text,
  p_city text,
  p_state text,
  p_estimated_active_patients integer,
  p_estimated_professionals integer,
  p_operation_type text,
  p_acquisition_channel text,
  p_job_title text,
  p_preferred_contact_period text,
  p_notes text,
  p_consent_version text,
  p_consent_origin text,
  p_consent_purpose text,
  p_source text,
  p_idempotency_key text
)
returns table (lead_id uuid, event_created boolean, lead_created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id uuid;
  v_email_lead_id uuid;
  v_phone_lead_id uuid;
  v_created boolean := false;
  v_event_created boolean := false;
  v_event_type public.sales_lead_event_type;
  v_rows integer := 0;
begin
  select id into v_email_lead_id
  from public.sales_leads
  where deleted_at is null
    and normalized_email = p_normalized_email
  order by updated_at desc
  limit 1
  for update;

  select id into v_phone_lead_id
  from public.sales_leads
  where deleted_at is null
    and normalized_phone = p_normalized_phone
  order by updated_at desc
  limit 1
  for update;

  if v_email_lead_id is not null
     and v_phone_lead_id is not null
     and v_email_lead_id <> v_phone_lead_id then
    raise exception 'SALES_LEAD_IDENTITY_CONFLICT';
  end if;

  v_lead_id := coalesce(v_email_lead_id, v_phone_lead_id);

  if v_lead_id is null then
    begin
      insert into public.sales_leads (
        name, email, normalized_email, phone, normalized_phone,
        professional_registry, clinic_name, city, state,
        estimated_active_patients, estimated_professionals, operation_type,
        acquisition_channel, job_title, preferred_contact_period, notes,
        status, contact_consent_at, contact_consent_version,
        contact_consent_origin, contact_consent_purpose, created_at, updated_at
      ) values (
        p_name, p_email, p_normalized_email, p_phone, p_normalized_phone,
        nullif(p_professional_registry, ''), nullif(p_clinic_name, ''), nullif(p_city, ''), nullif(p_state, ''),
        p_estimated_active_patients, p_estimated_professionals, p_operation_type,
        p_acquisition_channel, nullif(p_job_title, ''), nullif(p_preferred_contact_period, ''), nullif(p_notes, ''),
        'new', now(), p_consent_version, p_consent_origin, p_consent_purpose, now(), now()
      ) returning id into v_lead_id;
      v_created := true;
    exception when unique_violation then
      select id into v_email_lead_id
      from public.sales_leads
      where deleted_at is null
        and normalized_email = p_normalized_email
      order by updated_at desc
      limit 1
      for update;

      select id into v_phone_lead_id
      from public.sales_leads
      where deleted_at is null
        and normalized_phone = p_normalized_phone
      order by updated_at desc
      limit 1
      for update;

      if v_email_lead_id is not null
         and v_phone_lead_id is not null
         and v_email_lead_id <> v_phone_lead_id then
        raise exception 'SALES_LEAD_IDENTITY_CONFLICT';
      end if;
      v_lead_id := coalesce(v_email_lead_id, v_phone_lead_id);
    end;
  end if;

  if v_lead_id is null then
    raise exception 'SALES_LEAD_UPSERT_FAILED';
  end if;

  if not v_created then
    update public.sales_leads
    set name = p_name,
        email = p_email,
        normalized_email = p_normalized_email,
        phone = p_phone,
        normalized_phone = p_normalized_phone,
        professional_registry = nullif(p_professional_registry, ''),
        clinic_name = nullif(p_clinic_name, ''),
        city = nullif(p_city, ''),
        state = nullif(p_state, ''),
        estimated_active_patients = p_estimated_active_patients,
        estimated_professionals = p_estimated_professionals,
        operation_type = p_operation_type,
        acquisition_channel = p_acquisition_channel,
        job_title = nullif(p_job_title, ''),
        preferred_contact_period = nullif(p_preferred_contact_period, ''),
        notes = nullif(p_notes, ''),
        contact_consent_at = now(),
        contact_consent_version = p_consent_version,
        contact_consent_origin = p_consent_origin,
        contact_consent_purpose = p_consent_purpose,
        updated_at = now()
    where id = v_lead_id;
  end if;

  v_event_type := case
    when p_source = 'google_interest' then 'google_interest_started'::public.sales_lead_event_type
    when v_created then 'lead_created'::public.sales_lead_event_type
    else 'lead_updated'::public.sales_lead_event_type
  end;

  insert into public.sales_lead_events (lead_id, event_type, metadata, idempotency_key)
  values (
    v_lead_id,
    v_event_type,
    jsonb_build_object(
      'source', left(coalesce(p_source, 'public_landing'), 80),
      'consent_version', p_consent_version,
      'consent_purpose', p_consent_purpose
    ),
    p_idempotency_key
  )
  on conflict (idempotency_key) do nothing;
  get diagnostics v_rows = row_count;
  v_event_created := v_rows > 0;

  return query select v_lead_id, v_event_created, v_created;
end;
$$;

revoke all on function public.upsert_public_sales_lead(
  text, text, text, text, text, text, text, text, text,
  integer, integer, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.upsert_public_sales_lead(
  text, text, text, text, text, text, text, text, text,
  integer, integer, text, text, text, text, text, text, text, text, text, text
) to service_role;
