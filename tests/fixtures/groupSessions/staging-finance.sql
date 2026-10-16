create table public.payment_transactions ("id" uuid default gen_random_uuid() not null,"organization_id" uuid not null,"clinic_id" text not null,"payment_id" text not null,"patient_id" uuid not null,"transaction_type" text not null,"amount" numeric(14,2) not null,"method" text,"transaction_at" timestamp with time zone default now() not null,"status" text default 'POSTED'::text not null,"proof_url" text,"proof_file_name" text,"proof_content_type" text,"receipt_url" text,"receipt_number" text,"document_status" text default 'PENDING'::text not null,"notes" text,"idempotency_key" text not null,"created_by" text,"created_at" timestamp with time zone default now() not null,"voided_at" timestamp with time zone,"voided_by" text,CHECK ((amount >= (0)::numeric)),CHECK ((document_status = ANY (ARRAY['PENDING'::text, 'PROVIDED'::text, 'VALIDATED'::text, 'REJECTED'::text, 'ISSUED'::text]))),PRIMARY KEY (id),CHECK ((status = ANY (ARRAY['POSTED'::text, 'VOIDED'::text]))),CHECK ((transaction_type = ANY (ARRAY['PAYMENT'::text, 'DISCOUNT'::text, 'COURTESY'::text, 'REFUND'::text, 'ADJUSTMENT'::text]))));
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointment_billing_contexts_appointment ON public.appointment_billing_contexts USING btree (organization_id, appointment_id);
CREATE INDEX IF NOT EXISTS idx_appointment_billing_contexts_payer ON public.appointment_billing_contexts USING btree (organization_id, payer_id);
CREATE INDEX IF NOT EXISTS idx_appointment_billing_contexts_patient ON public.appointment_billing_contexts USING btree (organization_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_appointment_billing_contexts_source ON public.appointment_billing_contexts USING btree (organization_id, source);
CREATE INDEX IF NOT EXISTS idx_appointment_billing_contexts_tiss_authorization ON public.appointment_billing_contexts USING btree (organization_id, patient_id, COALESCE((metadata ->> 'patient_tiss_authorization_id'::text), (metadata ->> 'patientTissAuthorizationId'::text), (metadata #>> '{tiss_authorization,authorizationId}'::text[]), (metadata #>> '{tissAuthorization,authorizationId}'::text[])));
CREATE UNIQUE INDEX IF NOT EXISTS appointment_private_financial_organization_id_appointment_i_key ON public.appointment_private_financial_snapshots USING btree (organization_id, appointment_id, snapshot_version);
CREATE INDEX IF NOT EXISTS idx_private_financial_snapshots_appointment ON public.appointment_private_financial_snapshots USING btree (organization_id, appointment_id, snapshot_version DESC);
CREATE INDEX IF NOT EXISTS idx_private_financial_snapshots_payment ON public.appointment_private_financial_snapshots USING btree (organization_id, payment_id) WHERE (payment_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_payment_items_charge ON public.payment_appointment_items USING btree (organization_id, payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_items_one_active_charge_per_appointment ON public.payment_appointment_items USING btree (organization_id, appointment_id) WHERE ((appointment_id IS NOT NULL) AND (active = true));
CREATE INDEX IF NOT EXISTS payment_appointment_items_ledger_read_idx ON public.payment_appointment_items USING btree (organization_id, appointment_scheduled_at DESC NULLS LAST, created_at DESC, id DESC, payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_items_monthly_session_key ON public.payment_appointment_items USING btree (organization_id, billing_item_key) WHERE ((billing_item_type = 'MONTHLY_SESSION'::text) AND (billing_item_key IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_payment_items_monthly_session_payment ON public.payment_appointment_items USING btree (organization_id, payment_id, active, competence_month) WHERE (billing_item_type = 'MONTHLY_SESSION'::text);
CREATE INDEX IF NOT EXISTS idx_payment_items_monthly_session_plan_history ON public.payment_appointment_items USING btree (organization_id, patient_financial_plan_id) WHERE ((billing_item_type = 'MONTHLY_SESSION'::text) AND (patient_financial_plan_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_audit_idempotency ON public.payment_audit_events USING btree (organization_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_payment_audit_charge ON public.payment_audit_events USING btree (organization_id, payment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_audit_events_ledger_read_idx ON public.payment_audit_events USING btree (organization_id, created_at DESC, id DESC, payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_idempotency ON public.payment_transactions USING btree (organization_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_charge ON public.payment_transactions USING btree (organization_id, payment_id, transaction_at DESC);
CREATE INDEX IF NOT EXISTS payment_transactions_ledger_read_idx ON public.payment_transactions USING btree (organization_id, transaction_at DESC, created_at DESC, id DESC, payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON public.payments USING btree (payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_payments_clinic_month ON public.payments USING btree (clinic_id, payment_date, due_date, status);
CREATE INDEX IF NOT EXISTS idx_payments_patient ON public.payments USING btree (patient_id, clinic_id);
CREATE INDEX IF NOT EXISTS idx_payments_recurrence_group ON public.payments USING btree (recurrence_group_id, due_date) WHERE (recurrence_group_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_payments_due_status ON public.payments USING btree (status, due_date) WHERE (due_date IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_finance_idempotency ON public.payments USING btree (organization_id, idempotency_key) WHERE ((organization_id IS NOT NULL) AND (idempotency_key IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_payments_private_receivables_filters ON public.payments USING btree (organization_id, private_financial_classification, financial_status, due_date, service_catalog_id) WHERE (private_price_source IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_monthly_session_group ON public.payments USING btree (organization_id, monthly_billing_group_key) WHERE ((source = 'MONTHLY_SESSION_AGGREGATE'::text) AND (monthly_billing_group_key IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_payments_finance_patient_status ON public.payments USING btree (organization_id, patient_id, financial_status, due_date);
CREATE OR REPLACE FUNCTION public.patient_financial_charge_payload(p_payment_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'charge', to_jsonb(payment),
    'items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.appointment_scheduled_at nulls last, item.created_at)
      from public.payment_appointment_items item
      where item.payment_id::text = payment.id::text
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(to_jsonb(transaction_row) order by transaction_row.transaction_at desc, transaction_row.created_at desc)
      from public.payment_transactions transaction_row
      where transaction_row.payment_id::text = payment.id::text
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(to_jsonb(event_row) order by event_row.created_at desc)
      from (
        select audit_event.*
        from public.payment_audit_events audit_event
        where audit_event.payment_id::text = payment.id::text
        order by audit_event.created_at desc
        limit 100
      ) event_row
    ), '[]'::jsonb),
    'privateSnapshots', coalesce((
      select jsonb_agg(to_jsonb(snapshot) order by snapshot.snapshot_version desc)
      from public.appointment_private_financial_snapshots snapshot
      where snapshot.payment_id::text = payment.id::text
    ), '[]'::jsonb)
  )
  from public.payments payment
  where payment.id::text = p_payment_id;
$function$;
CREATE OR REPLACE FUNCTION public.create_patient_financial_charge(p_organization_id uuid, p_patient_id uuid, p_items jsonb, p_original_amount numeric, p_additional_amount numeric, p_discount_amount numeric, p_due_date date, p_method text, p_source text, p_competence_month date, p_notes text, p_idempotency_key text, p_actor_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing_id text;
  v_payment_id text;
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

  select id::text into v_existing_id
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
  ) returning id::text into v_payment_id;

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
      where payment_id::text = v_payment_id
      order by appointment_scheduled_at nulls last, created_at
      limit 1
    ) first_item
    where p.id::text = v_payment_id;
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
    (select appointment_id from public.payment_appointment_items where payment_id::text = v_payment_id order by created_at limit 1),
    'CHARGE_CREATED', '{}'::jsonb,
    (select to_jsonb(p) from public.payments p where p.id::text = v_payment_id),
    p_notes, p_idempotency_key || ':created', p_actor_id
  );

  return public.patient_financial_charge_payload(v_payment_id);
end;
$function$;
CREATE OR REPLACE FUNCTION public.mark_monthly_session_adjustment_required_v1(p_payment_id text, p_appointment_id uuid, p_reason text, p_idempotency_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_payment public.payments%rowtype;
begin
  select * into v_payment from public.payments where id::text=p_payment_id for update;
  if not found then return; end if;
  update public.payments
  set monthly_adjustment_required=true,
      adjustment_reason=left(coalesce(nullif(trim(p_reason),''),'MONTHLY_SESSION_ADJUSTMENT_REQUIRED'),1000),
      updated_at=now()
  where id::text=p_payment_id;

  insert into public.payment_audit_events (
    organization_id, clinic_id, payment_id, appointment_id, event_type,
    before_state, after_state, notes, idempotency_key, created_by
  ) values (
    v_payment.organization_id, v_payment.clinic_id, v_payment.id::text, p_appointment_id,
    'MONTHLY_SESSION_ADJUSTMENT_REQUIRED', to_jsonb(v_payment),
    (select to_jsonb(p) from public.payments p where p.id::text=v_payment.id::text),
    left(coalesce(p_reason,'Ajuste manual necessário.'),1000),
    left(coalesce(p_idempotency_key,'monthly-session-adjustment:'||coalesce(p_appointment_id::text,'none')),240),
    null
  ) on conflict (organization_id,idempotency_key) where idempotency_key is not null do nothing;
end;
$function$;
CREATE OR REPLACE FUNCTION public.monthly_session_due_date_v1(p_competence_month date, p_due_day integer)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with next_month as (
    select (date_trunc('month', p_competence_month)::date + interval '1 month')::date as first_day
  )
  select case
    when p_competence_month is null or p_due_day is null then null
    else make_date(
      extract(year from first_day)::integer,
      extract(month from first_day)::integer,
      least(
        greatest(p_due_day, 1),
        extract(day from ((first_day + interval '1 month') - interval '1 day'))::integer
      )
    )
  end
  from next_month;
$function$;
CREATE OR REPLACE FUNCTION public.monthly_session_payment_locked_v1(p_payment_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce((
    select
      lower(coalesce(p.financial_status, p.status, 'pending')) in ('paid','partial','refunded','courtesy')
      or greatest(coalesce(p.paid_amount,0)-coalesce(p.refunded_amount,0),0) > 0
      or exists (
        select 1 from public.payment_transactions tx
        where tx.payment_id::text=p.id::text and tx.status='POSTED'
      )
    from public.payments p
    where p.id::text=p_payment_id
  ), false);
$function$;
CREATE OR REPLACE FUNCTION public.private_session_policy_amount_v1(p_rule jsonb, p_session_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v_type text := upper(coalesce(nullif(trim(p_rule->>'type'), ''), 'NO_CHARGE'));
  v_value numeric := greatest(coalesce(nullif(p_rule->>'value', '')::numeric, 0), 0);
  v_amount numeric := greatest(coalesce(p_session_amount, 0), 0);
begin
  if v_type = 'FULL' then
    return round(v_amount, 2);
  elsif v_type = 'PERCENTAGE' then
    return round(v_amount * least(v_value, 100) / 100, 2);
  elsif v_type = 'FIXED' then
    return round(least(v_amount, v_value), 2);
  elsif v_type = 'MANUAL' then
    raise exception 'PRIVATE_SESSION_MANUAL_POLICY_DECISION_REQUIRED';
  end if;
  return 0;
end;
$function$;
CREATE OR REPLACE FUNCTION public.refresh_monthly_session_payment_v1(p_payment_id text)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_payment public.payments%rowtype;
  v_total numeric(14,2) := 0;
  v_count integer := 0;
  v_first_appointment uuid;
begin
  select * into v_payment from public.payments where id::text=p_payment_id for update;
  if not found then raise exception 'MONTHLY_SESSION_PAYMENT_NOT_FOUND'; end if;
  if coalesce(v_payment.source,'') <> 'MONTHLY_SESSION_AGGREGATE' then
    raise exception 'MONTHLY_SESSION_PAYMENT_SOURCE_INVALID';
  end if;
  if public.monthly_session_payment_locked_v1(p_payment_id) then
    return v_payment;
  end if;

  select coalesce(sum(item.subtotal),0), count(*)::integer
  into v_total, v_count
  from public.payment_appointment_items item
  where item.organization_id=v_payment.organization_id
    and item.payment_id::text=v_payment.id::text
    and item.billing_item_type='MONTHLY_SESSION'
    and item.active=true;

  -- payments.appointment_id is a compatibility/reference field for an aggregate
  -- that can contain multiple appointments. Choose the first active clinical
  -- session chronologically; UUID lexical order is only a stable final tie-breaker.
  select item.appointment_id
  into v_first_appointment
  from public.payment_appointment_items item
  where item.organization_id=v_payment.organization_id
    and item.payment_id::text=v_payment.id::text
    and item.billing_item_type='MONTHLY_SESSION'
    and item.active=true
  order by item.appointment_scheduled_at asc nulls last,
           item.created_at asc nulls last,
           item.appointment_id::text asc
  limit 1;

  update public.payments
  set original_amount=v_total,
      base_amount=v_total,
      amount=v_total,
      monthly_session_count=v_count,
      appointment_id=v_first_appointment,
      canceled_at=case when v_count=0 then coalesce(canceled_at,now()) else null end,
      canceled_by=case when v_count=0 then canceled_by else null end,
      status=case when v_count=0 then 'canceled' when due_date<current_date then 'overdue' else 'pending' end,
      financial_status=case when v_count=0 then 'canceled' when due_date<current_date then 'overdue' else 'pending' end,
      updated_at=now()
  where id::text=p_payment_id
  returning * into v_payment;

  perform public.refresh_patient_financial_charge(p_payment_id);
  select * into v_payment from public.payments where id::text=p_payment_id;
  return v_payment;
end;
$function$;
CREATE OR REPLACE FUNCTION public.refresh_patient_financial_charge(p_payment_id text)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  where id::text = p_payment_id
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
  where payment_id::text = p_payment_id;

  if not exists (
    select 1 from public.payment_transactions
    where payment_id::text = p_payment_id and transaction_type = 'PAYMENT' and status = 'POSTED'
  ) then
    v_paid := coalesce(v_charge.paid_amount, case when lower(coalesce(v_charge.status, '')) in ('paid', 'refunded') then v_charge.amount else 0 end, 0);
  end if;
  if not exists (
    select 1 from public.payment_transactions
    where payment_id::text = p_payment_id and transaction_type in ('DISCOUNT', 'COURTESY') and status = 'POSTED'
  ) then
    v_discount := coalesce(v_charge.discount_amount, 0);
  end if;
  if not exists (
    select 1 from public.payment_transactions
    where payment_id::text = p_payment_id and transaction_type = 'REFUND' and status = 'POSTED'
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
        where t.payment_id::text = p_payment_id and t.status = 'POSTED'
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
      where payment_id::text = p_payment_id and transaction_type = 'PAYMENT' and status = 'POSTED'
      order by transaction_at desc, created_at desc
      limit 1
    ), v_charge.payment_date),
    method = coalesce((
      select nullif(trim(method), '')
      from public.payment_transactions
      where payment_id::text = p_payment_id and transaction_type = 'PAYMENT' and status = 'POSTED'
      order by transaction_at desc, created_at desc
      limit 1
    ), method),
    last_payment_at = coalesce((
      select max(transaction_at)
      from public.payment_transactions
      where payment_id::text = p_payment_id and transaction_type = 'PAYMENT' and status = 'POSTED'
    ), v_charge.last_payment_at),
    updated_at = now()
  where id::text = p_payment_id
  returning * into v_charge;

  return v_charge;
end;
$function$;