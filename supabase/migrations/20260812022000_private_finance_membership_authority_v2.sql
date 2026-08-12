-- Verto private finance authority v2
-- Aligns backend-only financial RPCs/triggers with active clinic memberships.
-- Effective capability ALLOW/DENY remains enforced by the application server;
-- these functions remain service_role-only and provide a DB defense-in-depth ceiling.

begin;

create or replace function public.private_finance_actor_role_v2(
  p_actor_id uuid,
  p_organization_id uuid
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(trim(membership.role))
  from public.clinic_memberships membership
  where membership.user_id = p_actor_id
    and membership.clinic_id = p_organization_id
    and lower(trim(coalesce(membership.status, ''))) = 'active'
    and lower(trim(coalesce(membership.role, ''))) in ('director', 'coordinator', 'receptionist')
  order by membership.updated_at desc nulls last, membership.created_at desc nulls last
  limit 1
$$;

create or replace function public.resolve_private_session_price_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_specialty text,
  p_service_catalog_id uuid,
  p_scheduled_at timestamptz,
  p_care_setting text,
  p_manual_amount numeric,
  p_discount_amount numeric,
  p_zero_classification text,
  p_override_reason text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
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

  v_session_date := (p_scheduled_at at time zone 'America/Sao_Paulo')::date;

  select agreement.* into v_agreement
  from public.patient_private_pricing_agreements agreement
  where agreement.organization_id = p_organization_id
    and agreement.patient_id = p_patient_id
    and agreement.active = true
    and agreement.valid_from <= v_session_date
    and (agreement.valid_until is null or agreement.valid_until >= v_session_date)
    and (
      (p_service_catalog_id is not null and agreement.service_catalog_id = p_service_catalog_id)
      or (
        agreement.service_catalog_id is null
        and agreement.specialty_key is not null
        and lower(agreement.specialty_key) = v_specialty_key
      )
      or (agreement.service_catalog_id is null and agreement.specialty_key is null)
    )
  order by
    case
      when p_service_catalog_id is not null and agreement.service_catalog_id = p_service_catalog_id then 1
      when agreement.specialty_key is not null and lower(agreement.specialty_key) = v_specialty_key then 2
      else 3
    end,
    agreement.valid_from desc,
    agreement.version desc,
    agreement.created_at desc
  limit 1;

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

  if v_agreement.id is null then
    select plan.* into v_legacy_plan
    from public.patient_financial_plans plan
    where plan.organization_id = p_organization_id
      and plan.patient_id = p_patient_id
      and plan.status = 'ACTIVE'
      and plan.billing_mode = 'PRIVATE'
      and coalesce(plan.quantity_period, 'SESSION') = 'SESSION'
      and plan.amount_cents > 0
      and (
        lower(coalesce(nullif(plan.service_name_snapshot, ''), nullif(plan.custom_service_name, ''), plan.service_type)) = v_specialty_key
        or not exists (
          select 1
          from public.patient_financial_plans other_plan
          where other_plan.organization_id = p_organization_id
            and other_plan.patient_id = p_patient_id
            and other_plan.status = 'ACTIVE'
            and other_plan.billing_mode = 'PRIVATE'
            and coalesce(other_plan.quantity_period, 'SESSION') = 'SESSION'
            and other_plan.amount_cents > 0
            and other_plan.id <> plan.id
        )
      )
      and (plan.package_valid_until is null or plan.package_valid_until >= v_session_date)
    order by
      case
        when lower(coalesce(nullif(plan.service_name_snapshot, ''), nullif(plan.custom_service_name, ''), plan.service_type)) = v_specialty_key then 1
        else 2
      end,
      plan.updated_at desc,
      plan.created_at desc
    limit 1;
  end if;

  if v_agreement.id is not null then
    v_base := v_agreement.base_amount;
    v_discount := coalesce(v_agreement.discount_amount, 0);
    v_price_source := 'PATIENT_AGREEMENT';
    v_price_source_label := 'acordo específico do paciente';
    v_payer_id := v_agreement.payer_id;
    v_payer_name := nullif(trim(v_agreement.payer_name_snapshot), '');
    if v_agreement.base_amount = 0 then
      v_classification := coalesce(v_agreement.zero_classification, 'CONTRACTUAL_FREE');
      v_override_reason := coalesce(v_override_reason, nullif(trim(v_agreement.reason), ''));
    end if;
  elsif v_legacy_plan.id is not null then
    v_base := round(v_legacy_plan.amount_cents::numeric / 100, 2);
    v_price_source := 'LEGACY_PATIENT_PLAN';
    v_price_source_label := 'plano particular vigente do paciente';
    v_payer_id := v_legacy_plan.payer_id;
    v_payer_name := nullif(trim(v_legacy_plan.payer_name_snapshot), '');
  elsif v_rule.id is not null then
    v_base := v_rule.base_amount;
    v_price_source := case v_rule.scope_type
      when 'SERVICE' then 'SERVICE_RULE'
      when 'SPECIALTY' then 'SPECIALTY_RULE'
      else 'CLINIC_DEFAULT'
    end;
    v_price_source_label := case v_rule.scope_type
      when 'SERVICE' then 'preço do serviço ' || coalesce(v_rule.service_name_snapshot, v_service.name, 'selecionado')
      when 'SPECIALTY' then 'preço padrão da especialidade ' || coalesce(v_rule.specialty_name, v_specialty, '')
      else 'preço particular padrão da clínica'
    end;
  elsif (
    coalesce(p_manual_amount, 0) > 0
    or nullif(trim(coalesce(p_zero_classification, '')), '') is not null
  ) and coalesce(v_actor_role, '') in ('director', 'coordinator', 'receptionist') then
    v_base := greatest(coalesce(p_manual_amount, 0), 0);
    v_price_source := 'MANUAL_OVERRIDE';
    v_price_source_label := case
      when coalesce(p_manual_amount, 0) > 0 then 'valor manual autorizado sem regra cadastrada'
      else 'valor zero autorizado sem regra cadastrada'
    end;
    v_missing_price_explicit := true;
  else
    raise exception 'PRIVATE_SESSION_PRICE_REQUIRED';
  end if;

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
    'timezone', 'America/Sao_Paulo'
  );
end;
$$;

create or replace function public.save_private_session_price_rule_v1(
  p_organization_id uuid,
  p_payload jsonb,
  p_idempotency_key text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor_role text;
  v_existing public.private_session_price_rules%rowtype;
  v_replaced public.private_session_price_rules%rowtype;
  v_created public.private_session_price_rules%rowtype;
  v_service public.tuss_service_catalog%rowtype;
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_hash text := encode(extensions.digest(convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
  v_scope text := upper(coalesce(nullif(trim(p_payload->>'scopeType'), ''), nullif(trim(p_payload->>'scope_type'), '')));
  v_specialty_key text := lower(nullif(trim(coalesce(p_payload->>'specialtyKey', p_payload->>'specialty_key', '')), ''));
  v_service_id uuid := nullif(coalesce(p_payload->>'serviceCatalogId', p_payload->>'service_catalog_id'), '')::uuid;
  v_replaces_id uuid := nullif(coalesce(p_payload->>'replacesRuleId', p_payload->>'replaces_rule_id'), '')::uuid;
  v_valid_from date := coalesce(nullif(coalesce(p_payload->>'validFrom', p_payload->>'valid_from'), '')::date, current_date);
  v_version integer := 1;
begin
  if p_organization_id is null or p_actor_id is null or v_key is null then
    raise exception 'PRIVATE_PRICE_RULE_SCOPE_IDEMPOTENCY_REQUIRED';
  end if;
  v_actor_role := public.private_finance_actor_role_v2(p_actor_id, p_organization_id);
  if coalesce(v_actor_role, '') not in ('director', 'coordinator', 'receptionist') then
    raise exception 'PRIVATE_PRICE_RULE_WRITE_FORBIDDEN';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':private-price-rule:' || v_key, 0
  ));
  select * into v_existing
  from public.private_session_price_rules
  where organization_id = p_organization_id
    and idempotency_key = v_key
  limit 1;
  if v_existing.id is not null then
    if v_existing.request_hash is distinct from v_hash then
      raise exception 'PRIVATE_PRICE_RULE_IDEMPOTENCY_CONFLICT';
    end if;
    return to_jsonb(v_existing);
  end if;

  if v_scope not in ('CLINIC_DEFAULT', 'SPECIALTY', 'SERVICE') then
    raise exception 'PRIVATE_PRICE_RULE_SCOPE_INVALID';
  end if;
  if v_scope = 'SPECIALTY' and v_specialty_key is null then
    raise exception 'PRIVATE_PRICE_RULE_SPECIALTY_REQUIRED';
  end if;
  if v_scope = 'SERVICE' then
    if v_service_id is null then
      raise exception 'PRIVATE_PRICE_RULE_SERVICE_REQUIRED';
    end if;
    select service.* into v_service
    from public.tuss_service_catalog service
    where service.id = v_service_id
      and service.organization_id = p_organization_id
    limit 1;
    if v_service.id is null then
      raise exception 'PRIVATE_PRICE_RULE_SERVICE_SCOPE_INVALID';
    end if;
  end if;

  if v_replaces_id is not null then
    select * into v_replaced
    from public.private_session_price_rules
    where id = v_replaces_id
      and organization_id = p_organization_id
    for update;
    if v_replaced.id is null then
      raise exception 'PRIVATE_PRICE_RULE_REPLACED_SCOPE_INVALID';
    end if;
    v_version := v_replaced.version + 1;
    update public.private_session_price_rules
    set
      active = false,
      updated_by = p_actor_id,
      updated_at = now()
    where id = v_replaced.id;
  end if;

  insert into public.private_session_price_rules (
    organization_id, scope_type, specialty_key, specialty_name, service_catalog_id,
    service_name_snapshot, base_amount, default_duration_minutes,
    cancellation_free_value, cancellation_free_unit,
    late_cancellation_type, late_cancellation_value,
    no_show_type, no_show_value, due_rule, due_offset_days, due_day,
    expected_payment_method, allow_partial_payment, allowed_payment_methods,
    allow_manual_override, discount_approval_required, home_surcharge, school_surcharge,
    active, valid_from, valid_until, version, replaces_rule_id,
    idempotency_key, request_hash, created_by, updated_by
  ) values (
    p_organization_id,
    v_scope,
    case when v_scope in ('SPECIALTY', 'SERVICE') then v_specialty_key end,
    case when v_scope in ('SPECIALTY', 'SERVICE') then nullif(trim(coalesce(p_payload->>'specialtyName', p_payload->>'specialty_name', v_service.specialty, '')), '') end,
    case when v_scope = 'SERVICE' then v_service_id end,
    case when v_scope = 'SERVICE' then coalesce(nullif(trim(coalesce(p_payload->>'serviceName', p_payload->>'service_name_snapshot', '')), ''), v_service.name) end,
    nullif(coalesce(p_payload->>'baseAmount', p_payload->>'base_amount'), '')::numeric,
    coalesce(nullif(coalesce(p_payload->>'defaultDurationMinutes', p_payload->>'default_duration_minutes'), '')::integer, v_service.default_duration_minutes, 50),
    coalesce(nullif(coalesce(p_payload->>'cancellationFreeValue', p_payload->>'cancellation_free_value'), '')::integer, 0),
    upper(coalesce(nullif(coalesce(p_payload->>'cancellationFreeUnit', p_payload->>'cancellation_free_unit'), ''), 'HOURS')),
    upper(coalesce(nullif(coalesce(p_payload->>'lateCancellationType', p_payload->>'late_cancellation_type'), ''), 'NO_CHARGE')),
    coalesce(nullif(coalesce(p_payload->>'lateCancellationValue', p_payload->>'late_cancellation_value'), '')::numeric, 0),
    upper(coalesce(nullif(coalesce(p_payload->>'noShowType', p_payload->>'no_show_type'), ''), 'NO_CHARGE')),
    coalesce(nullif(coalesce(p_payload->>'noShowValue', p_payload->>'no_show_value'), '')::numeric, 0),
    upper(coalesce(nullif(coalesce(p_payload->>'dueRule', p_payload->>'due_rule'), ''), 'SESSION_DATE')),
    coalesce(nullif(coalesce(p_payload->>'dueOffsetDays', p_payload->>'due_offset_days'), '')::integer, 0),
    nullif(coalesce(p_payload->>'dueDay', p_payload->>'due_day'), '')::integer,
    nullif(trim(coalesce(p_payload->>'expectedPaymentMethod', p_payload->>'expected_payment_method', '')), ''),
    coalesce(nullif(coalesce(p_payload->>'allowPartialPayment', p_payload->>'allow_partial_payment'), '')::boolean, true),
    case
      when jsonb_typeof(coalesce(p_payload->'allowedPaymentMethods', p_payload->'allowed_payment_methods')) = 'array'
        then array(select jsonb_array_elements_text(coalesce(p_payload->'allowedPaymentMethods', p_payload->'allowed_payment_methods')))
      else array['pix', 'cash', 'card', 'transfer', 'boleto', 'other']::text[]
    end,
    coalesce(nullif(coalesce(p_payload->>'allowManualOverride', p_payload->>'allow_manual_override'), '')::boolean, false),
    coalesce(nullif(coalesce(p_payload->>'discountApprovalRequired', p_payload->>'discount_approval_required'), '')::boolean, true),
    coalesce(nullif(coalesce(p_payload->>'homeSurcharge', p_payload->>'home_surcharge'), '')::numeric, 0),
    coalesce(nullif(coalesce(p_payload->>'schoolSurcharge', p_payload->>'school_surcharge'), '')::numeric, 0),
    coalesce(nullif(p_payload->>'active', '')::boolean, true),
    v_valid_from,
    nullif(coalesce(p_payload->>'validUntil', p_payload->>'valid_until'), '')::date,
    v_version,
    v_replaces_id,
    v_key,
    v_hash,
    p_actor_id,
    p_actor_id
  )
  returning * into v_created;

  return to_jsonb(v_created);
end;
$$;

create or replace function public.save_patient_private_pricing_agreement_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_payload jsonb,
  p_idempotency_key text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor_role text;
  v_existing public.patient_private_pricing_agreements%rowtype;
  v_replaced public.patient_private_pricing_agreements%rowtype;
  v_created public.patient_private_pricing_agreements%rowtype;
  v_service public.tuss_service_catalog%rowtype;
  v_payer public.clinic_payers%rowtype;
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_hash text := encode(extensions.digest(convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
  v_service_id uuid := nullif(coalesce(p_payload->>'serviceCatalogId', p_payload->>'service_catalog_id'), '')::uuid;
  v_payer_id uuid := nullif(coalesce(p_payload->>'payerId', p_payload->>'payer_id'), '')::uuid;
  v_replaces_id uuid := nullif(coalesce(p_payload->>'replacesAgreementId', p_payload->>'replaces_agreement_id'), '')::uuid;
  v_version integer := 1;
begin
  if p_organization_id is null or p_patient_id is null or p_actor_id is null or v_key is null then
    raise exception 'PRIVATE_PATIENT_AGREEMENT_SCOPE_IDEMPOTENCY_REQUIRED';
  end if;
  v_actor_role := public.private_finance_actor_role_v2(p_actor_id, p_organization_id);
  if coalesce(v_actor_role, '') not in ('director', 'coordinator', 'receptionist') then
    raise exception 'PRIVATE_PATIENT_AGREEMENT_WRITE_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.patients patient
    where patient.id = p_patient_id
      and patient.clinic_id = p_organization_id
      and patient.deleted_at is null
  ) then
    raise exception 'PRIVATE_PATIENT_AGREEMENT_PATIENT_SCOPE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':private-patient-agreement:' || v_key, 0
  ));
  select * into v_existing
  from public.patient_private_pricing_agreements
  where organization_id = p_organization_id
    and idempotency_key = v_key
  limit 1;
  if v_existing.id is not null then
    if v_existing.request_hash is distinct from v_hash then
      raise exception 'PRIVATE_PATIENT_AGREEMENT_IDEMPOTENCY_CONFLICT';
    end if;
    return to_jsonb(v_existing);
  end if;

  if v_service_id is not null then
    select service.* into v_service
    from public.tuss_service_catalog service
    where service.id = v_service_id
      and service.organization_id = p_organization_id
    limit 1;
    if v_service.id is null then
      raise exception 'PRIVATE_PATIENT_AGREEMENT_SERVICE_SCOPE_INVALID';
    end if;
  end if;
  if v_payer_id is not null then
    select payer.* into v_payer
    from public.clinic_payers payer
    where payer.id = v_payer_id
      and payer.organization_id = p_organization_id
    limit 1;
    if v_payer.id is null then
      raise exception 'PRIVATE_PATIENT_AGREEMENT_PAYER_SCOPE_INVALID';
    end if;
  end if;

  if v_replaces_id is not null then
    select * into v_replaced
    from public.patient_private_pricing_agreements
    where id = v_replaces_id
      and organization_id = p_organization_id
      and patient_id = p_patient_id
    for update;
    if v_replaced.id is null then
      raise exception 'PRIVATE_PATIENT_AGREEMENT_REPLACED_SCOPE_INVALID';
    end if;
    v_version := v_replaced.version + 1;
    update public.patient_private_pricing_agreements
    set
      active = false,
      ended_by = p_actor_id,
      ended_at = now(),
      updated_by = p_actor_id,
      updated_at = now()
    where id = v_replaced.id;
  end if;

  insert into public.patient_private_pricing_agreements (
    organization_id, patient_id, specialty_key, specialty_name,
    service_catalog_id, service_name_snapshot, payer_id, payer_name_snapshot,
    base_amount, discount_amount, home_surcharge, school_surcharge,
    policy_overrides, zero_classification, reason, notes, active,
    valid_from, valid_until, version, replaces_agreement_id,
    approved_by, approved_at, idempotency_key, request_hash,
    created_by, updated_by
  ) values (
    p_organization_id,
    p_patient_id,
    lower(nullif(trim(coalesce(p_payload->>'specialtyKey', p_payload->>'specialty_key', '')), '')),
    nullif(trim(coalesce(p_payload->>'specialtyName', p_payload->>'specialty_name', v_service.specialty, '')), ''),
    v_service_id,
    coalesce(nullif(trim(coalesce(p_payload->>'serviceName', p_payload->>'service_name_snapshot', '')), ''), v_service.name),
    v_payer_id,
    coalesce(nullif(trim(coalesce(p_payload->>'payerName', p_payload->>'payer_name_snapshot', '')), ''), v_payer.name),
    nullif(coalesce(p_payload->>'baseAmount', p_payload->>'base_amount'), '')::numeric,
    coalesce(nullif(coalesce(p_payload->>'discountAmount', p_payload->>'discount_amount'), '')::numeric, 0),
    nullif(coalesce(p_payload->>'homeSurcharge', p_payload->>'home_surcharge'), '')::numeric,
    nullif(coalesce(p_payload->>'schoolSurcharge', p_payload->>'school_surcharge'), '')::numeric,
    case
      when jsonb_typeof(coalesce(p_payload->'policyOverrides', p_payload->'policy_overrides', '{}'::jsonb)) = 'object'
        then coalesce(p_payload->'policyOverrides', p_payload->'policy_overrides', '{}'::jsonb)
      else '{}'::jsonb
    end,
    nullif(upper(trim(coalesce(p_payload->>'zeroClassification', p_payload->>'zero_classification', ''))), ''),
    nullif(trim(coalesce(p_payload->>'reason', '')), ''),
    nullif(trim(coalesce(p_payload->>'notes', '')), ''),
    coalesce(nullif(p_payload->>'active', '')::boolean, true),
    coalesce(nullif(coalesce(p_payload->>'validFrom', p_payload->>'valid_from'), '')::date, current_date),
    nullif(coalesce(p_payload->>'validUntil', p_payload->>'valid_until'), '')::date,
    v_version,
    v_replaces_id,
    p_actor_id,
    now(),
    v_key,
    v_hash,
    p_actor_id,
    p_actor_id
  )
  returning * into v_created;

  return to_jsonb(v_created);
end;
$$;

create or replace function public.sync_private_appointment_finance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
      v_actor_id, v_resolution->>'override_reason', 'BRL', 'America/Sao_Paulo', v_resolution
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
$$;

revoke all on function public.private_finance_actor_role_v2(uuid, uuid) from public, anon, authenticated;
revoke all on function public.resolve_private_session_price_v1(uuid, uuid, text, uuid, timestamptz, text, numeric, numeric, text, text, uuid) from public, anon, authenticated;
revoke all on function public.save_private_session_price_rule_v1(uuid, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.save_patient_private_pricing_agreement_v1(uuid, uuid, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.sync_private_appointment_finance() from public, anon, authenticated;

grant execute on function public.private_finance_actor_role_v2(uuid, uuid) to service_role;
grant execute on function public.resolve_private_session_price_v1(uuid, uuid, text, uuid, timestamptz, text, numeric, numeric, text, text, uuid) to service_role;
grant execute on function public.save_private_session_price_rule_v1(uuid, jsonb, text, uuid) to service_role;
grant execute on function public.save_patient_private_pricing_agreement_v1(uuid, uuid, jsonb, text, uuid) to service_role;
grant execute on function public.sync_private_appointment_finance() to service_role;

comment on function public.private_finance_actor_role_v2(uuid, uuid) is
  'Resolves the active clinic membership role allowed to perform private-finance management. Legacy users.role is never authorization.';

select pg_notify('pgrst', 'reload schema');

commit;
