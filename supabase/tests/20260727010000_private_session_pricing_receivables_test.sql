-- Real PostgreSQL integration test for private-session pricing and receivables.
-- Prerequisite: migrations through 20260727010000 are applied.
-- The script uses existing tenant fixtures, creates isolated rows and rolls
-- everything back. No production data survives this test.

begin;

do $test$
declare
  v_table text;
  v_role text;
  v_signature text;
  v_pgcrypto_schema text;
  v_proconfig text[];
begin
  select namespace.nspname
  into v_pgcrypto_schema
  from pg_catalog.pg_extension extension
  join pg_catalog.pg_namespace namespace
    on namespace.oid = extension.extnamespace
  where extension.extname = 'pgcrypto';

  if v_pgcrypto_schema is null then
    raise exception 'TEST_FAILED: pgcrypto extension is not installed';
  end if;
  if v_pgcrypto_schema <> 'extensions' then
    raise exception 'TEST_FAILED: pgcrypto is installed in schema %, expected extensions', v_pgcrypto_schema;
  end if;

  perform extensions.digest(convert_to('verto-private-pricing', 'UTF8'), 'sha256');

  foreach v_table in array array[
    'private_session_price_rules',
    'patient_private_pricing_agreements',
    'appointment_private_financial_snapshots',
    'private_financial_idempotency_requests',
    'private_session_finance_diagnostics_v1'
  ] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_table_privilege(v_role, 'public.' || v_table, 'SELECT') then
        raise exception 'TEST_FAILED: % unexpectedly has SELECT on %', v_role, v_table;
      end if;
    end loop;
    if not has_table_privilege('service_role', 'public.' || v_table, 'SELECT') then
      raise exception 'TEST_FAILED: service_role lacks SELECT on %', v_table;
    end if;
  end loop;

  foreach v_signature in array array[
    'public.resolve_private_session_price_v1(uuid,uuid,text,uuid,timestamptz,text,numeric,numeric,text,text,uuid)',
    'public.resolve_private_session_prices_v1(uuid,jsonb,uuid)',
    'public.save_private_session_price_rule_v1(uuid,jsonb,text,uuid)',
    'public.save_patient_private_pricing_agreement_v1(uuid,uuid,jsonb,text,uuid)',
    'public.apply_private_patient_financial_operation_v2(uuid,text,text,numeric,date,text,timestamptz,text,text,text,text,text,text)',
    'public.patient_financial_charge_payload(text)'
  ] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_signature, 'EXECUTE') then
        raise exception 'TEST_FAILED: % unexpectedly has EXECUTE on %', v_role, v_signature;
      end if;
    end loop;
    if not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'TEST_FAILED: service_role lacks EXECUTE on %', v_signature;
    end if;
  end loop;

  foreach v_signature in array array[
    'public.save_private_session_price_rule_v1(uuid,jsonb,text,uuid)',
    'public.save_patient_private_pricing_agreement_v1(uuid,uuid,jsonb,text,uuid)',
    'public.apply_private_patient_financial_operation_v2(uuid,text,text,numeric,date,text,timestamptz,text,text,text,text,text,text)'
  ] loop
    select routine.proconfig
    into v_proconfig
    from pg_catalog.pg_proc routine
    where routine.oid = v_signature::regprocedure;

    if not exists (
      select 1
      from unnest(coalesce(v_proconfig, array[]::text[])) as config(setting)
      where replace(lower(setting), ' ', '') = 'search_path=public,extensions'
    ) then
      raise exception 'TEST_FAILED: % does not use search_path public, extensions (proconfig=%)', v_signature, v_proconfig;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    where relation.oid in (
      'public.private_session_price_rules'::regclass,
      'public.patient_private_pricing_agreements'::regclass,
      'public.appointment_private_financial_snapshots'::regclass,
      'public.private_financial_idempotency_requests'::regclass
    )
      and not relation.relrowsecurity
  ) then
    raise exception 'TEST_FAILED: RLS is not enabled on all private financial tables';
  end if;
end;
$test$;

do $test$
declare
  v_organization_id uuid;
  v_actor_id uuid;
  v_patient_id uuid;
  v_therapist_id uuid;
  v_service_id uuid;
  v_room_id uuid;
  v_school_id uuid;
  v_school_unit_id uuid;
  v_specialty text := 'Codex private pricing test ' || substr(gen_random_uuid()::text, 1, 8);
  v_default jsonb;
  v_specialty_rule jsonb;
  v_service_rule jsonb;
  v_agreement jsonb;
  v_resolution jsonb;
  v_replay jsonb;
  v_zero jsonb;
  v_appointment_id uuid := gen_random_uuid();
  v_second_appointment_id uuid := gen_random_uuid();
  v_home_appointment_id uuid := gen_random_uuid();
  v_late_appointment_id uuid := gen_random_uuid();
  v_no_show_appointment_id uuid := gen_random_uuid();
  v_manual_cancel_appointment_id uuid := gen_random_uuid();
  v_manual_no_show_appointment_id uuid := gen_random_uuid();
  v_recurrence_group uuid := gen_random_uuid();
  v_manual_specialty text := 'Codex manual policy test ' || substr(gen_random_uuid()::text, 1, 8);
  v_payment_id text;
  v_second_payment_id text;
  v_snapshot_id uuid;
  v_operation jsonb;
  v_count integer;
  v_failed boolean;
  v_scheduled_at timestamptz := date_trunc('minute', now() + interval '3 days');
begin
  select actor.clinic_id, actor.id
  into v_organization_id, v_actor_id
  from public.users actor
  where lower(actor.role) in ('owner', 'admin')
    and actor.clinic_id is not null
  order by case lower(actor.role) when 'owner' then 1 else 2 end
  limit 1;
  if v_organization_id is null or v_actor_id is null then
    raise exception 'TEST_FIXTURE_REQUIRED: owner/admin with clinic_id';
  end if;
  if not exists (
    select 1
    from public.clinics clinic
    where clinic.id = v_organization_id
  ) then
    raise exception 'TEST_FAILED: organization_id % is not a public.clinics(id)', v_organization_id;
  end if;

  select patient.id
  into v_patient_id
  from public.patients patient
  where patient.clinic_id = v_organization_id
    and patient.deleted_at is null
    and coalesce(patient.is_active, true)
    and not exists (
      select 1
      from public.patient_financial_plans plan
      where plan.organization_id = v_organization_id
        and plan.patient_id = patient.id
        and plan.status = 'ACTIVE'
        and plan.billing_mode = 'PRIVATE'
        and coalesce(plan.quantity_period, 'SESSION') = 'SESSION'
        and plan.amount_cents > 0
    )
  limit 1;
  if v_patient_id is null then
    raise exception 'TEST_FIXTURE_REQUIRED: active patient without legacy private plan in clinic %', v_organization_id;
  end if;

  select actor.id
  into v_therapist_id
  from public.users actor
  where actor.clinic_id = v_organization_id
  order by case when lower(actor.role) = 'therapist' then 1 else 2 end
  limit 1;
  if v_therapist_id is null then
    raise exception 'TEST_FIXTURE_REQUIRED: professional user in clinic %', v_organization_id;
  end if;

  select room.id
  into v_room_id
  from public.clinic_rooms room
  where room.clinic_id = v_organization_id
    and room.is_active
  limit 1;
  if v_room_id is null then
    raise exception 'TEST_FIXTURE_REQUIRED: active clinic room in clinic %', v_organization_id;
  end if;

  if public.private_session_policy_amount_v1(
       jsonb_build_object('type', 'PERCENTAGE', 'value', 50), 180
     ) <> 90
     or public.private_session_policy_amount_v1(
       jsonb_build_object('type', 'FIXED', 'value', 40), 180
     ) <> 40
     or public.private_session_policy_amount_v1(
       jsonb_build_object('type', 'NO_CHARGE', 'value', 0), 180
     ) <> 0 then
    raise exception 'TEST_FAILED: cancellation/no-show policy amount variants';
  end if;

  select service.id
  into v_service_id
  from public.tuss_service_catalog service
  where service.organization_id = v_organization_id
    and service.active
  limit 1;

  begin
    v_default := public.save_private_session_price_rule_v1(
      v_organization_id,
      jsonb_build_object(
        'scopeType', 'CLINIC_DEFAULT',
        'baseAmount', 150,
        'defaultDurationMinutes', 60,
        'cancellationFreeValue', 12,
        'cancellationFreeUnit', 'HOURS',
        'lateCancellationType', 'PERCENTAGE',
        'lateCancellationValue', 50,
        'noShowType', 'FULL',
        'noShowValue', 100,
        'dueRule', 'SESSION_DATE',
        'allowPartialPayment', true,
        'allowManualOverride', true,
        'discountApprovalRequired', true,
        'homeSurcharge', 30,
        'schoolSurcharge', 20,
        'validFrom', current_date
      ),
      'test-default-' || gen_random_uuid()::text,
      v_actor_id
    );
  exception
    when sqlstate '42883' then
      raise exception 'TEST_FAILED: save_private_session_price_rule_v1 raised SQLSTATE 42883';
  end;
  if (v_default->>'base_amount')::numeric <> 150 then
    raise exception 'TEST_FAILED: clinic default';
  end if;

  v_resolution := public.resolve_private_session_price_v1(
    v_organization_id, v_patient_id, v_specialty, null,
    v_scheduled_at, 'ONLINE', null, null, null, null, v_actor_id
  );
  if v_resolution->>'price_source' <> 'CLINIC_DEFAULT'
     or (v_resolution->>'final_amount')::numeric <> 150 then
    raise exception 'TEST_FAILED: clinic default resolution %', v_resolution;
  end if;

  v_specialty_rule := public.save_private_session_price_rule_v1(
    v_organization_id,
    jsonb_build_object(
      'scopeType', 'SPECIALTY',
      'specialtyKey', lower(v_specialty),
      'specialtyName', v_specialty,
      'baseAmount', 180,
      'cancellationFreeValue', 12,
      'cancellationFreeUnit', 'HOURS',
      'lateCancellationType', 'PERCENTAGE',
      'lateCancellationValue', 50,
      'noShowType', 'FULL',
      'noShowValue', 100,
      'homeSurcharge', 30,
      'schoolSurcharge', 20,
      'validFrom', current_date
    ),
    'test-specialty-' || gen_random_uuid()::text,
    v_actor_id
  );
  v_resolution := public.resolve_private_session_price_v1(
    v_organization_id, v_patient_id, v_specialty, null,
    v_scheduled_at, 'SCHOOL', null, null, null, null, v_actor_id
  );
  if v_resolution->>'price_source' <> 'SPECIALTY_RULE'
     or (v_resolution->>'base_amount')::numeric <> 180
     or (v_resolution->>'location_surcharge')::numeric <> 20
     or (v_resolution->>'final_amount')::numeric <> 200 then
    raise exception 'TEST_FAILED: specialty/school surcharge %', v_resolution;
  end if;

  v_resolution := public.resolve_private_session_price_v1(
    v_organization_id, v_patient_id, v_specialty, null,
    v_scheduled_at, 'PATIENT_HOME', null, null, null, null, v_actor_id
  );
  if (v_resolution->>'location_surcharge')::numeric <> 30
     or (v_resolution->>'final_amount')::numeric <> 210 then
    raise exception 'TEST_FAILED: home surcharge %', v_resolution;
  end if;

  if v_service_id is not null then
    v_service_rule := public.save_private_session_price_rule_v1(
      v_organization_id,
      jsonb_build_object(
        'scopeType', 'SERVICE',
        'serviceCatalogId', v_service_id,
        'baseAmount', 220,
        'validFrom', current_date
      ),
      'test-service-' || gen_random_uuid()::text,
      v_actor_id
    );
    v_resolution := public.resolve_private_session_price_v1(
      v_organization_id, v_patient_id, v_specialty, v_service_id,
      v_scheduled_at, 'ONLINE', null, null, null, null, v_actor_id
    );
    if v_resolution->>'price_source' <> 'SERVICE_RULE'
       or (v_resolution->>'base_amount')::numeric <> 220 then
      raise exception 'TEST_FAILED: service priority %', v_resolution;
    end if;
  end if;

  begin
    v_agreement := public.save_patient_private_pricing_agreement_v1(
      v_organization_id,
      v_patient_id,
      jsonb_build_object(
        'specialtyKey', lower(v_specialty),
        'specialtyName', v_specialty,
        'baseAmount', 160,
        'discountAmount', 10,
        'reason', 'Acordo isolado do teste de banco',
        'validFrom', current_date
      ),
      'test-agreement-' || gen_random_uuid()::text,
      v_actor_id
    );
  exception
    when sqlstate '42883' then
      raise exception 'TEST_FAILED: save_patient_private_pricing_agreement_v1 raised SQLSTATE 42883';
  end;
  v_resolution := public.resolve_private_session_price_v1(
    v_organization_id, v_patient_id, v_specialty, null,
    v_scheduled_at, 'ONLINE', null, null, null, null, v_actor_id
  );
  if v_resolution->>'price_source' <> 'PATIENT_AGREEMENT'
     or (v_resolution->>'base_amount')::numeric <> 160
     or (v_resolution->>'discount_amount')::numeric <> 10
     or (v_resolution->>'final_amount')::numeric <> 150 then
    raise exception 'TEST_FAILED: patient agreement priority %', v_resolution;
  end if;

  -- Expired and future rules must not replace a currently valid rule.
  perform public.save_private_session_price_rule_v1(
    v_organization_id,
    jsonb_build_object(
      'scopeType', 'SPECIALTY', 'specialtyKey', lower(v_specialty),
      'specialtyName', v_specialty, 'baseAmount', 999,
      'validFrom', current_date - 20, 'validUntil', current_date - 10
    ),
    'test-expired-' || gen_random_uuid()::text,
    v_actor_id
  );
  perform public.save_private_session_price_rule_v1(
    v_organization_id,
    jsonb_build_object(
      'scopeType', 'SPECIALTY', 'specialtyKey', lower(v_specialty),
      'specialtyName', v_specialty, 'baseAmount', 998,
      'validFrom', current_date + 20
    ),
    'test-future-' || gen_random_uuid()::text,
    v_actor_id
  );
  v_resolution := public.resolve_private_session_price_v1(
    v_organization_id, v_patient_id, v_specialty, null,
    v_scheduled_at, 'ONLINE', null, null, null, null, v_actor_id
  );
  if (v_resolution->>'final_amount')::numeric <> 150 then
    raise exception 'TEST_FAILED: expired/future validity';
  end if;

  -- Zero without classification/reason is rejected; courtesy is explicit.
  v_failed := false;
  begin
    perform public.resolve_private_session_price_v1(
      v_organization_id, v_patient_id, v_specialty, null,
      v_scheduled_at, 'ONLINE', null, 160, null, null, v_actor_id
    );
  exception
    when others then
      v_failed := sqlerrm like '%PRIVATE_SESSION_DISCOUNT_REASON_REQUIRED%'
        or sqlerrm like '%PRIVATE_SESSION_ZERO_JUSTIFICATION_REQUIRED%';
  end;
  if not v_failed then raise exception 'TEST_FAILED: silent zero was accepted'; end if;

  v_zero := public.resolve_private_session_price_v1(
    v_organization_id, v_patient_id, v_specialty, null,
    v_scheduled_at, 'ONLINE', null, null, 'COURTESY',
    'Cortesia isolada do teste', v_actor_id
  );
  if (v_zero->>'financial_classification') <> 'COURTESY'
     or (v_zero->>'final_amount')::numeric <> 0 then
    raise exception 'TEST_FAILED: explicit courtesy %', v_zero;
  end if;

  -- Owner/admin can make the explicit audited choice offered by the scheduler
  -- even when no price rule is valid for the appointment date.
  v_resolution := public.resolve_private_session_price_v1(
    v_organization_id, v_patient_id, 'Sem regra ' || v_specialty, null,
    date_trunc('minute', now() - interval '1 day'), 'ONLINE',
    123, null, null, 'Valor manual autorizado no teste', v_actor_id
  );
  if v_resolution->>'price_source' <> 'MANUAL_OVERRIDE'
     or (v_resolution->>'final_amount')::numeric <> 123
     or v_resolution->>'override_reason' <> 'Valor manual autorizado no teste' then
    raise exception 'TEST_FAILED: explicit manual value without valid rule %', v_resolution;
  end if;

  v_zero := public.resolve_private_session_price_v1(
    v_organization_id, v_patient_id, 'Cortesia sem regra ' || v_specialty, null,
    date_trunc('minute', now() - interval '1 day'), 'ONLINE',
    null, null, 'COURTESY', 'Cortesia sem regra no teste', v_actor_id
  );
  if v_zero->>'financial_classification' <> 'COURTESY'
     or (v_zero->>'final_amount')::numeric <> 0 then
    raise exception 'TEST_FAILED: explicit zero without valid rule %', v_zero;
  end if;

  -- Online appointment: trigger creates one canonical charge and one snapshot.
  insert into public.appointments (
    id, organization_id, clinic_id, patient_id, therapist_id,
    scheduled_at, scheduled_start_at, scheduled_end_at, duration_minutes,
    approach, service_type, status, location_type, care_setting,
    location_snapshot, location_source, location_timezone,
    financial_event_actor_id, financial_event_reason, source_payload
  ) values (
    v_appointment_id, v_organization_id, v_organization_id, v_patient_id, v_therapist_id,
    v_scheduled_at, v_scheduled_at, v_scheduled_at + interval '1 hour', 60,
    v_specialty, v_specialty, 'scheduled', 'online', 'ONLINE',
    '{}'::jsonb, 'ONLINE', 'America/Sao_Paulo',
    v_actor_id, 'Teste transacional',
    jsonb_build_object(
      'financialContextType', 'PRIVATE',
      'privatePricingReason', 'Teste transacional'
    )
  );

  select item.payment_id
  into v_payment_id
  from public.payment_appointment_items item
  where item.organization_id = v_organization_id
    and item.appointment_id = v_appointment_id
    and item.active;
  if v_payment_id is null then raise exception 'TEST_FAILED: appointment charge missing'; end if;

  select snapshot.id
  into v_snapshot_id
  from public.appointment_private_financial_snapshots snapshot
  where snapshot.organization_id = v_organization_id
    and snapshot.appointment_id = v_appointment_id
    and snapshot.snapshot_version = 1;
  if v_snapshot_id is null then raise exception 'TEST_FAILED: immutable snapshot missing'; end if;

  select count(*) into v_count
  from public.payment_appointment_items item
  where item.organization_id = v_organization_id
    and item.appointment_id = v_appointment_id
    and item.active;
  if v_count <> 1 then raise exception 'TEST_FAILED: duplicate appointment charge %', v_count; end if;

  -- Snapshot cannot be mutated.
  v_failed := false;
  begin
    update public.appointment_private_financial_snapshots
    set final_amount = final_amount + 1
    where id = v_snapshot_id;
  exception
    when others then v_failed := sqlerrm like '%PRIVATE_FINANCIAL_SNAPSHOT_IMMUTABLE%';
  end;
  if not v_failed then raise exception 'TEST_FAILED: snapshot mutation was accepted'; end if;

  -- Partial payment, replay and payload conflict.
  begin
    v_operation := public.apply_private_patient_financial_operation_v2(
      v_organization_id, v_payment_id, 'PARTIAL_PAYMENT', 50, null,
      'pix', null, null, null, null, 'Pagamento parcial do teste',
      'codex-private-pricing-rollback-proof-20260727010000', v_actor_id::text
    );
  exception
    when sqlstate '42883' then
      raise exception 'TEST_FAILED: apply_private_patient_financial_operation_v2 raised SQLSTATE 42883';
  end;
  if (v_operation #>> '{charge,financial_status}') <> 'partial' then
    raise exception 'TEST_FAILED: partial payment status %', v_operation;
  end if;
  v_replay := public.apply_private_patient_financial_operation_v2(
    v_organization_id, v_payment_id, 'PARTIAL_PAYMENT', 50, null,
    'pix', null, null, null, null, 'Pagamento parcial do teste',
    'codex-private-pricing-rollback-proof-20260727010000', v_actor_id::text
  );
  if v_replay is distinct from v_operation then
    raise exception 'TEST_FAILED: idempotent replay changed response';
  end if;
  v_failed := false;
  begin
    perform public.apply_private_patient_financial_operation_v2(
      v_organization_id, v_payment_id, 'PARTIAL_PAYMENT', 51, null,
      'pix', null, null, null, null, 'Pagamento parcial do teste',
      'codex-private-pricing-rollback-proof-20260727010000', v_actor_id::text
    );
  exception
    when others then v_failed := sqlerrm like '%PRIVATE_FINANCIAL_OPERATION_IDEMPOTENCY_CONFLICT%';
  end;
  if not v_failed then raise exception 'TEST_FAILED: same key accepted a different payload'; end if;

  -- Home with canonical snapshot succeeds; incomplete home rolls back entirely.
  insert into public.appointments (
    id, organization_id, clinic_id, patient_id, therapist_id,
    scheduled_at, scheduled_start_at, scheduled_end_at, duration_minutes,
    approach, service_type, status, location_type, care_setting,
    location_snapshot, location_address_snapshot, location_source,
    location_timezone, source_payload
  ) values (
    v_home_appointment_id, v_organization_id, v_organization_id, v_patient_id, v_therapist_id,
    v_scheduled_at + interval '1 day', v_scheduled_at + interval '1 day',
    v_scheduled_at + interval '1 day 1 hour', 60,
    'Location-only test', 'Location-only test', 'scheduled', 'domicilio', 'PATIENT_HOME',
    jsonb_build_object('address', jsonb_build_object('street', 'Rua de teste', 'city', 'São Paulo')),
    'Rua de teste, São Paulo', 'PATIENT_PROFILE', 'America/Sao_Paulo',
    jsonb_build_object('financialContextType', 'NO_CHARGE')
  );
  if not exists (select 1 from public.appointments where id = v_home_appointment_id) then
    raise exception 'TEST_FAILED: complete patient home rejected';
  end if;

  v_failed := false;
  begin
    insert into public.appointments (
      id, organization_id, clinic_id, patient_id, therapist_id,
      scheduled_at, duration_minutes, approach, service_type, status,
      location_type, care_setting, location_snapshot, location_source,
      location_timezone, source_payload
    ) values (
      gen_random_uuid(), v_organization_id, v_organization_id, v_patient_id, v_therapist_id,
      v_scheduled_at + interval '2 days', 60, 'Location-only test',
      'Location-only test', 'scheduled', 'domicilio', 'PATIENT_HOME',
      '{}'::jsonb, 'PATIENT_PROFILE', 'America/Sao_Paulo',
      jsonb_build_object('financialContextType', 'NO_CHARGE')
    );
  exception
    when others then v_failed := sqlerrm like '%APPOINTMENT_LOCATION_SNAPSHOT_REQUIRED%';
  end;
  if not v_failed then raise exception 'TEST_FAILED: incomplete patient home was accepted'; end if;

  -- Clinic with a tenant-scoped room succeeds.
  insert into public.appointments (
    id, organization_id, clinic_id, patient_id, therapist_id,
    scheduled_at, duration_minutes, approach, service_type, status,
    room_id, location_type, care_setting, location_snapshot,
    location_source, location_timezone, source_payload
  ) values (
    gen_random_uuid(), v_organization_id, v_organization_id, v_patient_id, v_therapist_id,
    v_scheduled_at + interval '4 days', 60, 'Location-only test',
    'Location-only test', 'scheduled', v_room_id::text, 'clinica', 'CLINIC',
    '{}'::jsonb, 'CLINIC_DIRECTORY', 'America/Sao_Paulo',
    jsonb_build_object('financialContextType', 'NO_CHARGE')
  );

  -- A linked school succeeds with a frozen snapshot.
  select enrollment.school_id, enrollment.school_unit_id
  into v_school_id, v_school_unit_id
  from public.patient_school_enrollments enrollment
  where enrollment.patient_id = v_patient_id
    and enrollment.clinic_id = v_organization_id::text
    and enrollment.is_current
  limit 1;
  if v_school_id is not null then
    insert into public.appointments (
      id, organization_id, clinic_id, patient_id, therapist_id,
      scheduled_at, duration_minutes, approach, service_type, status,
      location_type, care_setting, school_id, school_unit_id,
      location_snapshot, location_address_snapshot, location_source,
      location_timezone, source_payload
    ) values (
      gen_random_uuid(), v_organization_id, v_organization_id, v_patient_id, v_therapist_id,
      v_scheduled_at + interval '5 days', 60, 'Location-only test',
      'Location-only test', 'scheduled', 'escola', 'SCHOOL',
      v_school_id, v_school_unit_id,
      jsonb_build_object('schoolId', v_school_id, 'schoolUnitId', v_school_unit_id),
      'Endereço escolar congelado para o teste', 'SCHOOL_DIRECTORY',
      'America/Sao_Paulo', jsonb_build_object('financialContextType', 'NO_CHARGE')
    );
  else
    raise notice 'TEST_SKIPPED: linked-school success requires a current enrollment for patient %', v_patient_id;
  end if;

  -- A school outside the patient's link/scope cannot be associated.
  v_failed := false;
  begin
    insert into public.appointments (
      id, organization_id, clinic_id, patient_id, therapist_id,
      scheduled_at, duration_minutes, approach, service_type, status,
      location_type, care_setting, school_id, location_snapshot,
      location_address_snapshot, location_source, location_timezone,
      source_payload
    ) values (
      gen_random_uuid(), v_organization_id, v_organization_id, v_patient_id, v_therapist_id,
      v_scheduled_at + interval '6 days', 60, 'Location-only test',
      'Location-only test', 'scheduled', 'escola', 'SCHOOL',
      gen_random_uuid(), jsonb_build_object('schoolId', gen_random_uuid()),
      'Endereço não autorizado', 'SCHOOL_DIRECTORY', 'America/Sao_Paulo',
      jsonb_build_object('financialContextType', 'NO_CHARGE')
    );
  exception
    when others then
      v_failed := sqlerrm like '%APPOINTMENT_SCHOOL_SCOPE_MISMATCH%'
        or sqlerrm like '%APPOINTMENT_PATIENT_SCHOOL_LINK_REQUIRED%';
  end;
  if not v_failed then raise exception 'TEST_FAILED: unlinked school was accepted'; end if;

  -- A second occurrence creates its own charge; the first remains unchanged.
  insert into public.appointments (
    id, organization_id, clinic_id, patient_id, therapist_id,
    scheduled_at, scheduled_start_at, scheduled_end_at, duration_minutes,
    approach, service_type, status, location_type, care_setting,
    location_snapshot, location_source, location_timezone,
    recurrence_group_id, recurrence_index, recurrence_total,
    financial_event_actor_id, source_payload
  ) values (
    v_second_appointment_id, v_organization_id, v_organization_id, v_patient_id, v_therapist_id,
    v_scheduled_at + interval '7 days', v_scheduled_at + interval '7 days',
    v_scheduled_at + interval '7 days 1 hour', 60,
    v_specialty, v_specialty, 'scheduled', 'online', 'ONLINE',
    '{}'::jsonb, 'ONLINE', 'America/Sao_Paulo',
    v_recurrence_group::text, 2, 2, v_actor_id,
    jsonb_build_object('financialContextType', 'PRIVATE')
  );
  update public.appointments
  set recurrence_group_id = v_recurrence_group::text, recurrence_index = 1, recurrence_total = 2
  where id = v_appointment_id;
  select count(distinct item.payment_id) into v_count
  from public.payment_appointment_items item
  where item.organization_id = v_organization_id
    and item.appointment_id in (v_appointment_id, v_second_appointment_id)
    and item.active;
  if v_count <> 2 then raise exception 'TEST_FAILED: recurrence does not have one charge per occurrence'; end if;

  select item.payment_id into v_second_payment_id
  from public.payment_appointment_items item
  where item.organization_id = v_organization_id
    and item.appointment_id = v_second_appointment_id
    and item.active;
  update public.appointments
  set scheduled_at = scheduled_at + interval '1 day',
      scheduled_start_at = scheduled_start_at + interval '1 day',
      scheduled_end_at = scheduled_end_at + interval '1 day',
      financial_event_actor_id = v_actor_id,
      financial_event_reason = 'Reagendamento comum do teste'
  where id = v_second_appointment_id;
  if not exists (
    select 1
    from public.payment_appointment_items item
    where item.appointment_id = v_second_appointment_id
      and item.payment_id = v_second_payment_id
      and item.active
  ) or (
    select count(*)
    from public.appointment_private_financial_snapshots snapshot
    where snapshot.appointment_id = v_second_appointment_id
  ) <> 2 then
    raise exception 'TEST_FAILED: reschedule duplicated charge or lost snapshot history';
  end if;

  -- Free cancellation preserves the row and original value while zeroing due.
  update public.appointments
  set status = 'canceled',
      financial_event_actor_id = v_actor_id,
      financial_event_reason = 'Cancelamento dentro da política do teste'
  where id = v_second_appointment_id;
  if not exists (
    select 1
    from public.payments payment
    join public.payment_appointment_items item on item.payment_id::text = payment.id::text
    where item.appointment_id = v_second_appointment_id
      and payment.private_financial_classification = 'CANCELLED_NO_CHARGE'
      and payment.amount = 0
      and coalesce(payment.original_amount, 0) > 0
  ) then
    raise exception 'TEST_FAILED: free cancellation did not preserve/zero charge';
  end if;

  -- Late cancellation uses the frozen 50% policy, never the current rule.
  insert into public.appointments (
    id, organization_id, clinic_id, patient_id, therapist_id,
    scheduled_at, scheduled_start_at, scheduled_end_at, duration_minutes,
    approach, service_type, status, location_type, care_setting,
    location_snapshot, location_source, location_timezone,
    financial_event_actor_id, source_payload
  ) values (
    v_late_appointment_id, v_organization_id, v_organization_id, v_patient_id, v_therapist_id,
    now() - interval '3 days', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 60,
    v_specialty, v_specialty, 'scheduled', 'online', 'ONLINE',
    '{}'::jsonb, 'ONLINE', 'America/Sao_Paulo', v_actor_id,
    jsonb_build_object('financialContextType', 'PRIVATE')
  );
  update public.appointments
  set status = 'canceled',
      financial_event_actor_id = v_actor_id,
      financial_event_reason = 'Cancelamento tardio do teste'
  where id = v_late_appointment_id;
  if not exists (
    select 1
    from public.payments payment
    join public.payment_appointment_items item on item.payment_id::text = payment.id::text
    where item.appointment_id = v_late_appointment_id
      and payment.private_financial_classification = 'LATE_CANCELLATION_CHARGE'
      and payment.amount = 75
  ) then
    raise exception 'TEST_FAILED: frozen late-cancellation percentage';
  end if;

  -- Rescheduling after a late cancellation requires an explicit audited choice
  -- and keeps the same charge when KEEP_PREVIOUS_CHARGE is selected.
  select item.payment_id into v_second_payment_id
  from public.payment_appointment_items item
  where item.organization_id = v_organization_id
    and item.appointment_id = v_late_appointment_id
    and item.active;
  update public.appointments
  set
    status = 'scheduled',
    scheduled_at = now() + interval '10 days',
    scheduled_start_at = now() + interval '10 days',
    scheduled_end_at = now() + interval '10 days 1 hour',
    financial_event_actor_id = v_actor_id,
    financial_event_reason = 'Manter cobrança tardia no teste',
    source_payload = source_payload || jsonb_build_object(
      'privateRescheduleFinancialDecision', 'KEEP_PREVIOUS_CHARGE',
      'privatePricingReason', 'Manter cobrança tardia no teste'
    )
  where id = v_late_appointment_id;
  if not exists (
    select 1
    from public.payment_appointment_items item
    where item.organization_id = v_organization_id
      and item.appointment_id = v_late_appointment_id
      and item.payment_id = v_second_payment_id
      and item.active
  ) or not exists (
    select 1
    from public.payment_audit_events event
    where event.organization_id = v_organization_id
      and event.appointment_id = v_late_appointment_id
      and event.event_type = 'PRIVATE_LATE_CANCELLATION_RESCHEDULE_DECISION'
      and event.after_state->>'decision' = 'KEEP_PREVIOUS_CHARGE'
      and event.created_by = v_actor_id::text
  ) then
    raise exception 'TEST_FAILED: late-cancellation reschedule decision was not preserved/audited';
  end if;

  -- No-show uses the frozen 100% rule and records its actor/reason.
  insert into public.appointments (
    id, organization_id, clinic_id, patient_id, therapist_id,
    scheduled_at, scheduled_start_at, scheduled_end_at, duration_minutes,
    approach, service_type, status, location_type, care_setting,
    location_snapshot, location_source, location_timezone,
    financial_event_actor_id, source_payload
  ) values (
    v_no_show_appointment_id, v_organization_id, v_organization_id, v_patient_id, v_therapist_id,
    now() - interval '2 days', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 60,
    v_specialty, v_specialty, 'scheduled', 'online', 'ONLINE',
    '{}'::jsonb, 'ONLINE', 'America/Sao_Paulo', v_actor_id,
    jsonb_build_object('financialContextType', 'PRIVATE')
  );
  update public.appointments
  set status = 'no_show',
      financial_event_actor_id = v_actor_id,
      financial_event_reason = 'Falta confirmada no teste'
  where id = v_no_show_appointment_id;
  if not exists (
    select 1
    from public.payments payment
    join public.payment_appointment_items item on item.payment_id::text = payment.id::text
    join public.payment_audit_events event
      on event.organization_id = payment.organization_id
     and event.payment_id::text = payment.id::text
     and event.event_type = 'NO_SHOW_CHARGE'
    where item.appointment_id = v_no_show_appointment_id
      and payment.private_financial_classification = 'NO_SHOW_CHARGE'
      and payment.amount = 150
      and event.created_by = v_actor_id::text
  ) then
    raise exception 'TEST_FAILED: frozen no-show charge/audit';
  end if;

  -- Manual frozen policies reject incomplete updates and persist the explicit
  -- amount, event, actor and reason when the authorized decision is complete.
  perform public.save_private_session_price_rule_v1(
    v_organization_id,
    jsonb_build_object(
      'scopeType', 'SPECIALTY',
      'specialtyKey', lower(v_manual_specialty),
      'specialtyName', v_manual_specialty,
      'baseAmount', 190,
      'cancellationFreeValue', 0,
      'cancellationFreeUnit', 'HOURS',
      'lateCancellationType', 'MANUAL',
      'lateCancellationValue', 0,
      'noShowType', 'MANUAL',
      'noShowValue', 0,
      'validFrom', current_date
    ),
    'test-manual-policy-' || gen_random_uuid()::text,
    v_actor_id
  );

  insert into public.appointments (
    id, organization_id, clinic_id, patient_id, therapist_id,
    scheduled_at, scheduled_start_at, scheduled_end_at, duration_minutes,
    approach, service_type, status, location_type, care_setting,
    location_snapshot, location_source, location_timezone,
    financial_event_actor_id, source_payload
  ) values (
    v_manual_cancel_appointment_id, v_organization_id, v_organization_id, v_patient_id, v_therapist_id,
    now() - interval '1 day', now() - interval '1 day', now() - interval '1 day' + interval '1 hour', 60,
    v_manual_specialty, v_manual_specialty, 'scheduled', 'online', 'ONLINE',
    '{}'::jsonb, 'ONLINE', 'America/Sao_Paulo', v_actor_id,
    jsonb_build_object('financialContextType', 'PRIVATE')
  );

  begin
    update public.appointments
    set status = 'canceled',
        financial_event_actor_id = v_actor_id,
        financial_event_reason = 'DecisÃ£o manual incompleta'
    where id = v_manual_cancel_appointment_id;
    raise exception 'TEST_FAILED: manual cancellation accepted without amount/event';
  exception
    when others then
      if sqlerrm not like '%PRIVATE_SESSION_MANUAL_CANCELLATION_DECISION_REQUIRED%' then
        raise;
      end if;
  end;

  update public.appointments
  set status = 'canceled',
      financial_event_actor_id = v_actor_id,
      financial_event_reason = 'Cobrar R$ 45,00 conforme anÃ¡lise autorizada',
      financial_policy_decision_amount = 45,
      financial_policy_decision_event = 'CANCELED'
  where id = v_manual_cancel_appointment_id;
  if not exists (
    select 1
    from public.payments payment
    join public.payment_appointment_items item on item.payment_id::text = payment.id::text
    join public.payment_audit_events event
      on event.organization_id = payment.organization_id
     and event.payment_id::text = payment.id::text
     and event.event_type = 'LATE_CANCELLATION_CHARGE'
    where item.appointment_id = v_manual_cancel_appointment_id
      and payment.private_financial_classification = 'LATE_CANCELLATION_CHARGE'
      and event.created_by = v_actor_id::text
      and event.notes like '%R$ 45,00%'
  ) then
    raise exception 'TEST_FAILED: authorized manual cancellation was not charged/audited';
  end if;

  insert into public.appointments (
    id, organization_id, clinic_id, patient_id, therapist_id,
    scheduled_at, scheduled_start_at, scheduled_end_at, duration_minutes,
    approach, service_type, status, location_type, care_setting,
    location_snapshot, location_source, location_timezone,
    financial_event_actor_id, source_payload
  ) values (
    v_manual_no_show_appointment_id, v_organization_id, v_organization_id, v_patient_id, v_therapist_id,
    now() - interval '2 days', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 60,
    v_manual_specialty, v_manual_specialty, 'scheduled', 'online', 'ONLINE',
    '{}'::jsonb, 'ONLINE', 'America/Sao_Paulo', v_actor_id,
    jsonb_build_object('financialContextType', 'PRIVATE')
  );
  update public.appointments
  set status = 'no_show',
      financial_event_actor_id = v_actor_id,
      financial_event_reason = 'Cobrar R$ 80,00 pela falta autorizada',
      financial_policy_decision_amount = 80,
      financial_policy_decision_event = 'NO_SHOW'
  where id = v_manual_no_show_appointment_id;
  if not exists (
    select 1
    from public.payments payment
    join public.payment_appointment_items item on item.payment_id::text = payment.id::text
    join public.payment_audit_events event
      on event.organization_id = payment.organization_id
     and event.payment_id::text = payment.id::text
     and event.event_type = 'NO_SHOW_CHARGE'
    where item.appointment_id = v_manual_no_show_appointment_id
      and payment.private_financial_classification = 'NO_SHOW_CHARGE'
      and event.created_by = v_actor_id::text
      and event.notes like '%R$ 80,00%'
  ) then
    raise exception 'TEST_FAILED: authorized manual no-show was not charged/audited';
  end if;

  -- The transaction itself is the rollback test: every row created above must
  -- disappear at the final ROLLBACK statement.
end;
$test$;

rollback;

begin;

do $test$
begin
  if exists (
    select 1
    from public.private_financial_idempotency_requests request
    where request.idempotency_key = 'codex-private-pricing-rollback-proof-20260727010000'
  ) then
    raise exception 'TEST_FAILED: full rollback left the idempotent financial operation persisted';
  end if;
end;
$test$;

rollback;
