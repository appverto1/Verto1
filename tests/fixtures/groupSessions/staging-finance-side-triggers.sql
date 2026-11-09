CREATE OR REPLACE FUNCTION public.assert_private_snapshot_payment_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.payment_id is not null and not exists (
    select 1
    from public.payments payment
    where payment.id::text = new.payment_id
      and payment.organization_id = new.organization_id
      and payment.patient_id::text = new.patient_id::text
  ) then
    raise exception 'PRIVATE_FINANCIAL_SNAPSHOT_PAYMENT_SCOPE_INVALID';
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.prevent_private_financial_snapshot_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  raise exception using
    errcode = '55000',
    message = 'PRIVATE_FINANCIAL_SNAPSHOT_IMMUTABLE';
end;
$function$;
CREATE OR REPLACE FUNCTION public.assert_patient_finance_payment_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1
    from public.payments p
    where p.id::text = new.payment_id::text
      and p.organization_id = new.organization_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'PATIENT_FINANCE_PAYMENT_REFERENCE_INVALID';
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.prevent_manual_charge_for_monthly_session_appointment_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_appointment public.appointments%rowtype;
  v_engine text;
begin
  if new.appointment_id is null
     or coalesce(new.active,true)=false
     or coalesce(new.billing_item_type,'')='MONTHLY_SESSION' then
    return new;
  end if;

  select * into v_appointment
  from public.appointments a
  where a.id=new.appointment_id
    and coalesce(a.organization_id,a.clinic_id)=new.organization_id;
  if not found then return new; end if;

  v_engine:=public.resolve_appointment_financial_engine_v1(
    new.organization_id,
    v_appointment.id,
    v_appointment.patient_id,
    coalesce(v_appointment.service_type,v_appointment.approach),
    coalesce(to_jsonb(v_appointment)->'source_payload','{}'::jsonb)
  );
  if v_engine='MONTHLY_SESSION' then
    raise exception 'MONTHLY_SESSION_MANUAL_APPOINTMENT_CHARGE_FORBIDDEN';
  end if;
  if v_engine='AMBIGUOUS' then
    raise exception 'MONTHLY_SESSION_FINANCIAL_ENGINE_AMBIGUOUS';
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.payment_transaction_refresh_charge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.refresh_patient_financial_charge(coalesce(new.payment_id, old.payment_id)::text);
  return coalesce(new, old);
end;
$function$;
CREATE OR REPLACE FUNCTION public.prevent_patient_finance_payment_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from public.payment_appointment_items where payment_id::text = old.id::text)
    or exists (select 1 from public.payment_transactions where payment_id::text = old.id::text)
    or exists (select 1 from public.payment_audit_events where payment_id::text = old.id::text) then
    raise exception using
      errcode = '23503',
      message = 'PATIENT_FINANCE_PAYMENT_HAS_DEPENDENCIES';
  end if;
  return old;
end;
$function$;
CREATE TRIGGER assert_private_snapshot_payment_reference BEFORE INSERT ON public.appointment_private_financial_snapshots FOR EACH ROW EXECUTE FUNCTION assert_private_snapshot_payment_reference();
CREATE TRIGGER prevent_private_financial_snapshot_update BEFORE DELETE OR UPDATE ON public.appointment_private_financial_snapshots FOR EACH ROW EXECUTE FUNCTION prevent_private_financial_snapshot_mutation();
CREATE TRIGGER assert_payment_reference BEFORE INSERT OR UPDATE OF payment_id, organization_id ON public.payment_appointment_items FOR EACH ROW EXECUTE FUNCTION assert_patient_finance_payment_reference();
CREATE TRIGGER payment_items_prevent_monthly_session_manual_charge BEFORE INSERT OR UPDATE OF appointment_id, active, billing_item_type ON public.payment_appointment_items FOR EACH ROW EXECUTE FUNCTION prevent_manual_charge_for_monthly_session_appointment_v1();
CREATE TRIGGER assert_payment_reference BEFORE INSERT OR UPDATE OF payment_id, organization_id ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION assert_patient_finance_payment_reference();
CREATE TRIGGER payment_transactions_refresh_charge AFTER INSERT OR DELETE OR UPDATE ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION payment_transaction_refresh_charge();
CREATE TRIGGER prevent_patient_finance_payment_delete BEFORE DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION prevent_patient_finance_payment_delete();