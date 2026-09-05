-- Monthly variable patient billing by completed sessions.
-- Additive foundation: keeps payments as the canonical receivable and
-- payment_appointment_items as the appointment-level ledger.
-- IMPORTANT: this migration is delivered for manual application; it is not executed by this task.

begin;

create extension if not exists pgcrypto;

do $$
declare
  v_missing text;
begin
  foreach v_missing in array array[
    'public.patient_financial_plans',
    'public.payments',
    'public.payment_appointment_items',
    'public.payment_transactions',
    'public.payment_audit_events',
    'public.appointments',
    'public.appointment_billing_contexts',
    'public.patients',
    'public.clinic_payers'
  ] loop
    if to_regclass(v_missing) is null then
      raise exception 'MONTHLY_SESSION_BILLING_PREFLIGHT_RELATION_MISSING: %', v_missing;
    end if;
  end loop;

  if to_regprocedure('public.reconcile_patient_financial_plans_v1(uuid,uuid,uuid,jsonb,boolean)') is null then
    raise exception 'MONTHLY_SESSION_BILLING_PREFLIGHT_ETAPA1_RECONCILIATION_MISSING';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='patient_financial_plans' and column_name='logical_plan_id'
  ) then
    raise exception 'MONTHLY_SESSION_BILLING_PREFLIGHT_ETAPA1_VERSIONING_MISSING';
  end if;
  select string_agg(expected.column_name || ':' || expected.udt_name, ', ' order by expected.column_name)
  into v_missing
  from (
    values
      ('id','uuid'),
      ('organization_id','uuid'),
      ('appointment_id','uuid'),
      ('patient_id','uuid'),
      ('payer_type','text'),
      ('payer_id','uuid'),
      ('payer_name_snapshot','text'),
      ('service_type','text'),
      ('updated_at','timestamptz')
  ) as expected(column_name, udt_name)
  left join information_schema.columns actual
    on actual.table_schema='public'
   and actual.table_name='appointment_billing_contexts'
   and actual.column_name=expected.column_name
   and actual.udt_name=expected.udt_name
  where actual.column_name is null;
  if v_missing is not null then
    raise exception 'MONTHLY_SESSION_BILLING_PREFLIGHT_APPOINTMENT_BILLING_CONTEXT_DRIFT: %', v_missing;
  end if;

  if to_regclass('public.appointment_billing_context_tombstones') is not null then
    select string_agg(expected.column_name || ':' || expected.udt_name, ', ' order by expected.column_name)
    into v_missing
    from (
      values
        ('organization_id','uuid'),
        ('appointment_id','uuid'),
        ('patient_id','uuid'),
        ('reason','text'),
        ('source_context_id','uuid'),
        ('removed_at','timestamptz'),
        ('updated_at','timestamptz')
    ) as expected(column_name, udt_name)
    left join information_schema.columns actual
      on actual.table_schema='public'
     and actual.table_name='appointment_billing_context_tombstones'
     and actual.column_name=expected.column_name
     and actual.udt_name=expected.udt_name
    where actual.column_name is null;
    if v_missing is not null then
      raise exception 'MONTHLY_SESSION_BILLING_PREFLIGHT_CONTEXT_TOMBSTONE_DRIFT: %', v_missing;
    end if;
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname='public'
      and tablename='payment_appointment_items'
      and indexname='idx_payment_items_one_active_charge_per_appointment'
      and indexdef ilike '%organization_id%'
      and indexdef ilike '%appointment_id%'
      and indexdef ilike '%active = true%'
  ) then
    raise exception 'MONTHLY_SESSION_BILLING_PREFLIGHT_ACTIVE_APPOINTMENT_UNIQUENESS_MISSING';
  end if;
end
$$;

alter table public.patient_financial_plans
  add column if not exists billing_frequency text,
  add column if not exists pricing_unit text,
  add column if not exists aggregation_method text;

-- Backfill only unambiguous legacy behavior. INSURANCE remains unspecified unless
-- explicitly configured for the new model; it must never become monthly by migration.
update public.patient_financial_plans
set billing_frequency = 'AT_SESSION', pricing_unit = 'SESSION'
where billing_mode = 'PRIVATE'
  and coalesce(billing_frequency, '') = ''
  and coalesce(pricing_unit, '') = '';

update public.patient_financial_plans
set billing_frequency = 'MONTHLY', pricing_unit = 'FIXED_PERIOD'
where billing_mode = 'MONTHLY'
  and coalesce(billing_frequency, '') = ''
  and coalesce(pricing_unit, '') = '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.patient_financial_plans'::regclass
      and conname='patient_financial_plans_billing_frequency_check'
  ) then
    alter table public.patient_financial_plans
      add constraint patient_financial_plans_billing_frequency_check
      check (billing_frequency is null or billing_frequency in ('AT_SESSION','MONTHLY'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.patient_financial_plans'::regclass
      and conname='patient_financial_plans_pricing_unit_check'
  ) then
    alter table public.patient_financial_plans
      add constraint patient_financial_plans_pricing_unit_check
      check (pricing_unit is null or pricing_unit in ('SESSION','FIXED_PERIOD'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.patient_financial_plans'::regclass
      and conname='patient_financial_plans_aggregation_method_check'
  ) then
    alter table public.patient_financial_plans
      add constraint patient_financial_plans_aggregation_method_check
      check (aggregation_method is null or aggregation_method in ('ELIGIBLE_COMPLETED_SESSIONS'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.patient_financial_plans'::regclass
      and conname='patient_financial_plans_monthly_session_shape_check'
  ) then
    alter table public.patient_financial_plans
      add constraint patient_financial_plans_monthly_session_shape_check
      check (
        not (
          billing_frequency = 'MONTHLY'
          and pricing_unit = 'SESSION'
          and aggregation_method = 'ELIGIBLE_COMPLETED_SESSIONS'
        )
        or (
          billing_mode in ('PRIVATE','INSURANCE')
          and amount_cents > 0
          and due_day between 1 and 31
          and (billing_mode <> 'INSURANCE' or payer_id is not null)
        )
      );
  end if;
end
$$;

create index if not exists idx_patient_financial_plans_monthly_session_resolve
  on public.patient_financial_plans (
    organization_id, patient_id, billing_mode, payer_id, service_type, valid_from, valid_until, version desc
  )
  where billing_frequency='MONTHLY'
    and pricing_unit='SESSION'
    and aggregation_method='ELIGIBLE_COMPLETED_SESSIONS';

alter table public.payments
  add column if not exists billing_frequency text,
  add column if not exists pricing_unit text,
  add column if not exists aggregation_method text,
  add column if not exists monthly_billing_group_key text,
  add column if not exists patient_financial_plan_logical_id uuid,
  add column if not exists monthly_session_count integer not null default 0,
  add column if not exists monthly_adjustment_required boolean not null default false;

alter table public.payment_appointment_items
  add column if not exists billing_item_key text,
  add column if not exists billing_item_type text,
  add column if not exists patient_financial_plan_id uuid,
  add column if not exists patient_financial_plan_logical_id uuid,
  add column if not exists patient_financial_plan_version integer,
  add column if not exists payer_id_snapshot uuid,
  add column if not exists payer_name_snapshot text,
  add column if not exists competence_month date,
  add column if not exists completion_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivation_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.payment_appointment_items'::regclass
      and conname='payment_items_patient_financial_plan_fk'
  ) then
    alter table public.payment_appointment_items
      add constraint payment_items_patient_financial_plan_fk
      foreign key (patient_financial_plan_id)
      references public.patient_financial_plans(id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.payment_appointment_items'::regclass
      and conname='payment_items_payer_snapshot_fk'
  ) then
    alter table public.payment_appointment_items
      add constraint payment_items_payer_snapshot_fk
      foreign key (payer_id_snapshot)
      references public.clinic_payers(id)
      on delete restrict;
  end if;
end
$$;

create unique index if not exists idx_payments_monthly_session_group
  on public.payments (organization_id, monthly_billing_group_key)
  where source='MONTHLY_SESSION_AGGREGATE' and monthly_billing_group_key is not null;

create unique index if not exists idx_payment_items_monthly_session_key
  on public.payment_appointment_items (organization_id, billing_item_key)
  where billing_item_type='MONTHLY_SESSION' and billing_item_key is not null;

create index if not exists idx_payment_items_monthly_session_payment
  on public.payment_appointment_items (organization_id, payment_id, active, competence_month)
  where billing_item_type='MONTHLY_SESSION';

create index if not exists idx_payment_items_monthly_session_plan_history
  on public.payment_appointment_items (organization_id, patient_financial_plan_id)
  where billing_item_type='MONTHLY_SESSION' and patient_financial_plan_id is not null;

-- Durable marker for an explicitly removed appointment billing context. It is
-- intentionally independent from payment_appointment_items so removal before a
-- session becomes COMPLETED still fails closed and can never resurrect billing
-- through source-payload/plan fallback.
create table if not exists public.appointment_billing_context_tombstones (
  organization_id uuid not null,
  appointment_id uuid not null,
  patient_id uuid,
  reason text not null default 'BILLING_CONTEXT_REMOVED',
  source_context_id uuid,
  removed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, appointment_id),
  constraint appointment_billing_context_tombstones_reason_check
    check (reason='BILLING_CONTEXT_REMOVED')
);

create index if not exists idx_appointment_billing_context_tombstones_patient
  on public.appointment_billing_context_tombstones (organization_id, patient_id, removed_at desc);

alter table public.appointment_billing_context_tombstones enable row level security;
revoke all on table public.appointment_billing_context_tombstones from public, anon, authenticated;
grant select, insert, update, delete on table public.appointment_billing_context_tombstones to service_role;

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
          amount_cents, copayment_amount_cents, payment_method, due_day, package_valid_until, status, notes,
          created_by, created_at, updated_at
        ) values (
          p_organization_id, p_patient_id, coalesce(v_client_plan_key, v_current.client_plan_key), coalesce(v_current.logical_plan_id, v_current.id), coalesce(v_current.version, 1) + 1,
          v_now, null, v_current.id,
          v_service_type, v_custom_service_name, v_service_name_snapshot, v_billing_mode, v_billing_frequency, v_pricing_unit, v_aggregation_method, v_payer_id, v_payer_name_snapshot,
          v_insurance_plan_name, v_authorization_code, v_authorization_valid_until, v_sessions_quantity, v_quantity_period,
          v_amount_cents, v_copayment_amount_cents, v_payment_method, v_due_day, v_package_valid_until, 'ACTIVE', v_notes,
          p_actor_id, v_now, v_now
        ) returning * into v_new;
      end if;
    else
      insert into public.patient_financial_plans (
        organization_id, patient_id, client_plan_key, logical_plan_id, version, valid_from, valid_until, supersedes_plan_id,
        service_type, custom_service_name, service_name_snapshot, billing_mode, billing_frequency, pricing_unit, aggregation_method, payer_id, payer_name_snapshot,
        insurance_plan_name, authorization_code, authorization_valid_until, sessions_quantity, quantity_period,
        amount_cents, copayment_amount_cents, payment_method, due_day, package_valid_until, status, notes,
        created_by, created_at, updated_at
      ) values (
        p_organization_id, p_patient_id, v_client_plan_key, gen_random_uuid(), 1, v_now, null, null,
        v_service_type, v_custom_service_name, v_service_name_snapshot, v_billing_mode, v_billing_frequency, v_pricing_unit, v_aggregation_method, v_payer_id, v_payer_name_snapshot,
        v_insurance_plan_name, v_authorization_code, v_authorization_valid_until, v_sessions_quantity, v_quantity_period,
        v_amount_cents, v_copayment_amount_cents, v_payment_method, v_due_day, v_package_valid_until, 'ACTIVE', v_notes,
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



revoke all on function public.reconcile_patient_financial_plans_v2(uuid, uuid, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.reconcile_patient_financial_plans_v2(uuid, uuid, uuid, jsonb, boolean) to service_role;

create or replace function public.monthly_session_due_date_v1(
  p_competence_month date,
  p_due_day integer
)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  with next_month as (
    select (date_trunc('month', p_competence_month)::date + interval '1 month')::date as first_day
  )
  select case
    when p_competence_month is null or p_due_day is null then null
    else make_date(
      extract(year from first_day)::integer,
      extract(month from first_day)::integer,
      least(
        greatest(p_due_day, 1),
        extract(day from ((first_day + interval '1 month') - interval '1 day'))::integer
      )
    )
  end
  from next_month;
$$;

create or replace function public.monthly_session_payment_locked_v1(p_payment_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select
      lower(coalesce(p.financial_status, p.status, 'pending')) in ('paid','partial','refunded','courtesy')
      or greatest(coalesce(p.paid_amount,0)-coalesce(p.refunded_amount,0),0) > 0
      or exists (
        select 1 from public.payment_transactions tx
        where tx.payment_id::text=p.id::text and tx.status='POSTED'
      )
    from public.payments p
    where p.id::text=p_payment_id
  ), false);
$$;

create or replace function public.refresh_monthly_session_payment_v1(p_payment_id text)
returns public.payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
  v_total numeric(14,2) := 0;
  v_count integer := 0;
  v_first_appointment uuid;
begin
  select * into v_payment from public.payments where id::text=p_payment_id for update;
  if not found then raise exception 'MONTHLY_SESSION_PAYMENT_NOT_FOUND'; end if;
  if coalesce(v_payment.source,'') <> 'MONTHLY_SESSION_AGGREGATE' then
    raise exception 'MONTHLY_SESSION_PAYMENT_SOURCE_INVALID';
  end if;
  if public.monthly_session_payment_locked_v1(p_payment_id) then
    return v_payment;
  end if;

  select coalesce(sum(item.subtotal),0), count(*)::integer, min(item.appointment_id)
  into v_total, v_count, v_first_appointment
  from public.payment_appointment_items item
  where item.organization_id=v_payment.organization_id
    and item.payment_id::text=v_payment.id::text
    and item.billing_item_type='MONTHLY_SESSION'
    and item.active=true;

  update public.payments
  set original_amount=v_total,
      base_amount=v_total,
      amount=v_total,
      monthly_session_count=v_count,
      appointment_id=v_first_appointment,
      canceled_at=case when v_count=0 then coalesce(canceled_at,now()) else null end,
      canceled_by=case when v_count=0 then canceled_by else null end,
      status=case when v_count=0 then 'canceled' when due_date<current_date then 'overdue' else 'pending' end,
      financial_status=case when v_count=0 then 'canceled' when due_date<current_date then 'overdue' else 'pending' end,
      updated_at=now()
  where id::text=p_payment_id
  returning * into v_payment;

  perform public.refresh_patient_financial_charge(p_payment_id);
  select * into v_payment from public.payments where id::text=p_payment_id;
  return v_payment;
end;
$$;

create or replace function public.mark_monthly_session_adjustment_required_v1(
  p_payment_id text,
  p_appointment_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.payments%rowtype;
begin
  select * into v_payment from public.payments where id::text=p_payment_id for update;
  if not found then return; end if;
  update public.payments
  set monthly_adjustment_required=true,
      adjustment_reason=left(coalesce(nullif(trim(p_reason),''),'MONTHLY_SESSION_ADJUSTMENT_REQUIRED'),1000),
      updated_at=now()
  where id::text=p_payment_id;

  insert into public.payment_audit_events (
    organization_id, clinic_id, payment_id, appointment_id, event_type,
    before_state, after_state, notes, idempotency_key, created_by
  ) values (
    v_payment.organization_id, v_payment.clinic_id, v_payment.id::text, p_appointment_id,
    'MONTHLY_SESSION_ADJUSTMENT_REQUIRED', to_jsonb(v_payment),
    (select to_jsonb(p) from public.payments p where p.id::text=v_payment.id::text),
    left(coalesce(p_reason,'Ajuste manual necessário.'),1000),
    left(coalesce(p_idempotency_key,'monthly-session-adjustment:'||coalesce(p_appointment_id::text,'none')),240),
    null
  ) on conflict (organization_id,idempotency_key) where idempotency_key is not null do nothing;
end;
$$;

create or replace function public.resolve_appointment_financial_engine_v1(
  p_organization_id uuid,
  p_appointment_id uuid,
  p_patient_id uuid,
  p_service_type text,
  p_source jsonb default '{}'::jsonb
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_context_type text;
  v_payer_id uuid;
  v_source_payer text;
  v_service text:=nullif(trim(coalesce(p_service_type,'')),'');
  v_effective_at timestamptz;
  v_monthly_count integer:=0;
  v_has_explicit_context boolean:=false;
begin
  if p_organization_id is null or p_appointment_id is null or p_patient_id is null then return 'NONE'; end if;

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
        or upper(coalesce(plan.service_type,''))=upper(v_service)
        or lower(coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type,''))=lower(v_service)
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
      or upper(coalesce(plan.service_type,''))=upper(v_service)
      or lower(coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type,''))=lower(v_service)
    );

  if v_monthly_count=1 then return 'MONTHLY_SESSION'; end if;
  if v_monthly_count>1 then return 'AMBIGUOUS'; end if;
  if v_context_type='PRIVATE' then return 'AT_SESSION'; end if;
  return 'NONE';
end;
$$;

create or replace function public.appointment_uses_monthly_session_billing_v1(
  p_organization_id uuid,
  p_appointment_id uuid,
  p_patient_id uuid,
  p_service_type text,
  p_source jsonb default '{}'::jsonb
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.resolve_appointment_financial_engine_v1(
    p_organization_id,p_appointment_id,p_patient_id,p_service_type,p_source
  )='MONTHLY_SESSION';
$$;

create or replace function public.sync_monthly_session_billing_for_appointment_v1(
  p_organization_id uuid,
  p_appointment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  v_competence:=date_trunc('month',v_effective_at at time zone 'America/Sao_Paulo')::date;

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
        or upper(coalesce(plan.service_type,''))=upper(v_service)
        or lower(coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type,''))=lower(v_service)
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
        or upper(coalesce(plan.service_type,''))=upper(v_service)
        or lower(coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type,''))=lower(v_service)
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
        or upper(coalesce(plan.service_type,''))=upper(v_service)
        or lower(coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type,''))=lower(v_service)
      )
    order by plan.version desc,plan.valid_from desc
    limit 1;
    v_context_type:=v_plan.billing_mode;
    v_context_payer_id:=v_plan.payer_id;
    v_context_payer_name:=v_plan.payer_name_snapshot;
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
  v_unit_amount:=round(v_plan.amount_cents::numeric/100,2);
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
$$;

create or replace function public.sync_monthly_session_appointment_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.sync_monthly_session_billing_for_appointment_v1(coalesce(new.organization_id,new.clinic_id),new.id);
  return new;
end;
$$;

create or replace function public.sync_monthly_session_context_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.payment_appointment_items%rowtype;
  v_event_key text;
  v_organization_id uuid;
  v_appointment_id uuid;
  v_patient_id uuid;
  v_source_context_id uuid;
  v_old_explicit boolean:=false;
  v_new_explicit boolean:=false;
  v_is_removal boolean:=false;
begin
  if tg_op='DELETE' then
    v_organization_id:=old.organization_id;
    v_appointment_id:=old.appointment_id;
    v_patient_id:=old.patient_id;
    v_source_context_id:=old.id;
    v_is_removal:=true;
  else
    v_organization_id:=new.organization_id;
    v_appointment_id:=new.appointment_id;
    v_patient_id:=new.patient_id;
    v_source_context_id:=new.id;
    v_new_explicit:=(nullif(trim(coalesce(new.payer_type,'')),'') is not null or new.payer_id is not null);
    if tg_op='UPDATE' then
      v_old_explicit:=(nullif(trim(coalesce(old.payer_type,'')),'') is not null or old.payer_id is not null);
      v_is_removal:=v_old_explicit and not v_new_explicit;
    end if;
  end if;

  if not v_is_removal then
    -- Any new explicit context supersedes the prior removal marker. This makes
    -- reactivation deliberate rather than a fallback side effect.
    if v_new_explicit then
      delete from public.appointment_billing_context_tombstones tombstone
      where tombstone.organization_id=v_organization_id
        and tombstone.appointment_id=v_appointment_id;
    end if;
    perform public.sync_monthly_session_billing_for_appointment_v1(v_organization_id,v_appointment_id);
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  -- Persist removal BEFORE looking for an existing billing item. The tombstone must
  -- survive even when the context is removed while the appointment is only scheduled.
  insert into public.appointment_billing_context_tombstones (
    organization_id,appointment_id,patient_id,reason,source_context_id,removed_at,updated_at
  ) values (
    v_organization_id,v_appointment_id,v_patient_id,'BILLING_CONTEXT_REMOVED',v_source_context_id,now(),now()
  )
  on conflict (organization_id,appointment_id) do update set
    patient_id=excluded.patient_id,
    reason='BILLING_CONTEXT_REMOVED',
    source_context_id=excluded.source_context_id,
    removed_at=excluded.removed_at,
    updated_at=excluded.updated_at;

  perform pg_advisory_xact_lock(hashtextextended(v_organization_id::text||':monthly-session:'||v_appointment_id::text,0));
  select item.* into v_item
  from public.payment_appointment_items item
  where item.organization_id=v_organization_id
    and item.appointment_id=v_appointment_id
    and item.billing_item_type='MONTHLY_SESSION'
    and item.active=true
  order by item.created_at desc
  limit 1
  for update;

  -- Removal before COMPLETED has no item yet; the durable tombstone above is the
  -- entire financial action and prevents both MONTHLY_SESSION and AT_SESSION fallback.
  if v_item.id is null then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  v_event_key:='monthly-session:'||v_appointment_id::text||':billing-context-removed:'||clock_timestamp()::text;
  if public.monthly_session_payment_locked_v1(v_item.payment_id::text) then
    perform public.mark_monthly_session_adjustment_required_v1(
      v_item.payment_id::text,v_appointment_id,
      'Contexto financeiro da sessão foi removido após movimentação financeira; recebível original preservado.',
      v_event_key
    );
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  update public.payment_appointment_items
  set active=false,deactivated_at=now(),deactivation_reason='BILLING_CONTEXT_REMOVED',updated_at=now()
  where id=v_item.id;
  perform public.refresh_monthly_session_payment_v1(v_item.payment_id::text);
  insert into public.payment_audit_events (
    organization_id,clinic_id,payment_id,appointment_id,event_type,before_state,after_state,notes,idempotency_key,created_by
  ) values (
    v_organization_id,v_organization_id::text,v_item.payment_id::text,v_appointment_id,
    'MONTHLY_SESSION_REMOVED','{}'::jsonb,
    (select to_jsonb(p) from public.payments p where p.id::text=v_item.payment_id::text),
    'Contexto financeiro removido; sessão retirada da competência aberta.',
    v_event_key,null
  ) on conflict (organization_id,idempotency_key) where idempotency_key is not null do nothing;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.prevent_manual_charge_for_monthly_session_appointment_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_engine text;
begin
  if new.appointment_id is null
     or coalesce(new.active,true)=false
     or coalesce(new.billing_item_type,'')='MONTHLY_SESSION' then
    return new;
  end if;

  select * into v_appointment
  from public.appointments a
  where a.id=new.appointment_id
    and coalesce(a.organization_id,a.clinic_id)=new.organization_id;
  if not found then return new; end if;

  v_engine:=public.resolve_appointment_financial_engine_v1(
    new.organization_id,
    v_appointment.id,
    v_appointment.patient_id,
    coalesce(v_appointment.service_type,v_appointment.approach),
    coalesce(to_jsonb(v_appointment)->'source_payload','{}'::jsonb)
  );
  if v_engine='MONTHLY_SESSION' then
    raise exception 'MONTHLY_SESSION_MANUAL_APPOINTMENT_CHARGE_FORBIDDEN';
  end if;
  if v_engine='AMBIGUOUS' then
    raise exception 'MONTHLY_SESSION_FINANCIAL_ENGINE_AMBIGUOUS';
  end if;
  return new;
end;
$$;

-- Keep PRIVATE/AT_SESSION behavior byte-equivalent in its function and gate only the trigger.
drop trigger if exists appointments_sync_private_finance on public.appointments;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='appointments' and column_name='source_payload'
  ) then
    execute $trigger$
      create trigger appointments_sync_private_finance
      after insert or update of status, scheduled_at, scheduled_start_at, scheduled_end_at,
        service_type, approach, care_setting, location_type, source_payload,
        financial_event_actor_id, financial_event_reason,
        financial_policy_decision_amount, financial_policy_decision_event
      on public.appointments
      for each row
      when (public.resolve_appointment_financial_engine_v1(
        coalesce(new.organization_id,new.clinic_id),new.id,new.patient_id,
        coalesce(new.service_type,new.approach),coalesce(to_jsonb(new)->'source_payload','{}'::jsonb)
      ) = 'AT_SESSION')
      execute function public.sync_private_appointment_finance()
    $trigger$;
  else
    execute $trigger$
      create trigger appointments_sync_private_finance
      after insert or update of status, scheduled_at, scheduled_start_at, scheduled_end_at,
        service_type, approach, care_setting, location_type,
        financial_event_actor_id, financial_event_reason,
        financial_policy_decision_amount, financial_policy_decision_event
      on public.appointments
      for each row
      when (public.resolve_appointment_financial_engine_v1(
        coalesce(new.organization_id,new.clinic_id),new.id,new.patient_id,
        coalesce(new.service_type,new.approach),'{}'::jsonb
      ) = 'AT_SESSION')
      execute function public.sync_private_appointment_finance()
    $trigger$;
  end if;
end
$$;

drop trigger if exists appointments_sync_monthly_session_finance on public.appointments;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='appointments' and column_name='actual_end_at'
  ) then
    execute $trigger$
      create trigger appointments_sync_monthly_session_finance
      after insert or update of status, scheduled_at, scheduled_start_at, actual_end_at, service_type, approach,
        financial_event_actor_id
      on public.appointments
      for each row execute function public.sync_monthly_session_appointment_trigger_v1()
    $trigger$;
  else
    execute $trigger$
      create trigger appointments_sync_monthly_session_finance
      after insert or update of status, scheduled_at, scheduled_start_at, service_type, approach,
        financial_event_actor_id
      on public.appointments
      for each row execute function public.sync_monthly_session_appointment_trigger_v1()
    $trigger$;
  end if;
end
$$;

drop trigger if exists appointment_billing_context_sync_monthly_session_finance on public.appointment_billing_contexts;
create trigger appointment_billing_context_sync_monthly_session_finance
after insert or update of payer_type,payer_id,payer_name_snapshot,service_type
on public.appointment_billing_contexts
for each row execute function public.sync_monthly_session_context_trigger_v1();

drop trigger if exists appointment_billing_context_remove_monthly_session_finance on public.appointment_billing_contexts;
create trigger appointment_billing_context_remove_monthly_session_finance
after delete
on public.appointment_billing_contexts
for each row execute function public.sync_monthly_session_context_trigger_v1();

drop trigger if exists payment_items_prevent_monthly_session_manual_charge on public.payment_appointment_items;
create trigger payment_items_prevent_monthly_session_manual_charge
before insert or update of appointment_id,active,billing_item_type
on public.payment_appointment_items
for each row execute function public.prevent_manual_charge_for_monthly_session_appointment_v1();

revoke all on function public.monthly_session_due_date_v1(date,integer) from public, anon, authenticated;
revoke all on function public.monthly_session_payment_locked_v1(text) from public, anon, authenticated;
revoke all on function public.refresh_monthly_session_payment_v1(text) from public, anon, authenticated;
revoke all on function public.mark_monthly_session_adjustment_required_v1(text,uuid,text,text) from public, anon, authenticated;
revoke all on function public.resolve_appointment_financial_engine_v1(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.appointment_uses_monthly_session_billing_v1(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.sync_monthly_session_billing_for_appointment_v1(uuid,uuid) from public, anon, authenticated;
revoke all on function public.sync_monthly_session_appointment_trigger_v1() from public, anon, authenticated;
revoke all on function public.sync_monthly_session_context_trigger_v1() from public, anon, authenticated;
revoke all on function public.prevent_manual_charge_for_monthly_session_appointment_v1() from public, anon, authenticated;

grant execute on function public.monthly_session_due_date_v1(date,integer) to service_role;
grant execute on function public.monthly_session_payment_locked_v1(text) to service_role;
grant execute on function public.refresh_monthly_session_payment_v1(text) to service_role;
grant execute on function public.mark_monthly_session_adjustment_required_v1(text,uuid,text,text) to service_role;
grant execute on function public.resolve_appointment_financial_engine_v1(uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.appointment_uses_monthly_session_billing_v1(uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.sync_monthly_session_billing_for_appointment_v1(uuid,uuid) to service_role;
grant execute on function public.sync_monthly_session_appointment_trigger_v1() to service_role;
grant execute on function public.sync_monthly_session_context_trigger_v1() to service_role;
grant execute on function public.prevent_manual_charge_for_monthly_session_appointment_v1() to service_role;

select pg_notify('pgrst','reload schema');

commit;
