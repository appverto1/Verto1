-- Reconciles a partially applied reschedule schema without replaying historical
-- migrations. Every field below is written by approve_appointment_reschedule_v2.
-- The migration is additive and deliberately avoids inventing clinical data.

begin;

alter table if exists public.appointments
  add column if not exists organization_id uuid,
  -- These fields are not optional selects: approve_appointment_reschedule_v2
  -- uses them to scope the appointment to its clinic and patient.
  add column if not exists clinic_id uuid references public.clinics(id) on delete cascade,
  add column if not exists patient_id uuid references public.patients(id) on delete cascade,
  add column if not exists status text default 'scheduled',
  add column if not exists scheduled_start_at timestamptz,
  add column if not exists scheduled_end_at timestamptz,
  add column if not exists scheduled_duration_minutes integer,
  add column if not exists therapist_name text,
  add column if not exists room_id text,
  add column if not exists room_name text,
  add column if not exists location_type text,
  add column if not exists source_payload jsonb not null default '{}'::jsonb,
  add column if not exists patient_response text,
  add column if not exists patient_responded_at timestamptz,
  add column if not exists patient_confirmation_status text,
  add column if not exists patient_confirmation_at timestamptz,
  add column if not exists patient_confirmation_by text,
  add column if not exists patient_confirmation_source text,
  add column if not exists reschedule_requested_at timestamptz,
  add column if not exists reschedule_requested_by text,
  add column if not exists notification_24h_sent_at timestamptz,
  add column if not exists notification_12h_sent_at timestamptz,
  add column if not exists notification_sent boolean not null default false,
  add column if not exists notification_sent_at timestamptz,
  add column if not exists notification_12h_sent boolean not null default false;

-- Backfill only values that can be derived from an already persisted appointment.
-- Rows without a reliable duration/end remain null and are safely rejected by the
-- readiness guard instead of receiving an invented default duration.
with request_scope as (
  select
    request.appointment_id,
    min(request.organization_id) as organization_id,
    min(request.patient_id) as patient_id
  from public.appointment_action_requests as request
  where request.appointment_id is not null
    and request.organization_id is not null
    and request.patient_id is not null
  group by request.appointment_id
  having count(distinct request.organization_id) = 1
     and count(distinct request.patient_id) = 1
)
update public.appointments as appointment
   set organization_id = coalesce(appointment.organization_id, appointment.clinic_id),
       scheduled_start_at = coalesce(appointment.scheduled_start_at, appointment.scheduled_at),
       scheduled_duration_minutes = coalesce(
         appointment.scheduled_duration_minutes,
         case
           when coalesce(to_jsonb(appointment) ->> 'duration_minutes', '') ~ '^[0-9]+$'
            and (to_jsonb(appointment) ->> 'duration_minutes')::integer > 0
             then (to_jsonb(appointment) ->> 'duration_minutes')::integer
         end,
         case
           when coalesce(appointment.scheduled_start_at, appointment.scheduled_at) is not null
            and appointment.scheduled_end_at is not null
            and appointment.scheduled_end_at > coalesce(appointment.scheduled_start_at, appointment.scheduled_at)
             then extract(epoch from appointment.scheduled_end_at - coalesce(appointment.scheduled_start_at, appointment.scheduled_at))::integer / 60
         end
       ),
       clinic_id = coalesce(appointment.clinic_id, request_scope.organization_id),
       patient_id = coalesce(appointment.patient_id, request_scope.patient_id)
  from request_scope
 where request_scope.appointment_id = appointment.id
   and (
     appointment.organization_id is null
     or appointment.clinic_id is null
     or appointment.patient_id is null
     or appointment.scheduled_start_at is null
     or appointment.scheduled_duration_minutes is null
   );

update public.appointments as appointment
   set organization_id = appointment.clinic_id,
       scheduled_start_at = coalesce(appointment.scheduled_start_at, appointment.scheduled_at),
       scheduled_duration_minutes = coalesce(
         appointment.scheduled_duration_minutes,
         case
           when coalesce(to_jsonb(appointment) ->> 'duration_minutes', '') ~ '^[0-9]+$'
            and (to_jsonb(appointment) ->> 'duration_minutes')::integer > 0
             then (to_jsonb(appointment) ->> 'duration_minutes')::integer
         end,
         case
           when coalesce(appointment.scheduled_start_at, appointment.scheduled_at) is not null
            and appointment.scheduled_end_at is not null
            and appointment.scheduled_end_at > coalesce(appointment.scheduled_start_at, appointment.scheduled_at)
             then extract(epoch from appointment.scheduled_end_at - coalesce(appointment.scheduled_start_at, appointment.scheduled_at))::integer / 60
         end
       )
 where clinic_id is not null
   and (
     organization_id is null
     or scheduled_start_at is null
     or scheduled_duration_minutes is null
   );

update public.appointments
   set scheduled_end_at = scheduled_start_at
                          + make_interval(mins => scheduled_duration_minutes)
 where scheduled_end_at is null
   and scheduled_start_at is not null
   and scheduled_duration_minutes is not null
   and scheduled_duration_minutes > 0;

notify pgrst, 'reload schema';

commit;
