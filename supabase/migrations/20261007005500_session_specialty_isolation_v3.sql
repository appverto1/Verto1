-- Session specialty isolation v3
-- Appointment-linked specialty is authoritative, but the database never
-- invents a clinical-plan binding on behalf of the actor. The caller must send
-- the explicit plan selected within its authorized scope.

create or replace function public.guard_aba_session_specialty_isolation_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_appointment_service text;
  v_appointment_approach text;
  v_appointment_source jsonb;
  v_appointment_key text;
  v_plan_specialty text;
  v_plan_key text;
  v_organization_id text;
begin
  v_organization_id := coalesce(nullif(btrim(new.organization_id), ''), nullif(btrim(new.clinic_id), ''));

  if new.appointment_id is not null then
    select appointment.service_type, appointment.approach, appointment.source_payload
      into v_appointment_service, v_appointment_approach, v_appointment_source
    from public.appointments appointment
    where appointment.id = new.appointment_id
      and appointment.patient_id = new.patient_id
      and coalesce(appointment.organization_id::text, appointment.clinic_id::text) = v_organization_id
    limit 1;

    v_appointment_key := coalesce(
      public.clinical_specialty_scope_key_v1(v_appointment_source->>'specialty'),
      public.clinical_specialty_scope_key_v1(v_appointment_source->>'specialty_name'),
      public.clinical_specialty_scope_key_v1(v_appointment_source->>'specialtyName'),
      public.clinical_specialty_scope_key_v1(v_appointment_service),
      public.clinical_specialty_scope_key_v1(v_appointment_approach)
    );
  else
    v_appointment_key := null;
  end if;

  if tg_op = 'INSERT'
     and v_appointment_key is not null
     and new.therapeutic_plan_id is null then
    raise exception 'ABA_SESSION_SPECIALTY_PLAN_REQUIRED';
  end if;

  if new.therapeutic_plan_id is not null and v_appointment_key is not null then
    select plan.specialty into v_plan_specialty
    from public.patient_therapeutic_plans plan
    where plan.id = new.therapeutic_plan_id
      and plan.patient_id = new.patient_id
      and plan.organization_id = v_organization_id
      and plan.clinic_id = new.clinic_id
      and plan.mode = 'specialty'
      and plan.status = 'active'
    limit 1;

    v_plan_key := public.clinical_specialty_scope_key_v1(v_plan_specialty);
    if v_plan_key is null or v_plan_key <> v_appointment_key then
      raise exception 'ABA_SESSION_SPECIALTY_PLAN_MISMATCH';
    end if;
  end if;

  return new;
end;
$function$;
