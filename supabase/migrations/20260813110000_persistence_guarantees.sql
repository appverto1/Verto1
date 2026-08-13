-- Verto persistence guarantees
-- Apply manually in Supabase SQL Editor before deploying the application code.
-- Adds section-level optimistic concurrency for clinic_state and an atomic
-- patient + encrypted patient_record mutation primitive.

begin;

alter table public.clinic_state
  add column if not exists revision bigint not null default 0;

alter table public.clinic_state
  add column if not exists section_versions jsonb not null default jsonb_build_object(
    'rooms', 0,
    'appointments', 0,
    'protocols', 0,
    'specialtySettings', 0
  );

alter table public.clinic_state
  add column if not exists section_mutation_keys jsonb not null default '{}'::jsonb;

create table if not exists public.verto_persistence_mutation_receipts (
  idempotency_key text primary key,
  mutation_scope text not null,
  clinic_id uuid not null,
  entity_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.verto_persistence_mutation_receipts enable row level security;
revoke all on table public.verto_persistence_mutation_receipts from public, anon, authenticated;
grant select, insert, delete on table public.verto_persistence_mutation_receipts to service_role;

create index if not exists verto_persistence_mutation_receipts_created_at_idx
  on public.verto_persistence_mutation_receipts (created_at);

update public.clinic_state
set section_versions = jsonb_build_object(
  'rooms', coalesce((section_versions ->> 'rooms')::bigint, 0),
  'appointments', coalesce((section_versions ->> 'appointments')::bigint, 0),
  'protocols', coalesce((section_versions ->> 'protocols')::bigint, 0),
  'specialtySettings', coalesce((section_versions ->> 'specialtySettings')::bigint, 0)
)
where section_versions is null
   or jsonb_typeof(section_versions) <> 'object';

drop function if exists public.verto_save_clinic_state_sections(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb);

create or replace function public.verto_save_clinic_state_sections(
  p_clinic_id uuid,
  p_updated_by uuid,
  p_expected_section_versions jsonb default '{}'::jsonb,
  p_rooms jsonb default null,
  p_appointments jsonb default null,
  p_protocols jsonb default null,
  p_specialty_settings jsonb default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.clinic_state%rowtype;
  v_versions jsonb;
  v_mutation_keys jsonb;
  v_expected bigint;
  v_current bigint;
  v_conflict_section text;
begin
  if p_clinic_id is null then
    raise exception 'clinic_id is required' using errcode = '22023';
  end if;

  insert into public.clinic_state (
    clinic_id,
    rooms,
    appointments,
    protocols,
    specialty_settings,
    updated_by,
    updated_at,
    revision,
    section_versions,
    section_mutation_keys
  )
  values (
    p_clinic_id,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '{}'::jsonb,
    p_updated_by,
    now(),
    0,
    jsonb_build_object('rooms', 0, 'appointments', 0, 'protocols', 0, 'specialtySettings', 0),
    '{}'::jsonb
  )
  on conflict (clinic_id) do nothing;

  select *
    into v_state
  from public.clinic_state
  where clinic_id = p_clinic_id
  for update;

  if not found then
    raise exception 'clinic_state not found after initialization' using errcode = 'P0002';
  end if;

  v_versions := coalesce(v_state.section_versions, '{}'::jsonb);
  v_mutation_keys := coalesce(v_state.section_mutation_keys, '{}'::jsonb);

  -- A retry after a lost HTTP response must acknowledge the already committed
  -- mutation rather than turning it into a false concurrency conflict.
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is not null
     and (p_rooms is null or v_mutation_keys ->> 'rooms' = p_idempotency_key)
     and (p_appointments is null or v_mutation_keys ->> 'appointments' = p_idempotency_key)
     and (p_protocols is null or v_mutation_keys ->> 'protocols' = p_idempotency_key)
     and (p_specialty_settings is null or v_mutation_keys ->> 'specialtySettings' = p_idempotency_key) then
    return jsonb_build_object(
      'success', true,
      'idempotent', true,
      'data', jsonb_build_object(
        'clinicId', v_state.clinic_id,
        'rooms', coalesce(v_state.rooms, '[]'::jsonb),
        'appointments', coalesce(v_state.appointments, '[]'::jsonb),
        'protocols', coalesce(v_state.protocols, '[]'::jsonb),
        'specialtySettings', coalesce(v_state.specialty_settings, '{}'::jsonb),
        'updatedAt', v_state.updated_at,
        'revision', coalesce(v_state.revision, 0),
        'sectionVersions', v_versions
      )
    );
  end if;

  if p_rooms is not null then
    v_current := coalesce((v_versions ->> 'rooms')::bigint, 0);
    v_expected := coalesce((p_expected_section_versions ->> 'rooms')::bigint, v_current);
    if v_expected <> v_current then v_conflict_section := 'rooms'; end if;
  end if;

  if v_conflict_section is null and p_appointments is not null then
    v_current := coalesce((v_versions ->> 'appointments')::bigint, 0);
    v_expected := coalesce((p_expected_section_versions ->> 'appointments')::bigint, v_current);
    if v_expected <> v_current then v_conflict_section := 'appointments'; end if;
  end if;

  if v_conflict_section is null and p_protocols is not null then
    v_current := coalesce((v_versions ->> 'protocols')::bigint, 0);
    v_expected := coalesce((p_expected_section_versions ->> 'protocols')::bigint, v_current);
    if v_expected <> v_current then v_conflict_section := 'protocols'; end if;
  end if;

  if v_conflict_section is null and p_specialty_settings is not null then
    v_current := coalesce((v_versions ->> 'specialtySettings')::bigint, 0);
    v_expected := coalesce((p_expected_section_versions ->> 'specialtySettings')::bigint, v_current);
    if v_expected <> v_current then v_conflict_section := 'specialtySettings'; end if;
  end if;

  if v_conflict_section is not null then
    return jsonb_build_object(
      'success', false,
      'conflict', true,
      'section', v_conflict_section,
      'revision', coalesce(v_state.revision, 0),
      'sectionVersions', v_versions
    );
  end if;

  if p_rooms is not null then
    v_versions := jsonb_set(
      v_versions,
      '{rooms}',
      to_jsonb(coalesce((v_versions ->> 'rooms')::bigint, 0) + 1),
      true
    );
  end if;
  if p_appointments is not null then
    v_versions := jsonb_set(
      v_versions,
      '{appointments}',
      to_jsonb(coalesce((v_versions ->> 'appointments')::bigint, 0) + 1),
      true
    );
  end if;
  if p_protocols is not null then
    v_versions := jsonb_set(
      v_versions,
      '{protocols}',
      to_jsonb(coalesce((v_versions ->> 'protocols')::bigint, 0) + 1),
      true
    );
  end if;
  if p_specialty_settings is not null then
    v_versions := jsonb_set(
      v_versions,
      '{specialtySettings}',
      to_jsonb(coalesce((v_versions ->> 'specialtySettings')::bigint, 0) + 1),
      true
    );
  end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is not null then
    if p_rooms is not null then v_mutation_keys := jsonb_set(v_mutation_keys, '{rooms}', to_jsonb(p_idempotency_key), true); end if;
    if p_appointments is not null then v_mutation_keys := jsonb_set(v_mutation_keys, '{appointments}', to_jsonb(p_idempotency_key), true); end if;
    if p_protocols is not null then v_mutation_keys := jsonb_set(v_mutation_keys, '{protocols}', to_jsonb(p_idempotency_key), true); end if;
    if p_specialty_settings is not null then v_mutation_keys := jsonb_set(v_mutation_keys, '{specialtySettings}', to_jsonb(p_idempotency_key), true); end if;
  end if;

  update public.clinic_state
  set rooms = coalesce(p_rooms, rooms),
      appointments = coalesce(p_appointments, appointments),
      protocols = coalesce(p_protocols, protocols),
      specialty_settings = coalesce(p_specialty_settings, specialty_settings),
      updated_by = p_updated_by,
      updated_at = now(),
      revision = coalesce(revision, 0) + 1,
      section_versions = v_versions,
      section_mutation_keys = v_mutation_keys
  where clinic_id = p_clinic_id
  returning * into v_state;

  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'clinicId', v_state.clinic_id,
      'rooms', coalesce(v_state.rooms, '[]'::jsonb),
      'appointments', coalesce(v_state.appointments, '[]'::jsonb),
      'protocols', coalesce(v_state.protocols, '[]'::jsonb),
      'specialtySettings', coalesce(v_state.specialty_settings, '{}'::jsonb),
      'updatedAt', v_state.updated_at,
      'revision', coalesce(v_state.revision, 0),
      'sectionVersions', coalesce(v_state.section_versions, '{}'::jsonb)
    )
  );
end;
$$;

create or replace function public.verto_create_patient_aggregate_atomic(
  p_patient jsonb,
  p_patient_record jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed_columns constant text[] := array[
    'id', 'name', 'email', 'cpf', 'phone', 'age', 'diagnosis',
    'patient_profile_type', 'panel_type', 'profile_type', 'type',
    'social_name', 'birth_date', 'gender',
    'insurance_payer_id', 'insurance_type', 'insurance_name',
    'insurance_card_number', 'insurance_card_valid_until', 'insurance_plan_category',
    'insurance_holder_name', 'insurance_holder_cpf', 'insurance_holder_relationship',
    'eligibility_notes', 'patient_group', 'lead_source', 'notes', 'rg', 'cep',
    'responsible_name', 'responsible_birth_date', 'responsible_cpf',
    'responsible_phone', 'responsible_email', 'responsible_relationship',
    'metadata', 'status', 'clinic_id', 'therapist_id',
    'onboarding_status', 'anamnesis_required', 'anamnesis_requested_at',
    'anamnesis_submitted_at', 'anamnesis_reviewed_at', 'relationship_status',
    'is_demo', 'client_record_id', 'created_at', 'updated_at'
  ];
  v_key text;
  v_columns text := '';
  v_values text := '';
  v_inserted_patient jsonb;
  v_record public.patient_records%rowtype;
  v_patient_id uuid;
  v_clinic_id uuid;
begin
  if p_patient is null or jsonb_typeof(p_patient) <> 'object' then
    raise exception 'patient must be a JSON object' using errcode = '22023';
  end if;

  v_patient_id := nullif(p_patient ->> 'id', '')::uuid;
  v_clinic_id := nullif(p_patient ->> 'clinic_id', '')::uuid;
  if v_patient_id is null or v_clinic_id is null then
    raise exception 'patient.id and patient.clinic_id are required' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(p_patient)
  loop
    if not (v_key = any(v_allowed_columns)) then
      raise exception 'patient create column not allowed: %', v_key using errcode = '22023';
    end if;
    if v_columns <> '' then
      v_columns := v_columns || ', ';
      v_values := v_values || ', ';
    end if;
    v_columns := v_columns || format('%I', v_key);
    v_values := v_values || format('(jsonb_populate_record(NULL::public.patients, $1)).%I', v_key);
  end loop;

  if v_columns = '' then
    raise exception 'patient payload is incomplete' using errcode = '22023';
  end if;

  -- Creation retries are idempotent and never replay the original create payload
  -- over a patient that may already have been edited after the first success.
  execute format(
    'insert into public.patients as inserted (%s) select %s '
    || 'on conflict (id) do nothing '
    || 'returning to_jsonb(inserted.*)',
    v_columns,
    v_values
  )
  into v_inserted_patient
  using p_patient;

  if v_inserted_patient is null then
    select to_jsonb(p.*)
      into v_inserted_patient
    from public.patients p
    where p.id = v_patient_id
      and p.clinic_id = v_clinic_id
    for update;

    if v_inserted_patient is null then
      raise exception 'patient id belongs to another clinic scope' using errcode = '42501';
    end if;
  end if;

  if p_patient_record is not null then
    if jsonb_typeof(p_patient_record) <> 'object' then
      raise exception 'patient_record must be a JSON object' using errcode = '22023';
    end if;

    v_record := jsonb_populate_record(NULL::public.patient_records, p_patient_record);
    if v_record.patient_id is distinct from v_patient_id or v_record.clinic_id is distinct from v_clinic_id then
      raise exception 'patient_record scope mismatch' using errcode = '22023';
    end if;

    insert into public.patient_records (
      patient_id,
      clinic_id,
      therapist_id,
      pseudonym_id,
      payload_encrypted,
      payload_preview,
      updated_at
    )
    values (
      v_record.patient_id,
      v_record.clinic_id,
      v_record.therapist_id,
      v_record.pseudonym_id,
      v_record.payload_encrypted,
      coalesce(v_record.payload_preview, '{}'::jsonb),
      coalesce(v_record.updated_at, now())
    )
    on conflict (patient_id) do nothing;

    if not found then
      perform 1
      from public.patient_records
      where patient_id = v_patient_id
        and clinic_id = v_clinic_id
      for update;
      if not found then
        raise exception 'patient_record id belongs to another clinic scope' using errcode = '42501';
      end if;
    end if;
  end if;

  return jsonb_build_object('success', true, 'data', v_inserted_patient);
end;
$$;

drop function if exists public.verto_update_patient_aggregate_atomic(uuid, uuid, jsonb, jsonb);
drop function if exists public.verto_update_patient_aggregate_atomic(uuid, uuid, jsonb, jsonb, text);

create or replace function public.verto_update_patient_aggregate_atomic(
  p_patient_id uuid,
  p_clinic_id uuid,
  p_patient_patch jsonb,
  p_patient_record jsonb default null,
  p_expected_record_ciphertext text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed_columns constant text[] := array[
    'name', 'email', 'phone', 'cpf', 'age', 'diagnosis',
    'patient_profile_type', 'panel_type', 'profile_type', 'type',
    'social_name', 'birth_date', 'gender',
    'insurance_payer_id', 'insurance_type', 'insurance_name',
    'insurance_card_number', 'insurance_card_valid_until', 'insurance_plan_category',
    'insurance_holder_name', 'insurance_holder_cpf', 'insurance_holder_relationship',
    'eligibility_notes', 'patient_group', 'lead_source', 'notes', 'rg', 'cep',
    'responsible_name', 'responsible_birth_date', 'responsible_cpf',
    'responsible_phone', 'responsible_email', 'responsible_relationship',
    'metadata', 'profile_picture', 'profile_picture_path',
    'therapist_id', 'clinic_id', 'status'
  ];
  v_key text;
  v_set_clause text := '';
  v_updated_patient jsonb;
  v_record public.patient_records%rowtype;
  v_existing_record_ciphertext text;
  v_record_exists boolean := false;
  v_receipt public.verto_persistence_mutation_receipts%rowtype;
begin
  if p_patient_id is null or p_clinic_id is null then
    raise exception 'patient_id and clinic_id are required' using errcode = '22023';
  end if;
  if p_patient_patch is null or jsonb_typeof(p_patient_patch) <> 'object' then
    p_patient_patch := '{}'::jsonb;
  end if;

  perform 1
  from public.patients
  where id = p_patient_id
    and clinic_id = p_clinic_id
    and coalesce(is_active, true) = true
    and deleted_at is null
  for update;

  if not found then
    raise exception 'patient not found in clinic scope' using errcode = 'P0002';
  end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is not null then
    select *
      into v_receipt
    from public.verto_persistence_mutation_receipts
    where idempotency_key = p_idempotency_key;
    if found then
      if v_receipt.mutation_scope <> 'patient_aggregate'
         or v_receipt.clinic_id is distinct from p_clinic_id
         or v_receipt.entity_id is distinct from p_patient_id then
        raise exception 'idempotency key scope mismatch' using errcode = '22023';
      end if;
      select to_jsonb(p.*) into v_updated_patient
      from public.patients p
      where p.id = p_patient_id and p.clinic_id = p_clinic_id;
      return jsonb_build_object('success', true, 'idempotent', true, 'data', v_updated_patient);
    end if;
  end if;

  -- Lock and compare the encrypted record before changing either table. This
  -- prevents two concurrent read/merge/write requests from silently losing data.
  if p_patient_record is not null then
    select payload_encrypted
      into v_existing_record_ciphertext
    from public.patient_records
    where patient_id = p_patient_id
      and clinic_id = p_clinic_id
    for update;
    v_record_exists := found;

    if v_record_exists then
      if v_existing_record_ciphertext is distinct from p_expected_record_ciphertext then
        return jsonb_build_object(
          'success', false,
          'conflict', true,
          'code', 'PATIENT_RECORD_CONCURRENT_EDIT',
          'error', 'O prontuário foi alterado por outra sessão. A versão local foi preservada para reconciliação.'
        );
      end if;
    elsif p_expected_record_ciphertext is not null then
      return jsonb_build_object(
        'success', false,
        'conflict', true,
        'code', 'PATIENT_RECORD_CONCURRENT_EDIT',
        'error', 'O prontuário mudou desde a leitura original. A versão local foi preservada para reconciliação.'
      );
    end if;
  end if;

  for v_key in select jsonb_object_keys(p_patient_patch)
  loop
    if not (v_key = any(v_allowed_columns)) then
      raise exception 'patient patch column not allowed: %', v_key using errcode = '22023';
    end if;
    if v_set_clause <> '' then v_set_clause := v_set_clause || ', '; end if;
    v_set_clause := v_set_clause || format(
      '%I = (jsonb_populate_record(NULL::public.patients, $1)).%I',
      v_key,
      v_key
    );
  end loop;

  if v_set_clause <> '' then
    execute format(
      'update public.patients as updated set %s where id = $2 and clinic_id = $3 returning to_jsonb(updated.*)',
      v_set_clause
    )
    into v_updated_patient
    using p_patient_patch, p_patient_id, p_clinic_id;
  else
    select to_jsonb(p.*)
    into v_updated_patient
    from public.patients p
    where p.id = p_patient_id and p.clinic_id = p_clinic_id;
  end if;

  if v_updated_patient is null then
    raise exception 'patient update did not affect a row' using errcode = 'P0002';
  end if;

  if p_patient_record is not null then
    if jsonb_typeof(p_patient_record) <> 'object' then
      raise exception 'patient_record must be a JSON object' using errcode = '22023';
    end if;

    v_record := jsonb_populate_record(NULL::public.patient_records, p_patient_record);
    if v_record.patient_id is distinct from p_patient_id or v_record.clinic_id is distinct from p_clinic_id then
      raise exception 'patient_record scope mismatch' using errcode = '22023';
    end if;

    insert into public.patient_records (
      patient_id,
      clinic_id,
      therapist_id,
      pseudonym_id,
      payload_encrypted,
      payload_preview,
      updated_at
    )
    values (
      v_record.patient_id,
      v_record.clinic_id,
      v_record.therapist_id,
      v_record.pseudonym_id,
      v_record.payload_encrypted,
      coalesce(v_record.payload_preview, '{}'::jsonb),
      coalesce(v_record.updated_at, now())
    )
    on conflict (patient_id) do update
    set clinic_id = excluded.clinic_id,
        therapist_id = excluded.therapist_id,
        pseudonym_id = excluded.pseudonym_id,
        payload_encrypted = excluded.payload_encrypted,
        payload_preview = excluded.payload_preview,
        updated_at = excluded.updated_at;
  end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is not null then
    insert into public.verto_persistence_mutation_receipts (
      idempotency_key, mutation_scope, clinic_id, entity_id
    ) values (
      p_idempotency_key, 'patient_aggregate', p_clinic_id, p_patient_id
    )
    on conflict (idempotency_key) do nothing;

    -- Keep the receipt table bounded without adding a per-request cleanup query.
    -- The indexed sweep runs only occasionally and retains a generous retry window.
    if random() < 0.01 then
      delete from public.verto_persistence_mutation_receipts
      where created_at < now() - interval '30 days';
    end if;
  end if;

  return jsonb_build_object('success', true, 'data', v_updated_patient);
end;
$$;

revoke all on function public.verto_save_clinic_state_sections(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.verto_save_clinic_state_sections(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) to service_role;

revoke all on function public.verto_create_patient_aggregate_atomic(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.verto_create_patient_aggregate_atomic(jsonb, jsonb) to service_role;

revoke all on function public.verto_update_patient_aggregate_atomic(uuid, uuid, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.verto_update_patient_aggregate_atomic(uuid, uuid, jsonb, jsonb, text, text) to service_role;

commit;
