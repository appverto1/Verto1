-- Two rates within ONE logical specialty plan: avoid duplicate active plan ambiguity.
-- A zero group rate disables the group modality; existing individual prices survive.
begin;

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

commit;
