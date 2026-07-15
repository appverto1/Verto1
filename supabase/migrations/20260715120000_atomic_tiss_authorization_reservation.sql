-- Reserva autorização e grava o contexto da consulta na mesma transação.
-- A função é restrita ao backend (service_role); as políticas RLS existentes
-- continuam sendo a barreira para todas as leituras e escritas do cliente.

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
  v_future_commitments integer := 0;
  v_historical_official_commitments integer := 0;
  v_reserved integer := 0;
  v_authorized integer := 0;
  v_consumed integer := 0;
  v_context_payer_id uuid;
begin
  if p_context is null or jsonb_typeof(p_context) <> 'object' then
    raise exception using errcode = '22023', message = 'TISS_AUTHORIZATION_CONTEXT_INVALID';
  end if;

  -- A linha da autorização é o lock serializador para todas as reservas dela.
  select *
    into v_authorization
    from public.patient_payer_authorizations
   where id = p_authorization_id
     and organization_id = p_organization_id
     and patient_id = p_patient_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'TISS_AUTHORIZATION_SCOPE_INVALID';
  end if;

  if v_authorization.active is false or lower(coalesce(v_authorization.status, 'active')) <> 'active' then
    raise exception using errcode = 'P0001', message = 'TISS_AUTHORIZATION_INACTIVE';
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

  v_context_payer_id := nullif(p_context ->> 'payer_id', '')::uuid;
  if v_context_payer_id is null or v_context_payer_id <> v_authorization.payer_id then
    raise exception using errcode = 'P0001', message = 'TISS_AUTHORIZATION_PAYER_MISMATCH';
  end if;

  with commitment_candidates as (
      select context_row.appointment_id
           , true as is_future
           , false as is_historical_official
        from public.appointment_billing_contexts context_row
        join public.appointments appointment_row on appointment_row.id = context_row.appointment_id
       where context_row.organization_id = p_organization_id
         and context_row.patient_id = p_patient_id
         and context_row.appointment_id <> p_appointment_id
         and coalesce(
           context_row.metadata ->> 'patient_tiss_authorization_id',
           context_row.metadata ->> 'patientTissAuthorizationId',
           context_row.metadata #>> '{tiss_authorization,authorizationId}',
           context_row.metadata #>> '{tissAuthorization,authorizationId}'
         ) = p_authorization_id::text
         and lower(coalesce(appointment_row.status, 'pending')) not in ('cancelled', 'canceled', 'deleted', 'refused')
         and coalesce(appointment_row.scheduled_start_at, appointment_row.scheduled_at) >= now()
      union all
      select pre_guide.appointment_id
           , coalesce(pre_guide.scheduled_start >= now(), false) as is_future
           , pre_guide.official_document_id is not null
             and coalesce(pre_guide.scheduled_start < now(), true) as is_historical_official
        from public.appointment_tiss_pre_guides pre_guide
       where pre_guide.organization_id = p_organization_id
         and pre_guide.patient_id = p_patient_id
         and pre_guide.appointment_id <> p_appointment_id
         and coalesce(
           pre_guide.snapshot_data #>> '{authorization,authorizationId}',
           pre_guide.snapshot_data #>> '{authorization,id}'
         ) = p_authorization_id::text
         and lower(coalesce(pre_guide.status, 'pending_data')) not in ('cancelled', 'canceled', 'deleted', 'refused')
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
    coalesce(p_context -> 'metadata', '{}'::jsonb),
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

  return to_jsonb(v_context);
end;
$$;

revoke all on function public.reserve_tiss_authorization_billing_context(uuid, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.reserve_tiss_authorization_billing_context(uuid, uuid, uuid, uuid, jsonb) from anon;
revoke all on function public.reserve_tiss_authorization_billing_context(uuid, uuid, uuid, uuid, jsonb) from authenticated;
grant execute on function public.reserve_tiss_authorization_billing_context(uuid, uuid, uuid, uuid, jsonb) to service_role;
