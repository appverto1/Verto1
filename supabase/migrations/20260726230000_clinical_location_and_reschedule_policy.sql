-- Verto: vínculo escolar editável, local clínico estruturado e política de reagendamento.
-- Migration aditiva, idempotente e posterior às migrations escolares já publicadas.
-- Não remove nem reinterpreta dados históricos.

begin;

alter table if exists public.clinics
  add column if not exists allow_patient_reschedule boolean;

update public.clinics
set allow_patient_reschedule = true
where allow_patient_reschedule is null;

alter table if exists public.clinics
  alter column allow_patient_reschedule set default true,
  alter column allow_patient_reschedule set not null;

create table if not exists public.clinic_policy_audit_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  organization_id uuid,
  actor_id uuid not null references public.users(id) on delete restrict,
  policy_key text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  reason text,
  idempotency_key text not null,
  payload_hash text not null,
  created_at timestamptz not null default now(),
  unique (clinic_id, idempotency_key)
);

create index if not exists clinic_policy_audit_events_clinic_created_idx
  on public.clinic_policy_audit_events (clinic_id, created_at desc);

alter table public.clinic_policy_audit_events enable row level security;

drop policy if exists clinic_policy_audit_events_select on public.clinic_policy_audit_events;
create policy clinic_policy_audit_events_select
on public.clinic_policy_audit_events
for select
to authenticated
using (
  exists (
    select 1
    from public.clinics clinic
    left join public.clinic_memberships membership
      on membership.clinic_id = clinic.id
     and membership.user_id = auth.uid()
     and lower(coalesce(membership.status, 'active')) = 'active'
    left join public.users actor
      on actor.id = auth.uid()
    where clinic.id = clinic_policy_audit_events.clinic_id
      and (
        clinic.owner_user_id = auth.uid()
        or lower(coalesce(membership.role, '')) in ('owner', 'admin', 'coordinator')
        or (
          actor.clinic_id = clinic.id
          and lower(coalesce(actor.role, '')) in ('owner', 'admin', 'coordinator')
        )
      )
  )
);

revoke insert, update, delete on public.clinic_policy_audit_events from anon, authenticated;
grant select on public.clinic_policy_audit_events to authenticated, service_role;

create or replace function public.set_clinic_patient_reschedule_policy_v1(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_allow_patient_reschedule boolean,
  p_reason text,
  p_idempotency_key text,
  p_payload_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before boolean;
  v_existing public.clinic_policy_audit_events%rowtype;
  v_organization_id uuid;
  v_response jsonb;
begin
  if auth.uid() is not null and auth.uid() <> p_actor_id then
    raise exception 'CLINIC_POLICY_ACTOR_MISMATCH';
  end if;
  if p_actor_id is null or p_clinic_id is null or p_allow_patient_reschedule is null then
    raise exception 'CLINIC_POLICY_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null
     or nullif(trim(coalesce(p_payload_hash, '')), '') is null then
    raise exception 'CLINIC_POLICY_IDEMPOTENCY_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.clinics clinic
    left join public.clinic_memberships membership
      on membership.clinic_id = clinic.id
     and membership.user_id = p_actor_id
     and lower(coalesce(membership.status, 'active')) = 'active'
    left join public.users actor
      on actor.id = p_actor_id
    where clinic.id = p_clinic_id
      and (
        clinic.owner_user_id = p_actor_id
        or lower(coalesce(membership.role, '')) in ('owner', 'admin', 'coordinator')
        or (
          actor.clinic_id = clinic.id
          and lower(coalesce(actor.role, '')) in ('owner', 'admin', 'coordinator')
        )
      )
  ) then
    raise exception 'CLINIC_POLICY_ACCESS_DENIED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('clinic-policy:' || p_clinic_id::text, 0));

  select audit.*
  into v_existing
  from public.clinic_policy_audit_events audit
  where audit.clinic_id = p_clinic_id
    and audit.idempotency_key = p_idempotency_key
  limit 1;

  if found then
    if v_existing.payload_hash <> p_payload_hash then
      raise exception 'CLINIC_POLICY_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'success', true,
      'data', jsonb_build_object(
        'clinicId', p_clinic_id,
        'allowPatientReschedule', coalesce((v_existing.after_state->>'allowPatientReschedule')::boolean, true),
        'updatedAt', v_existing.created_at
      ),
      'idempotentReplay', true
    );
  end if;

  select
    clinic.allow_patient_reschedule,
    coalesce(clinic.school_organization_id, clinic.id)
  into v_before, v_organization_id
  from public.clinics clinic
  where clinic.id = p_clinic_id
  for update;

  if not found then
    raise exception 'CLINIC_POLICY_CLINIC_NOT_FOUND';
  end if;

  update public.clinics
  set allow_patient_reschedule = p_allow_patient_reschedule,
      updated_at = now()
  where id = p_clinic_id;

  insert into public.clinic_policy_audit_events (
    clinic_id,
    organization_id,
    actor_id,
    policy_key,
    before_state,
    after_state,
    reason,
    idempotency_key,
    payload_hash
  ) values (
    p_clinic_id,
    v_organization_id,
    p_actor_id,
    'ALLOW_PATIENT_RESCHEDULE',
    jsonb_build_object('allowPatientReschedule', coalesce(v_before, true)),
    jsonb_build_object('allowPatientReschedule', p_allow_patient_reschedule),
    left(nullif(trim(coalesce(p_reason, '')), ''), 1000),
    left(p_idempotency_key, 180),
    left(p_payload_hash, 128)
  );

  v_response := jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'clinicId', p_clinic_id,
      'allowPatientReschedule', p_allow_patient_reschedule,
      'updatedAt', now()
    ),
    'idempotentReplay', false
  );
  return v_response;
end;
$$;

revoke all on function public.set_clinic_patient_reschedule_policy_v1(uuid,uuid,boolean,text,text,text)
  from public, anon, authenticated;
grant execute on function public.set_clinic_patient_reschedule_policy_v1(uuid,uuid,boolean,text,text,text)
  to service_role;

alter table if exists public.appointments
  add column if not exists care_setting text,
  add column if not exists school_id uuid references public.schools(id) on delete restrict,
  add column if not exists school_unit_id uuid references public.school_units(id) on delete restrict,
  add column if not exists location_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists location_name_snapshot text,
  add column if not exists location_address_snapshot text,
  add column if not exists location_source text,
  add column if not exists location_timezone text not null default 'America/Sao_Paulo';

do $$
begin
  if to_regclass('public.appointments') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.appointments'::regclass
         and conname = 'appointments_care_setting_check'
     ) then
    alter table public.appointments
      add constraint appointments_care_setting_check
      check (
        care_setting is null
        or care_setting in ('CLINIC', 'ONLINE', 'PATIENT_HOME', 'SCHOOL', 'OTHER')
      ) not valid;
  end if;

  if to_regclass('public.appointments') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.appointments'::regclass
         and conname = 'appointments_location_source_check'
     ) then
    alter table public.appointments
      add constraint appointments_location_source_check
      check (
        location_source is null
        or location_source in (
          'CLINIC_DIRECTORY',
          'ONLINE',
          'PATIENT_PROFILE',
          'SCHOOL_DIRECTORY',
          'MANUAL',
          'LEGACY'
        )
      ) not valid;
  end if;
end
$$;

-- Backfill estritamente conservador: somente valores enum-like já usados pela Verto.
update public.appointments
set
  care_setting = case lower(trim(coalesce(location_type, '')))
    when 'clinica' then 'CLINIC'
    when 'clinic' then 'CLINIC'
    when 'online' then 'ONLINE'
    when 'domicilio' then 'PATIENT_HOME'
    when 'patient_home' then 'PATIENT_HOME'
    when 'escola' then 'SCHOOL'
    when 'school' then 'SCHOOL'
    when 'outro' then 'OTHER'
    when 'other' then 'OTHER'
    else null
  end,
  location_source = case
    when lower(trim(coalesce(location_type, ''))) in ('clinica', 'clinic') then 'CLINIC_DIRECTORY'
    when lower(trim(coalesce(location_type, ''))) = 'online' then 'ONLINE'
    when lower(trim(coalesce(location_type, ''))) in ('domicilio', 'patient_home') then 'LEGACY'
    when lower(trim(coalesce(location_type, ''))) in ('escola', 'school') then 'LEGACY'
    when lower(trim(coalesce(location_type, ''))) in ('outro', 'other') then 'LEGACY'
    else coalesce(location_source, 'LEGACY')
  end
where care_setting is null;

create index if not exists appointments_clinic_care_setting_scheduled_idx
  on public.appointments (clinic_id, care_setting, scheduled_at)
  where deleted_at is null;

create index if not exists appointments_school_scheduled_idx
  on public.appointments (organization_id, school_id, school_unit_id, scheduled_at)
  where school_id is not null and deleted_at is null;

-- Diagnóstico não destrutivo criado antes da ativação do trigger. As linhas
-- legadas continuam consultáveis; a correção só é exigida quando o local é
-- efetivamente alterado por uma rota canônica do backend.
create or replace view public.appointment_location_legacy_diagnostics_v1
with (security_invoker = true)
as
select
  appointment.id as appointment_id,
  appointment.clinic_id,
  appointment.care_setting,
  appointment.scheduled_at,
  'CLINIC_WITHOUT_ROOM'::text as diagnostic_code,
  jsonb_build_object(
    'roomIdPresent', false,
    'locationSource', appointment.location_source
  ) as diagnostic_context
from public.appointments appointment
where appointment.care_setting = 'CLINIC'
  and nullif(trim(coalesce(appointment.room_id::text, '')), '') is null

union all

select
  appointment.id,
  appointment.clinic_id,
  appointment.care_setting,
  appointment.scheduled_at,
  'NON_CLINIC_WITH_ROOM'::text,
  jsonb_build_object(
    'roomIdPresent', true,
    'locationSource', appointment.location_source
  )
from public.appointments appointment
where appointment.care_setting is not null
  and appointment.care_setting <> 'CLINIC'
  and nullif(trim(coalesce(appointment.room_id::text, '')), '') is not null

union all

select
  appointment.id,
  appointment.clinic_id,
  appointment.care_setting,
  appointment.scheduled_at,
  'SCHOOL_WITHOUT_SCHOOL'::text,
  jsonb_build_object(
    'schoolIdPresent', false,
    'schoolUnitIdPresent', appointment.school_unit_id is not null,
    'locationSource', appointment.location_source
  )
from public.appointments appointment
where appointment.care_setting = 'SCHOOL'
  and appointment.school_id is null

union all

select
  appointment.id,
  appointment.clinic_id,
  appointment.care_setting,
  appointment.scheduled_at,
  'STRUCTURED_LOCATION_WITHOUT_SNAPSHOT'::text,
  jsonb_build_object(
    'snapshotPresent', appointment.location_snapshot <> '{}'::jsonb,
    'addressSnapshotPresent',
      nullif(trim(coalesce(appointment.location_address_snapshot, '')), '') is not null,
    'locationSource', appointment.location_source
  )
from public.appointments appointment
where appointment.care_setting in ('SCHOOL', 'PATIENT_HOME')
  and (
    appointment.location_snapshot = '{}'::jsonb
    or nullif(trim(coalesce(appointment.location_address_snapshot, '')), '') is null
  )

union all

select
  null::uuid as appointment_id,
  clinic.id as clinic_id,
  null::text as care_setting,
  null::timestamptz as scheduled_at,
  'CLINIC_WITHOUT_SCHOOL_ORGANIZATION'::text as diagnostic_code,
  jsonb_build_object('schoolOrganizationLinked', false) as diagnostic_context
from public.clinics clinic
where clinic.school_organization_id is null;

revoke all on public.appointment_location_legacy_diagnostics_v1
  from public, anon, authenticated;
grant select on public.appointment_location_legacy_diagnostics_v1
  to service_role;

-- Executa a auditoria antes de criar o trigger e publica somente contadores no
-- log da migration. Os identificadores permanecem disponíveis na view acima,
-- sob RLS das tabelas de origem.
do $$
declare
  v_clinic_without_room bigint;
  v_non_clinic_with_room bigint;
  v_school_without_school bigint;
  v_structured_without_snapshot bigint;
  v_clinic_without_school_organization bigint;
begin
  select
    count(*) filter (
      where appointment.care_setting = 'CLINIC'
        and nullif(trim(coalesce(appointment.room_id::text, '')), '') is null
    ),
    count(*) filter (
      where appointment.care_setting is not null
        and appointment.care_setting <> 'CLINIC'
        and nullif(trim(coalesce(appointment.room_id::text, '')), '') is not null
    ),
    count(*) filter (
      where appointment.care_setting = 'SCHOOL'
        and appointment.school_id is null
    ),
    count(*) filter (
      where appointment.care_setting in ('SCHOOL', 'PATIENT_HOME')
        and (
          appointment.location_snapshot = '{}'::jsonb
          or nullif(trim(coalesce(appointment.location_address_snapshot, '')), '') is null
        )
    )
  into
    v_clinic_without_room,
    v_non_clinic_with_room,
    v_school_without_school,
    v_structured_without_snapshot
  from public.appointments appointment;

  select count(*)
  into v_clinic_without_school_organization
  from public.clinics clinic
  where clinic.school_organization_id is null;

  raise notice
    'appointment location legacy audit: clinic_without_room=%, non_clinic_with_room=%, school_without_school=%, structured_without_snapshot=%, clinic_without_school_organization=%',
    v_clinic_without_room,
    v_non_clinic_with_room,
    v_school_without_school,
    v_structured_without_snapshot,
    v_clinic_without_school_organization;
end
$$;

create or replace function public.validate_appointment_structured_location_v1()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_school_organization_id text;
begin
  if new.care_setting is null then
    return new;
  end if;

  -- O trigger não reinterpreta nem bloqueia uma linha histórica incompatível
  -- quando seu contexto de local não mudou. Inserções e alterações reais do
  -- local precisam satisfazer integralmente as regras abaixo.
  if tg_op = 'UPDATE'
     and new.clinic_id is not distinct from old.clinic_id
     and new.patient_id is not distinct from old.patient_id
     and new.care_setting is not distinct from old.care_setting
     and new.room_id is not distinct from old.room_id
     and new.school_id is not distinct from old.school_id
     and new.school_unit_id is not distinct from old.school_unit_id
     and new.location_snapshot is not distinct from old.location_snapshot
     and new.location_address_snapshot is not distinct from old.location_address_snapshot then
    return new;
  end if;

  if new.care_setting = 'CLINIC' and nullif(trim(coalesce(new.room_id::text, '')), '') is null then
    raise exception 'APPOINTMENT_CLINIC_ROOM_REQUIRED';
  end if;

  if new.care_setting = 'CLINIC' and not exists (
    select 1
    from public.clinic_rooms room
    where room.id::text = new.room_id::text
      and room.clinic_id = new.clinic_id
      and room.is_active
  ) then
    raise exception 'APPOINTMENT_CLINIC_ROOM_SCOPE_MISMATCH';
  end if;

  if new.care_setting <> 'CLINIC' and nullif(trim(coalesce(new.room_id::text, '')), '') is not null then
    raise exception 'APPOINTMENT_NON_CLINIC_ROOM_FORBIDDEN';
  end if;

  if new.care_setting = 'SCHOOL' then
    if new.school_id is null then
      raise exception 'APPOINTMENT_SCHOOL_REQUIRED';
    end if;
    select clinic.school_organization_id::text
    into v_school_organization_id
    from public.clinics clinic
    where clinic.id = new.clinic_id;

    if v_school_organization_id is null then
      raise exception 'APPOINTMENT_CLINIC_SCHOOL_ORGANIZATION_REQUIRED';
    end if;

    if not exists (
      select 1
      from public.schools school
      where school.id = new.school_id
        and school.organization_id = v_school_organization_id
        and school.is_active
        and school.archived_at is null
    ) then
      raise exception 'APPOINTMENT_SCHOOL_SCOPE_MISMATCH';
    end if;
    if new.school_unit_id is not null and not exists (
      select 1
      from public.school_units unit
      where unit.id = new.school_unit_id
        and unit.school_id = new.school_id
        and unit.organization_id = v_school_organization_id
        and unit.is_active
        and unit.archived_at is null
    ) then
      raise exception 'APPOINTMENT_SCHOOL_UNIT_SCOPE_MISMATCH';
    end if;
    if new.school_unit_id is null and exists (
      select 1
      from public.school_units unit
      where unit.school_id = new.school_id
        and unit.organization_id = v_school_organization_id
        and unit.is_active
        and unit.archived_at is null
    ) then
      raise exception 'APPOINTMENT_SCHOOL_UNIT_REQUIRED';
    end if;
    if not exists (
      select 1
      from public.patient_school_enrollments enrollment
      where enrollment.patient_id = new.patient_id
        and enrollment.clinic_id = new.clinic_id::text
        and enrollment.organization_id = v_school_organization_id
        and enrollment.school_id = new.school_id
        and enrollment.is_current
        and (
          new.school_unit_id is null
          or enrollment.school_unit_id = new.school_unit_id
        )
    ) then
      raise exception 'APPOINTMENT_PATIENT_SCHOOL_LINK_REQUIRED';
    end if;
  elsif new.school_id is not null or new.school_unit_id is not null then
    raise exception 'APPOINTMENT_SCHOOL_CONTEXT_FORBIDDEN';
  end if;

  if new.care_setting in ('SCHOOL', 'PATIENT_HOME')
     and (
       new.location_snapshot = '{}'::jsonb
       or nullif(trim(coalesce(new.location_address_snapshot, '')), '') is null
     ) then
    raise exception 'APPOINTMENT_LOCATION_SNAPSHOT_REQUIRED';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_structured_location_guard on public.appointments;
create trigger appointments_structured_location_guard
before insert or update of
  care_setting,
  clinic_id,
  patient_id,
  room_id,
  school_id,
  school_unit_id,
  location_snapshot,
  location_address_snapshot
on public.appointments
for each row
execute function public.validate_appointment_structured_location_v1();

alter table if exists public.aba_sessions
  add column if not exists care_setting text,
  add column if not exists school_id uuid references public.schools(id) on delete restrict,
  add column if not exists school_unit_id uuid references public.school_units(id) on delete restrict,
  add column if not exists location_name_snapshot text,
  add column if not exists location_context_snapshot jsonb not null default '{}'::jsonb;

alter table if exists public.aba_session_summaries
  add column if not exists care_setting text,
  add column if not exists location_name_snapshot text,
  add column if not exists location_context_snapshot jsonb not null default '{}'::jsonb;

do $$
begin
  if to_regclass('public.aba_sessions') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.aba_sessions'::regclass
         and conname = 'aba_sessions_care_setting_check'
     ) then
    alter table public.aba_sessions
      add constraint aba_sessions_care_setting_check
      check (
        care_setting is null
        or care_setting in ('CLINIC', 'ONLINE', 'PATIENT_HOME', 'SCHOOL', 'OTHER')
      ) not valid;
  end if;

  if to_regclass('public.aba_session_summaries') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.aba_session_summaries'::regclass
         and conname = 'aba_session_summaries_care_setting_check'
     ) then
    alter table public.aba_session_summaries
      add constraint aba_session_summaries_care_setting_check
      check (
        care_setting is null
        or care_setting in ('CLINIC', 'ONLINE', 'PATIENT_HOME', 'SCHOOL', 'OTHER')
      ) not valid;
  end if;
end
$$;

-- Evolui a operação canônica. Criação/troca continua delegando à RPC v2
-- transacional já publicada; edição e consentimentos passam pelo mesmo entrypoint.
create or replace function public.school_save_enrollment_v3(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_organization_id uuid,
  p_patient_id uuid,
  p_payload jsonb,
  p_idempotency_key text,
  p_payload_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment_id uuid := nullif(p_payload->>'enrollmentId', '')::uuid;
  v_existing jsonb;
  v_before public.patient_school_enrollments%rowtype;
  v_after public.patient_school_enrollments%rowtype;
  v_response jsonb;
  v_consent jsonb;
  v_consent_payload jsonb;
  v_consent_result jsonb;
  v_consents jsonb := '[]'::jsonb;
  v_consent_index integer := 0;
  v_internal_idempotency_key text;
  v_school uuid;
  v_unit uuid;
  v_teacher uuid;
  v_coordinator uuid;
  v_type text;
  v_close boolean;
begin
  if not public.school_actor_has_role(
    p_actor_id,
    p_clinic_id,
    p_organization_id,
    array['owner', 'admin', 'coordinator', 'receptionist']
  ) then
    raise exception 'ACCESS_DENIED';
  end if;
  if not public.school_actor_can_access_patient(p_actor_id, p_clinic_id, p_patient_id) then
    raise exception 'PATIENT_ACCESS_DENIED';
  end if;

  -- A v3 é a operação idempotente externa para criação e edição. O lock e a
  -- leitura acontecem antes de qualquer efeito da v2 ou dos consentimentos.
  v_existing := public.school_idempotency_existing(
    p_organization_id::text,
    'SAVE_SCHOOL_ENROLLMENT_V3',
    p_idempotency_key,
    p_payload_hash
  );
  if v_existing is not null then
    return v_existing;
  end if;

  if v_enrollment_id is null then
    v_school := nullif(p_payload->>'schoolId', '')::uuid;
    v_unit := nullif(p_payload->>'schoolUnitId', '')::uuid;
    if v_school is not null
       and v_unit is null
       and exists (
         select 1
         from public.school_units unit
         where unit.school_id = v_school
           and unit.organization_id = p_organization_id::text
           and unit.is_active
           and unit.archived_at is null
       ) then
      raise exception 'SCHOOL_UNIT_REQUIRED';
    end if;
    v_internal_idempotency_key := 'v3-enrollment:' || encode(
      digest(
        p_organization_id::text || ':' || p_idempotency_key || ':CHANGE_SCHOOL_ENROLLMENT',
        'sha256'
      ),
      'hex'
    );
    v_response := public.school_change_enrollment_v2(
      p_actor_id,
      p_clinic_id,
      p_organization_id,
      p_patient_id,
      p_payload,
      v_internal_idempotency_key,
      p_payload_hash
    );
    v_enrollment_id := nullif(v_response->'data'->>'id', '')::uuid;
  else
    perform pg_advisory_xact_lock(
      hashtextextended(p_organization_id::text || ':ENROLLMENT:' || p_patient_id::text, 0)
    );

    select *
    into v_before
    from public.patient_school_enrollments enrollment
    where enrollment.id = v_enrollment_id
      and enrollment.organization_id = p_organization_id::text
      and enrollment.clinic_id = p_clinic_id::text
      and enrollment.patient_id = p_patient_id
    for update;

    if not found then
      raise exception 'SCHOOL_ENROLLMENT_NOT_FOUND';
    end if;
    if p_payload ? 'schoolId'
       and nullif(p_payload->>'schoolId', '')::uuid is distinct from v_before.school_id then
      raise exception 'SCHOOL_CHANGE_REQUIRES_NEW_ENROLLMENT';
    end if;

    v_unit := case
      when p_payload ? 'schoolUnitId' then nullif(p_payload->>'schoolUnitId', '')::uuid
      else v_before.school_unit_id
    end;
    v_teacher := case
      when p_payload ? 'teacherContactId' then nullif(p_payload->>'teacherContactId', '')::uuid
      else v_before.teacher_contact_id
    end;
    v_coordinator := case
      when p_payload ? 'coordinatorContactId' then nullif(p_payload->>'coordinatorContactId', '')::uuid
      else v_before.coordinator_contact_id
    end;
    v_type := case
      when p_payload ? 'enrollmentType' then upper(p_payload->>'enrollmentType')
      else v_before.enrollment_type
    end;
    v_close := coalesce((p_payload->>'closeCurrent')::boolean, false);

    if v_type not in (
      'PRIMARY_SCHOOL',
      'SECONDARY_SCHOOL',
      'SUPPORT_INSTITUTION',
      'HOME_EDUCATION',
      'COURSE',
      'OTHER'
    ) then
      raise exception 'INVALID_ENROLLMENT_TYPE';
    end if;
    if v_unit is not null and not exists (
      select 1 from public.school_units unit
      where unit.id = v_unit
        and unit.school_id = v_before.school_id
        and unit.organization_id = p_organization_id::text
        and unit.is_active
        and unit.archived_at is null
    ) then
      raise exception 'SCHOOL_UNIT_NOT_FOUND';
    end if;
    if v_unit is null and exists (
      select 1
      from public.school_units unit
      where unit.school_id = v_before.school_id
        and unit.organization_id = p_organization_id::text
        and unit.is_active
        and unit.archived_at is null
    ) then
      raise exception 'SCHOOL_UNIT_REQUIRED';
    end if;
    if v_teacher is not null and not exists (
      select 1 from public.school_contacts contact
      where contact.id = v_teacher
        and contact.school_id = v_before.school_id
        and contact.organization_id = p_organization_id::text
        and contact.is_active
        and contact.archived_at is null
    ) then
      raise exception 'TEACHER_CONTACT_INVALID';
    end if;
    if v_coordinator is not null and not exists (
      select 1 from public.school_contacts contact
      where contact.id = v_coordinator
        and contact.school_id = v_before.school_id
        and contact.organization_id = p_organization_id::text
        and contact.is_active
        and contact.archived_at is null
    ) then
      raise exception 'COORDINATOR_CONTACT_INVALID';
    end if;

    if v_type = 'PRIMARY_SCHOOL' and exists (
      select 1
      from public.patient_school_enrollments enrollment
      where enrollment.organization_id = p_organization_id::text
        and enrollment.patient_id = p_patient_id
        and enrollment.id <> v_enrollment_id
        and enrollment.is_current
        and enrollment.enrollment_type = 'PRIMARY_SCHOOL'
    ) then
      if not v_close then
        raise exception 'PRIMARY_ENROLLMENT_EXISTS';
      end if;
      update public.patient_school_enrollments
      set is_current = false,
          ended_at = coalesce(ended_at, now()),
          ended_by = p_actor_id::text,
          exit_reason = coalesce(
            nullif(p_payload->>'exitReason', ''),
            'Substituído por alteração do vínculo principal'
          ),
          updated_by = p_actor_id::text,
          updated_at = now()
      where organization_id = p_organization_id::text
        and patient_id = p_patient_id
        and id <> v_enrollment_id
        and is_current
        and enrollment_type = 'PRIMARY_SCHOOL';
    end if;

    update public.patient_school_enrollments
    set school_unit_id = v_unit,
        academic_year = case
          when p_payload ? 'academicYear' then nullif(p_payload->>'academicYear', '')::integer
          else academic_year
        end,
        grade_level = case
          when p_payload ? 'gradeLevel' then left(nullif(trim(p_payload->>'gradeLevel'), ''), 120)
          else grade_level
        end,
        class_name = case
          when p_payload ? 'className' then left(nullif(trim(p_payload->>'className'), ''), 120)
          else class_name
        end,
        shift = case
          when p_payload ? 'shift' then nullif(upper(p_payload->>'shift'), '')
          else shift
        end,
        enrollment_code = case
          when p_payload ? 'enrollmentCode' then left(nullif(trim(p_payload->>'enrollmentCode'), ''), 120)
          else enrollment_code
        end,
        teacher_contact_id = v_teacher,
        coordinator_contact_id = v_coordinator,
        started_at = case
          when p_payload ? 'startedAt' then nullif(p_payload->>'startedAt', '')::date
          else started_at
        end,
        notes = case
          when p_payload ? 'notes' then left(nullif(p_payload->>'notes', ''), 4000)
          else notes
        end,
        enrollment_type = v_type,
        updated_by = p_actor_id::text,
        updated_at = now()
    where id = v_enrollment_id
    returning * into v_after;

    perform public.school_audit_append(
      p_organization_id::text,
      p_clinic_id,
      p_actor_id,
      'PATIENT_SCHOOL_ENROLLMENT',
      v_after.id::text,
      'SCHOOL_ENROLLMENT_UPDATED',
      to_jsonb(v_before),
      to_jsonb(v_after),
      p_payload->>'reason',
      p_idempotency_key || ':audit'
    );

    v_response := jsonb_build_object('success', true, 'data', to_jsonb(v_after));
  end if;

  for v_consent in
    select value
    from jsonb_array_elements(coalesce(p_payload->'consents', '[]'::jsonb))
  loop
    v_consent_index := v_consent_index + 1;
    v_consent_payload := v_consent || jsonb_build_object(
      'schoolEnrollmentId', v_enrollment_id
    );
    v_internal_idempotency_key := 'v3-consent:' || encode(
      digest(
        p_organization_id::text
          || ':' || p_idempotency_key
          || ':' || v_consent_index::text
          || ':' || upper(coalesce(v_consent->>'consentType', 'UNKNOWN')),
        'sha256'
      ),
      'hex'
    );
    v_consent_result := public.school_record_consent_v2(
      p_actor_id,
      p_clinic_id,
      p_organization_id,
      p_patient_id,
      v_consent_payload,
      v_internal_idempotency_key,
      encode(digest(v_consent_payload::text, 'sha256'), 'hex')
    );
    v_consents := v_consents || jsonb_build_array(v_consent_result->'data');
  end loop;

  v_response := v_response || jsonb_build_object(
    'consents', v_consents,
    'idempotentReplay', false
  );

  perform public.school_idempotency_store(
    p_organization_id::text,
    'SAVE_SCHOOL_ENROLLMENT_V3',
    p_idempotency_key,
    p_payload_hash,
    'PATIENT_SCHOOL_ENROLLMENT',
    v_enrollment_id::text,
    v_response
  );
  return v_response;
end;
$$;

revoke all on function public.school_save_enrollment_v3(uuid,uuid,uuid,uuid,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.school_save_enrollment_v3(uuid,uuid,uuid,uuid,jsonb,text,text)
  to service_role;

create or replace view public.appointment_care_setting_backfill_summary_v1
with (security_invoker = true)
as
select
  count(*)::bigint as appointments_analyzed,
  count(*) filter (where care_setting = 'CLINIC')::bigint as clinic,
  count(*) filter (where care_setting = 'ONLINE')::bigint as online,
  count(*) filter (where care_setting = 'SCHOOL' and school_id is not null)::bigint as school_recoverable,
  count(*) filter (where care_setting = 'PATIENT_HOME' and location_address_snapshot is not null)::bigint as patient_home_recoverable,
  count(*) filter (where care_setting is null or location_source = 'LEGACY')::bigint as unresolved_legacy,
  count(*) filter (
    where care_setting in ('SCHOOL', 'PATIENT_HOME')
      and nullif(trim(coalesce(location_address_snapshot, '')), '') is null
  )::bigint as missing_address,
  0::bigint as errors,
  count(*) filter (
    where care_setting = 'CLINIC'
      and nullif(trim(coalesce(room_id::text, '')), '') is null
  )::bigint as clinic_without_room,
  count(*) filter (
    where care_setting is not null
      and care_setting <> 'CLINIC'
      and nullif(trim(coalesce(room_id::text, '')), '') is not null
  )::bigint as non_clinic_with_room,
  count(*) filter (
    where care_setting = 'SCHOOL'
      and school_id is null
  )::bigint as school_without_school_id,
  count(*) filter (
    where care_setting in ('SCHOOL', 'PATIENT_HOME')
      and (
        location_snapshot = '{}'::jsonb
        or nullif(trim(coalesce(location_address_snapshot, '')), '') is null
      )
  )::bigint as structured_location_without_snapshot,
  (
    select count(*)::bigint
    from public.clinics clinic
    where clinic.school_organization_id is null
  ) as clinics_without_school_organization
from public.appointments;

revoke all on public.appointment_care_setting_backfill_summary_v1
  from public, anon, authenticated;
grant select on public.appointment_care_setting_backfill_summary_v1
  to service_role;

commit;
