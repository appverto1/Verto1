-- Session specialty isolation v1
-- A persisted ABA session may operate only on the specialty plan frozen into it.
-- Appointment-linked sessions must use the specialty represented by the canonical
-- appointment. Legacy trials are rejected if their target/program crosses plans.

create or replace function public.clinical_specialty_scope_key_v1(p_value text)
returns text
language sql
immutable
as $function$
  select case
    when v in ('fono', 'fonoaudiologia', 'fonoaudiologo', 'fonoaudiologa', 'speech therapy', 'speech_therapy') then 'speech_therapy'
    when v in ('to', 'terapia ocupacional', 'terapeuta ocupacional', 'occupational therapy', 'occupational_therapy') then 'occupational_therapy'
    when v in ('psicologia', 'psicoterapia', 'psicoterapeuta', 'psicologo', 'psicologa', 'psychology', 'psychotherapy') then 'psychotherapy'
    when v in ('nutricao', 'nutricionista', 'nutrition') then 'nutrition'
    when v in ('psicomotricidade', 'psicomotricista', 'psychomotricity') then 'psychomotricity'
    when v in ('psicopedagogia', 'psicopedagogo', 'psicopedagoga', 'psychopedagogy') then 'psychopedagogy'
    when v in ('arteterapia', 'arteterapeuta', 'art therapy', 'art_therapy') then 'art_therapy'
    when v in ('musicoterapia', 'musicoterapeuta', 'music therapy', 'music_therapy') then 'music_therapy'
    when v in ('fisioterapia', 'fisioterapeuta', 'physiotherapy') then 'physiotherapy'
    else null
  end
  from (
    select btrim(regexp_replace(
      translate(lower(coalesce(p_value, '')),
        'áàâãäéèêëíìîïóòôõöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc'),
      '[^a-z0-9_]+', ' ', 'g'
    )) as v
  ) normalized;
$function$;

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

  if v_appointment_key is not null and new.therapeutic_plan_id is null then
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

drop trigger if exists trg_00_aba_session_specialty_isolation_v1 on public.aba_sessions;
create trigger trg_00_aba_session_specialty_isolation_v1
before insert or update of appointment_id, therapeutic_plan_id, organization_id, clinic_id, patient_id
on public.aba_sessions
for each row execute function public.guard_aba_session_specialty_isolation_v1();

create or replace function public.guard_aba_trial_specialty_isolation_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_session_plan_id uuid;
  v_session_patient_id uuid;
  v_session_clinic_id text;
  v_target_program_id text;
  v_effective_program_id text;
  v_program_plan_id uuid;
begin
  if nullif(btrim(coalesce(new.session_id, '')), '') is null then
    return new;
  end if;

  select session_row.therapeutic_plan_id, session_row.patient_id, session_row.clinic_id
    into v_session_plan_id, v_session_patient_id, v_session_clinic_id
  from public.aba_sessions session_row
  where session_row.id = new.session_id
  limit 1;

  if not found or v_session_plan_id is null then
    return new;
  end if;

  if v_session_patient_id <> new.patient_id
     or nullif(btrim(coalesce(v_session_clinic_id, '')), '') <> nullif(btrim(coalesce(new.clinic_id, '')), '') then
    raise exception 'ABA_TRIAL_SESSION_CLINICAL_SCOPE_MISMATCH';
  end if;

  if nullif(btrim(coalesce(new.target_id, '')), '') is not null then
    select target.program_id into v_target_program_id
    from public.aba_targets target
    where target.id = new.target_id
      and target.patient_id = new.patient_id
      and target.clinic_id = new.clinic_id
    limit 1;

    if not found or nullif(btrim(coalesce(v_target_program_id, '')), '') is null then
      raise exception 'ABA_TRIAL_SPECIALTY_TARGET_NOT_FOUND';
    end if;
  end if;

  if nullif(btrim(coalesce(new.program_id, '')), '') is not null
     and v_target_program_id is not null
     and new.program_id <> v_target_program_id then
    raise exception 'ABA_TRIAL_TARGET_PROGRAM_MISMATCH';
  end if;

  v_effective_program_id := coalesce(nullif(btrim(coalesce(v_target_program_id, '')), ''), nullif(btrim(coalesce(new.program_id, '')), ''));
  if v_effective_program_id is null then
    raise exception 'ABA_TRIAL_SPECIALTY_PROGRAM_REQUIRED';
  end if;

  select program.therapeutic_plan_id into v_program_plan_id
  from public.aba_programs program
  where program.id = v_effective_program_id
    and program.patient_id = new.patient_id
    and program.clinic_id = new.clinic_id
  limit 1;

  if not found or v_program_plan_id is null or v_program_plan_id <> v_session_plan_id then
    raise exception 'ABA_TRIAL_SPECIALTY_PLAN_MISMATCH';
  end if;

  new.program_id := v_effective_program_id;
  return new;
end;
$function$;

drop trigger if exists trg_guard_aba_trial_specialty_isolation_v1 on public.aba_trials;
create trigger trg_guard_aba_trial_specialty_isolation_v1
before insert or update of session_id, patient_id, clinic_id, target_id, program_id
on public.aba_trials
for each row execute function public.guard_aba_trial_specialty_isolation_v1();

comment on function public.guard_aba_trial_specialty_isolation_v1()
is 'Fail-closed plan isolation for Legacy ABA writes: a plan-bound session may only persist targets/programs from its frozen specialty plan.';
