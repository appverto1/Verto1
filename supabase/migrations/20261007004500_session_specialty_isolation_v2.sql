-- Session specialty isolation v2
-- Do not infer a new specialty-plan binding during UPDATE. Session clinical
-- context is immutable after creation; auto-resolution is insert-only.

create or replace function public.guard_aba_session_specialty_isolation_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_appointment_service text;
  v_appointment_key text;
  v_plan_specialty text;
  v_plan_key text;
  v_candidate_plan_id uuid;
  v_candidate_count integer := 0;
  v_organization_id text;
begin
  v_organization_id := coalesce(nullif(btrim(new.organization_id), ''), nullif(btrim(new.clinic_id), ''));

  if nullif(btrim(coalesce(new.appointment_id::text, '')), '') is not null then
    select coalesce(nullif(btrim(appointment.service_type), ''), nullif(btrim(appointment.approach), ''))
      into v_appointment_service
    from public.appointments appointment
    where appointment.id::text = new.appointment_id::text
      and appointment.patient_id = new.patient_id
      and coalesce(appointment.organization_id::text, appointment.clinic_id::text) = v_organization_id
    limit 1;

    v_appointment_key := public.clinical_specialty_scope_key_v1(v_appointment_service);
  else
    v_appointment_key := null;
  end if;

  if tg_op = 'INSERT'
     and v_appointment_key is not null
     and new.therapeutic_plan_id is null then
    select min(plan.id), count(*)::integer
      into v_candidate_plan_id, v_candidate_count
    from public.patient_therapeutic_plans plan
    where plan.patient_id = new.patient_id
      and plan.organization_id = v_organization_id
      and plan.clinic_id = new.clinic_id
      and plan.mode = 'specialty'
      and plan.status = 'active'
      and public.clinical_specialty_scope_key_v1(plan.specialty) = v_appointment_key;

    if v_candidate_count = 1 then
      new.therapeutic_plan_id := v_candidate_plan_id;
    elsif v_candidate_count = 0 then
      raise exception 'ABA_SESSION_SPECIALTY_PLAN_NOT_FOUND';
    else
      raise exception 'ABA_SESSION_SPECIALTY_PLAN_AMBIGUOUS';
    end if;
  end if;

  if new.therapeutic_plan_id is not null and v_appointment_key is not null then
    select plan.specialty into v_plan_specialty
    from public.patient_therapeutic_plans plan
    where plan.id = new.therapeutic_plan_id
      and plan.patient_id = new.patient_id
      and plan.organization_id = v_organization_id
      and plan.clinic_id = new.clinic_id
    limit 1;

    v_plan_key := public.clinical_specialty_scope_key_v1(v_plan_specialty);
    if v_plan_key is null or v_plan_key <> v_appointment_key then
      raise exception 'ABA_SESSION_SPECIALTY_PLAN_MISMATCH';
    end if;
  end if;

  return new;
end;
$function$;
