-- One transaction owns canonical GROUP identity, patient appointments and finance.
-- Depends on all five 20261015 migrations and the GROUP snapshot resolver.
begin;

create table public.group_session_operations (
  organization_id uuid not null references public.clinics(id),
  operation_key text not null check (operation_key ~ '^[A-Za-z0-9:._-]{12,120}$'),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  booking_ids uuid[] not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id,operation_key)
);
alter table public.group_session_operations enable row level security;
revoke all on public.group_session_operations from public,anon,authenticated;
grant select,insert on public.group_session_operations to service_role;

create or replace function public.group_session_result_v1(p_organization_id uuid,p_booking_ids uuid[])
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('success',true,'modality','GROUP','reserved',true,
    'bookings',coalesce((select jsonb_agg(to_jsonb(b) order by b.scheduled_start_at,b.id)
      from public.group_session_bookings b where b.organization_id=p_organization_id and b.id=any(p_booking_ids)),'[]'::jsonb),
    'participants',coalesce((select jsonb_agg(to_jsonb(p) order by p.booking_id,p.patient_id)
      from public.group_session_participants p where p.organization_id=p_organization_id and p.booking_id=any(p_booking_ids)),'[]'::jsonb),
    'appointments',coalesce((select jsonb_agg(to_jsonb(a) order by a.scheduled_at,a.id)
      from public.appointments a join public.group_session_participants p on p.appointment_id=a.id
      where p.organization_id=p_organization_id and a.clinic_id=p_organization_id and p.booking_id=any(p_booking_ids)),'[]'::jsonb)
  );
$$;

-- The same lock covers GROUP creation/join and every individual appointment
-- write. Individual-vs-individual behavior remains with its existing validators.
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
      or old.source_payload->'professionalIds' is distinct from new.source_payload->'professionalIds'
      or old.source_payload->'privatePricingResolution' is distinct from new.source_payload->'privatePricingResolution'
      or old.source_payload->>'financialContextType' is distinct from new.source_payload->>'financialContextType'
      or old.source_payload->>'groupFinancialPlanId' is distinct from new.source_payload->>'groupFinancialPlanId' then
      raise exception 'GROUP_APPOINTMENT_FINANCE_IMMUTABLE';
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
      and b.scheduled_start_at<v_end and b.scheduled_end_at>v_start
      and ((array(select x::text from unnest(b.professional_ids) x))&&v_team
        or (coalesce(v_room_blocks,true) and b.room_id::text=new.room_id))) then
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
create trigger appointment_a_group_slot_guard before insert or update on public.appointments
for each row execute function public.guard_appointment_group_slot_v1();

create or replace function public.reserve_group_sessions_v1(
  p_organization_id uuid,p_actor_id uuid,p_patient_ids uuid[],p_professional_ids uuid[],
  p_specialty text,p_room_id uuid,p_local_slots jsonb,p_duration_minutes integer,p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_patients uuid[];
  v_team uuid[];
  v_slot jsonb;
  v_start timestamptz;
  v_timezone text;
  v_hash text;
  v_previous public.group_session_operations%rowtype;
  v_booking public.group_session_bookings%rowtype;
  v_patient uuid;
  v_appointment uuid;
  v_resolution jsonb;
  v_plan uuid;
  v_cents integer;
  v_booking_ids uuid[]:=array[]::uuid[];
  v_index integer:=0;
  v_series uuid:=gen_random_uuid();
  v_room_capacity integer;
  v_room_name text;
  v_source jsonb;
begin
  perform 1 from public.clinic_memberships m where m.clinic_id=p_organization_id
    and m.user_id=p_actor_id and m.status='active' for share;
  if not found then raise exception 'GROUP_ACTOR_OUT_OF_SCOPE'; end if;
  if cardinality(p_patient_ids) not between 2 and 30 or cardinality(p_professional_ids) not between 1 and 8
    or p_patient_ids is null or p_professional_ids is null
    or jsonb_typeof(p_local_slots) is distinct from 'array'
    or p_duration_minutes is null or p_duration_minutes not between 15 and 360
    or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9:._-]{12,120}$'
    or length(btrim(coalesce(p_specialty,''))) not between 2 and 120 then raise exception 'GROUP_INPUT_INVALID'; end if;
  if jsonb_array_length(p_local_slots) not between 1 and 12
    or jsonb_array_length(p_local_slots)*cardinality(p_patient_ids)>120 then raise exception 'GROUP_RECURRENCE_LIMIT'; end if;
  select array_agg(x order by x) into v_patients from(select distinct x from unnest(p_patient_ids)x where x is not null)s;
  select array_agg(x order by x) into v_team from(select distinct x from unnest(p_professional_ids)x where x is not null)s;
  if cardinality(v_patients) is distinct from cardinality(p_patient_ids)
    or cardinality(v_team) is distinct from cardinality(p_professional_ids) then raise exception 'GROUP_DUPLICATED_IDS'; end if;
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:'||p_organization_id::text,0));
  v_hash:=encode(sha256(convert_to(jsonb_build_object('operation','CREATE','patients',v_patients,'team',v_team,
    'specialty',public.appointment_financial_service_key_v1(p_specialty),'room',p_room_id,
    'slots',p_local_slots,'duration',p_duration_minutes)::text,'UTF8')),'hex');
  select * into v_previous from public.group_session_operations
    where organization_id=p_organization_id and operation_key=p_idempotency_key;
  if found then
    if v_previous.payload_hash<>v_hash then raise exception 'GROUP_IDEMPOTENCY_CONFLICT'; end if;
    return public.group_session_result_v1(p_organization_id,v_previous.booking_ids)||jsonb_build_object('idempotent',true);
  end if;
  select timezone into strict v_timezone from public.clinics where id=p_organization_id;
  if not exists(select 1 from pg_timezone_names where name=v_timezone) then raise exception 'GROUP_TIMEZONE_INVALID'; end if;
  select capacity,name into v_room_capacity,v_room_name from public.clinic_rooms
    where id=p_room_id and clinic_id=p_organization_id and is_active for share;
  if not found or v_room_capacity<cardinality(v_patients) then raise exception 'GROUP_ROOM_CAPACITY_EXCEEDED'; end if;
  perform 1 from public.patients where id=any(v_patients) and clinic_id=p_organization_id
    order by id for share;
  if (select count(*) from public.patients where id=any(v_patients) and clinic_id=p_organization_id
       and deleted_at is null and coalesce(is_active,true))<>cardinality(v_patients) then raise exception 'GROUP_PATIENT_OUT_OF_SCOPE'; end if;
  -- Same patient locks as the financial-plan reconciler, in stable order.
  foreach v_patient in array v_patients loop
    perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_patient::text,0));
  end loop;
  perform 1 from public.patient_financial_plans where organization_id=p_organization_id
    and patient_id=any(v_patients) order by patient_id,id for share;
  for v_slot in select value from jsonb_array_elements(p_local_slots) loop
    if coalesce(v_slot->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(v_slot->>'time','') !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'GROUP_SLOT_INVALID'; end if;
    v_start:=((v_slot->>'date')::date+(v_slot->>'time')::time) at time zone v_timezone;
    if to_char(v_start at time zone v_timezone,'YYYY-MM-DD HH24:MI') <> (v_slot->>'date')||' '||(v_slot->>'time') then
      raise exception 'GROUP_SLOT_TIMEZONE_INVALID'; end if;
    v_index:=v_index+1;
    insert into public.group_session_bookings(organization_id,booking_key,payload_hash,specialty,
      scheduled_start_at,scheduled_end_at,room_id,professional_ids,created_by)
    values(p_organization_id,case when jsonb_array_length(p_local_slots)=1 then p_idempotency_key else left(p_idempotency_key,110)||':slot:'||v_index end,
      v_hash,btrim(p_specialty),v_start,v_start+p_duration_minutes*interval '1 minute',p_room_id,v_team,p_actor_id)
    returning * into v_booking;
    v_booking_ids:=array_append(v_booking_ids,v_booking.id);
    perform set_config('verto.group_booking_id',v_booking.id::text,true);
    foreach v_patient in array v_patients loop
      v_resolution:=public.resolve_group_private_session_price_v1(p_organization_id,v_patient,p_specialty,null,
        v_start,'CLINIC',null,null,null,null,p_actor_id);
      v_plan:=(v_resolution->>'legacy_patient_financial_plan_id')::uuid;
      v_cents:=round((v_resolution->>'final_amount')::numeric*100)::integer;
      v_source:=jsonb_build_object('sessionModality','GROUP','sessionGroupId',v_booking.id,
        'professionalIds',to_jsonb(v_team),'groupFinancialPlanId',v_plan,'financialContextType','PRIVATE',
        'privatePricingResolution',v_resolution,'privatePricingActorId',p_actor_id,
        'date',v_slot->>'date','time',v_slot->>'time','patientId',v_patient,
        'serviceType',p_specialty,'durationMinutes',p_duration_minutes,
        'recurrenceGroupId',case when jsonb_array_length(p_local_slots)>1 then v_series end,
        'recurrenceIndex',v_index,'recurrenceTotal',jsonb_array_length(p_local_slots));
      insert into public.appointments(clinic_id,organization_id,patient_id,therapist_id,scheduled_at,
        scheduled_start_at,scheduled_end_at,duration_minutes,scheduled_duration_minutes,
        room_id,room_name,location_type,care_setting,location_timezone,service_type,approach,
        financial_event_actor_id,source_payload,status)
      values(p_organization_id,p_organization_id,v_patient,v_team[1],v_start,v_start,v_booking.scheduled_end_at,
        p_duration_minutes,p_duration_minutes,p_room_id::text,v_room_name,'clinica','CLINIC',v_timezone,
        p_specialty,p_specialty,p_actor_id,v_source,'scheduled') returning id into v_appointment;
      insert into public.group_session_participants(booking_id,organization_id,patient_id,appointment_id,financial_plan_id,unit_amount_cents)
      values(v_booking.id,p_organization_id,v_patient,v_appointment,v_plan,v_cents);
      insert into public.appointment_billing_contexts(organization_id,appointment_id,patient_id,
        payer_type,service_type,metadata,created_by,updated_by)
      values(p_organization_id,v_appointment,v_patient,'PRIVATE',p_specialty,
        jsonb_build_object('session_modality','GROUP','group_booking_id',v_booking.id,'financial_plan_id',v_plan),p_actor_id,p_actor_id);
      perform public.assert_group_patient_finance_v1(p_organization_id,v_appointment);
    end loop;
  end loop;
  insert into public.group_session_operations(organization_id,operation_key,payload_hash,booking_ids,created_by)
  values(p_organization_id,p_idempotency_key,v_hash,v_booking_ids,p_actor_id);
  perform set_config('verto.group_booking_id','',true);
  return public.group_session_result_v1(p_organization_id,v_booking_ids)||jsonb_build_object('idempotent',false);
end;
$$;

revoke all on function public.group_session_result_v1(uuid,uuid[]),public.guard_appointment_group_slot_v1(),
  public.reserve_group_sessions_v1(uuid,uuid,uuid[],uuid[],text,uuid,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.group_session_result_v1(uuid,uuid[]),
  public.reserve_group_sessions_v1(uuid,uuid,uuid[],uuid[],text,uuid,jsonb,integer,text) to service_role;
commit;
