begin;

-- Recheck explicit canonical professional schedules inside the booking lock.
-- Null work_schedule keeps the current manual-calendar contract unrestricted.
create or replace function public.assert_group_work_schedule_v1(p_booking public.group_session_bookings)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_member record;
  v_schedule jsonb;
  v_day jsonb;
  v_period jsonb;
  v_start timestamp;
  v_end timestamp;
  v_timezone text;
  v_key text;
  v_available boolean;
  v_member_count integer:=0;
begin
  select timezone into strict v_timezone from public.clinics where id=p_booking.organization_id;
  for v_member in select * from public.clinic_memberships where clinic_id=p_booking.organization_id
      and user_id=any(p_booking.professional_ids) and status='active' and role='therapist' for share loop
    v_member_count:=v_member_count+1;
    v_schedule:=v_member.work_schedule;
    if v_schedule is null then continue; end if;
    if jsonb_typeof(v_schedule)<>'object' or coalesce((v_schedule->>'active')::boolean,true)=false then
      raise exception 'GROUP_PROFESSIONAL_SCHEDULE_UNAVAILABLE'; end if;
    v_start:=p_booking.scheduled_start_at at time zone coalesce(nullif(v_member.availability_timezone,''),v_timezone);
    v_end:=p_booking.scheduled_end_at at time zone coalesce(nullif(v_member.availability_timezone,''),v_timezone);
    if v_start::date<>v_end::date then raise exception 'GROUP_PROFESSIONAL_SCHEDULE_UNAVAILABLE'; end if;
    v_key:=(array['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])[extract(dow from v_start)::int+1];
    v_day:=coalesce(v_schedule->'days',v_schedule->'weekly',v_schedule->'weeklySchedule',v_schedule->'weekly_schedule')->v_key;
    if v_day is null or coalesce((v_day->>'enabled')::boolean,true)=false then
      raise exception 'GROUP_PROFESSIONAL_SCHEDULE_UNAVAILABLE'; end if;
    v_available:=false;
    for v_period in select value from jsonb_array_elements(coalesce(v_day->'periods',v_day->'ranges',v_day->'shifts','[]'::jsonb)) loop
      if v_start::time>=(v_period->>'start')::time and v_end::time<=(v_period->>'end')::time then v_available:=true; end if;
    end loop;
    if not v_available then raise exception 'GROUP_PROFESSIONAL_SCHEDULE_UNAVAILABLE'; end if;
    for v_period in select value from jsonb_array_elements(coalesce(v_day->'intervals',v_day->'breaks','[]'::jsonb)) loop
      if v_start::time<(v_period->>'end')::time and v_end::time>(v_period->>'start')::time then
        raise exception 'GROUP_PROFESSIONAL_BREAK_UNAVAILABLE'; end if;
    end loop;
    for v_period in select value from jsonb_array_elements(coalesce(v_schedule->'exceptions','[]'::jsonb)) loop
      if v_period->>'date'=v_start::date::text and coalesce((v_period->>'active')::boolean,true)
         and coalesce((v_period->>'blocksAvailability')::boolean,true)
         and (nullif(v_period->>'start','') is null or nullif(v_period->>'end','') is null
           or (v_start::time<(v_period->>'end')::time and v_end::time>(v_period->>'start')::time)) then
        raise exception 'GROUP_PROFESSIONAL_EXCEPTION_UNAVAILABLE'; end if;
    end loop;
    if jsonb_array_length(coalesce(v_schedule->'allowedRoomIds','[]'::jsonb))>0
      and not(v_schedule->'allowedRoomIds' ? p_booking.room_id::text) then raise exception 'GROUP_PROFESSIONAL_ROOM_UNAVAILABLE'; end if;
  end loop;
  if v_member_count<>cardinality(p_booking.professional_ids) then raise exception 'GROUP_PROFESSIONAL_OUT_OF_SCOPE'; end if;
  return;
end;
$$;
create or replace function public.guard_group_work_schedule_v1()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  perform public.assert_group_work_schedule_v1(new);
  return new;
end;
$$;
create trigger group_booking_work_schedule_guard before insert on public.group_session_bookings
for each row execute function public.guard_group_work_schedule_v1();

create or replace function public.join_group_session_v1(
  p_organization_id uuid,p_actor_id uuid,p_booking_id uuid,p_patient_ids uuid[],p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_booking public.group_session_bookings%rowtype;
  v_previous public.group_session_operations%rowtype;
  v_patients uuid[];
  v_patient uuid;
  v_hash text;
  v_resolution jsonb;
  v_plan uuid;
  v_appointment uuid;
  v_source jsonb;
  v_room record;
  v_timezone text;
  v_duration integer;
begin
  perform 1 from public.clinic_memberships m where m.clinic_id=p_organization_id
    and m.user_id=p_actor_id and m.status='active' for share;
  if not found then raise exception 'GROUP_ACTOR_OUT_OF_SCOPE'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9:._-]{12,120}$'
    or p_patient_ids is null or cardinality(p_patient_ids) not between 1 and 30 then raise exception 'GROUP_INPUT_INVALID'; end if;
  select array_agg(x order by x) into v_patients from(select distinct x from unnest(p_patient_ids)x where x is not null)s;
  if cardinality(v_patients) is distinct from cardinality(p_patient_ids) then raise exception 'GROUP_DUPLICATED_IDS'; end if;
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:'||p_organization_id::text,0));
  select * into v_booking from public.group_session_bookings where id=p_booking_id and organization_id=p_organization_id for update;
  if not found then raise exception 'GROUP_BOOKING_OUT_OF_SCOPE'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('operation','JOIN','booking',p_booking_id,'patients',v_patients)::text,'UTF8')),'hex');
  select * into v_previous from public.group_session_operations where organization_id=p_organization_id and operation_key=p_idempotency_key;
  if found then
    if v_previous.payload_hash<>v_hash then raise exception 'GROUP_IDEMPOTENCY_CONFLICT'; end if;
    return public.group_session_result_v1(p_organization_id,array[p_booking_id])||jsonb_build_object('idempotent',true);
  end if;
  if v_booking.status<>'RESERVED' then raise exception 'GROUP_BOOKING_NOT_RESERVED'; end if;
  if exists(select 1 from public.group_session_participants where booking_id=p_booking_id and patient_id=any(v_patients)) then
    raise exception 'GROUP_PATIENT_ALREADY_PARTICIPATING'; end if;
  perform 1 from public.patients where id=any(v_patients) and clinic_id=p_organization_id
    order by id for share;
  if (select count(*) from public.patients where id=any(v_patients) and clinic_id=p_organization_id and deleted_at is null
    and coalesce(is_active,true))<>cardinality(v_patients) then raise exception 'GROUP_PATIENT_OUT_OF_SCOPE'; end if;
  if (select count(distinct user_id) from public.clinic_memberships where clinic_id=p_organization_id
    and user_id=any(v_booking.professional_ids) and status='active' and role='therapist'
    and public.appointment_financial_service_key_v1(specialty)=public.appointment_financial_service_key_v1(v_booking.specialty))
    <>cardinality(v_booking.professional_ids) then raise exception 'GROUP_PROFESSIONAL_OUT_OF_SCOPE'; end if;
  select * into v_room from public.clinic_rooms where id=v_booking.room_id and clinic_id=p_organization_id and is_active for share;
  if not found or (select count(*) from public.group_session_participants where booking_id=p_booking_id)+cardinality(v_patients)
    >least(30,v_room.capacity) then raise exception 'GROUP_ROOM_CAPACITY_EXCEEDED'; end if;
  perform public.assert_group_work_schedule_v1(v_booking);
  select timezone into strict v_timezone from public.clinics where id=p_organization_id;
  v_duration:=extract(epoch from(v_booking.scheduled_end_at-v_booking.scheduled_start_at))::int/60;
  foreach v_patient in array v_patients loop
    perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_patient::text,0));
  end loop;
  perform 1 from public.patient_financial_plans where organization_id=p_organization_id
    and patient_id=any(v_patients) order by patient_id,id for share;
  perform set_config('verto.group_booking_id',p_booking_id::text,true);
  foreach v_patient in array v_patients loop
    v_resolution:=public.resolve_group_private_session_price_v1(p_organization_id,v_patient,v_booking.specialty,null,
      v_booking.scheduled_start_at,'CLINIC',null,null,null,null,p_actor_id);
    v_plan:=(v_resolution->>'legacy_patient_financial_plan_id')::uuid;
    v_source:=jsonb_build_object('sessionModality','GROUP','sessionGroupId',p_booking_id,
      'professionalIds',to_jsonb(v_booking.professional_ids),'groupFinancialPlanId',v_plan,
      'financialContextType','PRIVATE','privatePricingResolution',v_resolution,'privatePricingActorId',p_actor_id,
      'date',to_char(v_booking.scheduled_start_at at time zone v_timezone,'YYYY-MM-DD'),
      'time',to_char(v_booking.scheduled_start_at at time zone v_timezone,'HH24:MI'),
      'patientId',v_patient,'serviceType',v_booking.specialty,'durationMinutes',v_duration);
    insert into public.appointments(clinic_id,organization_id,patient_id,therapist_id,scheduled_at,
      scheduled_start_at,scheduled_end_at,duration_minutes,scheduled_duration_minutes,room_id,room_name,
      location_type,care_setting,location_timezone,service_type,approach,financial_event_actor_id,source_payload,status)
    values(p_organization_id,p_organization_id,v_patient,v_booking.professional_ids[1],v_booking.scheduled_start_at,
      v_booking.scheduled_start_at,v_booking.scheduled_end_at,v_duration,v_duration,v_booking.room_id::text,v_room.name,
      'clinica','CLINIC',v_timezone,v_booking.specialty,v_booking.specialty,p_actor_id,v_source,'scheduled') returning id into v_appointment;
    insert into public.group_session_participants(booking_id,organization_id,patient_id,appointment_id,financial_plan_id,unit_amount_cents)
    values(p_booking_id,p_organization_id,v_patient,v_appointment,v_plan,round((v_resolution->>'final_amount')::numeric*100)::int);
    insert into public.appointment_billing_contexts(organization_id,appointment_id,patient_id,payer_type,service_type,metadata,created_by,updated_by)
    values(p_organization_id,v_appointment,v_patient,'PRIVATE',v_booking.specialty,
      jsonb_build_object('session_modality','GROUP','group_booking_id',p_booking_id,'financial_plan_id',v_plan),p_actor_id,p_actor_id);
      perform public.assert_group_patient_finance_v1(p_organization_id,v_appointment);
  end loop;
  insert into public.group_session_operations(organization_id,operation_key,payload_hash,booking_ids,created_by)
  values(p_organization_id,p_idempotency_key,v_hash,array[p_booking_id],p_actor_id);
  perform set_config('verto.group_booking_id','',true);
  return public.group_session_result_v1(p_organization_id,array[p_booking_id])||jsonb_build_object('idempotent',false);
end;
$$;
revoke all on function public.assert_group_work_schedule_v1(public.group_session_bookings),public.guard_group_work_schedule_v1(),public.join_group_session_v1(uuid,uuid,uuid,uuid[],text) from public,anon,authenticated;
grant execute on function public.assert_group_work_schedule_v1(public.group_session_bookings),public.join_group_session_v1(uuid,uuid,uuid,uuid[],text) to service_role;
commit;
