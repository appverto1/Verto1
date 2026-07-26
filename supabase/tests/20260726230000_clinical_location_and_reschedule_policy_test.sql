-- Teste real de banco para 20260726230000_clinical_location_and_reschedule_policy.sql.
-- Execute em banco local/homologação já migrado:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/20260726230000_clinical_location_and_reschedule_policy_test.sql
--
-- Pré-requisito: ao menos uma clínica com organização escolar, owner (ou membro
-- administrativo) e paciente pertencente à clínica. Todos os fixtures e efeitos
-- deste arquivo são revertidos pelo ROLLBACK final.

begin;

create temp table verto_20260726230000_test_context (
  actor_id uuid not null,
  clinic_id uuid not null,
  organization_id uuid not null,
  patient_id uuid not null,
  room_id uuid not null,
  school_id uuid not null,
  unlinked_school_id uuid not null,
  foreign_organization_id uuid not null,
  foreign_school_id uuid not null,
  clinic_appointment_id uuid not null,
  online_appointment_id uuid not null,
  school_appointment_id uuid not null,
  home_appointment_id uuid not null,
  enrollment_key text not null,
  enrollment_hash text,
  enrollment_response jsonb
) on commit drop;

do $$
declare
  v_signature text;
  v_view_name text;
begin
  foreach v_signature in array array[
    'public.set_clinic_patient_reschedule_policy_v1(uuid,uuid,boolean,text,text,text)',
    'public.school_save_enrollment_v3(uuid,uuid,uuid,uuid,jsonb,text,text)'
  ]
  loop
    if has_function_privilege('anon', v_signature, 'EXECUTE') then
      raise exception 'TEST_GRANT_ANON_FAILED: %', v_signature;
    end if;
    if has_function_privilege('authenticated', v_signature, 'EXECUTE') then
      raise exception 'TEST_GRANT_AUTHENTICATED_FAILED: %', v_signature;
    end if;
    if not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'TEST_GRANT_SERVICE_ROLE_FAILED: %', v_signature;
    end if;
    if exists (
      select 1
      from information_schema.routine_privileges privilege
      where privilege.routine_schema = 'public'
        and privilege.routine_name = split_part(split_part(v_signature, '.', 2), '(', 1)
        and privilege.grantee = 'PUBLIC'
        and privilege.privilege_type = 'EXECUTE'
    ) then
      raise exception 'TEST_GRANT_PUBLIC_FAILED: %', v_signature;
    end if;
  end loop;

  foreach v_view_name in array array[
    'public.appointment_location_legacy_diagnostics_v1',
    'public.appointment_care_setting_backfill_summary_v1'
  ]
  loop
    if has_table_privilege('anon', v_view_name, 'SELECT') then
      raise exception 'TEST_VIEW_SELECT_ANON_FAILED: %', v_view_name;
    end if;
    if has_table_privilege('authenticated', v_view_name, 'SELECT') then
      raise exception 'TEST_VIEW_SELECT_AUTHENTICATED_FAILED: %', v_view_name;
    end if;
    if not has_table_privilege('service_role', v_view_name, 'SELECT') then
      raise exception 'TEST_VIEW_SELECT_SERVICE_ROLE_FAILED: %', v_view_name;
    end if;
  end loop;
end
$$;

do $$
declare
  v_actor_id uuid;
  v_clinic_id uuid;
  v_organization_id uuid;
  v_patient_id uuid;
begin
  select candidate.actor_id, clinic.id, clinic.school_organization_id, patient.id
  into v_actor_id, v_clinic_id, v_organization_id, v_patient_id
  from public.clinics clinic
  join public.patients patient
    on patient.clinic_id = clinic.id
  cross join lateral (
    select actor.actor_id
    from (
      select clinic.owner_user_id as actor_id, 1 as priority
      where clinic.owner_user_id is not null

      union all

      select membership.user_id, 2
      from public.clinic_memberships membership
      where membership.clinic_id = clinic.id
        and membership.status = 'active'
        and lower(membership.role) in ('owner', 'admin', 'coordinator', 'receptionist')

      union all

      select app_user.id, 3
      from public.users app_user
      where app_user.clinic_id = clinic.id
        and lower(app_user.role) in ('owner', 'admin', 'coordinator', 'receptionist')
    ) actor
    join public.users existing_user on existing_user.id = actor.actor_id
    order by actor.priority
    limit 1
  ) candidate
  where clinic.school_organization_id is not null
  limit 1;

  if v_actor_id is null
     or v_clinic_id is null
     or v_organization_id is null
     or v_patient_id is null then
    raise exception
      'TEST_FIXTURE_REQUIRED: crie uma clínica com organização escolar, ator administrativo e paciente';
  end if;

  insert into verto_20260726230000_test_context (
    actor_id,
    clinic_id,
    organization_id,
    patient_id,
    room_id,
    school_id,
    unlinked_school_id,
    foreign_organization_id,
    foreign_school_id,
    clinic_appointment_id,
    online_appointment_id,
    school_appointment_id,
    home_appointment_id,
    enrollment_key
  ) values (
    v_actor_id,
    v_clinic_id,
    v_organization_id,
    v_patient_id,
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    'db-test-save-enrollment-v3-' || gen_random_uuid()::text
  );
end
$$;

insert into public.clinic_rooms (
  id,
  organization_id,
  clinic_id,
  name,
  is_active
)
select
  context.room_id,
  context.clinic_id,
  context.clinic_id,
  'Sala teste migration 20260726230000',
  true
from verto_20260726230000_test_context context;

insert into public.schools (
  id,
  organization_id,
  clinic_id,
  display_name,
  normalized_name,
  street,
  street_number,
  city,
  state,
  created_by,
  updated_by
)
select
  school.id,
  context.organization_id::text,
  context.clinic_id::text,
  school.display_name,
  school.normalized_name,
  'Rua Escola Teste',
  '100',
  'São Paulo',
  'SP',
  context.actor_id::text,
  context.actor_id::text
from verto_20260726230000_test_context context
cross join lateral (
  values
    (context.school_id, 'Escola vinculada teste', 'escola vinculada teste'),
    (context.unlinked_school_id, 'Escola não vinculada teste', 'escola nao vinculada teste')
) school(id, display_name, normalized_name);

insert into public.school_organizations (id, owner_user_id, name)
select
  context.foreign_organization_id,
  null,
  'Organização estrangeira teste'
from verto_20260726230000_test_context context;

insert into public.schools (
  id,
  organization_id,
  display_name,
  normalized_name,
  street,
  street_number,
  city,
  state
)
select
  context.foreign_school_id,
  context.foreign_organization_id::text,
  'Escola de outro tenant teste',
  'escola de outro tenant teste',
  'Rua Outro Tenant',
  '200',
  'São Paulo',
  'SP'
from verto_20260726230000_test_context context;

-- Criação v3, consentimento e retry com resposta byte a byte equivalente em jsonb.
do $$
declare
  v_context verto_20260726230000_test_context%rowtype;
  v_payload jsonb;
  v_hash text;
  v_first jsonb;
  v_retry jsonb;
begin
  select * into v_context from verto_20260726230000_test_context;
  v_payload := jsonb_build_object(
    'schoolId', v_context.school_id,
    'enrollmentType', 'OTHER',
    'startedAt', '2026-07-26',
    'notes', 'Fixture transacional da migration',
    'consents', jsonb_build_array(
      jsonb_build_object(
        'consentType', 'SCHOOL_CONTACT',
        'status', 'AUTHORIZED',
        'grantedAt', '2026-07-26T12:00:00Z'
      )
    )
  );
  v_hash := encode(digest(v_payload::text, 'sha256'), 'hex');

  v_first := public.school_save_enrollment_v3(
    v_context.actor_id,
    v_context.clinic_id,
    v_context.organization_id,
    v_context.patient_id,
    v_payload,
    v_context.enrollment_key,
    v_hash
  );
  v_retry := public.school_save_enrollment_v3(
    v_context.actor_id,
    v_context.clinic_id,
    v_context.organization_id,
    v_context.patient_id,
    v_payload,
    v_context.enrollment_key,
    v_hash
  );

  if v_first is distinct from v_retry then
    raise exception 'TEST_IDEMPOTENT_RETRY_RESPONSE_FAILED';
  end if;
  if jsonb_array_length(coalesce(v_first->'consents', '[]'::jsonb)) <> 1 then
    raise exception 'TEST_IDEMPOTENT_RETRY_CONSENTS_FAILED: %', v_first;
  end if;
  if nullif(v_first->'data'->>'id', '') is null then
    raise exception 'TEST_IDEMPOTENT_RETRY_ENROLLMENT_FAILED: %', v_first;
  end if;
  if (
    select count(*)
    from public.patient_school_enrollments enrollment
    where enrollment.id = (v_first->'data'->>'id')::uuid
      and enrollment.organization_id = v_context.organization_id::text
      and enrollment.patient_id = v_context.patient_id
  ) <> 1 then
    raise exception 'TEST_IDEMPOTENT_RETRY_DUPLICATED_ENROLLMENT';
  end if;
  if (
    select count(*)
    from public.school_consents consent
    where consent.id = (v_first->'consents'->0->>'id')::uuid
      and consent.organization_id = v_context.organization_id::text
      and consent.patient_id = v_context.patient_id
  ) <> 1 then
    raise exception 'TEST_IDEMPOTENT_RETRY_DUPLICATED_CONSENT';
  end if;
  if not exists (
    select 1
    from public.school_idempotency_records record
    where record.organization_id = v_context.organization_id::text
      and record.operation = 'SAVE_SCHOOL_ENROLLMENT_V3'
      and record.idempotency_key = v_context.enrollment_key
      and record.response_payload = v_first
  ) then
    raise exception 'TEST_IDEMPOTENT_V3_FINAL_RESPONSE_NOT_STORED';
  end if;
  if exists (
    select 1
    from public.school_idempotency_records record
    where record.organization_id = v_context.organization_id::text
      and record.operation = 'CHANGE_SCHOOL_ENROLLMENT'
      and record.idempotency_key = v_context.enrollment_key
  ) then
    raise exception 'TEST_IDEMPOTENT_V2_EXTERNAL_KEY_REUSED';
  end if;

  update verto_20260726230000_test_context
  set enrollment_hash = v_hash,
      enrollment_response = v_first;
end
$$;

-- A mesma chave com payload/hash diferente deve falhar sem efeitos adicionais.
do $$
declare
  v_context verto_20260726230000_test_context%rowtype;
  v_payload jsonb;
  v_before_enrollments bigint;
  v_before_consents bigint;
begin
  select * into v_context from verto_20260726230000_test_context;
  select count(*) into v_before_enrollments
  from public.patient_school_enrollments
  where organization_id = v_context.organization_id::text
    and patient_id = v_context.patient_id;
  select count(*) into v_before_consents
  from public.school_consents
  where organization_id = v_context.organization_id::text
    and patient_id = v_context.patient_id;

  v_payload := jsonb_build_object(
    'schoolId', v_context.school_id,
    'enrollmentType', 'OTHER',
    'notes', 'Payload deliberadamente diferente'
  );

  begin
    perform public.school_save_enrollment_v3(
      v_context.actor_id,
      v_context.clinic_id,
      v_context.organization_id,
      v_context.patient_id,
      v_payload,
      v_context.enrollment_key,
      encode(digest(v_payload::text, 'sha256'), 'hex')
    );
    raise exception 'TEST_IDEMPOTENCY_CONFLICT_NOT_RAISED';
  exception
    when others then
      if sqlerrm not like '%IDEMPOTENCY_CONFLICT%' then
        raise;
      end if;
  end;

  if v_before_enrollments <> (
    select count(*)
    from public.patient_school_enrollments
    where organization_id = v_context.organization_id::text
      and patient_id = v_context.patient_id
  ) or v_before_consents <> (
    select count(*)
    from public.school_consents
    where organization_id = v_context.organization_id::text
      and patient_id = v_context.patient_id
  ) then
    raise exception 'TEST_IDEMPOTENCY_CONFLICT_SIDE_EFFECT';
  end if;
end
$$;

-- Trigger: clínica com sala da própria clínica.
insert into public.appointments (
  id,
  organization_id,
  clinic_id,
  patient_id,
  therapist_id,
  scheduled_at,
  status,
  room_id,
  location_type,
  care_setting,
  location_snapshot,
  location_name_snapshot,
  location_source
)
select
  context.clinic_appointment_id,
  context.clinic_id,
  context.clinic_id,
  context.patient_id,
  context.actor_id,
  '2099-07-26T12:00:00Z',
  'scheduled',
  context.room_id::text,
  'clinica',
  'CLINIC',
  jsonb_build_object(
    'careSetting', 'CLINIC',
    'roomId', context.room_id,
    'roomName', 'Sala teste migration 20260726230000'
  ),
  'Sala teste migration 20260726230000',
  'CLINIC_DIRECTORY'
from verto_20260726230000_test_context context;

do $$
begin
  if not exists (
    select 1
    from public.appointments appointment
    join public.clinic_rooms room
      on room.id::text = appointment.room_id::text
     and room.clinic_id = appointment.clinic_id
    join verto_20260726230000_test_context context
      on context.clinic_appointment_id = appointment.id
    where appointment.care_setting = 'CLINIC'
  ) then
    raise exception 'TEST_CLINIC_ROOM_QUERY_FAILED';
  end if;
end
$$;

-- Trigger: online não usa sala.
insert into public.appointments (
  id,
  organization_id,
  clinic_id,
  patient_id,
  therapist_id,
  scheduled_at,
  status,
  room_id,
  location_type,
  care_setting,
  location_snapshot,
  location_name_snapshot,
  location_source
)
select
  context.online_appointment_id,
  context.clinic_id,
  context.clinic_id,
  context.patient_id,
  context.actor_id,
  '2099-07-26T13:00:00Z',
  'scheduled',
  null,
  'online',
  'ONLINE',
  jsonb_build_object('careSetting', 'ONLINE'),
  'Online',
  'ONLINE'
from verto_20260726230000_test_context context;

-- Trigger: escola vinculada ao paciente e ao tenant, sem sala.
insert into public.appointments (
  id,
  organization_id,
  clinic_id,
  patient_id,
  therapist_id,
  scheduled_at,
  status,
  room_id,
  location_type,
  care_setting,
  school_id,
  location_snapshot,
  location_name_snapshot,
  location_address_snapshot,
  location_source
)
select
  context.school_appointment_id,
  context.clinic_id,
  context.clinic_id,
  context.patient_id,
  context.actor_id,
  '2099-07-26T14:00:00Z',
  'scheduled',
  null,
  'escola',
  'SCHOOL',
  context.school_id,
  jsonb_build_object(
    'careSetting', 'SCHOOL',
    'schoolId', context.school_id,
    'address', jsonb_build_object(
      'street', 'Rua Escola Teste',
      'number', '100',
      'city', 'São Paulo',
      'state', 'SP'
    )
  ),
  'Escola vinculada teste',
  'Rua Escola Teste, 100 • São Paulo/SP',
  'SCHOOL_DIRECTORY'
from verto_20260726230000_test_context context;

-- Trigger: escola do tenant, mas sem vínculo atual do paciente.
do $$
declare
  v_context verto_20260726230000_test_context%rowtype;
begin
  select * into v_context from verto_20260726230000_test_context;
  begin
    insert into public.appointments (
      id, organization_id, clinic_id, patient_id, therapist_id, scheduled_at,
      status, location_type, care_setting, school_id, location_snapshot,
      location_name_snapshot, location_address_snapshot, location_source
    ) values (
      gen_random_uuid(), v_context.clinic_id, v_context.clinic_id,
      v_context.patient_id, v_context.actor_id, '2099-07-26T15:00:00Z',
      'scheduled', 'escola', 'SCHOOL', v_context.unlinked_school_id,
      jsonb_build_object('careSetting', 'SCHOOL', 'schoolId', v_context.unlinked_school_id),
      'Escola não vinculada teste', 'Rua Escola Teste, 100 • São Paulo/SP',
      'SCHOOL_DIRECTORY'
    );
    raise exception 'TEST_UNLINKED_SCHOOL_NOT_BLOCKED';
  exception
    when others then
      if sqlerrm not like '%APPOINTMENT_PATIENT_SCHOOL_LINK_REQUIRED%' then
        raise;
      end if;
  end;
end
$$;

-- Trigger: escola de outro tenant nunca pode ser associada.
do $$
declare
  v_context verto_20260726230000_test_context%rowtype;
begin
  select * into v_context from verto_20260726230000_test_context;
  begin
    insert into public.appointments (
      id, organization_id, clinic_id, patient_id, therapist_id, scheduled_at,
      status, location_type, care_setting, school_id, location_snapshot,
      location_name_snapshot, location_address_snapshot, location_source
    ) values (
      gen_random_uuid(), v_context.clinic_id, v_context.clinic_id,
      v_context.patient_id, v_context.actor_id, '2099-07-26T16:00:00Z',
      'scheduled', 'escola', 'SCHOOL', v_context.foreign_school_id,
      jsonb_build_object('careSetting', 'SCHOOL', 'schoolId', v_context.foreign_school_id),
      'Escola de outro tenant teste', 'Rua Outro Tenant, 200 • São Paulo/SP',
      'SCHOOL_DIRECTORY'
    );
    raise exception 'TEST_FOREIGN_SCHOOL_NOT_BLOCKED';
  exception
    when others then
      if sqlerrm not like '%APPOINTMENT_SCHOOL_SCOPE_MISMATCH%' then
        raise;
      end if;
  end;
end
$$;

-- Trigger: domicílio com snapshot e endereço suficiente.
insert into public.appointments (
  id,
  organization_id,
  clinic_id,
  patient_id,
  therapist_id,
  scheduled_at,
  status,
  room_id,
  location_type,
  care_setting,
  location_snapshot,
  location_name_snapshot,
  location_address_snapshot,
  location_source
)
select
  context.home_appointment_id,
  context.clinic_id,
  context.clinic_id,
  context.patient_id,
  context.actor_id,
  '2099-07-26T17:00:00Z',
  'scheduled',
  null,
  'domicilio',
  'PATIENT_HOME',
  jsonb_build_object(
    'careSetting', 'PATIENT_HOME',
    'patientId', context.patient_id,
    'address', jsonb_build_object(
      'street', 'Rua Domicílio Teste',
      'number', '300',
      'city', 'São Paulo',
      'state', 'SP'
    )
  ),
  'Domicílio teste',
  'Rua Domicílio Teste, 300 • São Paulo/SP',
  'PATIENT_PROFILE'
from verto_20260726230000_test_context context;

-- Trigger: domicílio incompleto é rejeitado.
do $$
declare
  v_context verto_20260726230000_test_context%rowtype;
begin
  select * into v_context from verto_20260726230000_test_context;
  begin
    insert into public.appointments (
      id, organization_id, clinic_id, patient_id, therapist_id, scheduled_at,
      status, location_type, care_setting, location_snapshot,
      location_name_snapshot, location_address_snapshot, location_source
    ) values (
      gen_random_uuid(), v_context.clinic_id, v_context.clinic_id,
      v_context.patient_id, v_context.actor_id, '2099-07-26T18:00:00Z',
      'scheduled', 'domicilio', 'PATIENT_HOME', '{}'::jsonb,
      'Domicílio incompleto', null, 'PATIENT_PROFILE'
    );
    raise exception 'TEST_INCOMPLETE_HOME_NOT_BLOCKED';
  exception
    when others then
      if sqlerrm not like '%APPOINTMENT_LOCATION_SNAPSHOT_REQUIRED%' then
        raise;
      end if;
  end;
end
$$;

-- Trigger: local não clínico não pode preservar room_id.
do $$
declare
  v_context verto_20260726230000_test_context%rowtype;
begin
  select * into v_context from verto_20260726230000_test_context;
  begin
    insert into public.appointments (
      id, organization_id, clinic_id, patient_id, therapist_id, scheduled_at,
      status, room_id, location_type, care_setting, location_snapshot,
      location_name_snapshot, location_source
    ) values (
      gen_random_uuid(), v_context.clinic_id, v_context.clinic_id,
      v_context.patient_id, v_context.actor_id, '2099-07-26T19:00:00Z',
      'scheduled', v_context.room_id::text, 'online', 'ONLINE',
      jsonb_build_object('careSetting', 'ONLINE'), 'Online', 'ONLINE'
    );
    raise exception 'TEST_NON_CLINIC_ROOM_NOT_BLOCKED';
  exception
    when others then
      if sqlerrm not like '%APPOINTMENT_NON_CLINIC_ROOM_FORBIDDEN%' then
        raise;
      end if;
  end;
end
$$;

-- Falha no segundo consentimento deve reverter vínculo, primeiro consentimento,
-- auditoria e todos os registros internos de idempotência da operação.
do $$
declare
  v_context verto_20260726230000_test_context%rowtype;
  v_payload jsonb;
  v_key text := 'db-test-v3-rollback-' || gen_random_uuid()::text;
  v_before_enrollments bigint;
  v_before_consents bigint;
  v_before_audits bigint;
  v_before_idempotency bigint;
begin
  select * into v_context from verto_20260726230000_test_context;
  select count(*) into v_before_enrollments
  from public.patient_school_enrollments
  where organization_id = v_context.organization_id::text
    and patient_id = v_context.patient_id;
  select count(*) into v_before_consents
  from public.school_consents
  where organization_id = v_context.organization_id::text
    and patient_id = v_context.patient_id;
  select count(*) into v_before_audits
  from public.school_audit_events
  where organization_id = v_context.organization_id::text;
  select count(*) into v_before_idempotency
  from public.school_idempotency_records
  where organization_id = v_context.organization_id::text;

  v_payload := jsonb_build_object(
    'schoolId', v_context.school_id,
    'enrollmentType', 'COURSE',
    'startedAt', '2026-07-26',
    'consents', jsonb_build_array(
      jsonb_build_object(
        'consentType', 'REPORT_SENDING',
        'status', 'AUTHORIZED'
      ),
      jsonb_build_object(
        'consentType', 'INVALID_CONSENT_FOR_ROLLBACK_TEST',
        'status', 'AUTHORIZED'
      )
    )
  );

  begin
    perform public.school_save_enrollment_v3(
      v_context.actor_id,
      v_context.clinic_id,
      v_context.organization_id,
      v_context.patient_id,
      v_payload,
      v_key,
      encode(digest(v_payload::text, 'sha256'), 'hex')
    );
    raise exception 'TEST_ROLLBACK_ERROR_NOT_RAISED';
  exception
    when others then
      if sqlerrm not like '%INVALID_CONSENT_TYPE%' then
        raise;
      end if;
  end;

  if v_before_enrollments <> (
    select count(*)
    from public.patient_school_enrollments
    where organization_id = v_context.organization_id::text
      and patient_id = v_context.patient_id
  ) then
    raise exception 'TEST_ROLLBACK_ENROLLMENT_FAILED';
  end if;
  if v_before_consents <> (
    select count(*)
    from public.school_consents
    where organization_id = v_context.organization_id::text
      and patient_id = v_context.patient_id
  ) then
    raise exception 'TEST_ROLLBACK_CONSENT_FAILED';
  end if;
  if v_before_audits <> (
    select count(*)
    from public.school_audit_events
    where organization_id = v_context.organization_id::text
  ) then
    raise exception 'TEST_ROLLBACK_AUDIT_FAILED';
  end if;
  if v_before_idempotency <> (
    select count(*)
    from public.school_idempotency_records
    where organization_id = v_context.organization_id::text
  ) then
    raise exception 'TEST_ROLLBACK_IDEMPOTENCY_FAILED';
  end if;
end
$$;

do $$
begin
  raise notice '20260726230000 database tests passed; rolling back all fixtures';
end
$$;

rollback;
