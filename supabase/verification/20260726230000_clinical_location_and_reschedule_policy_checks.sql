-- Consultas somente de leitura para validação pós-migration.

-- 1-2. Política por clínica e valores nulos.
select id, name, allow_patient_reschedule
from public.clinics
order by name;

select count(*) as clinics_with_null_policy
from public.clinics
where allow_patient_reschedule is null;

-- 3-8. Locais, snapshots e legados.
select care_setting, location_source, count(*) as appointments
from public.appointments
group by care_setting, location_source
order by care_setting nulls last, location_source nulls last;

-- Diagnósticos pré-trigger preservados pela migration. Uma mesma linha pode
-- aparecer mais de uma vez quando possui incompatibilidades independentes.
select diagnostic_code, count(*) as affected_records
from public.appointment_location_legacy_diagnostics_v1
group by diagnostic_code
order by diagnostic_code;

select appointment_id, clinic_id, care_setting, scheduled_at, diagnostic_code, diagnostic_context
from public.appointment_location_legacy_diagnostics_v1
order by diagnostic_code, scheduled_at desc nulls last, clinic_id
limit 500;

select id, clinic_id, patient_id, scheduled_at, room_id
from public.appointments
where care_setting = 'CLINIC'
  and nullif(trim(coalesce(room_id::text, '')), '') is null
order by scheduled_at desc;

select id, clinic_id, patient_id, scheduled_at, care_setting, room_id
from public.appointments
where care_setting is not null
  and care_setting <> 'CLINIC'
  and nullif(trim(coalesce(room_id::text, '')), '') is not null
order by scheduled_at desc;

select id, clinic_id, patient_id, scheduled_at, location_type
from public.appointments
where care_setting = 'SCHOOL' and school_id is null
order by scheduled_at desc;

select appointment.id, appointment.school_id, appointment.school_unit_id
from public.appointments appointment
where appointment.care_setting = 'SCHOOL'
  and appointment.school_unit_id is null
  and exists (
    select 1 from public.school_units unit
    where unit.school_id = appointment.school_id
      and unit.is_active
      and unit.archived_at is null
  );

select id, clinic_id, patient_id, scheduled_at
from public.appointments
where care_setting in ('SCHOOL', 'PATIENT_HOME')
  and (
    location_snapshot = '{}'::jsonb
    or nullif(trim(coalesce(location_address_snapshot, '')), '') is null
  );

select id, name, school_organization_id
from public.clinics
where school_organization_id is null
order by name;

select id, care_setting, location_name_snapshot, location_address_snapshot, scheduled_at
from public.appointments
where location_address_snapshot is not null
order by scheduled_at desc
limit 200;

select *
from public.appointment_care_setting_backfill_summary_v1;

-- 9-13. Vínculos escolares e catálogo elegível.
select patient_id, school_id, school_unit_id, enrollment_type, started_at
from public.patient_school_enrollments
where is_current
order by patient_id, enrollment_type;

select patient_id, count(*) as duplicate_primary_count
from public.patient_school_enrollments
where is_current and enrollment_type = 'PRIMARY_SCHOOL'
group by patient_id
having count(*) > 1;

select patient_id, count(*) as complementary_links
from public.patient_school_enrollments
where is_current and enrollment_type <> 'PRIMARY_SCHOOL'
group by patient_id
order by complementary_links desc;

select enrollment.patient_id, school.id as school_id, school.display_name, enrollment.enrollment_type
from public.patient_school_enrollments enrollment
join public.schools school on school.id = enrollment.school_id
where enrollment.is_current
  and school.is_active
  and school.archived_at is null
order by enrollment.patient_id, school.display_name;

select school_id, id as unit_id, name, city, state
from public.school_units
where is_active and archived_at is null
order by school_id, name;

-- 14-15. Solicitações/notificações incompatíveis com a política atual.
select request.id, request.appointment_id, request.created_at, appointment.clinic_id
from public.appointment_action_requests request
join public.appointments appointment on appointment.id = request.appointment_id
join public.clinics clinic on clinic.id = appointment.clinic_id
where request.request_type = 'RESCHEDULE'
  and clinic.allow_patient_reschedule = false
order by request.created_at desc;

select notification.id, notification.clinic_id, notification.created_at, notification.metadata
from public.portal_notifications notification
join public.clinics clinic on clinic.id = notification.clinic_id
where clinic.allow_patient_reschedule = false
  and coalesce((notification.metadata->'allowedActions'->>'canRequestReschedule')::boolean, false);

-- 16-18. RLS, grants e índices.
select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'appointments',
    'clinics',
    'clinic_policy_audit_events',
    'patient_school_enrollments'
  )
order by tablename, policyname;

select routine_schema, routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'set_clinic_patient_reschedule_policy_v1',
    'school_save_enrollment_v3'
  )
order by routine_name, grantee;

select
  role_name,
  has_function_privilege(
    role_name,
    'public.set_clinic_patient_reschedule_policy_v1(uuid,uuid,boolean,text,text,text)',
    'EXECUTE'
  ) as can_execute_policy_rpc,
  has_function_privilege(
    role_name,
    'public.school_save_enrollment_v3(uuid,uuid,uuid,uuid,jsonb,text,text)',
    'EXECUTE'
  ) as can_execute_school_rpc
from unnest(array['anon', 'authenticated', 'service_role']) role_name
order by role_name;

select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and (
    indexname like 'appointments_%care_setting%'
    or indexname like 'appointments_school_%'
    or indexname like 'clinic_policy_audit_events_%'
    or indexname = 'patient_school_single_primary_current_uidx'
  )
order by tablename, indexname;

-- 19. Auditoria.
select clinic_id, actor_id, policy_key, before_state, after_state, reason, created_at
from public.clinic_policy_audit_events
order by created_at desc
limit 200;

select organization_id, clinic_id, actor_id, resource_type, resource_id, action, created_at
from public.school_audit_events
where action in (
  'PATIENT_LINKED_TO_SCHOOL',
  'SCHOOL_ENROLLMENT_UPDATED',
  'SCHOOL_ENROLLMENT_ENDED'
)
order by created_at desc
limit 200;

-- 20. Referências órfãs (resultado esperado: zero linhas).
select appointment.id, appointment.school_id, appointment.school_unit_id
from public.appointments appointment
left join public.schools school on school.id = appointment.school_id
left join public.school_units unit on unit.id = appointment.school_unit_id
where (appointment.school_id is not null and school.id is null)
   or (appointment.school_unit_id is not null and unit.id is null)
   or (
     appointment.school_unit_id is not null
     and unit.school_id is distinct from appointment.school_id
   );
