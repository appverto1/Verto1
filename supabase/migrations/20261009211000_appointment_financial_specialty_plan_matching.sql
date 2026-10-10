-- Financial price and monthly aggregation must recognize clinical profession names
-- and their patient-plan service labels as identical scoped services.
-- Existing patient, organization, billing-mode and temporal checks remain unchanged.
-- Canonical comparison key; persisted values are unchanged.
create or replace function public.appointment_financial_service_key_v1(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  with key as (
    select trim(both '_' from regexp_replace(
      translate(lower(trim(coalesce(p_value,''))),
        'áàâãäéèêëíìîïóòôõöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc'),
      '[^a-z0-9]+','_','g')) as v
  )
  select case
    when v in ('fonoaudiologo','fonoaudiologa','fonoaudiologia','fono','speech_therapy') then 'SPEECH_THERAPY'
    when v in ('terapeuta_ocupacional','terapia_ocupacional','occupational_therapy','to') then 'OCCUPATIONAL_THERAPY'
    when v in ('psicoterapeuta','psicoterapia','psicologo','psicologa','psicologia','psychology') then 'PSYCHOLOGY'
    when v in ('psicopedagogo','psicopedagoga','psicopedagogia','psychopedagogy') then 'PSYCHOPEDAGOGY'
    when v in ('fisioterapeuta','fisioterapia','physiotherapy') then 'PHYSIOTHERAPY'
    when v in ('nutricionista','nutricao','nutrition') then 'NUTRITION'
    when v in ('psicomotricista','psicomotricidade','psychomotricity') then 'PSYCHOMOTRICITY'
    when v in ('arteterapeuta','arteterapia','art_therapy') then 'ART_THERAPY'
    when v in ('musicoterapeuta','musicoterapia','music_therapy') then 'MUSIC_THERAPY'
    else upper(v)
  end from key;
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
        public.appointment_financial_service_key_v1(coalesce(nullif(plan.service_name_snapshot, ''), nullif(plan.custom_service_name, ''), plan.service_type)) = public.appointment_financial_service_key_v1(v_specialty)
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
        when public.appointment_financial_service_key_v1(coalesce(nullif(plan.service_name_snapshot, ''), nullif(plan.custom_service_name, ''), plan.service_type)) = public.appointment_financial_service_key_v1(v_specialty) then 1
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
