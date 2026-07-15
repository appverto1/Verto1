-- Reserves one authorization unit and persists the appointment billing context
-- in the same database transaction. The appointment context is the durable
-- reservation record, uniquely scoped by organization and appointment.

create index if not exists idx_appointment_billing_contexts_tiss_authorization
  on public.appointment_billing_contexts (
    organization_id,
    patient_id,
    (coalesce(
      metadata ->> 'patient_tiss_authorization_id',
      metadata ->> 'patientTissAuthorizationId',
      metadata #>> '{tiss_authorization,authorizationId}',
      metadata #>> '{tissAuthorization,authorizationId}'
    ))
  );

create index if not exists idx_appointment_tiss_pre_guides_authorization
  on public.appointment_tiss_pre_guides (
    organization_id,
    patient_id,
    (coalesce(
      snapshot_data #>> '{authorization,authorizationId}',
      snapshot_data #>> '{authorization,id}'
    ))
  );

create or replace function public.reserve_tiss_authorization_billing_context(
  p_organization_id uuid,
  p_appointment_id uuid,
  p_patient_id uuid,
  p_authorization_id uuid,
  p_context jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_authorization public.patient_payer_authorizations%rowtype;
  v_appointment public.appointments%rowtype;
  v_context public.appointment_billing_contexts%rowtype;
  v_existing_context public.appointment_billing_contexts%rowtype;
  v_future_commitments integer := 0;
  v_historical_official_commitments integer := 0;
  v_reserved integer := 0;
  v_final_reserved integer := 0;
  v_authorized integer := 0;
  v_consumed integer := 0;
  v_final_available integer;
  v_context_payer_id uuid;
  v_context_organization_id uuid;
  v_context_patient_id uuid;
  v_context_service_catalog_id uuid;
  v_context_mapping_id uuid;
  v_context_tuss_code_id uuid;
  v_existing_authorization_id uuid;
  v_context_procedure_code text;
  v_authorization_procedure_code text;
  v_context_metadata jsonb;
  v_expected_previous_authorization_id uuid;
  v_appointment_start timestamptz;
  v_appointment_date date;
  v_requested_timezone text;
  v_timezone text := 'America/Sao_Paulo';
  v_idempotent boolean := false;
begin
  if p_context is null or jsonb_typeof(p_context) <> 'object' then
    raise exception using errcode = '22023', message = 'TISS_AUTHORIZATION_CONTEXT_INVALID';
  end if;

  v_context_organization_id := nullif(p_context ->> 'organization_id', '')::uuid;
  v_context_patient_id := nullif(p_context ->> 'patient_id', '')::uuid;
  if v_context_organization_id is distinct from p_organization_id
     or v_context_patient_id is distinct from p_patient_id then
    raise exception using errcode = 'P0001', message = 'TISS_AUTHORIZATION_CONTEXT_SCOPE_INVALID';
  end if;

  if lower(coalesce(p_context #>> '{metadata,schema_probe}', 'false')) = 'true' then
    return jsonb_build_object(
      'compatible', true,
      'schema_version', '20260715120000',
      'rpc', 'reserve_tiss_authorization_billing_context'
    );
  end if;

  -- This row is the serialization lock for every reservation of this authorization.
  select *
    into v_authorization
    from public.patient_payer_authorizations
   where id = p_authorization_id
     and organization_id = p_organization_id
     and clinic_id = p_organization_id
     and patient_id = p_patient_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'TISS_AUTHORIZATION_SCOPE_INVALID';
  end if;

  if v_authorization.active is false
     or lower(coalesce(v_authorization.status, 'active')) <> 'active' then
    raise exception using errcode = 'P0001', message = 'TISS_AUTHORIZATION_INACTIVE';
  end if;

  perform 1
    from public.clinic_payers payer
   where payer.id = v_authorization.payer_id
     and payer.organization_id = p_organization_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'TISS_AUTHORIZATION_PAYER_SCOPE_INVALID';
  end if;

  select *
    into v_appointment
    from public.appointments
   where id = p_appointment_id
     and patient_id = p_patient_id
     and (organization_id = p_organization_id or clinic_id = p_organization_id)
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'TISS_APPOINTMENT_SCOPE_INVALID';
  end if;

  if lower(coalesce(v_appointment.status, 'scheduled')) in
     ('cancelled', 'canceled', 'deleted', 'refused', 'completed')
     or coalesce(v_appointment.is_active, true) is false
     or v_appointment.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'TISS_APPOINTMENT_NOT_RESERVABLE';
  end if;

  v_appointment_start := coalesce(v_appointment.scheduled_start_at, v_appointment.scheduled_at);
  if v_appointment_start is null then
    raise exception using errcode = 'P0001', message = 'TISS_APPOINTMENT_DATE_MISSING';
  end if;

  v_requested_timezone := nullif(p_context #>> '{metadata,clinic_timezone}', '');
  if v_requested_timezone is not null then
    select name into v_timezone
      from pg_timezone_names
     where name = v_requested_timezone
     limit 1;
    v_timezone := coalesce(v_timezone, 'America/Sao_Paulo');
  end if;
  v_appointment_date := timezone(v_timezone, v_appointment_start)::date;

  if v_authorization.valid_from is not null and v_appointment_date < v_authorization.valid_from then
    raise exception using errcode = 'P0001', message = 'TISS_AUTHORIZATION_NOT_YET_VALID';
  end if;
  if v_authorization.valid_until is not null and v_appointment_date > v_authorization.valid_until then
    raise exception using errcode = 'P0001', message = 'TISS_AUTHORIZATION_EXPIRED';
  end if;

  v_context_payer_id := nullif(p_context ->> 'payer_id', '')::uuid;
  if v_context_payer_id is null or v_context_payer_id <> v_authorization.payer_id then
    raise exception using errcode = 'P0001', message = 'TISS_AUTHORIZATION_PAYER_MISMATCH';
  end if;

  v_context_service_catalog_id := nullif(coalesce(
    p_context #>> '{metadata,tiss_authorization,serviceCatalogId}',
    p_context #>> '{metadata,tiss_authorization,service_catalog_id}'
  ), '')::uuid;
  v_context_mapping_id := nullif(coalesce(
    p_context #>> '{metadata,tiss_authorization,payerTussMappingId}',
    p_context #>> '{metadata,tiss_authorization,payer_tuss_mapping_id}'
  ), '')::uuid;
  v_context_tuss_code_id := nullif(coalesce(
    p_context #>> '{metadata,tiss_authorization,tussCodeId}',
    p_context #>> '{metadata,tiss_authorization,tuss_code_id}'
  ), '')::uuid;

  if v_authorization.service_catalog_id is not null
     and v_context_service_catalog_id is not null
     and v_authorization.service_catalog_id <> v_context_service_catalog_id then
    raise exception using errcode = 'P0001', message = 'TISS_AUTHORIZATION_PROCEDURE_MISMATCH';
  end if;
  if v_authorization.payer_tuss_mapping_id is not null
     and v_context_mapping_id is not null
     and v_authorization.payer_tuss_mapping_id <> v_context_mapping_id then
    raise exception using errcode = 'P0001', message = 'TISS_AUTHORIZATION_PROCEDURE_MISMATCH';
  end if;
  if v_authorization.tuss_code_id is not null
     and v_context_tuss_code_id is not null
     and v_authorization.tuss_code_id <> v_context_tuss_code_id then
    raise exception using errcode = 'P0001', message = 'TISS_AUTHORIZATION_PROCEDURE_MISMATCH';
  end if;

  v_context_procedure_code := upper(nullif(trim(p_context ->> 'procedure_code'), ''));
  v_authorization_procedure_code := upper(coalesce(
    nullif(trim(v_authorization.procedure_tuss_code), ''),
    nullif(trim(v_authorization.procedure_code_snapshot), ''),
    nullif(trim(v_authorization.procedure_code), '')
  ));
  if v_context_service_catalog_id is null
     and v_context_mapping_id is null
     and v_context_tuss_code_id is null
     and v_context_procedure_code is not null
     and v_authorization_procedure_code is not null
     and v_context_procedure_code <> v_authorization_procedure_code then
    raise exception using errcode = 'P0001', message = 'TISS_AUTHORIZATION_PROCEDURE_MISMATCH';
  end if;

  select *
    into v_existing_context
    from public.appointment_billing_contexts context_row
   where context_row.organization_id = p_organization_id
     and context_row.appointment_id = p_appointment_id
   for update;

  if found then
    v_existing_authorization_id := nullif(coalesce(
      v_existing_context.metadata ->> 'patient_tiss_authorization_id',
      v_existing_context.metadata ->> 'patientTissAuthorizationId',
      v_existing_context.metadata #>> '{tiss_authorization,authorizationId}',
      v_existing_context.metadata #>> '{tissAuthorization,authorizationId}'
    ), '')::uuid;
    v_idempotent := v_existing_authorization_id = p_authorization_id;
  end if;

  v_expected_previous_authorization_id := nullif(coalesce(
    p_context #>> '{metadata,expected_previous_authorization_id}',
    p_context #>> '{metadata,expectedPreviousAuthorizationId}'
  ), '')::uuid;
  if v_existing_authorization_id is distinct from v_expected_previous_authorization_id
     and not v_idempotent then
    raise exception using errcode = '40001', message = 'TISS_AUTHORIZATION_CONTEXT_CHANGED';
  end if;

  with commitment_candidates as (
      select context_row.appointment_id,
             true as is_future,
             false as is_historical_official
        from public.appointment_billing_contexts context_row
        join public.appointments appointment_row
          on appointment_row.id = context_row.appointment_id
         and (appointment_row.organization_id = p_organization_id or appointment_row.clinic_id = p_organization_id)
       where context_row.organization_id = p_organization_id
         and context_row.patient_id = p_patient_id
         and context_row.appointment_id <> p_appointment_id
         and coalesce(
           context_row.metadata ->> 'patient_tiss_authorization_id',
           context_row.metadata ->> 'patientTissAuthorizationId',
           context_row.metadata #>> '{tiss_authorization,authorizationId}',
           context_row.metadata #>> '{tissAuthorization,authorizationId}'
         ) = p_authorization_id::text
         and lower(coalesce(appointment_row.status, 'pending')) not in
             ('cancelled', 'canceled', 'deleted', 'refused')
         and coalesce(appointment_row.is_active, true) is true
         and appointment_row.deleted_at is null
         and coalesce(appointment_row.scheduled_start_at, appointment_row.scheduled_at) >= now()
      union all
      select pre_guide.appointment_id,
             coalesce(pre_guide.scheduled_start >= now(), false) as is_future,
             pre_guide.official_document_id is not null
               and coalesce(pre_guide.scheduled_start < now(), true) as is_historical_official
        from public.appointment_tiss_pre_guides pre_guide
       where pre_guide.organization_id = p_organization_id
         and pre_guide.patient_id = p_patient_id
         and pre_guide.appointment_id <> p_appointment_id
         and coalesce(
           pre_guide.snapshot_data #>> '{authorization,authorizationId}',
           pre_guide.snapshot_data #>> '{authorization,id}'
         ) = p_authorization_id::text
         and lower(coalesce(pre_guide.status, 'pending_data')) not in
             ('cancelled', 'canceled', 'deleted', 'refused')
         and (pre_guide.official_document_id is not null or pre_guide.scheduled_start >= now())
  ), commitments as (
    select appointment_id,
           bool_or(is_future) as is_future,
           bool_or(is_historical_official) as is_historical_official
      from commitment_candidates
     group by appointment_id
  )
  select count(*) filter (where is_future)::integer,
         count(*) filter (where not is_future and is_historical_official)::integer
    into v_future_commitments, v_historical_official_commitments
    from commitments;

  v_authorized := greatest(0, coalesce(v_authorization.authorized_quantity, 0));
  v_consumed := greatest(0, coalesce(v_authorization.used_quantity, 0));
  v_reserved := greatest(0, v_future_commitments)
    + greatest(0, v_historical_official_commitments - v_consumed);

  if v_authorized > 0 and (v_consumed + v_reserved) >= v_authorized then
    raise exception using errcode = 'P0001', message = 'TISS_AUTHORIZATION_NO_AVAILABLE_BALANCE';
  end if;

  v_final_reserved := v_reserved + 1;
  v_final_available := case
    when v_authorized > 0 then greatest(0, v_authorized - v_consumed - v_final_reserved)
    else null
  end;
  v_context_metadata := coalesce(p_context -> 'metadata', '{}'::jsonb);
  if jsonb_typeof(v_context_metadata) <> 'object' then
    v_context_metadata := '{}'::jsonb;
  end if;
  if jsonb_typeof(v_context_metadata -> 'tiss_authorization') = 'object' then
    v_context_metadata := jsonb_set(
      v_context_metadata,
      '{tiss_authorization}',
      (v_context_metadata -> 'tiss_authorization') || jsonb_build_object(
        'quantityAuthorized', v_authorized,
        'quantityConsumed', v_consumed,
        'quantityReserved', v_final_reserved,
        'quantityAvailable', v_final_available,
        'balance', v_final_available
      ),
      true
    );
  end if;
  v_context_metadata := jsonb_set(
    v_context_metadata,
    '{authorization_balance}',
    jsonb_build_object(
      'authorized', v_authorized,
      'consumed', v_consumed,
      'reserved', v_final_reserved,
      'available', v_final_available
    ),
    true
  );

  insert into public.appointment_billing_contexts (
    id,
    organization_id,
    appointment_id,
    patient_id,
    payer_id,
    payer_type,
    payer_name_snapshot,
    service_type,
    insurance_card_number,
    insurance_plan_name,
    authorization_code,
    guide_number,
    procedure_code,
    notes,
    source,
    metadata,
    created_by,
    updated_by,
    created_at,
    updated_at
  ) values (
    coalesce(nullif(p_context ->> 'id', '')::uuid, gen_random_uuid()),
    p_organization_id,
    p_appointment_id,
    p_patient_id,
    v_context_payer_id,
    nullif(p_context ->> 'payer_type', ''),
    nullif(p_context ->> 'payer_name_snapshot', ''),
    nullif(p_context ->> 'service_type', ''),
    nullif(p_context ->> 'insurance_card_number', ''),
    nullif(p_context ->> 'insurance_plan_name', ''),
    nullif(p_context ->> 'authorization_code', ''),
    nullif(p_context ->> 'guide_number', ''),
    nullif(p_context ->> 'procedure_code', ''),
    nullif(p_context ->> 'notes', ''),
    'PATIENT_TISS_AUTHORIZATION',
    v_context_metadata,
    nullif(p_context ->> 'created_by', '')::uuid,
    nullif(p_context ->> 'updated_by', '')::uuid,
    coalesce(nullif(p_context ->> 'created_at', '')::timestamptz, now()),
    now()
  )
  on conflict (organization_id, appointment_id) do update set
    patient_id = excluded.patient_id,
    payer_id = excluded.payer_id,
    payer_type = excluded.payer_type,
    payer_name_snapshot = excluded.payer_name_snapshot,
    service_type = excluded.service_type,
    insurance_card_number = excluded.insurance_card_number,
    insurance_plan_name = excluded.insurance_plan_name,
    authorization_code = excluded.authorization_code,
    guide_number = excluded.guide_number,
    procedure_code = excluded.procedure_code,
    notes = excluded.notes,
    source = excluded.source,
    metadata = excluded.metadata,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into v_context;

  return jsonb_build_object(
    'billing_context', to_jsonb(v_context),
    'authorization_balance', jsonb_build_object(
      'authorized', v_authorized,
      'consumed', v_consumed,
      'reserved', v_final_reserved,
      'available', v_final_available
    ),
    'idempotent', v_idempotent
  );
end;
$$;

revoke all on function public.reserve_tiss_authorization_billing_context(uuid, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.reserve_tiss_authorization_billing_context(uuid, uuid, uuid, uuid, jsonb) from anon;
revoke all on function public.reserve_tiss_authorization_billing_context(uuid, uuid, uuid, uuid, jsonb) from authenticated;
grant execute on function public.reserve_tiss_authorization_billing_context(uuid, uuid, uuid, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
