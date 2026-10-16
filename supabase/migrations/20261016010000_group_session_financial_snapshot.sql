-- Independent GROUP rate with existing due date/cancellation/no-show policy.
-- Individual pricing function is deliberately untouched.
begin;
CREATE OR REPLACE FUNCTION public.resolve_group_private_session_price_v1(p_organization_id uuid, p_patient_id uuid, p_specialty text, p_service_catalog_id uuid, p_scheduled_at timestamp with time zone, p_care_setting text, p_manual_amount numeric, p_discount_amount numeric, p_zero_classification text, p_override_reason text, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_group_rate jsonb;
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
$function$;

revoke all on function public.resolve_group_private_session_price_v1(uuid,uuid,text,uuid,timestamptz,text,numeric,numeric,text,text,uuid) from public,anon,authenticated;
grant execute on function public.resolve_group_private_session_price_v1(uuid,uuid,text,uuid,timestamptz,text,numeric,numeric,text,text,uuid) to service_role;
commit;
