-- Atomic GROUP lifecycle; existing financial triggers retain cancellation/no-show/payment policy.
begin;
create or replace function public.verify_group_session_booking_v1()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_capacity integer;
  v_team_count integer;
  v_authorized_count integer;
begin
  if tg_op = 'UPDATE' and (
      old.id is distinct from new.id or
      old.created_at is distinct from new.created_at or
      old.organization_id is distinct from new.organization_id or
      old.booking_key is distinct from new.booking_key or
      old.payload_hash is distinct from new.payload_hash or
      old.specialty is distinct from new.specialty or
      ((old.room_id is distinct from new.room_id or
        old.scheduled_start_at is distinct from new.scheduled_start_at or
        old.scheduled_end_at is distinct from new.scheduled_end_at or
        old.professional_ids is distinct from new.professional_ids)
        and current_setting('verto.group_reschedule_id',true) is distinct from old.id::text) or
      old.series_id is distinct from new.series_id or
      old.series_index is distinct from new.series_index or
      old.created_by is distinct from new.created_by
  ) then raise exception 'GROUP_BOOKING_SLOT_IMMUTABLE'; end if;
  -- Cancellation/completion must remain possible after a room or member is
  -- deactivated. Only INSERT needs current availability/membership checks.
  if tg_op = 'UPDATE' then
    if old.status is distinct from new.status and
       not (old.status = 'RESERVED' and new.status in ('COMPLETED','CANCELED'))
       and current_setting('verto.group_status_sync_id',true) is distinct from old.id::text then
      raise exception 'GROUP_BOOKING_STATUS_TRANSITION_INVALID';
    end if;
    if current_setting('verto.group_reschedule_id',true) is distinct from old.id::text then return new; end if;
    if old.status<>'RESERVED' then raise exception 'GROUP_BOOKING_NOT_RESERVED'; end if;
  end if;

  select room.capacity into v_capacity
  from public.clinic_rooms room
  where room.id = new.room_id
    and room.clinic_id = new.organization_id
    and room.is_active = true;
  if v_capacity is null or v_capacity < 2 then
    raise exception 'GROUP_BOOKING_ROOM_SCOPE_INVALID';
  end if;
  if not exists (
    select 1 from public.clinic_memberships actor_membership
    where actor_membership.clinic_id = new.organization_id
      and actor_membership.user_id = case when tg_op='UPDATE'
        then nullif(current_setting('verto.group_operation_actor',true),'')::uuid else new.created_by end
      and lower(actor_membership.status) = 'active'
  ) then raise exception 'GROUP_BOOKING_ACTOR_SCOPE_INVALID'; end if;

  select count(distinct requested_id)::integer into v_team_count
  from unnest(new.professional_ids) requested_id;
  if v_team_count <> cardinality(new.professional_ids) then
    raise exception 'GROUP_BOOKING_TEAM_DUPLICATED';
  end if;

  select count(distinct membership.user_id)::integer into v_authorized_count
  from public.clinic_memberships membership
  where membership.clinic_id = new.organization_id
    and membership.user_id = any(new.professional_ids)
    and lower(membership.status) = 'active'
    and lower(membership.role) = 'therapist'
    and public.appointment_financial_service_key_v1(membership.specialty)
      = public.appointment_financial_service_key_v1(new.specialty);
  if v_authorized_count <> cardinality(new.professional_ids) then
    raise exception 'GROUP_BOOKING_PROFESSIONAL_SCOPE_INVALID';
  end if;
  return new;
end;
$$;
create or replace function public.assert_group_booking_slot_v1(p_booking public.group_session_bookings)
returns void language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_room_blocks boolean;
  v_other record;
  v_team jsonb;
  v_field text;
  v_professional_text_ids text[];
begin
  if p_booking.organization_id is null or p_booking.scheduled_end_at <= p_booking.scheduled_start_at then
    raise exception 'GROUP_BOOKING_SLOT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:' || p_booking.organization_id::text, 0));

  select coalesce(room.prevent_overlapping_appointments,true) into v_room_blocks
  from public.clinic_rooms room
  where room.id = p_booking.room_id and room.clinic_id = p_booking.organization_id and room.is_active = true;
  if not found then raise exception 'GROUP_BOOKING_ROOM_SCOPE_INVALID'; end if;
  v_professional_text_ids := array(select professional_id::text from unnest(p_booking.professional_ids) professional_id);

  -- The lock also protects against two concurrent GROUP headers with
  -- different idempotency keys but overlapping team/room.
  if exists (
    select 1 from public.group_session_bookings booking
    where booking.id<>p_booking.id and booking.organization_id = p_booking.organization_id
      and booking.status in ('RESERVED','COMPLETED')
      and booking.scheduled_start_at < p_booking.scheduled_end_at
      and booking.scheduled_end_at > p_booking.scheduled_start_at
      and (booking.professional_ids && p_booking.professional_ids or
           (v_room_blocks and booking.room_id = p_booking.room_id))
  ) then raise exception 'GROUP_BOOKING_SLOT_BUSY'; end if;

  -- Existing clinical appointments, including secondary professionals stored
  -- in source_payload, must also block conflicting new group reservations.
  for v_other in
    select a.id,a.room_id,a.therapist_id,a.source_payload
    from public.appointments a
    where a.source_payload->>'sessionGroupId' is distinct from p_booking.id::text
      and a.clinic_id = p_booking.organization_id
      and a.deleted_at is null and coalesce(a.is_active,true) = true
      and lower(coalesce(a.status,'')) in (
        'pending','pendente','scheduled','agendada','agendado',
        'confirmed','confirmada','confirmado','in_progress','em_andamento',
        'completed','concluida','concluido','realizada','realizado',
        'cancel_requested','cancelamento_solicitado',
        'reschedule_requested','remarcacao_solicitada',
        'rescheduled_active','remarcada_ativa','remarcado_ativo'
      )
      and coalesce(a.scheduled_start_at,a.scheduled_at) < p_booking.scheduled_end_at
      and coalesce(
        a.scheduled_end_at,
        coalesce(a.scheduled_start_at,a.scheduled_at)
          + coalesce(a.scheduled_duration_minutes,a.duration_minutes,50) * interval '1 minute'
      ) > p_booking.scheduled_start_at
  loop
    if v_other.therapist_id = any(p_booking.professional_ids) then
      raise exception 'GROUP_BOOKING_PROFESSIONAL_BUSY';
    end if;
    if v_room_blocks and v_other.room_id = p_booking.room_id::text then
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
  return;
end;
$$;

create or replace function public.guard_group_booking_slot_v1()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  perform public.assert_group_booking_slot_v1(new);
  return new;
end;
$$;
drop trigger group_booking_z_slot_guard on public.group_session_bookings;
create trigger group_booking_z_slot_guard before insert or update of room_id,professional_ids,scheduled_start_at,scheduled_end_at
on public.group_session_bookings for each row execute function public.guard_group_booking_slot_v1();
drop trigger group_booking_work_schedule_guard on public.group_session_bookings;
create trigger group_booking_work_schedule_guard before insert or update of room_id,professional_ids,scheduled_start_at,scheduled_end_at
on public.group_session_bookings for each row execute function public.guard_group_work_schedule_v1();

create or replace function public.guard_appointment_group_slot_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_booking public.group_session_bookings%rowtype;
  v_group_id uuid;
  v_team text[];
  v_start timestamptz := coalesce(new.scheduled_start_at,new.scheduled_at);
  v_end timestamptz := coalesce(new.scheduled_end_at,v_start+coalesce(new.scheduled_duration_minutes,new.duration_minutes,50)*interval '1 minute');
  v_field text;
  v_room_blocks boolean := true;
begin
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:'||new.clinic_id::text,0));
  if tg_op='UPDATE' and old.clinic_id is distinct from new.clinic_id
     and exists(select 1 from public.group_session_participants where appointment_id=old.id) then
    raise exception 'GROUP_APPOINTMENT_SCOPE_IMMUTABLE';
  end if;
  -- A linked appointment cannot be detached or repriced through a generic writer.
  if tg_op='UPDATE' and exists(select 1 from public.group_session_participants where appointment_id=old.id) then
    if old.patient_id is distinct from new.patient_id
      or old.organization_id is distinct from new.organization_id
      or old.source_payload->>'sessionGroupId' is distinct from new.source_payload->>'sessionGroupId'
      or old.source_payload->>'sessionModality' is distinct from new.source_payload->>'sessionModality'
      or (old.source_payload->'professionalIds' is distinct from new.source_payload->'professionalIds'
        and current_setting('verto.group_reschedule_id',true) is distinct from old.source_payload->>'sessionGroupId')
      or old.source_payload->'privatePricingResolution' is distinct from new.source_payload->'privatePricingResolution'
      or old.source_payload->>'financialContextType' is distinct from new.source_payload->>'financialContextType'
      or old.source_payload->>'groupFinancialPlanId' is distinct from new.source_payload->>'groupFinancialPlanId' then
      raise exception 'GROUP_APPOINTMENT_FINANCE_IMMUTABLE';
    end if;
    if (old.scheduled_at is distinct from new.scheduled_at or old.scheduled_start_at is distinct from new.scheduled_start_at
      or old.scheduled_end_at is distinct from new.scheduled_end_at or old.room_id is distinct from new.room_id
      or old.therapist_id is distinct from new.therapist_id or old.duration_minutes is distinct from new.duration_minutes
      or old.scheduled_duration_minutes is distinct from new.scheduled_duration_minutes)
      and current_setting('verto.group_reschedule_id',true) is distinct from old.source_payload->>'sessionGroupId' then
      raise exception 'GROUP_USE_GROUP_RESCHEDULE';
    end if;
    -- Canceled participants retain their original date when the active group moves.
    if new.deleted_at is not null or coalesce(new.is_active,true)=false
      or lower(coalesce(new.status,'')) in ('canceled','cancelled','cancelada','cancelado','no_show','falta','deleted') then
      return new;
    end if;
  end if;
  if upper(coalesce(new.source_payload->>'session_modality',''))='GROUP'
     and new.source_payload->>'sessionModality' is distinct from 'GROUP' then
    raise exception 'GROUP_APPOINTMENT_RPC_REQUIRED';
  end if;
  if upper(coalesce(new.source_payload->>'sessionModality',''))='GROUP' then
    if coalesce(new.source_payload->>'sessionGroupId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'GROUP_APPOINTMENT_ID_INVALID';
    end if;
    v_group_id:=(new.source_payload->>'sessionGroupId')::uuid;
    select * into v_booking from public.group_session_bookings b
    where b.id=v_group_id and b.organization_id=new.clinic_id;
    if not found or new.organization_id is distinct from new.clinic_id
      or new.room_id is distinct from v_booking.room_id::text
      or v_start is distinct from v_booking.scheduled_start_at
      or v_end is distinct from v_booking.scheduled_end_at
      or not(new.therapist_id=any(v_booking.professional_ids))
      or new.location_type is distinct from 'clinica' or new.care_setting is distinct from 'CLINIC'
      or new.source_payload->'professionalIds' is distinct from to_jsonb(v_booking.professional_ids)
      or public.appointment_financial_service_key_v1(new.service_type) is distinct from public.appointment_financial_service_key_v1(v_booking.specialty) then
      raise exception 'GROUP_APPOINTMENT_CANONICAL_SLOT_REQUIRED';
    end if;
    if (tg_op='INSERT' or old.source_payload->>'sessionModality' is distinct from 'GROUP') and (
      current_setting('verto.group_booking_id',true) is distinct from v_group_id::text
      or v_booking.status<>'RESERVED'
      or new.source_payload->>'financialContextType' is distinct from 'PRIVATE'
      or new.source_payload#>>'{privatePricingResolution,session_modality}' is distinct from 'GROUP'
    ) then raise exception 'GROUP_APPOINTMENT_RPC_REQUIRED'; end if;
  elsif (new.source_payload ? 'sessionGroupId' or new.source_payload ? 'session_group_id') then
    raise exception 'GROUP_APPOINTMENT_RPC_REQUIRED';
  end if;
  if new.deleted_at is not null or coalesce(new.is_active,true)=false
    or lower(coalesce(new.status,'')) not in (
      'pending','pendente','scheduled','agendada','agendado','confirmed','confirmada','confirmado',
      'in_progress','em_andamento','completed','concluida','concluido','realizada','realizado',
      'cancel_requested','cancelamento_solicitado','reschedule_requested','remarcacao_solicitada',
      'rescheduled_active','remarcada_ativa','remarcado_ativo') then return new; end if;
  if v_group_id is not null and exists(select 1 from public.appointments a
    where a.clinic_id=new.clinic_id and a.patient_id=new.patient_id and a.id<>new.id
      and a.deleted_at is null and coalesce(a.is_active,true)
      and lower(a.status) in ('scheduled','pending','confirmed','in_progress','completed','cancel_requested','reschedule_requested')
      and coalesce(a.scheduled_start_at,a.scheduled_at)<v_end
      and coalesce(a.scheduled_end_at,coalesce(a.scheduled_start_at,a.scheduled_at)+coalesce(a.scheduled_duration_minutes,a.duration_minutes,50)*interval '1 minute')>v_start) then
    raise exception 'GROUP_PARTICIPANT_PATIENT_BUSY';
  end if;
  v_team:=array[new.therapist_id::text];
  foreach v_field in array array['professionalIds','professional_ids','teamProfessionalIds','team_professional_ids'] loop
    if new.source_payload ? v_field and jsonb_typeof(new.source_payload->v_field)='array' then
      v_team:=v_team||array(select jsonb_array_elements_text(new.source_payload->v_field));
    end if;
  end loop;
  select coalesce(r.prevent_overlapping_appointments,true) into v_room_blocks
  from public.clinic_rooms r where r.id::text=new.room_id and r.clinic_id=new.clinic_id;
  if exists(select 1 from public.group_session_bookings b
    where b.organization_id=new.clinic_id and b.status in ('RESERVED','COMPLETED')
      and b.id is distinct from v_group_id
      and b.scheduled_start_at<v_end+interval '120 minutes' and b.scheduled_end_at+interval '120 minutes'>v_start
      and ((coalesce(v_room_blocks,true) and b.room_id::text=new.room_id and b.scheduled_start_at<v_end and b.scheduled_end_at>v_start)
        or exists(select 1 from public.clinic_memberships membership
          cross join lateral (select least(120,greatest(0,coalesce((coalesce(membership.work_schedule->>'sessionBufferMinutes',membership.work_schedule->>'session_buffer_minutes'))::numeric,0)::int)) buffer) padding
          where membership.clinic_id=new.clinic_id and membership.user_id=any(b.professional_ids)
            and membership.user_id::text=any(v_team)
            and b.scheduled_start_at<v_end+padding.buffer*interval '1 minute'
            and b.scheduled_end_at+padding.buffer*interval '1 minute'>v_start))) then
    raise exception 'GROUP_BOOKING_SLOT_BUSY';
  end if;
  if exists(select 1 from public.group_session_participants p
    join public.appointments a on a.id=p.appointment_id
    where p.organization_id=new.clinic_id and p.patient_id=new.patient_id and a.id<>new.id
      and a.deleted_at is null and coalesce(a.is_active,true)
      and lower(a.status) in ('scheduled','pending','confirmed','in_progress','completed','cancel_requested','reschedule_requested')
      and coalesce(a.scheduled_start_at,a.scheduled_at)<v_end
      and coalesce(a.scheduled_end_at,coalesce(a.scheduled_start_at,a.scheduled_at)+coalesce(a.scheduled_duration_minutes,a.duration_minutes,50)*interval '1 minute')>v_start) then
    raise exception 'GROUP_PARTICIPANT_PATIENT_BUSY';
  end if;
  return new;
end;
$$;
create or replace function public.verify_group_session_participant_v1()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_booking public.group_session_bookings%rowtype;
  v_room_capacity integer;
  v_participant_count integer;
begin
  select * into v_booking
  from public.group_session_bookings
  where id = new.booking_id and organization_id = new.organization_id
  for update;
  if not found or v_booking.status <> 'RESERVED' then
    raise exception 'GROUP_PARTICIPANT_BOOKING_SCOPE_INVALID';
  end if;

  -- All joins of a booking serialize on the same header lock.
  select room.capacity into v_room_capacity from public.clinic_rooms room
  where room.id=v_booking.room_id and room.clinic_id=new.organization_id and room.is_active=true;
  if v_room_capacity is null or v_room_capacity < 2 then
    raise exception 'GROUP_PARTICIPANT_ROOM_UNAVAILABLE';
  end if;
  select count(*)::integer into v_participant_count
  from public.group_session_participants existing join public.appointments a on a.id=existing.appointment_id
  where existing.booking_id=new.booking_id and a.deleted_at is null and coalesce(a.is_active,true)
    and lower(a.status) in ('scheduled','pending','confirmed','in_progress','completed','cancel_requested','reschedule_requested');
  if v_participant_count >= 30 then
    raise exception 'GROUP_PARTICIPANT_CAPACITY_EXCEEDED';
  end if;
  if v_participant_count >= v_room_capacity then
    raise exception 'GROUP_PARTICIPANT_ROOM_CAPACITY_EXCEEDED';
  end if;

  if not exists (
    select 1 from public.patients patient
    where patient.id = new.patient_id and patient.clinic_id = new.organization_id
  ) then raise exception 'GROUP_PARTICIPANT_PATIENT_SCOPE_INVALID'; end if;

  if not exists (
    select 1 from public.patient_financial_plans plan
    where plan.id = new.financial_plan_id
      and plan.organization_id = new.organization_id
      and plan.patient_id = new.patient_id
      and plan.billing_mode = 'PRIVATE'
      and plan.status = 'ACTIVE'
      and public.appointment_financial_service_key_v1(
        coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type)
      ) = public.appointment_financial_service_key_v1(v_booking.specialty)
      and plan.group_amount_cents = new.unit_amount_cents
      and plan.valid_from <= v_booking.scheduled_start_at
      and (plan.valid_until is null or v_booking.scheduled_start_at < plan.valid_until)
  ) then raise exception 'GROUP_PARTICIPANT_RATE_SCOPE_INVALID'; end if;

  if not exists (
    select 1 from public.appointments appointment
    where appointment.id = new.appointment_id
      and appointment.clinic_id = new.organization_id
      and appointment.patient_id = new.patient_id
      and appointment.deleted_at is null
      and coalesce(appointment.is_active,true)=true
      and lower(coalesce(appointment.status,'')) in ('scheduled','pending','confirmed')
      and appointment.room_id = v_booking.room_id::text
      and appointment.location_type = 'clinica'
      and appointment.therapist_id = any(v_booking.professional_ids)
      and public.appointment_financial_service_key_v1(appointment.service_type)
        = public.appointment_financial_service_key_v1(v_booking.specialty)
      and coalesce(appointment.scheduled_duration_minutes,appointment.duration_minutes)
        = extract(epoch from (v_booking.scheduled_end_at-v_booking.scheduled_start_at))::integer / 60
      and coalesce(appointment.scheduled_start_at,appointment.scheduled_at) = v_booking.scheduled_start_at
      and appointment.scheduled_end_at = v_booking.scheduled_end_at
      and appointment.source_payload->>'sessionGroupId' = new.booking_id::text
      and appointment.source_payload->>'sessionModality' = 'GROUP'
      and jsonb_typeof(appointment.source_payload->'professionalIds') = 'array'
      and jsonb_array_length(appointment.source_payload->'professionalIds') = cardinality(v_booking.professional_ids)
      and appointment.source_payload->'professionalIds' @> to_jsonb(v_booking.professional_ids)
  ) then raise exception 'GROUP_PARTICIPANT_APPOINTMENT_SCOPE_INVALID'; end if;

  return new;
end;
$$;

-- Clinical and existing individual participant actions also maintain the ledger.
create or replace function public.sync_group_booking_status_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_booking public.group_session_bookings%rowtype;
  v_target text;
begin
  select booking.* into v_booking from public.group_session_bookings booking
  join public.group_session_participants participant on participant.booking_id=booking.id
    and participant.organization_id=booking.organization_id
  where participant.appointment_id=new.id and participant.organization_id=new.clinic_id;
  if not found then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:'||new.clinic_id::text,0));
  if exists(select 1 from public.group_session_participants p join public.appointments a on a.id=p.appointment_id
    where p.booking_id=v_booking.id and a.deleted_at is null and coalesce(a.is_active,true)
      and lower(a.status) in ('scheduled','pending','confirmed','in_progress','cancel_requested','reschedule_requested')) then
    v_target:='RESERVED';
  elsif exists(select 1 from public.group_session_participants p join public.appointments a on a.id=p.appointment_id
    where p.booking_id=v_booking.id and a.deleted_at is null and coalesce(a.is_active,true) and lower(a.status)='completed') then
    v_target:='COMPLETED';
  else v_target:='CANCELED'; end if;
  if v_target<>v_booking.status then
    if v_target='RESERVED' then
      perform public.assert_group_work_schedule_v1(v_booking);
      perform public.assert_group_booking_slot_v1(v_booking);
    end if;
    perform set_config('verto.group_status_sync_id',v_booking.id::text,true);
    update public.group_session_bookings set status=v_target,updated_at=clock_timestamp() where id=v_booking.id;
    perform set_config('verto.group_status_sync_id','',true);
  end if;
  return new;
end;
$$;
create trigger appointments_group_status_sync after update of status,is_active,deleted_at on public.appointments
for each row execute function public.sync_group_booking_status_v1();

create or replace function public.cancel_group_session_v1(
  p_organization_id uuid,p_actor_id uuid,p_booking_id uuid,p_patient_ids uuid[],
  p_reason text,p_policy_amounts jsonb,p_scope text,p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_booking public.group_session_bookings%rowtype;
  v_previous public.group_session_operations%rowtype;
  v_booking_ids uuid[];
  v_patients uuid[];
  v_hash text;
  v_changed_appointments uuid[]:=array[]::uuid[];
  v_row record;
  v_amount numeric;
begin
  perform 1 from public.clinic_memberships where clinic_id=p_organization_id and user_id=p_actor_id and status='active' for share;
  if not found then raise exception 'GROUP_ACTOR_OUT_OF_SCOPE'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 3 and 1000
    or p_scope not in ('single','future') or p_scope is null
    or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9:._-]{12,120}$'
    or jsonb_typeof(coalesce(p_policy_amounts,'{}'::jsonb))<>'object' then raise exception 'GROUP_INPUT_INVALID'; end if;
  if p_patient_ids is not null then
    if cardinality(p_patient_ids) not between 1 and 30 then raise exception 'GROUP_INPUT_INVALID'; end if;
    select array_agg(x order by x) into v_patients from(select distinct x from unnest(p_patient_ids)x where x is not null)s;
    if cardinality(v_patients) is distinct from cardinality(p_patient_ids) then raise exception 'GROUP_DUPLICATED_IDS'; end if;
    if p_scope='future' then raise exception 'GROUP_PARTIAL_FUTURE_CANCEL_UNSUPPORTED'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:'||p_organization_id::text,0));
  select * into v_booking from public.group_session_bookings where id=p_booking_id and organization_id=p_organization_id for update;
  if not found then raise exception 'GROUP_BOOKING_OUT_OF_SCOPE'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('operation','CANCEL','booking',p_booking_id,
    'patients',v_patients,'reason',btrim(p_reason),'policy',coalesce(p_policy_amounts,'{}'::jsonb),'scope',p_scope)::text,'UTF8')),'hex');
  select * into v_previous from public.group_session_operations where organization_id=p_organization_id and operation_key=p_idempotency_key;
  if found then
    if v_previous.payload_hash<>v_hash then raise exception 'GROUP_IDEMPOTENCY_CONFLICT'; end if;
    return public.group_session_result_v1(p_organization_id,v_previous.booking_ids)||jsonb_build_object('idempotent',true);
  end if;
  if p_scope='future' and v_booking.series_id is not null then
    select array_agg(id order by scheduled_start_at,id) into v_booking_ids from public.group_session_bookings
    where organization_id=p_organization_id and series_id=v_booking.series_id
      and scheduled_start_at>=v_booking.scheduled_start_at and status='RESERVED';
  else v_booking_ids:=array[p_booking_id]; end if;
  v_booking_ids:=coalesce(v_booking_ids,array[p_booking_id]);
  perform 1 from public.group_session_bookings where id=any(v_booking_ids) order by id for update;
  if v_patients is not null and (select count(*) from public.group_session_participants
    where booking_id=p_booking_id and patient_id=any(v_patients))<>cardinality(v_patients) then raise exception 'GROUP_PATIENT_OUT_OF_SCOPE'; end if;
  if exists(select 1 from public.group_session_participants p join public.appointments a on a.id=p.appointment_id
    where p.booking_id=any(v_booking_ids) and (v_patients is null or p.patient_id=any(v_patients))
      and lower(a.status) in ('completed','in_progress')) then raise exception 'GROUP_CLINICAL_HISTORY_IMMUTABLE'; end if;
  perform set_config('verto.group_bulk_operation','1',true);
  for v_row in select a.id,a.patient_id from public.group_session_participants p join public.appointments a on a.id=p.appointment_id
    where p.organization_id=p_organization_id and p.booking_id=any(v_booking_ids)
      and (v_patients is null or p.patient_id=any(v_patients))
      and a.deleted_at is null and coalesce(a.is_active,true)
      and lower(a.status) in ('scheduled','pending','confirmed','cancel_requested','reschedule_requested') order by a.id for update of a loop
    v_amount:=null;
    if coalesce(p_policy_amounts,'{}'::jsonb) ? v_row.patient_id::text then
      if jsonb_typeof(p_policy_amounts->v_row.patient_id::text)<>'number' then raise exception 'GROUP_POLICY_AMOUNT_INVALID'; end if;
      v_amount:=(p_policy_amounts->>v_row.patient_id::text)::numeric;
    end if;
    update public.appointments set status='canceled',financial_event_actor_id=p_actor_id,
      financial_event_reason=btrim(p_reason),financial_policy_decision_amount=v_amount,
      financial_policy_decision_event=case when v_amount is not null then 'CANCELED' end,
      source_payload=source_payload||jsonb_build_object('privatePricingActorId',p_actor_id,'privatePricingReason',btrim(p_reason)),
      updated_at=clock_timestamp() where id=v_row.id;
    v_changed_appointments:=array_append(v_changed_appointments,v_row.id);
  end loop;
  perform public.project_group_sessions_to_clinic_state_v1(p_organization_id,p_actor_id,v_booking_ids,'group:'||p_idempotency_key);
  perform public.emit_group_appointment_events_v1(p_organization_id,p_actor_id,v_changed_appointments,'appointment.status.updated',p_idempotency_key);
  perform set_config('verto.group_bulk_operation','',true);
  insert into public.group_session_operations(organization_id,operation_key,payload_hash,booking_ids,created_by)
  values(p_organization_id,p_idempotency_key,v_hash,v_booking_ids,p_actor_id);
  return public.group_session_result_v1(p_organization_id,v_booking_ids)||jsonb_build_object('idempotent',false);
end;
$$;

create or replace function public.reschedule_group_session_v1(
  p_organization_id uuid,p_actor_id uuid,p_booking_id uuid,p_local_date date,p_local_time time,
  p_duration_minutes integer,p_room_id uuid,p_professional_ids uuid[],p_reason text,p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_booking public.group_session_bookings%rowtype;
  v_previous public.group_session_operations%rowtype;
  v_hash text;
  v_changed_appointments uuid[]:=array[]::uuid[];
  v_team uuid[];
  v_team_names text[];
  v_start timestamptz;
  v_timezone text;
  v_room public.clinic_rooms%rowtype;
  v_row record;
begin
  perform 1 from public.clinic_memberships where clinic_id=p_organization_id and user_id=p_actor_id and status='active' for share;
  if not found then raise exception 'GROUP_ACTOR_OUT_OF_SCOPE'; end if;
  if p_local_date is null or p_local_time is null or p_duration_minutes is null or p_duration_minutes not between 15 and 360
    or extract(second from p_local_time)<>0 or p_professional_ids is null or cardinality(p_professional_ids) not between 1 and 8
    or length(btrim(coalesce(p_reason,''))) not between 3 and 1000
    or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9:._-]{12,120}$' then raise exception 'GROUP_INPUT_INVALID'; end if;
  select array_agg(x order by x) into v_team from(select distinct x from unnest(p_professional_ids)x where x is not null)s;
  if cardinality(v_team) is distinct from cardinality(p_professional_ids) then raise exception 'GROUP_DUPLICATED_IDS'; end if;
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:'||p_organization_id::text,0));
  select * into v_booking from public.group_session_bookings where id=p_booking_id and organization_id=p_organization_id for update;
  if not found then raise exception 'GROUP_BOOKING_OUT_OF_SCOPE'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('operation','RESCHEDULE','booking',p_booking_id,
    'date',p_local_date,'time',p_local_time,'duration',p_duration_minutes,'room',p_room_id,'team',v_team,'reason',btrim(p_reason))::text,'UTF8')),'hex');
  select * into v_previous from public.group_session_operations where organization_id=p_organization_id and operation_key=p_idempotency_key;
  if found then
    if v_previous.payload_hash<>v_hash then raise exception 'GROUP_IDEMPOTENCY_CONFLICT'; end if;
    return public.group_session_result_v1(p_organization_id,array[p_booking_id])||jsonb_build_object('idempotent',true);
  end if;
  if v_booking.status<>'RESERVED' then raise exception 'GROUP_BOOKING_NOT_RESERVED'; end if;
  if exists(select 1 from public.group_session_participants p join public.appointments a on a.id=p.appointment_id
    where p.booking_id=p_booking_id and lower(a.status) in ('completed','in_progress')) then raise exception 'GROUP_CLINICAL_HISTORY_IMMUTABLE'; end if;
  select timezone into strict v_timezone from public.clinics where id=p_organization_id;
  v_start:=(p_local_date+p_local_time) at time zone v_timezone;
  if (v_start at time zone v_timezone)::timestamp<>(p_local_date+p_local_time) then raise exception 'GROUP_SLOT_TIMEZONE_INVALID'; end if;
  select * into v_room from public.clinic_rooms where id=p_room_id and clinic_id=p_organization_id and is_active for share;
  if not found or v_room.capacity is null or (select count(*) from public.group_session_participants p join public.appointments a on a.id=p.appointment_id
    where p.booking_id=p_booking_id and a.deleted_at is null and coalesce(a.is_active,true)
      and lower(a.status) in ('scheduled','pending','confirmed','cancel_requested','reschedule_requested'))>v_room.capacity then
    raise exception 'GROUP_ROOM_CAPACITY_EXCEEDED'; end if;
  select array_agg(coalesce(nullif(btrim(u.name),''),'Profissional') order by requested.professional_id) into v_team_names
  from unnest(v_team) requested(professional_id) left join public.users u on u.id=requested.professional_id;
  perform set_config('verto.group_bulk_operation','1',true);
  perform set_config('verto.group_reschedule_id',p_booking_id::text,true);
  perform set_config('verto.group_operation_actor',p_actor_id::text,true);
  update public.group_session_bookings set scheduled_start_at=v_start,scheduled_end_at=v_start+p_duration_minutes*interval '1 minute',
    room_id=p_room_id,professional_ids=v_team,updated_at=clock_timestamp() where id=p_booking_id;
  for v_row in select a.id from public.group_session_participants p join public.appointments a on a.id=p.appointment_id
    where p.booking_id=p_booking_id and a.deleted_at is null and coalesce(a.is_active,true)
      and lower(a.status) in ('scheduled','pending','confirmed','cancel_requested','reschedule_requested') order by a.id for update of a loop
    update public.appointments set scheduled_at=v_start,scheduled_start_at=v_start,
      scheduled_end_at=v_start+p_duration_minutes*interval '1 minute',duration_minutes=p_duration_minutes,
      scheduled_duration_minutes=p_duration_minutes,room_id=p_room_id::text,room_name=v_room.name,therapist_id=v_team[1],therapist_name=v_team_names[1],location_timezone=v_timezone,
      status='scheduled',confirmed_at=null,confirmed_by=null,confirmed_by_role=null,
      patient_confirmation_status=null,patient_confirmation_at=null,patient_confirmation_by=null,patient_confirmation_source=null,
      patient_response=null,patient_responded_at=null,financial_event_actor_id=p_actor_id,financial_event_reason=btrim(p_reason),
      source_payload=source_payload||jsonb_build_object('professionalIds',v_team,'professionalNames',v_team_names,'professional',v_team_names[1],'date',p_local_date::text,'time',to_char(p_local_time,'HH24:MI'),
        'durationMinutes',p_duration_minutes,'privatePricingActorId',p_actor_id,'privatePricingReason',btrim(p_reason)),
      updated_at=clock_timestamp() where id=v_row.id;
    perform public.assert_group_patient_finance_v1(p_organization_id,v_row.id);
    v_changed_appointments:=array_append(v_changed_appointments,v_row.id);
  end loop;
  perform public.project_group_sessions_to_clinic_state_v1(p_organization_id,p_actor_id,array[p_booking_id],'group:'||p_idempotency_key);
  perform public.emit_group_appointment_events_v1(p_organization_id,p_actor_id,v_changed_appointments,'appointment.updated',p_idempotency_key);
  perform set_config('verto.group_bulk_operation','',true);
  insert into public.group_session_operations(organization_id,operation_key,payload_hash,booking_ids,created_by)
  values(p_organization_id,p_idempotency_key,v_hash,array[p_booking_id],p_actor_id);
  perform set_config('verto.group_reschedule_id','',true);
  perform set_config('verto.group_operation_actor','',true);
  return public.group_session_result_v1(p_organization_id,array[p_booking_id])||jsonb_build_object('idempotent',false);
end;
$$;

-- A capacity edit cannot invalidate a currently reserved collective session.
create or replace function public.guard_group_room_capacity_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.capacity is not distinct from old.capacity then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:'||new.clinic_id::text,0));
  if exists(select 1 from public.group_session_bookings b
    where b.organization_id=new.clinic_id and b.room_id=new.id and b.status='RESERVED'
      and (new.capacity is null or new.capacity<(select count(*) from public.group_session_participants p join public.appointments a on a.id=p.appointment_id
        where p.booking_id=b.id and a.deleted_at is null and coalesce(a.is_active,true)
          and lower(a.status) in ('scheduled','pending','confirmed','in_progress','cancel_requested','reschedule_requested')))) then
    raise exception 'GROUP_ROOM_CAPACITY_RESERVED'; end if;
  return new;
end;
$$;
create trigger clinic_rooms_group_capacity_guard before update of capacity on public.clinic_rooms
for each row execute function public.guard_group_room_capacity_v1();

revoke all on function public.assert_group_booking_slot_v1(public.group_session_bookings),public.sync_group_booking_status_v1(),
  public.guard_group_room_capacity_v1(),public.cancel_group_session_v1(uuid,uuid,uuid,uuid[],text,jsonb,text,text),
  public.reschedule_group_session_v1(uuid,uuid,uuid,date,time,integer,uuid,uuid[],text,text) from public,anon,authenticated;
grant execute on function public.assert_group_booking_slot_v1(public.group_session_bookings),
  public.cancel_group_session_v1(uuid,uuid,uuid,uuid[],text,jsonb,text,text),
  public.reschedule_group_session_v1(uuid,uuid,uuid,date,time,integer,uuid,uuid[],text,text) to service_role;
comment on table public.group_session_bookings is 'Canonical collective reservation; slot edits only through the atomic backend lifecycle RPC, with financial history retained.';
commit;
