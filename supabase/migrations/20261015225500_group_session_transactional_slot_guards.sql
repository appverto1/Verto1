-- Additional tenant-scoped transactional collision guards for draft GROUP ledger.
-- Depends on 20261015211500_group_session_booking_ledger.sql.
-- Remains UNDEPLOYED until the complete booking + finance transaction exists.
-- Clinic-wide advisory lock serializes GROUP vs GROUP creation and joining.
-- Individual appointment writers must participate in the same locking protocol
-- before any group-creation API is exposed; this is not a standalone reservation API.
begin;

create or replace function public.guard_group_booking_slot_v1()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_room_blocks boolean;
  v_other record;
  v_team jsonb;
  v_field text;
  v_professional_text_ids text[];
begin
  if tg_op <> 'INSERT' then return new; end if;
  if new.organization_id is null or new.scheduled_end_at <= new.scheduled_start_at then
    raise exception 'GROUP_BOOKING_SLOT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:' || new.organization_id::text, 0));

  select coalesce(room.prevent_overlapping_appointments,true) into v_room_blocks
  from public.clinic_rooms room
  where room.id = new.room_id and room.clinic_id = new.organization_id and room.is_active = true;
  if not found then raise exception 'GROUP_BOOKING_ROOM_SCOPE_INVALID'; end if;
  v_professional_text_ids := array(select professional_id::text from unnest(new.professional_ids) professional_id);

  -- The lock also protects against two concurrent GROUP headers with
  -- different idempotency keys but overlapping team/room.
  if exists (
    select 1 from public.group_session_bookings booking
    where booking.organization_id = new.organization_id
      and booking.status in ('RESERVED','COMPLETED')
      and booking.scheduled_start_at < new.scheduled_end_at
      and booking.scheduled_end_at > new.scheduled_start_at
      and (booking.professional_ids && new.professional_ids or
           (v_room_blocks and booking.room_id = new.room_id))
  ) then raise exception 'GROUP_BOOKING_SLOT_BUSY'; end if;

  -- Existing clinical appointments, including secondary professionals stored
  -- in source_payload, must also block conflicting new group reservations.
  for v_other in
    select a.id,a.room_id,a.therapist_id,a.source_payload
    from public.appointments a
    where a.clinic_id = new.organization_id
      and a.deleted_at is null and coalesce(a.is_active,true) = true
      and lower(coalesce(a.status,'')) in (
        'pending','pendente','scheduled','agendada','agendado',
        'confirmed','confirmada','confirmado','in_progress','em_andamento',
        'completed','concluida','concluido','realizada','realizado',
        'cancel_requested','cancelamento_solicitado',
        'reschedule_requested','remarcacao_solicitada',
        'rescheduled_active','remarcada_ativa','remarcado_ativo'
      )
      and coalesce(a.scheduled_start_at,a.scheduled_at) < new.scheduled_end_at
      and coalesce(
        a.scheduled_end_at,
        coalesce(a.scheduled_start_at,a.scheduled_at)
          + coalesce(a.scheduled_duration_minutes,a.duration_minutes,50) * interval '1 minute'
      ) > new.scheduled_start_at
  loop
    if v_other.therapist_id = any(new.professional_ids) then
      raise exception 'GROUP_BOOKING_PROFESSIONAL_BUSY';
    end if;
    if v_room_blocks and v_other.room_id = new.room_id::text then
      raise exception 'GROUP_BOOKING_ROOM_BUSY';
    end if;

    v_team := coalesce(v_other.source_payload,'{}'::jsonb);
    if jsonb_typeof(v_team) <> 'object' then
      raise exception 'GROUP_BOOKING_TEAM_UNVERIFIABLE';
    end if;
    foreach v_field in array array[
      'professionalIds','professional_ids','teamProfessionalIds','team_professional_ids'
    ] loop
      if not v_team ? v_field then continue; end if;
      if jsonb_typeof(v_team->v_field) <> 'array' then
        raise exception 'GROUP_BOOKING_TEAM_UNVERIFIABLE';
      end if;
      if exists (select 1 from jsonb_array_elements(v_team->v_field) as team_entry(value)
                 where jsonb_typeof(team_entry.value) <> 'string') then
        raise exception 'GROUP_BOOKING_TEAM_UNVERIFIABLE';
      end if;
      if (array(select jsonb_array_elements_text(v_team->v_field)) && v_professional_text_ids) then
        raise exception 'GROUP_BOOKING_PROFESSIONAL_BUSY';
      end if;
    end loop;
  end loop;
  return new;
end;
$$;

-- Alphabetical order: the existing verification trigger runs first, then this guard.
drop trigger if exists group_booking_z_slot_guard on public.group_session_bookings;
create trigger group_booking_z_slot_guard
before insert on public.group_session_bookings
for each row execute function public.guard_group_booking_slot_v1();

create or replace function public.guard_group_participant_slot_v1()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_booking public.group_session_bookings%rowtype;
begin
  -- Using the exact same lock protects concurrent joins of DIFFERENT groups.
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:' || new.organization_id::text,0));
  select * into v_booking from public.group_session_bookings booking
  where booking.id=new.booking_id and booking.organization_id=new.organization_id
  for update;
  if not found or v_booking.status <> 'RESERVED' then
    raise exception 'GROUP_PARTICIPANT_BOOKING_SCOPE_INVALID';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.clinic_id=new.organization_id
      and a.patient_id=new.patient_id and a.id <> new.appointment_id
      and a.deleted_at is null and coalesce(a.is_active,true) = true
      and lower(coalesce(a.status,'')) in (
        'pending','pendente','scheduled','agendada','agendado',
        'confirmed','confirmada','confirmado','in_progress','em_andamento',
        'completed','concluida','concluido','realizada','realizado',
        'cancel_requested','cancelamento_solicitado',
        'reschedule_requested','remarcacao_solicitada',
        'rescheduled_active','remarcada_ativa','remarcado_ativo'
      )
      and coalesce(a.scheduled_start_at,a.scheduled_at) < v_booking.scheduled_end_at
      and coalesce(
        a.scheduled_end_at,
        coalesce(a.scheduled_start_at,a.scheduled_at)
          + coalesce(a.scheduled_duration_minutes,a.duration_minutes,50) * interval '1 minute'
      ) > v_booking.scheduled_start_at
  ) then raise exception 'GROUP_PARTICIPANT_PATIENT_BUSY'; end if;
  return new;
end;
$$;

-- Must precede existing participant scope verification so clinic lock is
-- obtained before its booking-row lock, avoiding inconsistent lock order.
drop trigger if exists group_participant_a_slot_guard on public.group_session_participants;
create trigger group_participant_a_slot_guard
before insert on public.group_session_participants
for each row execute function public.guard_group_participant_slot_v1();

revoke all on function public.guard_group_booking_slot_v1() from public,anon,authenticated;
revoke all on function public.guard_group_participant_slot_v1() from public,anon,authenticated;
commit;
