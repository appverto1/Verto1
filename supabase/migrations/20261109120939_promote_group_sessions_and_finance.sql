-- Production promotion: group sessions and financial binding. Original reviewed SQLs are retained under

-- supabase/operations/promotion_staging_sources and must not be applied separately.

begin;

set local lock_timeout = '5s';

set local statement_timeout = '180s';

do $$ begin
  if to_regclass('public.group_session_bookings') is not null
    or to_regclass('public.group_session_participants') is not null
    or to_regclass('public.group_session_operations') is not null
    or exists (select 1 from information_schema.columns where table_schema='public'
      and table_name='patient_financial_plans' and column_name in ('group_amount_cents','professional_user_id')) then
    raise exception 'PROMOTION_GROUP_SCHEMA_ALREADY_PRESENT';
  end if;
end $$;

-- Source: 20261015162000_group_session_specialty_rates.sql; sha256 99eb4d694ab2d6417aebf7cea0bd941f6a49133ae67c7b63aa72f94fd136886d

-- Two rates within ONE logical specialty plan: avoid duplicate active plan ambiguity.
-- A zero group rate disables the group modality; existing individual prices survive.

alter table public.patient_financial_plans
  add column if not exists group_amount_cents integer not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.patient_financial_plans'::regclass and conname='patient_financial_plans_group_amount_nonnegative') then
    alter table public.patient_financial_plans add constraint patient_financial_plans_group_amount_nonnegative check (group_amount_cents between 0 and 1000000000);
  end if;
end $$;

create or replace function public.reconcile_patient_financial_plans_v2(
  p_organization_id uuid,
  p_patient_id uuid,
  p_actor_id uuid,
  p_plans jsonb,
  p_preserve_insurance_context boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan jsonb;
  v_existing public.patient_financial_plans%rowtype;
  v_current public.patient_financial_plans%rowtype;
  v_match public.patient_financial_plans%rowtype;
  v_new public.patient_financial_plans%rowtype;
  v_requested_id uuid;
  v_client_plan_key text;
  v_logical_plan_id uuid;
  v_keep_logical_ids uuid[] := array[]::uuid[];
  v_now timestamptz := clock_timestamp();
  v_referenced boolean := false;
  v_payer_id uuid;
  v_service_type text;
  v_custom_service_name text;
  v_service_name_snapshot text;
  v_billing_mode text;
  v_billing_frequency text;
  v_pricing_unit text;
  v_aggregation_method text;
  v_payer_name_snapshot text;
  v_insurance_plan_name text;
  v_authorization_code text;
  v_authorization_valid_until date;
  v_sessions_quantity integer;
  v_quantity_period text;
  v_amount_cents integer;
  v_group_amount_cents integer;
  v_copayment_amount_cents integer;
  v_payment_method text;
  v_due_day integer;
  v_package_valid_until date;
  v_notes text;
  v_result jsonb;
  v_active_count integer;
begin
  if p_organization_id is null or p_patient_id is null then
    raise exception 'PATIENT_FINANCIAL_PLAN_SCOPE_INVALID';
  end if;
  if p_plans is null or jsonb_typeof(p_plans) <> 'array' then
    raise exception 'PATIENT_FINANCIAL_PLAN_PAYLOAD_INVALID';
  end if;

  if not exists (
    select 1
    from public.patients p
    where p.id = p_patient_id
      and p.clinic_id = p_organization_id
  ) then
    raise exception 'PATIENT_FINANCIAL_PLAN_PATIENT_SCOPE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_patient_id::text, 0));
  perform 1
  from public.patient_financial_plans plan
  where plan.organization_id = p_organization_id
    and plan.patient_id = p_patient_id
  for update;

  for v_plan in select value from jsonb_array_elements(p_plans)
  loop
    v_service_type := coalesce(nullif(trim(v_plan->>'service_type'), ''), 'CUSTOM');
    v_custom_service_name := nullif(trim(v_plan->>'custom_service_name'), '');
    v_service_name_snapshot := nullif(trim(v_plan->>'service_name_snapshot'), '');
    v_billing_mode := coalesce(nullif(upper(trim(v_plan->>'billing_mode')), ''), 'PRIVATE');
    v_billing_frequency := nullif(upper(trim(v_plan->>'billing_frequency')), '');
    v_pricing_unit := nullif(upper(trim(v_plan->>'pricing_unit')), '');
    v_aggregation_method := nullif(upper(trim(v_plan->>'aggregation_method')), '');

    if coalesce(p_preserve_insurance_context, false) and v_billing_mode = 'INSURANCE' then
      raise exception 'PATIENT_FINANCIAL_PLAN_INSURANCE_MUTATION_NOT_ALLOWED';
    end if;
    v_payer_name_snapshot := nullif(trim(v_plan->>'payer_name_snapshot'), '');
    v_insurance_plan_name := nullif(trim(v_plan->>'insurance_plan_name'), '');
    v_authorization_code := nullif(trim(v_plan->>'authorization_code'), '');
    v_authorization_valid_until := nullif(v_plan->>'authorization_valid_until', '')::date;
    v_sessions_quantity := nullif(v_plan->>'sessions_quantity', '')::integer;
    v_quantity_period := nullif(upper(trim(v_plan->>'quantity_period')), '');
    v_amount_cents := greatest(0, coalesce(nullif(v_plan->>'amount_cents', '')::integer, 0));
    v_group_amount_cents := greatest(0, coalesce(nullif(v_plan->>'group_amount_cents', '')::integer, 0));
    v_copayment_amount_cents := greatest(0, coalesce(nullif(v_plan->>'copayment_amount_cents', '')::integer, 0));
    v_payment_method := nullif(trim(v_plan->>'payment_method'), '');
    v_due_day := nullif(v_plan->>'due_day', '')::integer;
    v_package_valid_until := nullif(v_plan->>'package_valid_until', '')::date;
    v_notes := nullif(trim(v_plan->>'notes'), '');
    v_client_plan_key := nullif(left(trim(v_plan->>'client_plan_key'), 120), '');
    v_requested_id := case
      when coalesce(v_plan->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (v_plan->>'id')::uuid
      else null
    end;
    v_payer_id := case
      when coalesce(v_plan->>'payer_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (v_plan->>'payer_id')::uuid
      else null
    end;

    if v_payer_id is not null and not exists (
      select 1
      from public.clinic_payers payer
      where payer.id = v_payer_id
        and payer.organization_id = p_organization_id
    ) then
      raise exception 'PATIENT_FINANCIAL_PLAN_PAYER_SCOPE_INVALID';
    end if;

    v_existing := null;
    if v_requested_id is not null or v_client_plan_key is not null then
      select plan.* into v_existing
      from public.patient_financial_plans plan
      where plan.organization_id = p_organization_id
        and plan.patient_id = p_patient_id
        and (
          (v_requested_id is not null and plan.id = v_requested_id)
          or (v_client_plan_key is not null and plan.client_plan_key = v_client_plan_key)
        )
      order by
        case when v_requested_id is not null and plan.id = v_requested_id then 0 else 1 end,
        case when plan.status = 'ACTIVE' then 0 else 1 end,
        plan.version desc,
        plan.created_at desc
      limit 1;
    end if;

    -- Legacy clients do not know the group column: do not erase saved group rates
    -- when they update another field of the same plan.
    if not (v_plan ? 'group_amount_cents') then
      v_group_amount_cents := coalesce(v_existing.group_amount_cents, 0);
    end if;

    v_logical_plan_id := coalesce(v_existing.logical_plan_id, v_existing.id);

    -- Retry-safe semantic match. This also prevents duplicate active rows when a
    -- client-generated temporary id is retried after a network failure.
    select plan.* into v_match
    from public.patient_financial_plans plan
    where plan.organization_id = p_organization_id
      and plan.patient_id = p_patient_id
      and plan.status = 'ACTIVE'
      and (v_logical_plan_id is null or plan.logical_plan_id = v_logical_plan_id)
      and plan.service_type is not distinct from v_service_type
      and plan.custom_service_name is not distinct from v_custom_service_name
      and plan.service_name_snapshot is not distinct from v_service_name_snapshot
      and plan.billing_mode is not distinct from v_billing_mode
      and plan.billing_frequency is not distinct from v_billing_frequency
      and plan.pricing_unit is not distinct from v_pricing_unit
      and plan.aggregation_method is not distinct from v_aggregation_method
      and plan.payer_id is not distinct from v_payer_id
      and plan.payer_name_snapshot is not distinct from v_payer_name_snapshot
      and plan.insurance_plan_name is not distinct from v_insurance_plan_name
      and plan.authorization_code is not distinct from v_authorization_code
      and plan.authorization_valid_until is not distinct from v_authorization_valid_until
      and plan.sessions_quantity is not distinct from v_sessions_quantity
      and plan.quantity_period is not distinct from v_quantity_period
      and plan.amount_cents is not distinct from v_amount_cents
      and plan.group_amount_cents is not distinct from v_group_amount_cents
      and plan.copayment_amount_cents is not distinct from v_copayment_amount_cents
      and plan.payment_method is not distinct from v_payment_method
      and plan.due_day is not distinct from v_due_day
      and plan.package_valid_until is not distinct from v_package_valid_until
      and plan.notes is not distinct from v_notes
    order by plan.version desc, plan.created_at desc
    limit 1;

    if v_match.id is not null then
      v_keep_logical_ids := array_append(v_keep_logical_ids, v_match.logical_plan_id);
      continue;
    end if;

    if v_existing.id is not null then
      select plan.* into v_current
      from public.patient_financial_plans plan
      where plan.organization_id = p_organization_id
        and plan.patient_id = p_patient_id
        and plan.logical_plan_id = coalesce(v_existing.logical_plan_id, v_existing.id)
        and plan.status = 'ACTIVE'
      order by plan.version desc, plan.created_at desc
      limit 1;
    else
      v_current := null;
    end if;

    -- A stale editor may still submit an ended historical row id. Identical
    -- retries were handled above; divergent stale writes must not overwrite the
    -- current version silently.
    if v_existing.id is not null
       and v_current.id is not null
       and v_existing.id <> v_current.id then
      raise exception 'PATIENT_FINANCIAL_PLAN_STALE_VERSION';
    end if;

    if v_current.id is not null then
      v_referenced := false;
      if to_regclass('public.appointment_private_financial_snapshots') is not null then
        execute 'select exists(select 1 from public.appointment_private_financial_snapshots where legacy_patient_financial_plan_id = $1)'
          into v_referenced
          using v_current.id;
      end if;
      if not v_referenced and to_regclass('public.payment_appointment_items') is not null then
        execute 'select exists(select 1 from public.payment_appointment_items where patient_financial_plan_id = $1)'
          into v_referenced
          using v_current.id;
      end if;

      -- A reserved GROUP session already freezes this plan, including monthly
      -- sessions that have not produced a payment item yet.
      if not v_referenced and to_regclass('public.group_session_participants') is not null then
        execute 'select exists(select 1 from public.group_session_participants where financial_plan_id = $1)'
          into v_referenced using v_current.id;
      end if;

      if not v_referenced then
        update public.patient_financial_plans
        set client_plan_key = coalesce(v_client_plan_key, client_plan_key),
            service_type = v_service_type,
            custom_service_name = v_custom_service_name,
            service_name_snapshot = v_service_name_snapshot,
            billing_mode = v_billing_mode,
            billing_frequency = v_billing_frequency,
            pricing_unit = v_pricing_unit,
            aggregation_method = v_aggregation_method,
            payer_id = v_payer_id,
            payer_name_snapshot = v_payer_name_snapshot,
            insurance_plan_name = v_insurance_plan_name,
            authorization_code = v_authorization_code,
            authorization_valid_until = v_authorization_valid_until,
            sessions_quantity = v_sessions_quantity,
            quantity_period = v_quantity_period,
            amount_cents = v_amount_cents,
            group_amount_cents = v_group_amount_cents,
            copayment_amount_cents = v_copayment_amount_cents,
            payment_method = v_payment_method,
            due_day = v_due_day,
            package_valid_until = v_package_valid_until,
            notes = v_notes,
            updated_at = v_now
        where id = v_current.id
        returning * into v_new;
      else
        update public.patient_financial_plans
        set status = 'INACTIVE',
            valid_until = coalesce(valid_until, v_now),
            updated_at = v_now
        where id = v_current.id;

        insert into public.patient_financial_plans (
          organization_id, patient_id, client_plan_key, logical_plan_id, version, valid_from, valid_until, supersedes_plan_id,
          service_type, custom_service_name, service_name_snapshot, billing_mode, billing_frequency, pricing_unit, aggregation_method, payer_id, payer_name_snapshot,
          insurance_plan_name, authorization_code, authorization_valid_until, sessions_quantity, quantity_period,
          amount_cents, group_amount_cents, copayment_amount_cents, payment_method, due_day, package_valid_until, status, notes,
          created_by, created_at, updated_at
        ) values (
          p_organization_id, p_patient_id, coalesce(v_client_plan_key, v_current.client_plan_key), coalesce(v_current.logical_plan_id, v_current.id), coalesce(v_current.version, 1) + 1,
          v_now, null, v_current.id,
          v_service_type, v_custom_service_name, v_service_name_snapshot, v_billing_mode, v_billing_frequency, v_pricing_unit, v_aggregation_method, v_payer_id, v_payer_name_snapshot,
          v_insurance_plan_name, v_authorization_code, v_authorization_valid_until, v_sessions_quantity, v_quantity_period,
          v_amount_cents, v_group_amount_cents, v_copayment_amount_cents, v_payment_method, v_due_day, v_package_valid_until, 'ACTIVE', v_notes,
          p_actor_id, v_now, v_now
        ) returning * into v_new;
      end if;
    else
      insert into public.patient_financial_plans (
        organization_id, patient_id, client_plan_key, logical_plan_id, version, valid_from, valid_until, supersedes_plan_id,
        service_type, custom_service_name, service_name_snapshot, billing_mode, billing_frequency, pricing_unit, aggregation_method, payer_id, payer_name_snapshot,
        insurance_plan_name, authorization_code, authorization_valid_until, sessions_quantity, quantity_period,
        amount_cents, group_amount_cents, copayment_amount_cents, payment_method, due_day, package_valid_until, status, notes,
        created_by, created_at, updated_at
      ) values (
        p_organization_id, p_patient_id, v_client_plan_key, gen_random_uuid(), 1, v_now, null, null,
        v_service_type, v_custom_service_name, v_service_name_snapshot, v_billing_mode, v_billing_frequency, v_pricing_unit, v_aggregation_method, v_payer_id, v_payer_name_snapshot,
        v_insurance_plan_name, v_authorization_code, v_authorization_valid_until, v_sessions_quantity, v_quantity_period,
        v_amount_cents, v_group_amount_cents, v_copayment_amount_cents, v_payment_method, v_due_day, v_package_valid_until, 'ACTIVE', v_notes,
        p_actor_id, v_now, v_now
      ) returning * into v_new;
    end if;

    v_keep_logical_ids := array_append(v_keep_logical_ids, v_new.logical_plan_id);
  end loop;

  -- Omitted active plans are ended. Referenced rows are preserved; unreferenced
  -- rows may be physically removed because no financial history points to them.
  -- When the caller is preserving an unauthorized-but-identical INSURANCE replay,
  -- INSURANCE rows are outside the mutation set and remain byte-for-byte untouched.
  for v_current in
    select plan.*
    from public.patient_financial_plans plan
    where plan.organization_id = p_organization_id
      and plan.patient_id = p_patient_id
      and plan.status = 'ACTIVE'
      and not (plan.logical_plan_id = any(v_keep_logical_ids))
      and (
        not coalesce(p_preserve_insurance_context, false)
        or upper(coalesce(plan.billing_mode, '')) <> 'INSURANCE'
      )
    for update
  loop
    v_referenced := false;
    if to_regclass('public.appointment_private_financial_snapshots') is not null then
      execute 'select exists(select 1 from public.appointment_private_financial_snapshots where legacy_patient_financial_plan_id = $1)'
        into v_referenced
        using v_current.id;
    end if;
    if not v_referenced and to_regclass('public.payment_appointment_items') is not null then
      execute 'select exists(select 1 from public.payment_appointment_items where patient_financial_plan_id = $1)'
        into v_referenced
        using v_current.id;
    end if;

    if not v_referenced and to_regclass('public.group_session_participants') is not null then
      execute 'select exists(select 1 from public.group_session_participants where financial_plan_id = $1)'
        into v_referenced using v_current.id;
    end if;

    if v_referenced then
      update public.patient_financial_plans
      set status = 'INACTIVE',
          valid_until = coalesce(valid_until, v_now),
          updated_at = v_now
      where id = v_current.id;
    else
      delete from public.patient_financial_plans where id = v_current.id;
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(plan) order by plan.created_at asc), '[]'::jsonb), count(*)::integer
    into v_result, v_active_count
  from public.patient_financial_plans plan
  where plan.organization_id = p_organization_id
    and plan.patient_id = p_patient_id
    and plan.status = 'ACTIVE';

  return jsonb_build_object(
    'success', true,
    'data', v_result,
    'activeCount', v_active_count
  );
end;
$$;

revoke all on function public.reconcile_patient_financial_plans_v2(uuid,uuid,uuid,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.reconcile_patient_financial_plans_v2(uuid,uuid,uuid,jsonb,boolean) to service_role;

-- Source: 20261015171000_group_session_private_rate_authority.sql; sha256 12676f2c0243b540f99124bca7265dd3196ad34d63faf1929f466aec1ef8e37a

-- Resolver de preco coletivo: exclusivamente plano canônico, nunca valor do navegador.
-- Esta função depende de group_amount_cents criada em 20261015162000.
-- SECURITY INVOKER, executável apenas pelo backend (service_role).

create or replace function public.resolve_group_patient_private_rate_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_specialty text,
  p_scheduled_at timestamptz
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_plan public.patient_financial_plans%rowtype;
  v_count integer := 0;
  v_specialty_key text;
begin
  if p_organization_id is null or p_patient_id is null
    or p_scheduled_at is null or nullif(btrim(coalesce(p_specialty, '')), '') is null then
    return jsonb_build_object('success',false,'code','GROUP_RATE_INPUT_INVALID');
  end if;

  if not exists (
    select 1 from public.patients p
    where p.id=p_patient_id and p.clinic_id=p_organization_id
  ) then
    return jsonb_build_object('success',false,'code','GROUP_RATE_PATIENT_OUT_OF_SCOPE');
  end if;

  v_specialty_key := public.appointment_financial_service_key_v1(p_specialty);
  if nullif(v_specialty_key, '') is null then
    return jsonb_build_object('success',false,'code','GROUP_RATE_SPECIALTY_INVALID');
  end if;

  -- Select ALL matching active PRIVATE lines before deciding: ambiguity must
  -- never disappear merely because one matching line has no group price.
  select count(*)::integer into v_count
  from public.patient_financial_plans plan
  where plan.organization_id=p_organization_id
    and plan.patient_id=p_patient_id
    and plan.status='ACTIVE'
    and plan.billing_mode='PRIVATE'
    and plan.valid_from<=p_scheduled_at
    and (plan.valid_until is null or p_scheduled_at<plan.valid_until)
    and (plan.package_valid_until is null or plan.package_valid_until>=(p_scheduled_at at time zone (select clinic.timezone from public.clinics clinic where clinic.id=p_organization_id))::date)
    and public.appointment_financial_service_key_v1(
      coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type)
    )=v_specialty_key;

  if v_count<>1 then
    return jsonb_build_object(
      'success',false,
      'code',case when v_count=0 then 'GROUP_RATE_PLAN_MISSING' else 'GROUP_RATE_PLAN_AMBIGUOUS' end
    );
  end if;

  select plan.* into v_plan
  from public.patient_financial_plans plan
  where plan.organization_id=p_organization_id
    and plan.patient_id=p_patient_id
    and plan.status='ACTIVE'
    and plan.billing_mode='PRIVATE'
    and plan.valid_from<=p_scheduled_at
    and (plan.valid_until is null or p_scheduled_at<plan.valid_until)
    and (plan.package_valid_until is null or plan.package_valid_until>=(p_scheduled_at at time zone (select clinic.timezone from public.clinics clinic where clinic.id=p_organization_id))::date)
    and public.appointment_financial_service_key_v1(
      coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type)
    )=v_specialty_key;

  if coalesce(v_plan.group_amount_cents,0)<=0 then
    return jsonb_build_object('success',false,'code','GROUP_RATE_NOT_CONFIGURED');
  end if;

  return jsonb_build_object(
    'success',true,
    'organization_id',p_organization_id,
    'patient_id',p_patient_id,
    'modality','GROUP',
    'financial_plan_id',v_plan.id,
    'logical_plan_id',v_plan.logical_plan_id,
    'financial_plan_version',v_plan.version,
    'group_amount_cents',v_plan.group_amount_cents
  );
end;
$$;

revoke all on function public.resolve_group_patient_private_rate_v1(uuid,uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.resolve_group_patient_private_rate_v1(uuid,uuid,text,timestamptz)
  to service_role;

-- Source: 20261015183500_group_financial_rate_atomic_update.sql; sha256 6c5d80a87aafc1cd7f868ae0f9bf6edddc207c27c601dd084c01fc6ebd32ea6e

-- Atomic group rate mutation for a single PRIVATE specialty plan.
-- Called by a capability-checked backend route, never directly by browser clients.
-- Depends on 20261015162000_group_session_specialty_rates.sql.

create or replace function public.update_patient_specialty_group_rate_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_plan_id uuid,
  p_actor_id uuid,
  p_group_amount_cents integer
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_requested public.patient_financial_plans%rowtype;
  v_current public.patient_financial_plans%rowtype;
  v_plans jsonb;
  v_result jsonb;
begin
  if p_organization_id is null or p_patient_id is null or p_plan_id is null or p_actor_id is null
    or p_group_amount_cents is null or p_group_amount_cents < 0 or p_group_amount_cents > 1000000000 then
    return jsonb_build_object('success',false,'code','GROUP_RATE_INPUT_INVALID');
  end if;

  if not exists (select 1 from public.clinic_memberships membership
    where membership.clinic_id=p_organization_id
      and membership.user_id=p_actor_id
      and lower(membership.status)='active') then
    return jsonb_build_object('success',false,'code','GROUP_RATE_ACTOR_DENIED');
  end if;
  if not exists (select 1 from public.patients patient
    where patient.id=p_patient_id and patient.clinic_id=p_organization_id) then
    return jsonb_build_object('success',false,'code','GROUP_RATE_PATIENT_OUT_OF_SCOPE');
  end if;

  -- Reuse the reconciliation lock so no concurrent global patient Save may
  -- overwrite this rate. All rate changes preserve the canonical plan history.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_patient_id::text,0));

  select plan.* into v_requested
  from public.patient_financial_plans plan
  where plan.id=p_plan_id
    and plan.organization_id=p_organization_id
    and plan.patient_id=p_patient_id
  for update;
  if not found then
    return jsonb_build_object('success',false,'code','GROUP_RATE_PLAN_NOT_FOUND');
  end if;
  if v_requested.billing_mode<>'PRIVATE' then
    return jsonb_build_object('success',false,'code','GROUP_RATE_ONLY_PRIVATE_PLANS');
  end if;

  select plan.* into v_current
  from public.patient_financial_plans plan
  where plan.organization_id=p_organization_id
    and plan.patient_id=p_patient_id
    and plan.logical_plan_id=coalesce(v_requested.logical_plan_id,v_requested.id)
    and plan.status='ACTIVE'
  order by plan.version desc,plan.created_at desc
  limit 1
  for update;

  if v_current.id is null then
    return jsonb_build_object('success',false,'code','GROUP_RATE_ACTIVE_PLAN_NOT_FOUND');
  end if;
  if v_current.id <> p_plan_id then
    -- Network retry after a versioned save is harmless if the requested rate
    -- already matches; otherwise reject an old editor instead of overwriting it.
    if v_current.group_amount_cents is not distinct from p_group_amount_cents then
      return jsonb_build_object(
        'success',true,'financial_plan_id',v_current.id,
        'group_amount_cents',v_current.group_amount_cents,
        'version',v_current.version,'unchanged',true
      );
    end if;
    return jsonb_build_object('success',false,'code','GROUP_RATE_STALE_PLAN');
  end if;

  if v_current.group_amount_cents is not distinct from p_group_amount_cents then
    return jsonb_build_object(
      'success',true,'financial_plan_id',v_current.id,
      'group_amount_cents',v_current.group_amount_cents,
      'version',v_current.version,'unchanged',true
    );
  end if;

  -- One nested, transaction-local reconciliation call. INSURANCE plans are
  -- deliberately excluded and preserved by the existing v2 RPC contract.
  select coalesce(jsonb_agg(
      to_jsonb(plan) || case when plan.id=p_plan_id
        then jsonb_build_object('group_amount_cents',p_group_amount_cents)
        else '{}'::jsonb end
      order by plan.created_at,plan.id
    ),'[]'::jsonb)
    into v_plans
  from public.patient_financial_plans plan
  where plan.organization_id=p_organization_id
    and plan.patient_id=p_patient_id
    and plan.status='ACTIVE'
    and plan.billing_mode<>'INSURANCE';

  v_result:=public.reconcile_patient_financial_plans_v2(
    p_organization_id,p_patient_id,p_actor_id,v_plans,true
  );
  if coalesce((v_result->>'success')::boolean,false) is not true then
    raise exception 'GROUP_RATE_RECONCILIATION_FAILED';
  end if;

  select plan.* into v_current
  from public.patient_financial_plans plan
  where plan.organization_id=p_organization_id
    and plan.patient_id=p_patient_id
    and plan.logical_plan_id=coalesce(v_requested.logical_plan_id,v_requested.id)
    and plan.status='ACTIVE'
  order by plan.version desc,plan.created_at desc
  limit 1;

  if v_current.id is null or v_current.group_amount_cents is distinct from p_group_amount_cents then
    raise exception 'GROUP_RATE_PERSISTENCE_VERIFY_FAILED';
  end if;
  return jsonb_build_object(
    'success',true,'financial_plan_id',v_current.id,
    'group_amount_cents',v_current.group_amount_cents,
    'version',v_current.version,'unchanged',false
  );
end;
$$;

revoke all on function public.update_patient_specialty_group_rate_v1(uuid,uuid,uuid,uuid,integer)
  from public,anon,authenticated;
grant execute on function public.update_patient_specialty_group_rate_v1(uuid,uuid,uuid,uuid,integer)
  to service_role;

-- Source: 20261015211500_group_session_booking_ledger.sql; sha256 8b8d640490e6b75c6db2fda4555ad6f263765f8d07a45d89ca92884164e0ef67

-- Canonical identity and idempotency ledger for ONE collective appointment slot.
-- Draft foundation only: the transactional booking/finance RPC must be completed
-- before this migration is applied or routes are enabled.

create table if not exists public.group_session_bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  booking_key text not null,
  payload_hash text not null,
  specialty text not null,
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz not null,
  room_id uuid not null references public.clinic_rooms(id) on delete restrict,
  professional_ids uuid[] not null,
  status text not null default 'RESERVED',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_session_booking_key_valid check (length(booking_key) between 12 and 120 and booking_key ~ '^[A-Za-z0-9:._-]+$'),
  constraint group_session_booking_hash_valid check (payload_hash ~ '^[a-f0-9]{64}$'),
  constraint group_session_booking_specialty_valid check (length(btrim(specialty)) between 2 and 120),
  constraint group_session_booking_time_valid check (scheduled_end_at > scheduled_start_at and scheduled_end_at <= scheduled_start_at + interval '360 minutes'),
  constraint group_session_booking_team_size_valid check (cardinality(professional_ids) between 1 and 8),
  constraint group_session_booking_status_valid check (status in ('RESERVED','COMPLETED','CANCELED')),
  constraint group_session_booking_idempotent unique (organization_id,booking_key),
  constraint group_session_booking_tenant_key unique (id,organization_id)
);

-- The booking header must never bind a room or professional from another
-- clinic. Its identity/slot is immutable; rescheduling will require its own
-- atomic operation, not arbitrary edits of the ledger row.
create or replace function public.verify_group_session_booking_v1()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_capacity integer;
  v_team_count integer;
  v_authorized_count integer;
begin
  if tg_op = 'UPDATE' and (
      old.id is distinct from new.id or
      old.created_at is distinct from new.created_at or
      old.organization_id is distinct from new.organization_id or
      old.booking_key is distinct from new.booking_key or
      old.payload_hash is distinct from new.payload_hash or
      old.specialty is distinct from new.specialty or
      old.room_id is distinct from new.room_id or
      old.scheduled_start_at is distinct from new.scheduled_start_at or
      old.scheduled_end_at is distinct from new.scheduled_end_at or
      old.professional_ids is distinct from new.professional_ids or
      old.created_by is distinct from new.created_by
  ) then raise exception 'GROUP_BOOKING_SLOT_IMMUTABLE'; end if;
  -- Cancellation/completion must remain possible after a room or member is
  -- deactivated. Only INSERT needs current availability/membership checks.
  if tg_op = 'UPDATE' then
    if old.status is distinct from new.status and
       not (old.status = 'RESERVED' and new.status in ('COMPLETED','CANCELED')) then
      raise exception 'GROUP_BOOKING_STATUS_TRANSITION_INVALID';
    end if;
    return new;
  end if;

  select room.capacity into v_capacity
  from public.clinic_rooms room
  where room.id = new.room_id
    and room.clinic_id = new.organization_id
    and room.is_active = true;
  if v_capacity is null or v_capacity < 2 then
    raise exception 'GROUP_BOOKING_ROOM_SCOPE_INVALID';
  end if;
  if not exists (
    select 1 from public.clinic_memberships actor_membership
    where actor_membership.clinic_id = new.organization_id
      and actor_membership.user_id = new.created_by
      and lower(actor_membership.status) = 'active'
  ) then raise exception 'GROUP_BOOKING_ACTOR_SCOPE_INVALID'; end if;

  select count(distinct requested_id)::integer into v_team_count
  from unnest(new.professional_ids) requested_id;
  if v_team_count <> cardinality(new.professional_ids) then
    raise exception 'GROUP_BOOKING_TEAM_DUPLICATED';
  end if;

  select count(distinct membership.user_id)::integer into v_authorized_count
  from public.clinic_memberships membership
  where membership.clinic_id = new.organization_id
    and membership.user_id = any(new.professional_ids)
    and lower(membership.status) = 'active'
    and lower(membership.role) = 'therapist'
    and public.appointment_financial_service_key_v1(membership.specialty)
      = public.appointment_financial_service_key_v1(new.specialty);
  if v_authorized_count <> cardinality(new.professional_ids) then
    raise exception 'GROUP_BOOKING_PROFESSIONAL_SCOPE_INVALID';
  end if;
  return new;
end;
$$;

drop trigger if exists group_booking_verify_scope on public.group_session_bookings;
create trigger group_booking_verify_scope
before insert or update on public.group_session_bookings
for each row execute function public.verify_group_session_booking_v1();

-- A record per patient connects the collective booking to the existing
-- independently auditable clinical appointment and its frozen patient rate.
create table if not exists public.group_session_participants (
  booking_id uuid not null,
  organization_id uuid not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  appointment_id uuid not null unique references public.appointments(id) on delete restrict,
  financial_plan_id uuid not null references public.patient_financial_plans(id) on delete restrict,
  unit_amount_cents integer not null,
  created_at timestamptz not null default now(),
  constraint group_session_participant_booking_scope foreign key (booking_id,organization_id)
    references public.group_session_bookings(id,organization_id) on delete restrict,
  constraint group_session_participant_amount_valid check (unit_amount_cents between 1 and 1000000000),
  constraint group_session_participant_one_per_patient primary key (booking_id,patient_id)
);

-- Backend validation is mandatory, but cross-tenant and mismatched appointment
-- references must also fail in the database, not just in TypeScript.
create or replace function public.verify_group_session_participant_v1()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_booking public.group_session_bookings%rowtype;
  v_room_capacity integer;
  v_participant_count integer;
begin
  select * into v_booking
  from public.group_session_bookings
  where id = new.booking_id and organization_id = new.organization_id
  for update;
  if not found or v_booking.status <> 'RESERVED' then
    raise exception 'GROUP_PARTICIPANT_BOOKING_SCOPE_INVALID';
  end if;

  -- All joins of a booking serialize on the same header lock.
  select room.capacity into v_room_capacity from public.clinic_rooms room
  where room.id=v_booking.room_id and room.clinic_id=new.organization_id and room.is_active=true;
  if v_room_capacity is null or v_room_capacity < 2 then
    raise exception 'GROUP_PARTICIPANT_ROOM_UNAVAILABLE';
  end if;
  select count(*)::integer into v_participant_count
  from public.group_session_participants existing where existing.booking_id=new.booking_id;
  if v_participant_count >= 30 then
    raise exception 'GROUP_PARTICIPANT_CAPACITY_EXCEEDED';
  end if;
  if v_participant_count >= v_room_capacity then
    raise exception 'GROUP_PARTICIPANT_ROOM_CAPACITY_EXCEEDED';
  end if;

  if not exists (
    select 1 from public.patients patient
    where patient.id = new.patient_id and patient.clinic_id = new.organization_id
  ) then raise exception 'GROUP_PARTICIPANT_PATIENT_SCOPE_INVALID'; end if;

  if not exists (
    select 1 from public.patient_financial_plans plan
    where plan.id = new.financial_plan_id
      and plan.organization_id = new.organization_id
      and plan.patient_id = new.patient_id
      and plan.billing_mode = 'PRIVATE'
      and plan.status = 'ACTIVE'
      and public.appointment_financial_service_key_v1(
        coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type)
      ) = public.appointment_financial_service_key_v1(v_booking.specialty)
      and plan.group_amount_cents = new.unit_amount_cents
      and plan.valid_from <= v_booking.scheduled_start_at
      and (plan.valid_until is null or v_booking.scheduled_start_at < plan.valid_until)
  ) then raise exception 'GROUP_PARTICIPANT_RATE_SCOPE_INVALID'; end if;

  if not exists (
    select 1 from public.appointments appointment
    where appointment.id = new.appointment_id
      and appointment.clinic_id = new.organization_id
      and appointment.patient_id = new.patient_id
      and appointment.deleted_at is null
      and coalesce(appointment.is_active,true)=true
      and lower(coalesce(appointment.status,'')) in ('scheduled','pending','confirmed')
      and appointment.room_id = v_booking.room_id::text
      and appointment.location_type = 'clinica'
      and appointment.therapist_id = any(v_booking.professional_ids)
      and public.appointment_financial_service_key_v1(appointment.service_type)
        = public.appointment_financial_service_key_v1(v_booking.specialty)
      and coalesce(appointment.scheduled_duration_minutes,appointment.duration_minutes)
        = extract(epoch from (v_booking.scheduled_end_at-v_booking.scheduled_start_at))::integer / 60
      and coalesce(appointment.scheduled_start_at,appointment.scheduled_at) = v_booking.scheduled_start_at
      and appointment.scheduled_end_at = v_booking.scheduled_end_at
      and appointment.source_payload->>'sessionGroupId' = new.booking_id::text
      and appointment.source_payload->>'sessionModality' = 'GROUP'
      and jsonb_typeof(appointment.source_payload->'professionalIds') = 'array'
      and jsonb_array_length(appointment.source_payload->'professionalIds') = cardinality(v_booking.professional_ids)
      and appointment.source_payload->'professionalIds' @> to_jsonb(v_booking.professional_ids)
  ) then raise exception 'GROUP_PARTICIPANT_APPOINTMENT_SCOPE_INVALID'; end if;

  return new;
end;
$$;

drop trigger if exists group_participant_verify_scope on public.group_session_participants;
create trigger group_participant_verify_scope
before insert on public.group_session_participants
for each row execute function public.verify_group_session_participant_v1();

create index if not exists group_session_bookings_by_clinic_time
  on public.group_session_bookings(organization_id,scheduled_start_at);
create index if not exists group_session_participants_by_clinic_patient
  on public.group_session_participants(organization_id,patient_id,booking_id);

alter table public.group_session_bookings enable row level security;
alter table public.group_session_participants enable row level security;
revoke all on table public.group_session_bookings from public,anon,authenticated;
revoke all on table public.group_session_participants from public,anon,authenticated;
revoke all on function public.verify_group_session_booking_v1() from public,anon,authenticated;
revoke all on function public.verify_group_session_participant_v1() from public,anon,authenticated;
grant select,insert,update on table public.group_session_bookings to service_role;
grant select,insert on table public.group_session_participants to service_role;

comment on table public.group_session_bookings is 'Internal group-booking ledger; no booking exists until an atomic backend RPC commits all patient appointments and financial snapshots.';
comment on table public.group_session_participants is 'Tenant-scoped per-patient links to the clinical appointment and agreed group price; service-role writes only.';

-- Source: 20261015225500_group_session_transactional_slot_guards.sql; sha256 d904eee24c5fe07bbf1b541d4220c40a9a76cea04facac31277fe40a8f6e8169

-- Additional tenant-scoped transactional collision guards for draft GROUP ledger.
-- Depends on 20261015211500_group_session_booking_ledger.sql.
-- Remains UNDEPLOYED until the complete booking + finance transaction exists.
-- Clinic-wide advisory lock serializes GROUP vs GROUP creation and joining.
-- Individual appointment writers must participate in the same locking protocol
-- before any group-creation API is exposed; this is not a standalone reservation API.

create or replace function public.guard_group_booking_slot_v1()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_room_blocks boolean;
  v_other record;
  v_team jsonb;
  v_field text;
  v_professional_text_ids text[];
begin
  if tg_op <> 'INSERT' then return new; end if;
  if new.organization_id is null or new.scheduled_end_at <= new.scheduled_start_at then
    raise exception 'GROUP_BOOKING_SLOT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:' || new.organization_id::text, 0));

  select coalesce(room.prevent_overlapping_appointments,true) into v_room_blocks
  from public.clinic_rooms room
  where room.id = new.room_id and room.clinic_id = new.organization_id and room.is_active = true;
  if not found then raise exception 'GROUP_BOOKING_ROOM_SCOPE_INVALID'; end if;
  v_professional_text_ids := array(select professional_id::text from unnest(new.professional_ids) professional_id);

  -- The lock also protects against two concurrent GROUP headers with
  -- different idempotency keys but overlapping team/room.
  if exists (
    select 1 from public.group_session_bookings booking
    where booking.organization_id = new.organization_id
      and booking.status in ('RESERVED','COMPLETED')
      and booking.scheduled_start_at < new.scheduled_end_at
      and booking.scheduled_end_at > new.scheduled_start_at
      and (booking.professional_ids && new.professional_ids or
           (v_room_blocks and booking.room_id = new.room_id))
  ) then raise exception 'GROUP_BOOKING_SLOT_BUSY'; end if;

  -- Existing clinical appointments, including secondary professionals stored
  -- in source_payload, must also block conflicting new group reservations.
  for v_other in
    select a.id,a.room_id,a.therapist_id,a.source_payload
    from public.appointments a
    where a.clinic_id = new.organization_id
      and a.deleted_at is null and coalesce(a.is_active,true) = true
      and lower(coalesce(a.status,'')) in (
        'pending','pendente','scheduled','agendada','agendado',
        'confirmed','confirmada','confirmado','in_progress','em_andamento',
        'completed','concluida','concluido','realizada','realizado',
        'cancel_requested','cancelamento_solicitado',
        'reschedule_requested','remarcacao_solicitada',
        'rescheduled_active','remarcada_ativa','remarcado_ativo'
      )
      and coalesce(a.scheduled_start_at,a.scheduled_at) < new.scheduled_end_at
      and coalesce(
        a.scheduled_end_at,
        coalesce(a.scheduled_start_at,a.scheduled_at)
          + coalesce(a.scheduled_duration_minutes,a.duration_minutes,50) * interval '1 minute'
      ) > new.scheduled_start_at
  loop
    if v_other.therapist_id = any(new.professional_ids) then
      raise exception 'GROUP_BOOKING_PROFESSIONAL_BUSY';
    end if;
    if v_room_blocks and v_other.room_id = new.room_id::text then
      raise exception 'GROUP_BOOKING_ROOM_BUSY';
    end if;

    v_team := coalesce(v_other.source_payload,'{}'::jsonb);
    if jsonb_typeof(v_team) <> 'object' then
      raise exception 'GROUP_BOOKING_TEAM_UNVERIFIABLE';
    end if;
    foreach v_field in array array[
      'professionalIds','professional_ids','teamProfessionalIds','team_professional_ids'
    ] loop
      if not v_team ? v_field then continue; end if;
      if jsonb_typeof(v_team->v_field) <> 'array' then
        raise exception 'GROUP_BOOKING_TEAM_UNVERIFIABLE';
      end if;
      if exists (select 1 from jsonb_array_elements(v_team->v_field) as team_entry(value)
                 where jsonb_typeof(team_entry.value) <> 'string') then
        raise exception 'GROUP_BOOKING_TEAM_UNVERIFIABLE';
      end if;
      if (array(select jsonb_array_elements_text(v_team->v_field)) && v_professional_text_ids) then
        raise exception 'GROUP_BOOKING_PROFESSIONAL_BUSY';
      end if;
    end loop;
  end loop;
  return new;
end;
$$;

-- Alphabetical order: the existing verification trigger runs first, then this guard.
drop trigger if exists group_booking_z_slot_guard on public.group_session_bookings;
create trigger group_booking_z_slot_guard
before insert on public.group_session_bookings
for each row execute function public.guard_group_booking_slot_v1();

create or replace function public.guard_group_participant_slot_v1()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_booking public.group_session_bookings%rowtype;
begin
  -- Using the exact same lock protects concurrent joins of DIFFERENT groups.
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:' || new.organization_id::text,0));
  select * into v_booking from public.group_session_bookings booking
  where booking.id=new.booking_id and booking.organization_id=new.organization_id
  for update;
  if not found or v_booking.status <> 'RESERVED' then
    raise exception 'GROUP_PARTICIPANT_BOOKING_SCOPE_INVALID';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.clinic_id=new.organization_id
      and a.patient_id=new.patient_id and a.id <> new.appointment_id
      and a.deleted_at is null and coalesce(a.is_active,true) = true
      and lower(coalesce(a.status,'')) in (
        'pending','pendente','scheduled','agendada','agendado',
        'confirmed','confirmada','confirmado','in_progress','em_andamento',
        'completed','concluida','concluido','realizada','realizado',
        'cancel_requested','cancelamento_solicitado',
        'reschedule_requested','remarcacao_solicitada',
        'rescheduled_active','remarcada_ativa','remarcado_ativo'
      )
      and coalesce(a.scheduled_start_at,a.scheduled_at) < v_booking.scheduled_end_at
      and coalesce(
        a.scheduled_end_at,
        coalesce(a.scheduled_start_at,a.scheduled_at)
          + coalesce(a.scheduled_duration_minutes,a.duration_minutes,50) * interval '1 minute'
      ) > v_booking.scheduled_start_at
  ) then raise exception 'GROUP_PARTICIPANT_PATIENT_BUSY'; end if;
  return new;
end;
$$;

-- Must precede existing participant scope verification so clinic lock is
-- obtained before its booking-row lock, avoiding inconsistent lock order.
drop trigger if exists group_participant_a_slot_guard on public.group_session_participants;
create trigger group_participant_a_slot_guard
before insert on public.group_session_participants
for each row execute function public.guard_group_participant_slot_v1();

revoke all on function public.guard_group_booking_slot_v1() from public,anon,authenticated;
revoke all on function public.guard_group_participant_slot_v1() from public,anon,authenticated;

-- Source: 20261016005000_group_receivable_date_dependency.sql; sha256 13482a5d80c293358ea6ff586295ab76a15d243096e8c2617e13637e25119ae3

-- Canonical finance functions create unpaid forecasts with payment_date=NULL
-- and an optional expected method. Staging retained legacy NOT NULL columns,
-- which reject those functions before a GROUP reservation can commit.
-- Preserve every stored value/default and keep settled receipts constrained.

alter table public.payments alter column payment_date drop not null;
alter table public.payments alter column method drop not null;
alter table public.payments add constraint payments_settled_receipt_fields_required
check (
  (payment_date is not null and method is not null)
  or (
    coalesce(paid_amount,0)=0 and coalesce(refunded_amount,0)=0
    and lower(coalesce(status,'')) not in ('paid','pago','received','recebido','refunded','reembolsado')
  )
) not valid;

-- Source: 20261016010000_group_session_financial_snapshot.sql; sha256 a862fa207747aa863ae7da949034fa48fbe9dfc75df46d95a8bb56fe40d8e9af

-- Independent GROUP rate with existing due date/cancellation/no-show policy.
-- Individual pricing function is deliberately untouched.

CREATE OR REPLACE FUNCTION public.resolve_group_private_session_price_v1(p_organization_id uuid, p_patient_id uuid, p_specialty text, p_service_catalog_id uuid, p_scheduled_at timestamp with time zone, p_care_setting text, p_manual_amount numeric, p_discount_amount numeric, p_zero_classification text, p_override_reason text, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_group_rate jsonb;
  v_group_timezone text;
  v_patient public.patients%rowtype;
  v_service public.tuss_service_catalog%rowtype;
  v_rule public.private_session_price_rules%rowtype;
  v_agreement public.patient_private_pricing_agreements%rowtype;
  v_legacy_plan public.patient_financial_plans%rowtype;
  v_actor_role text;
  v_specialty text := nullif(trim(coalesce(p_specialty, '')), '');
  v_specialty_key text := lower(nullif(trim(coalesce(p_specialty, '')), ''));
  v_care_setting text := upper(coalesce(nullif(trim(p_care_setting), ''), 'CLINIC'));
  v_session_date date;
  v_base numeric(14,2);
  v_surcharge numeric(14,2) := 0;
  v_discount numeric(14,2) := 0;
  v_final numeric(14,2);
  v_price_source text;
  v_price_source_label text;
  v_payer_id uuid;
  v_payer_name text;
  v_due_rule text;
  v_due_offset_days integer;
  v_due_day integer;
  v_due_date date;
  v_cancellation_free_value integer;
  v_cancellation_free_unit text;
  v_cancellation_free_until timestamptz;
  v_late_type text;
  v_late_value numeric(14,2);
  v_no_show_type text;
  v_no_show_value numeric(14,2);
  v_expected_payment_method text;
  v_allow_partial boolean;
  v_allowed_methods text[];
  v_allow_manual boolean;
  v_discount_approval boolean;
  v_duration integer;
  v_classification text := 'STANDARD';
  v_override_reason text := nullif(trim(coalesce(p_override_reason, '')), '');
  v_policy jsonb := '{}'::jsonb;
  v_missing_price_explicit boolean := false;
begin
  if p_organization_id is null or p_patient_id is null or p_scheduled_at is null then
    raise exception 'PRIVATE_SESSION_SCOPE_DATE_REQUIRED';
  end if;

  select patient.* into v_patient
  from public.patients patient
  where patient.id = p_patient_id
    and patient.clinic_id = p_organization_id
    and coalesce(patient.is_active, true) = true
    and patient.deleted_at is null
  limit 1;
  if v_patient.id is null then
    raise exception 'PRIVATE_SESSION_PATIENT_SCOPE_INVALID';
  end if;

  if p_actor_id is not null then
    v_actor_role := public.private_finance_actor_role_v2(p_actor_id, p_organization_id);
  end if;

  if p_service_catalog_id is not null then
    select service.* into v_service
    from public.tuss_service_catalog service
    where service.id = p_service_catalog_id
      and service.organization_id = p_organization_id
      and service.active = true
    limit 1;
    if v_service.id is null then
      raise exception 'PRIVATE_SESSION_SERVICE_SCOPE_INVALID';
    end if;
    v_specialty := coalesce(v_specialty, nullif(trim(v_service.specialty), ''), nullif(trim(v_service.service_type), ''));
    v_specialty_key := lower(v_specialty);
  end if;

  select timezone into strict v_group_timezone from public.clinics where id=p_organization_id;
  v_session_date := (p_scheduled_at at time zone v_group_timezone)::date;

  select rule.* into v_rule
  from public.private_session_price_rules rule
  where rule.organization_id = p_organization_id
    and rule.active = true
    and rule.valid_from <= v_session_date
    and (rule.valid_until is null or rule.valid_until >= v_session_date)
    and (
      (p_service_catalog_id is not null and rule.scope_type = 'SERVICE' and rule.service_catalog_id = p_service_catalog_id)
      or (rule.scope_type = 'SPECIALTY' and lower(rule.specialty_key) = v_specialty_key)
      or rule.scope_type = 'CLINIC_DEFAULT'
    )
  order by
    case
      when p_service_catalog_id is not null and rule.scope_type = 'SERVICE' and rule.service_catalog_id = p_service_catalog_id then 1
      when rule.scope_type = 'SPECIALTY' and lower(rule.specialty_key) = v_specialty_key then 2
      else 3
    end,
    rule.valid_from desc,
    rule.version desc,
    rule.created_at desc
  limit 1;

  -- Group price authority is independent from every individual agreement,
  -- manual amount, fallback rule and unrelated specialty.
  if p_service_catalog_id is not null or p_manual_amount is not null
     or coalesce(p_discount_amount,0) <> 0 or p_zero_classification is not null
     or upper(coalesce(p_care_setting,'CLINIC')) <> 'CLINIC' then
    raise exception 'GROUP_PRICE_OVERRIDE_FORBIDDEN';
  end if;
  v_group_rate := public.resolve_group_patient_private_rate_v1(
    p_organization_id,p_patient_id,p_specialty,p_scheduled_at
  );
  if not coalesce((v_group_rate->>'success')::boolean,false) then
    raise exception '%', coalesce(v_group_rate->>'code','GROUP_RATE_NOT_CONFIGURED');
  end if;
  select * into strict v_legacy_plan from public.patient_financial_plans
  where id=(v_group_rate->>'financial_plan_id')::uuid
    and organization_id=p_organization_id and patient_id=p_patient_id;
  v_base := round(v_legacy_plan.group_amount_cents::numeric/100,2);
  v_price_source := 'LEGACY_PATIENT_PLAN';
  v_price_source_label := 'plano coletivo da especialidade do paciente';
  v_payer_id := v_legacy_plan.payer_id;
  v_payer_name := nullif(trim(v_legacy_plan.payer_name_snapshot),'');

  v_policy := coalesce(v_agreement.policy_overrides, '{}'::jsonb);
  v_due_rule := upper(coalesce(
    nullif(v_policy->>'dueRule', ''),
    nullif(v_policy->>'due_rule', ''),
    v_rule.due_rule,
    case when v_legacy_plan.due_day is not null then 'FIXED_DAY' end,
    'SESSION_DATE'
  ));
  v_due_offset_days := greatest(coalesce(
    nullif(v_policy->>'dueOffsetDays', '')::integer,
    nullif(v_policy->>'due_offset_days', '')::integer,
    v_rule.due_offset_days,
    0
  ), 0);
  v_due_day := coalesce(
    nullif(v_policy->>'dueDay', '')::integer,
    nullif(v_policy->>'due_day', '')::integer,
    v_rule.due_day,
    v_legacy_plan.due_day
  );
  v_cancellation_free_value := greatest(coalesce(
    nullif(v_policy->>'cancellationFreeValue', '')::integer,
    nullif(v_policy->>'cancellation_free_value', '')::integer,
    v_rule.cancellation_free_value,
    0
  ), 0);
  v_cancellation_free_unit := upper(coalesce(
    nullif(v_policy->>'cancellationFreeUnit', ''),
    nullif(v_policy->>'cancellation_free_unit', ''),
    v_rule.cancellation_free_unit,
    'HOURS'
  ));
  v_late_type := upper(coalesce(
    nullif(v_policy #>> '{lateCancellation,type}', ''),
    nullif(v_policy #>> '{late_cancellation,type}', ''),
    v_rule.late_cancellation_type,
    'NO_CHARGE'
  ));
  v_late_value := greatest(coalesce(
    nullif(v_policy #>> '{lateCancellation,value}', '')::numeric,
    nullif(v_policy #>> '{late_cancellation,value}', '')::numeric,
    v_rule.late_cancellation_value,
    0
  ), 0);
  v_no_show_type := upper(coalesce(
    nullif(v_policy #>> '{noShow,type}', ''),
    nullif(v_policy #>> '{no_show,type}', ''),
    v_rule.no_show_type,
    'NO_CHARGE'
  ));
  v_no_show_value := greatest(coalesce(
    nullif(v_policy #>> '{noShow,value}', '')::numeric,
    nullif(v_policy #>> '{no_show,value}', '')::numeric,
    v_rule.no_show_value,
    0
  ), 0);
  v_expected_payment_method := coalesce(
    nullif(v_policy->>'expectedPaymentMethod', ''),
    nullif(v_policy->>'expected_payment_method', ''),
    v_legacy_plan.payment_method,
    v_rule.expected_payment_method
  );
  v_allow_partial := coalesce(
    nullif(v_policy->>'allowPartialPayment', '')::boolean,
    nullif(v_policy->>'allow_partial_payment', '')::boolean,
    v_rule.allow_partial_payment,
    true
  );
  v_allowed_methods := coalesce(v_rule.allowed_payment_methods, array['pix', 'cash', 'card', 'transfer', 'boleto', 'other']::text[]);
  v_allow_manual := coalesce(v_rule.allow_manual_override, v_missing_price_explicit, false);
  v_discount_approval := coalesce(v_rule.discount_approval_required, true);
  v_duration := coalesce(v_rule.default_duration_minutes, v_service.default_duration_minutes, 50);

  if v_care_setting in ('PATIENT_HOME', 'HOME', 'DOMICILIO') then
    v_surcharge := coalesce(v_agreement.home_surcharge, v_rule.home_surcharge, 0);
  elsif v_care_setting = 'SCHOOL' then
    v_surcharge := coalesce(v_agreement.school_surcharge, v_rule.school_surcharge, 0);
  end if;

  if p_manual_amount is not null then
    if p_manual_amount <= 0 then
      raise exception 'PRIVATE_SESSION_MANUAL_AMOUNT_INVALID';
    end if;
    if coalesce(v_actor_role, '') not in ('director', 'coordinator', 'receptionist') or not v_allow_manual then
      raise exception 'PRIVATE_SESSION_MANUAL_OVERRIDE_FORBIDDEN';
    end if;
    if v_override_reason is null then
      raise exception 'PRIVATE_SESSION_OVERRIDE_REASON_REQUIRED';
    end if;
    v_base := round(p_manual_amount, 2);
    v_price_source := 'MANUAL_OVERRIDE';
    v_price_source_label := 'valor manual autorizado';
  end if;

  if coalesce(p_discount_amount, 0) > 0 then
    if v_override_reason is null then
      raise exception 'PRIVATE_SESSION_DISCOUNT_REASON_REQUIRED';
    end if;
    if coalesce(v_actor_role, '') not in ('director', 'coordinator', 'receptionist') then
      raise exception 'PRIVATE_SESSION_DISCOUNT_FORBIDDEN';
    end if;
    if v_discount_approval and coalesce(v_actor_role, '') not in ('director', 'coordinator', 'receptionist') then
      raise exception 'PRIVATE_SESSION_DISCOUNT_APPROVAL_REQUIRED';
    end if;
    v_discount := v_discount + round(p_discount_amount, 2);
  end if;

  v_final := greatest(round(v_base + v_surcharge - v_discount, 2), 0);

  if nullif(trim(coalesce(p_zero_classification, '')), '') is not null then
    v_classification := upper(trim(p_zero_classification));
    if v_classification not in ('COURTESY', 'EXEMPT', 'CONTRACTUAL_FREE', 'OTHER_AUTHORIZED') then
      raise exception 'PRIVATE_SESSION_ZERO_CLASSIFICATION_INVALID';
    end if;
    if coalesce(v_actor_role, '') not in ('director', 'coordinator', 'receptionist') then
      raise exception 'PRIVATE_SESSION_ZERO_OVERRIDE_FORBIDDEN';
    end if;
    if v_override_reason is null then
      raise exception 'PRIVATE_SESSION_ZERO_REASON_REQUIRED';
    end if;
    v_final := 0;
    v_discount := v_base + v_surcharge;
  elsif v_final <= 0 and v_classification = 'STANDARD' then
    raise exception 'PRIVATE_SESSION_ZERO_JUSTIFICATION_REQUIRED';
  end if;

  if v_payer_id is not null then
    select payer.name into v_payer_name
    from public.clinic_payers payer
    where payer.id = v_payer_id
      and payer.organization_id = p_organization_id
    limit 1;
    if v_payer_name is null then
      raise exception 'PRIVATE_SESSION_PAYER_SCOPE_INVALID';
    end if;
  end if;
  v_payer_name := coalesce(
    nullif(trim(v_payer_name), ''),
    nullif(trim(v_patient.responsible_name), ''),
    nullif(trim(v_patient.name), '')
  );
  if v_payer_name is null then
    raise exception 'PRIVATE_SESSION_PAYER_REQUIRED';
  end if;

  v_due_date := public.private_session_due_date_v1(
    v_due_rule, v_due_offset_days, v_due_day, v_session_date
  );
  v_cancellation_free_until := p_scheduled_at - case
    when v_cancellation_free_unit = 'DAYS'
      then make_interval(days => v_cancellation_free_value)
    else make_interval(hours => v_cancellation_free_value)
  end;

  return jsonb_build_object(
    'valid', true,
    'session_modality', 'GROUP',
    'patient_name', v_patient.name,
    'organization_id', p_organization_id,
    'patient_id', p_patient_id,
    'specialty_key', v_specialty_key,
    'specialty_name', coalesce(v_specialty, v_rule.specialty_name, v_service.specialty),
    'service_catalog_id', v_service.id,
    'service_name', coalesce(v_service.name, v_agreement.service_name_snapshot, v_rule.service_name_snapshot),
    'payer_id', v_payer_id,
    'payer_name', v_payer_name,
    'base_amount', round(v_base, 2),
    'location_surcharge', round(v_surcharge, 2),
    'discount_amount', round(v_discount, 2),
    'final_amount', round(v_final, 2),
    'price_source', v_price_source,
    'price_source_label', v_price_source_label,
    'price_rule_id', v_rule.id,
    'patient_pricing_agreement_id', v_agreement.id,
    'legacy_patient_financial_plan_id', v_legacy_plan.id,
    'price_rule_version', v_rule.version,
    'price_rule_valid_from', v_rule.valid_from,
    'agreement_valid_from', v_agreement.valid_from,
    'due_date', v_due_date,
    'due_rule', v_due_rule,
    'due_offset_days', v_due_offset_days,
    'due_day', v_due_day,
    'cancellation_free_until', v_cancellation_free_until,
    'cancellation_free_value', v_cancellation_free_value,
    'cancellation_free_unit', v_cancellation_free_unit,
    'late_cancellation_rule', jsonb_build_object('type', v_late_type, 'value', v_late_value),
    'no_show_rule', jsonb_build_object('type', v_no_show_type, 'value', v_no_show_value),
    'care_setting', v_care_setting,
    'scheduled_at', p_scheduled_at,
    'default_duration_minutes', v_duration,
    'expected_payment_method', v_expected_payment_method,
    'allow_partial_payment', v_allow_partial,
    'allowed_payment_methods', to_jsonb(v_allowed_methods),
    'allow_manual_override', v_allow_manual,
    'discount_approval_required', v_discount_approval,
    'financial_classification', v_classification,
    'created_by', p_actor_id,
    'override_reason', v_override_reason,
    'currency', 'BRL',
    'timezone', v_group_timezone
  );
end;
$function$;

revoke all on function public.resolve_group_private_session_price_v1(uuid,uuid,text,uuid,timestamptz,text,numeric,numeric,text,text,uuid) from public,anon,authenticated;
grant execute on function public.resolve_group_private_session_price_v1(uuid,uuid,text,uuid,timestamptz,text,numeric,numeric,text,text,uuid) to service_role;

-- Source: 20261016020000_group_session_atomic_reservation.sql; sha256 cd27c61931160df21f8f067649470ca7f8a6eb42d68215a19098c3276acf48cf

-- One transaction owns canonical GROUP identity, patient appointments and finance.
-- Depends on all five 20261015 migrations and the GROUP snapshot resolver.

alter table public.group_session_bookings add column series_id uuid;
alter table public.group_session_bookings add column series_index integer;
alter table public.group_session_bookings add constraint group_session_series_valid
check ((series_id is null and series_index is null) or (series_id is not null and series_index between 1 and 12));
create unique index group_session_series_position on public.group_session_bookings(organization_id,series_id,series_index)
where series_id is not null;

create table public.group_session_operations (
  organization_id uuid not null references public.clinics(id),
  operation_key text not null check (operation_key ~ '^[A-Za-z0-9:._-]{12,120}$'),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  booking_ids uuid[] not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id,operation_key)
);
alter table public.group_session_operations enable row level security;
revoke all on public.group_session_operations from public,anon,authenticated;
grant select,insert on public.group_session_operations to service_role;

create or replace function public.group_session_result_v1(p_organization_id uuid,p_booking_ids uuid[])
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('success',true,'modality','GROUP','reserved',true,
    'sectionVersions',(select state.section_versions from public.clinic_state state where state.clinic_id=p_organization_id),
    'bookings',coalesce((select jsonb_agg(to_jsonb(b) order by b.scheduled_start_at,b.id)
      from public.group_session_bookings b where b.organization_id=p_organization_id and b.id=any(p_booking_ids)),'[]'::jsonb),
    'participants',coalesce((select jsonb_agg(to_jsonb(p) order by p.booking_id,p.patient_id)
      from public.group_session_participants p where p.organization_id=p_organization_id and p.booking_id=any(p_booking_ids)),'[]'::jsonb),
    'financialSnapshots',coalesce((select jsonb_agg(to_jsonb(latest)) from (
      select distinct on(snapshot.appointment_id) snapshot.appointment_id,snapshot.snapshot_version,
        snapshot.final_amount,snapshot.due_date,snapshot.cancellation_free_until,snapshot.late_cancellation_rule,
        snapshot.no_show_rule,snapshot.financial_classification,snapshot.timezone
      from public.appointment_private_financial_snapshots snapshot join public.group_session_participants participant
        on participant.appointment_id=snapshot.appointment_id and participant.organization_id=snapshot.organization_id
      where participant.organization_id=p_organization_id and participant.booking_id=any(p_booking_ids)
      order by snapshot.appointment_id,snapshot.snapshot_version desc
    ) latest),'[]'::jsonb),
    'appointments',coalesce((select jsonb_agg(to_jsonb(a) order by a.scheduled_at,a.id)
      from public.appointments a join public.group_session_participants p on p.appointment_id=a.id
      where p.organization_id=p_organization_id and a.clinic_id=p_organization_id and p.booking_id=any(p_booking_ids)),'[]'::jsonb)
  );
$$;

-- The same lock covers GROUP creation/join and every individual appointment
-- write. Individual-vs-individual behavior remains with its existing validators.
create or replace function public.guard_appointment_group_slot_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_booking public.group_session_bookings%rowtype;
  v_group_id uuid;
  v_team text[];
  v_start timestamptz := coalesce(new.scheduled_start_at,new.scheduled_at);
  v_end timestamptz := coalesce(new.scheduled_end_at,v_start+coalesce(new.scheduled_duration_minutes,new.duration_minutes,50)*interval '1 minute');
  v_field text;
  v_room_blocks boolean := true;
begin
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:'||new.clinic_id::text,0));
  if tg_op='UPDATE' and old.clinic_id is distinct from new.clinic_id
     and exists(select 1 from public.group_session_participants where appointment_id=old.id) then
    raise exception 'GROUP_APPOINTMENT_SCOPE_IMMUTABLE';
  end if;
  -- A linked appointment cannot be detached or repriced through a generic writer.
  if tg_op='UPDATE' and exists(select 1 from public.group_session_participants where appointment_id=old.id) then
    if old.patient_id is distinct from new.patient_id
      or old.organization_id is distinct from new.organization_id
      or old.source_payload->>'sessionGroupId' is distinct from new.source_payload->>'sessionGroupId'
      or old.source_payload->>'sessionModality' is distinct from new.source_payload->>'sessionModality'
      or old.source_payload->'professionalIds' is distinct from new.source_payload->'professionalIds'
      or old.source_payload->'privatePricingResolution' is distinct from new.source_payload->'privatePricingResolution'
      or old.source_payload->>'financialContextType' is distinct from new.source_payload->>'financialContextType'
      or old.source_payload->>'groupFinancialPlanId' is distinct from new.source_payload->>'groupFinancialPlanId' then
      raise exception 'GROUP_APPOINTMENT_FINANCE_IMMUTABLE';
    end if;
  end if;
  if upper(coalesce(new.source_payload->>'session_modality',''))='GROUP'
     and new.source_payload->>'sessionModality' is distinct from 'GROUP' then
    raise exception 'GROUP_APPOINTMENT_RPC_REQUIRED';
  end if;
  if upper(coalesce(new.source_payload->>'sessionModality',''))='GROUP' then
    if coalesce(new.source_payload->>'sessionGroupId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'GROUP_APPOINTMENT_ID_INVALID';
    end if;
    v_group_id:=(new.source_payload->>'sessionGroupId')::uuid;
    select * into v_booking from public.group_session_bookings b
    where b.id=v_group_id and b.organization_id=new.clinic_id;
    if not found or new.organization_id is distinct from new.clinic_id
      or new.room_id is distinct from v_booking.room_id::text
      or v_start is distinct from v_booking.scheduled_start_at
      or v_end is distinct from v_booking.scheduled_end_at
      or not(new.therapist_id=any(v_booking.professional_ids))
      or new.location_type is distinct from 'clinica' or new.care_setting is distinct from 'CLINIC'
      or new.source_payload->'professionalIds' is distinct from to_jsonb(v_booking.professional_ids)
      or public.appointment_financial_service_key_v1(new.service_type) is distinct from public.appointment_financial_service_key_v1(v_booking.specialty) then
      raise exception 'GROUP_APPOINTMENT_CANONICAL_SLOT_REQUIRED';
    end if;
    if (tg_op='INSERT' or old.source_payload->>'sessionModality' is distinct from 'GROUP') and (
      current_setting('verto.group_booking_id',true) is distinct from v_group_id::text
      or v_booking.status<>'RESERVED'
      or new.source_payload->>'financialContextType' is distinct from 'PRIVATE'
      or new.source_payload#>>'{privatePricingResolution,session_modality}' is distinct from 'GROUP'
    ) then raise exception 'GROUP_APPOINTMENT_RPC_REQUIRED'; end if;
  elsif (new.source_payload ? 'sessionGroupId' or new.source_payload ? 'session_group_id') then
    raise exception 'GROUP_APPOINTMENT_RPC_REQUIRED';
  end if;
  if new.deleted_at is not null or coalesce(new.is_active,true)=false
    or lower(coalesce(new.status,'')) not in (
      'pending','pendente','scheduled','agendada','agendado','confirmed','confirmada','confirmado',
      'in_progress','em_andamento','completed','concluida','concluido','realizada','realizado',
      'cancel_requested','cancelamento_solicitado','reschedule_requested','remarcacao_solicitada',
      'rescheduled_active','remarcada_ativa','remarcado_ativo') then return new; end if;
  v_team:=array[new.therapist_id::text];
  foreach v_field in array array['professionalIds','professional_ids','teamProfessionalIds','team_professional_ids'] loop
    if new.source_payload ? v_field and jsonb_typeof(new.source_payload->v_field)='array' then
      v_team:=v_team||array(select jsonb_array_elements_text(new.source_payload->v_field));
    end if;
  end loop;
  select coalesce(r.prevent_overlapping_appointments,true) into v_room_blocks
  from public.clinic_rooms r where r.id::text=new.room_id and r.clinic_id=new.clinic_id;
  if exists(select 1 from public.group_session_bookings b
    where b.organization_id=new.clinic_id and b.status in ('RESERVED','COMPLETED')
      and b.id is distinct from v_group_id
      and b.scheduled_start_at<v_end and b.scheduled_end_at>v_start
      and ((array(select x::text from unnest(b.professional_ids) x))&&v_team
        or (coalesce(v_room_blocks,true) and b.room_id::text=new.room_id))) then
    raise exception 'GROUP_BOOKING_SLOT_BUSY';
  end if;
  if exists(select 1 from public.group_session_participants p
    join public.appointments a on a.id=p.appointment_id
    where p.organization_id=new.clinic_id and p.patient_id=new.patient_id and a.id<>new.id
      and a.deleted_at is null and coalesce(a.is_active,true)
      and lower(a.status) in ('scheduled','pending','confirmed','in_progress','completed','cancel_requested','reschedule_requested')
      and coalesce(a.scheduled_start_at,a.scheduled_at)<v_end
      and coalesce(a.scheduled_end_at,coalesce(a.scheduled_start_at,a.scheduled_at)+coalesce(a.scheduled_duration_minutes,a.duration_minutes,50)*interval '1 minute')>v_start) then
    raise exception 'GROUP_PARTICIPANT_PATIENT_BUSY';
  end if;
  return new;
end;
$$;
create trigger appointment_a_group_slot_guard before insert or update on public.appointments
for each row execute function public.guard_appointment_group_slot_v1();

create or replace function public.reserve_group_sessions_v1(
  p_organization_id uuid,p_actor_id uuid,p_patient_ids uuid[],p_professional_ids uuid[],
  p_specialty text,p_room_id uuid,p_local_slots jsonb,p_duration_minutes integer,p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_patients uuid[];
  v_team uuid[];
  v_slot jsonb;
  v_start timestamptz;
  v_timezone text;
  v_hash text;
  v_team_names text[];
  v_changed_appointments uuid[]:=array[]::uuid[];
  v_previous public.group_session_operations%rowtype;
  v_booking public.group_session_bookings%rowtype;
  v_patient uuid;
  v_appointment uuid;
  v_resolution jsonb;
  v_plan uuid;
  v_cents integer;
  v_booking_ids uuid[]:=array[]::uuid[];
  v_index integer:=0;
  v_series uuid:=gen_random_uuid();
  v_room_capacity integer;
  v_room_name text;
  v_source jsonb;
begin
  perform 1 from public.clinic_memberships m where m.clinic_id=p_organization_id
    and m.user_id=p_actor_id and m.status='active' for share;
  if not found then raise exception 'GROUP_ACTOR_OUT_OF_SCOPE'; end if;
  if cardinality(p_patient_ids) not between 2 and 30 or cardinality(p_professional_ids) not between 1 and 8
    or p_patient_ids is null or p_professional_ids is null
    or jsonb_typeof(p_local_slots) is distinct from 'array'
    or p_duration_minutes is null or p_duration_minutes not between 15 and 360
    or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9:._-]{12,120}$'
    or length(btrim(coalesce(p_specialty,''))) not between 2 and 120 then raise exception 'GROUP_INPUT_INVALID'; end if;
  if jsonb_array_length(p_local_slots) not between 1 and 12
    or jsonb_array_length(p_local_slots)*cardinality(p_patient_ids)>120 then raise exception 'GROUP_RECURRENCE_LIMIT'; end if;
  select array_agg(x order by x) into v_patients from(select distinct x from unnest(p_patient_ids)x where x is not null)s;
  select array_agg(x order by x) into v_team from(select distinct x from unnest(p_professional_ids)x where x is not null)s;
  if cardinality(v_patients) is distinct from cardinality(p_patient_ids)
    or cardinality(v_team) is distinct from cardinality(p_professional_ids) then raise exception 'GROUP_DUPLICATED_IDS'; end if;
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:'||p_organization_id::text,0));
  v_hash:=encode(sha256(convert_to(jsonb_build_object('operation','CREATE','patients',v_patients,'team',v_team,
    'specialty',public.appointment_financial_service_key_v1(p_specialty),'room',p_room_id,
    'slots',p_local_slots,'duration',p_duration_minutes)::text,'UTF8')),'hex');
  select * into v_previous from public.group_session_operations
    where organization_id=p_organization_id and operation_key=p_idempotency_key;
  if found then
    if v_previous.payload_hash<>v_hash then raise exception 'GROUP_IDEMPOTENCY_CONFLICT'; end if;
    return public.group_session_result_v1(p_organization_id,v_previous.booking_ids)||jsonb_build_object('idempotent',true);
  end if;
  select timezone into strict v_timezone from public.clinics where id=p_organization_id;
  if not exists(select 1 from pg_timezone_names where name=v_timezone) then raise exception 'GROUP_TIMEZONE_INVALID'; end if;
  select capacity,name into v_room_capacity,v_room_name from public.clinic_rooms
    where id=p_room_id and clinic_id=p_organization_id and is_active for share;
  if not found or v_room_capacity<cardinality(v_patients) then raise exception 'GROUP_ROOM_CAPACITY_EXCEEDED'; end if;
  perform 1 from public.patients where id=any(v_patients) and clinic_id=p_organization_id
    order by id for share;
  if (select count(*) from public.patients where id=any(v_patients) and clinic_id=p_organization_id
       and deleted_at is null and coalesce(is_active,true))<>cardinality(v_patients) then raise exception 'GROUP_PATIENT_OUT_OF_SCOPE'; end if;
  -- Same patient locks as the financial-plan reconciler, in stable order.
  foreach v_patient in array v_patients loop
    perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_patient::text,0));
  end loop;
  perform 1 from public.patient_financial_plans where organization_id=p_organization_id
    and patient_id=any(v_patients) order by patient_id,id for share;
  select array_agg(coalesce(nullif(btrim(u.name),''),'Profissional') order by requested.professional_id) into v_team_names
  from unnest(v_team) requested(professional_id) left join public.users u on u.id=requested.professional_id;
  perform set_config('verto.group_bulk_operation','1',true);
  for v_slot in select value from jsonb_array_elements(p_local_slots) loop
    if coalesce(v_slot->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(v_slot->>'time','') !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'GROUP_SLOT_INVALID'; end if;
    v_start:=((v_slot->>'date')::date+(v_slot->>'time')::time) at time zone v_timezone;
    if to_char(v_start at time zone v_timezone,'YYYY-MM-DD HH24:MI') <> (v_slot->>'date')||' '||(v_slot->>'time') then
      raise exception 'GROUP_SLOT_TIMEZONE_INVALID'; end if;
    v_index:=v_index+1;
    insert into public.group_session_bookings(organization_id,booking_key,payload_hash,specialty,
      scheduled_start_at,scheduled_end_at,room_id,professional_ids,created_by,series_id,series_index)
    values(p_organization_id,case when jsonb_array_length(p_local_slots)=1 then p_idempotency_key else left(p_idempotency_key,110)||':slot:'||v_index end,
      v_hash,btrim(p_specialty),v_start,v_start+p_duration_minutes*interval '1 minute',p_room_id,v_team,p_actor_id,case when jsonb_array_length(p_local_slots)>1 then v_series end,
      case when jsonb_array_length(p_local_slots)>1 then v_index end)
    returning * into v_booking;
    v_booking_ids:=array_append(v_booking_ids,v_booking.id);
    perform set_config('verto.group_booking_id',v_booking.id::text,true);
    foreach v_patient in array v_patients loop
      v_resolution:=public.resolve_group_private_session_price_v1(p_organization_id,v_patient,p_specialty,null,
        v_start,'CLINIC',null,null,null,null,p_actor_id);
      v_plan:=(v_resolution->>'legacy_patient_financial_plan_id')::uuid;
      v_cents:=round((v_resolution->>'final_amount')::numeric*100)::integer;
      v_source:=jsonb_build_object('sessionModality','GROUP','sessionGroupId',v_booking.id,
        'professionalIds',to_jsonb(v_team),'groupFinancialPlanId',v_plan,'financialContextType','PRIVATE',
        'privatePricingResolution',v_resolution,'privatePricingActorId',p_actor_id,
        'date',v_slot->>'date','time',v_slot->>'time','patientId',v_patient,'patientName',v_resolution->>'patient_name','professionalNames',to_jsonb(v_team_names),
        'professional',v_team_names[1],
        'serviceType',p_specialty,'durationMinutes',p_duration_minutes,
        'recurrenceGroupId',case when jsonb_array_length(p_local_slots)>1 then v_series end,
        'recurrenceIndex',v_index,'recurrenceTotal',jsonb_array_length(p_local_slots));
      insert into public.appointments(clinic_id,organization_id,patient_id,therapist_id,therapist_name,scheduled_at,
        scheduled_start_at,scheduled_end_at,duration_minutes,scheduled_duration_minutes,
        room_id,room_name,location_type,care_setting,location_timezone,service_type,approach,
        financial_event_actor_id,source_payload,status)
      values(p_organization_id,p_organization_id,v_patient,v_team[1],v_team_names[1],v_start,v_start,v_booking.scheduled_end_at,
        p_duration_minutes,p_duration_minutes,p_room_id::text,v_room_name,'clinica','CLINIC',v_timezone,
        p_specialty,p_specialty,p_actor_id,v_source,'scheduled') returning id into v_appointment;
      insert into public.group_session_participants(booking_id,organization_id,patient_id,appointment_id,financial_plan_id,unit_amount_cents)
      values(v_booking.id,p_organization_id,v_patient,v_appointment,v_plan,v_cents);
      insert into public.appointment_billing_contexts(organization_id,appointment_id,patient_id,
        payer_type,service_type,metadata,created_by,updated_by)
      values(p_organization_id,v_appointment,v_patient,'PRIVATE',p_specialty,
        jsonb_build_object('session_modality','GROUP','group_booking_id',v_booking.id,'financial_plan_id',v_plan),p_actor_id,p_actor_id);
      perform public.assert_group_patient_finance_v1(p_organization_id,v_appointment);
      v_changed_appointments:=array_append(v_changed_appointments,v_appointment);
    end loop;
  end loop;
  perform public.project_group_sessions_to_clinic_state_v1(p_organization_id,p_actor_id,v_booking_ids,'group:'||p_idempotency_key);
  perform public.emit_group_appointment_events_v1(p_organization_id,p_actor_id,v_changed_appointments,'appointment.created',p_idempotency_key);
  perform set_config('verto.group_bulk_operation','',true);
  insert into public.group_session_operations(organization_id,operation_key,payload_hash,booking_ids,created_by)
  values(p_organization_id,p_idempotency_key,v_hash,v_booking_ids,p_actor_id);
  perform set_config('verto.group_booking_id','',true);
  return public.group_session_result_v1(p_organization_id,v_booking_ids)||jsonb_build_object('idempotent',false);
end;
$$;

revoke all on function public.group_session_result_v1(uuid,uuid[]),public.guard_appointment_group_slot_v1(),
  public.reserve_group_sessions_v1(uuid,uuid,uuid[],uuid[],text,uuid,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.group_session_result_v1(uuid,uuid[]),
  public.reserve_group_sessions_v1(uuid,uuid,uuid[],uuid[],text,uuid,jsonb,integer,text) to service_role;

-- Source: 20261016030000_group_session_financial_engine_wiring.sql; sha256 c09cc03194b72a53284e6e4d7779996209038499ec74a467dec20c719dc33fee

-- GROUP branches use immutable reservation prices in both existing engines.
-- All individual branches are retained verbatim.

CREATE OR REPLACE FUNCTION public.resolve_appointment_financial_engine_v1(p_organization_id uuid, p_appointment_id uuid, p_patient_id uuid, p_service_type text, p_source jsonb DEFAULT '{}'::jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_group_plan public.patient_financial_plans%rowtype;
  v_context_type text;
  v_payer_id uuid;
  v_source_payer text;
  v_service text:=nullif(trim(coalesce(p_service_type,'')),'');
  v_effective_at timestamptz;
  v_monthly_count integer:=0;
  v_has_explicit_context boolean:=false;
begin
  if p_organization_id is null or p_appointment_id is null or p_patient_id is null then return 'NONE'; end if;

  -- GROUP identity and price plan are frozen by the backend reservation RPC.
  -- An ended historical plan remains authoritative for this reservation.
  if upper(coalesce(p_source->>'sessionModality',''))='GROUP' then
    select plan.* into v_group_plan
    from public.patient_financial_plans plan
    join public.group_session_bookings booking
      on booking.id::text=p_source->>'sessionGroupId'
      and booking.organization_id=p_organization_id
    where plan.id::text=coalesce(
      (select participant.financial_plan_id::text from public.group_session_participants participant
       where participant.organization_id=p_organization_id and participant.appointment_id=p_appointment_id),
      p_source->>'groupFinancialPlanId')
      and plan.organization_id=p_organization_id and plan.patient_id=p_patient_id
      and plan.billing_mode='PRIVATE';
    if not found then return 'NONE'; end if;
    if v_group_plan.billing_frequency='MONTHLY' and v_group_plan.pricing_unit='SESSION'
      and v_group_plan.aggregation_method='ELIGIBLE_COMPLETED_SESSIONS'
      and v_group_plan.due_day between 1 and 31 then return 'MONTHLY_SESSION'; end if;
    return 'AT_SESSION';
  end if;

  select coalesce(a.scheduled_start_at,a.scheduled_at,a.actual_end_at)
  into v_effective_at
  from public.appointments a
  where a.id=p_appointment_id and coalesce(a.organization_id,a.clinic_id)=p_organization_id;
  if v_effective_at is null then return 'NONE'; end if;

  select upper(coalesce(nullif(trim(c.payer_type),''),'')), c.payer_id,
         (nullif(trim(coalesce(c.payer_type,'')),'') is not null or c.payer_id is not null)
  into v_context_type,v_payer_id,v_has_explicit_context
  from public.appointment_billing_contexts c
  where c.organization_id=p_organization_id and c.appointment_id=p_appointment_id
  order by c.updated_at desc nulls last limit 1;

  -- A deliberate removal is authoritative even when old appointment/source payload
  -- still carries PRIVATE/INSURANCE hints. A new explicit context clears this marker
  -- in the context trigger before synchronization.
  if not coalesce(v_has_explicit_context,false) and exists (
    select 1
    from public.appointment_billing_context_tombstones tombstone
    where tombstone.organization_id=p_organization_id
      and tombstone.appointment_id=p_appointment_id
      and tombstone.reason='BILLING_CONTEXT_REMOVED'
  ) then
    return 'NONE';
  end if;

  v_context_type:=upper(coalesce(
    nullif(v_context_type,''),
    nullif(trim(p_source->>'financialContextType'),''),
    nullif(trim(p_source->>'financial_context_type'),''),
    nullif(trim(p_source->>'payerType'),''),
    nullif(trim(p_source->>'payer_type'),''),
    ''
  ));
  if v_context_type='PARTICULAR' then v_context_type:='PRIVATE'; end if;
  if v_context_type in ('CONVENIO','CONVÊNIO') then v_context_type:='INSURANCE'; end if;

  if v_payer_id is null then
    v_source_payer:=coalesce(
      nullif(trim(p_source->>'insurancePayerId'),''),
      nullif(trim(p_source->>'insurance_payer_id'),''),
      nullif(trim(p_source->>'payerId'),''),
      nullif(trim(p_source->>'payer_id'),'')
    );
    if v_source_payer ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_payer_id:=v_source_payer::uuid;
    end if;
  end if;

  if v_context_type='' then
    select count(*)::integer into v_monthly_count
    from public.patient_financial_plans plan
    where plan.organization_id=p_organization_id
      and plan.patient_id=p_patient_id
      and plan.billing_mode in ('PRIVATE','INSURANCE')
      and plan.billing_frequency='MONTHLY'
      and plan.pricing_unit='SESSION'
      and plan.aggregation_method='ELIGIBLE_COMPLETED_SESSIONS'
      and plan.amount_cents>0
      and plan.due_day between 1 and 31
      and plan.valid_from<=v_effective_at
      and (plan.valid_until is null or v_effective_at<plan.valid_until)
      and (
        v_service is null
        or public.appointment_financial_service_key_v1(plan.service_type)=public.appointment_financial_service_key_v1(v_service)
        or public.appointment_financial_service_key_v1(coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type,''))=public.appointment_financial_service_key_v1(v_service)
      );

    if v_monthly_count=1 then return 'MONTHLY_SESSION'; end if;
    if v_monthly_count>1 then return 'AMBIGUOUS'; end if;
    -- Preserve the proven legacy contract when no monthly-session rule exists.
    return 'AT_SESSION';
  end if;

  if v_context_type not in ('PRIVATE','INSURANCE') then return 'NONE'; end if;
  if v_context_type='INSURANCE' and v_payer_id is null then return 'NONE'; end if;

  select count(*)::integer into v_monthly_count
  from public.patient_financial_plans plan
  where plan.organization_id=p_organization_id
    and plan.patient_id=p_patient_id
    and plan.billing_mode=v_context_type
    and plan.billing_frequency='MONTHLY'
    and plan.pricing_unit='SESSION'
    and plan.aggregation_method='ELIGIBLE_COMPLETED_SESSIONS'
    and plan.amount_cents>0
    and plan.due_day between 1 and 31
    and plan.valid_from<=v_effective_at
    and (plan.valid_until is null or v_effective_at<plan.valid_until)
    and (v_context_type<>'INSURANCE' or plan.payer_id=v_payer_id)
    and (
      v_service is null
      or public.appointment_financial_service_key_v1(plan.service_type)=public.appointment_financial_service_key_v1(v_service)
      or public.appointment_financial_service_key_v1(coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type,''))=public.appointment_financial_service_key_v1(v_service)
    );

  if v_monthly_count=1 then return 'MONTHLY_SESSION'; end if;
  if v_monthly_count>1 then return 'AMBIGUOUS'; end if;
  if v_context_type='PRIVATE' then return 'AT_SESSION'; end if;
  return 'NONE';
end;
$function$;
CREATE OR REPLACE FUNCTION public.sync_monthly_session_billing_for_appointment_v1(p_organization_id uuid, p_appointment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_appointment public.appointments%rowtype;
  v_plan public.patient_financial_plans%rowtype;
  v_existing_item public.payment_appointment_items%rowtype;
  v_existing_payment public.payments%rowtype;
  v_target_payment public.payments%rowtype;
  v_context_type text;
  v_context_payer_id uuid;
  v_context_payer_name text;
  v_context_service text;
  v_source jsonb;
  v_service text;
  v_service_key text;
  v_effective_at timestamptz;
  v_competence date;
  v_due_date date;
  v_group_key text;
  v_item_key text;
  v_unit_amount numeric(14,2);
  v_patient_name text;
  v_actor_id text;
  v_event_key text;
  v_completed boolean;
  v_candidate_count integer := 0;
  v_engine text;
  v_snapshot_material_equal boolean := false;
  v_snapshot_changed_same_group boolean := false;
begin
  if p_organization_id is null or p_appointment_id is null then
    return jsonb_build_object('success',false,'code','MONTHLY_SESSION_SCOPE_INVALID');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':monthly-session:'||p_appointment_id::text,0));

  select * into v_appointment
  from public.appointments a
  where a.id=p_appointment_id
    and coalesce(a.organization_id,a.clinic_id)=p_organization_id
  for update;
  if not found or v_appointment.patient_id is null then
    return jsonb_build_object('success',true,'action','NO_APPOINTMENT');
  end if;

  select item.* into v_existing_item
  from public.payment_appointment_items item
  where item.organization_id=p_organization_id
    and item.appointment_id=p_appointment_id
    and item.billing_item_type='MONTHLY_SESSION'
    and item.active=true
  order by item.created_at desc limit 1 for update;

  v_completed:=lower(coalesce(v_appointment.status,''))='completed'
    and coalesce(v_appointment.is_active,true)=true
    and v_appointment.deleted_at is null;

  -- Reopen/cancel/no-show: remove from an open aggregate, never rewrite a settled payment.
  if not v_completed then
    if v_existing_item.id is null then return jsonb_build_object('success',true,'action','NOT_ELIGIBLE'); end if;
    select * into v_existing_payment from public.payments p where p.id::text=v_existing_item.payment_id::text for update;
    if public.monthly_session_payment_locked_v1(v_existing_item.payment_id::text) then
      perform public.mark_monthly_session_adjustment_required_v1(
        v_existing_item.payment_id::text,p_appointment_id,
        'Sessão deixou de ser elegível após movimentação financeira; recebível liquidado não foi reescrito.',
        'monthly-session:'||p_appointment_id::text||':adjustment:'||coalesce(v_appointment.updated_at::text,'status')
      );
      return jsonb_build_object('success',true,'action','ADJUSTMENT_REQUIRED');
    end if;
    update public.payment_appointment_items
    set active=false,deactivated_at=now(),deactivation_reason='APPOINTMENT_NOT_COMPLETED',updated_at=now()
    where id=v_existing_item.id;
    perform public.refresh_monthly_session_payment_v1(v_existing_item.payment_id::text);
    insert into public.payment_audit_events (
      organization_id,clinic_id,payment_id,appointment_id,event_type,before_state,after_state,notes,idempotency_key,created_by
    ) values (
      p_organization_id,p_organization_id::text,v_existing_item.payment_id::text,p_appointment_id,
      'MONTHLY_SESSION_REMOVED','{}'::jsonb,
      (select to_jsonb(p) from public.payments p where p.id::text=v_existing_item.payment_id::text),
      'Sessão deixou de ser COMPLETED e foi retirada da competência aberta.',
      'monthly-session:'||p_appointment_id::text||':removed:'||coalesce(v_appointment.updated_at::text,'status'),null
    ) on conflict (organization_id,idempotency_key) where idempotency_key is not null do nothing;
    return jsonb_build_object('success',true,'action','REMOVED');
  end if;

  v_source:=coalesce(to_jsonb(v_appointment)->'source_payload','{}'::jsonb);
  v_service:=nullif(trim(coalesce(v_appointment.service_type,v_appointment.approach,v_source->>'serviceType',v_source->>'service_type','')),'');
  select upper(coalesce(nullif(trim(c.payer_type),''),'')),c.payer_id,c.payer_name_snapshot,nullif(trim(c.service_type),'')
  into v_context_type,v_context_payer_id,v_context_payer_name,v_context_service
  from public.appointment_billing_contexts c
  where c.organization_id=p_organization_id and c.appointment_id=p_appointment_id
  order by c.updated_at desc nulls last limit 1;
  v_context_type:=upper(coalesce(nullif(v_context_type,''),nullif(trim(v_source->>'financialContextType'),''),nullif(trim(v_source->>'financial_context_type'),''),nullif(trim(v_source->>'payerType'),''),nullif(trim(v_source->>'payer_type'),''),''));
  if v_context_type='PARTICULAR' then v_context_type:='PRIVATE'; end if;
  if v_context_type in ('CONVENIO','CONVÊNIO') then v_context_type:='INSURANCE'; end if;
  v_service:=coalesce(v_context_service,v_service);

  -- Competence is the canonical scheduled/performed session month, never payment_date.
  -- scheduled_start_at wins so a September session completed retroactively in October remains September.
  v_effective_at:=coalesce(v_appointment.scheduled_start_at,v_appointment.scheduled_at,v_appointment.actual_end_at,now());
  if upper(coalesce(v_source->>'sessionModality',''))='GROUP' then
    v_competence:=date_trunc('month',v_effective_at at time zone v_appointment.location_timezone)::date;
  else
  v_competence:=date_trunc('month',v_effective_at at time zone 'America/Sao_Paulo')::date;
  end if;

  v_engine:=public.resolve_appointment_financial_engine_v1(
    p_organization_id,
    p_appointment_id,
    v_appointment.patient_id,
    v_service,
    v_source
  );

  -- A single canonical resolver owns the engine decision. The monthly engine never
  -- runs as a fallback beside the legacy engine, and ambiguity fails closed.
  if v_engine <> 'MONTHLY_SESSION' then
    if v_existing_item.id is not null then
      if public.monthly_session_payment_locked_v1(v_existing_item.payment_id::text) then
        perform public.mark_monthly_session_adjustment_required_v1(
          v_existing_item.payment_id::text,p_appointment_id,
          'Motor financeiro aplicável à sessão mudou após movimentação financeira; recebível original preservado.',
          'monthly-session:'||p_appointment_id::text||':engine-change:'||coalesce(v_appointment.updated_at::text,v_engine)
        );
        return jsonb_build_object('success',true,'action','ADJUSTMENT_REQUIRED','engine',v_engine);
      end if;
      update public.payment_appointment_items
      set active=false,deactivated_at=now(),deactivation_reason='FINANCIAL_ENGINE_'||coalesce(v_engine,'NONE'),updated_at=now()
      where id=v_existing_item.id;
      perform public.refresh_monthly_session_payment_v1(v_existing_item.payment_id::text);
      insert into public.payment_audit_events (
        organization_id,clinic_id,payment_id,appointment_id,event_type,before_state,after_state,notes,idempotency_key,created_by
      ) values (
        p_organization_id,p_organization_id::text,v_existing_item.payment_id::text,p_appointment_id,
        'MONTHLY_SESSION_REMOVED','{}'::jsonb,
        (select to_jsonb(p) from public.payments p where p.id::text=v_existing_item.payment_id::text),
        'Sessão deixou o motor mensal porque o motor canônico passou a '||coalesce(v_engine,'NONE')||'.',
        'monthly-session:'||p_appointment_id::text||':engine-removed:'||coalesce(v_appointment.updated_at::text,v_engine),null
      ) on conflict (organization_id,idempotency_key) where idempotency_key is not null do nothing;
    end if;
    return jsonb_build_object('success',true,'action','ENGINE_NOOP','engine',v_engine);
  end if;

  if upper(coalesce(v_source->>'sessionModality',''))='GROUP' then
    select plan.* into v_plan from public.patient_financial_plans plan
    join public.group_session_participants participant on participant.financial_plan_id=plan.id
    where participant.organization_id=p_organization_id and participant.appointment_id=p_appointment_id
      and participant.patient_id=v_appointment.patient_id and plan.organization_id=p_organization_id
      and plan.patient_id=v_appointment.patient_id and plan.billing_mode='PRIVATE';
    if not found then raise exception 'GROUP_FINANCIAL_SNAPSHOT_REQUIRED'; end if;
  else
  if v_context_type in ('PRIVATE','INSURANCE') then
    if v_context_type='INSURANCE' and v_context_payer_id is null then
      return jsonb_build_object('success',true,'action','INSURANCE_PAYER_MISSING');
    end if;
    select plan.* into v_plan
    from public.patient_financial_plans plan
    where plan.organization_id=p_organization_id
      and plan.patient_id=v_appointment.patient_id
      and plan.billing_mode=v_context_type
      and plan.billing_frequency='MONTHLY'
      and plan.pricing_unit='SESSION'
      and plan.aggregation_method='ELIGIBLE_COMPLETED_SESSIONS'
      and plan.amount_cents>0
      and plan.due_day between 1 and 31
      and plan.valid_from<=v_effective_at
      and (plan.valid_until is null or v_effective_at<plan.valid_until)
      and (v_context_type<>'INSURANCE' or plan.payer_id=v_context_payer_id)
      and (
        v_service is null
        or public.appointment_financial_service_key_v1(plan.service_type)=public.appointment_financial_service_key_v1(v_service)
        or public.appointment_financial_service_key_v1(coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type,''))=public.appointment_financial_service_key_v1(v_service)
      )
    order by plan.version desc,plan.valid_from desc
    limit 1;
  else
    -- Finance-only clinics do not need TISS/Agenda billing context to use this model.
    -- If exactly one monthly rule matches the session/service, the canonical patient plan
    -- itself supplies payer/source. Multiple matches fail closed instead of guessing.
    select count(*)::integer into v_candidate_count
    from public.patient_financial_plans plan
    where plan.organization_id=p_organization_id
      and plan.patient_id=v_appointment.patient_id
      and plan.billing_mode in ('PRIVATE','INSURANCE')
      and plan.billing_frequency='MONTHLY'
      and plan.pricing_unit='SESSION'
      and plan.aggregation_method='ELIGIBLE_COMPLETED_SESSIONS'
      and plan.amount_cents>0
      and plan.due_day between 1 and 31
      and plan.valid_from<=v_effective_at
      and (plan.valid_until is null or v_effective_at<plan.valid_until)
      and (
        v_service is null
        or public.appointment_financial_service_key_v1(plan.service_type)=public.appointment_financial_service_key_v1(v_service)
        or public.appointment_financial_service_key_v1(coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type,''))=public.appointment_financial_service_key_v1(v_service)
      );
    if v_candidate_count <> 1 then
      return jsonb_build_object('success',true,'action',case when v_candidate_count=0 then 'NO_MONTHLY_PLAN' else 'MONTHLY_PLAN_AMBIGUOUS' end);
    end if;
    select plan.* into v_plan
    from public.patient_financial_plans plan
    where plan.organization_id=p_organization_id
      and plan.patient_id=v_appointment.patient_id
      and plan.billing_mode in ('PRIVATE','INSURANCE')
      and plan.billing_frequency='MONTHLY'
      and plan.pricing_unit='SESSION'
      and plan.aggregation_method='ELIGIBLE_COMPLETED_SESSIONS'
      and plan.amount_cents>0
      and plan.due_day between 1 and 31
      and plan.valid_from<=v_effective_at
      and (plan.valid_until is null or v_effective_at<plan.valid_until)
      and (
        v_service is null
        or public.appointment_financial_service_key_v1(plan.service_type)=public.appointment_financial_service_key_v1(v_service)
        or public.appointment_financial_service_key_v1(coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type,''))=public.appointment_financial_service_key_v1(v_service)
      )
    order by plan.version desc,plan.valid_from desc
    limit 1;
    v_context_type:=v_plan.billing_mode;
    v_context_payer_id:=v_plan.payer_id;
    v_context_payer_name:=v_plan.payer_name_snapshot;
  end if;

  end if;

  if v_plan.id is null then
    -- If the appointment used to belong to this engine but no longer resolves to a
    -- monthly plan, treat it as a financial reversal while preserving settled money.
    if v_existing_item.id is not null then
      if public.monthly_session_payment_locked_v1(v_existing_item.payment_id::text) then
        perform public.mark_monthly_session_adjustment_required_v1(
          v_existing_item.payment_id::text,p_appointment_id,
          'Regra financeira da sessão mudou após movimentação financeira; ajuste manual necessário.',
          'monthly-session:'||p_appointment_id::text||':plan-missing:'||coalesce(v_appointment.updated_at::text,'plan')
        );
        return jsonb_build_object('success',true,'action','ADJUSTMENT_REQUIRED');
      end if;
      update public.payment_appointment_items
      set active=false,deactivated_at=now(),deactivation_reason='MONTHLY_PLAN_NO_LONGER_APPLIES',updated_at=now()
      where id=v_existing_item.id;
      perform public.refresh_monthly_session_payment_v1(v_existing_item.payment_id::text);
    end if;
    return jsonb_build_object('success',true,'action','NO_MONTHLY_PLAN');
  end if;

  if v_plan.billing_mode='INSURANCE' and not exists (
    select 1 from public.clinic_payers payer
    where payer.id=v_plan.payer_id and payer.organization_id=p_organization_id
  ) then
    return jsonb_build_object('success',true,'action','PAYER_SCOPE_INVALID');
  end if;

  v_service_key:=lower(coalesce(nullif(trim(v_plan.service_type),''),nullif(trim(v_plan.custom_service_name),''),nullif(trim(v_plan.service_name_snapshot),''),'service'));
  v_due_date:=public.monthly_session_due_date_v1(v_competence,v_plan.due_day);
  v_group_key:=concat_ws('|',
    'monthly-session',v_appointment.patient_id::text,v_plan.logical_plan_id::text,v_competence::text,
    v_plan.billing_mode,coalesce(v_plan.payer_id::text,'PRIVATE'),v_service_key,
    coalesce(v_plan.due_day::text,''),coalesce(lower(v_plan.payment_method),'')
  );
  v_item_key:='monthly-session:'||p_appointment_id::text||':'||md5(v_group_key);
  if upper(coalesce(v_source->>'sessionModality',''))='GROUP' then
    select round(participant.unit_amount_cents::numeric/100,2) into strict v_unit_amount
    from public.group_session_participants participant
    where participant.organization_id=p_organization_id and participant.appointment_id=p_appointment_id;
  else
  v_unit_amount:=round(v_plan.amount_cents::numeric/100,2);
  end if;
  select p.name into v_patient_name from public.patients p where p.id=v_appointment.patient_id and p.clinic_id=p_organization_id;
  v_actor_id:=nullif(trim(coalesce(to_jsonb(v_appointment)->>'financial_event_actor_id','')),'');
  v_event_key:='monthly-session:'||p_appointment_id::text||':'||coalesce(v_appointment.updated_at::text,'completed');

  -- The group identity intentionally excludes price/version so a mid-month plan
  -- version can remain in one coherent receivable. Therefore equal billing_item_key
  -- is not sufficient for NOOP: the immutable financial snapshot must also match.
  if v_existing_item.id is not null and v_existing_item.billing_item_key=v_item_key then
    v_snapshot_material_equal :=
      v_existing_item.patient_financial_plan_id is not distinct from v_plan.id
      and v_existing_item.patient_financial_plan_logical_id is not distinct from v_plan.logical_plan_id
      and v_existing_item.patient_financial_plan_version is not distinct from v_plan.version
      and round(coalesce(v_existing_item.unit_amount,0)::numeric,2) is not distinct from round(v_unit_amount::numeric,2)
      and round(coalesce(v_existing_item.subtotal,0)::numeric,2) is not distinct from round(v_unit_amount::numeric,2)
      and v_existing_item.appointment_scheduled_at is not distinct from v_effective_at
      and v_existing_item.professional_id::text is not distinct from v_appointment.therapist_id::text
      and coalesce(v_existing_item.professional_name_snapshot,'') is not distinct from coalesce(v_appointment.therapist_name,'')
      and coalesce(v_existing_item.service_type_snapshot,'') is not distinct from coalesce(v_plan.service_name_snapshot,v_plan.custom_service_name,v_plan.service_type,'')
      and coalesce(v_existing_item.specialty_snapshot,'') is not distinct from coalesce(v_plan.service_name_snapshot,v_plan.custom_service_name,v_plan.service_type,'')
      and v_existing_item.payer_id_snapshot is not distinct from v_plan.payer_id
      and coalesce(v_existing_item.payer_name_snapshot,'') is not distinct from coalesce(v_plan.payer_name_snapshot,v_context_payer_name,'')
      and v_existing_item.competence_month is not distinct from v_competence
      and v_existing_item.completion_at is not distinct from v_appointment.actual_end_at;

    if v_snapshot_material_equal then
      return jsonb_build_object('success',true,'action','NOOP','paymentId',v_existing_item.payment_id);
    end if;

    if public.monthly_session_payment_locked_v1(v_existing_item.payment_id::text) then
      perform public.mark_monthly_session_adjustment_required_v1(
        v_existing_item.payment_id::text,p_appointment_id,
        'Snapshot financeiro da sessão mudou após movimentação financeira; item e recebível originais preservados.',
        v_event_key||':snapshot-change'
      );
      return jsonb_build_object('success',true,'action','ADJUSTMENT_REQUIRED','paymentId',v_existing_item.payment_id);
    end if;
    v_snapshot_changed_same_group := true;
  end if;

  -- Material correction (payer/service/competence): detach from the old open group first.
  if v_existing_item.id is not null and v_existing_item.billing_item_key is distinct from v_item_key then
    if public.monthly_session_payment_locked_v1(v_existing_item.payment_id::text) then
      perform public.mark_monthly_session_adjustment_required_v1(
        v_existing_item.payment_id::text,p_appointment_id,
        'Dimensão material da cobrança mensal mudou após movimentação financeira; recebível liquidado preservado.',
        v_event_key||':material-change'
      );
      return jsonb_build_object('success',true,'action','ADJUSTMENT_REQUIRED');
    end if;
    update public.payment_appointment_items
    set active=false,deactivated_at=now(),deactivation_reason='MATERIAL_BILLING_GROUP_CHANGED',updated_at=now()
    where id=v_existing_item.id;
    perform public.refresh_monthly_session_payment_v1(v_existing_item.payment_id::text);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':monthly-group:'||v_group_key,0));
  select * into v_target_payment
  from public.payments p
  where p.organization_id=p_organization_id
    and p.source='MONTHLY_SESSION_AGGREGATE'
    and p.monthly_billing_group_key=v_group_key
  limit 1 for update;

  if v_target_payment.id is null then
    insert into public.payments (
      organization_id,clinic_id,patient_id,patient_name,appointment_id,professional_id,
      service_type,appointment_scheduled_at,payer_id,payer_name,competence_month,
      amount,original_amount,base_amount,additional_amount,discount_amount,paid_amount,refunded_amount,balance_amount,
      due_date,method,status,financial_status,source,idempotency_key,notes,created_by,created_at,updated_at,
      billing_frequency,pricing_unit,aggregation_method,monthly_billing_group_key,
      patient_financial_plan_logical_id,monthly_session_count,monthly_adjustment_required
    ) values (
      p_organization_id,p_organization_id::text,v_appointment.patient_id::text,v_patient_name,p_appointment_id,v_appointment.therapist_id,
      coalesce(v_plan.service_name_snapshot,v_plan.custom_service_name,v_plan.service_type),v_effective_at,v_plan.payer_id,
      coalesce(v_plan.payer_name_snapshot,v_context_payer_name),v_competence,
      0,0,0,0,0,0,0,0,
      v_due_date,nullif(v_plan.payment_method,''),'pending','pending','MONTHLY_SESSION_AGGREGATE',
      'monthly-session-group:'||md5(v_group_key),
      'Faturamento mensal por sessões realizadas.',v_actor_id,now(),now(),
      'MONTHLY','SESSION','ELIGIBLE_COMPLETED_SESSIONS',v_group_key,
      v_plan.logical_plan_id,0,false
    ) returning * into v_target_payment;
  elsif public.monthly_session_payment_locked_v1(v_target_payment.id::text) then
    perform public.mark_monthly_session_adjustment_required_v1(
      v_target_payment.id::text,p_appointment_id,
      'Sessão elegível chegou a uma competência já movimentada financeiramente; valor liquidado não foi reescrito.',
      v_event_key||':late-session'
    );
    return jsonb_build_object('success',true,'action','ADJUSTMENT_REQUIRED');
  else
    update public.payments
    set canceled_at=null,canceled_by=null,due_date=v_due_date,
        payer_id=v_plan.payer_id,payer_name=coalesce(v_plan.payer_name_snapshot,v_context_payer_name),
        service_type=coalesce(v_plan.service_name_snapshot,v_plan.custom_service_name,v_plan.service_type),
        updated_at=now()
    where id=v_target_payment.id
    returning * into v_target_payment;
  end if;

  insert into public.payment_appointment_items (
    organization_id,clinic_id,payment_id,appointment_id,patient_id,professional_id,
    patient_name_snapshot,professional_name_snapshot,service_type_snapshot,specialty_snapshot,
    appointment_scheduled_at,quantity,unit_amount,subtotal,active,created_at,
    billing_item_key,billing_item_type,patient_financial_plan_id,patient_financial_plan_logical_id,
    patient_financial_plan_version,payer_id_snapshot,payer_name_snapshot,competence_month,completion_at,
    updated_at,deactivated_at,deactivation_reason
  ) values (
    p_organization_id,p_organization_id::text,v_target_payment.id::text,p_appointment_id,v_appointment.patient_id,v_appointment.therapist_id,
    v_patient_name,v_appointment.therapist_name,
    coalesce(v_plan.service_name_snapshot,v_plan.custom_service_name,v_plan.service_type),
    coalesce(v_plan.service_name_snapshot,v_plan.custom_service_name,v_plan.service_type),
    v_effective_at,1,v_unit_amount,v_unit_amount,true,now(),
    v_item_key,'MONTHLY_SESSION',v_plan.id,v_plan.logical_plan_id,v_plan.version,
    v_plan.payer_id,coalesce(v_plan.payer_name_snapshot,v_context_payer_name),v_competence,v_appointment.actual_end_at,
    now(),null,null
  )
  on conflict (organization_id,billing_item_key) where billing_item_type='MONTHLY_SESSION' and billing_item_key is not null
  do update set
    payment_id=excluded.payment_id,
    professional_id=excluded.professional_id,
    professional_name_snapshot=excluded.professional_name_snapshot,
    service_type_snapshot=excluded.service_type_snapshot,
    specialty_snapshot=excluded.specialty_snapshot,
    appointment_scheduled_at=excluded.appointment_scheduled_at,
    unit_amount=excluded.unit_amount,
    subtotal=excluded.subtotal,
    active=true,
    patient_financial_plan_id=excluded.patient_financial_plan_id,
    patient_financial_plan_logical_id=excluded.patient_financial_plan_logical_id,
    patient_financial_plan_version=excluded.patient_financial_plan_version,
    payer_id_snapshot=excluded.payer_id_snapshot,
    payer_name_snapshot=excluded.payer_name_snapshot,
    competence_month=excluded.competence_month,
    completion_at=excluded.completion_at,
    updated_at=now(),deactivated_at=null,deactivation_reason=null;

  perform public.refresh_monthly_session_payment_v1(v_target_payment.id::text);
  insert into public.payment_audit_events (
    organization_id,clinic_id,payment_id,appointment_id,event_type,before_state,after_state,notes,idempotency_key,created_by
  ) values (
    p_organization_id,p_organization_id::text,v_target_payment.id::text,p_appointment_id,
    case when v_snapshot_changed_same_group then 'MONTHLY_SESSION_RECONCILED' else 'MONTHLY_SESSION_INCLUDED' end,'{}'::jsonb,
    (select to_jsonb(p) from public.payments p where p.id::text=v_target_payment.id::text),
    case when v_snapshot_changed_same_group
      then 'Snapshot financeiro da sessão reconciliado dentro do mesmo grupo mensal aberto para '||to_char(v_unit_amount,'FM999999990D00')||'.'
      else 'Sessão COMPLETED incluída incrementalmente na competência '||v_competence::text||' por '||to_char(v_unit_amount,'FM999999990D00')||'.'
    end,
    v_event_key||case when v_snapshot_changed_same_group then ':reconciled' else ':included' end,v_actor_id
  ) on conflict (organization_id,idempotency_key) where idempotency_key is not null do nothing;

  return jsonb_build_object(
    'success',true,
    'action',case when v_snapshot_changed_same_group then 'RECONCILED' else 'INCLUDED' end,
    'paymentId',v_target_payment.id,
    'competenceMonth',v_competence
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.sync_private_appointment_finance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_organization_id uuid := coalesce(new.organization_id, new.clinic_id);
  v_source jsonb := coalesce(to_jsonb(new)->'source_payload', '{}'::jsonb);
  v_old_source jsonb := case when tg_op = 'UPDATE' then coalesce(to_jsonb(old)->'source_payload', '{}'::jsonb) else '{}'::jsonb end;
  v_context_type text;
  v_service_type text := nullif(trim(coalesce(new.service_type, new.approach, v_source->>'serviceType', v_source->>'service_type', '')), '');
  v_service_catalog_id uuid;
  v_old_service_catalog_id uuid;
  v_actor_id uuid;
  v_scheduled_at timestamptz := coalesce(new.scheduled_start_at, new.scheduled_at);
  v_old_scheduled_at timestamptz := case when tg_op = 'UPDATE' then coalesce(old.scheduled_start_at, old.scheduled_at) end;
  v_care_setting text := upper(coalesce(nullif(trim(new.care_setting), ''), nullif(trim(v_source->>'careSetting'), ''), nullif(trim(v_source->>'care_setting'), ''), 'CLINIC'));
  v_old_care_setting text := case when tg_op = 'UPDATE' then upper(coalesce(nullif(trim(old.care_setting), ''), nullif(trim(v_old_source->>'careSetting'), ''), nullif(trim(v_old_source->>'care_setting'), ''), 'CLINIC')) end;
  v_manual_amount numeric;
  v_discount_amount numeric;
  v_zero_classification text;
  v_override_reason text;
  v_resolution jsonb;
  v_server_resolution jsonb;
  v_snapshot public.appointment_private_financial_snapshots%rowtype;
  v_previous_snapshot public.appointment_private_financial_snapshots%rowtype;
  v_charge public.payments%rowtype;
  v_payment_id text;
  v_payload jsonb;
  v_patient_name text;
  v_snapshot_version integer := 1;
  v_pricing_changed boolean := false;
  v_rescheduled boolean := false;
  v_event text;
  v_due_date date;
  v_free_until timestamptz;
  v_policy_amount numeric(14,2);
  v_policy_discount numeric(14,2);
  v_manual_policy_amount numeric(14,2) := new.financial_policy_decision_amount;
  v_manual_policy_event text := upper(coalesce(nullif(trim(new.financial_policy_decision_event), ''), ''));
  v_reschedule_financial_decision text;
  v_reschedule_previous_amount numeric(14,2);
  v_reschedule_credit_amount numeric(14,2) := 0;
  v_actor_role text;
  v_before jsonb;
  v_charge_key text;
begin
  if session_user = 'authenticator'
    and coalesce(auth.role()::text, '') <> 'service_role' then
    raise exception 'PRIVATE_SESSION_BACKEND_ONLY';
  end if;

  if v_organization_id is null or new.id is null or new.patient_id is null then
    return new;
  end if;

  select upper(coalesce(nullif(trim(context.payer_type), ''), ''))
  into v_context_type
  from public.appointment_billing_contexts context
  where context.organization_id = v_organization_id
    and context.appointment_id = new.id
  order by context.updated_at desc nulls last
  limit 1;
  v_context_type := upper(coalesce(
    nullif(v_context_type, ''),
    nullif(trim(v_source->>'financialContextType'), ''),
    nullif(trim(v_source->>'financial_context_type'), ''),
    nullif(trim(v_source->>'payerType'), ''),
    nullif(trim(v_source->>'payer_type'), ''),
    ''
  ));
  if v_context_type not in ('PRIVATE', 'PARTICULAR') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_organization_id::text || ':private-appointment-finance:' || new.id::text, 0
  ));

  if coalesce(v_source->>'privateServiceCatalogId', v_source->>'private_service_catalog_id', '') ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_service_catalog_id := coalesce(v_source->>'privateServiceCatalogId', v_source->>'private_service_catalog_id')::uuid;
  end if;
  if coalesce(v_old_source->>'privateServiceCatalogId', v_old_source->>'private_service_catalog_id', '') ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_old_service_catalog_id := coalesce(v_old_source->>'privateServiceCatalogId', v_old_source->>'private_service_catalog_id')::uuid;
  end if;
  if coalesce(v_source->>'privatePricingActorId', v_source->>'private_pricing_actor_id', '') ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_actor_id := coalesce(v_source->>'privatePricingActorId', v_source->>'private_pricing_actor_id')::uuid;
  else
    v_actor_id := new.financial_event_actor_id;
  end if;
  if coalesce(v_source->>'privateManualAmount', v_source->>'private_manual_amount', '') ~ '^\d+(\.\d{1,2})?$' then
    v_manual_amount := coalesce(v_source->>'privateManualAmount', v_source->>'private_manual_amount')::numeric;
  end if;
  if coalesce(v_source->>'privateDiscountAmount', v_source->>'private_discount_amount', '') ~ '^\d+(\.\d{1,2})?$' then
    v_discount_amount := coalesce(v_source->>'privateDiscountAmount', v_source->>'private_discount_amount')::numeric;
  end if;
  v_zero_classification := nullif(upper(trim(coalesce(
    v_source->>'privateZeroClassification',
    v_source->>'private_zero_classification',
    ''
  ))), '');
  v_override_reason := nullif(trim(coalesce(
    v_source->>'privatePricingReason',
    v_source->>'private_pricing_reason',
    new.financial_event_reason,
    ''
  )), '');
  v_reschedule_financial_decision := nullif(upper(trim(coalesce(
    v_source->>'privateRescheduleFinancialDecision',
    v_source->>'private_reschedule_financial_decision',
    ''
  ))), '');
  v_server_resolution := coalesce(
    v_source->'privatePricingResolution',
    v_source->'private_pricing_resolution'
  );

  select snapshot.* into v_previous_snapshot
  from public.appointment_private_financial_snapshots snapshot
  where snapshot.organization_id = v_organization_id
    and snapshot.appointment_id = new.id
  order by snapshot.snapshot_version desc
  limit 1;

  select payment.* into v_charge
  from public.payment_appointment_items item
  join public.payments payment on payment.id::text = item.payment_id::text
  where item.organization_id = v_organization_id
    and item.appointment_id = new.id
  order by item.created_at
  limit 1
  for update of payment;

  if tg_op = 'UPDATE' then
    v_rescheduled := v_old_scheduled_at is distinct from v_scheduled_at;
    v_pricing_changed :=
      lower(coalesce(old.service_type, old.approach, '')) is distinct from lower(coalesce(new.service_type, new.approach, ''))
      or v_old_service_catalog_id is distinct from v_service_catalog_id
      or v_old_care_setting is distinct from v_care_setting
      or coalesce(v_old_source->>'privateManualAmount', v_old_source->>'private_manual_amount', '') is distinct from
        coalesce(v_source->>'privateManualAmount', v_source->>'private_manual_amount', '')
      or coalesce(v_old_source->>'privateDiscountAmount', v_old_source->>'private_discount_amount', '') is distinct from
        coalesce(v_source->>'privateDiscountAmount', v_source->>'private_discount_amount', '')
      or coalesce(v_old_source->>'privateZeroClassification', v_old_source->>'private_zero_classification', '') is distinct from
        coalesce(v_source->>'privateZeroClassification', v_source->>'private_zero_classification', '');
  end if;

  if v_previous_snapshot.id is null or v_pricing_changed then
    if v_previous_snapshot.id is not null
      and v_charge.id is not null
      and greatest(coalesce(v_charge.paid_amount, 0) - coalesce(v_charge.refunded_amount, 0), 0) > 0 then
      raise exception 'PRIVATE_SESSION_PAID_PRICING_IMMUTABLE';
    end if;

    if upper(coalesce(v_source->>'sessionModality',''))='GROUP' and (
      jsonb_typeof(v_server_resolution) is distinct from 'object'
      or v_server_resolution->>'session_modality' is distinct from 'GROUP'
      or v_server_resolution->>'legacy_patient_financial_plan_id' is distinct from v_source->>'groupFinancialPlanId'
    ) then raise exception 'GROUP_FINANCIAL_SNAPSHOT_REQUIRED'; end if;

    if jsonb_typeof(v_server_resolution) = 'object'
      and coalesce((v_server_resolution->>'valid')::boolean, false)
      and nullif(v_server_resolution->>'organization_id', '')::uuid = v_organization_id
      and nullif(v_server_resolution->>'patient_id', '')::uuid = new.patient_id
      and nullif(v_server_resolution->>'created_by', '')::uuid = v_actor_id
      and nullif(v_server_resolution->>'scheduled_at', '')::timestamptz = v_scheduled_at then
      v_resolution := v_server_resolution;
    else
      v_resolution := public.resolve_private_session_price_v1(
        v_organization_id,
        new.patient_id,
        v_service_type,
        v_service_catalog_id,
        v_scheduled_at,
        v_care_setting,
        v_manual_amount,
        v_discount_amount,
        v_zero_classification,
        v_override_reason,
        v_actor_id
      );
    end if;
    v_snapshot_version := coalesce(v_previous_snapshot.snapshot_version, 0) + 1;
    v_charge_key := 'private-appointment:' || new.id::text || ':price:' || v_snapshot_version::text;

    if v_charge.id is null then
      if (v_resolution->>'final_amount')::numeric > 0 then
        v_payload := public.create_patient_financial_charge(
          v_organization_id,
          new.patient_id,
          jsonb_build_array(jsonb_build_object(
            'appointmentId', new.id,
            'unitAmount', (v_resolution->>'final_amount')::numeric,
            'serviceType', coalesce(v_resolution->>'service_name', v_service_type, 'Consulta'),
            'specialty', v_resolution->>'specialty_name'
          )),
          (v_resolution->>'base_amount')::numeric,
          (v_resolution->>'location_surcharge')::numeric,
          (v_resolution->>'discount_amount')::numeric,
          (v_resolution->>'due_date')::date,
          v_resolution->>'expected_payment_method',
          'PRIVATE_APPOINTMENT_FORECAST',
          date_trunc('month', (v_resolution->>'due_date')::date)::date,
          'Previsão particular vinculada automaticamente à consulta; não representa pagamento recebido.',
          v_charge_key,
          v_actor_id::text
        );
        v_payment_id := nullif(v_payload #>> '{charge,id}', '');
        select * into v_charge
        from public.payments
        where id::text = v_payment_id
        for update;
      else
        select patient.name into v_patient_name
        from public.patients patient
        where patient.id = new.patient_id
          and patient.clinic_id = v_organization_id;
        insert into public.payments (
          organization_id, clinic_id, patient_id, patient_name, appointment_id,
          professional_id, service_type, specialty, appointment_scheduled_at,
          payer_id, payer_name, amount, original_amount, base_amount, additional_amount,
          discount_amount, paid_amount, refunded_amount, balance_amount, due_date,
          method, status, financial_status, is_courtesy, source, competence_month,
          idempotency_key, created_by, notes, created_at, updated_at,
          private_price_source, private_price_source_label,
          private_financial_classification, cancellation_free_until, pricing_override_reason
        ) values (
          v_organization_id, v_organization_id::text, new.patient_id::text, v_patient_name, new.id,
          new.therapist_id, coalesce(v_resolution->>'service_name', v_service_type),
          v_resolution->>'specialty_name', v_scheduled_at,
          nullif(v_resolution->>'payer_id', '')::uuid, v_resolution->>'payer_name',
          0, (v_resolution->>'base_amount')::numeric, (v_resolution->>'base_amount')::numeric,
          (v_resolution->>'location_surcharge')::numeric, (v_resolution->>'discount_amount')::numeric,
          0, 0, 0, (v_resolution->>'due_date')::date,
          nullif(v_resolution->>'expected_payment_method', ''),
          case when v_resolution->>'financial_classification' = 'COURTESY' then 'courtesy' else 'canceled' end,
          lower(v_resolution->>'financial_classification'),
          v_resolution->>'financial_classification' = 'COURTESY',
          'PRIVATE_APPOINTMENT_ZERO_AUTHORIZED',
          date_trunc('month', (v_resolution->>'due_date')::date)::date,
          v_charge_key, v_actor_id::text,
          'Valor zero autorizado: ' || coalesce(v_resolution->>'override_reason', v_resolution->>'financial_classification'),
          now(), now(),
          v_resolution->>'price_source', v_resolution->>'price_source_label',
          v_resolution->>'financial_classification',
          nullif(v_resolution->>'cancellation_free_until', '')::timestamptz,
          v_resolution->>'override_reason'
        )
        returning * into v_charge;
        v_payment_id := v_charge.id::text;

        insert into public.payment_appointment_items (
          organization_id, clinic_id, payment_id, appointment_id, patient_id,
          professional_id, patient_name_snapshot, professional_name_snapshot,
          service_type_snapshot, specialty_snapshot, appointment_scheduled_at,
          quantity, unit_amount, subtotal, active
        ) values (
          v_organization_id, v_organization_id::text, v_payment_id, new.id, new.patient_id,
          new.therapist_id, v_patient_name, new.therapist_name,
          coalesce(v_resolution->>'service_name', v_service_type),
          v_resolution->>'specialty_name', v_scheduled_at,
          1, 0, 0, true
        );
        insert into public.payment_audit_events (
          organization_id, clinic_id, payment_id, appointment_id, event_type,
          before_state, after_state, notes, idempotency_key, created_by
        ) values (
          v_organization_id, v_organization_id::text, v_payment_id, new.id,
          'PRIVATE_ZERO_VALUE_AUTHORIZED', '{}'::jsonb, to_jsonb(v_charge),
          v_resolution->>'override_reason', v_charge_key || ':created', v_actor_id::text
        ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;
      end if;
    else
      v_payment_id := v_charge.id::text;
      v_before := to_jsonb(v_charge);

      update public.payment_transactions
      set
        status = 'VOIDED',
        voided_at = now(),
        voided_by = v_actor_id::text
      where organization_id = v_organization_id
        and payment_id::text = v_payment_id
        and transaction_type = 'DISCOUNT'
        and status = 'POSTED'
        and idempotency_key like 'private-appointment:' || new.id::text || ':%';

      update public.payments
      set
        original_amount = (v_resolution->>'base_amount')::numeric,
        base_amount = (v_resolution->>'base_amount')::numeric,
        additional_amount = (v_resolution->>'location_surcharge')::numeric,
        discount_amount = 0,
        canceled_at = null,
        canceled_by = null,
        is_courtesy = false,
        status = 'forecast',
        financial_status = 'forecast',
        source = 'PRIVATE_APPOINTMENT_FORECAST',
        due_date = (v_resolution->>'due_date')::date,
        method = nullif(v_resolution->>'expected_payment_method', ''),
        updated_at = now()
      where id::text = v_payment_id;

      if (v_resolution->>'discount_amount')::numeric > 0 then
        insert into public.payment_transactions (
          organization_id, clinic_id, payment_id, patient_id, transaction_type,
          amount, transaction_at, status, document_status, notes,
          idempotency_key, created_by
        ) values (
          v_organization_id, v_organization_id::text, v_payment_id, new.patient_id,
          'DISCOUNT', (v_resolution->>'discount_amount')::numeric, now(), 'POSTED',
          'PENDING', 'Desconto congelado no snapshot particular.',
          v_charge_key || ':discount', v_actor_id::text
        ) on conflict (organization_id, idempotency_key) do nothing;
      else
        perform public.refresh_patient_financial_charge(v_payment_id);
      end if;

      select * into v_charge from public.payments where id::text = v_payment_id for update;
      update public.payment_appointment_items
      set
        professional_id = new.therapist_id,
        professional_name_snapshot = coalesce(new.therapist_name, professional_name_snapshot),
        service_type_snapshot = coalesce(v_resolution->>'service_name', v_service_type),
        specialty_snapshot = v_resolution->>'specialty_name',
        appointment_scheduled_at = v_scheduled_at,
        unit_amount = (v_resolution->>'final_amount')::numeric,
        subtotal = (v_resolution->>'final_amount')::numeric,
        active = true
      where organization_id = v_organization_id
        and appointment_id = new.id;
      insert into public.payment_audit_events (
        organization_id, clinic_id, payment_id, appointment_id, event_type,
        before_state, after_state, notes, idempotency_key, created_by
      ) values (
        v_organization_id, v_organization_id::text, v_payment_id, new.id,
        'PRIVATE_PRICING_SNAPSHOT_REPLACED', v_before, to_jsonb(v_charge),
        v_resolution->>'override_reason', v_charge_key || ':replaced', v_actor_id::text
      ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;
    end if;

    insert into public.appointment_private_financial_snapshots (
      organization_id, clinic_id, patient_id, appointment_id, payment_id,
      snapshot_version, snapshot_event, previous_snapshot_id,
      specialty_key, specialty_name, service_catalog_id, service_name,
      payer_id, payer_name, base_amount, location_surcharge, discount_amount, final_amount,
      price_source, price_source_label, price_rule_id, patient_pricing_agreement_id,
      legacy_patient_financial_plan_id, price_rule_version,
      due_date, due_rule, due_offset_days, due_day,
      cancellation_free_until, cancellation_free_value, cancellation_free_unit,
      late_cancellation_rule, no_show_rule, care_setting, location_type, scheduled_at,
      expected_payment_method, allow_partial_payment, allowed_payment_methods,
      allow_manual_override, discount_approval_required, financial_classification,
      created_by, override_reason, currency, timezone, resolution_payload
    ) values (
      v_organization_id, v_organization_id, new.patient_id, new.id, v_charge.id::text,
      v_snapshot_version,
      case when v_previous_snapshot.id is null then 'CREATED' else 'PRICING_CHANGED' end,
      v_previous_snapshot.id,
      v_resolution->>'specialty_key', v_resolution->>'specialty_name',
      nullif(v_resolution->>'service_catalog_id', '')::uuid, v_resolution->>'service_name',
      nullif(v_resolution->>'payer_id', '')::uuid, v_resolution->>'payer_name',
      (v_resolution->>'base_amount')::numeric,
      (v_resolution->>'location_surcharge')::numeric,
      (v_resolution->>'discount_amount')::numeric,
      (v_resolution->>'final_amount')::numeric,
      v_resolution->>'price_source', v_resolution->>'price_source_label',
      nullif(v_resolution->>'price_rule_id', '')::uuid,
      nullif(v_resolution->>'patient_pricing_agreement_id', '')::uuid,
      nullif(v_resolution->>'legacy_patient_financial_plan_id', '')::uuid,
      nullif(v_resolution->>'price_rule_version', '')::integer,
      (v_resolution->>'due_date')::date, v_resolution->>'due_rule',
      coalesce(nullif(v_resolution->>'due_offset_days', '')::integer, 0),
      nullif(v_resolution->>'due_day', '')::integer,
      nullif(v_resolution->>'cancellation_free_until', '')::timestamptz,
      coalesce(nullif(v_resolution->>'cancellation_free_value', '')::integer, 0),
      coalesce(v_resolution->>'cancellation_free_unit', 'HOURS'),
      coalesce(v_resolution->'late_cancellation_rule', '{}'::jsonb),
      coalesce(v_resolution->'no_show_rule', '{}'::jsonb),
      v_care_setting, new.location_type, v_scheduled_at,
      nullif(v_resolution->>'expected_payment_method', ''),
      coalesce((v_resolution->>'allow_partial_payment')::boolean, true),
      array(select jsonb_array_elements_text(coalesce(v_resolution->'allowed_payment_methods', '[]'::jsonb))),
      coalesce((v_resolution->>'allow_manual_override')::boolean, false),
      coalesce((v_resolution->>'discount_approval_required')::boolean, true),
      coalesce(v_resolution->>'financial_classification', 'STANDARD'),
      v_actor_id, v_resolution->>'override_reason', 'BRL',
      case when v_source->>'sessionModality'='GROUP' then v_resolution->>'timezone' else 'America/Sao_Paulo' end, v_resolution
    )
    returning * into v_snapshot;

    update public.payments
    set
      payer_id = v_snapshot.payer_id,
      payer_name = v_snapshot.payer_name,
      service_catalog_id = v_snapshot.service_catalog_id,
      private_price_rule_id = v_snapshot.price_rule_id,
      patient_pricing_agreement_id = v_snapshot.patient_pricing_agreement_id,
      financial_snapshot_id = v_snapshot.id,
      private_price_source = v_snapshot.price_source,
      private_price_source_label = v_snapshot.price_source_label,
      private_financial_classification = v_snapshot.financial_classification,
      cancellation_free_until = v_snapshot.cancellation_free_until,
      pricing_override_reason = v_snapshot.override_reason,
      appointment_scheduled_at = v_scheduled_at,
      professional_id = new.therapist_id,
      updated_at = now()
    where id::text = v_charge.id::text;
    if v_snapshot.final_amount = 0 then
      update public.payments
      set
        amount = 0,
        balance_amount = 0,
        status = case when v_snapshot.financial_classification = 'COURTESY' then 'courtesy' else 'canceled' end,
        financial_status = lower(v_snapshot.financial_classification),
        is_courtesy = v_snapshot.financial_classification = 'COURTESY',
        canceled_at = case when v_snapshot.financial_classification = 'COURTESY' then null else now() end,
        canceled_by = case when v_snapshot.financial_classification = 'COURTESY' then null else v_actor_id::text end,
        updated_at = now()
      where id::text = v_charge.id::text;
    end if;
  else
    v_snapshot := v_previous_snapshot;
    v_payment_id := v_charge.id::text;
  end if;

  if v_charge.id is null then
    select payment.* into v_charge
    from public.payments payment
    where payment.id::text = v_payment_id
    for update;
  end if;

  if v_rescheduled and not v_pricing_changed then
    if v_snapshot.id is null or v_charge.id is null then
      raise exception 'PRIVATE_SESSION_LEGACY_FINANCIAL_REVIEW_REQUIRED';
    end if;
    v_due_date := public.private_session_due_date_v1(
      v_snapshot.due_rule,
      v_snapshot.due_offset_days,
      v_snapshot.due_day,
      (v_scheduled_at at time zone v_snapshot.timezone)::date
    );
    v_free_until := v_scheduled_at - case
      when v_snapshot.cancellation_free_unit = 'DAYS'
        then make_interval(days => v_snapshot.cancellation_free_value)
      else make_interval(hours => v_snapshot.cancellation_free_value)
    end;
    v_snapshot_version := v_snapshot.snapshot_version + 1;
    insert into public.appointment_private_financial_snapshots (
      organization_id, clinic_id, patient_id, appointment_id, payment_id,
      snapshot_version, snapshot_event, previous_snapshot_id,
      specialty_id, specialty_key, specialty_name, service_catalog_id, service_name,
      payer_id, payer_name, base_amount, location_surcharge, discount_amount, final_amount,
      price_source, price_source_label, price_rule_id, patient_pricing_agreement_id,
      legacy_patient_financial_plan_id, price_rule_version,
      due_date, due_rule, due_offset_days, due_day,
      cancellation_free_until, cancellation_free_value, cancellation_free_unit,
      late_cancellation_rule, no_show_rule, care_setting, location_type, scheduled_at,
      expected_payment_method, allow_partial_payment, allowed_payment_methods,
      allow_manual_override, discount_approval_required, financial_classification,
      created_by, override_reason, currency, timezone, resolution_payload
    ) select
      organization_id, clinic_id, patient_id, appointment_id, payment_id,
      v_snapshot_version, 'RESCHEDULED', id,
      specialty_id, specialty_key, specialty_name, service_catalog_id, service_name,
      payer_id, payer_name, base_amount, location_surcharge, discount_amount, final_amount,
      price_source, price_source_label, price_rule_id, patient_pricing_agreement_id,
      legacy_patient_financial_plan_id, price_rule_version,
      v_due_date, due_rule, due_offset_days, due_day,
      v_free_until, cancellation_free_value, cancellation_free_unit,
      late_cancellation_rule, no_show_rule, care_setting, new.location_type, v_scheduled_at,
      expected_payment_method, allow_partial_payment, allowed_payment_methods,
      allow_manual_override, discount_approval_required, financial_classification,
      coalesce(v_actor_id, created_by), v_override_reason, currency, timezone,
      resolution_payload || jsonb_build_object(
        'scheduled_at', v_scheduled_at,
        'due_date', v_due_date,
        'cancellation_free_until', v_free_until,
        'rescheduled_from', v_old_scheduled_at
      )
    from public.appointment_private_financial_snapshots
    where id = v_snapshot.id
    returning * into v_snapshot;

    update public.payments
    set
      financial_snapshot_id = v_snapshot.id,
      appointment_scheduled_at = v_scheduled_at,
      due_date = v_due_date,
      cancellation_free_until = v_free_until,
      professional_id = new.therapist_id,
      updated_at = now()
    where id::text = v_charge.id::text;
    update public.payment_appointment_items
    set
      appointment_scheduled_at = v_scheduled_at,
      professional_id = new.therapist_id,
      professional_name_snapshot = coalesce(new.therapist_name, professional_name_snapshot)
    where organization_id = v_organization_id
      and appointment_id = new.id;
    insert into public.payment_audit_events (
      organization_id, clinic_id, payment_id, appointment_id, event_type,
      before_state, after_state, notes, idempotency_key, created_by
    ) values (
      v_organization_id, v_organization_id::text, v_charge.id::text, new.id,
      'PRIVATE_APPOINTMENT_RESCHEDULED',
      jsonb_build_object('scheduled_at', v_old_scheduled_at),
      jsonb_build_object('scheduled_at', v_scheduled_at, 'due_date', v_due_date, 'snapshot_id', v_snapshot.id),
      v_override_reason,
      'private-appointment:' || new.id::text || ':snapshot:' || v_snapshot.snapshot_version::text || ':rescheduled',
      v_actor_id::text
    ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;
  end if;

  if v_rescheduled
    and not v_pricing_changed
    and coalesce(v_charge.private_financial_classification, '') = 'LATE_CANCELLATION_CHARGE' then
    if v_reschedule_financial_decision not in (
      'KEEP_PREVIOUS_CHARGE',
      'CONVERT_TO_CREDIT',
      'EXEMPT_PREVIOUS_CHARGE',
      'CREATE_NEW_CHARGE',
      'TRANSFER_TO_RESCHEDULED_SESSION'
    ) then
      raise exception 'PRIVATE_SESSION_LATE_CANCELLATION_RESCHEDULE_DECISION_REQUIRED';
    end if;
    if v_actor_id is null or v_override_reason is null then
      raise exception 'PRIVATE_SESSION_RESCHEDULE_DECISION_ACTOR_REASON_REQUIRED';
    end if;
    v_actor_role := public.private_finance_actor_role_v2(v_actor_id, v_organization_id);
    if coalesce(v_actor_role, '') not in ('director', 'coordinator', 'receptionist') then
      raise exception 'PRIVATE_SESSION_RESCHEDULE_DECISION_FORBIDDEN';
    end if;
    if greatest(coalesce(v_charge.paid_amount, 0) - coalesce(v_charge.refunded_amount, 0), 0) > 0 then
      raise exception 'PRIVATE_SESSION_RESCHEDULE_DECISION_REQUIRES_REFUND';
    end if;

    v_before := to_jsonb(v_charge);
    v_reschedule_previous_amount := greatest(coalesce(v_charge.amount, 0), 0);

    if v_reschedule_financial_decision = 'TRANSFER_TO_RESCHEDULED_SESSION' then
      update public.payment_transactions
      set status = 'VOIDED', voided_at = now(), voided_by = v_actor_id::text
      where organization_id = v_organization_id
        and payment_id::text = v_charge.id::text
        and transaction_type in ('DISCOUNT', 'COURTESY')
        and status = 'POSTED';

      update public.payments
      set
        original_amount = v_snapshot.base_amount,
        base_amount = v_snapshot.base_amount,
        additional_amount = v_snapshot.location_surcharge,
        discount_amount = 0,
        canceled_at = null,
        canceled_by = null,
        is_courtesy = false,
        source = 'PRIVATE_RESCHEDULE_TRANSFERRED',
        private_financial_classification = 'STANDARD',
        pricing_override_reason = v_override_reason,
        updated_at = now()
      where id::text = v_charge.id::text;

      if v_snapshot.discount_amount > 0 then
        insert into public.payment_transactions (
          organization_id, clinic_id, payment_id, patient_id, transaction_type,
          amount, transaction_at, status, document_status, notes,
          idempotency_key, created_by
        ) values (
          v_organization_id, v_organization_id::text, v_charge.id::text, new.patient_id,
          'DISCOUNT', v_snapshot.discount_amount, now(), 'POSTED', 'PENDING',
          'Desconto original restaurado na transferência para a sessão reagendada.',
          'private-appointment:' || new.id::text || ':reschedule:' || v_snapshot.snapshot_version::text || ':transfer-discount',
          v_actor_id::text
        ) on conflict (organization_id, idempotency_key) do nothing;
      else
        perform public.refresh_patient_financial_charge(v_charge.id::text);
      end if;

      update public.payments
      set status = 'forecast', financial_status = 'forecast', updated_at = now()
      where id::text = v_charge.id::text;
      update public.payment_appointment_items
      set
        active = true,
        unit_amount = v_snapshot.final_amount,
        subtotal = v_snapshot.final_amount,
        appointment_scheduled_at = v_scheduled_at
      where organization_id = v_organization_id
        and payment_id::text = v_charge.id::text
        and appointment_id = new.id;
      select * into v_charge from public.payments where id::text = v_charge.id::text for update;

    elsif v_reschedule_financial_decision in (
      'CONVERT_TO_CREDIT',
      'EXEMPT_PREVIOUS_CHARGE',
      'CREATE_NEW_CHARGE'
    ) then
      if v_reschedule_financial_decision = 'CONVERT_TO_CREDIT' then
        v_reschedule_credit_amount := least(v_reschedule_previous_amount, v_snapshot.final_amount);
      end if;

      update public.payment_appointment_items
      set active = false
      where organization_id = v_organization_id
        and payment_id::text = v_charge.id::text
        and appointment_id = new.id;

      if v_reschedule_financial_decision in ('CONVERT_TO_CREDIT', 'EXEMPT_PREVIOUS_CHARGE') then
        update public.payment_transactions
        set status = 'VOIDED', voided_at = now(), voided_by = v_actor_id::text
        where organization_id = v_organization_id
          and payment_id::text = v_charge.id::text
          and transaction_type in ('DISCOUNT', 'COURTESY')
          and status = 'POSTED';
        update public.payments
        set
          amount = 0,
          discount_amount = original_amount + coalesce(additional_amount, 0),
          balance_amount = 0,
          status = 'canceled',
          financial_status = case
            when v_reschedule_financial_decision = 'CONVERT_TO_CREDIT' then 'voided'
            else 'exempt'
          end,
          private_financial_classification = case
            when v_reschedule_financial_decision = 'CONVERT_TO_CREDIT' then 'CREDIT_TRANSFERRED'
            else 'EXEMPT'
          end,
          canceled_at = now(),
          canceled_by = v_actor_id::text,
          pricing_override_reason = v_override_reason,
          notes = concat_ws(' ', notes, case
            when v_reschedule_financial_decision = 'CONVERT_TO_CREDIT'
              then 'Cobrança tardia convertida em crédito e aplicada à sessão reagendada.'
            else 'Cobrança tardia anterior isentada antes da criação da nova cobrança.'
          end),
          updated_at = now()
        where id::text = v_charge.id::text;
      end if;

      v_charge_key :=
        'private-appointment:' || new.id::text ||
        ':reschedule:' || v_snapshot.snapshot_version::text ||
        ':' || lower(v_reschedule_financial_decision) || ':new-charge';
      v_payload := public.create_patient_financial_charge(
        v_organization_id,
        new.patient_id,
        jsonb_build_array(jsonb_build_object(
          'appointmentId', new.id,
          'unitAmount', greatest(v_snapshot.final_amount - v_reschedule_credit_amount, 0),
          'serviceType', coalesce(v_snapshot.service_name, v_service_type, 'Consulta'),
          'specialty', v_snapshot.specialty_name
        )),
        v_snapshot.base_amount,
        v_snapshot.location_surcharge,
        v_snapshot.discount_amount + v_reschedule_credit_amount,
        v_snapshot.due_date,
        v_snapshot.expected_payment_method,
        'PRIVATE_APPOINTMENT_FORECAST',
        date_trunc('month', v_snapshot.due_date)::date,
        case
          when v_reschedule_financial_decision = 'CONVERT_TO_CREDIT'
            then 'Nova cobrança da sessão reagendada com crédito da cobrança tardia aplicado.'
          when v_reschedule_financial_decision = 'EXEMPT_PREVIOUS_CHARGE'
            then 'Nova cobrança após isenção explícita da cobrança tardia anterior.'
          else 'Nova cobrança criada sem apagar a cobrança tardia anterior.'
        end,
        v_charge_key,
        v_actor_id::text
      );
      v_payment_id := nullif(v_payload #>> '{charge,id}', '');
      if v_payment_id is null then
        raise exception 'PRIVATE_SESSION_RESCHEDULE_NEW_CHARGE_FAILED';
      end if;

      v_snapshot_version := v_snapshot.snapshot_version + 1;
      insert into public.appointment_private_financial_snapshots (
        organization_id, clinic_id, patient_id, appointment_id, payment_id,
        snapshot_version, snapshot_event, previous_snapshot_id,
        specialty_id, specialty_key, specialty_name, service_catalog_id, service_name,
        payer_id, payer_name, base_amount, location_surcharge, discount_amount, final_amount,
        price_source, price_source_label, price_rule_id, patient_pricing_agreement_id,
        legacy_patient_financial_plan_id, price_rule_version,
        due_date, due_rule, due_offset_days, due_day,
        cancellation_free_until, cancellation_free_value, cancellation_free_unit,
        late_cancellation_rule, no_show_rule, care_setting, location_type, scheduled_at,
        expected_payment_method, allow_partial_payment, allowed_payment_methods,
        allow_manual_override, discount_approval_required, financial_classification,
        created_by, override_reason, currency, timezone, resolution_payload
      ) select
        organization_id, clinic_id, patient_id, appointment_id, v_payment_id,
        v_snapshot_version, 'RESCHEDULE_FINANCIAL_DECISION', id,
        specialty_id, specialty_key, specialty_name, service_catalog_id, service_name,
        payer_id, payer_name, base_amount, location_surcharge,
        discount_amount + v_reschedule_credit_amount,
        greatest(final_amount - v_reschedule_credit_amount, 0),
        price_source,
        case
          when v_reschedule_financial_decision = 'CONVERT_TO_CREDIT'
            then price_source_label || ' · crédito de cancelamento tardio aplicado'
          else price_source_label
        end,
        price_rule_id, patient_pricing_agreement_id,
        legacy_patient_financial_plan_id, price_rule_version,
        due_date, due_rule, due_offset_days, due_day,
        cancellation_free_until, cancellation_free_value, cancellation_free_unit,
        late_cancellation_rule, no_show_rule, care_setting, location_type, scheduled_at,
        expected_payment_method, allow_partial_payment, allowed_payment_methods,
        allow_manual_override, discount_approval_required,
        case
          when v_reschedule_financial_decision = 'CONVERT_TO_CREDIT'
            and greatest(final_amount - v_reschedule_credit_amount, 0) = 0 then 'EXEMPT'
          else 'STANDARD'
        end,
        v_actor_id, v_override_reason, currency, timezone,
        resolution_payload || jsonb_build_object(
          'reschedule_financial_decision', v_reschedule_financial_decision,
          'previous_late_cancellation_payment_id', v_charge.id::text,
          'previous_late_cancellation_amount', v_reschedule_previous_amount,
          'credit_applied', v_reschedule_credit_amount
        )
      from public.appointment_private_financial_snapshots
      where id = v_snapshot.id
      returning * into v_snapshot;

      update public.payments
      set
        payer_id = v_snapshot.payer_id,
        payer_name = v_snapshot.payer_name,
        service_catalog_id = v_snapshot.service_catalog_id,
        private_price_rule_id = v_snapshot.price_rule_id,
        patient_pricing_agreement_id = v_snapshot.patient_pricing_agreement_id,
        financial_snapshot_id = v_snapshot.id,
        private_price_source = v_snapshot.price_source,
        private_price_source_label = v_snapshot.price_source_label,
        private_financial_classification = v_snapshot.financial_classification,
        cancellation_free_until = v_snapshot.cancellation_free_until,
        pricing_override_reason = v_override_reason,
        status = case when v_snapshot.final_amount = 0 then 'canceled' else 'forecast' end,
        financial_status = case when v_snapshot.final_amount = 0 then 'exempt' else 'forecast' end,
        source = 'PRIVATE_APPOINTMENT_FORECAST',
        updated_at = now()
      where id::text = v_payment_id;
      select * into v_charge from public.payments where id::text = v_payment_id for update;
    end if;

    insert into public.payment_audit_events (
      organization_id, clinic_id, payment_id, appointment_id, event_type,
      before_state, after_state, notes, idempotency_key, created_by
    ) values (
      v_organization_id, v_organization_id::text, v_charge.id::text, new.id,
      'PRIVATE_LATE_CANCELLATION_RESCHEDULE_DECISION',
      v_before,
      jsonb_build_object(
        'decision', v_reschedule_financial_decision,
        'active_payment', to_jsonb(v_charge),
        'previous_amount', v_reschedule_previous_amount,
        'credit_applied', v_reschedule_credit_amount,
        'snapshot_id', v_snapshot.id
      ),
      v_override_reason,
      'private-appointment:' || new.id::text || ':reschedule:' ||
        v_snapshot.snapshot_version::text || ':financial-decision',
      v_actor_id::text
    ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;
  end if;

  v_event := case lower(coalesce(new.status, 'scheduled'))
    when 'completed' then 'COMPLETED'
    when 'complete' then 'COMPLETED'
    when 'realizada' then 'COMPLETED'
    when 'cancelled' then 'CANCELED'
    when 'canceled' then 'CANCELED'
    when 'cancelado' then 'CANCELED'
    when 'no_show' then 'NO_SHOW'
    when 'missed' then 'NO_SHOW'
    when 'faltou' then 'NO_SHOW'
    else 'SCHEDULED'
  end;

  if v_event = 'CANCELED' then
    if greatest(coalesce(v_charge.paid_amount, 0) - coalesce(v_charge.refunded_amount, 0), 0) > 0 then
      raise exception 'PRIVATE_SESSION_CANCEL_REQUIRES_REFUND_OR_CREDIT';
    end if;
    v_before := to_jsonb(v_charge);
    if now() <= v_snapshot.cancellation_free_until
      or upper(coalesce(v_snapshot.late_cancellation_rule->>'type', 'NO_CHARGE')) = 'NO_CHARGE' then
      update public.payments
      set
        amount = 0,
        balance_amount = 0,
        status = 'canceled',
        financial_status = 'cancelled_no_charge',
        private_financial_classification = 'CANCELLED_NO_CHARGE',
        canceled_at = now(),
        canceled_by = v_actor_id::text,
        notes = concat_ws(' ', notes, 'Cancelamento sem cobrança: ' || coalesce(v_override_reason, 'dentro da política congelada.')),
        updated_at = now()
      where id::text = v_charge.id::text;
      v_event := 'CANCELLED_NO_CHARGE';
    else
      if upper(coalesce(v_snapshot.late_cancellation_rule->>'type', 'NO_CHARGE')) = 'MANUAL' then
        if v_manual_policy_event <> 'CANCELED'
          or v_manual_policy_amount is null
          or v_actor_id is null
          or v_override_reason is null then
          raise exception 'PRIVATE_SESSION_MANUAL_CANCELLATION_DECISION_REQUIRED';
        end if;
        if v_manual_policy_amount < 0 or v_manual_policy_amount > v_snapshot.final_amount then
          raise exception 'PRIVATE_SESSION_MANUAL_POLICY_AMOUNT_INVALID';
        end if;
        v_actor_role := public.private_finance_actor_role_v2(v_actor_id, v_organization_id);
        if coalesce(v_actor_role, '') not in ('director', 'coordinator', 'receptionist') then
          raise exception 'PRIVATE_SESSION_MANUAL_POLICY_DECISION_FORBIDDEN';
        end if;
        v_policy_amount := v_manual_policy_amount;
      else
        v_policy_amount := public.private_session_policy_amount_v1(
          v_snapshot.late_cancellation_rule, v_snapshot.final_amount
        );
      end if;
      if v_policy_amount <= 0 then
        update public.payments
        set
          amount = 0,
          balance_amount = 0,
          status = 'canceled',
          financial_status = 'cancelled_no_charge',
          private_financial_classification = 'CANCELLED_NO_CHARGE',
          canceled_at = now(),
          canceled_by = v_actor_id::text,
          notes = concat_ws(' ', notes, 'Cancelamento sem cobrança por decisão manual autorizada: ' || v_override_reason),
          updated_at = now()
        where id::text = v_charge.id::text;
        v_event := 'CANCELLED_NO_CHARGE';
      else
        v_policy_discount := greatest(v_snapshot.base_amount + v_snapshot.location_surcharge - v_policy_amount, 0);
        update public.payment_transactions
        set status = 'VOIDED', voided_at = now(), voided_by = v_actor_id::text
        where organization_id = v_organization_id
          and payment_id::text = v_charge.id::text
          and transaction_type = 'DISCOUNT'
          and status = 'POSTED';
        if v_policy_discount > 0 then
          insert into public.payment_transactions (
            organization_id, clinic_id, payment_id, patient_id, transaction_type,
            amount, transaction_at, status, document_status, notes,
            idempotency_key, created_by
          ) values (
            v_organization_id, v_organization_id::text, v_charge.id::text, new.patient_id,
            'DISCOUNT', v_policy_discount, now(), 'POSTED', 'PENDING',
            'Ajuste da regra congelada de cancelamento tardio.',
            'private-appointment:' || new.id::text || ':late-cancellation:discount',
            v_actor_id::text
          ) on conflict (organization_id, idempotency_key) do nothing;
        end if;
        update public.payments
        set
          canceled_at = null,
          canceled_by = null,
          status = case when due_date < current_date then 'overdue' else 'pending' end,
          financial_status = 'late_cancellation_charge',
          private_financial_classification = 'LATE_CANCELLATION_CHARGE',
          updated_at = now()
        where id::text = v_charge.id::text;
        v_event := 'LATE_CANCELLATION_CHARGE';
      end if;
    end if;
    insert into public.payment_audit_events (
      organization_id, clinic_id, payment_id, appointment_id, event_type,
      before_state, after_state, notes, idempotency_key, created_by
    ) values (
      v_organization_id, v_organization_id::text, v_charge.id::text, new.id,
      v_event, v_before,
      (select to_jsonb(payment) from public.payments payment where payment.id::text = v_charge.id::text),
      v_override_reason,
      'private-appointment:' || new.id::text || ':' ||
        v_snapshot.snapshot_version::text || ':' || lower(v_event),
      v_actor_id::text
    ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;
  elsif v_event = 'NO_SHOW' then
    if greatest(coalesce(v_charge.paid_amount, 0) - coalesce(v_charge.refunded_amount, 0), 0) > 0 then
      raise exception 'PRIVATE_SESSION_NO_SHOW_PAID_REVIEW_REQUIRED';
    end if;
    v_before := to_jsonb(v_charge);
    if upper(coalesce(v_snapshot.no_show_rule->>'type', 'NO_CHARGE')) = 'MANUAL' then
      if v_manual_policy_event <> 'NO_SHOW'
        or v_manual_policy_amount is null
        or v_actor_id is null
        or v_override_reason is null then
        raise exception 'PRIVATE_SESSION_MANUAL_NO_SHOW_DECISION_REQUIRED';
      end if;
      if v_manual_policy_amount < 0 or v_manual_policy_amount > v_snapshot.final_amount then
        raise exception 'PRIVATE_SESSION_MANUAL_POLICY_AMOUNT_INVALID';
      end if;
      v_actor_role := public.private_finance_actor_role_v2(v_actor_id, v_organization_id);
      if coalesce(v_actor_role, '') not in ('director', 'coordinator', 'receptionist') then
        raise exception 'PRIVATE_SESSION_MANUAL_POLICY_DECISION_FORBIDDEN';
      end if;
      v_policy_amount := v_manual_policy_amount;
    else
      v_policy_amount := public.private_session_policy_amount_v1(
        v_snapshot.no_show_rule, v_snapshot.final_amount
      );
    end if;
    if v_policy_amount <= 0 then
      update public.payments
      set
        amount = 0,
        balance_amount = 0,
        status = 'canceled',
        financial_status = 'exempt',
        private_financial_classification = 'NO_SHOW_NO_CHARGE',
        canceled_at = now(),
        canceled_by = v_actor_id::text,
        updated_at = now()
      where id::text = v_charge.id::text;
      v_event := 'NO_SHOW_NO_CHARGE';
    else
      v_policy_discount := greatest(v_snapshot.base_amount + v_snapshot.location_surcharge - v_policy_amount, 0);
      update public.payment_transactions
      set status = 'VOIDED', voided_at = now(), voided_by = v_actor_id::text
      where organization_id = v_organization_id
        and payment_id::text = v_charge.id::text
        and transaction_type = 'DISCOUNT'
        and status = 'POSTED';
      if v_policy_discount > 0 then
        insert into public.payment_transactions (
          organization_id, clinic_id, payment_id, patient_id, transaction_type,
          amount, transaction_at, status, document_status, notes,
          idempotency_key, created_by
        ) values (
          v_organization_id, v_organization_id::text, v_charge.id::text, new.patient_id,
          'DISCOUNT', v_policy_discount, now(), 'POSTED', 'PENDING',
          'Ajuste da regra congelada de falta.',
          'private-appointment:' || new.id::text || ':no-show:discount',
          v_actor_id::text
        ) on conflict (organization_id, idempotency_key) do nothing;
      end if;
      update public.payments
      set
        canceled_at = null,
        canceled_by = null,
        status = case when due_date < current_date then 'overdue' else 'pending' end,
        financial_status = 'no_show_charge',
        private_financial_classification = 'NO_SHOW_CHARGE',
        updated_at = now()
      where id::text = v_charge.id::text;
      v_event := 'NO_SHOW_CHARGE';
    end if;
    insert into public.payment_audit_events (
      organization_id, clinic_id, payment_id, appointment_id, event_type,
      before_state, after_state, notes, idempotency_key, created_by
    ) values (
      v_organization_id, v_organization_id::text, v_charge.id::text, new.id,
      v_event, v_before,
      (select to_jsonb(payment) from public.payments payment where payment.id::text = v_charge.id::text),
      coalesce(v_override_reason, new.notes),
      'private-appointment:' || new.id::text || ':' ||
        v_snapshot.snapshot_version::text || ':' || lower(v_event),
      v_actor_id::text
    ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;
  elsif v_event = 'COMPLETED'
    and coalesce(v_charge.financial_status, v_charge.status) = 'forecast'
    and coalesce(v_charge.private_financial_classification, 'STANDARD') = 'STANDARD' then
    update public.payments
    set
      status = case when due_date < current_date then 'overdue' else 'pending' end,
      financial_status = case when due_date < current_date then 'overdue' else 'pending' end,
      source = 'PRIVATE_APPOINTMENT_COMPLETED',
      updated_at = now()
    where id::text = v_charge.id::text;
    insert into public.payment_audit_events (
      organization_id, clinic_id, payment_id, appointment_id, event_type,
      before_state, after_state, notes, idempotency_key, created_by
    ) values (
      v_organization_id, v_organization_id::text, v_charge.id::text, new.id,
      'PRIVATE_RECEIVABLE_OPENED', to_jsonb(v_charge),
      (select to_jsonb(payment) from public.payments payment where payment.id::text = v_charge.id::text),
      'Sessão realizada; previsão convertida em conta a receber.',
      'private-appointment:' || new.id::text || ':receivable-opened',
      v_actor_id::text
    ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;
  elsif v_event = 'SCHEDULED'
    and coalesce(v_charge.private_financial_classification, 'STANDARD') = 'STANDARD'
    and greatest(coalesce(v_charge.paid_amount, 0) - coalesce(v_charge.refunded_amount, 0), 0) = 0
    and v_charge.canceled_at is null then
    update public.payments
    set status = 'forecast', financial_status = 'forecast', source = 'PRIVATE_APPOINTMENT_FORECAST', updated_at = now()
    where id::text = v_charge.id::text;
  end if;

  return new;
end;
$function$;
-- Fail closed if a required existing financial trigger/engine is missing.
create or replace function public.assert_group_patient_finance_v1(p_organization_id uuid,p_appointment_id uuid)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_participant public.group_session_participants%rowtype;
  v_appointment public.appointments%rowtype;
  v_engine text;
begin
  select * into strict v_participant from public.group_session_participants
  where organization_id=p_organization_id and appointment_id=p_appointment_id;
  select * into strict v_appointment from public.appointments where id=p_appointment_id and clinic_id=p_organization_id;
  v_engine:=public.resolve_appointment_financial_engine_v1(p_organization_id,p_appointment_id,
    v_appointment.patient_id,v_appointment.service_type,v_appointment.source_payload);
  if v_engine='AT_SESSION' then
    if not exists(select 1 from public.appointment_private_financial_snapshots snapshot
      join public.payment_appointment_items item on item.appointment_id=snapshot.appointment_id
        and item.payment_id::text=snapshot.payment_id::text and item.organization_id=snapshot.organization_id and item.active
      where snapshot.organization_id=p_organization_id and snapshot.appointment_id=p_appointment_id
        and snapshot.legacy_patient_financial_plan_id=v_participant.financial_plan_id
        and round(snapshot.final_amount*100)::int=v_participant.unit_amount_cents
        and round(item.unit_amount*100)::int=v_participant.unit_amount_cents
        and snapshot.resolution_payload->>'session_modality'='GROUP') then
      raise exception 'GROUP_FINANCIAL_PERSISTENCE_UNCONFIRMED';
    end if;
  elsif v_engine='MONTHLY_SESSION' then
    if exists(select 1 from public.appointment_private_financial_snapshots
      where organization_id=p_organization_id and appointment_id=p_appointment_id) then
      raise exception 'GROUP_FINANCIAL_ENGINE_DUPLICATED'; end if;
  else raise exception 'GROUP_FINANCIAL_ENGINE_UNSUPPORTED';
  end if;
end;
$$;
revoke all on function public.assert_group_patient_finance_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_group_patient_finance_v1(uuid,uuid) to service_role;

-- Source: 20261016040000_group_session_join_and_work_schedule.sql; sha256 9f7be6919fb705c7610b688391814d5bb4807dd6789a235dab344a28eff3a0ec

-- Recheck explicit canonical professional schedules inside the booking lock.
-- Null work_schedule keeps the current manual-calendar contract unrestricted.
create or replace function public.assert_group_work_schedule_v1(p_booking public.group_session_bookings)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_member record;
  v_schedule jsonb;
  v_day jsonb;
  v_period jsonb;
  v_start timestamp;
  v_end timestamp;
  v_timezone text;
  v_key text;
  v_available boolean;
  v_member_count integer:=0;
  v_buffer integer;
  v_allowed jsonb;
begin
  select timezone into strict v_timezone from public.clinics where id=p_booking.organization_id;
  for v_member in select * from public.clinic_memberships where clinic_id=p_booking.organization_id
      and user_id=any(p_booking.professional_ids) and status='active' and role='therapist' for share loop
    v_member_count:=v_member_count+1;
    v_schedule:=v_member.work_schedule;
    if v_schedule is null then continue; end if;
    if jsonb_typeof(v_schedule)<>'object' or coalesce((v_schedule->>'active')::boolean,true)=false then
      raise exception 'GROUP_PROFESSIONAL_SCHEDULE_UNAVAILABLE'; end if;
    v_buffer:=least(120,greatest(0,coalesce((coalesce(v_schedule->>'sessionBufferMinutes',v_schedule->>'session_buffer_minutes'))::numeric,0)::int));
    v_allowed:=coalesce(v_schedule->'allowedLocationTypes',v_schedule->'allowed_location_types','[]'::jsonb);
    if jsonb_array_length(v_allowed)>0 and not exists(select 1 from jsonb_array_elements_text(v_allowed) location
      where lower(location) in ('clinica','clinic','clínica')) then raise exception 'GROUP_PROFESSIONAL_LOCATION_UNAVAILABLE'; end if;
    if v_buffer>0 and exists(select 1 from public.appointments a
      where a.clinic_id=p_booking.organization_id and a.deleted_at is null and coalesce(a.is_active,true)
        and lower(a.status) in ('scheduled','pending','confirmed','in_progress','completed','cancel_requested','reschedule_requested')
        and a.source_payload->>'sessionGroupId' is distinct from p_booking.id::text
        and (a.therapist_id=v_member.user_id or coalesce(a.source_payload->'professionalIds','[]'::jsonb) ? v_member.user_id::text
          or coalesce(a.source_payload->'professional_ids','[]'::jsonb) ? v_member.user_id::text
          or coalesce(a.source_payload->'teamProfessionalIds','[]'::jsonb) ? v_member.user_id::text
          or coalesce(a.source_payload->'team_professional_ids','[]'::jsonb) ? v_member.user_id::text)
        and coalesce(a.scheduled_start_at,a.scheduled_at)<p_booking.scheduled_end_at+v_buffer*interval '1 minute'
        and coalesce(a.scheduled_end_at,coalesce(a.scheduled_start_at,a.scheduled_at)+coalesce(a.scheduled_duration_minutes,a.duration_minutes,50)*interval '1 minute')
          +v_buffer*interval '1 minute'>p_booking.scheduled_start_at) then raise exception 'GROUP_PROFESSIONAL_BUFFER_UNAVAILABLE'; end if;
    v_start:=p_booking.scheduled_start_at at time zone coalesce(nullif(v_member.availability_timezone,''),v_timezone);
    v_end:=(p_booking.scheduled_end_at+v_buffer*interval '1 minute') at time zone coalesce(nullif(v_member.availability_timezone,''),v_timezone);
    if v_start::date<>v_end::date then raise exception 'GROUP_PROFESSIONAL_SCHEDULE_UNAVAILABLE'; end if;
    v_key:=(array['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])[extract(dow from v_start)::int+1];
    v_day:=coalesce(v_schedule->'days',v_schedule->'weekly',v_schedule->'weeklySchedule',v_schedule->'weekly_schedule')->v_key;
    if jsonb_typeof(v_day)='array' then v_day:=jsonb_build_object('enabled',true,'periods',v_day); end if;
    if v_day is null or coalesce((v_day->>'enabled')::boolean,true)=false then
      raise exception 'GROUP_PROFESSIONAL_SCHEDULE_UNAVAILABLE'; end if;
    v_available:=false;
    for v_period in select value from jsonb_array_elements(coalesce(v_day->'periods',v_day->'ranges',v_day->'shifts','[]'::jsonb)) loop
      if v_start::time>=(v_period->>'start')::time and v_end::time<=(v_period->>'end')::time
        and (jsonb_array_length(coalesce(v_period->'locationTypes','[]'::jsonb))=0
          or exists(select 1 from jsonb_array_elements_text(v_period->'locationTypes') location where lower(location) in ('clinica','clinic','clínica')))
        and (jsonb_array_length(coalesce(v_period->'roomIds','[]'::jsonb))=0 or v_period->'roomIds' ? p_booking.room_id::text)
        then v_available:=true; end if;
    end loop;
    if not v_available then raise exception 'GROUP_PROFESSIONAL_SCHEDULE_UNAVAILABLE'; end if;
    for v_period in select value from jsonb_array_elements(coalesce(v_day->'intervals',v_day->'breaks','[]'::jsonb)) loop
      if v_start::time<(v_period->>'end')::time and v_end::time>(v_period->>'start')::time then
        raise exception 'GROUP_PROFESSIONAL_BREAK_UNAVAILABLE'; end if;
    end loop;
    for v_period in select value from jsonb_array_elements(coalesce(v_schedule->'exceptions','[]'::jsonb)) loop
      if v_period->>'date'=v_start::date::text and coalesce((v_period->>'active')::boolean,true)
         and coalesce((v_period->>'blocksAvailability')::boolean,true)
         and (nullif(v_period->>'start','') is null or nullif(v_period->>'end','') is null
           or (v_start::time<(v_period->>'end')::time and v_end::time>(v_period->>'start')::time)) then
        raise exception 'GROUP_PROFESSIONAL_EXCEPTION_UNAVAILABLE'; end if;
    end loop;
    if jsonb_array_length(coalesce(v_schedule->'allowedRoomIds',v_schedule->'allowed_room_ids','[]'::jsonb))>0
      and not(coalesce(v_schedule->'allowedRoomIds',v_schedule->'allowed_room_ids','[]'::jsonb) ? p_booking.room_id::text) then raise exception 'GROUP_PROFESSIONAL_ROOM_UNAVAILABLE'; end if;
  end loop;
  if v_member_count<>cardinality(p_booking.professional_ids) then raise exception 'GROUP_PROFESSIONAL_OUT_OF_SCOPE'; end if;
  return;
end;
$$;
create or replace function public.guard_group_work_schedule_v1()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  perform public.assert_group_work_schedule_v1(new);
  return new;
end;
$$;
create trigger group_booking_work_schedule_guard before insert on public.group_session_bookings
for each row execute function public.guard_group_work_schedule_v1();

create or replace function public.join_group_session_v1(
  p_organization_id uuid,p_actor_id uuid,p_booking_id uuid,p_patient_ids uuid[],p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_booking public.group_session_bookings%rowtype;
  v_previous public.group_session_operations%rowtype;
  v_patients uuid[];
  v_patient uuid;
  v_hash text;
  v_team_names text[];
  v_changed_appointments uuid[]:=array[]::uuid[];
  v_resolution jsonb;
  v_plan uuid;
  v_appointment uuid;
  v_source jsonb;
  v_room record;
  v_timezone text;
  v_duration integer;
begin
  perform 1 from public.clinic_memberships m where m.clinic_id=p_organization_id
    and m.user_id=p_actor_id and m.status='active' for share;
  if not found then raise exception 'GROUP_ACTOR_OUT_OF_SCOPE'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9:._-]{12,120}$'
    or p_patient_ids is null or cardinality(p_patient_ids) not between 1 and 30 then raise exception 'GROUP_INPUT_INVALID'; end if;
  select array_agg(x order by x) into v_patients from(select distinct x from unnest(p_patient_ids)x where x is not null)s;
  if cardinality(v_patients) is distinct from cardinality(p_patient_ids) then raise exception 'GROUP_DUPLICATED_IDS'; end if;
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:'||p_organization_id::text,0));
  select * into v_booking from public.group_session_bookings where id=p_booking_id and organization_id=p_organization_id for update;
  if not found then raise exception 'GROUP_BOOKING_OUT_OF_SCOPE'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('operation','JOIN','booking',p_booking_id,'patients',v_patients)::text,'UTF8')),'hex');
  select * into v_previous from public.group_session_operations where organization_id=p_organization_id and operation_key=p_idempotency_key;
  if found then
    if v_previous.payload_hash<>v_hash then raise exception 'GROUP_IDEMPOTENCY_CONFLICT'; end if;
    return public.group_session_result_v1(p_organization_id,array[p_booking_id])||jsonb_build_object('idempotent',true);
  end if;
  if v_booking.status<>'RESERVED' then raise exception 'GROUP_BOOKING_NOT_RESERVED'; end if;
  if exists(select 1 from public.group_session_participants where booking_id=p_booking_id and patient_id=any(v_patients)) then
    raise exception 'GROUP_PATIENT_ALREADY_PARTICIPATING'; end if;
  perform 1 from public.patients where id=any(v_patients) and clinic_id=p_organization_id
    order by id for share;
  if (select count(*) from public.patients where id=any(v_patients) and clinic_id=p_organization_id and deleted_at is null
    and coalesce(is_active,true))<>cardinality(v_patients) then raise exception 'GROUP_PATIENT_OUT_OF_SCOPE'; end if;
  if (select count(distinct user_id) from public.clinic_memberships where clinic_id=p_organization_id
    and user_id=any(v_booking.professional_ids) and status='active' and role='therapist'
    and public.appointment_financial_service_key_v1(specialty)=public.appointment_financial_service_key_v1(v_booking.specialty))
    <>cardinality(v_booking.professional_ids) then raise exception 'GROUP_PROFESSIONAL_OUT_OF_SCOPE'; end if;
  select * into v_room from public.clinic_rooms where id=v_booking.room_id and clinic_id=p_organization_id and is_active for share;
  if not found or (select count(*) from public.group_session_participants p join public.appointments a on a.id=p.appointment_id
      where p.booking_id=p_booking_id and a.deleted_at is null and coalesce(a.is_active,true)
      and lower(a.status) in ('scheduled','pending','confirmed','in_progress','completed','cancel_requested','reschedule_requested'))+cardinality(v_patients)
    >least(30,v_room.capacity) then raise exception 'GROUP_ROOM_CAPACITY_EXCEEDED'; end if;
  perform public.assert_group_work_schedule_v1(v_booking);
  select timezone into strict v_timezone from public.clinics where id=p_organization_id;
  v_duration:=extract(epoch from(v_booking.scheduled_end_at-v_booking.scheduled_start_at))::int/60;
  foreach v_patient in array v_patients loop
    perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_patient::text,0));
  end loop;
  perform 1 from public.patient_financial_plans where organization_id=p_organization_id
    and patient_id=any(v_patients) order by patient_id,id for share;
  select array_agg(coalesce(nullif(btrim(u.name),''),'Profissional') order by requested.professional_id) into v_team_names
  from unnest(v_booking.professional_ids) requested(professional_id) left join public.users u on u.id=requested.professional_id;
  perform set_config('verto.group_bulk_operation','1',true);
  perform set_config('verto.group_booking_id',p_booking_id::text,true);
  foreach v_patient in array v_patients loop
    v_resolution:=public.resolve_group_private_session_price_v1(p_organization_id,v_patient,v_booking.specialty,null,
      v_booking.scheduled_start_at,'CLINIC',null,null,null,null,p_actor_id);
    v_plan:=(v_resolution->>'legacy_patient_financial_plan_id')::uuid;
    v_source:=jsonb_build_object('sessionModality','GROUP','sessionGroupId',p_booking_id,
      'professionalIds',to_jsonb(v_booking.professional_ids),'recurrenceGroupId',v_booking.series_id,'recurrenceIndex',v_booking.series_index,'groupFinancialPlanId',v_plan,
      'financialContextType','PRIVATE','privatePricingResolution',v_resolution,'privatePricingActorId',p_actor_id,
      'date',to_char(v_booking.scheduled_start_at at time zone v_timezone,'YYYY-MM-DD'),
      'time',to_char(v_booking.scheduled_start_at at time zone v_timezone,'HH24:MI'),
      'patientId',v_patient,'patientName',v_resolution->>'patient_name','professionalNames',to_jsonb(v_team_names),
        'professional',v_team_names[1],'serviceType',v_booking.specialty,'durationMinutes',v_duration);
    insert into public.appointments(clinic_id,organization_id,patient_id,therapist_id,therapist_name,scheduled_at,
      scheduled_start_at,scheduled_end_at,duration_minutes,scheduled_duration_minutes,room_id,room_name,
      location_type,care_setting,location_timezone,service_type,approach,financial_event_actor_id,source_payload,status)
    values(p_organization_id,p_organization_id,v_patient,v_booking.professional_ids[1],v_team_names[1],v_booking.scheduled_start_at,
      v_booking.scheduled_start_at,v_booking.scheduled_end_at,v_duration,v_duration,v_booking.room_id::text,v_room.name,
      'clinica','CLINIC',v_timezone,v_booking.specialty,v_booking.specialty,p_actor_id,v_source,'scheduled') returning id into v_appointment;
    insert into public.group_session_participants(booking_id,organization_id,patient_id,appointment_id,financial_plan_id,unit_amount_cents)
    values(p_booking_id,p_organization_id,v_patient,v_appointment,v_plan,round((v_resolution->>'final_amount')::numeric*100)::int);
    insert into public.appointment_billing_contexts(organization_id,appointment_id,patient_id,payer_type,service_type,metadata,created_by,updated_by)
    values(p_organization_id,v_appointment,v_patient,'PRIVATE',v_booking.specialty,
      jsonb_build_object('session_modality','GROUP','group_booking_id',p_booking_id,'financial_plan_id',v_plan),p_actor_id,p_actor_id);
      perform public.assert_group_patient_finance_v1(p_organization_id,v_appointment);
      v_changed_appointments:=array_append(v_changed_appointments,v_appointment);
  end loop;
  perform public.project_group_sessions_to_clinic_state_v1(p_organization_id,p_actor_id,array[p_booking_id],'group:'||p_idempotency_key);
  perform public.emit_group_appointment_events_v1(p_organization_id,p_actor_id,v_changed_appointments,'appointment.created',p_idempotency_key);
  perform set_config('verto.group_bulk_operation','',true);
  insert into public.group_session_operations(organization_id,operation_key,payload_hash,booking_ids,created_by)
  values(p_organization_id,p_idempotency_key,v_hash,array[p_booking_id],p_actor_id);
  perform set_config('verto.group_booking_id','',true);
  return public.group_session_result_v1(p_organization_id,array[p_booking_id])||jsonb_build_object('idempotent',false);
end;
$$;
revoke all on function public.assert_group_work_schedule_v1(public.group_session_bookings),public.guard_group_work_schedule_v1(),public.join_group_session_v1(uuid,uuid,uuid,uuid[],text) from public,anon,authenticated;
grant execute on function public.assert_group_work_schedule_v1(public.group_session_bookings),public.join_group_session_v1(uuid,uuid,uuid,uuid[],text) to service_role;

-- Source: 20261016050000_group_session_lifecycle.sql; sha256 1af0ae72f13a337be0cdea8fc2506c7d381dd1a62885459e8ce1dd65f64ae460

-- Atomic GROUP lifecycle; existing financial triggers retain cancellation/no-show/payment policy.

create or replace function public.verify_group_session_booking_v1()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_capacity integer;
  v_team_count integer;
  v_authorized_count integer;
begin
  if tg_op = 'UPDATE' and (
      old.id is distinct from new.id or
      old.created_at is distinct from new.created_at or
      old.organization_id is distinct from new.organization_id or
      old.booking_key is distinct from new.booking_key or
      old.payload_hash is distinct from new.payload_hash or
      old.specialty is distinct from new.specialty or
      ((old.room_id is distinct from new.room_id or
        old.scheduled_start_at is distinct from new.scheduled_start_at or
        old.scheduled_end_at is distinct from new.scheduled_end_at or
        old.professional_ids is distinct from new.professional_ids)
        and current_setting('verto.group_reschedule_id',true) is distinct from old.id::text) or
      old.series_id is distinct from new.series_id or
      old.series_index is distinct from new.series_index or
      old.created_by is distinct from new.created_by
  ) then raise exception 'GROUP_BOOKING_SLOT_IMMUTABLE'; end if;
  -- Cancellation/completion must remain possible after a room or member is
  -- deactivated. Only INSERT needs current availability/membership checks.
  if tg_op = 'UPDATE' then
    if old.status is distinct from new.status and
       not (old.status = 'RESERVED' and new.status in ('COMPLETED','CANCELED'))
       and current_setting('verto.group_status_sync_id',true) is distinct from old.id::text then
      raise exception 'GROUP_BOOKING_STATUS_TRANSITION_INVALID';
    end if;
    if current_setting('verto.group_reschedule_id',true) is distinct from old.id::text then return new; end if;
    if old.status<>'RESERVED' then raise exception 'GROUP_BOOKING_NOT_RESERVED'; end if;
  end if;

  select room.capacity into v_capacity
  from public.clinic_rooms room
  where room.id = new.room_id
    and room.clinic_id = new.organization_id
    and room.is_active = true;
  if v_capacity is null or v_capacity < 2 then
    raise exception 'GROUP_BOOKING_ROOM_SCOPE_INVALID';
  end if;
  if not exists (
    select 1 from public.clinic_memberships actor_membership
    where actor_membership.clinic_id = new.organization_id
      and actor_membership.user_id = case when tg_op='UPDATE'
        then nullif(current_setting('verto.group_operation_actor',true),'')::uuid else new.created_by end
      and lower(actor_membership.status) = 'active'
  ) then raise exception 'GROUP_BOOKING_ACTOR_SCOPE_INVALID'; end if;

  select count(distinct requested_id)::integer into v_team_count
  from unnest(new.professional_ids) requested_id;
  if v_team_count <> cardinality(new.professional_ids) then
    raise exception 'GROUP_BOOKING_TEAM_DUPLICATED';
  end if;

  select count(distinct membership.user_id)::integer into v_authorized_count
  from public.clinic_memberships membership
  where membership.clinic_id = new.organization_id
    and membership.user_id = any(new.professional_ids)
    and lower(membership.status) = 'active'
    and lower(membership.role) = 'therapist'
    and public.appointment_financial_service_key_v1(membership.specialty)
      = public.appointment_financial_service_key_v1(new.specialty);
  if v_authorized_count <> cardinality(new.professional_ids) then
    raise exception 'GROUP_BOOKING_PROFESSIONAL_SCOPE_INVALID';
  end if;
  return new;
end;
$$;
create or replace function public.assert_group_booking_slot_v1(p_booking public.group_session_bookings)
returns void language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_room_blocks boolean;
  v_other record;
  v_team jsonb;
  v_field text;
  v_professional_text_ids text[];
begin
  if p_booking.organization_id is null or p_booking.scheduled_end_at <= p_booking.scheduled_start_at then
    raise exception 'GROUP_BOOKING_SLOT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:' || p_booking.organization_id::text, 0));

  select coalesce(room.prevent_overlapping_appointments,true) into v_room_blocks
  from public.clinic_rooms room
  where room.id = p_booking.room_id and room.clinic_id = p_booking.organization_id and room.is_active = true;
  if not found then raise exception 'GROUP_BOOKING_ROOM_SCOPE_INVALID'; end if;
  v_professional_text_ids := array(select professional_id::text from unnest(p_booking.professional_ids) professional_id);

  -- The lock also protects against two concurrent GROUP headers with
  -- different idempotency keys but overlapping team/room.
  if exists (
    select 1 from public.group_session_bookings booking
    where booking.id<>p_booking.id and booking.organization_id = p_booking.organization_id
      and booking.status in ('RESERVED','COMPLETED')
      and booking.scheduled_start_at < p_booking.scheduled_end_at
      and booking.scheduled_end_at > p_booking.scheduled_start_at
      and (booking.professional_ids && p_booking.professional_ids or
           (v_room_blocks and booking.room_id = p_booking.room_id))
  ) then raise exception 'GROUP_BOOKING_SLOT_BUSY'; end if;

  -- Existing clinical appointments, including secondary professionals stored
  -- in source_payload, must also block conflicting new group reservations.
  for v_other in
    select a.id,a.room_id,a.therapist_id,a.source_payload
    from public.appointments a
    where a.source_payload->>'sessionGroupId' is distinct from p_booking.id::text
      and a.clinic_id = p_booking.organization_id
      and a.deleted_at is null and coalesce(a.is_active,true) = true
      and lower(coalesce(a.status,'')) in (
        'pending','pendente','scheduled','agendada','agendado',
        'confirmed','confirmada','confirmado','in_progress','em_andamento',
        'completed','concluida','concluido','realizada','realizado',
        'cancel_requested','cancelamento_solicitado',
        'reschedule_requested','remarcacao_solicitada',
        'rescheduled_active','remarcada_ativa','remarcado_ativo'
      )
      and coalesce(a.scheduled_start_at,a.scheduled_at) < p_booking.scheduled_end_at
      and coalesce(
        a.scheduled_end_at,
        coalesce(a.scheduled_start_at,a.scheduled_at)
          + coalesce(a.scheduled_duration_minutes,a.duration_minutes,50) * interval '1 minute'
      ) > p_booking.scheduled_start_at
  loop
    if v_other.therapist_id = any(p_booking.professional_ids) then
      raise exception 'GROUP_BOOKING_PROFESSIONAL_BUSY';
    end if;
    if v_room_blocks and v_other.room_id = p_booking.room_id::text then
      raise exception 'GROUP_BOOKING_ROOM_BUSY';
    end if;

    v_team := coalesce(v_other.source_payload,'{}'::jsonb);
    if jsonb_typeof(v_team) <> 'object' then
      raise exception 'GROUP_BOOKING_TEAM_UNVERIFIABLE';
    end if;
    foreach v_field in array array[
      'professionalIds','professional_ids','teamProfessionalIds','team_professional_ids'
    ] loop
      if not v_team ? v_field then continue; end if;
      if jsonb_typeof(v_team->v_field) <> 'array' then
        raise exception 'GROUP_BOOKING_TEAM_UNVERIFIABLE';
      end if;
      if exists (select 1 from jsonb_array_elements(v_team->v_field) as team_entry(value)
                 where jsonb_typeof(team_entry.value) <> 'string') then
        raise exception 'GROUP_BOOKING_TEAM_UNVERIFIABLE';
      end if;
      if (array(select jsonb_array_elements_text(v_team->v_field)) && v_professional_text_ids) then
        raise exception 'GROUP_BOOKING_PROFESSIONAL_BUSY';
      end if;
    end loop;
  end loop;
  return;
end;
$$;

create or replace function public.guard_group_booking_slot_v1()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  perform public.assert_group_booking_slot_v1(new);
  return new;
end;
$$;
drop trigger group_booking_z_slot_guard on public.group_session_bookings;
create trigger group_booking_z_slot_guard before insert or update of room_id,professional_ids,scheduled_start_at,scheduled_end_at
on public.group_session_bookings for each row execute function public.guard_group_booking_slot_v1();
drop trigger group_booking_work_schedule_guard on public.group_session_bookings;
create trigger group_booking_work_schedule_guard before insert or update of room_id,professional_ids,scheduled_start_at,scheduled_end_at
on public.group_session_bookings for each row execute function public.guard_group_work_schedule_v1();

create or replace function public.guard_appointment_group_slot_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_booking public.group_session_bookings%rowtype;
  v_group_id uuid;
  v_team text[];
  v_start timestamptz := coalesce(new.scheduled_start_at,new.scheduled_at);
  v_end timestamptz := coalesce(new.scheduled_end_at,v_start+coalesce(new.scheduled_duration_minutes,new.duration_minutes,50)*interval '1 minute');
  v_field text;
  v_room_blocks boolean := true;
begin
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:'||new.clinic_id::text,0));
  if tg_op='UPDATE' and old.clinic_id is distinct from new.clinic_id
     and exists(select 1 from public.group_session_participants where appointment_id=old.id) then
    raise exception 'GROUP_APPOINTMENT_SCOPE_IMMUTABLE';
  end if;
  -- A linked appointment cannot be detached or repriced through a generic writer.
  if tg_op='UPDATE' and exists(select 1 from public.group_session_participants where appointment_id=old.id) then
    if old.patient_id is distinct from new.patient_id
      or old.organization_id is distinct from new.organization_id
      or old.source_payload->>'sessionGroupId' is distinct from new.source_payload->>'sessionGroupId'
      or old.source_payload->>'sessionModality' is distinct from new.source_payload->>'sessionModality'
      or (old.source_payload->'professionalIds' is distinct from new.source_payload->'professionalIds'
        and current_setting('verto.group_reschedule_id',true) is distinct from old.source_payload->>'sessionGroupId')
      or old.source_payload->'privatePricingResolution' is distinct from new.source_payload->'privatePricingResolution'
      or old.source_payload->>'financialContextType' is distinct from new.source_payload->>'financialContextType'
      or old.source_payload->>'groupFinancialPlanId' is distinct from new.source_payload->>'groupFinancialPlanId' then
      raise exception 'GROUP_APPOINTMENT_FINANCE_IMMUTABLE';
    end if;
    if (old.scheduled_at is distinct from new.scheduled_at or old.scheduled_start_at is distinct from new.scheduled_start_at
      or old.scheduled_end_at is distinct from new.scheduled_end_at or old.room_id is distinct from new.room_id
      or old.therapist_id is distinct from new.therapist_id or old.duration_minutes is distinct from new.duration_minutes
      or old.scheduled_duration_minutes is distinct from new.scheduled_duration_minutes)
      and current_setting('verto.group_reschedule_id',true) is distinct from old.source_payload->>'sessionGroupId' then
      raise exception 'GROUP_USE_GROUP_RESCHEDULE';
    end if;
    -- Canceled participants retain their original date when the active group moves.
    if new.deleted_at is not null or coalesce(new.is_active,true)=false
      or lower(coalesce(new.status,'')) in ('canceled','cancelled','cancelada','cancelado','no_show','falta','deleted') then
      return new;
    end if;
  end if;
  if upper(coalesce(new.source_payload->>'session_modality',''))='GROUP'
     and new.source_payload->>'sessionModality' is distinct from 'GROUP' then
    raise exception 'GROUP_APPOINTMENT_RPC_REQUIRED';
  end if;
  if upper(coalesce(new.source_payload->>'sessionModality',''))='GROUP' then
    if coalesce(new.source_payload->>'sessionGroupId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'GROUP_APPOINTMENT_ID_INVALID';
    end if;
    v_group_id:=(new.source_payload->>'sessionGroupId')::uuid;
    select * into v_booking from public.group_session_bookings b
    where b.id=v_group_id and b.organization_id=new.clinic_id;
    if not found or new.organization_id is distinct from new.clinic_id
      or new.room_id is distinct from v_booking.room_id::text
      or v_start is distinct from v_booking.scheduled_start_at
      or v_end is distinct from v_booking.scheduled_end_at
      or not(new.therapist_id=any(v_booking.professional_ids))
      or new.location_type is distinct from 'clinica' or new.care_setting is distinct from 'CLINIC'
      or new.source_payload->'professionalIds' is distinct from to_jsonb(v_booking.professional_ids)
      or public.appointment_financial_service_key_v1(new.service_type) is distinct from public.appointment_financial_service_key_v1(v_booking.specialty) then
      raise exception 'GROUP_APPOINTMENT_CANONICAL_SLOT_REQUIRED';
    end if;
    if (tg_op='INSERT' or old.source_payload->>'sessionModality' is distinct from 'GROUP') and (
      current_setting('verto.group_booking_id',true) is distinct from v_group_id::text
      or v_booking.status<>'RESERVED'
      or new.source_payload->>'financialContextType' is distinct from 'PRIVATE'
      or new.source_payload#>>'{privatePricingResolution,session_modality}' is distinct from 'GROUP'
    ) then raise exception 'GROUP_APPOINTMENT_RPC_REQUIRED'; end if;
  elsif (new.source_payload ? 'sessionGroupId' or new.source_payload ? 'session_group_id') then
    raise exception 'GROUP_APPOINTMENT_RPC_REQUIRED';
  end if;
  if new.deleted_at is not null or coalesce(new.is_active,true)=false
    or lower(coalesce(new.status,'')) not in (
      'pending','pendente','scheduled','agendada','agendado','confirmed','confirmada','confirmado',
      'in_progress','em_andamento','completed','concluida','concluido','realizada','realizado',
      'cancel_requested','cancelamento_solicitado','reschedule_requested','remarcacao_solicitada',
      'rescheduled_active','remarcada_ativa','remarcado_ativo') then return new; end if;
  if v_group_id is not null and exists(select 1 from public.appointments a
    where a.clinic_id=new.clinic_id and a.patient_id=new.patient_id and a.id<>new.id
      and a.deleted_at is null and coalesce(a.is_active,true)
      and lower(a.status) in ('scheduled','pending','confirmed','in_progress','completed','cancel_requested','reschedule_requested')
      and coalesce(a.scheduled_start_at,a.scheduled_at)<v_end
      and coalesce(a.scheduled_end_at,coalesce(a.scheduled_start_at,a.scheduled_at)+coalesce(a.scheduled_duration_minutes,a.duration_minutes,50)*interval '1 minute')>v_start) then
    raise exception 'GROUP_PARTICIPANT_PATIENT_BUSY';
  end if;
  v_team:=array[new.therapist_id::text];
  foreach v_field in array array['professionalIds','professional_ids','teamProfessionalIds','team_professional_ids'] loop
    if new.source_payload ? v_field and jsonb_typeof(new.source_payload->v_field)='array' then
      v_team:=v_team||array(select jsonb_array_elements_text(new.source_payload->v_field));
    end if;
  end loop;
  select coalesce(r.prevent_overlapping_appointments,true) into v_room_blocks
  from public.clinic_rooms r where r.id::text=new.room_id and r.clinic_id=new.clinic_id;
  if exists(select 1 from public.group_session_bookings b
    where b.organization_id=new.clinic_id and b.status in ('RESERVED','COMPLETED')
      and b.id is distinct from v_group_id
      and b.scheduled_start_at<v_end+interval '120 minutes' and b.scheduled_end_at+interval '120 minutes'>v_start
      and ((coalesce(v_room_blocks,true) and b.room_id::text=new.room_id and b.scheduled_start_at<v_end and b.scheduled_end_at>v_start)
        or exists(select 1 from public.clinic_memberships membership
          cross join lateral (select least(120,greatest(0,coalesce((coalesce(membership.work_schedule->>'sessionBufferMinutes',membership.work_schedule->>'session_buffer_minutes'))::numeric,0)::int)) buffer) padding
          where membership.clinic_id=new.clinic_id and membership.user_id=any(b.professional_ids)
            and membership.user_id::text=any(v_team)
            and b.scheduled_start_at<v_end+padding.buffer*interval '1 minute'
            and b.scheduled_end_at+padding.buffer*interval '1 minute'>v_start))) then
    raise exception 'GROUP_BOOKING_SLOT_BUSY';
  end if;
  if exists(select 1 from public.group_session_participants p
    join public.appointments a on a.id=p.appointment_id
    where p.organization_id=new.clinic_id and p.patient_id=new.patient_id and a.id<>new.id
      and a.deleted_at is null and coalesce(a.is_active,true)
      and lower(a.status) in ('scheduled','pending','confirmed','in_progress','completed','cancel_requested','reschedule_requested')
      and coalesce(a.scheduled_start_at,a.scheduled_at)<v_end
      and coalesce(a.scheduled_end_at,coalesce(a.scheduled_start_at,a.scheduled_at)+coalesce(a.scheduled_duration_minutes,a.duration_minutes,50)*interval '1 minute')>v_start) then
    raise exception 'GROUP_PARTICIPANT_PATIENT_BUSY';
  end if;
  return new;
end;
$$;
create or replace function public.verify_group_session_participant_v1()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_booking public.group_session_bookings%rowtype;
  v_room_capacity integer;
  v_participant_count integer;
begin
  select * into v_booking
  from public.group_session_bookings
  where id = new.booking_id and organization_id = new.organization_id
  for update;
  if not found or v_booking.status <> 'RESERVED' then
    raise exception 'GROUP_PARTICIPANT_BOOKING_SCOPE_INVALID';
  end if;

  -- All joins of a booking serialize on the same header lock.
  select room.capacity into v_room_capacity from public.clinic_rooms room
  where room.id=v_booking.room_id and room.clinic_id=new.organization_id and room.is_active=true;
  if v_room_capacity is null or v_room_capacity < 2 then
    raise exception 'GROUP_PARTICIPANT_ROOM_UNAVAILABLE';
  end if;
  select count(*)::integer into v_participant_count
  from public.group_session_participants existing join public.appointments a on a.id=existing.appointment_id
  where existing.booking_id=new.booking_id and a.deleted_at is null and coalesce(a.is_active,true)
    and lower(a.status) in ('scheduled','pending','confirmed','in_progress','completed','cancel_requested','reschedule_requested');
  if v_participant_count >= 30 then
    raise exception 'GROUP_PARTICIPANT_CAPACITY_EXCEEDED';
  end if;
  if v_participant_count >= v_room_capacity then
    raise exception 'GROUP_PARTICIPANT_ROOM_CAPACITY_EXCEEDED';
  end if;

  if not exists (
    select 1 from public.patients patient
    where patient.id = new.patient_id and patient.clinic_id = new.organization_id
  ) then raise exception 'GROUP_PARTICIPANT_PATIENT_SCOPE_INVALID'; end if;

  if not exists (
    select 1 from public.patient_financial_plans plan
    where plan.id = new.financial_plan_id
      and plan.organization_id = new.organization_id
      and plan.patient_id = new.patient_id
      and plan.billing_mode = 'PRIVATE'
      and plan.status = 'ACTIVE'
      and public.appointment_financial_service_key_v1(
        coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type)
      ) = public.appointment_financial_service_key_v1(v_booking.specialty)
      and plan.group_amount_cents = new.unit_amount_cents
      and plan.valid_from <= v_booking.scheduled_start_at
      and (plan.valid_until is null or v_booking.scheduled_start_at < plan.valid_until)
  ) then raise exception 'GROUP_PARTICIPANT_RATE_SCOPE_INVALID'; end if;

  if not exists (
    select 1 from public.appointments appointment
    where appointment.id = new.appointment_id
      and appointment.clinic_id = new.organization_id
      and appointment.patient_id = new.patient_id
      and appointment.deleted_at is null
      and coalesce(appointment.is_active,true)=true
      and lower(coalesce(appointment.status,'')) in ('scheduled','pending','confirmed')
      and appointment.room_id = v_booking.room_id::text
      and appointment.location_type = 'clinica'
      and appointment.therapist_id = any(v_booking.professional_ids)
      and public.appointment_financial_service_key_v1(appointment.service_type)
        = public.appointment_financial_service_key_v1(v_booking.specialty)
      and coalesce(appointment.scheduled_duration_minutes,appointment.duration_minutes)
        = extract(epoch from (v_booking.scheduled_end_at-v_booking.scheduled_start_at))::integer / 60
      and coalesce(appointment.scheduled_start_at,appointment.scheduled_at) = v_booking.scheduled_start_at
      and appointment.scheduled_end_at = v_booking.scheduled_end_at
      and appointment.source_payload->>'sessionGroupId' = new.booking_id::text
      and appointment.source_payload->>'sessionModality' = 'GROUP'
      and jsonb_typeof(appointment.source_payload->'professionalIds') = 'array'
      and jsonb_array_length(appointment.source_payload->'professionalIds') = cardinality(v_booking.professional_ids)
      and appointment.source_payload->'professionalIds' @> to_jsonb(v_booking.professional_ids)
  ) then raise exception 'GROUP_PARTICIPANT_APPOINTMENT_SCOPE_INVALID'; end if;

  return new;
end;
$$;

-- Clinical and existing individual participant actions also maintain the ledger.
create or replace function public.sync_group_booking_status_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_booking public.group_session_bookings%rowtype;
  v_target text;
begin
  select booking.* into v_booking from public.group_session_bookings booking
  join public.group_session_participants participant on participant.booking_id=booking.id
    and participant.organization_id=booking.organization_id
  where participant.appointment_id=new.id and participant.organization_id=new.clinic_id;
  if not found then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:'||new.clinic_id::text,0));
  if exists(select 1 from public.group_session_participants p join public.appointments a on a.id=p.appointment_id
    where p.booking_id=v_booking.id and a.deleted_at is null and coalesce(a.is_active,true)
      and lower(a.status) in ('scheduled','pending','confirmed','in_progress','cancel_requested','reschedule_requested')) then
    v_target:='RESERVED';
  elsif exists(select 1 from public.group_session_participants p join public.appointments a on a.id=p.appointment_id
    where p.booking_id=v_booking.id and a.deleted_at is null and coalesce(a.is_active,true) and lower(a.status)='completed') then
    v_target:='COMPLETED';
  else v_target:='CANCELED'; end if;
  if v_target<>v_booking.status then
    if v_target='RESERVED' then
      perform public.assert_group_work_schedule_v1(v_booking);
      perform public.assert_group_booking_slot_v1(v_booking);
    end if;
    perform set_config('verto.group_status_sync_id',v_booking.id::text,true);
    update public.group_session_bookings set status=v_target,updated_at=clock_timestamp() where id=v_booking.id;
    perform set_config('verto.group_status_sync_id','',true);
  end if;
  return new;
end;
$$;
create trigger appointments_group_status_sync after update of status,is_active,deleted_at on public.appointments
for each row execute function public.sync_group_booking_status_v1();

create or replace function public.cancel_group_session_v1(
  p_organization_id uuid,p_actor_id uuid,p_booking_id uuid,p_patient_ids uuid[],
  p_reason text,p_policy_amounts jsonb,p_scope text,p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_booking public.group_session_bookings%rowtype;
  v_previous public.group_session_operations%rowtype;
  v_booking_ids uuid[];
  v_patients uuid[];
  v_hash text;
  v_changed_appointments uuid[]:=array[]::uuid[];
  v_row record;
  v_amount numeric;
begin
  perform 1 from public.clinic_memberships where clinic_id=p_organization_id and user_id=p_actor_id and status='active' for share;
  if not found then raise exception 'GROUP_ACTOR_OUT_OF_SCOPE'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 3 and 1000
    or p_scope not in ('single','future') or p_scope is null
    or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9:._-]{12,120}$'
    or jsonb_typeof(coalesce(p_policy_amounts,'{}'::jsonb))<>'object' then raise exception 'GROUP_INPUT_INVALID'; end if;
  if p_patient_ids is not null then
    if cardinality(p_patient_ids) not between 1 and 30 then raise exception 'GROUP_INPUT_INVALID'; end if;
    select array_agg(x order by x) into v_patients from(select distinct x from unnest(p_patient_ids)x where x is not null)s;
    if cardinality(v_patients) is distinct from cardinality(p_patient_ids) then raise exception 'GROUP_DUPLICATED_IDS'; end if;
    if p_scope='future' then raise exception 'GROUP_PARTIAL_FUTURE_CANCEL_UNSUPPORTED'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:'||p_organization_id::text,0));
  select * into v_booking from public.group_session_bookings where id=p_booking_id and organization_id=p_organization_id for update;
  if not found then raise exception 'GROUP_BOOKING_OUT_OF_SCOPE'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('operation','CANCEL','booking',p_booking_id,
    'patients',v_patients,'reason',btrim(p_reason),'policy',coalesce(p_policy_amounts,'{}'::jsonb),'scope',p_scope)::text,'UTF8')),'hex');
  select * into v_previous from public.group_session_operations where organization_id=p_organization_id and operation_key=p_idempotency_key;
  if found then
    if v_previous.payload_hash<>v_hash then raise exception 'GROUP_IDEMPOTENCY_CONFLICT'; end if;
    return public.group_session_result_v1(p_organization_id,v_previous.booking_ids)||jsonb_build_object('idempotent',true);
  end if;
  if p_scope='future' and v_booking.series_id is not null then
    select array_agg(id order by scheduled_start_at,id) into v_booking_ids from public.group_session_bookings
    where organization_id=p_organization_id and series_id=v_booking.series_id
      and scheduled_start_at>=v_booking.scheduled_start_at and status='RESERVED';
  else v_booking_ids:=array[p_booking_id]; end if;
  v_booking_ids:=coalesce(v_booking_ids,array[p_booking_id]);
  perform 1 from public.group_session_bookings where id=any(v_booking_ids) order by id for update;
  if v_patients is not null and (select count(*) from public.group_session_participants
    where booking_id=p_booking_id and patient_id=any(v_patients))<>cardinality(v_patients) then raise exception 'GROUP_PATIENT_OUT_OF_SCOPE'; end if;
  if exists(select 1 from public.group_session_participants p join public.appointments a on a.id=p.appointment_id
    where p.booking_id=any(v_booking_ids) and (v_patients is null or p.patient_id=any(v_patients))
      and lower(a.status) in ('completed','in_progress')) then raise exception 'GROUP_CLINICAL_HISTORY_IMMUTABLE'; end if;
  perform set_config('verto.group_bulk_operation','1',true);
  for v_row in select a.id,a.patient_id from public.group_session_participants p join public.appointments a on a.id=p.appointment_id
    where p.organization_id=p_organization_id and p.booking_id=any(v_booking_ids)
      and (v_patients is null or p.patient_id=any(v_patients))
      and a.deleted_at is null and coalesce(a.is_active,true)
      and lower(a.status) in ('scheduled','pending','confirmed','cancel_requested','reschedule_requested') order by a.id for update of a loop
    v_amount:=null;
    if coalesce(p_policy_amounts,'{}'::jsonb) ? v_row.patient_id::text then
      if jsonb_typeof(p_policy_amounts->v_row.patient_id::text)<>'number' then raise exception 'GROUP_POLICY_AMOUNT_INVALID'; end if;
      v_amount:=(p_policy_amounts->>v_row.patient_id::text)::numeric;
    end if;
    update public.appointments set status='canceled',financial_event_actor_id=p_actor_id,
      financial_event_reason=btrim(p_reason),financial_policy_decision_amount=v_amount,
      financial_policy_decision_event=case when v_amount is not null then 'CANCELED' end,
      source_payload=source_payload||jsonb_build_object('privatePricingActorId',p_actor_id,'privatePricingReason',btrim(p_reason)),
      updated_at=clock_timestamp() where id=v_row.id;
    v_changed_appointments:=array_append(v_changed_appointments,v_row.id);
  end loop;
  perform public.project_group_sessions_to_clinic_state_v1(p_organization_id,p_actor_id,v_booking_ids,'group:'||p_idempotency_key);
  perform public.emit_group_appointment_events_v1(p_organization_id,p_actor_id,v_changed_appointments,'appointment.status.updated',p_idempotency_key);
  perform set_config('verto.group_bulk_operation','',true);
  insert into public.group_session_operations(organization_id,operation_key,payload_hash,booking_ids,created_by)
  values(p_organization_id,p_idempotency_key,v_hash,v_booking_ids,p_actor_id);
  return public.group_session_result_v1(p_organization_id,v_booking_ids)||jsonb_build_object('idempotent',false);
end;
$$;

create or replace function public.reschedule_group_session_v1(
  p_organization_id uuid,p_actor_id uuid,p_booking_id uuid,p_local_date date,p_local_time time,
  p_duration_minutes integer,p_room_id uuid,p_professional_ids uuid[],p_reason text,p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_booking public.group_session_bookings%rowtype;
  v_previous public.group_session_operations%rowtype;
  v_hash text;
  v_changed_appointments uuid[]:=array[]::uuid[];
  v_team uuid[];
  v_team_names text[];
  v_start timestamptz;
  v_timezone text;
  v_room public.clinic_rooms%rowtype;
  v_row record;
begin
  perform 1 from public.clinic_memberships where clinic_id=p_organization_id and user_id=p_actor_id and status='active' for share;
  if not found then raise exception 'GROUP_ACTOR_OUT_OF_SCOPE'; end if;
  if p_local_date is null or p_local_time is null or p_duration_minutes is null or p_duration_minutes not between 15 and 360
    or extract(second from p_local_time)<>0 or p_professional_ids is null or cardinality(p_professional_ids) not between 1 and 8
    or length(btrim(coalesce(p_reason,''))) not between 3 and 1000
    or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9:._-]{12,120}$' then raise exception 'GROUP_INPUT_INVALID'; end if;
  select array_agg(x order by x) into v_team from(select distinct x from unnest(p_professional_ids)x where x is not null)s;
  if cardinality(v_team) is distinct from cardinality(p_professional_ids) then raise exception 'GROUP_DUPLICATED_IDS'; end if;
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:'||p_organization_id::text,0));
  select * into v_booking from public.group_session_bookings where id=p_booking_id and organization_id=p_organization_id for update;
  if not found then raise exception 'GROUP_BOOKING_OUT_OF_SCOPE'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('operation','RESCHEDULE','booking',p_booking_id,
    'date',p_local_date,'time',p_local_time,'duration',p_duration_minutes,'room',p_room_id,'team',v_team,'reason',btrim(p_reason))::text,'UTF8')),'hex');
  select * into v_previous from public.group_session_operations where organization_id=p_organization_id and operation_key=p_idempotency_key;
  if found then
    if v_previous.payload_hash<>v_hash then raise exception 'GROUP_IDEMPOTENCY_CONFLICT'; end if;
    return public.group_session_result_v1(p_organization_id,array[p_booking_id])||jsonb_build_object('idempotent',true);
  end if;
  if v_booking.status<>'RESERVED' then raise exception 'GROUP_BOOKING_NOT_RESERVED'; end if;
  if exists(select 1 from public.group_session_participants p join public.appointments a on a.id=p.appointment_id
    where p.booking_id=p_booking_id and lower(a.status) in ('completed','in_progress')) then raise exception 'GROUP_CLINICAL_HISTORY_IMMUTABLE'; end if;
  select timezone into strict v_timezone from public.clinics where id=p_organization_id;
  v_start:=(p_local_date+p_local_time) at time zone v_timezone;
  if (v_start at time zone v_timezone)::timestamp<>(p_local_date+p_local_time) then raise exception 'GROUP_SLOT_TIMEZONE_INVALID'; end if;
  select * into v_room from public.clinic_rooms where id=p_room_id and clinic_id=p_organization_id and is_active for share;
  if not found or v_room.capacity is null or (select count(*) from public.group_session_participants p join public.appointments a on a.id=p.appointment_id
    where p.booking_id=p_booking_id and a.deleted_at is null and coalesce(a.is_active,true)
      and lower(a.status) in ('scheduled','pending','confirmed','cancel_requested','reschedule_requested'))>v_room.capacity then
    raise exception 'GROUP_ROOM_CAPACITY_EXCEEDED'; end if;
  select array_agg(coalesce(nullif(btrim(u.name),''),'Profissional') order by requested.professional_id) into v_team_names
  from unnest(v_team) requested(professional_id) left join public.users u on u.id=requested.professional_id;
  perform set_config('verto.group_bulk_operation','1',true);
  perform set_config('verto.group_reschedule_id',p_booking_id::text,true);
  perform set_config('verto.group_operation_actor',p_actor_id::text,true);
  update public.group_session_bookings set scheduled_start_at=v_start,scheduled_end_at=v_start+p_duration_minutes*interval '1 minute',
    room_id=p_room_id,professional_ids=v_team,updated_at=clock_timestamp() where id=p_booking_id;
  for v_row in select a.id from public.group_session_participants p join public.appointments a on a.id=p.appointment_id
    where p.booking_id=p_booking_id and a.deleted_at is null and coalesce(a.is_active,true)
      and lower(a.status) in ('scheduled','pending','confirmed','cancel_requested','reschedule_requested') order by a.id for update of a loop
    update public.appointments set scheduled_at=v_start,scheduled_start_at=v_start,
      scheduled_end_at=v_start+p_duration_minutes*interval '1 minute',duration_minutes=p_duration_minutes,
      scheduled_duration_minutes=p_duration_minutes,room_id=p_room_id::text,room_name=v_room.name,therapist_id=v_team[1],therapist_name=v_team_names[1],location_timezone=v_timezone,
      status='scheduled',confirmed_at=null,confirmed_by=null,confirmed_by_role=null,
      patient_confirmation_status=null,patient_confirmation_at=null,patient_confirmation_by=null,patient_confirmation_source=null,
      patient_response=null,patient_responded_at=null,financial_event_actor_id=p_actor_id,financial_event_reason=btrim(p_reason),
      source_payload=source_payload||jsonb_build_object('professionalIds',v_team,'professionalNames',v_team_names,'professional',v_team_names[1],'date',p_local_date::text,'time',to_char(p_local_time,'HH24:MI'),
        'durationMinutes',p_duration_minutes,'privatePricingActorId',p_actor_id,'privatePricingReason',btrim(p_reason)),
      updated_at=clock_timestamp() where id=v_row.id;
    perform public.assert_group_patient_finance_v1(p_organization_id,v_row.id);
    v_changed_appointments:=array_append(v_changed_appointments,v_row.id);
  end loop;
  perform public.project_group_sessions_to_clinic_state_v1(p_organization_id,p_actor_id,array[p_booking_id],'group:'||p_idempotency_key);
  perform public.emit_group_appointment_events_v1(p_organization_id,p_actor_id,v_changed_appointments,'appointment.updated',p_idempotency_key);
  perform set_config('verto.group_bulk_operation','',true);
  insert into public.group_session_operations(organization_id,operation_key,payload_hash,booking_ids,created_by)
  values(p_organization_id,p_idempotency_key,v_hash,array[p_booking_id],p_actor_id);
  perform set_config('verto.group_reschedule_id','',true);
  perform set_config('verto.group_operation_actor','',true);
  return public.group_session_result_v1(p_organization_id,array[p_booking_id])||jsonb_build_object('idempotent',false);
end;
$$;

-- A capacity edit cannot invalidate a currently reserved collective session.
create or replace function public.guard_group_room_capacity_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.capacity is not distinct from old.capacity then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('group-booking-slot:'||new.clinic_id::text,0));
  if exists(select 1 from public.group_session_bookings b
    where b.organization_id=new.clinic_id and b.room_id=new.id and b.status='RESERVED'
      and (new.capacity is null or new.capacity<(select count(*) from public.group_session_participants p join public.appointments a on a.id=p.appointment_id
        where p.booking_id=b.id and a.deleted_at is null and coalesce(a.is_active,true)
          and lower(a.status) in ('scheduled','pending','confirmed','in_progress','cancel_requested','reschedule_requested')))) then
    raise exception 'GROUP_ROOM_CAPACITY_RESERVED'; end if;
  return new;
end;
$$;
create trigger clinic_rooms_group_capacity_guard before update of capacity on public.clinic_rooms
for each row execute function public.guard_group_room_capacity_v1();

revoke all on function public.assert_group_booking_slot_v1(public.group_session_bookings),public.sync_group_booking_status_v1(),
  public.guard_group_room_capacity_v1(),public.cancel_group_session_v1(uuid,uuid,uuid,uuid[],text,jsonb,text,text),
  public.reschedule_group_session_v1(uuid,uuid,uuid,date,time,integer,uuid,uuid[],text,text) from public,anon,authenticated;
grant execute on function public.assert_group_booking_slot_v1(public.group_session_bookings),
  public.cancel_group_session_v1(uuid,uuid,uuid,uuid[],text,jsonb,text,text),
  public.reschedule_group_session_v1(uuid,uuid,uuid,date,time,integer,uuid,uuid[],text,text) to service_role;
comment on table public.group_session_bookings is 'Canonical collective reservation; slot edits only through the atomic backend lifecycle RPC, with financial history retained.';

-- Source: 20261016060000_group_session_state_and_events.sql; sha256 8aaf8be7059249f488d7ba5638f7eeaf42a5320a0013eb8f23ecebbc46e7b3f5

-- Preserve the existing cold-login clinic-state contract in the same transaction.
-- No financial quote or price is copied to the general clinic-state read model.

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

-- Source: 20261021223000_patient_financial_plan_professional_binding_v3.sql; sha256 40fe18dd7b2879ae8a630834bbf4fa165abf006443f9c1853b71e413d7874528

-- P0 #352 — Persist the selected clinic professional on the current canonical
-- financial-plan version without rewriting historic billing snapshots.
-- Staging candidate only; apply before deploying backend v3. No backfill.

-- This column travels with the canonical versioned financial-plan row. It
-- remains nullable for all historic/legacy plans; no historical backfill.
alter table public.patient_financial_plans
  add column if not exists professional_user_id uuid;
create index if not exists patient_financial_plans_professional_active_idx
  on public.patient_financial_plans(organization_id,professional_user_id)
  where status='ACTIVE' and professional_user_id is not null;

-- The service invokes one atomic reconciliation. The v2 financial-history
-- engine is untouched: it still versions price changes and preserves receipts.
-- No new endpoint, grant or client-direct privileged access is introduced.
create or replace function public.reconcile_patient_financial_plans_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_actor_id uuid,
  p_plans jsonb,
  p_preserve_insurance_context boolean default false
)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_row jsonb;
  v_key text;
  v_requested_id uuid;
  v_user uuid;
  v_service_key text;
  v_canonical_service_key text;
  v_current public.patient_financial_plans%rowtype;
  v_previous public.patient_financial_plans%rowtype;
  v_result jsonb;
  v_data jsonb;
begin
  if p_organization_id is null or p_patient_id is null or
     jsonb_typeof(p_plans) is distinct from 'array' then
    raise exception 'FINANCIAL_PLAN_INPUT_INVALID';
  end if;

  -- Share the exact per-clinic/patient transaction lock used by v2 BEFORE
  -- inspecting legacy plans. Otherwise a concurrent v2 save could change
  -- an unbound plan between the eligibility check and reconciliation.
  -- Reacquiring the same advisory lock inside v2 is transaction-reentrant.
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || p_patient_id::text, 0)
  );

  -- Every new plan must have an explicit valid assignment. Existing unbound
  -- plans are grandfathered only with their unchanged canonical specialty.
  for v_row in select value from jsonb_array_elements(p_plans) loop
    v_key:=nullif(btrim(coalesce(v_row->>'client_plan_key','')),'');
    v_requested_id:=null;
    if coalesce(v_row->>'id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_requested_id:=(v_row->>'id')::uuid;
    end if;
    v_service_key:=public.appointment_financial_service_key_v1(
      coalesce(nullif(v_row->>'service_name_snapshot',''),
        nullif(v_row->>'custom_service_name',''),v_row->>'service_type')
    );
    if nullif(v_service_key,'') is null then
      raise exception 'FINANCIAL_PLAN_SPECIALTY_INVALID';
    end if;
    v_user:=null;
    if nullif(btrim(coalesce(v_row->>'professional_user_id','')),'') is not null then
      if (v_row->>'professional_user_id') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'FINANCIAL_PLAN_PROFESSIONAL_INVALID';
      end if;
      v_user:=(v_row->>'professional_user_id')::uuid;
      -- Do not trust the display snapshot as the authority for a NEW
      -- therapist binding: v2 uses it for pricing, but the professional
      -- must match both the canonical service type and that snapshot.
      -- Legacy unbound plans retain their original compatibility path.
      v_canonical_service_key:=public.appointment_financial_service_key_v1(
        case when upper(coalesce(v_row->>'service_type',''))='CUSTOM'
          then coalesce(nullif(v_row->>'custom_service_name',''),
            nullif(v_row->>'service_name_snapshot',''))
          else v_row->>'service_type'
        end
      );
      if nullif(v_canonical_service_key,'') is null
         or v_canonical_service_key is distinct from v_service_key then
        raise exception 'FINANCIAL_PLAN_SPECIALTY_INVALID';
      end if;
      perform 1 from public.clinic_memberships m
      where m.clinic_id=p_organization_id and m.user_id=v_user
        and m.role='therapist' and m.status='active'
        and public.appointment_financial_service_key_v1(m.specialty)=v_service_key
      for share;
      if not found then raise exception 'FINANCIAL_PLAN_PROFESSIONAL_NOT_ELIGIBLE'; end if;
    else
      select plan.* into v_previous from public.patient_financial_plans plan
      where plan.organization_id=p_organization_id and plan.patient_id=p_patient_id
        and plan.status='ACTIVE'
        and ((v_requested_id is not null and plan.id=v_requested_id)
          or (v_key is not null and plan.client_plan_key=v_key))
      order by plan.version desc limit 1;
      if not found or public.appointment_financial_service_key_v1(
        coalesce(nullif(v_previous.service_name_snapshot,''),
          nullif(v_previous.custom_service_name,''),v_previous.service_type)
      ) is distinct from v_service_key then
        raise exception 'FINANCIAL_PLAN_PROFESSIONAL_REQUIRED';
      end if;
    end if;
  end loop;

  -- A PL/pgSQL function and the nested v2 function share one SQL transaction:
  -- an exception in the association phase rolls back the financial mutations.
  v_result:=public.reconcile_patient_financial_plans_v2(
    p_organization_id,p_patient_id,p_actor_id,p_plans,p_preserve_insurance_context
  );
  if v_result->>'success' is distinct from 'true' then return v_result; end if;

  for v_row in select value from jsonb_array_elements(p_plans) loop
    if nullif(btrim(coalesce(v_row->>'professional_user_id','')),'') is null then continue; end if;
    v_user:=(v_row->>'professional_user_id')::uuid;
    v_key:=nullif(btrim(coalesce(v_row->>'client_plan_key','')),'');
    v_requested_id:=null;
    if coalesce(v_row->>'id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_requested_id:=(v_row->>'id')::uuid;
    end if;
    select plan.* into v_current from public.patient_financial_plans plan
    where plan.organization_id=p_organization_id and plan.patient_id=p_patient_id
      and plan.status='ACTIVE'
      and ((v_requested_id is not null and plan.id=v_requested_id)
        or (v_key is not null and plan.client_plan_key=v_key))
    order by plan.version desc limit 1;
    if not found then raise exception 'FINANCIAL_PLAN_BINDING_NOT_PERSISTED'; end if;
    -- No billing amount, charge, receipt or historic version is rewritten.
    -- The currently ACTIVE version carries its own responsible professional.
    update public.patient_financial_plans
      set professional_user_id=v_user
    where id=v_current.id and organization_id=p_organization_id
      and patient_id=p_patient_id and status='ACTIVE';
    if not found then raise exception 'FINANCIAL_PLAN_BINDING_NOT_PERSISTED'; end if;
  end loop;

  -- Older authorized clients may omit the assignment when editing an
  -- existing plan. If v2 versioned that same specialty, preserve its prior
  -- assignment on the new active version instead of silently dropping it.
  update public.patient_financial_plans current_plan
    set professional_user_id=prior_plan.professional_user_id
  from public.patient_financial_plans prior_plan
  where current_plan.organization_id=p_organization_id
    and current_plan.patient_id=p_patient_id and current_plan.status='ACTIVE'
    and current_plan.professional_user_id is null
    and current_plan.supersedes_plan_id=prior_plan.id
    and prior_plan.organization_id=current_plan.organization_id
    and prior_plan.patient_id=current_plan.patient_id
    and prior_plan.professional_user_id is not null
    and public.appointment_financial_service_key_v1(
      coalesce(nullif(current_plan.service_name_snapshot,''),
        nullif(current_plan.custom_service_name,''),current_plan.service_type)
    )=public.appointment_financial_service_key_v1(
      coalesce(nullif(prior_plan.service_name_snapshot,''),
        nullif(prior_plan.custom_service_name,''),prior_plan.service_type)
    );

  select coalesce(jsonb_agg(to_jsonb(plan) order by plan.created_at asc),'[]'::jsonb)
    into v_data
  from public.patient_financial_plans plan
  where plan.organization_id=p_organization_id and plan.patient_id=p_patient_id
    and plan.status='ACTIVE';

  return v_result || jsonb_build_object('data',v_data);
end;
$$;
revoke all on function public.reconcile_patient_financial_plans_v3(uuid,uuid,uuid,jsonb,boolean)
  from public,anon,authenticated;
grant execute on function public.reconcile_patient_financial_plans_v3(uuid,uuid,uuid,jsonb,boolean)
  to service_role;

notify pgrst, 'reload schema';

commit;
