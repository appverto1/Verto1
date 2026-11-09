create table public.clinic_state (clinic_id uuid not null,rooms jsonb default '[]'::jsonb not null,appointments jsonb default '[]'::jsonb not null,protocols jsonb default '[]'::jsonb not null,specialty_settings jsonb default '{}'::jsonb not null,updated_by uuid,updated_at timestamp with time zone default now() not null,revision bigint default 0 not null,section_versions jsonb default jsonb_build_object('rooms', 0, 'appointments', 0, 'protocols', 0, 'specialtySettings', 0) not null,section_mutation_keys jsonb default '{}'::jsonb not null,primary key(clinic_id));
CREATE OR REPLACE FUNCTION public.verto_save_clinic_state_sections(p_clinic_id uuid, p_updated_by uuid, p_expected_section_versions jsonb DEFAULT '{}'::jsonb, p_rooms jsonb DEFAULT NULL::jsonb, p_appointments jsonb DEFAULT NULL::jsonb, p_protocols jsonb DEFAULT NULL::jsonb, p_specialty_settings jsonb DEFAULT NULL::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;