-- P0-504: server-authoritative, idempotent short continuity (5/10/15).
-- This does NOT reserve new calendar slots or cancel/bill any appointment.
-- FULL/dobradinha remains disabled until one atomic booking+finance RPC exists.
begin;

alter table public.aba_sessions
  add column if not exists effective_end_at timestamptz;

-- Existing ABA RLS permits general row UPDATE to authenticated users. The new
-- column must NOT inherit permission to change the server-authoritative end.
create or replace function public.guard_p0504_effective_end_server_only_v1()
returns trigger language plpgsql
set search_path to pg_catalog, public
as $guard$
begin
  if tg_op='INSERT' then
    if new.effective_end_at is not null then
      raise exception 'P0504_EFFECTIVE_END_BACKEND_ONLY';
    end if;
  elsif new.effective_end_at is distinct from old.effective_end_at then
    if current_user not in ('postgres','service_role','supabase_admin') then
      raise exception 'P0504_EFFECTIVE_END_BACKEND_ONLY';
    end if;
  end if;
  return new;
end;
$guard$;

revoke all on function public.guard_p0504_effective_end_server_only_v1()
  from public,anon,authenticated;
drop trigger if exists trg_p0504_effective_end_server_only on public.aba_sessions;
create trigger trg_p0504_effective_end_server_only
before insert or update of effective_end_at
on public.aba_sessions for each row
execute function public.guard_p0504_effective_end_server_only_v1();

-- A short extension must also be honored by future Agenda writes.
-- Existing free appointments are checked by the RPC; subsequent bookings
-- are serialized against the same global professional lock.
create index if not exists idx_p0504_active_aba_extension_professional
  on public.aba_sessions (therapist_id, effective_end_at)
  where effective_end_at is not null and status in ('active','in_progress');
create index if not exists idx_p0504_active_aba_extension_patient
  on public.aba_sessions (patient_id, effective_end_at)
  where effective_end_at is not null and status in ('active','in_progress');

create or replace function public.guard_p0504_appointment_against_short_extensions_v1()
returns trigger language plpgsql security definer
set search_path to pg_catalog, public
as $slot$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_conflict boolean;
begin
  if new.deleted_at is not null or not coalesce(new.is_active,true)
     or lower(coalesce(new.status,'')) in
       ('cancelled','canceled','cancelado','deleted','no_show','missed') then
    return new;
  end if;
  v_start := coalesce(new.scheduled_start_at,new.scheduled_at);
  v_end := coalesce(new.scheduled_end_at,
    v_start+make_interval(mins=>coalesce(
      nullif(new.scheduled_duration_minutes,0),nullif(new.duration_minutes,0),50)));
  if v_start is null or v_end is null or v_end<=v_start then
    -- Existing general scheduling validation is authoritative for invalid
    -- original inputs. This guard never treats an unknown end as a free slot.
    raise exception 'P0504_APPOINTMENT_INTERVAL_UNVERIFIED';
  end if;
  if new.therapist_id is null or new.patient_id is null then
    raise exception 'P0504_APPOINTMENT_SCOPE_UNVERIFIED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('p0504:professional:'||new.therapist_id::text,0)
  );

  select exists(
    select 1
    from public.aba_sessions s
    join public.appointments original
      on original.id=s.appointment_id
      and original.clinic_id::text=s.clinic_id
      and original.patient_id=s.patient_id
    where original.id<>new.id
      and s.effective_end_at is not null
      and s.status in ('active','in_progress')
      and (
        s.therapist_id=new.therapist_id::text
        or s.patient_id=new.patient_id
        or (
          original.clinic_id=new.clinic_id
          and nullif(original.room_id,'') is not null
          and original.room_id=new.room_id
        )
      )
      and s.effective_end_at>v_start
      and greatest(
        coalesce(original.scheduled_end_at,
          coalesce(original.scheduled_start_at,original.scheduled_at)
          +make_interval(mins=>coalesce(
            nullif(original.scheduled_duration_minutes,0),
            nullif(original.duration_minutes,0),50))),
        coalesce(s.actual_start_at,s.started_at)
          +make_interval(mins=>coalesce(
            nullif(original.scheduled_duration_minutes,0),
            nullif(original.duration_minutes,0),50))
      )<v_end
    limit 1
  ) into v_conflict;
  if v_conflict then
    raise exception 'P0504_APPOINTMENT_OVERLAPS_ACTIVE_EXTENSION';
  end if;
  return new;
end;
$slot$;

revoke all on function public.guard_p0504_appointment_against_short_extensions_v1()
  from public,anon,authenticated;
drop trigger if exists z_p0504_appointment_short_extension_guard on public.appointments;
create trigger z_p0504_appointment_short_extension_guard
before insert or update of
  patient_id,clinic_id,therapist_id,room_id,scheduled_at,scheduled_start_at,
  scheduled_end_at,scheduled_duration_minutes,duration_minutes,
  status,is_active,deleted_at
on public.appointments for each row
execute function public.guard_p0504_appointment_against_short_extensions_v1();

create table if not exists public.aba_session_continuation_operations_v1 (
  clinic_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  session_id text not null,
  appointment_id uuid not null,
  actor_id uuid not null,
  additional_minutes integer not null check (additional_minutes in (5, 10, 15)),
  effective_end_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (clinic_id, idempotency_key)
);

alter table public.aba_session_continuation_operations_v1 enable row level security;
revoke all on public.aba_session_continuation_operations_v1 from public, anon, authenticated;
grant select, insert on public.aba_session_continuation_operations_v1 to service_role;

create or replace function public.extend_aba_session_short_v1(
  p_clinic_id uuid,
  p_actor_id uuid,
  p_session_id text,
  p_additional_minutes integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql security definer
set search_path to pg_catalog, public
as $function$
declare
  v_role text;
  v_session public.aba_sessions%rowtype;
  v_appointment public.appointments%rowtype;
  v_existing public.aba_session_continuation_operations_v1%rowtype;
  v_scheduled_start timestamptz;
  v_scheduled_end timestamptz;
  v_started timestamptz;
  v_current_end timestamptz;
  v_new_end timestamptz;
  v_duration integer;
  v_other_start timestamptz;
  v_conflict boolean := false;
begin
  if p_clinic_id is null or p_actor_id is null
     or p_session_id is null or length(trim(p_session_id)) not between 1 and 180
     or p_additional_minutes is null or p_additional_minutes not in (5, 10, 15)
     or p_idempotency_key is null or length(trim(p_idempotency_key)) not between 8 and 128
  then
    raise exception 'P0504_SHORT_EXTENSION_INVALID_INPUT';
  end if;
  if auth.uid() is not null and auth.uid() is distinct from p_actor_id then
    raise exception 'P0504_SHORT_EXTENSION_ACTOR_MISMATCH';
  end if;

  v_role := public.verto_clinic_actor_role_v1(p_actor_id,p_clinic_id);
  if v_role is null or v_role not in ('owner','admin','director','coordinator','supervisor','therapist') then
    raise exception 'P0504_SHORT_EXTENSION_ACCESS_DENIED';
  end if;

  -- Two different request keys on the same session are serialized; one key
  -- replaying the original request does not add a second extension.
  perform pg_advisory_xact_lock(
    hashtextextended('p0504:short:' || p_clinic_id::text || ':' || p_session_id,0)
  );

  select * into v_existing
  from public.aba_session_continuation_operations_v1 op
  where op.clinic_id=p_clinic_id and op.idempotency_key=p_idempotency_key;
  if found then
    if v_existing.session_id<>p_session_id or
       v_existing.actor_id<>p_actor_id or
       v_existing.additional_minutes<>p_additional_minutes then
      raise exception 'P0504_SHORT_EXTENSION_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('success',true,'idempotentReplay',true,
      'sessionId',v_existing.session_id,
      'effectiveEndAt',v_existing.effective_end_at,
      'additionalMinutes',v_existing.additional_minutes,
      'calendarReservationConfirmed',false,'billableUnitsCreated',0);
  end if;

  -- Reuse the existing group-booking clinic scheduling lock before the
  -- professional lock and any potential appointment writes.
  perform pg_advisory_xact_lock(
    hashtextextended('group-booking-slot:'||p_clinic_id::text,0)
  );

  select * into v_session from public.aba_sessions s
  where s.id=p_session_id and s.clinic_id=p_clinic_id::text
    and s.organization_id=p_clinic_id::text
  for update;
  if not found or v_session.appointment_id is null
      or lower(coalesce(v_session.status,'')) not in ('active','in_progress') then
    raise exception 'P0504_SHORT_EXTENSION_SESSION_NOT_ACTIVE';
  end if;
  if v_role='therapist' and v_session.therapist_id is distinct from p_actor_id::text then
    raise exception 'P0504_SHORT_EXTENSION_ACCESS_DENIED';
  end if;

  select * into v_appointment from public.appointments a
  where a.id=v_session.appointment_id
    and a.clinic_id=p_clinic_id
    and coalesce(a.organization_id,a.clinic_id)=p_clinic_id
    and a.patient_id=v_session.patient_id
  for update;
  if not found or v_appointment.therapist_id is null
      or v_appointment.therapist_id::text is distinct from v_session.therapist_id
      or v_appointment.active_aba_session_id is distinct from v_session.id
      or v_appointment.deleted_at is not null or coalesce(v_appointment.is_active,true) is false
      or lower(coalesce(v_appointment.status,'')) not in
        ('scheduled','pending','pending_confirmation','confirmed',
         'rescheduled','in_progress','active','started') then
    raise exception 'P0504_SHORT_EXTENSION_APPOINTMENT_INVALID';
  end if;
  if upper(coalesce(v_appointment.source_payload->>'sessionModality',''))='GROUP'
    or v_appointment.source_payload ? 'sessionGroupId' then
    raise exception 'P0504_SHORT_EXTENSION_GROUP_NOT_SUPPORTED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('p0504:professional:' || v_appointment.therapist_id::text,0)
  );

  if public.clinical_specialty_scope_key_v1(v_appointment.service_type) is null
    or public.clinical_specialty_scope_key_v1(v_session.service_type) is distinct
       from public.clinical_specialty_scope_key_v1(v_appointment.service_type)
  then
    raise exception 'P0504_SHORT_EXTENSION_SPECIALTY_UNVERIFIED';
  end if;

  v_scheduled_start:=coalesce(v_appointment.scheduled_start_at,v_appointment.scheduled_at);
  v_duration:=coalesce(v_appointment.scheduled_duration_minutes,v_appointment.duration_minutes);
  v_started:=coalesce(v_session.actual_start_at,v_session.started_at,v_appointment.actual_start_at);
  if v_scheduled_start is null or v_duration is null or v_duration not between 5 and 240
    or v_started is null or v_started < v_scheduled_start - interval '12 hours'
    or v_started > now()+interval '5 minutes' then
    raise exception 'P0504_SHORT_EXTENSION_TIME_UNVERIFIED';
  end if;
  v_scheduled_end:=coalesce(v_appointment.scheduled_end_at,
    v_scheduled_start+make_interval(mins=>v_duration));
  if v_scheduled_end<=v_scheduled_start then
    raise exception 'P0504_SHORT_EXTENSION_INTERVAL_INVALID';
  end if;

  v_current_end:=greatest(v_scheduled_end,v_started+make_interval(mins=>v_duration),
    coalesce(v_session.effective_end_at,v_scheduled_end));
  v_new_end:=v_current_end+make_interval(mins=>p_additional_minutes);
  if v_new_end<=now() or v_new_end>v_scheduled_start+interval '12 hours' then
    raise exception 'P0504_SHORT_EXTENSION_WINDOW_INVALID';
  end if;

  -- All clinics for the SAME professional, same patient globally, and same
  -- physical room in the current clinic. Never cancel or mutate B.
  select exists(
    select 1
    from public.appointments b
    left join public.aba_sessions other
      on other.id=b.active_aba_session_id and other.appointment_id=b.id
    where b.id<>v_appointment.id
      and b.deleted_at is null and coalesce(b.is_active,true)
      and lower(coalesce(b.status,'scheduled')) not in
        ('cancelled','canceled','cancelado','deleted','no_show','missed')
      and (
        b.therapist_id=v_appointment.therapist_id
        or b.patient_id=v_appointment.patient_id
        or (b.clinic_id=p_clinic_id and v_appointment.room_id is not null
            and b.room_id=v_appointment.room_id)
      )
      and (
        b.scheduled_at between v_current_end-interval '24 hours' and v_new_end
        or b.scheduled_start_at between v_current_end-interval '24 hours' and v_new_end
      )
      and coalesce(b.scheduled_start_at,b.scheduled_at)<v_new_end
      and greatest(
        coalesce(b.scheduled_end_at,
          coalesce(b.scheduled_start_at,b.scheduled_at)
          +make_interval(mins=>coalesce(nullif(b.scheduled_duration_minutes,0),
                                          nullif(b.duration_minutes,0),1440))),
        coalesce(other.effective_end_at,'-infinity'::timestamptz)
      )>v_current_end
  ) into v_conflict;
  if v_conflict then
    raise exception 'P0504_SHORT_EXTENSION_CONFLICT_REQUIRES_REVIEW';
  end if;

  -- The scheduling system does not yet honor effective_end_at as an exclusive
  -- calendar reservation. Never represent this as a committed extra slot.
  update public.aba_sessions
  set effective_end_at=v_new_end,updated_at=now()
  where id=v_session.id
    and clinic_id=p_clinic_id::text and status=v_session.status;

  insert into public.aba_session_continuation_operations_v1(
    clinic_id,idempotency_key,session_id,appointment_id,actor_id,
    additional_minutes,effective_end_at
  ) values (
    p_clinic_id,p_idempotency_key,v_session.id,v_appointment.id,
    p_actor_id,p_additional_minutes,v_new_end
  );

  return jsonb_build_object('success',true,'idempotentReplay',false,
    'sessionId',v_session.id,'effectiveEndAt',v_new_end,
    'additionalMinutes',p_additional_minutes,
    'calendarReservationConfirmed',false,'billableUnitsCreated',0);
end;
$function$;

revoke all on function public.extend_aba_session_short_v1(
  uuid,uuid,text,integer,text
) from public,anon,authenticated;
grant execute on function public.extend_aba_session_short_v1(
  uuid,uuid,text,integer,text
) to service_role;

comment on function public.extend_aba_session_short_v1(uuid,uuid,text,integer,text)
is 'P0-504 short clinical extension only. Never creates calendar reservation, cancels B, or bills. One locked transaction with idempotency.';

commit;
