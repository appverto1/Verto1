-- P0 post-smoke: PostgreSQL does not implement min(uuid).
-- Preserve the monthly aggregate semantics while choosing a representative
-- appointment deterministically by the clinical session timestamp.
begin;

do $$
begin
  if to_regprocedure('public.refresh_monthly_session_payment_v1(text)') is null then
    raise exception 'MONTHLY_SESSION_UUID_FIX_PREFLIGHT_FUNCTION_MISSING';
  end if;
  if to_regclass('public.payment_appointment_items') is null
     or to_regclass('public.payments') is null then
    raise exception 'MONTHLY_SESSION_UUID_FIX_PREFLIGHT_RELATION_MISSING';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='payment_appointment_items'
      and column_name='appointment_id' and udt_name='uuid'
  ) then
    raise exception 'MONTHLY_SESSION_UUID_FIX_PREFLIGHT_APPOINTMENT_ID_DRIFT';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='payment_appointment_items'
      and column_name='appointment_scheduled_at' and udt_name='timestamptz'
  ) then
    raise exception 'MONTHLY_SESSION_UUID_FIX_PREFLIGHT_SCHEDULED_AT_DRIFT';
  end if;
end $$;

create or replace function public.refresh_monthly_session_payment_v1(p_payment_id text)
returns public.payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

revoke all on function public.refresh_monthly_session_payment_v1(text) from public, anon, authenticated;
grant execute on function public.refresh_monthly_session_payment_v1(text) to service_role;

commit;
