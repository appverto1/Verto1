-- Patient evolution timeline v2.
-- 1 shared timeline item/month is included. PLUS3 unlocks up to 3 items/month for R$ 2,00 per patient/month.
-- External recipients see only months/items actively granted to their authenticated e-mail.

begin;

create table if not exists public.patient_evolution_timeline_entitlements (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  tier text not null default 'STANDARD',
  billing_status text not null default 'INCLUDED',
  monthly_limit smallint not null default 1,
  unit_amount_cents integer not null default 200,
  stripe_subscription_item_id text null,
  stripe_price_id text null,
  activated_at timestamptz null,
  activated_by_user_id uuid null,
  last_billing_sync_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (clinic_id, patient_id),
  constraint patient_evolution_timeline_entitlements_tier_chk
    check (tier in ('STANDARD','PLUS3')),
  constraint patient_evolution_timeline_entitlements_status_chk
    check (billing_status in ('INCLUDED','PENDING','ACTIVE','ERROR')),
  constraint patient_evolution_timeline_entitlements_limit_chk
    check (monthly_limit in (1,3)),
  constraint patient_evolution_timeline_entitlements_price_chk
    check (unit_amount_cents = 200),
  constraint patient_evolution_timeline_entitlements_consistency_chk
    check (
      (tier = 'STANDARD' and monthly_limit = 1 and billing_status = 'INCLUDED')
      or
      (tier = 'PLUS3' and monthly_limit = 3 and billing_status in ('PENDING','ACTIVE','ERROR'))
    )
);

create index if not exists patient_evolution_timeline_entitlements_patient_idx
  on public.patient_evolution_timeline_entitlements (patient_id, clinic_id);

create table if not exists public.clinic_evolution_timeline_addon_billing (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  stripe_subscription_id text null,
  stripe_subscription_item_id text null,
  stripe_price_id text null,
  quantity integer not null default 0,
  unit_amount_cents integer not null default 200,
  status text not null default 'INACTIVE',
  last_error text null,
  last_synced_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_evolution_timeline_addon_quantity_chk check (quantity >= 0),
  constraint clinic_evolution_timeline_addon_price_chk check (unit_amount_cents = 200),
  constraint clinic_evolution_timeline_addon_status_chk check (status in ('INACTIVE','SYNCING','ACTIVE','ERROR'))
);

create or replace function public.set_patient_evolution_timeline_entitlement_updated_at_v2()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists patient_evolution_timeline_entitlement_updated_at_v2 on public.patient_evolution_timeline_entitlements;
create trigger patient_evolution_timeline_entitlement_updated_at_v2
before update on public.patient_evolution_timeline_entitlements
for each row execute function public.set_patient_evolution_timeline_entitlement_updated_at_v2();

drop trigger if exists clinic_evolution_timeline_addon_billing_updated_at_v2 on public.clinic_evolution_timeline_addon_billing;
create trigger clinic_evolution_timeline_addon_billing_updated_at_v2
before update on public.clinic_evolution_timeline_addon_billing
for each row execute function public.set_patient_evolution_timeline_entitlement_updated_at_v2();

create or replace function public.create_patient_evolution_timeline_item_v2(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_month_key date,
  p_subject text,
  p_content text,
  p_patient_file_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_month date := date_trunc('month', p_month_key::timestamp)::date;
  v_subject text := btrim(coalesce(p_subject, ''));
  v_content text := nullif(btrim(coalesce(p_content, '')), '');
  v_limit smallint := 1;
  v_slot smallint;
  v_id uuid;
begin
  if p_clinic_id is null or p_patient_id is null or p_month_key is null then
    raise exception 'EVOLUTION_TIMELINE_SCOPE_REQUIRED';
  end if;
  if char_length(v_subject) < 1 or char_length(v_subject) > 180 then
    raise exception 'EVOLUTION_TIMELINE_SUBJECT_INVALID';
  end if;
  if v_content is not null and char_length(v_content) > 12000 then
    raise exception 'EVOLUTION_TIMELINE_CONTENT_TOO_LONG';
  end if;
  if v_content is null and p_patient_file_id is null then
    raise exception 'EVOLUTION_TIMELINE_CONTENT_OR_FILE_REQUIRED';
  end if;

  perform 1
  from public.patients patient
  where patient.id = p_patient_id
    and patient.clinic_id = p_clinic_id
    and coalesce(patient.is_active, true)
    and patient.deleted_at is null;
  if not found then
    raise exception 'EVOLUTION_TIMELINE_PATIENT_SCOPE_INVALID';
  end if;

  if p_patient_file_id is not null then
    perform 1
    from public.patient_files file
    where file.id = p_patient_file_id
      and file.patient_id = p_patient_id
      and file.clinic_id = p_clinic_id;
    if not found then
      raise exception 'EVOLUTION_TIMELINE_FILE_SCOPE_INVALID';
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_clinic_id::text || ':' || p_patient_id::text || ':' || v_month::text, 0)
  );

  select case
    when entitlement.tier = 'PLUS3' and entitlement.billing_status = 'ACTIVE' and entitlement.monthly_limit = 3 then 3
    else 1
  end::smallint
  into v_limit
  from public.patient_evolution_timeline_entitlements entitlement
  where entitlement.clinic_id = p_clinic_id
    and entitlement.patient_id = p_patient_id;

  v_limit := coalesce(v_limit, 1);

  select candidate.slot::smallint
  into v_slot
  from generate_series(1, v_limit) as candidate(slot)
  where not exists (
    select 1
    from public.patient_evolution_timeline_items item
    where item.clinic_id = p_clinic_id
      and item.patient_id = p_patient_id
      and item.month_key = v_month
      and item.slot = candidate.slot
      and item.archived_at is null
  )
  order by candidate.slot
  limit 1;

  if v_slot is null then
    if v_limit = 1 then
      raise exception 'EVOLUTION_TIMELINE_STANDARD_MONTH_LIMIT';
    end if;
    raise exception 'EVOLUTION_TIMELINE_PLUS3_MONTH_LIMIT';
  end if;

  insert into public.patient_evolution_timeline_items (
    clinic_id, patient_id, month_key, slot, subject, content, patient_file_id, created_by_user_id
  ) values (
    p_clinic_id, p_patient_id, v_month, v_slot, v_subject, v_content, p_patient_file_id, p_actor_id
  ) returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'slot', v_slot,
    'monthKey', v_month,
    'monthlyLimit', v_limit
  );
end;
$function$;

create or replace function public.reserve_patient_evolution_timeline_plus_v1(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_row public.patient_evolution_timeline_entitlements%rowtype;
  v_target_quantity integer;
begin
  if p_clinic_id is null or p_patient_id is null or p_actor_id is null then
    raise exception 'EVOLUTION_TIMELINE_ENTITLEMENT_SCOPE_REQUIRED';
  end if;

  perform 1
  from public.patients patient
  where patient.id = p_patient_id
    and patient.clinic_id = p_clinic_id
    and coalesce(patient.is_active, true)
    and patient.deleted_at is null;
  if not found then
    raise exception 'EVOLUTION_TIMELINE_PATIENT_SCOPE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('evolution-timeline-plus:' || p_clinic_id::text, 0));

  select * into v_row
  from public.patient_evolution_timeline_entitlements entitlement
  where entitlement.clinic_id = p_clinic_id
    and entitlement.patient_id = p_patient_id
  for update;

  if found and v_row.tier = 'PLUS3' and v_row.billing_status = 'ACTIVE' then
    select count(*)::integer into v_target_quantity
    from public.patient_evolution_timeline_entitlements e
    where e.clinic_id = p_clinic_id
      and e.tier = 'PLUS3'
      and e.billing_status in ('ACTIVE','PENDING');
    return jsonb_build_object('alreadyActive', true, 'targetQuantity', v_target_quantity);
  end if;

  insert into public.patient_evolution_timeline_entitlements (
    clinic_id, patient_id, tier, billing_status, monthly_limit, unit_amount_cents,
    activated_by_user_id, updated_at
  ) values (
    p_clinic_id, p_patient_id, 'PLUS3', 'PENDING', 3, 200,
    p_actor_id, now()
  )
  on conflict (clinic_id, patient_id) do update
    set tier = 'PLUS3',
        billing_status = 'PENDING',
        monthly_limit = 3,
        unit_amount_cents = 200,
        activated_by_user_id = p_actor_id,
        updated_at = now();

  select count(*)::integer into v_target_quantity
  from public.patient_evolution_timeline_entitlements e
  where e.clinic_id = p_clinic_id
    and e.tier = 'PLUS3'
    and e.billing_status in ('ACTIVE','PENDING');

  return jsonb_build_object('alreadyActive', false, 'targetQuantity', v_target_quantity);
end;
$function$;

create or replace function public.finalize_patient_evolution_timeline_plus_v1(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_actor_id uuid,
  p_success boolean,
  p_stripe_subscription_item_id text,
  p_stripe_price_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended('evolution-timeline-plus:' || p_clinic_id::text, 0));

  if coalesce(p_success, false) then
    update public.patient_evolution_timeline_entitlements
    set tier = 'PLUS3',
        billing_status = 'ACTIVE',
        monthly_limit = 3,
        unit_amount_cents = 200,
        stripe_subscription_item_id = nullif(btrim(coalesce(p_stripe_subscription_item_id, '')), ''),
        stripe_price_id = nullif(btrim(coalesce(p_stripe_price_id, '')), ''),
        activated_at = coalesce(activated_at, now()),
        activated_by_user_id = coalesce(activated_by_user_id, p_actor_id),
        last_billing_sync_at = now(),
        updated_at = now()
    where clinic_id = p_clinic_id
      and patient_id = p_patient_id
      and tier = 'PLUS3';
    v_status := 'ACTIVE';
  else
    update public.patient_evolution_timeline_entitlements
    set tier = 'PLUS3',
        billing_status = 'ERROR',
        monthly_limit = 3,
        unit_amount_cents = 200,
        last_billing_sync_at = now(),
        updated_at = now()
    where clinic_id = p_clinic_id
      and patient_id = p_patient_id;
    v_status := 'ERROR';
  end if;

  return jsonb_build_object('status', v_status, 'monthlyLimit', case when v_status = 'ACTIVE' then 3 else 1 end);
end;
$function$;

alter table public.patient_evolution_timeline_entitlements enable row level security;
alter table public.clinic_evolution_timeline_addon_billing enable row level security;

revoke all on table public.patient_evolution_timeline_entitlements from public, anon, authenticated;
revoke all on table public.clinic_evolution_timeline_addon_billing from public, anon, authenticated;
grant select, insert, update, delete on table public.patient_evolution_timeline_entitlements to service_role;
grant select, insert, update, delete on table public.clinic_evolution_timeline_addon_billing to service_role;

revoke all on function public.set_patient_evolution_timeline_entitlement_updated_at_v2() from public, anon, authenticated;
revoke all on function public.create_patient_evolution_timeline_item_v2(uuid, uuid, date, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.reserve_patient_evolution_timeline_plus_v1(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_patient_evolution_timeline_plus_v1(uuid, uuid, uuid, boolean, text, text) from public, anon, authenticated;

grant execute on function public.create_patient_evolution_timeline_item_v2(uuid, uuid, date, text, text, uuid, uuid) to service_role;
grant execute on function public.reserve_patient_evolution_timeline_plus_v1(uuid, uuid, uuid) to service_role;
grant execute on function public.finalize_patient_evolution_timeline_plus_v1(uuid, uuid, uuid, boolean, text, text) to service_role;

comment on table public.patient_evolution_timeline_entitlements is
  'Per-patient timeline capacity entitlement. STANDARD includes one shareable item/month; PLUS3 allows three items/month and is billed at BRL 2.00 per patient/month.';
comment on table public.clinic_evolution_timeline_addon_billing is
  'Clinic-level Stripe synchronization state for the PLUS3 evolution-timeline add-on quantity.';

notify pgrst, 'reload schema';

commit;
