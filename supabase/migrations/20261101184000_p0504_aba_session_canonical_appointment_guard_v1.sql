-- P0-504: canonical appointment scope for new ABA sessions.
-- Security invariant: an authenticated UI request may not replace server-owned
-- patient, clinic, professional, specialty, room or appointment schedule.
-- Legacy sessions without an appointment remain on their existing recovery path.
-- No financial/attendance writes, no patient data migrations.
begin;

create or replace function public.guard_p0504_aba_session_appointment_scope_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_appointment public.appointments%rowtype;
  v_appointment_specialty text;
  v_session_specialty text;
  v_appt_start timestamptz;
  v_appt_end timestamptz;
  v_duration integer;
begin
  if new.appointment_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and (
    old.appointment_id is distinct from new.appointment_id
    or old.patient_id is distinct from new.patient_id
    or old.clinic_id is distinct from new.clinic_id
    or old.organization_id is distinct from new.organization_id
  ) then
    raise exception 'P0504_SESSION_SCOPE_IMMUTABLE';
  end if;

  select appointment.* into v_appointment
  from public.appointments appointment
  where appointment.id = new.appointment_id
    and appointment.patient_id = new.patient_id
    and appointment.clinic_id::text = new.clinic_id
    and coalesce(appointment.organization_id, appointment.clinic_id)::text
        = coalesce(nullif(btrim(new.organization_id), ''), nullif(btrim(new.clinic_id), ''))
    and appointment.deleted_at is null
    and coalesce(appointment.is_active, true)
  limit 1;

  if not found then
    raise exception 'P0504_SESSION_APPOINTMENT_SCOPE_INVALID';
  end if;

  if lower(coalesce(v_appointment.status, '')) in
    ('cancelled', 'canceled', 'deleted', 'completed', 'no_show', 'missed') then
    if tg_op = 'INSERT' then
      raise exception 'P0504_SESSION_APPOINTMENT_NOT_STARTABLE';
    end if;
  end if;

  -- Existing historical session references must not be reinterpreted on
  -- subsequent updates. Canonical data is frozen at session creation.
  if tg_op = 'UPDATE' then
    if old.scheduled_start_at is distinct from new.scheduled_start_at
      or old.scheduled_end_at is distinct from new.scheduled_end_at
      or old.scheduled_duration_minutes is distinct from new.scheduled_duration_minutes
      or old.room_id is distinct from new.room_id
      or old.therapist_id is distinct from new.therapist_id
      or old.service_type is distinct from new.service_type
    then
      raise exception 'P0504_SESSION_CANONICAL_SNAPSHOT_IMMUTABLE';
    end if;
    return new;
  end if;

  if v_appointment.therapist_id is null then
    raise exception 'P0504_SESSION_PROFESSIONAL_UNVERIFIED';
  end if;
  if nullif(btrim(coalesce(new.therapist_id, '')), '') is not null
    and new.therapist_id <> v_appointment.therapist_id::text then
    raise exception 'P0504_SESSION_PROFESSIONAL_MISMATCH';
  end if;

  v_appointment_specialty := coalesce(
    public.clinical_specialty_scope_key_v1(v_appointment.source_payload->>'specialty'),
    public.clinical_specialty_scope_key_v1(v_appointment.source_payload->>'specialty_name'),
    public.clinical_specialty_scope_key_v1(v_appointment.service_type),
    public.clinical_specialty_scope_key_v1(v_appointment.approach)
  );
  v_session_specialty := public.clinical_specialty_scope_key_v1(new.service_type);
  if v_appointment_specialty is not null and v_session_specialty is not null
    and v_appointment_specialty <> v_session_specialty then
    raise exception 'P0504_SESSION_SPECIALTY_MISMATCH';
  end if;

  v_appt_start := coalesce(v_appointment.scheduled_start_at, v_appointment.scheduled_at);
  -- Existing legacy appointments may not have a stored duration. Derive the
  -- same clinic-supported default on the server, never from request JSON.
  -- An explicit professional schedule duration wins over the clinic default.
  select coalesce(
    nullif(v_appointment.scheduled_duration_minutes,0),
    nullif(v_appointment.duration_minutes,0),
    (
      select case
        when coalesce(m.work_schedule->>'sessionDurationMinutes',
                      m.work_schedule->>'session_duration_minutes','')
             ~ '^[0-9]{1,3}
  if v_appt_start is null or v_duration is null or v_duration < 5 or v_duration > 240 then
    raise exception 'P0504_SESSION_APPOINTMENT_SCHEDULE_UNVERIFIED';
  end if;
  v_appt_end := coalesce(v_appointment.scheduled_end_at, v_appt_start + make_interval(mins => v_duration));
  if v_appt_end <= v_appt_start then
    raise exception 'P0504_SESSION_APPOINTMENT_INTERVAL_INVALID';
  end if;

  -- The authoritative snapshot is supplied by the persisted appointment,
  -- never by request JSON, device localStorage or clock skew.
  new.therapist_id := v_appointment.therapist_id::text;
  new.scheduled_start_at := v_appt_start;
  new.scheduled_end_at := v_appt_end;
  new.scheduled_duration_minutes := v_duration;
  new.room_id := v_appointment.room_id;
  new.service_type := coalesce(nullif(v_appointment.service_type, ''),
                                nullif(v_appointment.approach, ''));
  return new;
end;
$function$;

revoke all on function public.guard_p0504_aba_session_appointment_scope_v1()
  from public, anon, authenticated;
grant execute on function public.guard_p0504_aba_session_appointment_scope_v1()
  to service_role;

drop trigger if exists a_p0504_aba_session_appointment_scope on public.aba_sessions;
create trigger a_p0504_aba_session_appointment_scope
before insert or update of appointment_id, patient_id, clinic_id,
  organization_id, therapist_id, service_type, scheduled_start_at,
  scheduled_end_at, scheduled_duration_minutes, room_id
on public.aba_sessions
for each row execute function public.guard_p0504_aba_session_appointment_scope_v1();

comment on function public.guard_p0504_aba_session_appointment_scope_v1() is
  'P0-504: fail-closed canonical appointment linkage for ABA sessions; prohibits client-supplied schedule/professional/clinic/specialty overrides.';

commit;

        then nullif(coalesce(m.work_schedule->>'sessionDurationMinutes',
                           m.work_schedule->>'session_duration_minutes')::integer,0)
      end
      from public.clinic_memberships m
      where m.clinic_id=v_appointment.clinic_id
        and m.user_id=v_appointment.therapist_id
        and m.status='active'
      order by m.updated_at desc
      limit 1
    ),
    (select nullif(c.session_duration_minutes,0) from public.clinics c
      where c.id=v_appointment.clinic_id)
  ) into v_duration;
  if v_appt_start is null or v_duration is null or v_duration < 5 or v_duration > 240 then
    raise exception 'P0504_SESSION_APPOINTMENT_SCHEDULE_UNVERIFIED';
  end if;
  v_appt_end := coalesce(v_appointment.scheduled_end_at, v_appt_start + make_interval(mins => v_duration));
  if v_appt_end <= v_appt_start then
    raise exception 'P0504_SESSION_APPOINTMENT_INTERVAL_INVALID';
  end if;

  -- The authoritative snapshot is supplied by the persisted appointment,
  -- never by request JSON, device localStorage or clock skew.
  new.therapist_id := v_appointment.therapist_id::text;
  new.scheduled_start_at := v_appt_start;
  new.scheduled_end_at := v_appt_end;
  new.scheduled_duration_minutes := v_duration;
  new.room_id := v_appointment.room_id;
  new.service_type := coalesce(nullif(v_appointment.service_type, ''),
                                nullif(v_appointment.approach, ''));
  return new;
end;
$function$;

revoke all on function public.guard_p0504_aba_session_appointment_scope_v1()
  from public, anon, authenticated;
grant execute on function public.guard_p0504_aba_session_appointment_scope_v1()
  to service_role;

drop trigger if exists a_p0504_aba_session_appointment_scope on public.aba_sessions;
create trigger a_p0504_aba_session_appointment_scope
before insert or update of appointment_id, patient_id, clinic_id,
  organization_id, therapist_id, service_type, scheduled_start_at,
  scheduled_end_at, scheduled_duration_minutes, room_id
on public.aba_sessions
for each row execute function public.guard_p0504_aba_session_appointment_scope_v1();

comment on function public.guard_p0504_aba_session_appointment_scope_v1() is
  'P0-504: fail-closed canonical appointment linkage for ABA sessions; prohibits client-supplied schedule/professional/clinic/specialty overrides.';

commit;
