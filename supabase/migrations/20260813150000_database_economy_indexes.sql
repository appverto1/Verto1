-- Additive contracts and read-path indexes for the current canonical queries.
-- Idempotent and intentionally without backfill or rewrites of business rows.

begin;

do $$
begin
  if to_regclass('public.appointments') is not null
     and exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'appointments' and column_name = 'id'
     )
     and exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'appointments' and column_name = 'scheduled_start_at'
     )
     and exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'appointments' and column_name = 'scheduled_at'
     )
     and exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'appointments' and column_name = 'no_show_classified_at'
     )
     and exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'appointments' and column_name = 'deleted_at'
     )
     and exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'appointments' and column_name = 'is_active'
     )
     and exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'appointments' and column_name = 'actual_start_at'
     )
     and exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'appointments' and column_name = 'no_show_review_required_at'
     )
     and exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'appointments' and column_name = 'active_aba_session_id'
     )
     and exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'appointments' and column_name = 'status'
     )
  then
    execute $index$
      create index if not exists appointments_auto_no_show_due_idx
        on public.appointments ((coalesce(scheduled_start_at, scheduled_at)), id)
        where deleted_at is null
          and coalesce(is_active, true) = true
          and actual_start_at is null
          and no_show_classified_at is null
          and no_show_review_required_at is null
          and active_aba_session_id is null
          and lower(coalesce(status, 'scheduled')) in (
            'scheduled', 'pending', 'pending_confirmation', 'confirmed', 'rescheduled', 'reschedule'
          )
    $index$;
  end if;
end
$$;

do $$
begin
  if to_regclass('public.payments') is not null then
    alter table public.payments
      add column if not exists series_request_hash text;
  end if;

  if to_regclass('public.professional_payments') is not null then
    alter table public.professional_payments
      add column if not exists base_amount numeric(14,2),
      add column if not exists additional_amount numeric(14,2) not null default 0,
      add column if not exists additional_scope text,
      add column if not exists adjustment_reason text,
      add column if not exists is_recurring boolean not null default false,
      add column if not exists recurrence_group_id text,
      add column if not exists recurrence_index integer,
      add column if not exists recurrence_total integer,
      add column if not exists recurrence_frequency text,
      add column if not exists idempotency_key text,
      add column if not exists series_request_hash text;

    create index if not exists professional_payments_recurrence_group_idx
      on public.professional_payments (clinic_id, recurrence_group_id, recurrence_index)
      where recurrence_group_id is not null;
    create unique index if not exists professional_payments_idempotency_uidx
      on public.professional_payments (clinic_id, idempotency_key)
      where idempotency_key is not null;
  end if;
end
$$;

create table if not exists public.financial_series_mutation_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id text not null,
  mutation_scope text not null check (mutation_scope in ('payments', 'professional_payments')),
  idempotency_key_hash text not null,
  request_hash text not null,
  row_ids text[] not null,
  result_updated_at timestamptz not null,
  created_by text,
  created_at timestamptz not null default now(),
  unique (clinic_id, mutation_scope, idempotency_key_hash)
);

create index if not exists financial_series_mutation_requests_created_at_idx
  on public.financial_series_mutation_requests (created_at);

alter table public.financial_series_mutation_requests enable row level security;
revoke all on public.financial_series_mutation_requests from public, anon, authenticated;

create or replace function public.cleanup_financial_series_mutation_requests_v1(
  p_retention_days integer default 180
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted bigint := 0;
  v_retention_days integer := greatest(30, least(coalesce(p_retention_days, 180), 3650));
begin
  delete from public.financial_series_mutation_requests
   where created_at < clock_timestamp() - make_interval(days => v_retention_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_financial_series_mutation_requests_v1(integer)
  from public, anon, authenticated;
grant execute on function public.cleanup_financial_series_mutation_requests_v1(integer)
  to service_role;

create or replace function public.apply_financial_series_update_v1(
  p_clinic_id text,
  p_mutation_scope text,
  p_row_ids text[],
  p_patch jsonb,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_actor_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_hash text;
  v_existing_rows text[];
  v_existing_updated_at timestamptz;
  v_updated_at timestamptz := clock_timestamp();
  v_updated_count integer := 0;
  v_expected_count integer := cardinality(p_row_ids);
  v_data jsonb;
begin
  if coalesce(btrim(p_clinic_id), '') = ''
     or p_mutation_scope not in ('payments', 'professional_payments')
     or v_expected_count is null
     or v_expected_count < 2
     or coalesce(btrim(p_idempotency_key_hash), '') = ''
     or coalesce(btrim(p_request_hash), '') = ''
  then
    raise exception using errcode = 'P0001', message = 'FINANCIAL_SERIES_UPDATE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_clinic_id || ':' || p_mutation_scope || ':' || p_idempotency_key_hash,
    0
  ));

  select request_hash, row_ids, result_updated_at
    into v_existing_hash, v_existing_rows, v_existing_updated_at
    from public.financial_series_mutation_requests
   where clinic_id = p_clinic_id
     and mutation_scope = p_mutation_scope
     and idempotency_key_hash = p_idempotency_key_hash;

  if found then
    if v_existing_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'FINANCIAL_SERIES_UPDATE_IDEMPOTENCY_CONFLICT';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', row_id, 'updated_at', v_existing_updated_at)), '[]'::jsonb)
      into v_data
      from unnest(v_existing_rows) as rows(row_id);
    return jsonb_build_object(
      'success', true,
      'idempotent', true,
      'code', 'FINANCIAL_SERIES_UPDATE_ALREADY_PERSISTED',
      'data', v_data
    );
  end if;

  if p_mutation_scope = 'payments' then
    update public.payments as target
       set amount = case when p_patch ? 'amount' then (p_patch ->> 'amount')::numeric else target.amount end,
           payment_date = case when p_patch ? 'payment_date' then (p_patch ->> 'payment_date')::date else target.payment_date end,
           due_date = case when p_patch ? 'due_date' then (p_patch ->> 'due_date')::date else target.due_date end,
           method = case when p_patch ? 'method' then p_patch ->> 'method' else target.method end,
           status = case when p_patch ? 'status' then p_patch ->> 'status' else target.status end,
           receipt_url = case when p_patch ? 'receipt_url' then p_patch ->> 'receipt_url' else target.receipt_url end,
           receipt_file_name = case when p_patch ? 'receipt_file_name' then p_patch ->> 'receipt_file_name' else target.receipt_file_name end,
           receipt_content_type = case when p_patch ? 'receipt_content_type' then p_patch ->> 'receipt_content_type' else target.receipt_content_type end,
           type = case when p_patch ? 'type' then p_patch ->> 'type' else target.type end,
           insurance_name = case when p_patch ? 'insurance_name' then p_patch ->> 'insurance_name' else target.insurance_name end,
           specialty = case when p_patch ? 'specialty' then p_patch ->> 'specialty' else target.specialty end,
           base_amount = case when p_patch ? 'base_amount' then (p_patch ->> 'base_amount')::numeric else target.base_amount end,
           additional_amount = case when p_patch ? 'additional_amount' then (p_patch ->> 'additional_amount')::numeric else target.additional_amount end,
           additional_scope = case when p_patch ? 'additional_scope' then p_patch ->> 'additional_scope' else target.additional_scope end,
           adjustment_reason = case when p_patch ? 'adjustment_reason' then p_patch ->> 'adjustment_reason' else target.adjustment_reason end,
           notes = case when p_patch ? 'notes' then p_patch ->> 'notes' else target.notes end,
           updated_at = v_updated_at
     where target.clinic_id = p_clinic_id
       and target.id::text = any(p_row_ids);
  else
    update public.professional_payments as target
       set professional_id = case when p_patch ? 'professional_id' then p_patch ->> 'professional_id' else target.professional_id end,
           professional_name = case when p_patch ? 'professional_name' then p_patch ->> 'professional_name' else target.professional_name end,
           specialty = case when p_patch ? 'specialty' then p_patch ->> 'specialty' else target.specialty end,
           amount = case when p_patch ? 'amount' then (p_patch ->> 'amount')::numeric else target.amount end,
           payment_date = case when p_patch ? 'payment_date' then (p_patch ->> 'payment_date')::date else target.payment_date end,
           due_date = case when p_patch ? 'due_date' then (p_patch ->> 'due_date')::date else target.due_date end,
           method = case when p_patch ? 'method' then p_patch ->> 'method' else target.method end,
           status = case when p_patch ? 'status' then p_patch ->> 'status' else target.status end,
           base_amount = case when p_patch ? 'base_amount' then (p_patch ->> 'base_amount')::numeric else target.base_amount end,
           additional_amount = case when p_patch ? 'additional_amount' then (p_patch ->> 'additional_amount')::numeric else target.additional_amount end,
           additional_scope = case when p_patch ? 'additional_scope' then p_patch ->> 'additional_scope' else target.additional_scope end,
           adjustment_reason = case when p_patch ? 'adjustment_reason' then p_patch ->> 'adjustment_reason' else target.adjustment_reason end,
           notes = case when p_patch ? 'notes' then p_patch ->> 'notes' else target.notes end,
           updated_at = v_updated_at
     where target.clinic_id = p_clinic_id
       and target.id::text = any(p_row_ids);
  end if;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> v_expected_count then
    raise exception using errcode = 'P0001', message = 'FINANCIAL_SERIES_UPDATE_SCOPE_MISMATCH';
  end if;

  insert into public.financial_series_mutation_requests (
    clinic_id,
    mutation_scope,
    idempotency_key_hash,
    request_hash,
    row_ids,
    result_updated_at,
    created_by
  ) values (
    p_clinic_id,
    p_mutation_scope,
    p_idempotency_key_hash,
    p_request_hash,
    p_row_ids,
    v_updated_at,
    p_actor_id
  );

  select coalesce(jsonb_agg(jsonb_build_object('id', row_id, 'updated_at', v_updated_at)), '[]'::jsonb)
    into v_data
    from unnest(p_row_ids) as rows(row_id);
  return jsonb_build_object('success', true, 'idempotent', false, 'data', v_data);
end;
$$;

revoke all on function public.apply_financial_series_update_v1(text, text, text[], jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_financial_series_update_v1(text, text, text[], jsonb, text, text, text) to service_role;

create or replace function public.get_patient_financial_plans_batch_v1(
  p_organization_id uuid,
  p_patient_ids uuid[],
  p_per_patient_limit integer default 20
)
returns table (
  patient_id uuid,
  service_type text,
  custom_service_name text,
  service_name_snapshot text,
  billing_mode text,
  payer_id uuid,
  payer_name_snapshot text,
  insurance_plan_name text,
  authorization_code text,
  status text,
  notes text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ranked as (
    select
      plan.patient_id,
      plan.service_type,
      plan.custom_service_name,
      plan.service_name_snapshot,
      plan.billing_mode,
      plan.payer_id,
      plan.payer_name_snapshot,
      plan.insurance_plan_name,
      plan.authorization_code,
      plan.status,
      plan.notes,
      row_number() over (
        partition by plan.patient_id
        order by plan.updated_at desc nulls last, plan.id desc
      ) as row_number_for_patient
    from public.patient_financial_plans as plan
    where plan.organization_id = p_organization_id
      and plan.patient_id = any(p_patient_ids)
      and plan.status = 'ACTIVE'
      and plan.billing_mode = 'INSURANCE'
  )
  select
    ranked.patient_id,
    ranked.service_type,
    ranked.custom_service_name,
    ranked.service_name_snapshot,
    ranked.billing_mode,
    ranked.payer_id,
    ranked.payer_name_snapshot,
    ranked.insurance_plan_name,
    ranked.authorization_code,
    ranked.status,
    ranked.notes
  from ranked
  where ranked.row_number_for_patient <= greatest(1, least(coalesce(p_per_patient_limit, 20), 50));
$$;

revoke all on function public.get_patient_financial_plans_batch_v1(uuid, uuid[], integer) from public, anon, authenticated;
grant execute on function public.get_patient_financial_plans_batch_v1(uuid, uuid[], integer) to service_role;

-- Read the three patient-ledger child collections in one tenant-scoped call.
-- The ordering and limit apply to each complete collection, rather than to
-- arbitrary URL-sized chunks of payment ids.
create index if not exists payment_appointment_items_ledger_read_idx
  on public.payment_appointment_items (
    organization_id,
    appointment_scheduled_at desc nulls last,
    created_at desc,
    id desc,
    payment_id
  );

create index if not exists payment_transactions_ledger_read_idx
  on public.payment_transactions (
    organization_id,
    transaction_at desc,
    created_at desc,
    id desc,
    payment_id
  );

create index if not exists payment_audit_events_ledger_read_idx
  on public.payment_audit_events (
    organization_id,
    created_at desc,
    id desc,
    payment_id
  );

create or replace function public.get_patient_finance_ledger_children_v1(
  p_organization_id uuid,
  p_payment_ids text[],
  p_limit integer default 1000
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(
        to_jsonb(item_row)
        order by
          item_row.appointment_scheduled_at desc nulls last,
          item_row.created_at desc,
          item_row.id desc
      )
      from (
        select
          item.id,
          item.organization_id,
          item.clinic_id,
          item.payment_id,
          item.appointment_id,
          item.patient_id,
          item.professional_id,
          item.patient_name_snapshot,
          item.professional_name_snapshot,
          item.service_type_snapshot,
          item.specialty_snapshot,
          item.appointment_scheduled_at,
          item.quantity,
          item.unit_amount,
          item.subtotal,
          item.active,
          item.created_at
        from public.payment_appointment_items as item
        where item.organization_id = p_organization_id
          and item.payment_id = any(coalesce(p_payment_ids, array[]::text[]))
        order by
          item.appointment_scheduled_at desc nulls last,
          item.created_at desc,
          item.id desc
        limit greatest(1, least(coalesce(p_limit, 1000), 1000))
      ) as item_row
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(
        to_jsonb(transaction_row)
        order by
          transaction_row.transaction_at desc nulls last,
          transaction_row.created_at desc,
          transaction_row.id desc
      )
      from (
        select
          tx.id,
          tx.organization_id,
          tx.clinic_id,
          tx.payment_id,
          tx.patient_id,
          tx.transaction_type,
          tx.amount,
          tx.method,
          tx.transaction_at,
          tx.status,
          (nullif(btrim(tx.proof_url), '') is not null) as has_proof,
          tx.proof_file_name,
          tx.proof_content_type,
          (nullif(btrim(tx.receipt_url), '') is not null) as has_receipt,
          tx.receipt_number,
          tx.document_status,
          tx.notes,
          tx.created_by,
          tx.created_at,
          tx.voided_at,
          tx.voided_by
        from public.payment_transactions as tx
        where tx.organization_id = p_organization_id
          and tx.payment_id = any(coalesce(p_payment_ids, array[]::text[]))
        order by
          tx.transaction_at desc nulls last,
          tx.created_at desc,
          tx.id desc
        limit greatest(1, least(coalesce(p_limit, 1000), 1000))
      ) as transaction_row
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(
        to_jsonb(event_row)
        order by event_row.created_at desc, event_row.id desc
      )
      from (
        select
          event.id,
          event.organization_id,
          event.clinic_id,
          event.payment_id,
          event.transaction_id,
          event.appointment_id,
          event.event_type,
          event.notes,
          event.created_by,
          event.created_at
        from public.payment_audit_events as event
        where event.organization_id = p_organization_id
          and event.payment_id = any(coalesce(p_payment_ids, array[]::text[]))
        order by event.created_at desc, event.id desc
        limit greatest(1, least(coalesce(p_limit, 1000), 1000))
      ) as event_row
    ), '[]'::jsonb)
  )
  where p_organization_id is not null
    and cardinality(coalesce(p_payment_ids, array[]::text[])) between 1 and 500;
$$;

revoke all on function public.get_patient_finance_ledger_children_v1(uuid, text[], integer)
  from public, anon, authenticated;
grant execute on function public.get_patient_finance_ledger_children_v1(uuid, text[], integer)
  to service_role;

-- A single, cacheable capability catalog replaces the historical pattern of
-- issuing one deliberately invalid tasks query for every absent optional
-- column. It exposes schema shape only and remains server-side/service-only.
create or replace function public.get_verto_route_schema_capabilities()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with expected_tasks(column_name) as (
    values
      ('patient_email'::text),
      ('title'),
      ('description'),
      ('type'),
      ('icon'),
      ('color'),
      ('completed'),
      ('is_daily_reminder'),
      ('linked_task'),
      ('scheduled_at'),
      ('therapist_id'),
      ('pro_score'),
      ('max_score'),
      ('created_at'),
      ('updated_at'),
      ('is_active'),
      ('deleted_at')
  ), task_columns as (
    select
      expected_tasks.column_name,
      exists (
        select 1
          from information_schema.columns as actual
         where actual.table_schema = 'public'
           and actual.table_name = 'tasks'
           and actual.column_name = expected_tasks.column_name
      ) as is_available
      from expected_tasks
  )
  select jsonb_build_object(
    'schemaVersion', 1,
    'tasks', jsonb_build_object(
      'available', to_regclass('public.tasks') is not null,
      'columns', coalesce(
        (select jsonb_object_agg(column_name, is_available order by column_name) from task_columns),
        '{}'::jsonb
      )
    ),
    'patients', jsonb_build_object(
      'available', to_regclass('public.patients') is not null,
      'columns', coalesce((
        select jsonb_object_agg(actual.column_name, true order by actual.column_name)
          from information_schema.columns as actual
         where actual.table_schema = 'public'
           and actual.table_name = 'patients'
      ), '{}'::jsonb)
    )
  );
$$;

revoke all on function public.get_verto_route_schema_capabilities()
  from public, anon, authenticated;
grant execute on function public.get_verto_route_schema_capabilities()
  to service_role;

-- Preserve legacy-only appointments during the canonical transition without
-- transferring every historical clinic_state.appointments JSON blob to Railway.
create or replace function public.get_legacy_due_appointments_v1(
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_limit integer default 500,
  p_after_clinic_id text default null,
  p_after_ordinality bigint default null
)
returns table (clinic_id text, appointment jsonb, appointment_ordinality bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  state_row record;
  appointment_record record;
  appointment_row jsonb;
  scheduled_value timestamptz;
  returned_count integer := 0;
  safe_limit integer := greatest(1, least(coalesce(p_limit, 1000), 2000));
begin
  if p_window_start is null or p_window_end is null or p_window_end <= p_window_start then
    return;
  end if;

  for state_row in
    select state.clinic_id::text as clinic_id, state.appointments
      from public.clinic_state as state
     where jsonb_typeof(state.appointments) = 'array'
       and (
         p_after_clinic_id is null
         or state.clinic_id::text >= p_after_clinic_id
       )
     order by state.clinic_id::text
  loop
    for appointment_record in
      select value, ordinality
        from jsonb_array_elements(state_row.appointments) with ordinality
       order by ordinality
    loop
      if p_after_clinic_id is not null and state_row.clinic_id = p_after_clinic_id
         and appointment_record.ordinality <= coalesce(p_after_ordinality, 0)
      then
        continue;
      end if;
      appointment_row := appointment_record.value;
      scheduled_value := null;
      if nullif(trim(appointment_row->>'scheduled_at'), '') is not null then
        begin
          scheduled_value := (appointment_row->>'scheduled_at')::timestamptz;
        exception when others then
          scheduled_value := null;
        end;
      end if;
      if scheduled_value is null and nullif(trim(appointment_row->>'scheduledAt'), '') is not null then
        begin
          scheduled_value := (appointment_row->>'scheduledAt')::timestamptz;
        exception when others then
          scheduled_value := null;
        end;
      end if;
      if scheduled_value is null
         and nullif(trim(appointment_row->>'date'), '') is not null
         and nullif(trim(appointment_row->>'time'), '') is not null
      then
        begin
          scheduled_value := ((appointment_row->>'date') || ' ' || (appointment_row->>'time'))::timestamp
            at time zone 'America/Sao_Paulo';
        exception when others then
          scheduled_value := null;
        end;
      end if;
      if scheduled_value is null then continue; end if;

      if scheduled_value >= p_window_start and scheduled_value < p_window_end then
        clinic_id := state_row.clinic_id;
        appointment := appointment_row;
        appointment_ordinality := appointment_record.ordinality;
        return next;
        returned_count := returned_count + 1;
        if returned_count >= safe_limit then return; end if;
      end if;
    end loop;
  end loop;
end;
$$;

revoke all on function public.get_legacy_due_appointments_v1(timestamptz, timestamptz, integer, text, bigint)
  from public, anon, authenticated;
grant execute on function public.get_legacy_due_appointments_v1(timestamptz, timestamptz, integer, text, bigint)
  to service_role;

do $$
begin
  if to_regclass('public.users') is not null
     and exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'users' and column_name = 'email'
     )
  then
    create index if not exists users_email_lookup_idx
      on public.users (email)
      where email is not null;
  end if;

  if to_regclass('public.school_consents') is not null then
    create index if not exists school_consents_current_status_expiry_idx
      on public.school_consents (organization_id, status, expires_at, patient_id)
      where is_current = true;
  end if;

  if to_regclass('public.school_meeting_participants') is not null then
    create index if not exists school_meeting_participants_professional_active_idx
      on public.school_meeting_participants (organization_id, professional_id, meeting_id)
      where removed_at is null and professional_id is not null;
  end if;

  if to_regclass('public.school_meetings') is not null then
    create index if not exists school_meetings_clinic_schedule_idx
      on public.school_meetings (organization_id, clinic_id, scheduled_start desc);
    create index if not exists school_meetings_responsible_idx
      on public.school_meetings (organization_id, clinic_id, responsible_professional_id, scheduled_start desc)
      where responsible_professional_id is not null;
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
