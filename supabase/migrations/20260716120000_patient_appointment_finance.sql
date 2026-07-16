-- Appointment-linked patient finance.
-- Additive and compatible with legacy rows in public.payments.

create extension if not exists pgcrypto;

alter table public.payments
  add column if not exists organization_id uuid,
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null,
  add column if not exists professional_id uuid references public.users(id) on delete set null,
  add column if not exists service_type text,
  add column if not exists appointment_scheduled_at timestamptz,
  add column if not exists payer_name text,
  add column if not exists competence_month date,
  add column if not exists original_amount numeric(14,2),
  add column if not exists base_amount numeric(14,2),
  add column if not exists additional_amount numeric(14,2) not null default 0,
  add column if not exists discount_amount numeric(14,2) not null default 0,
  add column if not exists paid_amount numeric(14,2) not null default 0,
  add column if not exists refunded_amount numeric(14,2) not null default 0,
  add column if not exists balance_amount numeric(14,2) not null default 0,
  add column if not exists financial_status text,
  add column if not exists is_courtesy boolean not null default false,
  add column if not exists source text,
  add column if not exists idempotency_key text,
  add column if not exists last_payment_at timestamptz,
  add column if not exists canceled_at timestamptz,
  add column if not exists canceled_by text,
  add column if not exists is_recurring boolean not null default false,
  add column if not exists recurrence_group_id text,
  add column if not exists recurrence_index integer,
  add column if not exists recurrence_total integer,
  add column if not exists recurrence_frequency text,
  add column if not exists additional_scope text,
  add column if not exists adjustment_reason text;

update public.payments
set organization_id = clinic_id::uuid
where organization_id is null
  and clinic_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

update public.payments
set
  original_amount = coalesce(original_amount, base_amount, amount, 0),
  base_amount = coalesce(base_amount, original_amount, amount, 0),
  paid_amount = case
    when coalesce(paid_amount, 0) > 0 then paid_amount
    when lower(coalesce(status, '')) in ('paid', 'refunded') then coalesce(amount, 0)
    else 0
  end,
  refunded_amount = case
    when coalesce(refunded_amount, 0) > 0 then refunded_amount
    when lower(coalesce(status, '')) = 'refunded' then coalesce(amount, 0)
    else 0
  end,
  financial_status = coalesce(
    nullif(financial_status, ''),
    case lower(coalesce(status, 'pending'))
      when 'paid' then 'paid'
      when 'canceled' then 'canceled'
      when 'cancelled' then 'canceled'
      when 'refunded' then 'refunded'
      when 'delinquent' then 'overdue'
      else 'pending'
    end
  ),
  balance_amount = greatest(
    coalesce(amount, 0) -
    case
      when coalesce(paid_amount, 0) > 0 then paid_amount
      when lower(coalesce(status, '')) in ('paid', 'refunded') then coalesce(amount, 0)
      else 0
    end +
    case
      when coalesce(refunded_amount, 0) > 0 then refunded_amount
      when lower(coalesce(status, '')) = 'refunded' then coalesce(amount, 0)
      else 0
    end,
    0
  )
where original_amount is null
   or base_amount is null
   or financial_status is null
   or (coalesce(balance_amount, 0) = 0 and lower(coalesce(status, 'pending')) <> 'paid');

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments
  add constraint payments_status_check
  check (status in ('pending', 'partial', 'paid', 'canceled', 'cancelled', 'refunded', 'delinquent', 'overdue', 'courtesy', 'forecast'));

create table if not exists public.payment_appointment_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id text not null,
  payment_id uuid not null references public.payments(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  professional_id uuid references public.users(id) on delete set null,
  patient_name_snapshot text,
  professional_name_snapshot text,
  service_type_snapshot text,
  specialty_snapshot text,
  appointment_scheduled_at timestamptz,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit_amount numeric(14,2) not null default 0 check (unit_amount >= 0),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id text not null,
  payment_id uuid not null references public.payments(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('PAYMENT', 'DISCOUNT', 'COURTESY', 'REFUND', 'ADJUSTMENT')),
  amount numeric(14,2) not null check (amount >= 0),
  method text,
  transaction_at timestamptz not null default now(),
  status text not null default 'POSTED' check (status in ('POSTED', 'VOIDED')),
  proof_url text,
  proof_file_name text,
  proof_content_type text,
  receipt_url text,
  receipt_number text,
  document_status text not null default 'PENDING' check (document_status in ('PENDING', 'PROVIDED', 'VALIDATED', 'REJECTED', 'ISSUED')),
  notes text,
  idempotency_key text not null,
  created_by text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by text
);

create table if not exists public.payment_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id text not null,
  payment_id uuid not null references public.payments(id) on delete restrict,
  transaction_id uuid references public.payment_transactions(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  event_type text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  notes text,
  idempotency_key text,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.clinic_patient_finance_policies (
  organization_id uuid primary key,
  receivable_trigger text not null default 'MANUAL'
    check (receivable_trigger in ('MANUAL', 'SCHEDULED', 'CONFIRMED', 'STARTED', 'COMPLETED')),
  create_forecast_on_schedule boolean not null default true,
  cancellation_policy text not null default 'NO_CHARGE'
    check (cancellation_policy in ('NO_CHARGE', 'FULL_CHARGE', 'PARTIAL_CHARGE')),
  cancellation_percentage numeric(5,2) not null default 0
    check (cancellation_percentage >= 0 and cancellation_percentage <= 100),
  cancellation_tolerance_hours integer not null default 0
    check (cancellation_tolerance_hours >= 0 and cancellation_tolerance_hours <= 720),
  charge_no_show boolean not null default false,
  reschedule_keeps_charge boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_payments_finance_idempotency
  on public.payments (organization_id, idempotency_key)
  where organization_id is not null and idempotency_key is not null;
create index if not exists idx_payments_finance_patient_status
  on public.payments (organization_id, patient_id, financial_status, due_date);
create index if not exists idx_payment_items_charge
  on public.payment_appointment_items (organization_id, payment_id);
create unique index if not exists idx_payment_items_one_active_charge_per_appointment
  on public.payment_appointment_items (organization_id, appointment_id)
  where appointment_id is not null and active = true;
create unique index if not exists idx_payment_transactions_idempotency
  on public.payment_transactions (organization_id, idempotency_key);
create index if not exists idx_payment_transactions_charge
  on public.payment_transactions (organization_id, payment_id, transaction_at desc);
create unique index if not exists idx_payment_audit_idempotency
  on public.payment_audit_events (organization_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists idx_payment_audit_charge
  on public.payment_audit_events (organization_id, payment_id, created_at desc);

insert into public.payment_transactions (
  organization_id, clinic_id, payment_id, patient_id, transaction_type, amount,
  method, transaction_at, status, proof_url, proof_file_name, proof_content_type,
  document_status, notes, idempotency_key, created_by, created_at
)
select
  p.organization_id,
  p.clinic_id,
  p.id,
  p.patient_id::uuid,
  'PAYMENT',
  coalesce(nullif(p.paid_amount, 0), p.amount, 0),
  p.method,
  coalesce(p.payment_date::timestamptz, p.created_at, now()),
  'POSTED',
  p.receipt_url,
  p.receipt_file_name,
  p.receipt_content_type,
  case when p.receipt_url is null then 'PENDING' else 'PROVIDED' end,
  'Pagamento legado preservado na migração para o financeiro por consulta.',
  'legacy-payment:' || p.id::text,
  p.created_by,
  coalesce(p.created_at, now())
from public.payments p
where p.organization_id is not null
  and p.patient_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and coalesce(nullif(p.paid_amount, 0), case when lower(coalesce(p.status, '')) in ('paid', 'refunded') then p.amount else 0 end, 0) > 0
  and exists (
    select 1 from public.patients patient
    where patient.id = p.patient_id::uuid and patient.clinic_id = p.organization_id
  )
on conflict (organization_id, idempotency_key) do nothing;

insert into public.payment_transactions (
  organization_id, clinic_id, payment_id, patient_id, transaction_type, amount,
  method, transaction_at, status, document_status, notes, idempotency_key, created_by, created_at
)
select
  p.organization_id,
  p.clinic_id,
  p.id,
  p.patient_id::uuid,
  'REFUND',
  coalesce(nullif(p.refunded_amount, 0), p.amount, 0),
  p.method,
  coalesce(p.updated_at, p.created_at, now()),
  'POSTED',
  'PENDING',
  'Estorno legado preservado na migração para o financeiro por consulta.',
  'legacy-refund:' || p.id::text,
  p.created_by,
  coalesce(p.updated_at, p.created_at, now())
from public.payments p
where p.organization_id is not null
  and lower(coalesce(p.status, '')) = 'refunded'
  and p.patient_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and coalesce(nullif(p.refunded_amount, 0), p.amount, 0) > 0
  and exists (
    select 1 from public.patients patient
    where patient.id = p.patient_id::uuid and patient.clinic_id = p.organization_id
  )
on conflict (organization_id, idempotency_key) do nothing;

create or replace function public.patient_financial_charge_payload(p_payment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'charge', to_jsonb(p),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.appointment_scheduled_at nulls last, i.created_at)
      from public.payment_appointment_items i
      where i.payment_id = p.id
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.transaction_at desc, t.created_at desc)
      from public.payment_transactions t
      where t.payment_id = p.id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at desc)
      from (
        select * from public.payment_audit_events ae
        where ae.payment_id = p.id
        order by ae.created_at desc
        limit 100
      ) e
    ), '[]'::jsonb)
  )
  from public.payments p
  where p.id = p_payment_id;
$$;

create or replace function public.refresh_patient_financial_charge(p_payment_id uuid)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge public.payments%rowtype;
  v_paid numeric(14,2);
  v_discount numeric(14,2);
  v_refunded numeric(14,2);
  v_total numeric(14,2);
  v_balance numeric(14,2);
  v_status text;
begin
  select * into v_charge
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'PATIENT_FINANCIAL_CHARGE_NOT_FOUND';
  end if;

  select
    coalesce(sum(amount) filter (where transaction_type = 'PAYMENT' and status = 'POSTED'), 0),
    coalesce(sum(amount) filter (where transaction_type in ('DISCOUNT', 'COURTESY') and status = 'POSTED'), 0),
    coalesce(sum(amount) filter (where transaction_type = 'REFUND' and status = 'POSTED'), 0)
  into v_paid, v_discount, v_refunded
  from public.payment_transactions
  where payment_id = p_payment_id;

  if not exists (
    select 1 from public.payment_transactions
    where payment_id = p_payment_id and transaction_type = 'PAYMENT' and status = 'POSTED'
  ) then
    v_paid := coalesce(v_charge.paid_amount, case when lower(coalesce(v_charge.status, '')) in ('paid', 'refunded') then v_charge.amount else 0 end, 0);
  end if;
  if not exists (
    select 1 from public.payment_transactions
    where payment_id = p_payment_id and transaction_type in ('DISCOUNT', 'COURTESY') and status = 'POSTED'
  ) then
    v_discount := coalesce(v_charge.discount_amount, 0);
  end if;
  if not exists (
    select 1 from public.payment_transactions
    where payment_id = p_payment_id and transaction_type = 'REFUND' and status = 'POSTED'
  ) then
    v_refunded := coalesce(v_charge.refunded_amount, case when lower(coalesce(v_charge.status, '')) = 'refunded' then v_charge.amount else 0 end, 0);
  end if;

  v_total := greatest(coalesce(v_charge.original_amount, v_charge.base_amount, v_charge.amount, 0) + coalesce(v_charge.additional_amount, 0) - v_discount, 0);
  v_balance := greatest(v_total - v_paid + v_refunded, 0);

  v_status := case
    when v_charge.canceled_at is not null then 'canceled'
    when v_charge.is_courtesy then 'courtesy'
    when v_paid > 0 and v_refunded >= v_paid then 'refunded'
    when v_balance <= 0 then 'paid'
    when (v_paid - v_refunded) > 0 then 'partial'
    when coalesce(v_charge.financial_status, v_charge.status) = 'forecast'
      and not exists (
        select 1 from public.payment_transactions t
        where t.payment_id = p_payment_id and t.status = 'POSTED'
      ) then 'forecast'
    when v_charge.due_date is not null and v_charge.due_date < current_date then 'overdue'
    else 'pending'
  end;

  update public.payments
  set
    amount = v_total,
    discount_amount = v_discount,
    paid_amount = v_paid,
    refunded_amount = v_refunded,
    balance_amount = v_balance,
    financial_status = v_status,
    status = v_status,
    payment_date = coalesce((
      select (transaction_at at time zone 'America/Sao_Paulo')::date
      from public.payment_transactions
      where payment_id = p_payment_id and transaction_type = 'PAYMENT' and status = 'POSTED'
      order by transaction_at desc, created_at desc
      limit 1
    ), v_charge.payment_date),
    method = coalesce((
      select nullif(trim(method), '')
      from public.payment_transactions
      where payment_id = p_payment_id and transaction_type = 'PAYMENT' and status = 'POSTED'
      order by transaction_at desc, created_at desc
      limit 1
    ), method),
    last_payment_at = coalesce((
      select max(transaction_at)
      from public.payment_transactions
      where payment_id = p_payment_id and transaction_type = 'PAYMENT' and status = 'POSTED'
    ), v_charge.last_payment_at),
    updated_at = now()
  where id = p_payment_id
  returning * into v_charge;

  return v_charge;
end;
$$;

create or replace function public.payment_transaction_refresh_charge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_patient_financial_charge(coalesce(new.payment_id, old.payment_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists payment_transactions_refresh_charge on public.payment_transactions;
create trigger payment_transactions_refresh_charge
after insert or update or delete on public.payment_transactions
for each row execute function public.payment_transaction_refresh_charge();

create or replace function public.create_patient_financial_charge(
  p_organization_id uuid,
  p_patient_id uuid,
  p_items jsonb,
  p_original_amount numeric,
  p_additional_amount numeric,
  p_discount_amount numeric,
  p_due_date date,
  p_method text,
  p_source text,
  p_competence_month date,
  p_notes text,
  p_idempotency_key text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_payment_id uuid;
  v_patient_name text;
  v_item_count integer;
  v_total numeric(14,2);
  v_invalid_count integer;
begin
  if p_organization_id is null or p_patient_id is null then
    raise exception 'PATIENT_FINANCE_TENANT_OR_PATIENT_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'PATIENT_FINANCE_IDEMPOTENCY_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_idempotency_key, 0));

  select id into v_existing_id
  from public.payments
  where organization_id = p_organization_id
    and idempotency_key = p_idempotency_key
  limit 1;
  if v_existing_id is not null then
    return public.patient_financial_charge_payload(v_existing_id);
  end if;

  select name into v_patient_name
  from public.patients
  where id = p_patient_id
    and clinic_id = p_organization_id
    and coalesce(is_active, true) = true
    and deleted_at is null
  limit 1;
  if v_patient_name is null then
    raise exception 'PATIENT_FINANCE_PATIENT_NOT_FOUND';
  end if;

  v_item_count := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
  if v_item_count > 50 then
    raise exception 'PATIENT_FINANCE_TOO_MANY_ITEMS';
  end if;

  if v_item_count > 0 then
    select count(*) into v_invalid_count
    from jsonb_array_elements(p_items) item
    left join public.appointments a
      on a.id = nullif(item->>'appointmentId', '')::uuid
     and (a.organization_id = p_organization_id or a.clinic_id = p_organization_id)
     and a.patient_id = p_patient_id
     and coalesce(a.is_active, true) = true
     and a.deleted_at is null
    where nullif(item->>'appointmentId', '') is null or a.id is null;
    if v_invalid_count > 0 then
      raise exception 'PATIENT_FINANCE_APPOINTMENT_SCOPE_INVALID';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_items) item
      join public.payment_appointment_items existing
        on existing.organization_id = p_organization_id
       and existing.appointment_id = nullif(item->>'appointmentId', '')::uuid
       and existing.active = true
    ) then
      raise exception 'PATIENT_FINANCE_APPOINTMENT_ALREADY_CHARGED';
    end if;
  end if;

  v_total := greatest(coalesce(p_original_amount, 0) + coalesce(p_additional_amount, 0) - coalesce(p_discount_amount, 0), 0);
  if v_total <= 0 and coalesce(p_discount_amount, 0) <= 0 then
    raise exception 'PATIENT_FINANCE_AMOUNT_REQUIRED';
  end if;

  insert into public.payments (
    organization_id, clinic_id, patient_id, patient_name, amount, original_amount, base_amount,
    additional_amount, discount_amount, paid_amount, refunded_amount, balance_amount,
    payment_date, due_date, method, status, financial_status, source, competence_month,
    notes, idempotency_key, created_by, created_at, updated_at
  ) values (
    p_organization_id, p_organization_id::text, p_patient_id::text, v_patient_name,
    v_total, coalesce(p_original_amount, 0), coalesce(p_original_amount, 0),
    coalesce(p_additional_amount, 0), coalesce(p_discount_amount, 0), 0, 0, v_total,
    null, p_due_date, nullif(trim(coalesce(p_method, '')), ''), 'pending',
    case when p_due_date is not null and p_due_date < current_date then 'overdue' else 'pending' end,
    coalesce(nullif(trim(p_source), ''), 'MANUAL'), p_competence_month,
    nullif(trim(coalesce(p_notes, '')), ''), p_idempotency_key, p_actor_id, now(), now()
  ) returning id into v_payment_id;

  if v_item_count > 0 then
    insert into public.payment_appointment_items (
      organization_id, clinic_id, payment_id, appointment_id, patient_id, professional_id,
      patient_name_snapshot, professional_name_snapshot, service_type_snapshot, specialty_snapshot,
      appointment_scheduled_at, quantity, unit_amount, subtotal, active
    )
    select
      p_organization_id,
      p_organization_id::text,
      v_payment_id,
      a.id,
      a.patient_id,
      a.therapist_id,
      v_patient_name,
      a.therapist_name,
      coalesce(nullif(item->>'serviceType', ''), a.service_type, a.approach, 'Consulta'),
      nullif(item->>'specialty', ''),
      coalesce(a.scheduled_start_at, a.scheduled_at),
      1,
      case
        when coalesce(item->>'unitAmount', '') ~ '^\d+(\.\d{1,2})?$' then (item->>'unitAmount')::numeric
        else round(v_total / greatest(v_item_count, 1), 2)
      end,
      case
        when coalesce(item->>'unitAmount', '') ~ '^\d+(\.\d{1,2})?$' then (item->>'unitAmount')::numeric
        else round(v_total / greatest(v_item_count, 1), 2)
      end,
      true
    from jsonb_array_elements(p_items) item
    join public.appointments a on a.id = nullif(item->>'appointmentId', '')::uuid;

    update public.payments p
    set
      appointment_id = first_item.appointment_id,
      professional_id = first_item.professional_id,
      service_type = first_item.service_type_snapshot,
      specialty = first_item.specialty_snapshot,
      appointment_scheduled_at = first_item.appointment_scheduled_at
    from (
      select *
      from public.payment_appointment_items
      where payment_id = v_payment_id
      order by appointment_scheduled_at nulls last, created_at
      limit 1
    ) first_item
    where p.id = v_payment_id;
  end if;

  if coalesce(p_discount_amount, 0) > 0 then
    insert into public.payment_transactions (
      organization_id, clinic_id, payment_id, patient_id, transaction_type, amount,
      transaction_at, status, document_status, notes, idempotency_key, created_by
    ) values (
      p_organization_id, p_organization_id::text, v_payment_id, p_patient_id,
      'DISCOUNT', p_discount_amount, now(), 'POSTED', 'PENDING',
      'Desconto informado na criação da cobrança.', p_idempotency_key || ':initial-discount', p_actor_id
    );
  end if;

  insert into public.payment_audit_events (
    organization_id, clinic_id, payment_id, appointment_id, event_type,
    before_state, after_state, notes, idempotency_key, created_by
  ) values (
    p_organization_id, p_organization_id::text, v_payment_id,
    (select appointment_id from public.payment_appointment_items where payment_id = v_payment_id order by created_at limit 1),
    'CHARGE_CREATED', '{}'::jsonb,
    (select to_jsonb(p) from public.payments p where p.id = v_payment_id),
    p_notes, p_idempotency_key || ':created', p_actor_id
  );

  return public.patient_financial_charge_payload(v_payment_id);
end;
$$;

create or replace function public.apply_patient_financial_operation(
  p_organization_id uuid,
  p_payment_id uuid,
  p_operation text,
  p_amount numeric,
  p_due_date date,
  p_method text,
  p_transaction_at timestamptz,
  p_proof_url text,
  p_proof_file_name text,
  p_proof_content_type text,
  p_notes text,
  p_idempotency_key text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge public.payments%rowtype;
  v_before jsonb;
  v_operation text := upper(trim(coalesce(p_operation, '')));
  v_amount numeric(14,2) := greatest(coalesce(p_amount, 0), 0);
  v_transaction_id uuid;
  v_existing_transaction_id uuid;
  v_event_type text;
  v_available_refund numeric(14,2);
  v_receipt_number text;
  v_existing_receipt_number text;
  v_existing_receipt_url text;
begin
  if p_organization_id is null or p_payment_id is null then
    raise exception 'PATIENT_FINANCE_SCOPE_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'PATIENT_FINANCE_IDEMPOTENCY_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_payment_id::text, 0));

  select id into v_existing_transaction_id
  from public.payment_transactions
  where organization_id = p_organization_id and idempotency_key = p_idempotency_key
  limit 1;
  if v_existing_transaction_id is not null then
    return public.patient_financial_charge_payload(p_payment_id);
  end if;
  if exists (
    select 1 from public.payment_audit_events
    where organization_id = p_organization_id and idempotency_key = p_idempotency_key
  ) then
    return public.patient_financial_charge_payload(p_payment_id);
  end if;

  select * into v_charge
  from public.payments
  where id = p_payment_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'PATIENT_FINANCIAL_CHARGE_NOT_FOUND';
  end if;
  v_before := to_jsonb(v_charge);

  if v_operation in ('PAYMENT', 'PARTIAL_PAYMENT') then
    if v_amount <= 0 then raise exception 'PATIENT_FINANCE_PAYMENT_AMOUNT_REQUIRED'; end if;
    if v_amount > coalesce(v_charge.balance_amount, v_charge.amount, 0) then
      raise exception 'PATIENT_FINANCE_PAYMENT_EXCEEDS_BALANCE';
    end if;
    insert into public.payment_transactions (
      organization_id, clinic_id, payment_id, patient_id, transaction_type, amount,
      method, transaction_at, proof_url, proof_file_name, proof_content_type,
      document_status, notes, idempotency_key, created_by
    ) values (
      p_organization_id, p_organization_id::text, p_payment_id, v_charge.patient_id::uuid,
      'PAYMENT', v_amount, nullif(trim(coalesce(p_method, '')), ''), coalesce(p_transaction_at, now()),
      nullif(trim(coalesce(p_proof_url, '')), ''), nullif(trim(coalesce(p_proof_file_name, '')), ''),
      nullif(trim(coalesce(p_proof_content_type, '')), ''),
      case when nullif(trim(coalesce(p_proof_url, '')), '') is null then 'PENDING' else 'PROVIDED' end,
      nullif(trim(coalesce(p_notes, '')), ''), p_idempotency_key, p_actor_id
    ) returning id into v_transaction_id;
    v_event_type := 'PAYMENT_RECORDED';
  elsif v_operation = 'DISCOUNT' then
    if v_amount <= 0 then raise exception 'PATIENT_FINANCE_DISCOUNT_AMOUNT_REQUIRED'; end if;
    if v_amount > coalesce(v_charge.balance_amount, v_charge.amount, 0) then
      raise exception 'PATIENT_FINANCE_DISCOUNT_EXCEEDS_BALANCE';
    end if;
    insert into public.payment_transactions (
      organization_id, clinic_id, payment_id, patient_id, transaction_type, amount,
      transaction_at, notes, idempotency_key, created_by
    ) values (
      p_organization_id, p_organization_id::text, p_payment_id, v_charge.patient_id::uuid,
      'DISCOUNT', v_amount, coalesce(p_transaction_at, now()), nullif(trim(coalesce(p_notes, '')), ''),
      p_idempotency_key, p_actor_id
    ) returning id into v_transaction_id;
    v_event_type := 'DISCOUNT_APPLIED';
  elsif v_operation = 'COURTESY' then
    v_amount := coalesce(v_charge.balance_amount, v_charge.amount, 0);
    if v_amount <= 0 then raise exception 'PATIENT_FINANCE_CHARGE_ALREADY_SETTLED'; end if;
    update public.payments set is_courtesy = true where id = p_payment_id;
    insert into public.payment_transactions (
      organization_id, clinic_id, payment_id, patient_id, transaction_type, amount,
      transaction_at, notes, idempotency_key, created_by
    ) values (
      p_organization_id, p_organization_id::text, p_payment_id, v_charge.patient_id::uuid,
      'COURTESY', v_amount, coalesce(p_transaction_at, now()), nullif(trim(coalesce(p_notes, '')), ''),
      p_idempotency_key, p_actor_id
    ) returning id into v_transaction_id;
    v_event_type := 'COURTESY_APPLIED';
  elsif v_operation = 'REFUND' then
    v_available_refund := greatest(coalesce(v_charge.paid_amount, 0) - coalesce(v_charge.refunded_amount, 0), 0);
    if v_amount <= 0 then raise exception 'PATIENT_FINANCE_REFUND_AMOUNT_REQUIRED'; end if;
    if v_amount > v_available_refund then raise exception 'PATIENT_FINANCE_REFUND_EXCEEDS_PAID'; end if;
    insert into public.payment_transactions (
      organization_id, clinic_id, payment_id, patient_id, transaction_type, amount,
      method, transaction_at, notes, idempotency_key, created_by
    ) values (
      p_organization_id, p_organization_id::text, p_payment_id, v_charge.patient_id::uuid,
      'REFUND', v_amount, nullif(trim(coalesce(p_method, '')), ''), coalesce(p_transaction_at, now()),
      nullif(trim(coalesce(p_notes, '')), ''), p_idempotency_key, p_actor_id
    ) returning id into v_transaction_id;
    v_event_type := 'PAYMENT_REFUNDED';
  elsif v_operation = 'ISSUE_RECEIPT' then
    select id, receipt_number, receipt_url
    into v_transaction_id, v_existing_receipt_number, v_existing_receipt_url
    from public.payment_transactions
    where organization_id = p_organization_id
      and payment_id = p_payment_id
      and transaction_type = 'PAYMENT'
      and status = 'POSTED'
    order by transaction_at desc, created_at desc
    limit 1
    for update;
    if v_transaction_id is null then
      raise exception 'PATIENT_FINANCE_RECEIPT_REQUIRES_PAYMENT';
    end if;
    if v_existing_receipt_number is not null and v_existing_receipt_url is not null then
      return public.patient_financial_charge_payload(p_payment_id);
    end if;
    v_receipt_number := 'REC-' || upper(substr(replace(v_transaction_id::text, '-', ''), 1, 12));
    update public.payment_transactions
    set
      receipt_url = coalesce(nullif(trim(coalesce(p_proof_url, '')), ''), receipt_url),
      receipt_number = coalesce(receipt_number, v_receipt_number),
      document_status = 'ISSUED'
    where id = v_transaction_id;
    update public.payments
    set
      receipt_url = coalesce(nullif(trim(coalesce(p_proof_url, '')), ''), receipt_url),
      receipt_file_name = coalesce(nullif(trim(coalesce(p_proof_file_name, '')), ''), receipt_file_name),
      receipt_content_type = coalesce(nullif(trim(coalesce(p_proof_content_type, '')), ''), receipt_content_type),
      updated_at = now()
    where id = p_payment_id;
    v_event_type := 'RECEIPT_ISSUED';
  elsif v_operation = 'DUE_DATE_CHANGE' then
    if p_due_date is null then raise exception 'PATIENT_FINANCE_DUE_DATE_REQUIRED'; end if;
    update public.payments set due_date = p_due_date, updated_at = now() where id = p_payment_id;
    perform public.refresh_patient_financial_charge(p_payment_id);
    v_event_type := 'DUE_DATE_CHANGED';
  elsif v_operation = 'CANCEL' then
    if greatest(coalesce(v_charge.paid_amount, 0) - coalesce(v_charge.refunded_amount, 0), 0) > 0 then
      raise exception 'PATIENT_FINANCE_CANCEL_REQUIRES_REFUND';
    end if;
    update public.payments
    set canceled_at = now(), canceled_by = p_actor_id, financial_status = 'canceled', status = 'canceled', updated_at = now()
    where id = p_payment_id;
    update public.payment_appointment_items set active = false where payment_id = p_payment_id;
    v_event_type := 'CHARGE_CANCELED';
  else
    raise exception 'PATIENT_FINANCE_OPERATION_INVALID';
  end if;

  if v_operation not in ('DUE_DATE_CHANGE', 'CANCEL', 'ISSUE_RECEIPT') then
    perform public.refresh_patient_financial_charge(p_payment_id);
  end if;

  insert into public.payment_audit_events (
    organization_id, clinic_id, payment_id, transaction_id, appointment_id,
    event_type, before_state, after_state, notes, idempotency_key, created_by
  ) values (
    p_organization_id, p_organization_id::text, p_payment_id, v_transaction_id,
    (select appointment_id from public.payment_appointment_items where payment_id = p_payment_id order by created_at limit 1),
    v_event_type, v_before,
    (select to_jsonb(p) from public.payments p where p.id = p_payment_id),
    nullif(trim(coalesce(p_notes, '')), ''), p_idempotency_key, p_actor_id
  );

  return public.patient_financial_charge_payload(p_payment_id);
end;
$$;

create or replace function public.create_and_settle_patient_financial_charge(
  p_organization_id uuid,
  p_patient_id uuid,
  p_items jsonb,
  p_original_amount numeric,
  p_additional_amount numeric,
  p_discount_amount numeric,
  p_due_date date,
  p_method text,
  p_source text,
  p_competence_month date,
  p_notes text,
  p_payment_amount numeric,
  p_transaction_at timestamptz,
  p_proof_url text,
  p_proof_file_name text,
  p_proof_content_type text,
  p_idempotency_key text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created jsonb;
  v_payment_id uuid;
begin
  v_created := public.create_patient_financial_charge(
    p_organization_id,
    p_patient_id,
    p_items,
    p_original_amount,
    p_additional_amount,
    p_discount_amount,
    p_due_date,
    p_method,
    p_source,
    p_competence_month,
    p_notes,
    p_idempotency_key || ':charge',
    p_actor_id
  );
  v_payment_id := nullif(v_created #>> '{charge,id}', '')::uuid;
  if v_payment_id is null then
    raise exception 'PATIENT_FINANCIAL_CHARGE_NOT_FOUND';
  end if;
  return public.apply_patient_financial_operation(
    p_organization_id,
    v_payment_id,
    case when p_payment_amount < p_original_amount + p_additional_amount - p_discount_amount then 'PARTIAL_PAYMENT' else 'PAYMENT' end,
    p_payment_amount,
    p_due_date,
    p_method,
    p_transaction_at,
    p_proof_url,
    p_proof_file_name,
    p_proof_content_type,
    p_notes,
    p_idempotency_key || ':payment',
    p_actor_id
  );
end;
$$;

create or replace function public.sync_private_appointment_finance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid := coalesce(new.organization_id, new.clinic_id);
  v_policy public.clinic_patient_finance_policies%rowtype;
  v_plan public.patient_financial_plans%rowtype;
  v_charge public.payments%rowtype;
  v_payload jsonb;
  v_payment_id uuid;
  v_context_type text;
  v_service_type text := trim(coalesce(new.service_type, new.approach, new.source_payload->>'serviceType', new.source_payload->>'service_type', ''));
  v_event text := 'SCHEDULED';
  v_actor_id text := nullif(trim(coalesce(new.source_payload->>'updatedBy', new.source_payload->>'createdBy', new.source_payload->>'created_by', '')), '');
  v_start_at timestamptz := coalesce(new.scheduled_start_at, new.scheduled_at);
  v_appointment_date date;
  v_due_date date;
  v_competence_month date;
  v_candidate_count integer := 0;
  v_exact_match_count integer := 0;
  v_charge_cycle integer := 0;
  v_should_create boolean := false;
  v_should_activate boolean := false;
  v_within_tolerance boolean := true;
  v_target_amount numeric(14,2);
  v_discount_amount numeric(14,2);
  v_is_reschedule boolean := false;
begin
  if v_organization_id is null or new.patient_id is null or new.id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_organization_id::text || ':appointment-finance:' || new.id::text, 0));

  select upper(coalesce(nullif(trim(context.payer_type), ''), ''))
  into v_context_type
  from public.appointment_billing_contexts context
  where context.organization_id = v_organization_id
    and context.appointment_id = new.id
  order by context.updated_at desc nulls last
  limit 1;

  v_context_type := upper(coalesce(
    nullif(v_context_type, ''),
    nullif(trim(new.source_payload->>'financialContextType'), ''),
    nullif(trim(new.source_payload->>'financial_context_type'), ''),
    nullif(trim(new.source_payload->>'payerType'), ''),
    nullif(trim(new.source_payload->>'payer_type'), ''),
    'PRIVATE'
  ));
  if v_context_type not in ('PRIVATE', 'PARTICULAR') then
    return new;
  end if;

  select * into v_policy
  from public.clinic_patient_finance_policies
  where organization_id = v_organization_id;
  if not found then
    v_policy.organization_id := v_organization_id;
    v_policy.receivable_trigger := 'MANUAL';
    v_policy.create_forecast_on_schedule := true;
    v_policy.cancellation_policy := 'NO_CHARGE';
    v_policy.cancellation_percentage := 0;
    v_policy.cancellation_tolerance_hours := 0;
    v_policy.charge_no_show := false;
    v_policy.reschedule_keeps_charge := true;
  end if;

  v_event := case lower(coalesce(new.status, 'scheduled'))
    when 'confirmed' then 'CONFIRMED'
    when 'in_progress' then 'STARTED'
    when 'completed' then 'COMPLETED'
    when 'cancelled' then 'CANCELED'
    when 'canceled' then 'CANCELED'
    when 'no_show' then 'NO_SHOW'
    when 'missed' then 'NO_SHOW'
    else 'SCHEDULED'
  end;

  if coalesce(new.source_payload->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    v_appointment_date := (new.source_payload->>'date')::date;
  elsif v_start_at is not null then
    v_appointment_date := (v_start_at at time zone 'America/Sao_Paulo')::date;
  else
    v_appointment_date := current_date;
  end if;
  if tg_op = 'UPDATE' then
    v_is_reschedule := coalesce(old.scheduled_start_at, old.scheduled_at)
      is distinct from coalesce(new.scheduled_start_at, new.scheduled_at);
  end if;
  v_competence_month := date_trunc('month', v_appointment_date)::date;

  select p.* into v_charge
  from public.payment_appointment_items item
  join public.payments p on p.id = item.payment_id
  where item.organization_id = v_organization_id
    and item.appointment_id = new.id
    and item.active = true
  order by item.created_at
  limit 1
  for update of p;

  select count(*) into v_charge_cycle
  from public.payment_appointment_items
  where organization_id = v_organization_id
    and appointment_id = new.id;

  if v_charge.id is not null and not (
    v_is_reschedule
    and v_policy.reschedule_keeps_charge = false
    and greatest(coalesce(v_charge.paid_amount, 0) - coalesce(v_charge.refunded_amount, 0), 0) = 0
    and coalesce(v_charge.financial_status, v_charge.status, 'pending') not in ('canceled', 'courtesy', 'refunded')
  ) then
    update public.payment_appointment_items
    set
      professional_id = new.therapist_id,
      professional_name_snapshot = coalesce(nullif(new.therapist_name, ''), professional_name_snapshot),
      service_type_snapshot = coalesce(nullif(v_service_type, ''), service_type_snapshot),
      appointment_scheduled_at = v_start_at
    where organization_id = v_organization_id
      and appointment_id = new.id
      and active = true;
    update public.payments
    set
      professional_id = new.therapist_id,
      service_type = coalesce(nullif(v_service_type, ''), service_type),
      appointment_scheduled_at = v_start_at,
      updated_at = now()
    where id = v_charge.id;
  end if;

  select
    count(*),
    count(*) filter (
      where lower(coalesce(nullif(p.service_name_snapshot, ''), nullif(p.custom_service_name, ''), p.service_type)) = lower(v_service_type)
    )
  into v_candidate_count, v_exact_match_count
  from public.patient_financial_plans p
  where p.organization_id = v_organization_id
    and p.patient_id = new.patient_id
    and p.status = 'ACTIVE'
    and p.billing_mode = 'PRIVATE'
    and coalesce(p.quantity_period, 'SESSION') = 'SESSION'
    and p.amount_cents > 0;

  if v_candidate_count = 1 or v_exact_match_count > 0 then
    select p.* into v_plan
    from public.patient_financial_plans p
    where p.organization_id = v_organization_id
      and p.patient_id = new.patient_id
      and p.status = 'ACTIVE'
      and p.billing_mode = 'PRIVATE'
      and coalesce(p.quantity_period, 'SESSION') = 'SESSION'
      and p.amount_cents > 0
      and (
        v_exact_match_count = 0
        or lower(coalesce(nullif(p.service_name_snapshot, ''), nullif(p.custom_service_name, ''), p.service_type)) = lower(v_service_type)
      )
    order by p.updated_at desc, p.created_at desc
    limit 1;
  end if;

  if v_plan.id is not null then
    if v_plan.due_day is not null then
      v_due_date := make_date(
        extract(year from v_appointment_date)::integer,
        extract(month from v_appointment_date)::integer,
        least(
          v_plan.due_day,
          extract(day from (date_trunc('month', v_appointment_date) + interval '1 month - 1 day'))::integer
        )
      );
    else
      v_due_date := v_appointment_date;
    end if;
  end if;

  if v_event = 'CANCELED' and coalesce(v_policy.cancellation_tolerance_hours, 0) > 0 and v_start_at is not null then
    v_within_tolerance := v_start_at <= now() + make_interval(hours => v_policy.cancellation_tolerance_hours);
  end if;

  if v_event in ('CANCELED', 'NO_SHOW') then
    if v_event = 'NO_SHOW' then
      if v_policy.charge_no_show then
        v_should_activate := true;
      else
        if v_charge.id is not null and coalesce(v_charge.paid_amount, 0) <= 0 then
          update public.payments
          set canceled_at = now(), canceled_by = v_actor_id, financial_status = 'canceled', status = 'canceled', updated_at = now()
          where id = v_charge.id;
          update public.payment_appointment_items set active = false where payment_id = v_charge.id;
          insert into public.payment_audit_events (
            organization_id, clinic_id, payment_id, appointment_id, event_type,
            before_state, after_state, notes, idempotency_key, created_by
          ) values (
            v_organization_id, v_organization_id::text, v_charge.id, new.id,
            'CHARGE_CANCELED_BY_APPOINTMENT', to_jsonb(v_charge),
            (select to_jsonb(p) from public.payments p where p.id = v_charge.id),
            'Falta sem cobrança conforme política da clínica.',
            'appointment-policy:' || new.id::text || ':charge:' || v_charge.id::text || ':no-show-no-charge', v_actor_id
          ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;
        end if;
        return new;
      end if;
    elsif v_policy.cancellation_policy = 'NO_CHARGE' or not v_within_tolerance then
      if v_charge.id is not null and coalesce(v_charge.paid_amount, 0) <= 0 then
        update public.payments
        set canceled_at = now(), canceled_by = v_actor_id, financial_status = 'canceled', status = 'canceled', updated_at = now()
        where id = v_charge.id;
        update public.payment_appointment_items set active = false where payment_id = v_charge.id;
        insert into public.payment_audit_events (
          organization_id, clinic_id, payment_id, appointment_id, event_type,
          before_state, after_state, notes, idempotency_key, created_by
        ) values (
          v_organization_id, v_organization_id::text, v_charge.id, new.id,
          'CHARGE_CANCELED_BY_APPOINTMENT', to_jsonb(v_charge),
          (select to_jsonb(p) from public.payments p where p.id = v_charge.id),
          'Consulta cancelada conforme política da clínica.',
          'appointment-policy:' || new.id::text || ':charge:' || v_charge.id::text || ':canceled', v_actor_id
        ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;
      end if;
      return new;
    else
      v_should_activate := true;
    end if;
  else
    v_should_create := v_plan.id is not null and (
      (v_event = 'SCHEDULED' and coalesce(v_policy.create_forecast_on_schedule, true))
      or upper(coalesce(v_policy.receivable_trigger, 'MANUAL')) = v_event
    );
    v_should_activate := upper(coalesce(v_policy.receivable_trigger, 'MANUAL')) = v_event;
  end if;

  if v_is_reschedule
    and v_policy.reschedule_keeps_charge = false
    and v_charge.id is not null
    and greatest(coalesce(v_charge.paid_amount, 0) - coalesce(v_charge.refunded_amount, 0), 0) = 0
    and coalesce(v_charge.financial_status, v_charge.status, 'pending') not in ('canceled', 'courtesy', 'refunded')
    and coalesce(v_charge.amount, 0) > 0 then
    update public.payments
    set canceled_at = now(), canceled_by = v_actor_id, financial_status = 'canceled', status = 'canceled', updated_at = now()
    where id = v_charge.id;
    update public.payment_appointment_items
    set active = false
    where payment_id = v_charge.id and appointment_id = new.id and active = true;
    insert into public.payment_audit_events (
      organization_id, clinic_id, payment_id, appointment_id, event_type,
      before_state, after_state, notes, idempotency_key, created_by
    ) values (
      v_organization_id, v_organization_id::text, v_charge.id, new.id,
      'CHARGE_CANCELED_BY_RESCHEDULE', to_jsonb(v_charge),
      (select to_jsonb(p) from public.payments p where p.id = v_charge.id),
      'Cobrança anterior encerrada porque a política da clínica cria nova obrigação após remarcação.',
      'appointment-policy:' || new.id::text || ':charge:' || v_charge.id::text || ':rescheduled', v_actor_id
    ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;

    v_payload := public.create_patient_financial_charge(
      v_organization_id,
      new.patient_id,
      jsonb_build_array(jsonb_build_object(
        'appointmentId', new.id,
        'unitAmount', coalesce(v_charge.amount, 0),
        'serviceType', coalesce(nullif(v_service_type, ''), v_charge.service_type, 'Consulta'),
        'specialty', v_charge.specialty
      )),
      coalesce(v_charge.amount, 0),
      0,
      0,
      coalesce(v_due_date, v_charge.due_date, v_appointment_date),
      v_charge.method,
      case
        when coalesce(v_charge.financial_status, v_charge.status) = 'forecast' then 'APPOINTMENT_FORECAST'
        else 'APPOINTMENT_RESCHEDULE'
      end,
      v_competence_month,
      'Nova cobrança criada conforme política explícita de remarcação da clínica.',
      'appointment-policy:' || new.id::text || ':cycle:' || v_charge_cycle::text,
      v_actor_id
    );
    v_payment_id := nullif(v_payload #>> '{charge,id}', '')::uuid;
    if v_payment_id is not null then
      select * into v_charge from public.payments where id = v_payment_id for update;
      insert into public.payment_audit_events (
        organization_id, clinic_id, payment_id, appointment_id, event_type,
        before_state, after_state, notes, idempotency_key, created_by
      ) values (
        v_organization_id, v_organization_id::text, v_charge.id, new.id,
        'CHARGE_RECREATED_AFTER_RESCHEDULE', '{}'::jsonb, to_jsonb(v_charge),
        'Cobrança vinculada ao novo horário da consulta.',
        'appointment-policy:' || new.id::text || ':charge:' || v_charge.id::text || ':reschedule-created', v_actor_id
      ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;
    end if;
  end if;

  if v_charge.id is null and v_plan.id is not null and (v_should_create or v_should_activate) then
    v_payload := public.create_patient_financial_charge(
      v_organization_id,
      new.patient_id,
      jsonb_build_array(jsonb_build_object(
        'appointmentId', new.id,
        'unitAmount', round(v_plan.amount_cents::numeric / 100, 2),
        'serviceType', coalesce(nullif(v_service_type, ''), v_plan.service_name_snapshot, v_plan.service_type),
        'specialty', v_plan.service_name_snapshot
      )),
      round(v_plan.amount_cents::numeric / 100, 2),
      0,
      0,
      v_due_date,
      v_plan.payment_method,
      case when v_should_activate then 'APPOINTMENT_POLICY' else 'APPOINTMENT_FORECAST' end,
      v_competence_month,
      'Previsão vinculada automaticamente à consulta; não representa pagamento recebido.',
      'appointment-policy:' || new.id::text || ':cycle:' || v_charge_cycle::text,
      v_actor_id
    );
    v_payment_id := nullif(v_payload #>> '{charge,id}', '')::uuid;
    if v_payment_id is not null then
      select * into v_charge from public.payments where id = v_payment_id for update;
    end if;
  end if;

  if v_charge.id is null then
    return new;
  end if;

  if v_should_activate then
    update public.payments
    set financial_status = 'pending', status = 'pending', source = 'APPOINTMENT_POLICY', updated_at = now()
    where id = v_charge.id
      and coalesce(financial_status, status, 'forecast') = 'forecast';
    perform public.refresh_patient_financial_charge(v_charge.id);
    insert into public.payment_audit_events (
      organization_id, clinic_id, payment_id, appointment_id, event_type,
      before_state, after_state, notes, idempotency_key, created_by
    ) values (
      v_organization_id, v_organization_id::text, v_charge.id, new.id,
      'CHARGE_ACTIVATED_BY_APPOINTMENT', to_jsonb(v_charge),
      (select to_jsonb(p) from public.payments p where p.id = v_charge.id),
      'Cobrança efetivada conforme o evento ' || v_event || '.',
      'appointment-policy:' || new.id::text || ':charge:' || v_charge.id::text || ':activated:' || v_event, v_actor_id
    ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;

    if v_event = 'CANCELED' and v_policy.cancellation_policy = 'PARTIAL_CHARGE' then
      v_target_amount := round(coalesce(v_charge.original_amount, v_charge.amount, 0) * coalesce(v_policy.cancellation_percentage, 0) / 100, 2);
      v_discount_amount := greatest(coalesce(v_charge.original_amount, v_charge.amount, 0) - v_target_amount, 0);
      if v_discount_amount > 0 then
        insert into public.payment_transactions (
          organization_id, clinic_id, payment_id, patient_id, transaction_type, amount,
          transaction_at, status, document_status, notes, idempotency_key, created_by
        ) values (
          v_organization_id, v_organization_id::text, v_charge.id, new.patient_id,
          'DISCOUNT', v_discount_amount, now(), 'POSTED', 'PENDING',
          'Ajuste automático conforme política de cancelamento parcial.',
          'appointment-policy:' || new.id::text || ':charge:' || v_charge.id::text || ':partial-cancellation', v_actor_id
        ) on conflict (organization_id, idempotency_key) do nothing;
        perform public.refresh_patient_financial_charge(v_charge.id);
      end if;
    end if;
  elsif coalesce(v_policy.create_forecast_on_schedule, true)
    and v_charge.source = 'APPOINTMENT_FORECAST'
    and coalesce(v_charge.financial_status, v_charge.status) = 'pending' then
    update public.payments
    set financial_status = 'forecast', status = 'forecast', source = 'APPOINTMENT_FORECAST', updated_at = now()
    where id = v_charge.id
      and coalesce(paid_amount, 0) = 0
      and not exists (
        select 1 from public.payment_transactions t
        where t.payment_id = v_charge.id and t.status = 'POSTED'
      );
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_sync_private_finance on public.appointments;
create trigger appointments_sync_private_finance
after insert or update of status, scheduled_at, scheduled_start_at, scheduled_end_at, service_type, approach, source_payload
on public.appointments
for each row execute function public.sync_private_appointment_finance();

create or replace view public.patient_financial_appointment_summaries
with (security_invoker = true)
as
select
  i.organization_id,
  i.clinic_id,
  i.appointment_id,
  i.patient_id,
  i.professional_id,
  i.patient_name_snapshot,
  i.professional_name_snapshot,
  i.service_type_snapshot,
  i.specialty_snapshot,
  i.appointment_scheduled_at,
  i.quantity,
  i.unit_amount,
  i.subtotal,
  p.id as payment_id,
  p.original_amount,
  p.additional_amount,
  p.discount_amount,
  p.amount as total_amount,
  p.paid_amount,
  p.refunded_amount,
  p.balance_amount,
  p.due_date,
  p.method,
  p.last_payment_at,
  case
    when p.canceled_at is not null then 'canceled'
    when p.is_courtesy then 'courtesy'
    when p.paid_amount > 0 and p.refunded_amount >= p.paid_amount then 'refunded'
    when p.balance_amount <= 0 then 'paid'
    when (p.paid_amount - p.refunded_amount) > 0 then 'partial'
    when coalesce(p.financial_status, p.status) = 'forecast' then 'forecast'
    when p.due_date is not null and p.due_date < current_date then 'overdue'
    else coalesce(p.financial_status, p.status, 'pending')
  end as financial_status,
  p.source,
  p.notes,
  p.created_at,
  p.updated_at
from public.payment_appointment_items i
join public.payments p on p.id = i.payment_id
where i.active = true;

alter table public.payment_appointment_items enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.payment_audit_events enable row level security;
alter table public.clinic_patient_finance_policies enable row level security;

drop policy if exists payments_clinic_finance_read on public.payments;
drop policy if exists payments_clinic_finance_write on public.payments;
drop policy if exists payments_patient_finance_rw on public.payments;
create policy payments_patient_finance_rw on public.payments
for all to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'receptionist')
      and (
        u.clinic_id::text = coalesce(payments.organization_id::text, payments.clinic_id)
        or u.id::text = coalesce(payments.organization_id::text, payments.clinic_id)
      )
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'receptionist')
      and (
        u.clinic_id::text = coalesce(payments.organization_id::text, payments.clinic_id)
        or u.id::text = coalesce(payments.organization_id::text, payments.clinic_id)
      )
  )
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['payment_appointment_items', 'payment_transactions', 'payment_audit_events']
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_patient_finance_rw', table_name);
    execute format($policy$
      create policy %I on public.%I
      for all to authenticated
      using (
        exists (
          select 1 from public.users u
          where u.id = auth.uid()
            and u.role in ('owner', 'admin', 'coordinator', 'receptionist')
            and (u.clinic_id::text = %I.organization_id::text or u.id::text = %I.organization_id::text)
        )
      )
      with check (
        exists (
          select 1 from public.users u
          where u.id = auth.uid()
            and u.role in ('owner', 'admin', 'coordinator', 'receptionist')
            and (u.clinic_id::text = %I.organization_id::text or u.id::text = %I.organization_id::text)
        )
      )
    $policy$,
      table_name || '_patient_finance_rw',
      table_name,
      table_name,
      table_name,
      table_name,
      table_name
    );
  end loop;
end $$;

drop policy if exists clinic_patient_finance_policies_read on public.clinic_patient_finance_policies;
create policy clinic_patient_finance_policies_read on public.clinic_patient_finance_policies
for select to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator', 'receptionist')
      and (u.clinic_id::text = organization_id::text or u.id::text = organization_id::text)
  )
);

drop policy if exists clinic_patient_finance_policies_manage on public.clinic_patient_finance_policies;
create policy clinic_patient_finance_policies_manage on public.clinic_patient_finance_policies
for all to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id::text = organization_id::text or u.id::text = organization_id::text)
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin', 'coordinator')
      and (u.clinic_id::text = organization_id::text or u.id::text = organization_id::text)
  )
);

revoke all on function public.patient_financial_charge_payload(uuid) from public, anon, authenticated;
revoke all on function public.refresh_patient_financial_charge(uuid) from public, anon, authenticated;
revoke all on function public.create_patient_financial_charge(uuid, uuid, jsonb, numeric, numeric, numeric, date, text, text, date, text, text, text) from public, anon, authenticated;
revoke all on function public.apply_patient_financial_operation(uuid, uuid, text, numeric, date, text, timestamptz, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_and_settle_patient_financial_charge(uuid, uuid, jsonb, numeric, numeric, numeric, date, text, text, date, text, numeric, timestamptz, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.sync_private_appointment_finance() from public, anon, authenticated;
grant execute on function public.patient_financial_charge_payload(uuid) to service_role;
grant execute on function public.refresh_patient_financial_charge(uuid) to service_role;
grant execute on function public.create_patient_financial_charge(uuid, uuid, jsonb, numeric, numeric, numeric, date, text, text, date, text, text, text) to service_role;
grant execute on function public.apply_patient_financial_operation(uuid, uuid, text, numeric, date, text, timestamptz, text, text, text, text, text, text) to service_role;
grant execute on function public.create_and_settle_patient_financial_charge(uuid, uuid, jsonb, numeric, numeric, numeric, date, text, text, date, text, numeric, timestamptz, text, text, text, text, text) to service_role;
grant select on public.patient_financial_appointment_summaries to authenticated, service_role;
