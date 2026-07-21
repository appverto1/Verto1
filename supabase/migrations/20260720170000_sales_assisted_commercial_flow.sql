create extension if not exists pgcrypto;

create table if not exists public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  normalized_email text not null,
  phone text not null,
  normalized_phone text not null,
  professional_registry text,
  clinic_name text not null,
  city text not null,
  state text not null,
  estimated_active_patients integer not null default 0,
  estimated_professionals integer,
  operation_type text not null,
  acquisition_channel text,
  preferred_contact_period text,
  role_title text,
  notes text,
  status text not null default 'new',
  contact_consent_at timestamptz not null,
  consent_text_version text not null,
  consent_source text not null,
  consent_purpose text not null,
  assigned_owner_id uuid references public.users(id) on delete set null,
  last_contact_at timestamptz,
  next_followup_at timestamptz,
  converted_user_id uuid references public.users(id) on delete set null,
  converted_clinic_id uuid,
  submission_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint sales_leads_status_check check (status in (
    'new','contact_started','demo_scheduled','demo_completed','proposal_preparing',
    'proposal_sent','checkout_sent','checkout_opened','payment_pending','converted','lost','archived'
  )),
  constraint sales_leads_operation_type_check check (operation_type in (
    'independent_professional','clinic','multidisciplinary_team'
  )),
  constraint sales_leads_state_check check (state ~ '^[A-Z]{2}$'),
  constraint sales_leads_estimated_patients_check check (estimated_active_patients between 0 and 100000),
  constraint sales_leads_estimated_professionals_check check (estimated_professionals is null or estimated_professionals between 0 and 10000)
);

alter table public.sales_leads
  add column if not exists submission_fingerprint text,
  add column if not exists consent_text_version text,
  add column if not exists consent_source text,
  add column if not exists consent_purpose text;

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
  event_type text not null,
  actor_user_id uuid references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint sales_lead_events_type_check check (event_type in (
    'lead_created','lead_updated','google_interest_started','contact_started','demo_scheduled',
    'demo_completed','proposal_created','proposal_sent','checkout_created','checkout_opened',
    'checkout_expired','payment_completed','activation_sent','activation_completed','lead_lost','lead_archived'
  ))
);

create unique index if not exists sales_lead_events_idempotency_uidx
  on public.sales_lead_events (idempotency_key);
create index if not exists sales_lead_events_lead_created_idx
  on public.sales_lead_events (lead_id, created_at desc);

create table if not exists public.sales_offers (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id) on delete restrict,
  status text not null default 'draft',
  base_unit_amount_cents integer not null,
  currency text not null default 'BRL',
  initial_active_patient_quantity integer not null,
  discount_duration_months integer,
  discount_type text not null default 'none',
  discount_percentage numeric(7,4),
  commercial_notes text,
  stripe_customer_id text,
  stripe_checkout_session_id text,
  stripe_subscription_id text,
  stripe_discount_id text,
  stripe_coupon_id text,
  stripe_promotion_code_id text,
  discount_started_at timestamptz,
  discount_ends_at timestamptz,
  discount_status text,
  post_discount_unit_amount_cents integer,
  next_billing_at timestamptz,
  last_discount_sync_at timestamptz,
  public_token_hash text,
  expires_at timestamptz not null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  idempotency_key text,
  constraint sales_offers_status_check check (status in (
    'draft','ready','sent','opened','checkout_created','payment_pending','paid','expired','cancelled'
  )),
  constraint sales_offers_discount_type_check check (discount_type in ('none','coupon')),
  constraint sales_offers_discount_duration_check check (
    (discount_type = 'none' and discount_duration_months is null)
    or (discount_type = 'coupon' and discount_duration_months in (6,12,24))
  ),
  constraint sales_offers_quantity_check check (initial_active_patient_quantity between 1 and 100000),
  constraint sales_offers_base_amount_check check (base_unit_amount_cents > 0)
);

alter table public.sales_offers
  add column if not exists idempotency_key text;

create unique index if not exists sales_offers_public_token_hash_uidx
  on public.sales_offers (public_token_hash) where public_token_hash is not null;
create unique index if not exists sales_offers_idempotency_uidx
  on public.sales_offers (idempotency_key) where idempotency_key is not null;
create index if not exists sales_offers_lead_created_idx
  on public.sales_offers (lead_id, created_at desc);
create index if not exists sales_offers_discount_expiry_idx
  on public.sales_offers (discount_ends_at, status)
  where discount_ends_at is not null and status = 'paid';

create table if not exists public.sales_activations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id) on delete restrict,
  offer_id uuid not null references public.sales_offers(id) on delete restrict,
  email text not null,
  token_hash text not null,
  status text not null default 'pending',
  stripe_checkout_session_id text,
  stripe_subscription_id text,
  expires_at timestamptz not null,
  activated_user_id uuid references public.users(id) on delete set null,
  activated_clinic_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  constraint sales_activations_status_check check (status in ('pending','used','expired','revoked'))
);

create unique index if not exists sales_activations_offer_uidx on public.sales_activations (offer_id);
create unique index if not exists sales_activations_token_hash_uidx on public.sales_activations (token_hash);
create index if not exists sales_activations_email_status_idx on public.sales_activations (lower(email), status, expires_at);

create table if not exists public.sales_discount_notifications (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.sales_offers(id) on delete cascade,
  subscription_id text not null,
  discount_ends_at timestamptz not null,
  notification_window_days integer not null,
  status text not null default 'pending',
  sent_at timestamptz,
  error_message text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_discount_notifications_window_check check (notification_window_days in (30,7,1)),
  constraint sales_discount_notifications_status_check check (status in ('pending','sent','failed','cancelled'))
);

create unique index if not exists sales_discount_notifications_idempotency_uidx
  on public.sales_discount_notifications (idempotency_key);

alter table public.sales_leads enable row level security;
alter table public.sales_lead_events enable row level security;
alter table public.sales_offers enable row level security;
alter table public.sales_activations enable row level security;
alter table public.sales_discount_notifications enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'sales_leads','sales_lead_events','sales_offers','sales_activations','sales_discount_notifications'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_owner_all', table_name);
    execute format(
      'create policy %I on public.%I for all using (exists (select 1 from public.users u where u.id = auth.uid() and lower(coalesce(u.role, '''')) = ''owner'')) with check (exists (select 1 from public.users u where u.id = auth.uid() and lower(coalesce(u.role, '''')) = ''owner''))',
      table_name || '_owner_all', table_name
    );
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
    execute format('grant select, insert, update on table public.%I to authenticated', table_name);
  end loop;
end $$;

comment on table public.sales_leads is 'Commercial leads captured by the server-side assisted sales flow.';
comment on column public.sales_offers.public_token_hash is 'SHA-256 hash of the public offer token. The raw token is never persisted.';

create or replace function public.capture_sales_lead(
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
  p_preferred_contact_period text,
  p_role_title text,
  p_notes text,
  p_submission_fingerprint text,
  p_consent_text_version text,
  p_consent_source text,
  p_consent_purpose text,
  p_contact_consent_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email_lead_id uuid;
  v_phone_lead_id uuid;
  v_lead_id uuid;
  v_lead public.sales_leads%rowtype;
  v_event_id uuid;
  v_idempotent boolean := false;
  v_email_lock bigint := hashtextextended('sales-lead-email:' || p_normalized_email, 0);
  v_phone_lock bigint := hashtextextended('sales-lead-phone:' || p_normalized_phone, 0);
begin
  if nullif(trim(p_normalized_email), '') is null
    or nullif(trim(p_normalized_phone), '') is null
    or nullif(trim(p_submission_fingerprint), '') is null then
    raise exception using errcode = '22023', message = 'SALES_LEAD_INVALID_IDENTITY';
  end if;

  -- Always acquire both identity locks in the same order to avoid concurrent
  -- submissions creating one lead by e-mail and another by phone.
  if v_email_lock <= v_phone_lock then
    perform pg_advisory_xact_lock(v_email_lock);
    perform pg_advisory_xact_lock(v_phone_lock);
  else
    perform pg_advisory_xact_lock(v_phone_lock);
    perform pg_advisory_xact_lock(v_email_lock);
  end if;

  select id into v_email_lead_id
    from public.sales_leads
   where normalized_email = p_normalized_email
     and deleted_at is null
   limit 1;

  select id into v_phone_lead_id
    from public.sales_leads
   where normalized_phone = p_normalized_phone
     and deleted_at is null
   limit 1;

  if v_email_lead_id is not null
    and v_phone_lead_id is not null
    and v_email_lead_id <> v_phone_lead_id then
    raise exception using errcode = '23505', message = 'SALES_LEAD_IDENTITY_CONFLICT';
  end if;

  v_lead_id := coalesce(v_email_lead_id, v_phone_lead_id);

  if v_lead_id is null then
    insert into public.sales_leads (
      name, email, normalized_email, phone, normalized_phone,
      professional_registry, clinic_name, city, state,
      estimated_active_patients, estimated_professionals, operation_type,
      acquisition_channel, preferred_contact_period, role_title, notes,
      status, contact_consent_at, consent_text_version, consent_source,
      consent_purpose, submission_fingerprint
    ) values (
      p_name, p_email, p_normalized_email, p_phone, p_normalized_phone,
      nullif(p_professional_registry, ''), p_clinic_name, p_city, p_state,
      p_estimated_active_patients, p_estimated_professionals, p_operation_type,
      nullif(p_acquisition_channel, ''), nullif(p_preferred_contact_period, ''),
      nullif(p_role_title, ''), nullif(p_notes, ''), 'new',
      p_contact_consent_at, p_consent_text_version, p_consent_source,
      p_consent_purpose, p_submission_fingerprint
    ) returning * into v_lead;
  else
    select * into v_lead
      from public.sales_leads
     where id = v_lead_id
     for update;

    if v_lead.submission_fingerprint = p_submission_fingerprint then
      v_idempotent := true;
    else
      update public.sales_leads set
        name = p_name,
        email = p_email,
        normalized_email = p_normalized_email,
        phone = p_phone,
        normalized_phone = p_normalized_phone,
        professional_registry = nullif(p_professional_registry, ''),
        clinic_name = p_clinic_name,
        city = p_city,
        state = p_state,
        estimated_active_patients = p_estimated_active_patients,
        estimated_professionals = p_estimated_professionals,
        operation_type = p_operation_type,
        acquisition_channel = nullif(p_acquisition_channel, ''),
        preferred_contact_period = nullif(p_preferred_contact_period, ''),
        role_title = nullif(p_role_title, ''),
        notes = nullif(p_notes, ''),
        contact_consent_at = p_contact_consent_at,
        consent_text_version = p_consent_text_version,
        consent_source = p_consent_source,
        consent_purpose = p_consent_purpose,
        submission_fingerprint = p_submission_fingerprint,
        updated_at = now()
      where id = v_lead_id
      returning * into v_lead;
    end if;
  end if;

  insert into public.sales_lead_events (
    lead_id, event_type, metadata, idempotency_key
  ) values (
    v_lead.id,
    case when v_lead_id is null then 'lead_created' else 'lead_updated' end,
    jsonb_build_object(
      'source', p_consent_source,
      'acquisitionChannel', nullif(p_acquisition_channel, '')
    ),
    'lead_submission:' || p_submission_fingerprint
  ) on conflict (idempotency_key) do nothing
  returning id into v_event_id;

  return jsonb_build_object(
    'lead', to_jsonb(v_lead),
    'idempotent', v_idempotent or v_event_id is null,
    'event_created', v_event_id is not null
  );
end;
$$;

revoke all on function public.capture_sales_lead(
  text, text, text, text, text, text, text, text, text, integer, integer,
  text, text, text, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.capture_sales_lead(
  text, text, text, text, text, text, text, text, text, integer, integer,
  text, text, text, text, text, text, text, text, text, timestamptz
) to service_role;
