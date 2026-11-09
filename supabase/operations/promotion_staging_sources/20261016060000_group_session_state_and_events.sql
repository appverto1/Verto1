-- Preserve the existing cold-login clinic-state contract in the same transaction.
-- No financial quote or price is copied to the general clinic-state read model.
begin;

create or replace function public.project_group_sessions_to_clinic_state_v1(
  p_organization_id uuid,p_actor_id uuid,p_booking_ids uuid[],p_operation_key text
) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_current public.clinic_state%rowtype;
  v_rows jsonb;
  v_ids text[];
  v_merged jsonb;
  v_result jsonb;
begin
  insert into public.clinic_state(clinic_id) values(p_organization_id) on conflict(clinic_id) do nothing;
  select * into strict v_current from public.clinic_state where clinic_id=p_organization_id for update;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'clinicId',p_organization_id,'clinic_id',p_organization_id,'organization_id',p_organization_id,
      'patientId',a.patient_id,'patient_id',a.patient_id,'patientName',patient.name,'name',patient.name,
      'therapistId',a.therapist_id,'therapist_id',a.therapist_id,'professionalId',a.therapist_id,
      'professional',coalesce(a.therapist_name,professional.name),'therapistName',coalesce(a.therapist_name,professional.name),
      'professionalIds',a.source_payload->'professionalIds','professionalNames',a.source_payload->'professionalNames','sessionModality','GROUP','sessionGroupId',b.id,
      'date',to_char(coalesce(a.scheduled_start_at,a.scheduled_at) at time zone a.location_timezone,'YYYY-MM-DD'),
      'time',to_char(coalesce(a.scheduled_start_at,a.scheduled_at) at time zone a.location_timezone,'HH24:MI'),
      'scheduled_at',a.scheduled_at,'scheduled_start_at',a.scheduled_start_at,'scheduled_end_at',a.scheduled_end_at,
      'durationMinutes',a.scheduled_duration_minutes,'duration_minutes',a.scheduled_duration_minutes,
      'roomId',a.room_id,'room_id',a.room_id,'room',a.room_name,'roomName',a.room_name,
      'location','clinica','location_type','clinica','careSetting','CLINIC','locationTimezone',a.location_timezone,
      'status',a.status,'type',a.service_type,'approach',a.approach,'financialContextType','PRIVATE',
      'recurrenceGroupId',b.series_id,'recurrenceIndex',b.series_index,'isRecurring',b.series_id is not null,
      'patient_response',a.patient_response,'patient_responded_at',a.patient_responded_at,
      'patient_confirmation_status',a.patient_confirmation_status,'patient_confirmation_at',a.patient_confirmation_at,
      'is_active',a.is_active,'deleted_at',a.deleted_at,'notes',a.notes
    ) order by a.scheduled_at,a.id),'[]'::jsonb),coalesce(array_agg(a.id::text),array[]::text[])
  into v_rows,v_ids
  from public.group_session_participants p join public.group_session_bookings b on b.id=p.booking_id
    and b.organization_id=p.organization_id
  join public.appointments a on a.id=p.appointment_id and a.clinic_id=p.organization_id
  join public.patients patient on patient.id=a.patient_id and patient.clinic_id=p.organization_id
  left join public.users professional on professional.id=a.therapist_id
  where p.organization_id=p_organization_id and p.booking_id=any(p_booking_ids);
  select coalesce(jsonb_agg(value),'[]'::jsonb) into v_merged
  from jsonb_array_elements(v_current.appointments) where not(coalesce(value->>'id','')=any(v_ids));
  v_result:=public.verto_save_clinic_state_sections(
    p_clinic_id=>p_organization_id,p_updated_by=>p_actor_id,
    p_expected_section_versions=>jsonb_build_object('appointments',coalesce((v_current.section_versions->>'appointments')::bigint,0)),
    p_appointments=>v_merged||v_rows,p_idempotency_key=>p_operation_key
  );
  if not coalesce((v_result->>'success')::boolean,false) then raise exception 'GROUP_STATE_PERSISTENCE_UNCONFIRMED'; end if;
end;
$$;

create or replace function public.emit_group_appointment_events_v1(
  p_organization_id uuid,p_actor_id uuid,p_appointment_ids uuid[],p_event_type text,p_operation_key text
) returns void language sql security invoker set search_path=public,pg_temp as $$
  insert into public.appointment_domain_events(organization_id,clinic_id,patient_id,professional_id,appointment_id,
    event_type,idempotency_key,created_by,payload)
  select p_organization_id,p_organization_id,a.patient_id,a.therapist_id,a.id,p_event_type,
    p_operation_key||':'||p_event_type||':'||a.id::text,p_actor_id,
    jsonb_build_object('source','group_session_action','sessionGroupId',p.booking_id,'status',a.status)
  from public.appointments a join public.group_session_participants p on p.appointment_id=a.id
  where a.clinic_id=p_organization_id and p.organization_id=p_organization_id and a.id=any(p_appointment_ids);
$$;

-- Existing clinical and individual participant writes keep F5/login state current.
-- A batch statement projects once per clinic, rather than once per patient.
create or replace function public.project_changed_group_appointments_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_scope record;
begin
  if current_setting('verto.group_bulk_operation',true)='1' then return null; end if;
  for v_scope in select changed.clinic_id,array_agg(distinct participant.booking_id) booking_ids,
      max(changed.financial_event_actor_id::text)::uuid actor_id
    from group_changed changed join public.group_session_participants participant on participant.appointment_id=changed.id
      and participant.organization_id=changed.clinic_id
    group by changed.clinic_id loop
    perform public.project_group_sessions_to_clinic_state_v1(v_scope.clinic_id,v_scope.actor_id,v_scope.booking_ids,
      'group-status:'||gen_random_uuid()::text);
  end loop;
  return null;
end;
$$;
create trigger appointments_group_state_insert after insert on public.appointments
referencing new table as group_changed for each statement execute function public.project_changed_group_appointments_v1();
create trigger appointments_group_state_update after update on public.appointments
referencing new table as group_changed for each statement execute function public.project_changed_group_appointments_v1();

create or replace function public.list_group_sessions_v1(p_organization_id uuid,p_from date,p_to date)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  with selected as materialized (
    select b.* from public.group_session_bookings b join public.clinics clinic on clinic.id=b.organization_id
    where b.organization_id=p_organization_id and p_to>=p_from and p_to-p_from<=93
      and b.scheduled_start_at>=p_from::timestamp at time zone clinic.timezone
      and b.scheduled_start_at<(p_to+1)::timestamp at time zone clinic.timezone
    order by b.scheduled_start_at,b.id limit 101
  ), counts as (
    select p.booking_id,count(*) filter(where a.deleted_at is null and coalesce(a.is_active,true)
      and lower(a.status) not in ('canceled','cancelled','no_show','deleted')) active_participants
    from public.group_session_participants p join selected s on s.id=p.booking_id
    join public.appointments a on a.id=p.appointment_id group by p.booking_id
  ) select jsonb_build_object('success',true,'hasMore',(select count(*)>100 from selected),'data',coalesce(jsonb_agg(to_jsonb(selected)||
    jsonb_build_object('participantCount',coalesce(counts.active_participants,0)) order by selected.scheduled_start_at,selected.id),'[]'::jsonb))
    from (select * from selected order by scheduled_start_at,id limit 100) selected left join counts on counts.booking_id=selected.id;
$$;

revoke all on function public.project_group_sessions_to_clinic_state_v1(uuid,uuid,uuid[],text),
  public.emit_group_appointment_events_v1(uuid,uuid,uuid[],text,text),public.project_changed_group_appointments_v1(),
  public.list_group_sessions_v1(uuid,date,date) from public,anon,authenticated;
grant execute on function public.project_group_sessions_to_clinic_state_v1(uuid,uuid,uuid[],text),
  public.emit_group_appointment_events_v1(uuid,uuid,uuid[],text,text),public.list_group_sessions_v1(uuid,date,date) to service_role;
commit;
